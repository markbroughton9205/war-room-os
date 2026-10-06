/**
 * Phase 5 defect closure - the general capabilities the live proofs exposed as missing:
 *  multi-element edit preservation, partial-fix reasoning, unambiguous edit evidence (BEFORE/AFTER/ADDED/REMOVED), oscillation recovery, failure identity for
 *  import-time errors, safer-equivalent API selection, local evidence before web, the mission start contract and the sandbox-ownership explanation.
 * Behaviour is checked against REAL Python runs on the committed fixtures (never a mock of the failure), plus textual assertions on the runtime wiring.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  classifyEditOutcome, editEvidence, failureIdentity, forensicsOf, importBindings, isOscillating, languageOf, parseFailure, preserveUnaffected, pushTrail, recoverProgress, usesName, type ProgressEdit,
} from './foundryEditForensics'
import { preferSecureEquivalent, saferFormWasNotEnough, secureHintFor } from './foundrySecureDefaults'
import { failureSignature } from './foundryEngineeringCampaign'
import { editFromProposal, previousInvalidFor, promptFor, specialistRequestFromCampaign } from './foundryEngineeringSpecialist'
import { assertionSentence, failureFirst, readAssertion } from './foundryEditForensics'
import { guardPlannedEdit } from './foundryEditGuard'
import {
  SIGNATURE_PROBE_SCRIPT, analyzeFailure, chooseNextTool, dropStaleHints, emptyTooling, migrationHint, parseSignature, researchNote, restoreTooling,
} from './foundryToolReasoning'
import { classifyStartResponse, failed, planStartWorkspace, requested, startStatusAttributes, startStatusSentence, START_FAILURE_REASONS, type StartStatus } from './foundryMissionStart'
import { SANDBOX_METHODS, explainSandboxInstall } from './foundrySandboxInstallExplanation'
import { readProjectSources } from './foundryProjectContextIO'
import { IN_FLIGHT_REPAIR_WINDOW_MS, MissionAlreadyRunningError, reportIssue } from './runtime'
import { getRepair, saveRepair } from './storage'
import { issueFromCommanderReport } from './issueIngest'
import { plainOutputEnv } from './foundryEngineeringRuntime'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const repo = resolveRepoRoot()
const FIXTURES = 'lib/native-builder/__fixtures__/foundry-phase5'
const fixtureDir = (name: string) => path.join(repo, FIXTURES, name)
const env = { ...plainOutputEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }
const read = (rel: string) => readFileSync(path.join(repo, rel), 'utf8')

function py(cwd: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync('python3', args, { cwd, encoding: 'utf8', env, timeout: 60_000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const unittest = (cwd: string) => py(cwd, ['-m', 'unittest', 'discover', '-s', 'tests'])
/** A disposable copy of a fixture: the committed fixtures are never touched or given bytecode. */
function withCopy<T>(name: string, run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), `foundry-p5r-${name}-`))
  try { cpSync(fixtureDir(name), dir, { recursive: true }); return run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const RENDERER = 'reports/renderer.py'
const TWO_NAMES = 'from jinja2 import Environment, Markup'

async function main() {
  // ---- 1. the original hard fixture: the exact shape that failed live
  const hard = readFileSync(path.join(fixtureDir('c-jinja'), RENDERER), 'utf8')
  check('H_the_original_hard_multi_name_import_is_the_fixture_shape', hard.startsWith(`${TWO_NAMES}\n`) && readFileSync(path.join(fixtureDir('e-notes'), RENDERER), 'utf8') === hard, hard.split('\n')[0])
  const start = hard.indexOf(TWO_NAMES)
  const end = start + TWO_NAMES.length
  const badAfter = 'from markupsafe import Markup'

  // ---- 2. multi-element edit preservation (item 2)
  const kept = preserveUnaffected({ file: RENDERER, source: hard, start, end, after: badAfter })
  check('P_moving_one_name_keeps_the_unaffected_one_in_place_with_its_own_module', kept.after === 'from jinja2 import Environment\nfrom markupsafe import Markup' && kept.restored.map(item => item.name).join() === 'Environment', kept.after.replace(/\n/g, ' / '))
  const solved = withCopy('c-jinja', dir => { writeFileSync(path.join(dir, RENDERER), hard.slice(0, start) + kept.after + hard.slice(end)); return unittest(dir) })
  check('P_the_preserved_result_really_passes_the_original_hard_fixture_tests', solved.code === 0, solved.out.trim().split('\n').slice(-2).join(' | '))
  const unguarded = withCopy('c-jinja', dir => { writeFileSync(path.join(dir, RENDERER), hard.slice(0, start) + badAfter + hard.slice(end)); return unittest(dir) })
  check('P_without_the_guard_the_same_edit_really_breaks_it_with_a_NameError_for_the_lost_name', unittest(fixtureDir('c-jinja')).code !== 0 && unguarded.code !== 0 && /NameError: name 'Environment' is not defined/.test(unguarded.out), '')
  // The rule is about names, not libraries.
  const generic = preserveUnaffected({ file: 'app/x.py', source: 'from oldpkg import Alpha, Beta, Gamma\n\nvalue = Alpha() + Beta()\n', start: 0, end: 'from oldpkg import Alpha, Beta, Gamma'.length, after: 'from newpkg import Beta' })
  check('P_it_is_not_tied_to_any_library_and_restores_only_names_the_code_still_uses', generic.after === 'from oldpkg import Alpha\nfrom newpkg import Beta' && !/Gamma/.test(generic.after), generic.after.replace(/\n/g, ' / '))
  check('P_a_name_the_edit_brings_back_or_defines_itself_is_not_restored_twice', preserveUnaffected({ file: 'a.py', source: 'from o import A, B\nuse(A, B)\n', start: 0, end: 'from o import A, B'.length, after: 'from n import A, B' }).restored.length === 0
    && preserveUnaffected({ file: 'a.py', source: 'from o import A, B\nuse(A, B)\n', start: 0, end: 'from o import A, B'.length, after: 'from n import A\ndef B():\n    pass' }).restored.length === 0)
  check('P_a_name_mentioned_only_in_a_comment_or_string_is_not_a_use', preserveUnaffected({ file: 'a.py', source: 'from o import A, B\nprint("B")  # B\nA()\n', start: 0, end: 'from o import A, B'.length, after: 'from n import A' }).restored.length === 0)
  check('P_an_attribute_of_something_else_is_not_a_use_of_the_name', !usesName('x.Environment(1)', 'Environment', 'python') && usesName('Environment(1)', 'Environment', 'python') && usesName('f"{Environment}"', 'Environment', 'python'))
  const alias = preserveUnaffected({ file: 'a.py', source: 'from o import Thing as T, Other\nT()\n', start: 0, end: 'from o import Thing as T, Other'.length, after: 'from n import Other' })
  check('P_an_aliased_import_is_restored_with_its_alias', alias.after === 'from o import Thing as T\nfrom n import Other', alias.after.replace(/\n/g, ' / '))
  const js = preserveUnaffected({ file: 'src/a.ts', source: "import { keep, move } from 'old'\nkeep(move())\n", start: 0, end: "import { keep, move } from 'old'".length, after: "import { move } from 'new'" })
  check('P_the_same_rule_holds_for_named_imports_in_javascript_and_typescript', js.after === "import { keep } from 'old'\nimport { move } from 'new'" && languageOf('a.ts') === 'js' && languageOf('a.py') === 'python' && languageOf('a.txt') === null, js.after.replace(/\n/g, ' / '))
  check('P_an_edit_that_touches_no_import_is_left_exactly_as_written', preserveUnaffected({ file: 'a.py', source: 'x = 1\n', start: 0, end: 5, after: 'x = 2' }).after === 'x = 2' && preserveUnaffected({ file: 'notes.md', source: 'a', start: 0, end: 1, after: 'b' }).after === 'b')
  const crlf = preserveUnaffected({ file: 'a.py', source: 'from o import A, B\r\nA(); B()\r\n', start: 0, end: 'from o import A, B'.length, after: 'from n import B' })
  check('P_the_source_line_ending_style_is_kept', crlf.after === 'from o import A\r\nfrom n import B', JSON.stringify(crlf.after))
  check('P_import_bindings_read_multiline_parenthesised_and_plain_imports', importBindings('from a import (\n    X,\n    Y as Z,\n)\nimport os.path\nimport q as r\n', 'python').map(item => item.name).join() === 'X,Z,os,r')

  // ---- 2b. through the REAL edit builder: a PlannedEdit carries the whole old source, the whole new source and the changed region (this is how model edits arrive)
  const proposal = editFromProposal({ file: RENDERER, search: TWO_NAMES, replace: badAfter }, new Map([[RENDERER, hard]]))
  check('E_the_real_edit_builder_makes_a_whole_file_edit_with_the_changed_region', Boolean(proposal) && proposal!.before === hard && proposal!.start === 0 && proposal!.end === TWO_NAMES.length && proposal!.after === hard.replace(TWO_NAMES, badAfter), JSON.stringify({ s: proposal?.start, e: proposal?.end }))
  const guarded = proposal ? guardPlannedEdit({ file: RENDERER, source: hard, edit: proposal }) : null
  check('E_the_guard_turns_the_exact_model_edit_that_failed_live_into_one_that_keeps_Environment', guarded?.changed === true && guarded.after === hard.replace(TWO_NAMES, 'from jinja2 import Environment\nfrom markupsafe import Markup') && guarded.restored.map(item => item.name).join() === 'Environment', guarded?.after.split('\n').slice(0, 2).join(' / '))
  const guardedRun = guarded ? withCopy('c-jinja', dir => { writeFileSync(path.join(dir, RENDERER), guarded.after); return unittest(dir) }) : { code: 1, out: '' }
  check('E_that_guarded_whole_file_really_passes_the_original_hard_fixture_tests', guardedRun.code === 0, guardedRun.out.trim().split('\n').slice(-1)[0])
  check('E_the_forensics_and_region_recorded_for_the_repairer_and_for_recovery_are_the_changed_region_not_the_file', guarded?.span.before === TWO_NAMES && guarded.span.after === 'from jinja2 import Environment\nfrom markupsafe import Markup' && guarded.forensics.before.join() === TWO_NAMES && guarded.forensics.restored.join() === 'Environment' && guarded.forensics.moved[0]?.name === 'Markup')
  const wholeFile = editFromProposal({ file: RENDERER, search: '', replace: hard.replace(TWO_NAMES, badAfter) }, new Map([[RENDERER, hard]]))
  const wholeGuard = wholeFile ? guardPlannedEdit({ file: RENDERER, source: hard, edit: wholeFile }) : null
  check('E_a_whole_file_rewrite_keeps_the_unaffected_element_too', wholeGuard?.changed === true && /^from jinja2 import Environment\nfrom markupsafe import Markup\n/.test(wholeGuard.after), wholeGuard?.after.split('\n').slice(0, 2).join(' / '))
  check('E_an_edit_that_loses_nothing_and_needs_no_safer_form_is_left_exactly_as_proposed', (() => { const fine = editFromProposal({ file: RENDERER, search: 'return Markup("<b>{}</b>").format(text)', replace: 'return Markup("<b>{}</b>").format(text.strip())' }, new Map([[RENDERER, hard]])); const g = fine ? guardPlannedEdit({ file: RENDERER, source: hard, edit: fine }) : null; return Boolean(g) && g!.changed === false && g!.after === fine!.after })())
  check('E_when_the_disk_no_longer_matches_what_the_model_saw_the_edit_is_not_touched', proposal ? guardPlannedEdit({ file: RENDERER, source: hard.replace(TWO_NAMES, 'from jinja2 import Something'), edit: proposal }) === null : false)
  const yamlSource = readFileSync(path.join(fixtureDir('f-config'), 'app/settings.py'), 'utf8')
  const yamlProposal = editFromProposal({ file: 'app/settings.py', search: 'return yaml.load(text)', replace: 'return yaml.load(text, Loader=yaml.Loader)' }, new Map([['app/settings.py', yamlSource]]))
  const yamlGuarded = yamlProposal ? guardPlannedEdit({ file: 'app/settings.py', source: yamlSource, edit: yamlProposal }) : null
  check('E_the_exact_yaml_edit_the_model_chose_live_is_written_with_the_safe_loader', yamlGuarded?.changed === true && /Loader=yaml\.SafeLoader/.test(yamlGuarded.after) && !/Loader=yaml\.Loader/.test(yamlGuarded.after) && yamlGuarded.rewrites[0]?.rule === 'PARSE_DATA_WITHOUT_CODE_EXECUTION', yamlGuarded?.after.trim().split('\n').slice(-1)[0])
  const off = yamlProposal ? guardPlannedEdit({ file: 'app/settings.py', source: yamlSource, edit: yamlProposal, secureOff: true }) : null
  check('E_with_the_safer_form_switched_off_the_edit_is_written_as_proposed', off?.changed === false && /Loader=yaml\.Loader/.test(off.after))
  const titleSource = readFileSync(path.join(fixtureDir('f-config'), 'app/title.py'), 'utf8')
  const titleProposal = editFromProposal({ file: 'app/title.py', search: 'return Markup("<h1>{}</h1>").format(settings["title"])', replace: 'return Markup("<h1>" + settings["title"] + "</h1>")' }, new Map([['app/title.py', titleSource]]))
  const titleGuarded = titleProposal ? guardPlannedEdit({ file: 'app/title.py', source: titleSource, edit: titleProposal }) : null
  check('E_the_exact_unescaped_markup_edit_from_the_first_live_attempt_is_written_escaped', titleGuarded?.changed === true && /Markup\("<h1>\{\}<\/h1>"\)\.format\(settings\["title"\]\)/.test(titleGuarded.after), titleGuarded?.after.trim().split('\n').slice(-1)[0])

  // ---- 3. failure identity for import-time errors (the reason real progress was read as "the same failure")
  const baselineOut = unittest(fixtureDir('c-jinja')).out
  check('I_the_baseline_failure_is_an_ImportError_about_Markup', failureIdentity(baselineOut) === 'ImportError:Markup', failureIdentity(baselineOut))
  check('I_an_import_time_NameError_is_a_different_failure_from_the_ImportError', failureIdentity(unguarded.out) === 'NameError:Environment' && failureSignature(baselineOut) !== failureSignature(unguarded.out), `${failureSignature(baselineOut).slice(0, 60)} | ${failureSignature(unguarded.out).slice(0, 60)}`)
  check('I_the_runner_header_alone_never_names_the_failure', parseFailure(baselineOut).symbol === 'Markup' && parseFailure('ImportError: Failed to import test module: t\n').exception !== 'X', '')
  check('I_two_identical_failures_still_share_an_identity_and_a_signature', failureSignature(baselineOut) === failureSignature(baselineOut) && failureIdentity(baselineOut) === failureIdentity(baselineOut.replace(/\/[^\s)]+/g, '/x')))

  // ---- 4. partial-fix reasoning (item 3)
  const rawForensics = forensicsOf({ file: RENDERER, source: hard, start, end, after: badAfter })
  const partial = classifyEditOutcome({ previous: baselineOut, current: unguarded.out, forensics: rawForensics })
  check('F_ImportError_then_NameError_after_a_move_is_PARTIAL_PROGRESS_naming_what_worked_and_what_broke', partial.kind === 'PARTIAL_PROGRESS' && partial.kept === 'Markup' && partial.broke === 'Environment', JSON.stringify(partial))
  check('F_the_same_failure_after_an_edit_is_NO_EFFECT_and_an_unrelated_change_is_not_partial_progress', classifyEditOutcome({ previous: baselineOut, current: baselineOut, forensics: rawForensics }).kind === 'NO_EFFECT'
    && classifyEditOutcome({ previous: baselineOut, current: "NameError: name 'Other' is not defined", forensics: rawForensics }).kind === 'CHANGED')
  check('F_unreadable_failures_are_UNKNOWN_and_never_guessed', classifyEditOutcome({ previous: 'all good', current: 'still good', forensics: null }).kind === 'UNKNOWN')

  // ---- 5. the debugger reads the edit by labels, never by an unlabeled +/- (item 4)
  const evidence = editEvidence(rawForensics)
  check('D_every_line_of_the_edit_evidence_is_labelled_BEFORE_AFTER_REMOVED_MOVED', /^MY LAST EDIT in reports\/renderer.py\nBEFORE: from jinja2 import Environment, Markup\nAFTER: from markupsafe import Markup\nREMOVED: Environment \(from jinja2\)\nMOVED: Markup from jinja2 to markupsafe$/.test(evidence), evidence.replace(/\n/g, ' / '))
  const addedEvidence = editEvidence(forensicsOf({ file: 'a.py', source: 'x = 1\n', start: 0, end: 5, after: 'from n import Q\nx = 2' }))
  check('D_an_added_name_is_labelled_ADDED', /ADDED: Q \(from n\)/.test(addedEvidence), addedEvidence.replace(/\n/g, ' / '))
  const campaignLike = (extra: Record<string, unknown>) => ({
    missionId: 'm', request: 'r', acceptance: ['a'], knowledge: { architecture: [], tests: [], interfaces: [], failures: [] }, repairFinding: unguarded.out.slice(0, 900), ruledOut: [], noEffect: [], progress: undefined,
    recentEdits: [{ file: RENDERER, diff: '-from jinja2 import Environment, Markup\n+from markupsafe import Markup', forensics: rawForensics }], modelCallBudget: 40, modelCalls: 1, localOnly: false, pin: null, ...extra,
  }) as never
  const asked = specialistRequestFromCampaign({ campaign: campaignLike({ editOutcome: partial.kind === 'PARTIAL_PROGRESS' ? partial : null }), taskId: 'debug-1', role: 'DEBUGGER', purpose: 'p', acceptance: 'a', workingSet: [RENDERER], excerpts: [], needsEdit: false, attempt: 1 })
  check('D_the_debugger_request_carries_BEFORE_AFTER_REMOVED_MOVED_and_what_worked_and_what_broke', /BEFORE:/.test(asked.suspectEdit ?? '') && /AFTER:/.test(asked.suspectEdit ?? '') && /REMOVED: Environment/.test(asked.suspectEdit ?? '') && /WHAT WORKED: Markup is fixed now/.test(asked.suspectEdit ?? '') && /WHAT BROKE: Environment/.test(asked.suspectEdit ?? ''), (asked.suspectEdit ?? '').replace(/\n/g, ' / ').slice(0, 200))
  const legacy = specialistRequestFromCampaign({ campaign: campaignLike({ recentEdits: [{ file: RENDERER, diff: '-old\n+new' }] }), taskId: 'debug-1', role: 'DEBUGGER', purpose: 'p', acceptance: 'a', workingSet: [RENDERER], excerpts: [], needsEdit: false, attempt: 1 })
  check('D_an_old_record_without_forensics_still_gets_a_labelled_header_instead_of_a_bare_diff', /^MY LAST EDIT in reports\/renderer.py\nCHANGED LINES: -old \+new/.test(legacy.suspectEdit ?? ''), (legacy.suspectEdit ?? '').replace(/\n/g, ' / '))
  const specialistSource = read('lib/native-builder/foundryEngineeringSpecialist.ts')
  check('D_the_prompt_tells_the_repairer_how_to_read_the_labels_and_no_longer_says_the_whole_edit_may_be_the_cause', /Read every line by its label/.test(specialistSource) && /Do not undo the requested change/.test(specialistSource) && !/MY LAST EDIT MAY HAVE CAUSED THIS/.test(specialistSource))

  // ---- 5b. tool-failure adaptation: a rejected tool call is answered with exactly what was wrong, not the same words again
  const invalidReceipt = { role: 'BACKEND', taskId: 'backend', failureClass: 'INVALID_OUTPUT', summary: 'Tool "file.replace_unique" is missing required argument "replacementText".' }
  const withInvalid = campaignLike({ workerReceipts: [{ role: 'DEBUGGER', taskId: 'debug-1' }, invalidReceipt] }) as never as { workerReceipts: unknown[] }
  check('T_the_reason_the_last_answer_was_rejected_is_read_from_the_worker_receipts', previousInvalidFor(withInvalid as never, 'BACKEND', 'backend').previousInvalid === invalidReceipt.summary && previousInvalidFor(withInvalid as never, 'FRONTEND', 'frontend').previousInvalid === undefined && previousInvalidFor(withInvalid as never, 'DEBUGGER', 'debug-1').previousInvalid === undefined)
  check('T_a_good_answer_after_the_bad_one_clears_it_and_other_tasks_are_not_affected', previousInvalidFor(campaignLike({ workerReceipts: [invalidReceipt, { role: 'BACKEND', taskId: 'backend', failureClass: null, summary: 'ok' }] }), 'BACKEND', 'backend').previousInvalid === undefined && previousInvalidFor(withInvalid as never, 'BACKEND', 'other-task').previousInvalid === undefined)
  const retryRequest = specialistRequestFromCampaign({ campaign: campaignLike({ workerReceipts: [invalidReceipt] }), taskId: 'backend', role: 'BACKEND', purpose: 'p', acceptance: 'a', workingSet: ['prices/loader.py'], excerpts: [{ file: 'prices/loader.py', text: 'x = 1' }], needsEdit: true, attempt: 2 })
  const retryPrompt = promptFor(retryRequest)
  check('T_the_retry_prompt_names_the_exact_rejection_and_shows_every_required_argument_filled_in', /YOUR LAST ANSWER WAS REJECTED: Tool "file\.replace_unique" is missing required argument "replacementText"\./.test(retryPrompt) && /"path":"prices\/loader\.py","matchText":"[^"]+","replacementText":"[^"]+","reason":"[^"]+"/.test(retryPrompt) && /none empty/.test(retryPrompt))
  const firstPrompt = promptFor(specialistRequestFromCampaign({ campaign: campaignLike({}), taskId: 'backend', role: 'BACKEND', purpose: 'p', acceptance: 'a', workingSet: ['prices/loader.py'], excerpts: [{ file: 'prices/loader.py', text: 'x = 1' }], needsEdit: true, attempt: 1 }))
  check('T_a_first_attempt_prompt_is_unchanged_and_has_no_blank_line', !/REJECTED/.test(firstPrompt) && !/\n\n/.test(firstPrompt))
  const generalRetry = promptFor({ ...retryRequest, generalMode: true })
  check('T_the_general_mode_retry_carries_it_too', /YOUR LAST ANSWER WAS REJECTED/.test(generalRetry))

  // ---- 5c. a failed assertion is read the right way round (the same class of mistake as reading a diff backwards)
  const fBad = withCopy('f-config', dir => {
    writeFileSync(path.join(dir, 'app/settings.py'), 'import yaml\n\n\ndef load_settings(text):\n    return yaml.load(text, Loader=yaml.SafeLoader)\n')
    writeFileSync(path.join(dir, 'app/title.py'), 'def page_title(settings):\n    from markupsafe import Markup\n\n    return Markup(f\'<h1>{settings["title"]}</h1>\')\n')
    return unittest(dir)
  })
  const reading = readAssertion(fBad.out)
  check('A_the_real_failed_assertion_is_read_as_code_produced_the_unescaped_text_and_the_test_expects_the_escaped_text', reading?.actual === "'<h1>A & B</h1>'" && reading?.expected === "'<h1>A &amp; B</h1>'", JSON.stringify(reading))
  check('A_the_sentence_says_which_is_which_and_never_to_change_the_test', /the code produced '<h1>A & B<\/h1>' but the test expects '<h1>A &amp; B<\/h1>'/.test(assertionSentence(reading!)) && /never change what the test expects/.test(assertionSentence(reading!)))
  check('A_expected_first_and_actual_second_is_read_the_other_way_round', (() => { const r = readAssertion("    self.assertEqual(5, compute(2))\nAssertionError: 5 != 4"); return r?.actual === '4' && r?.expected === '5' })())
  check('A_two_expressions_or_two_literals_are_not_guessed', readAssertion("self.assertEqual(a(), b())\nAssertionError: 1 != 2") === null && readAssertion("self.assertEqual(1, 2)\nAssertionError: 1 != 2") === null && readAssertion('no assertion here') === null)
  check('A_commas_inside_brackets_and_strings_do_not_split_an_argument', readAssertion("self.assertEqual(join([1, 2], ', '), 'a, b')\nAssertionError: '1, 2' != 'a, b'")?.actual === "'1, 2'")
  const fRequest = specialistRequestFromCampaign({ campaign: campaignLike({ repairFinding: fBad.out.slice(-700) }), taskId: 'debug-1', role: 'DEBUGGER', purpose: 'p', acceptance: 'a', workingSet: ['app/title.py'], excerpts: [], needsEdit: false, attempt: 1 })
  check('A_the_reading_leads_the_failure_evidence_so_the_prompt_length_limit_can_never_cut_it', fRequest.failureEvidence[0]?.startsWith('WHAT THE TEST COMPARES') && /WHAT THE TEST COMPARES: the code produced/.test(promptFor(fRequest)))
  const reviewerRequest = specialistRequestFromCampaign({ campaign: campaignLike({ repairFinding: fBad.out.slice(-700) }), taskId: 'review', role: 'REVIEWER', purpose: 'p', acceptance: 'a', workingSet: [], excerpts: [], needsEdit: false, attempt: 1 })
  check('A_a_reviewer_still_gets_no_failure_evidence', reviewerRequest.failureEvidence.length === 0)
  // the same unsafe class in two more shapes, each rewritten and each really escaping
  const fs1 = preferSecureEquivalent({ file: 'app/title.py', after: 'return Markup(f\'<h1>{settings["title"]}</h1>\')' })
  check('S_an_f_string_inside_markup_is_rewritten_to_format_the_value_into_the_markup', fs1.after === 'return Markup(\'<h1>{}</h1>\').format(settings["title"])' && fs1.rewrites.length === 1, fs1.after)
  const fs2 = preferSecureEquivalent({ file: 'a.py', after: 'x = Markup("<i>{}</i>".format(name))' })
  check('S_formatting_first_and_wrapping_after_is_rewritten_to_wrap_first', fs2.after === 'x = Markup("<i>{}</i>").format(name)', fs2.after)
  const fsRun = py(os.tmpdir(), ['-c', 'from markupsafe import Markup\nsettings = {"title": "A & B"}\nprint(str(Markup(\'<h1>{}</h1>\').format(settings["title"])))\nprint(str(Markup(f\'<h1>{settings["title"]}</h1>\')))'])
  check('S_the_rewritten_f_string_form_really_escapes_and_the_original_really_does_not', fsRun.out.trim().split('\n').join('|') === '<h1>A &amp; B</h1>|<h1>A & B</h1>', fsRun.out.trim().replace(/\n/g, '|'))
  const fFixed = withCopy('f-config', dir => {
    writeFileSync(path.join(dir, 'app/settings.py'), 'import yaml\n\n\ndef load_settings(text):\n    return yaml.load(text, Loader=yaml.SafeLoader)\n')
    writeFileSync(path.join(dir, 'app/title.py'), `def page_title(settings):\n    from markupsafe import Markup\n\n    ${fs1.after}\n`)
    return unittest(dir)
  })
  check('S_the_exact_f_string_edit_the_model_wrote_live_becomes_a_file_whose_tests_pass', fFixed.code === 0, fFixed.out.trim().split('\n').slice(-1)[0])
  check('S_markup_with_no_untrusted_value_is_left_alone', preferSecureEquivalent({ file: 'a.py', after: 'Markup("<hr>")' }).rewrites.length === 0 && preferSecureEquivalent({ file: 'a.py', after: 'Markup("<b>{}</b>").format(x)' }).rewrites.length === 0)

  // ---- 5d. research to code: the finding plus the failing line make the change mechanical, so it is stated outright
  const importNames = { MarkupSafe: { version: '3.0.3', modules: ['markupsafe'] } }
  const hintTwo = migrationHint({ raw: baselineOut, root: 'jinja2', symbol: 'Markup', action: 'MOVED', replacement: 'MarkupSafe', importNames })
  check('H_a_moved_name_in_a_multi_name_import_gets_the_exact_two_line_change', /replace the line `from jinja2 import Environment, Markup` with these two lines `from jinja2 import Environment \/ from markupsafe import Markup` and change nothing else/.test(hintTwo), hintTwo.slice(0, 200))
  const fTitleOut = withCopy('f-config', dir => { writeFileSync(path.join(dir, 'app/settings.py'), 'import yaml\n\n\ndef load_settings(text):\n    return yaml.load(text, Loader=yaml.SafeLoader)\n'); return unittest(dir).out })
  const hintLocal = migrationHint({ raw: fTitleOut, root: 'jinja2', symbol: 'Markup', action: 'MOVED', replacement: 'MarkupSafe', importNames })
  check('H_an_indented_import_inside_a_function_gets_the_exact_one_line_change_from_the_real_failing_output', /replace the line `from jinja2 import Markup` with the line `from markupsafe import Markup` and change nothing else; every other line, including how Markup is used, stays exactly as it is/.test(hintLocal), hintLocal.slice(0, 200))
  check('H_the_change_is_only_stated_when_the_finding_is_a_move_or_rename_and_the_new_module_is_known', migrationHint({ raw: fTitleOut, root: 'jinja2', symbol: 'Markup', action: 'REMOVED', replacement: 'MarkupSafe', importNames }) === '' && migrationHint({ raw: fTitleOut, root: 'jinja2', symbol: 'Markup', action: 'MOVED', replacement: 'MarkupSafe', importNames: {} }) === '' && migrationHint({ raw: fTitleOut, root: 'jinja2', symbol: 'Markup', action: 'MOVED', replacement: null, importNames }) === '')
  check('H_nothing_is_stated_when_the_failing_output_does_not_show_that_import', migrationHint({ raw: 'ImportError: something else', root: 'jinja2', symbol: 'Markup', action: 'MOVED', replacement: 'MarkupSafe', importNames }) === '' && migrationHint({ raw: fTitleOut, root: 'jinja2', symbol: 'Escape', action: 'MOVED', replacement: 'MarkupSafe', importNames }) === '')
  check('H_an_unsafe_name_or_module_is_never_placed_in_a_hint', migrationHint({ raw: 'from a import b', root: 'a', symbol: 'b; rm -rf', action: 'MOVED', replacement: 'X', importNames: { X: { version: null, modules: ['x y'] } } }) === '')
  const moveQuestion = { key: 'k', text: 't', root: 'jinja2', symbol: 'Markup', status: 'ANSWERED' as const, waves: 1, consulted: [], findings: [{ subject: 'jinja2.Markup', action: 'MOVED' as const, version: '3.1.0', replacement: 'MarkupSafe', quote: 'Markup and escape should be imported from MarkupSafe.', url: 'https://jinja.palletsprojects.com/changes/', tier: 3 as const, label: 'official release notes', fetchedAt: 'x' }], conflicts: [], implication: 'Markup moved in 3.1.0. Import it from MarkupSafe instead.', installedVersion: '3.1.6', answeredAt: 'x' }
  const noteWithHint = researchNote(moveQuestion, importNames, baselineOut) ?? ''
  check('H_the_editor_note_carries_the_exact_change_and_stays_within_its_bound', /THE EXACT CHANGE: replace the line `from jinja2 import Environment, Markup`/.test(noteWithHint) && noteWithHint.length <= 1300 && /do not add a workaround\.$/.test(noteWithHint), String(noteWithHint.length))
  check('H_without_failing_output_the_note_is_exactly_what_it_was', !/THE EXACT CHANGE/.test(researchNote(moveQuestion, importNames) ?? ''))
  const hintApplied = withCopy('f-config', dir => {
    writeFileSync(path.join(dir, 'app/settings.py'), 'import yaml\n\n\ndef load_settings(text):\n    return yaml.load(text, Loader=yaml.SafeLoader)\n')
    const titleFile = path.join(dir, 'app/title.py'); const source = readFileSync(titleFile, 'utf8')
    writeFileSync(titleFile, source.replace('from jinja2 import Markup', 'from markupsafe import Markup'))
    return unittest(dir)
  })
  check('H_doing_exactly_what_the_hint_says_really_makes_the_fixture_pass', hintApplied.code === 0, hintApplied.out.trim().split('\n').slice(-1)[0])
  check('H_the_runtime_gives_the_note_the_failing_output', read('lib/native-builder/foundryEngineeringRuntime.ts').includes('researchNote(answered, tooling.importNames, raw)'))

  // ---- 5e. a hint is only true while its line exists: the exact sequence that blocked green missions live (fix applied, review reopens, the note still says "replace that line")
  check('H_before_the_change_the_hint_is_kept_because_the_line_it_names_is_in_the_shown_file', dropStaleHints([noteWithHint], [hard]).join() === noteWithHint && /THE EXACT CHANGE/.test(dropStaleHints([noteWithHint], [hard])[0]))
  const fixedFile = guarded ? guarded.after : ''
  const afterFix = dropStaleHints([noteWithHint], [fixedFile])[0]
  check('H_after_the_change_the_same_note_no_longer_tells_anyone_to_replace_the_line_that_is_gone', !/THE EXACT CHANGE|replace the line/.test(afterFix) && /That import line has already been changed; do not change it again\./.test(afterFix) && afterFix.startsWith(noteWithHint.slice(0, 40)), afterFix.slice(-160))
  check('H_the_rest_of_the_note_the_finding_and_the_import_name_survive_when_the_hint_is_dropped', /Markup moved in 3\.1\.0/.test(afterFix) && /`markupsafe`/.test(afterFix) && /do not add a workaround\.$/.test(afterFix))
  check('H_with_nothing_shown_to_check_against_the_hint_stays_and_other_notes_are_untouched', dropStaleHints([noteWithHint], [])[0] === noteWithHint && dropStaleHints(['Runtime trace of the failing test: x'], [fixedFile])[0] === 'Runtime trace of the failing test: x')
  check('H_a_file_that_still_has_the_line_among_others_keeps_the_hint_and_a_lookalike_line_does_not', dropStaleHints([noteWithHint], ['x = 1', TWO_NAMES, 'y = 2'])[0] === noteWithHint && /already been changed/.test(dropStaleHints([noteWithHint], ['from jinja2 import Environment, Markup2'])[0]))
  check('H_the_runtime_filters_hints_against_the_files_the_specialist_is_actually_shown', read('lib/native-builder/foundryEngineeringRuntime.ts').includes('dropStaleHints(state.tooling?.notes ?? [], shownExcerpts.filter(item => item.text.length > 0).map(item => item.text))'))
  const reviewRework = withCopy('c-jinja', dir => { if (guarded) writeFileSync(path.join(dir, RENDERER), guarded.after); const shown = readFileSync(path.join(dir, RENDERER), 'utf8'); return { green: unittest(dir).code === 0, note: dropStaleHints([noteWithHint], [shown])[0] } })
  check('H_end_to_end_on_the_real_fixture_the_file_is_green_and_the_note_the_reworking_editor_would_see_no_longer_names_the_old_line', reviewRework.green && !/from jinja2 import Environment, Markup/.test(reviewRework.note), reviewRework.note.slice(-90))

  // ---- 5f. the first edit goes where the failing run points (the live F mission edited title.py, which was fine, while the failure was in settings.py)
  const fBaseline = await (async () => { const files = await readProjectSources(fixtureDir('f-config')); const byPath = new Map(files.map(file => [file.path, file.content])); return analyzeFailure(unittest(fixtureDir('f-config')).out, { projectFiles: files.map(file => file.path), sourceOf: rel => byPath.get(rel) ?? null }) })()
  check('T_the_real_baseline_failure_of_the_f_fixture_points_at_settings_not_title', fBaseline.projectFrames.join() === 'app/settings.py:load_settings', fBaseline.projectFrames.join())
  check('T_the_working_set_ranked_by_the_requests_words_is_reordered_so_the_failing_frame_comes_first', failureFirst(['app/title.py', 'app/settings.py', 'tests/test_pages.py'], ['tests/test_pages.py:test_settings_are_parsed', ...fBaseline.projectFrames]).join() === 'app/settings.py,app/title.py,tests/test_pages.py')
  check('T_the_innermost_project_frame_wins_and_test_files_never_do', failureFirst(['a.py', 'b.py', 'c.py'], ['tests/test_x.py:t', 'a.py:outer', 'c.py:inner']).join() === 'c.py,a.py,b.py' && failureFirst(['a.py', 'tests/test_x.py'], ['tests/test_x.py:t']).join() === 'a.py,tests/test_x.py' && failureFirst(['a.py', 'test_b.py'], ['test_b.py:t']).join() === 'a.py,test_b.py')
  check('T_nothing_changes_when_there_are_no_frames_the_target_is_already_first_or_the_frame_is_not_in_the_set', failureFirst(['a.py', 'b.py'], undefined).join() === 'a.py,b.py' && failureFirst(['a.py', 'b.py'], []).join() === 'a.py,b.py' && failureFirst(['a.py', 'b.py'], ['a.py:f']).join() === 'a.py,b.py' && failureFirst(['a.py', 'b.py'], ['z.py:f']).join() === 'a.py,b.py')
  const hardBase = await (async () => { const files = await readProjectSources(fixtureDir('c-jinja')); const byPath = new Map(files.map(file => [file.path, file.content])); return analyzeFailure(unittest(fixtureDir('c-jinja')).out, { projectFiles: files.map(file => file.path), sourceOf: rel => byPath.get(rel) ?? null }) })()
  check('T_the_original_hard_fixture_keeps_renderer_first', failureFirst(['reports/renderer.py', 'reports/money.py'], hardBase.projectFrames).join() === 'reports/renderer.py,reports/money.py', hardBase.projectFrames.join())
  const runtimeSrc = read('lib/native-builder/foundryEngineeringRuntime.ts').replace(/\r\n/g, '\n')
  check('T_the_runtime_applies_it_only_before_any_edit_and_only_to_the_implementation_roles', runtimeSrc.includes("state.mutationGeneration === 0 && state.baselineFailure && current.workingSet.length") && runtimeSrc.includes('failureFirst(current.workingSet, state.baselineFailure.frames)') && runtimeSrc.indexOf('failureFirst(current.workingSet') < runtimeSrc.indexOf("const files = (current.workingSet.length ? current.workingSet"))

  // ---- 6. oscillation: ImportError -> NameError -> ImportError (item 5)
  const trail = [failureIdentity(baselineOut), failureIdentity(unguarded.out), failureIdentity(baselineOut)].reduce<string[]>((list, item) => pushTrail(list, item), [])
  check('O_A_B_A_is_recognised_as_oscillation', isOscillating(trail) && trail.join('>') === 'ImportError:Markup>NameError:Environment>ImportError:Markup', trail.join('>'))
  check('O_A_A_B_and_A_B_C_and_short_trails_are_not_oscillation', !isOscillating(['a', 'a', 'b']) && !isOscillating(['a', 'b', 'c']) && !isOscillating(['a', 'b']) && !isOscillating([]) && pushTrail(['a'], 'a').join() === 'a' && pushTrail(undefined, '').length === 0)
  const progress: ProgressEdit = { file: RENDERER, start, end, before: TWO_NAMES, after: badAfter, fixed: 'Markup', broke: 'Environment' }
  const recovered = recoverProgress({ file: RENDERER, current: hard, progress })
  check('O_recovery_applies_the_change_that_fixed_the_first_problem_with_the_unaffected_element_kept', recovered?.content === hard.slice(0, start) + 'from jinja2 import Environment\nfrom markupsafe import Markup' + hard.slice(end) && recovered?.restored.join() === 'Environment', recovered?.restored.join() ?? 'null')
  const recoveredRun = recovered ? withCopy('c-jinja', dir => { writeFileSync(path.join(dir, RENDERER), recovered.content); return unittest(dir) }) : { code: 1, out: '' }
  check('O_the_recovered_file_really_passes_the_original_hard_fixture_tests', recoveredRun.code === 0, recoveredRun.out.trim().split('\n').slice(-1)[0])
  check('O_recovery_does_nothing_when_the_file_changed_elsewhere_or_already_holds_the_change', recoverProgress({ file: RENDERER, current: hard.replace('money', 'cash'), progress: { ...progress, start: 0, end: 5 } }) === null
    && recoverProgress({ file: RENDERER, current: hard.slice(0, start) + 'from jinja2 import Environment\nfrom markupsafe import Markup' + hard.slice(end), progress }) === null)
  // The whole bounce, with real test runs: broken -> partial -> reverted -> recovered -> green.
  const bounce = withCopy('c-jinja', dir => {
    const file = path.join(dir, RENDERER)
    const states: string[] = []
    states.push(failureIdentity(unittest(dir).out))
    writeFileSync(file, hard.slice(0, start) + badAfter + hard.slice(end)); states.push(failureIdentity(unittest(dir).out))
    writeFileSync(file, hard); states.push(failureIdentity(unittest(dir).out))
    const fixed = recoverProgress({ file: RENDERER, current: readFileSync(file, 'utf8'), progress })
    if (fixed) writeFileSync(file, fixed.content)
    const last = unittest(dir)
    return { states, green: last.code === 0, trail: states.reduce<string[]>((list, item) => pushTrail(list, item), []) }
  })
  check('O_the_real_bounce_is_detected_and_the_recovery_ends_green', isOscillating(bounce.trail) && bounce.green && bounce.states.join('>') === 'ImportError:Markup>NameError:Environment>ImportError:Markup', bounce.states.join('>'))
  const runtime = read('lib/native-builder/foundryEngineeringRuntime.ts').replace(/\r\n/g, '\n')
  check('O_the_runtime_guards_edits_before_applying_them_and_records_the_forensics', runtime.includes('guardPlannedEdit({ file: edit.file, source: onDisk, edit,') && runtime.indexOf('guardPlannedEdit({') < runtime.indexOf('const applied = await applyUniqueEdit({\n      repairId,\n      issueId,\n      file: edit.file,\n      before: edit.before,\n      after: effective.after') && runtime.includes('forensics: guarded.forensics, span: guarded.span'))
  check('O_partial_progress_and_bouncing_never_rule_the_file_out_and_use_their_own_plan_sentences', /oscillating \|\| outcome\?\.kind === 'PARTIAL_PROGRESS' \? \[\] : ineffectiveEdits\(/.test(runtime) && runtime.includes("oscillating ? 'OSCILLATION' : outcome?.kind === 'PARTIAL_PROGRESS' ? 'PARTIAL_PROGRESS'"))
  check('O_recovery_runs_at_the_top_of_the_loop_once_per_progress_edit_through_the_same_guard', runtime.includes('await recoverFromOscillation()\n    await announcePlanRevision()') && runtime.includes('state.progressEdit = null\n    state.failureTrail = []') && runtime.includes("applyModelEdit(backend, { file: progress.file"))
  const plan = read('lib/native-builder/foundryEngineeringPlan.ts')
  check('O_the_new_plan_sentences_are_plain_language', ['PARTIAL_PROGRESS', 'OSCILLATION', 'EDIT_PRESERVED', 'SECURE_DEFAULT'].every(key => new RegExp(`${key}: "[^"]*[a-z ]{20,}[^"]*"`).test(plan) && !new RegExp(`${key}: "[^"]*[A-Z_]{6,}`).test(plan)))

  // ---- 7. safer equivalent when equivalent (item 8)
  const yamlKeyword = preferSecureEquivalent({ file: 'app/settings.py', after: 'return yaml.load(text, Loader=yaml.Loader)' })
  check('S_an_unsafe_yaml_loader_is_replaced_by_the_safe_one', yamlKeyword.after === 'return yaml.load(text, Loader=yaml.SafeLoader)' && yamlKeyword.rewrites[0]?.rule === 'PARSE_DATA_WITHOUT_CODE_EXECUTION', yamlKeyword.after)
  check('S_every_unsafe_variant_maps_to_its_safe_counterpart', ['Loader', 'FullLoader', 'UnsafeLoader'].every(name => preferSecureEquivalent({ file: 'a.py', after: `yaml.load(t, Loader=yaml.${name})` }).after === 'yaml.load(t, Loader=yaml.SafeLoader)') && preferSecureEquivalent({ file: 'a.py', after: 'yaml.load(t, Loader=yaml.CLoader)' }).after === 'yaml.load(t, Loader=yaml.CSafeLoader)' && preferSecureEquivalent({ file: 'a.py', after: 'yaml.load(t, yaml.FullLoader)' }).after === 'yaml.load(t, yaml.SafeLoader)')
  check('S_code_that_is_already_safe_or_not_python_is_never_touched', ['yaml.safe_load(t)', 'yaml.load(t, Loader=yaml.SafeLoader)', 'x = 1'].every(text => preferSecureEquivalent({ file: 'a.py', after: text }).after === text) && preferSecureEquivalent({ file: 'a.js', after: 'yaml.load(t, Loader=yaml.Loader)' }).rewrites.length === 0)
  const settingsFixed = withCopy('f-config', dir => {
    writeFileSync(path.join(dir, 'app/settings.py'), `import yaml\n\n\ndef load_settings(text):\n    ${preferSecureEquivalent({ file: 'app/settings.py', after: 'return yaml.load(text, Loader=yaml.Loader)' }).after}\n`)
    writeFileSync(path.join(dir, 'app/title.py'), 'def page_title(settings):\n    from markupsafe import Markup\n\n    return Markup("<h1>{}</h1>").format(settings["title"])\n')
    return unittest(dir)
  })
  check('S_the_safer_loader_really_satisfies_the_fixture_task_so_it_is_equivalent_here', settingsFixed.code === 0, settingsFixed.out.trim().split('\n').slice(-1)[0])
  const concat = preferSecureEquivalent({ file: 'app/title.py', after: 'return Markup("<h1>" + settings["title"] + "</h1>")' })
  check('S_markup_built_by_joining_text_is_rewritten_to_format_it_so_the_text_is_escaped', concat.after === 'return Markup("<h1>{}</h1>").format(settings["title"])' && preferSecureEquivalent({ file: 'a.py', after: 'Markup("<b>" + name)' }).after === 'Markup("<b>{}").format(name)', concat.after)
  const escaped = py(os.tmpdir(), ['-c', 'from markupsafe import Markup\nprint(str(Markup("<h1>{}</h1>").format("A & B")))\nprint(str(Markup("<h1>" + "A & B" + "</h1>")))'])
  check('S_the_rewritten_form_really_escapes_where_the_joined_form_really_does_not', escaped.out.trim().split('\n').join('|') === '<h1>A &amp; B</h1>|<h1>A & B</h1>', escaped.out.trim().replace(/\n/g, '|'))
  const constructor = py(os.tmpdir(), ['-c', 'import yaml\nyaml.load("!!python/tuple [1, 2]", Loader=yaml.SafeLoader)'])
  check('S_when_the_tests_show_the_safer_form_is_not_enough_it_is_no_longer_forced', saferFormWasNotEnough(constructor.out) && /ConstructorError/.test(constructor.out) && !saferFormWasNotEnough("KeyError: 'x'") && runtime.includes('if (saferFormWasNotEnough(finding)) state.secureDefaultsOff = true') && runtime.includes('secureOff: state.secureDefaultsOff === true'), '')
  check('S_a_research_finding_about_yaml_load_carries_the_safer_option_and_others_do_not', /safe_load|SafeLoader/.test(secureHintFor('yaml', 'load')) && secureHintFor('jinja2', 'Markup') === ''
    && /safe_load/.test(researchNote({ key: 'k', text: 't', root: 'yaml', symbol: 'load', status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: 'The Loader argument became required in 6.0.', installedVersion: '6.0.3', answeredAt: 'x' }) ?? '')
    && !/safe_load/.test(researchNote({ key: 'k', text: 't', root: 'jinja2', symbol: 'Markup', status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: 'Markup moved.', installedVersion: '3.1.6', answeredAt: 'x' }) ?? ''))
  const guardSource = read('lib/native-builder/foundryEditGuard.ts')
  check('S_the_secure_default_runs_after_preservation_inside_the_same_guard_and_is_announced', guardSource.indexOf('preferSecureEquivalent({ file') > guardSource.indexOf('preserveUnaffected({ file') && runtime.includes("revisePlanFor('SECURE_DEFAULT'"))

  // ---- 8. local evidence before web (item 9)
  const csvProject = mkdtempSync(path.join(os.tmpdir(), 'foundry-p5r-csv-'))
  try {
    mkdirSync(path.join(csvProject, 'app'), { recursive: true }); mkdirSync(path.join(csvProject, 'tests'), { recursive: true })
    writeFileSync(path.join(csvProject, 'app/__init__.py'), ''); writeFileSync(path.join(csvProject, 'tests/__init__.py'), '')
    writeFileSync(path.join(csvProject, 'app/loader.py'), 'import csv\n\n\ndef load(path):\n    with open(path, newline="") as handle:\n        return [row for row in csv.DictReader(handle, rest=None)]\n')
    writeFileSync(path.join(csvProject, 'app/data.csv'), 'a,b\n1,2\n')
    writeFileSync(path.join(csvProject, 'tests/test_load.py'), 'import os, unittest\nfrom app.loader import load\n\n\nclass T(unittest.TestCase):\n    def test_load(self):\n        self.assertEqual(len(load(os.path.join(os.path.dirname(__file__), "..", "app", "data.csv"))), 1)\n')
    const csvRun = unittest(csvProject)
    const files = await readProjectSources(csvProject)
    const byPath = new Map(files.map(file => [file.path, file.content]))
    const analysis = analyzeFailure(csvRun.out, { projectFiles: files.map(file => file.path), sourceOf: rel => byPath.get(rel) ?? null })
    check('L_a_rejected_argument_on_the_standard_library_is_an_external_api_failure_with_the_argument_named', analysis.kind === 'EXTERNAL_API' && analysis.external?.root === 'csv' && analysis.external?.symbol === 'DictReader' && analysis.external?.argument === 'rest', JSON.stringify(analysis.external))
    const state = emptyTooling()
    const first = chooseNextTool({ analysis, state, codeGeneration: 1, commandsLeft: 8, codeFilesInPlay: 1 })
    check('L_the_first_tool_is_a_local_signature_probe_not_a_version_check_and_not_the_web', first.tool === 'TERMINAL' && first.probe === 'SIGNATURE' && first.root === 'csv' && first.symbol === 'DictReader', JSON.stringify(first).slice(0, 120))
    const probe = py(csvProject, ['-c', SIGNATURE_PROBE_SCRIPT, 'csv', 'DictReader'])
    const parsed = parseSignature(probe.out)
    check('L_the_real_probe_reads_what_the_installed_callable_accepts', Boolean(parsed?.signature) && parsed!.params.includes('restkey') && !parsed!.params.includes('rest'), parsed?.signature ?? probe.out.slice(0, 80))
    state.probed.push('signature:csv.DictReader')
    if (parsed) state.signatures['csv.DictReader'] = parsed
    const second = chooseNextTool({ analysis, state, codeGeneration: 1, commandsLeft: 8, codeFilesInPlay: 1 })
    check('L_once_the_signature_shows_the_argument_is_not_accepted_the_local_evidence_is_enough_and_no_web_is_used', second.tool === 'NONE' && second.reason === 'LOCAL_SUFFICIENT', JSON.stringify(second).slice(0, 120))
    const tools = [first.tool, second.tool]
    check('L_the_whole_sequence_for_this_failure_never_reads_the_web', !tools.includes('WEB'))
    const unknown = emptyTooling(); unknown.probed.push('signature:csv.DictReader'); unknown.signatures['csv.DictReader'] = { signature: null, params: [] }
    const undecided = chooseNextTool({ analysis, state: unknown, codeGeneration: 1, commandsLeft: 8, codeFilesInPlay: 1 })
    check('L_when_the_installed_library_cannot_describe_it_the_docs_route_is_still_open', undecided.tool === 'TERMINAL' && undecided.probe === 'VERSION', JSON.stringify(undecided).slice(0, 100))
    const missing = py(csvProject, ['-c', SIGNATURE_PROBE_SCRIPT, 'csv', 'NoSuchThing'])
    check('L_a_symbol_that_does_not_exist_gives_no_signature_instead_of_an_error', parseSignature(missing.out)?.signature === null, missing.out.trim().slice(0, 80))
  } finally { rmSync(csvProject, { recursive: true, force: true }) }
  const yamlAnalysis = await (async () => {
    const files = await readProjectSources(fixtureDir('f-config'))
    const byPath = new Map(files.map(file => [file.path, file.content]))
    return analyzeFailure(py(fixtureDir('f-config'), ['-m', 'unittest', 'discover', '-s', 'tests']).out, { projectFiles: files.map(file => file.path), sourceOf: rel => byPath.get(rel) ?? null })
  })()
  const yamlFirst = chooseNextTool({ analysis: yamlAnalysis, state: emptyTooling(), codeGeneration: 1, commandsLeft: 8, codeFilesInPlay: 1 })
  check('L_a_missing_required_argument_still_goes_to_the_docs_because_the_signature_cannot_say_what_to_pass', yamlAnalysis.kind === 'EXTERNAL_API' && !(yamlFirst.tool === 'TERMINAL' && yamlFirst.probe === 'SIGNATURE') && yamlFirst.tool === 'TERMINAL' && yamlFirst.probe === 'VERSION', JSON.stringify(yamlFirst).slice(0, 100))
  const toolSource = read('lib/native-builder/foundryToolReasoning.ts')
  check('L_the_probe_script_is_fixed_takes_two_identifiers_and_holds_nothing_from_the_project', /import sys, json, importlib, inspect/.test(SIGNATURE_PROBE_SCRIPT) && !/\$\{|`/.test(SIGNATURE_PROBE_SCRIPT) && /IDENT\.test\(ext\.root\) \|\| !IDENT\.test\(ext\.symbol\)/.test(toolSource))
  check('L_an_older_campaign_record_without_signatures_is_restored_safely', Object.keys(restoreTooling({ receipts: [], searched: { discovered: true, expansions: 0 } }).signatures).length === 0 && runtime.includes('|| !state.tooling.signatures) state.tooling = restoreTooling'))
  check('L_the_runtime_runs_the_probe_through_the_governed_command_path_and_records_a_receipt', runtime.includes("['-c', SIGNATURE_PROBE_SCRIPT, lib, symbol]") && runtime.includes('<signature probe>') && runtime.includes("next.probe === 'SIGNATURE'"))

  // ---- 9. the mission start contract and sequential starts (item 6)
  check('M_a_page_inside_a_session_never_offers_a_new_project_even_when_its_own_workspace_view_is_missing', planStartWorkspace({ workspaceId: null, sessionWorkspaceId: null, sessionId: 's1' }).kind === 'FROM_SESSION'
    && planStartWorkspace({ workspaceId: null, sessionWorkspaceId: 'w9', sessionId: 's1' }).kind === 'USE' && planStartWorkspace({ workspaceId: 'w1', sessionWorkspaceId: 'w9', sessionId: 's1' }).kind === 'USE'
    && planStartWorkspace({ workspaceId: null, sessionWorkspaceId: null, sessionId: null }).kind === 'OFFER_PROJECT')
  const at = '2026-09-26T12:00:00.000Z'
  const outcomes: StartStatus[] = [
    classifyStartResponse({ response: { ok: true, status: 200, data: { mission: { id: 'm1' } } }, sessionId: 's1', at }),
    classifyStartResponse({ response: { ok: true, status: 200, data: {} }, sessionId: 's1', at }),
    classifyStartResponse({ response: { ok: false, status: 409, json: { needsConfirmation: true, reason: 'War Room itself' } }, sessionId: 's1', at }),
    classifyStartResponse({ response: { ok: false, status: 404, error: 'Session not found.' }, sessionId: 's1', at }),
    classifyStartResponse({ response: { ok: false, error: 'fetch failed' }, sessionId: 's1', at }),
  ]
  check('M_every_server_answer_is_exactly_one_typed_outcome', outcomes.map(item => item.state === 'FAILED' ? item.reason : item.state).join() === 'ACKNOWLEDGED,NO_MISSION_RETURNED,NEEDS_WORKSPACE_CONFIRMATION,START_REJECTED,NETWORK', outcomes.map(item => item.state).join())
  check('M_an_acknowledgement_always_carries_a_real_session_and_mission_id_and_a_failure_always_carries_a_reason', outcomes[0].state === 'ACKNOWLEDGED' && outcomes[0].sessionId === 's1' && outcomes[0].missionId === 'm1' && outcomes.filter(item => item.state === 'FAILED').every(item => START_FAILURE_REASONS.includes((item as Extract<StartStatus, { state: 'FAILED' }>).reason)))
  const attrs = outcomes.map(startStatusAttributes)
  check('M_the_status_attributes_let_a_waiting_script_read_the_result_instead_of_guessing_with_a_timer', attrs[0]['data-state'] === 'acknowledged' && attrs[0]['data-session-id'] === 's1' && attrs[0]['data-mission-id'] === 'm1' && attrs[2]['data-state'] === 'failed' && attrs[2]['data-reason'] === 'needs_workspace_confirmation' && startStatusAttributes(requested(at))['data-state'] === 'requested')
  check('M_the_sentences_are_plain_and_never_contain_a_code', [...outcomes, failed('NEEDS_PROJECT', at), failed('EMPTY_REQUEST', at), requested(at)].every(item => startStatusSentence(item).length > 5 && !/[A-Z_]{6,}|HTTP|undefined|null/.test(startStatusSentence(item))))
  // Sequential sessions, deterministically: after a blocked mission, after a resolved one, after a restart dropped the workspace, and while the session is still loading.
  const scenarios: { name: string; page: { workspaceId: string | null; sessionWorkspaceId: string | null; sessionId: string | null } }[] = [
    { name: 'after a blocked mission', page: { workspaceId: null, sessionWorkspaceId: 'w1', sessionId: 's1' } },
    { name: 'after a resolved mission', page: { workspaceId: 'w1', sessionWorkspaceId: 'w1', sessionId: 's1' } },
    { name: 'after a restart dropped the workspace from the address', page: { workspaceId: null, sessionWorkspaceId: null, sessionId: 's1' } },
    { name: 'while the session is still loading', page: { workspaceId: null, sessionWorkspaceId: null, sessionId: 's1' } },
  ]
  const started = scenarios.map(scenario => ({ scenario, plan: planStartWorkspace(scenario.page) }))
  check('M_sequential_starts_after_blocked_resolved_restart_and_late_loading_all_go_to_the_existing_session', started.every(item => item.plan.kind !== 'OFFER_PROJECT'), started.map(item => `${item.scenario.name}: ${item.plan.kind}`).join(' | '))
  const shell = read('components/war-room/foundry/FoundryShell.tsx').replace(/\r\n/g, '\n')
  check('M_the_shell_no_longer_creates_a_project_for_a_page_that_is_inside_a_session', shell.includes('if (!workspace && !sessionId) {') && shell.includes('planStartWorkspace({ workspaceId, sessionWorkspaceId: session?.workspaceId ?? null, sessionId })') && !/const boundWorkspace = workspaceId \?\? session\?\.workspaceId \?\? null\n    if \(!boundWorkspace && !projectOffer\)/.test(shell))
  check('M_every_exit_of_the_send_path_sets_a_typed_status', ['EMPTY_REQUEST', 'NEEDS_WORKSPACE_CONFIRMATION', 'NEEDS_PROJECT', 'PROJECT_CREATE_FAILED', 'SESSION_CREATE_FAILED'].every(reason => shell.includes(`startFailed('${reason}'`)) && shell.includes('classifyStartResponse({ response: result, sessionId: activeSession') && (shell.match(/setStartStatus\(startRequested\(/g) ?? []).length === 2 && shell.includes('data-testid="foundry-start-status"'))
  const route = read('app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts')
  check('M_the_server_resolves_the_workspace_from_the_persisted_session_so_a_client_without_one_still_starts', /const existing = await getFoundrySession\(id\)\n  const workspaceId = existing\?\.workspaceId \|\| requestedWorkspaceId/.test(route.replace(/\r\n/g, '\n')))

  // ---- 9b. the REAL cause of "the second mission never started": the same request again was merged into the earlier issue and create() threw (an empty 500)
  const storeRoot = mkdtempSync(path.join(os.tmpdir(), 'foundry-p5r-store-'))
  const savedRepoRoot = process.env.REPO_ROOT
  process.env.REPO_ROOT = storeRoot
  try {
    const ask = issueFromCommanderReport({ title: 'Make bold text safe to embed in the report renderer', description: 'Make bold text safe to embed in the report renderer', subsystem: 'project', severity: 'medium' })
    const setState = async (id: string, state: string, updatedAt?: string) => { const record = await getRepair(id); if (record) await saveRepair({ ...record, state: state as never, updatedAt: updatedAt ?? new Date().toISOString() }) }
    const first = await reportIssue(ask, { commanderRequested: true })
    check('Q_the_first_request_opens_a_repair', Boolean(first.repair?.id), first.repair?.id?.slice(0, 8))
    let running: unknown = null
    try { await reportIssue(ask, { commanderRequested: true }) } catch (error) { running = error }
    check('Q_the_same_request_while_the_first_is_genuinely_running_is_refused_with_a_typed_error_naming_it', running instanceof MissionAlreadyRunningError && running.repairId === first.repair?.id && running.code === 'MISSION_ALREADY_RUNNING')
    check('Q_callers_that_are_not_a_commander_asking_for_work_keep_the_old_behaviour_exactly', (await reportIssue(ask)).repair === null)
    await setState(first.repair!.id, 'resolved')
    const afterResolved = await reportIssue(ask, { commanderRequested: true })
    check('Q_the_same_request_after_a_resolved_mission_starts_a_new_one', Boolean(afterResolved.repair) && afterResolved.repair!.id !== first.repair!.id && afterResolved.issue.id === first.issue.id, afterResolved.repair?.id?.slice(0, 8))
    await setState(afterResolved.repair!.id, 'blocked')
    const afterBlocked = await reportIssue(ask, { commanderRequested: true })
    check('Q_the_same_request_after_a_blocked_mission_starts_a_new_one', Boolean(afterBlocked.repair) && afterBlocked.repair!.id !== afterResolved.repair!.id)
    await setState(afterBlocked.repair!.id, 'cancelled')
    const afterCancelled = await reportIssue(ask, { commanderRequested: true })
    check('Q_the_same_request_after_a_cancelled_mission_starts_a_new_one', Boolean(afterCancelled.repair) && afterCancelled.repair!.id !== afterBlocked.repair!.id)
    await setState(afterCancelled.repair!.id, 'planning', new Date(Date.now() - IN_FLIGHT_REPAIR_WINDOW_MS - 60_000).toISOString())
    const afterOrphan = await reportIssue(ask, { commanderRequested: true })
    check('Q_a_repair_left_in_a_working_state_long_ago_is_an_orphan_and_does_not_block_a_new_start', Boolean(afterOrphan.repair) && afterOrphan.repair!.id !== afterCancelled.repair!.id)
    const other = await reportIssue(issueFromCommanderReport({ title: 'Round shipping fees up', description: 'Round shipping fees up to the next whole euro', subsystem: 'project', severity: 'medium' }), { commanderRequested: true })
    check('Q_a_different_request_is_unaffected_by_all_of_this', Boolean(other.repair) && other.issue.id !== first.issue.id)
  } finally { if (savedRepoRoot === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = savedRepoRoot; rmSync(storeRoot, { recursive: true, force: true }) }
  const routeSource = read('app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts').replace(/\r\n/g, '\n')
  check('Q_the_start_route_answers_a_typed_409_for_a_running_mission_and_a_typed_body_for_any_other_failure_never_an_empty_500', /error instanceof MissionAlreadyRunningError/.test(routeSource) && /code: 'MISSION_ALREADY_RUNNING', missionId: error\.repairId \}, \{ status: 409 \}/.test(routeSource) && /code: 'START_FAILED' \}, \{ status: 500 \}/.test(routeSource))
  check('Q_the_engineering_strategy_asks_for_a_commander_start_only_for_bounded_coding', /reportIssue\(input, \{ commanderRequested: request\.executionMode === 'bounded_coding' \}\)/.test(read('lib/mission-runtime/engineeringStrategy.ts')))
  const already = classifyStartResponse({ response: { ok: false, status: 409, json: { code: 'MISSION_ALREADY_RUNNING', missionId: 'abc' }, error: 'x' }, sessionId: 's1', at })
  check('Q_the_page_reads_a_running_mission_as_its_own_typed_outcome_with_the_mission_to_open', already.state === 'FAILED' && already.reason === 'ALREADY_RUNNING' && already.detail === 'abc' && /already being worked on/.test(startStatusSentence(already)) && START_FAILURE_REASONS.includes('ALREADY_RUNNING'))
  check('Q_the_shell_opens_the_running_mission_instead_of_showing_an_error', shell.includes("outcome.reason === 'ALREADY_RUNNING' && outcome.detail"))

  // ---- 10. the sandbox ownership explanation (item 10)
  const helperScript = read('desktop/workbench-host/prepare-linux-chrome-sandbox.cjs')
  check('X_the_only_privilege_paths_are_sudo_n_then_pkexec_and_the_sandbox_is_never_disabled', /method: 'sudo-n'/.test(helperScript) && /method: 'pkexec'/.test(helperScript) && !/--no-sandbox|CHROME_DEVEL_SANDBOX|DISABLE_RENDERER_SANDBOX/.test(helperScript) && /native = process.platform === 'linux' && suid && rootOwned/.test(helperScript))
  check('X_without_authorization_it_stops_with_the_exact_operator_command_instead_of_continuing_silently', /method: 'operator-sudo-required'/.test(helperScript) && /operatorCommand: before.operatorCommand/.test(helperScript))
  check('X_the_installer_writes_the_outcome_next_to_the_install', /LINUX_CHROME_SANDBOX\.json/.test(read('lib/native-builder/installerTool.ts')) && /prepare\.applyHelper\(path\.join\(appTreeDest, 'chrome-sandbox'\)\)/.test(read('lib/native-builder/installerTool.ts')))
  check('X_the_desktop_build_step_uses_the_same_helper', /applyHelper|prepare/.test(read('desktop/scripts/after-pack-linux-sandbox.cjs')))
  const explained = {
    pkexec: explainSandboxInstall({ ok: true, applied: true, method: 'pkexec', inspect: { uid: 0, mode: '4755', rootOwned: true } }),
    sudo: explainSandboxInstall({ ok: true, applied: true, method: 'sudo-n', inspect: { uid: 0, mode: '4755', rootOwned: true } }),
    already: explainSandboxInstall({ ok: true, applied: false, method: 'already', inspect: { uid: 0, mode: '4755', rootOwned: true } }),
    operator: explainSandboxInstall({ ok: false, method: 'operator-sudo-required', operatorCommand: 'sudo chown root:root "/x" && sudo chmod 4755 "/x"', inspect: { uid: 1000, mode: '4755', rootOwned: false } }),
    unknown: explainSandboxInstall({}),
  }
  check('X_each_way_the_helper_became_root_owned_has_its_own_plain_explanation', explained.pkexec.native && /desktop for authorization/.test(explained.pkexec.sentence) && explained.sudo.native && /already active/.test(explained.sudo.sentence) && explained.already.native && !explained.operator.native && /Run once: sudo chown/.test(explained.operator.sentence) && !explained.unknown.native && /should be checked/.test(explained.unknown.sentence))
  check('X_a_record_claiming_success_without_a_root_owned_setuid_helper_is_not_believed', !explainSandboxInstall({ ok: true, method: 'pkexec', inspect: { uid: 1000, mode: '755', rootOwned: false } }).native)
  const opt = path.join(os.homedir(), '.local', 'opt')
  const installs = existsSync(opt) ? readdirSync(opt).filter(name => /foundry-eng-/.test(name)) : []
  const recordsChecked = installs.flatMap(name => {
    const file = path.join(opt, name, 'LINUX_CHROME_SANDBOX.json')
    if (!existsSync(file)) return []
    const record = JSON.parse(readFileSync(file, 'utf8')) as { ok?: boolean; method?: string; inspect?: { rootOwned?: boolean; mode?: string } }
    const helper = path.join(opt, name, 'opt', 'War-Room-OS', 'chrome-sandbox')
    return [{ name, methodKnown: (SANDBOX_METHODS as readonly string[]).includes(record.method ?? ''), consistent: record.ok !== true || (record.inspect?.rootOwned === true && record.inspect?.mode === '4755'), explained: explainSandboxInstall(record as never).sentence.length > 20, helperExists: existsSync(helper) }]
  })
  check('X_every_installed_runtime_has_a_known_method_and_a_record_that_matches_its_claim', recordsChecked.length === 0 || recordsChecked.every(item => item.methodKnown && item.consistent && item.explained), recordsChecked.map(item => `${item.name.replace(/.*foundry-eng-/, '')}:${item.methodKnown && item.consistent ? 'ok' : 'BAD'}`).join(' '))
  const doc = read('docs/FOUNDRY_LINUX_SANDBOX_INSTALL.md')
  check('X_the_mechanism_is_documented_including_the_short_lived_polkit_approval_and_the_record_file', /pkexec/.test(doc) && /sudo -n/.test(doc) && /short-lived/.test(doc) && /LINUX_CHROME_SANDBOX\.json/.test(doc) && /operator-sudo-required/.test(doc))

  // ---- 11. nothing from before is undone
  const tooling = read('lib/native-builder/foundryToolReasoning.ts')
  check('K_the_earlier_repairs_are_still_in_place', /export function mergeResearchNote/.test(tooling) && /export function relativizeProjectPaths/.test(tooling) && runtime.includes('mergeResearchNote(tooling.notes, note, question.root, TOOL_LIMITS.notes)') && runtime.includes('traceNotes(trace, [root, await realpath(root)'))
  check('K_no_fixture_holds_bytecode_after_this_run', !readdirSync(fixtureDir('c-jinja'), { recursive: true }).some(file => String(file).endsWith('.pyc') || String(file).includes('__pycache__')))

  const failed_ = results.filter(item => !item.pass)
  console.log(`EDIT_REPAIR_VALIDATION ${failed_.length ? 'FAIL' : 'PASS'} ${results.length - failed_.length}/${results.length}`)
  if (failed_.length) process.exit(1)
}
main()
