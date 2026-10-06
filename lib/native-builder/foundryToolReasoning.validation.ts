/**
 * Phase 5 - tool depth and agentic research. Pure checks of the tool-choice, evidence, source-weighing and research-budget logic, real runs of the fixed
 * terminal probes against the committed fixtures, an offline research loop with canned sources, memory integration, and textual assertions on the runtime
 * wiring. Live behaviour is proven by the Phase 5 live proofs.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildIndex, discoverContext } from './foundryProjectContext'
import { readProjectSources } from './foundryProjectContextIO'
import {
  CALL_TRACE_SCRIPT,
  PACKAGE_PROBE_SCRIPT,
  TOOL_LIMITS,
  VERSION_PROBE_SCRIPT,
  analyzeFailure,
  chooseNextTool,
  describeClaim,
  describeReceipt,
  emptyTooling,
  extractClaims,
  implicationOf,
  isRepeat,
  isSafeQuery,
  looksInternal,
  makeReceipt,
  pageText,
  parseInstalled,
  parsePackage,
  parseTrace,
  pushReceipt,
  questionFor,
  replacementPackage,
  researchNote,
  researchVerdict,
  restoreTooling,
  safeQueryFor,
  say,
  searchReceipts,
  sourcePlan,
  tierOf,
  traceFiles,
  traceNotes,
  relativizeProjectPaths,
  mergeResearchNote,
  weighClaims,
  type FailureAnalysis,
  type InstalledInfo,
  type SourcedClaim,
} from './foundryToolReasoning'
import { answerFromMemory, changelogFromListing, readLocalNotes, researchQuestion, type ResearchDeps } from './foundryToolReasoningIO'
import {
  checkWriteEligibility,
  emptyStore,
  findResearchMemory,
  makeIdentity,
  mergeMemories,
  researchMemoriesFromMission,
  retrieveMemories,
  revalidateResearch,
  revalidateStore,
} from './foundryProjectMemory'
import { plainOutputEnv } from './foundryEngineeringRuntime'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const repo = resolveRepoRoot()
const FIXTURES = 'lib/native-builder/__fixtures__/foundry-phase5'
const fixtureDir = (name: string) => path.join(repo, FIXTURES, name)
const AT = '2026-09-26T12:00:00.000Z'
const LATER = '2026-09-27T12:00:00.000Z'
const MUCH_LATER = '2026-11-20T12:00:00.000Z'
const env = { ...plainOutputEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }

function py(cwd: string, args: string[], extraEnv: Record<string, string> = {}): { code: number | null; out: string } {
  const r = spawnSync('python3', args, { cwd, encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 60_000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const unittestOutput = (name: string) => py(fixtureDir(name), ['-m', 'unittest', 'discover', '-s', 'tests']).out

async function analysisOf(name: string, raw: string): Promise<FailureAnalysis> {
  const files = await readProjectSources(fixtureDir(name))
  const byPath = new Map(files.map(file => [file.path, file.content]))
  return analyzeFailure(raw, { projectFiles: files.map(file => file.path), sourceOf: rel => byPath.get(rel) ?? null })
}

const INFO_JINJA: InstalledInfo = {
  root: 'jinja2', python: '3.14.4', stdlib: false, dist: 'Jinja2', version: '3.1.6',
  urls: [{ label: 'Changes', url: 'https://jinja.palletsprojects.com/changes/' }, { label: 'Documentation', url: 'https://jinja.palletsprojects.com/' }, { label: 'Source', url: 'https://github.com/pallets/jinja/' }],
}
const INFO_YAML: InstalledInfo = {
  root: 'yaml', python: '3.14.4', stdlib: false, dist: 'PyYAML', version: '6.0.3',
  urls: [{ label: 'Documentation', url: 'https://pyyaml.org/wiki/PyYAMLDocumentation' }, { label: 'Source Code', url: 'https://github.com/yaml/pyyaml' }],
}
const INFO_STDLIB: InstalledInfo = { root: 'unittest', python: '3.14.4', stdlib: true, dist: null, version: null, urls: [] }

const JINJA_CHANGES = ['Version 3.1.6', '', 'Released 2025-03-05', '', '- The attr filter does not bypass the environment sandbox.', '', 'Version 3.1.0', '', 'Released 2022-03-24', '', '- Drop support for Python 3.6.', '- Remove previously deprecated code.', '', '  - The first argument to template filters is passed positionally.', '  - Markup and escape should be imported from MarkupSafe.', '  - Compiled templates from very old Jinja versions may need to be recompiled.', '', 'Version 3.0.1', '', '- Fixed calling deprecated jinja2.Markup without an argument. Use markupsafe.Markup instead.'].join('\n')
const YAML_CHANGES = ['7.0.0.dev0 (TBD)', '', '* TBD', '', '6.0.1 (2023-07-18)', '', '* pin Cython build dep to < 3.0', '', '6.0 (2021-10-13)', '', '* https://github.com/yaml/pyyaml/pull/550 -- drop Python 2.7', '* https://github.com/yaml/pyyaml/pull/561 -- always require `Loader` arg to `yaml.load()`', '* https://github.com/yaml/pyyaml/pull/564 -- remove remaining direct distutils usage', '', '5.4.1 (2021-01-20)', '', '* Fix stub compat'].join('\n')
const WHATSNEW_313 = ['Removed', '', 'unittest', '', 'Remove the following unittest functions, deprecated in Python 3.11:', '', 'unittest.findTestCases()', '', 'unittest.makeSuite()', '', 'unittest.getTestCaseNames()'].join('\n')
const NOISE = ['Loader.peek_token() returns the next token in the stream, but does not remove it from the internal token queue.', 'Loader.get_token() returns the next token and removes it from the queue.', 'yaml.load(stream, Loader=yaml.FullLoader) parses the first YAML document.'].join('\n')
const NOTE_WRONG = '- `from jinja2 import Markup` still works in every Jinja 3.x release. It was only removed in Jinja 3.2, so nothing needs to change until we upgrade past 3.1.'

function claimsFor(root: string, symbol: string, text: string, opts: { argument?: string; pageVersion?: string } = {}) {
  const question = questionFor({ kind: 'EXTERNAL_API', exception: 'X', message: '', external: { root, symbol, argument: opts.argument ?? null, detail: opts.argument ? 'SIGNATURE' : 'MISSING_IMPORT' }, projectFrames: [], projectFileCount: 1, testId: null, importFailure: false, missing: null, key: 'k' }, INFO_JINJA)!
  return { question, claims: extractClaims(text, question.terms, { pageVersion: opts.pageVersion ?? null, groups: question.groups }) }
}

function sourced(claim: ReturnType<typeof extractClaims>[number], url: string, tier: SourcedClaim['tier'], label = 'source'): SourcedClaim {
  return { ...claim, url, tier, label, fetchedAt: AT }
}

function fakeDeps(pages: Record<string, string>, extra: Partial<ResearchDeps> = {}): { deps: ResearchDeps; fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    deps: {
      fetchText: async url => { fetched.push(url); return url in pages ? { ok: true, status: 200, text: pages[url] } : { ok: false, status: 404, error: 'HTTP 404' } },
      localNotes: async () => [],
      now: () => AT,
      ...extra,
    },
  }
}

async function main() {
  // ---- 1. reading a failure: which kind of problem is it, and is it about something outside the project?
  const jinjaOut = unittestOutput('c-jinja')
  const jinja = await analysisOf('c-jinja', jinjaOut)
  check('A_a_library_import_that_no_longer_exists_is_an_external_question', jinja.kind === 'EXTERNAL_API' && jinja.external?.root === 'jinja2' && jinja.external.symbol === 'Markup' && jinja.external.detail === 'MISSING_IMPORT', JSON.stringify(jinja.external))
  const yamlOut = unittestOutput('f-config')
  const yamlA = await analysisOf('f-config', yamlOut)
  check('A_a_call_the_library_rejects_is_an_external_question_found_from_the_call_site', yamlA.kind === 'EXTERNAL_API' && yamlA.external?.root === 'yaml' && yamlA.external.symbol === 'load' && yamlA.external.argument === 'Loader' && yamlA.external.detail === 'SIGNATURE', JSON.stringify(yamlA.external))
  const prices = await analysisOf('a-prices', unittestOutput('a-prices'))
  check('A_a_runtime_error_inside_project_code_is_local_and_names_the_test_to_trace', prices.kind === 'LOCAL_RUNTIME' && prices.exception === 'KeyError' && prices.testId === 'test_cart.CartTests.test_total_uses_the_catalog_prices' && prices.external === null, `${prices.kind} ${prices.testId}`)
  const loyalty = await analysisOf('b-loyalty', unittestOutput('b-loyalty'))
  check('A_a_wrong_value_is_a_local_value_failure', loyalty.kind === 'LOCAL_VALUE' && loyalty.exception === 'AssertionError' && loyalty.external === null, loyalty.kind)
  const local = await analysisOf('d-local', unittestOutput('d-local'))
  check('A_the_purely_local_bug_names_no_external_module', local.kind === 'LOCAL_VALUE' && local.external === null && local.projectFrames.length === 0, local.kind)
  const synthetic = (message: string, exception = 'AttributeError') => analyzeFailure(`Traceback (most recent call last):\n  File "/p/tests/test_x.py", line 3, in test_a\n    thing()\n${exception}: ${message}\n`, { projectFiles: ['app/core.py', 'tests/test_x.py'], sourceOf: () => null })
  check('A_a_missing_name_inside_the_project_is_a_project_symbol_problem', synthetic("name 'total' is not defined", 'NameError').kind === 'LOCAL_SYMBOL' && synthetic("cannot import name 'x' from 'app.core'", 'ImportError').kind === 'LOCAL_SYMBOL' && synthetic("module 'app' has no attribute 'go'").kind === 'LOCAL_SYMBOL', '')
  const stdlib = synthetic("module 'inspect' has no attribute 'getargspec'")
  check('A_a_missing_standard_library_name_is_an_external_question', stdlib.kind === 'EXTERNAL_API' && stdlib.external?.root === 'inspect' && stdlib.external.symbol === 'getargspec', JSON.stringify(stdlib.external))
  const missing = synthetic("No module named 'zzqq'", 'ModuleNotFoundError')
  check('A_a_missing_package_is_recognised_and_named', missing.kind === 'MISSING_PACKAGE' && missing.missing === 'zzqq', missing.kind)
  check('A_identical_failures_share_a_key_and_different_ones_do_not', jinja.key === (await analysisOf('c-jinja', jinjaOut)).key && jinja.key !== yamlA.key && prices.key !== loyalty.key, '')
  const colour = await analysisOf('c-jinja', jinjaOut.replace(/^(ImportError)/m, '\u001b[1;35m$1\u001b[0m'))
  check('A_terminal_colour_codes_do_not_hide_the_failure', colour.kind === 'EXTERNAL_API' || jinja.kind === 'EXTERNAL_API', '')

  // ---- 2. the next tool follows the evidence
  const fresh = emptyTooling()
  const first = chooseNextTool({ analysis: jinja, state: fresh, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
  check('B_a_library_failure_first_asks_which_version_is_installed', first.tool === 'TERMINAL' && first.probe === 'VERSION' && /version/.test(first.say), first.tool)
  const withInfo = emptyTooling()
  withInfo.installed.jinja2 = INFO_JINJA
  const second = chooseNextTool({ analysis: jinja, state: withInfo, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
  check('B_then_it_reads_the_official_notes_for_that_version', second.tool === 'WEB' && second.question.root === 'jinja2' && second.question.key.includes('3.1.6') && /docs and release notes/.test(second.say), second.tool)
  const answeredState = emptyTooling()
  answeredState.installed.jinja2 = INFO_JINJA
  if (second.tool === 'WEB') answeredState.questions.push({ key: second.question.key, text: second.question.text, root: 'jinja2', symbol: 'Markup', status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: 'x', installedVersion: '3.1.6', answeredAt: AT })
  const third = chooseNextTool({ analysis: jinja, state: answeredState, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
  check('B_once_answered_it_goes_back_to_coding_and_never_researches_the_same_question_again', third.tool === 'NONE' && third.reason === 'RETURN_TO_CODING', third.tool)
  const noCommands = chooseNextTool({ analysis: jinja, state: fresh, codeGeneration: 0, commandsLeft: 0, codeFilesInPlay: 2 })
  check('B_without_command_budget_no_probe_is_started', noCommands.tool === 'NONE' && noCommands.reason === 'BUDGET', noCommands.tool)
  const probedOnce = emptyTooling()
  probedOnce.probed.push('version:jinja2')
  check('B_a_probe_that_already_ran_is_not_repeated', chooseNextTool({ analysis: jinja, state: probedOnce, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'NONE', '')
  const traceNeeded = chooseNextTool({ analysis: prices, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
  check('B_a_runtime_error_in_project_code_is_traced_because_the_source_does_not_show_the_values', traceNeeded.tool === 'TERMINAL' && traceNeeded.probe === 'CALL_TRACE' && /data/.test(traceNeeded.say), traceNeeded.tool)
  const valueMany = chooseNextTool({ analysis: loyalty, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 3 })
  const valueOne = chooseNextTool({ analysis: local, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 })
  check('B_a_wrong_value_across_several_files_is_traced_but_one_file_is_answered_by_the_source', valueMany.tool === 'TERMINAL' && valueMany.probe === 'CALL_TRACE' && valueOne.tool === 'NONE' && valueOne.reason === 'LOCAL_SUFFICIENT', `${valueMany.tool}/${valueOne.tool}`)
  const traced = emptyTooling()
  traced.traced.push(`${prices.key}@0`)
  check('B_the_same_failure_on_the_same_code_is_never_traced_twice_but_changed_code_may_be', chooseNextTool({ analysis: prices, state: traced, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'NONE' && chooseNextTool({ analysis: prices, state: traced, codeGeneration: 1, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'TERMINAL', '')
  const many = emptyTooling()
  many.traced.push('a@0', 'b@1', 'c@2')
  check('B_traces_are_bounded_per_mission', chooseNextTool({ analysis: prices, state: many, codeGeneration: 9, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'NONE', '')
  check('B_a_project_symbol_problem_uses_the_context_engine_not_the_web', chooseNextTool({ analysis: synthetic("name 'total' is not defined", 'NameError'), state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'PROJECT_SEARCH', '')
  const pkg = chooseNextTool({ analysis: missing, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
  check('B_a_missing_package_checks_what_the_installed_package_is_called_before_giving_up', pkg.tool === 'TERMINAL' && pkg.probe === 'PACKAGE' && pkg.name === 'zzqq', pkg.tool)
  const pkgDone = emptyTooling()
  pkgDone.probed.push('package:zzqq')
  check('B_and_then_stops_instead_of_looping', chooseNextTool({ analysis: missing, state: pkgDone, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 }).tool === 'NONE', '')
  const sequence = (() => {
    const state = emptyTooling()
    const steps: string[] = []
    for (let i = 0; i < 6; i += 1) {
      const next = chooseNextTool({ analysis: jinja, state, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 2 })
      steps.push(next.tool === 'TERMINAL' ? `TERMINAL:${next.probe}` : next.tool)
      if (next.tool === 'TERMINAL' && next.probe === 'VERSION') { state.probed.push('version:jinja2'); state.installed.jinja2 = INFO_JINJA }
      else if (next.tool === 'WEB') state.questions.push({ key: next.question.key, text: '', root: 'jinja2', symbol: 'Markup', status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: null, installedVersion: '3.1.6', answeredAt: AT })
      else break
    }
    return steps.join('>')
  })()
  check('B_the_whole_sequence_for_a_library_failure_is_version_then_docs_then_code', sequence === 'TERMINAL:VERSION>WEB>NONE', sequence)

  // ---- 3. terminal depth: the fixed probes really run and tell what the source alone cannot
  const trace = parseTrace(py(fixtureDir('a-prices'), ['-c', CALL_TRACE_SCRIPT, 'test_cart.CartTests.test_total_uses_the_catalog_prices']).out)
  check('C_the_trace_shows_where_it_failed_and_the_real_values_in_scope', Boolean(trace?.failure) && trace!.failure!.type === 'KeyError' && trace!.failure!.at?.startsWith('prices/loader.py:load_prices') === true && /ufeff/.test(JSON.stringify(trace!.failure!.locals)), JSON.stringify(trace?.failure?.locals).slice(0, 120))
  const notes = trace ? traceNotes(trace) : []
  check('C_the_notes_for_the_editor_carry_the_evidence_in_plain_bounded_lines', notes.join('\n').length <= TOOL_LIMITS.traceChars && /KeyError/.test(notes[0] ?? '') && notes.some(line => /load_prices/.test(line)), notes[0])
  check('C_the_files_the_trace_ran_through_are_named_for_the_working_set', trace ? traceFiles(trace).includes('prices/loader.py') && traceFiles(trace).includes('prices/cart.py') : false, trace ? traceFiles(trace).join() : '')
  const value = parseTrace(py(fixtureDir('b-loyalty'), ['-c', CALL_TRACE_SCRIPT, 'test_pricing.PricingTests.test_gold_members_get_ten_percent_from_one_thousand_points']).out)
  check('C_a_wrong_value_shows_what_each_function_returned', Boolean(value) && value!.calls.some(call => call.at.startsWith('store/loyalty.py:tier_for') && /silver/.test(call.returned)), value ? value.calls.map(call => `${call.at}->${call.returned}`).join(' | ').slice(0, 160) : 'no trace')
  const secretProject = mkdtempSync(path.join(os.tmpdir(), 'foundry-p5-secret-'))
  try {
    mkdirSync(path.join(secretProject, 'tests'), { recursive: true })
    mkdirSync(path.join(secretProject, 'app'), { recursive: true })
    writeFileSync(path.join(secretProject, 'app', '__init__.py'), '')
    writeFileSync(path.join(secretProject, 'tests', '__init__.py'), '')
    writeFileSync(path.join(secretProject, 'app', 'auth.py'), 'def login(user, password):\n    token = "sk-FAKEfakefakefakefake0123"\n    raise KeyError(user)\n')
    writeFileSync(path.join(secretProject, 'tests', 'test_auth.py'), 'import unittest\nfrom app.auth import login\n\n\nclass T(unittest.TestCase):\n    def test_login(self):\n        login("ann", "hunter2-FAKE")\n')
    const out = py(secretProject, ['-c', CALL_TRACE_SCRIPT, 'test_auth.T.test_login'], { SECRET_TOKEN: 'FAKE-ENV-SECRET-42' }).out
    const parsed = parseTrace(out)
    const text = parsed ? traceNotes(parsed).join('\n') : ''
    check('C_values_named_like_secrets_are_hidden_and_the_environment_is_never_printed', Boolean(parsed) && !/hunter2|FAKE-ENV-SECRET|sk-FAKE/.test(text + out) && /hidden/.test(text), text.slice(0, 160))
  } finally { rmSync(secretProject, { recursive: true, force: true }) }
  // the project folder never reaches the editor's notes or the record, the project-relative identity stays, and lookalike sibling folders are left alone
  check('C_the_project_folder_is_dropped_from_paths_and_the_relative_name_stays', relativizeProjectPaths('KeyError: /home/me/shop/app/data.csv (in /home/me/shop)', ['/home/me/shop']) === 'KeyError: app/data.csv (in .)')
  check('C_a_sibling_folder_that_shares_the_prefix_is_not_mangled', relativizeProjectPaths('/home/me/shop2/app/x.py and /home/me/shop-old', ['/home/me/shop']) === '/home/me/shop2/app/x.py and /home/me/shop-old')
  check('C_the_link_spelling_of_the_folder_is_dropped_too_and_windows_separators_are_handled', relativizeProjectPaths('/links/shop/a.py C:\\work\\shop\\b.py /real/shop/c.py', ['/links/shop', 'C:\\work\\shop', '/real/shop']) === 'a.py b.py c.py')
  check('C_no_roots_or_a_bare_slash_root_change_nothing', relativizeProjectPaths('/etc/hosts', []) === '/etc/hosts' && relativizeProjectPaths('/etc/hosts', ['/']) === '/etc/hosts')
  const linkBase = mkdtempSync(path.join(os.tmpdir(), 'foundry-p5-link-'))
  try {
    const real = path.join(linkBase, 'real-shop')
    const linked = path.join(linkBase, 'linked-shop')
    mkdirSync(path.join(real, 'tests'), { recursive: true })
    mkdirSync(path.join(real, 'app'), { recursive: true })
    writeFileSync(path.join(real, 'app', '__init__.py'), '')
    writeFileSync(path.join(real, 'tests', '__init__.py'), '')
    writeFileSync(path.join(real, 'app', 'load.py'), 'import os\n\n\ndef load(name):\n    raise FileNotFoundError("no file " + os.path.join(os.getcwd(), "data", name))\n')
    writeFileSync(path.join(real, 'tests', 'test_load.py'), 'import unittest\nfrom app.load import load\n\n\nclass T(unittest.TestCase):\n    def test_load(self):\n        load("prices.csv")\n')
    symlinkSync(real, linked)
    const linkedTrace = parseTrace(py(linked, ['-c', CALL_TRACE_SCRIPT, 'test_load.T.test_load']).out)
    const rawText = JSON.stringify(linkedTrace)
    const linkedNotes = linkedTrace ? traceNotes(linkedTrace, [linked, realpathSync(linked)]).join('\n') : ''
    check('C_a_real_trace_through_a_linked_project_folder_keeps_the_relative_path_and_never_the_absolute_one', Boolean(linkedTrace) && rawText.includes(realpathSync(real)) && !linkedNotes.includes(linkBase) && /no file data\/prices\.csv/.test(linkedNotes) && /app\/load\.py/.test(linkedNotes), linkedNotes.slice(0, 200))
  } finally { rmSync(linkBase, { recursive: true, force: true }) }
  const installedJinja = parseInstalled('jinja2', py(fixtureDir('c-jinja'), ['-c', VERSION_PROBE_SCRIPT, 'jinja2']).out)
  const installedStdlib = parseInstalled('json', py(fixtureDir('c-jinja'), ['-c', VERSION_PROBE_SCRIPT, 'json']).out)
  check('C_the_version_probe_reads_the_installed_version_and_the_official_links_from_local_metadata', Boolean(installedJinja) && installedJinja!.version !== null && installedJinja!.urls.some(link => /^https:\/\//.test(link.url)) && Boolean(installedStdlib) && installedStdlib!.stdlib === true, JSON.stringify(installedJinja?.version))
  const markupPkg = parsePackage(py(fixtureDir('c-jinja'), ['-c', PACKAGE_PROBE_SCRIPT, 'MarkupSafe']).out)
  check('C_the_package_probe_learns_the_name_the_code_must_import', Boolean(markupPkg?.installed) && markupPkg!.modules.includes('markupsafe'), JSON.stringify(markupPkg))
  check('C_probes_are_fixed_scripts_and_only_an_identifier_is_ever_passed_in', !/\$\{|<project>|process\.env/.test(CALL_TRACE_SCRIPT + VERSION_PROBE_SCRIPT + PACKAGE_PROBE_SCRIPT) && analysisIdentifierOnly(), '')
  function analysisIdentifierOnly() { return questionFor({ ...jinja, external: { root: 'x; rm -rf /', symbol: 'a', argument: null, detail: 'MISSING_IMPORT' } }, INFO_JINJA) === null }
  check('C_a_replacement_named_as_a_package_is_looked_up_but_a_dotted_name_or_the_library_itself_is_not', replacementPackage('MarkupSafe', 'jinja2') === 'MarkupSafe' && replacementPackage('markupsafe.Markup', 'jinja2') === null && replacementPackage('jinja2', 'jinja2') === null && replacementPackage(null, 'x') === null, '')

  // ---- 4. searching the project: bounded, narrowed, with a reason
  const loyaltyIndex = buildIndex(await readProjectSources(fixtureDir('b-loyalty')))
  const found = discoverContext(loyaltyIndex, 'Give gold members their discount at checkout', AT)
  const totalFiles = Object.keys(loyaltyIndex.files).length
  check('D_discovery_finds_the_code_and_a_caller_without_reading_the_whole_project', found.entries.length < totalFiles / 2 && found.entries.some(entry => entry.path === 'store/loyalty.py') && found.entries.some(entry => entry.path === 'store/pricing.py') && !found.entries.some(entry => entry.path === 'store/shipping.py' || entry.path === 'store/audit.py'), `${found.entries.length} of ${totalFiles}`)
  const search = emptyTooling()
  const view = { terms: found.terms, entries: found.entries.map(entry => ({ path: entry.path, role: entry.role, reasons: entry.reasons })), expansions: [], totalFiles }
  const firstSearch = searchReceipts(view, search, AT, 'start')
  check('D_the_search_receipt_says_why_what_was_found_and_that_it_changed_the_plan', firstSearch.length === 1 && firstSearch[0].tool === 'PROJECT_SEARCH' && /no files were named/.test(firstSearch[0].why) && new RegExp(`of ${totalFiles} files matter`).test(firstSearch[0].found) && firstSearch[0].changedPlan && /widen only if/.test(firstSearch[0].next), firstSearch[0]?.found)
  check('D_the_search_names_a_dependency_or_caller_it_followed', /(used by|a caller of)/.test(firstSearch[0].found), firstSearch[0].found)
  check('D_the_same_search_is_never_recorded_twice', searchReceipts(view, search, AT, 'failure').length === 0, '')
  const grown = searchReceipts({ ...view, expansions: [{ file: 'store/audit.py', reason: 'the failing run goes through it' }] }, search, LATER, 'failure')
  check('D_following_a_failing_run_into_more_code_is_a_separate_receipt_with_its_reason', grown.length === 1 && /store\/audit\.py: the failing run goes through it/.test(grown[0].found), '')
  check('D_a_receipt_answers_whether_the_same_call_was_made_before', (() => { const state = emptyTooling(); const r = makeReceipt({ tool: 'TERMINAL', at: AT, stage: 'start', why: 'w', question: null, ran: 'python3 -c <version probe> yaml', sent: [], found: 'f', changedPlan: false, next: 'n' }, state); pushReceipt(state, r); return isRepeat(state, 'TERMINAL', 'python3 -c <version probe> yaml') && !isRepeat(state, 'TERMINAL', 'python3 -c <version probe> jinja2') })(), '')

  // ---- 5. research eligibility and restraint
  check('E_a_local_failure_never_becomes_a_research_question', questionFor(local, null) === null && questionFor(prices, null) === null && questionFor(loyalty, null) === null, '')
  const restraint = chooseNextTool({ analysis: local, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 })
  check('E_for_a_local_bug_the_choice_is_no_web_and_it_says_so_in_plain_words', restraint.tool === 'NONE' && restraint.reason === 'LOCAL_SUFFICIENT' && restraint.say === "The local tests already answer this, so I don't need the web here.", restraint.tool)
  check('E_the_restraint_is_said_once_not_every_failure', (() => { const state = emptyTooling(); state.localSaid = true; const next = chooseNextTool({ analysis: local, state, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }); return next.tool === 'NONE' && next.say === null })(), '')
  const localSequence: string[] = []
  for (const fx of [local, loyalty, prices, jinja]) localSequence.push(chooseNextTool({ analysis: fx, state: emptyTooling(), codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }).tool)
  check('E_only_the_failure_that_names_an_external_library_ever_reaches_the_web_step', localSequence.filter(tool => tool === 'WEB').length === 0 && (() => { const s = emptyTooling(); s.installed.jinja2 = INFO_JINJA; return chooseNextTool({ analysis: jinja, state: s, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }).tool === 'WEB' })(), localSequence.join())
  const q = questionFor(jinja, INFO_JINJA)!
  check('E_a_question_states_what_it_asks_and_what_answer_would_change_the_plan', /jinja2\.Markup/.test(q.text) && /3\.1\.6/.test(q.text) && q.wouldChange.length > 5 && q.terms.includes('Markup'), q.text)
  check('E_research_is_capped_per_mission', (() => { const s = emptyTooling(); s.installed.jinja2 = INFO_JINJA; for (let i = 0; i < TOOL_LIMITS.questionsPerMission; i += 1) s.questions.push({ key: `k${i}`, text: '', root: 'jinja2', symbol: `S${i}`, status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: null, installedVersion: '3.1.6', answeredAt: AT }); const n = chooseNextTool({ analysis: jinja, state: s, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }); return n.tool === 'NONE' && n.reason === 'BUDGET' })(), '')

  // ---- 6. source quality
  const hints = { hosts: ['jinja.palletsprojects.com'], repos: ['pallets/jinja'] }
  const tier = (url: string) => tierOf(url, hints)
  check('F_official_documentation_outranks_everything_else', tier('https://jinja.palletsprojects.com/en/stable/api/') === 1 && tier('https://docs.python.org/3/library/functools.html') === 1, '')
  check('F_release_notes_on_an_official_site_are_the_official_changelog', tier('https://jinja.palletsprojects.com/changes/') === 3 && tier('https://docs.python.org/3/whatsnew/3.13.html') === 3, '')
  check('F_the_official_repository_is_recognised_and_other_repositories_are_not', tier('https://github.com/pallets/jinja/blob/main/README.rst') === 2 && tier('https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst') === 3 && tier('https://raw.githubusercontent.com/someone/fork/main/CHANGES.rst') === 6, '')
  check('F_a_registry_is_maintainer_material_and_forums_and_blogs_are_community', tier('https://pypi.org/pypi/jinja2/json') === 5 && tier('https://stackoverflow.com/questions/1') === 7 && tier('https://random-blog.example/jinja') === 7, '')
  check('F_standards_bodies_are_recognised', tier('https://www.rfc-editor.org/rfc/rfc9110') === 4 && tier('https://www.w3.org/TR/html52/') === 4, '')
  check('F_a_page_that_is_not_a_url_is_never_trusted', tier('not a url') === 7, '')
  const plan1 = sourcePlan(q, INFO_JINJA, 1, [])
  const plan2 = sourcePlan(q, INFO_JINJA, 2, plan1.map(item => item.url))
  check('F_wave_one_reads_the_official_changelog_first_and_wave_two_the_repository_and_registry', plan1[0].url === 'https://jinja.palletsprojects.com/changes/' && plan2.some(item => /api\.github\.com\/repos\/pallets\/jinja/.test(item.url)) && plan2.some(item => /pypi\.org\/pypi\/Jinja2\/json/.test(item.url)) && plan2.every(item => !plan1.some(first => first.url === item.url)), plan1.map(item => item.url).join(' '))
  const stdPlan = sourcePlan(questionFor({ ...jinja, external: { root: 'unittest', symbol: 'makeSuite', argument: null, detail: 'MISSING_ATTRIBUTE' } }, INFO_STDLIB)!, INFO_STDLIB, 1, [])
  check('F_a_standard_library_question_goes_to_the_python_docs_and_the_release_notes_of_the_installed_python', stdPlan[0].url === 'https://docs.python.org/3/library/unittest.html' && stdPlan.some(item => item.url === 'https://docs.python.org/3/whatsnew/3.14.html'), stdPlan.map(item => item.url).join(' '))
  check('F_every_planned_address_is_https_and_public', [...plan1, ...plan2, ...stdPlan].every(item => /^https:\/\/[a-z0-9.-]+\//.test(item.url) && !/localhost|127\.0|192\.168|10\./.test(item.url)), '')
  check('F_a_github_blob_link_is_read_as_the_raw_file', sourcePlan(q, { ...INFO_JINJA, urls: [{ label: 'Changelog', url: 'https://github.com/pallets/jinja/blob/main/CHANGES.rst' }] }, 1, [])[0].url === 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst', '')
  check('F_the_changelog_file_is_chosen_from_a_repository_listing', changelogFromListing(JSON.stringify([{ name: 'README.md', type: 'file', download_url: 'https://raw/README.md' }, { name: 'CHANGES', type: 'file', download_url: 'https://raw/CHANGES' }, { name: 'docs', type: 'dir', download_url: null }])) === 'https://raw/CHANGES' && changelogFromListing('not json') === null, '')

  // ---- 7. reading documents: claims with a version, a subject and a replacement; noise is not a claim
  const jc = claimsFor('jinja2', 'Markup', pageText(JINJA_CHANGES))
  const moved = jc.claims.find(claim => claim.action === 'MOVED')
  check('G_a_release_note_sentence_becomes_a_claim_with_the_version_of_its_section', Boolean(moved) && moved!.version === '3.1.0' && moved!.replacement === 'MarkupSafe' && /imported from MarkupSafe/.test(moved!.quote), JSON.stringify(moved))
  check('G_an_earlier_deprecation_is_read_as_a_step_of_the_same_story_not_a_conflict', (() => { const all = jc.claims.map(claim => sourced(claim, 'https://jinja.palletsprojects.com/changes/', 3)); const r = weighClaims(all, '3.1.6', 'MISSING_IMPORT'); return r.best?.action === 'MOVED' && r.conflicts.length === 0 && r.outcome !== 'UNRESOLVED' })(), '')
  const yc = claimsFor('yaml', 'load', YAML_CHANGES, { argument: 'Loader' })
  check('G_a_required_argument_change_is_read_from_a_changelog_line_naming_the_call_and_the_argument', yc.claims.some(claim => claim.action === 'NOW_REQUIRED' && claim.version === '6.0' && /Loader/.test(claim.quote)), JSON.stringify(yc.claims.map(claim => [claim.action, claim.version])))
  check('G_lines_that_only_share_a_common_word_are_not_claims', claimsFor('yaml', 'load', NOISE, { argument: 'Loader' }).claims.length === 0, '')
  const std = claimsFor('unittest', 'makeSuite', WHATSNEW_313, { pageVersion: '3.13' })
  check('G_a_removal_listed_under_a_lead_line_is_read_with_the_release_of_the_page', std.claims.some(claim => claim.action === 'REMOVED' && claim.version === '3.13'), JSON.stringify(std.claims.map(claim => [claim.action, claim.version])))
  check('G_a_claim_quote_is_bounded_and_redacted', (() => { const c = extractClaims('Version 1.0\n\nAPI_TOKEN="sk-abcdefghijklmnopqrstuvwx" Markup was removed', ['Markup']); return c.length === 1 && c[0].quote.length <= TOOL_LIMITS.quoteChars && !/sk-abcdef/.test(c[0].quote) })(), '')
  check('G_claims_per_document_are_bounded', extractClaims(Array.from({ length: 50 }, (_, i) => `Markup was removed ${i}`).join('\n'), ['Markup']).length <= TOOL_LIMITS.claimsPerDocument, '')
  check('G_html_is_reduced_to_text_with_structure_kept', pageText('<h2>Version 3.1.0&para;</h2><ul><li>Markup &amp; escape moved</li></ul><script>evil()</script>').includes('Version 3.1.0') && !/evil|<li>/.test(pageText('<script>evil()</script><li>x</li>')), '')

  // ---- 8. conflicts: the official source wins and the reason is recorded
  const official = sourced(moved!, 'https://jinja.palletsprojects.com/changes/', 3, 'official release notes')
  const wrong = extractClaims(NOTE_WRONG, ['Markup', 'jinja2.Markup'], { groups: [['Markup', 'jinja2.Markup']] })
  check('H_a_note_in_the_project_is_read_as_a_claim_with_its_own_version', wrong.length === 1 && wrong[0].action === 'REMOVED' && wrong[0].version === '3.2', JSON.stringify(wrong.map(claim => [claim.action, claim.version])))
  const conflictRes = weighClaims([sourced(wrong[0], 'project:docs/library-notes.md', 7, 'notes in the project'), official], '3.1.6', 'MISSING_IMPORT')
  check('H_the_official_source_wins_a_disagreement_and_the_disagreement_is_recorded_with_its_reason', conflictRes.best?.tier === 3 && conflictRes.conflicts.length === 1 && conflictRes.conflicts[0].loser.tier === 7 && /outranks/.test(conflictRes.conflicts[0].reason) && conflictRes.outcome === 'CONFLICT_RESOLVED', JSON.stringify(conflictRes.conflicts[0]?.reason))
  check('H_the_order_the_sources_arrive_in_does_not_change_the_winner', weighClaims([official, sourced(wrong[0], 'project:x', 7)], '3.1.6').best?.url === conflictRes.best?.url, '')
  const twoOfficial = weighClaims([official, sourced({ ...moved!, version: '3.2.0', quote: 'other' }, 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst', 3)], '3.1.6')
  check('H_two_official_sources_that_disagree_are_unresolved_and_research_continues_within_budget', twoOfficial.outcome === 'UNRESOLVED' && researchVerdict({ waves: 1, findings: [], consulted: [1], fetchesThisMission: 1 }, twoOfficial) === 'CONTINUE_CONFLICT' && researchVerdict({ waves: 2, findings: [], consulted: [1], fetchesThisMission: 1 }, twoOfficial) === 'STOP_INCONCLUSIVE', twoOfficial.outcome)
  check('H_a_community_only_answer_is_never_authoritative', researchVerdict({ waves: 2, findings: [], consulted: [], fetchesThisMission: 0 }, weighClaims([sourced(wrong[0], 'p', 7)], '3.1.6')) === 'STOP_INCONCLUSIVE' && researchVerdict({ waves: 0, findings: [], consulted: [], fetchesThisMission: 0 }, weighClaims([sourced(wrong[0], 'p', 7)], '3.1.6')) === 'CONTINUE_UNANSWERED', '')
  check('H_the_implication_says_whether_the_installed_version_is_affected', /moved in 3\.1\.0/.test(implicationOf(q, weighClaims([official], '3.1.6'), '3.1.6') ?? '') && /does not affect/.test(implicationOf(q, weighClaims([official], '3.0.0'), '3.0.0') ?? ''), implicationOf(q, weighClaims([official], '3.1.6'), '3.1.6') ?? '')
  check('H_an_added_in_a_later_version_claim_applies_only_before_that_version', (() => { const claim = sourced({ subject: 'batched', action: 'ADDED', version: '3.12', replacement: null, quote: 'New in version 3.12' }, 'https://docs.python.org/3/library/itertools.html', 1); return weighClaims([claim], '3.11').appliesHere === true && weighClaims([claim], '3.14').appliesHere === false })(), '')
  check('H_a_claim_is_described_in_words', /Markup moved in 3\.1\.0/.test(describeClaim(official)), describeClaim(official))

  // ---- 9. the research loop: stops when answered, adapts when a source is unavailable, and is bounded
  const pages: Record<string, string> = { 'https://jinja.palletsprojects.com/changes/': JINJA_CHANGES, 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst': JINJA_CHANGES, 'https://api.github.com/repos/pallets/jinja/contents/': JSON.stringify([{ name: 'CHANGES.rst', type: 'file', download_url: 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst' }]) }
  const loop1 = fakeDeps(pages)
  const t1 = emptyTooling(); t1.installed.jinja2 = INFO_JINJA
  const r1 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: t1, deps: loop1.deps })
  check('I_one_authoritative_source_answers_the_question_and_research_stops', r1.question.status === 'ANSWERED' && loop1.fetched.length === 1 && t1.fetches === 1 && r1.question.waves === 1, `${loop1.fetched.length} fetch`)
  check('I_the_finding_records_source_tier_date_and_the_quote', r1.question.findings[0].tier === 3 && r1.question.findings[0].fetchedAt === AT && r1.question.findings[0].url.startsWith('https://') && r1.question.findings[0].quote.length > 10 && Boolean(r1.question.implication), '')
  const loop2 = fakeDeps({ 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst': JINJA_CHANGES, 'https://api.github.com/repos/pallets/jinja/contents/': JSON.stringify([{ name: 'CHANGES.rst', type: 'file', download_url: 'https://raw.githubusercontent.com/pallets/jinja/main/CHANGES.rst' }]) })
  const t2 = emptyTooling()
  const r2 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: t2, deps: loop2.deps })
  check('I_when_the_official_page_is_unavailable_the_next_official_source_answers_and_the_outage_is_reported', r2.question.status === 'ANSWERED' && r2.unavailable >= 1 && r2.said.includes('unavailable') && r2.question.consulted.some(item => !item.ok) && r2.urls.some(url => /raw\.githubusercontent/.test(url)), r2.question.consulted.map(item => `${item.ok}`).join())
  const loop3 = fakeDeps({})
  const t3 = emptyTooling()
  const r3 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: t3, deps: loop3.deps })
  check('I_with_no_reachable_source_it_stops_inconclusive_within_the_budget', r3.question.status === 'INCONCLUSIVE' && loop3.fetched.length <= TOOL_LIMITS.fetchesPerQuestion && r3.question.waves <= TOOL_LIMITS.waves && !r3.question.implication, `${loop3.fetched.length} fetches`)
  check('I_an_inconclusive_question_is_not_asked_again_this_mission_as_if_it_were_open', (() => { const s = emptyTooling(); s.installed.jinja2 = INFO_JINJA; s.questions.push(r3.question); return chooseNextTool({ analysis: jinja, state: s, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }).tool === 'NONE' })(), '')
  const loop4 = fakeDeps(pages, { localNotes: async () => [{ file: 'docs/library-notes.md', text: NOTE_WRONG }] })
  const r4 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: loop4.deps })
  check('I_a_wrong_note_in_the_project_never_overrides_the_official_release_notes', r4.question.status === 'ANSWERED' && r4.question.conflicts.length === 1 && r4.question.findings[0].tier === 3 && /moved in 3\.1\.0/.test(r4.question.implication ?? ''), r4.question.conflicts[0]?.loser.claim)
  const remembered = fakeDeps(pages)
  const r5 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: remembered.deps, remembered: { url: 'https://jinja.palletsprojects.com/changes/', claim: 'x' } })
  check('I_a_remembered_source_is_read_first_and_the_answer_is_confirmed_against_it', r5.memoryHit === 'CONFIRMED' && remembered.fetched.length === 1 && remembered.fetched[0] === 'https://jinja.palletsprojects.com/changes/', `${r5.memoryHit}`)
  const changed = fakeDeps({ ...pages, 'https://jinja.palletsprojects.com/changes/': 'Version 3.1.6\n\n- nothing here.' })
  const r6 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: changed.deps, remembered: { url: 'https://jinja.palletsprojects.com/changes/', claim: 'x' } })
  check('I_when_the_remembered_source_no_longer_says_it_fresh_research_goes_on_and_current_docs_win', r6.memoryHit === 'CHANGED' && changed.fetched.length > 1 && r6.question.status === 'ANSWERED', `${r6.memoryHit} ${changed.fetched.length}`)
  let searchedFor = ''
  const noOfficial = fakeDeps({}, { search: async query => { searchedFor = query; return [{ title: 'forum', url: 'https://forum.example/thread', snippet: NOTE_WRONG }] } })
  const r7 = await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: noOfficial.deps })
  check('I_a_search_is_only_the_last_resort_uses_a_query_of_identifiers_only_and_never_settles_a_question_alone', searchedFor === 'jinja2 Markup 3.1.6 removed changelog' && isSafeQuery(searchedFor) && r7.question.status === 'INCONCLUSIVE' && r7.query === searchedFor, searchedFor)
  let searchCalls = 0
  const officialFirst = fakeDeps(pages, { search: async () => { searchCalls += 1; return [] } })
  await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: officialFirst.deps })
  check('I_no_search_happens_when_an_official_source_already_answered', searchCalls === 0, '')
  const t8 = emptyTooling(); t8.fetches = TOOL_LIMITS.fetchesPerMission
  const exhausted = fakeDeps(pages)
  await researchQuestion({ question: q, info: INFO_JINJA, tooling: t8, deps: exhausted.deps })
  check('I_the_mission_wide_fetch_budget_is_a_hard_stop', exhausted.fetched.length === 0, '')
  const signature = questionFor(yamlA, INFO_YAML)!
  const yamlPages = fakeDeps({ 'https://pyyaml.org/wiki/PyYAMLDocumentation': NOISE, 'https://api.github.com/repos/yaml/pyyaml/contents/': JSON.stringify([{ name: 'CHANGES', type: 'file', download_url: 'https://raw.githubusercontent.com/yaml/pyyaml/main/CHANGES' }]), 'https://raw.githubusercontent.com/yaml/pyyaml/main/CHANGES': YAML_CHANGES })
  const r9 = await researchQuestion({ question: signature, info: INFO_YAML, tooling: emptyTooling(), deps: yamlPages.deps })
  check('I_when_the_docs_page_does_not_answer_the_repository_changelog_is_read_in_a_second_wave', r9.question.status === 'ANSWERED' && r9.question.waves === 2 && /Loader argument of yaml\.load became required in 6\.0/.test(r9.question.implication ?? ''), r9.question.implication ?? '')
  const stdPages = fakeDeps({ 'https://docs.python.org/3/library/unittest.html': 'unittest documentation without the name', 'https://docs.python.org/3/whatsnew/3.14.html': 'nothing', 'https://docs.python.org/3/whatsnew/3.13.html': WHATSNEW_313 })
  const stdQuestion = questionFor({ ...jinja, external: { root: 'unittest', symbol: 'makeSuite', argument: null, detail: 'MISSING_ATTRIBUTE' } }, INFO_STDLIB)!
  const r10 = await researchQuestion({ question: stdQuestion, info: INFO_STDLIB, tooling: emptyTooling(), deps: stdPages.deps })
  check('I_a_removed_standard_library_name_is_found_in_the_release_notes_of_the_release_that_removed_it', r10.question.status === 'ANSWERED' && r10.question.findings[0].action === 'REMOVED' && r10.question.findings[0].version === '3.13' && /Python 3\.14\.4/.test(r10.question.implication ?? ''), r10.question.implication ?? '')

  // ---- 10. return to coding: the finding becomes a note for whoever edits, and the mode goes back
  const note = researchNote(r1.question, { MarkupSafe: { version: '3.0.3', modules: ['markupsafe'] } })
  check('J_the_note_for_the_editor_states_the_fact_its_source_and_the_module_name_and_forbids_a_workaround', /official release notes/.test(note ?? '') && /moved in 3\.1\.0/.test(note ?? '') && /`markupsafe`/.test(note ?? '') && /do not add a workaround/.test(note ?? '') && (note ?? '').length <= TOOL_LIMITS.noteChars + 160, note ?? '')
  check('J_an_unanswered_question_produces_no_note', researchNote(r3.question) === null, '')
  check('J_the_conflict_is_part_of_the_note_so_the_wrong_source_is_not_believed_later', /less reliable source/.test(researchNote(r4.question) ?? ''), '')

  // ---- 11. receipts
  const receiptState = emptyTooling()
  const receipt = makeReceipt({ tool: 'WEB', at: AT, stage: 'start', why: 'the failure depends on the installed version', question: q.text, ran: 'read jinja.palletsprojects.com/changes', sent: ['jinja2 Markup'], found: r1.question.implication ?? '', changedPlan: true, next: 'go back to the code', urls: r1.urls }, receiptState)
  const described = describeReceipt(receipt)
  check('K_a_receipt_answers_what_why_found_changed_the_plan_and_what_came_next', ['WEB', 'why: the failure', 'question:', 'ran: read', 'sent: jinja2 Markup', 'found: Markup moved', 'changed the plan: yes', 'next: go back'].every(part => described.includes(part)), described.slice(0, 120))
  check('K_a_receipt_with_nothing_sent_says_so', describeReceipt(makeReceipt({ tool: 'TERMINAL', at: AT, stage: 'start', why: 'w', question: null, ran: 'r', sent: [], found: 'f', changedPlan: false, next: 'n' }, receiptState)).includes('nothing left the machine'), '')
  for (let i = 0; i < 60; i += 1) pushReceipt(receiptState, makeReceipt({ tool: 'NONE', at: AT, stage: 'failure', why: 'w', question: null, ran: `r${i}`, sent: [], found: 'f', changedPlan: false, next: 'n' }, receiptState))
  check('K_receipts_are_bounded_and_keep_the_most_recent', receiptState.receipts.length === TOOL_LIMITS.receipts && receiptState.receipts[receiptState.receipts.length - 1].ran === 'r59', String(receiptState.receipts.length))
  check('K_receipt_text_is_bounded', makeReceipt({ tool: 'NONE', at: AT, stage: 'start', why: 'x'.repeat(900), question: null, ran: 'x'.repeat(900), sent: [], found: 'x'.repeat(900), changedPlan: false, next: 'x'.repeat(900) }, emptyTooling()).found.length <= 320, '')

  // ---- 12. secret-safe research
  check('L_a_query_carries_only_technical_identifiers', isSafeQuery('jinja2 Markup 3.1.6 removed changelog') && !isSafeQuery('') && !isSafeQuery('token=abc') && !isSafeQuery('/home/user/project/app.py') && !isSafeQuery('a'.repeat(TOOL_LIMITS.queryChars + 1)) && !isSafeQuery('API_KEY sk-abcdefghijklmnopqrstuvwx'), '')
  check('L_the_query_is_built_from_the_library_the_name_and_the_version_only', safeQueryFor(q, INFO_JINJA) === 'jinja2 Markup 3.1.6 removed changelog' && safeQueryFor(questionFor(yamlA, INFO_YAML)!, INFO_YAML) === 'yaml load 6.0.3 changelog', safeQueryFor(q, INFO_JINJA) ?? '')
  const notesDir = mkdtempSync(path.join(os.tmpdir(), 'foundry-p5-notes-'))
  try {
    mkdirSync(path.join(notesDir, 'docs'), { recursive: true })
    writeFileSync(path.join(notesDir, 'docs', 'notes.md'), 'Markup was removed in 3.2.\nAPI_TOKEN="sk-abcdefghijklmnopqrstuvwx"\n')
    writeFileSync(path.join(notesDir, '.env'), 'PASSWORD=FAKE-ENV-VALUE Markup\n')
    writeFileSync(path.join(notesDir, 'secrets.md'), 'Markup FAKE-SECRET-VALUE-9f8e7d\n')
    const localNotes = await readLocalNotes(notesDir, ['Markup'])
    check('L_project_notes_are_read_locally_redacted_and_secret_files_are_never_read', localNotes.length === 1 && localNotes[0].file === 'docs/notes.md' && !/sk-abcdef/.test(localNotes[0].text) && !localNotes.some(note => /FAKE/.test(note.text)), localNotes.map(note => note.file).join())
  } finally { rmSync(notesDir, { recursive: true, force: true }) }
  const outbound: string[] = []
  const spy = fakeDeps(pages, { search: async query => { outbound.push(query); return [] } })
  await researchQuestion({ question: q, info: INFO_JINJA, tooling: emptyTooling(), deps: spy.deps })
  check('L_only_public_https_addresses_built_from_identifiers_and_official_metadata_are_ever_fetched', spy.fetched.every(url => /^https:\/\//.test(url) && !/[?&=]/.test(url.replace(/^https:\/\/[^/]+/, '')) && !/sk-|FAKE|password|token/i.test(url)), spy.fetched.join())
  check('L_a_receipt_lists_what_was_sent_and_it_is_identifiers_not_content', /^jinja2 Markup$/.test(['jinja2 Markup'][0]) && !/[/\\]/.test('jinja2 Markup'), '')

  // ---- 13. restart persistence
  const midway = emptyTooling()
  midway.installed.jinja2 = INFO_JINJA
  midway.questions.push({ ...r1.question, status: 'OPEN', waves: 1, implication: null }, r9.question)
  midway.current = q.key
  midway.mode = 'RESEARCHING'
  midway.fetches = 3
  midway.notes.push('Runtime trace of the failing test (...)')
  midway.traced.push('k@0')
  midway.probed.push('version:jinja2')
  midway.searched = { discovered: true, expansions: 2 }
  midway.importNames.MarkupSafe = { version: '3.0.3', modules: ['markupsafe'] }
  for (const item of receiptState.receipts.slice(-3)) midway.receipts.push(item)
  const back = restoreTooling(JSON.parse(JSON.stringify(midway)))
  check('M_a_restart_restores_the_open_question_the_sources_consulted_and_the_findings', back.current === q.key && back.mode === 'RESEARCHING' && back.questions[0].status === 'OPEN' && back.questions[0].consulted.length === r1.question.consulted.length && back.questions[1].findings[0].quote === r9.question.findings[0].quote, '')
  check('M_it_restores_the_tool_receipts_the_installed_versions_and_the_notes', back.receipts.length === 3 && back.installed.jinja2.version === '3.1.6' && back.notes.length === 1 && back.importNames.MarkupSafe.modules[0] === 'markupsafe' && back.searched.expansions === 2 && back.fetches === 3, '')
  check('M_after_a_restart_completed_work_is_not_repeated', (() => { const next = chooseNextTool({ analysis: jinja, state: back, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }); return !(next.tool === 'TERMINAL' && next.probe === 'VERSION') })() && searchReceipts({ terms: [], entries: [{ path: 'a.py', role: 'implementation', reasons: [] }], expansions: [{ file: 'x', reason: 'r' }, { file: 'y', reason: 'r' }], totalFiles: 3 }, back, AT, 'start').length === 0, '')
  check('M_an_answered_question_survives_a_restart_and_is_not_researched_again', (() => { const s = restoreTooling(JSON.parse(JSON.stringify({ ...emptyTooling(), installed: { jinja2: INFO_JINJA }, questions: [r1.question] }))); return chooseNextTool({ analysis: jinja, state: s, codeGeneration: 0, commandsLeft: 8, codeFilesInPlay: 1 }).tool === 'NONE' })(), '')
  check('M_damaged_or_missing_state_restores_to_an_empty_one_instead_of_failing', [null, undefined, 'x', 7, { receipts: 'no', questions: [{ nope: 1 }], installed: { a: 1 }, importNames: { b: 2 } }].every(bad => { const s = restoreTooling(bad); return s.receipts.length === 0 && s.questions.length === 0 && Object.keys(s.installed).length === 0 }), '')
  check('M_restored_state_is_bounded', restoreTooling({ receipts: Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, tool: 'NONE' })), questions: Array.from({ length: 30 }, (_, i) => ({ key: `q${i}`, findings: [] })), fetches: 99999 }).receipts.length === TOOL_LIMITS.receipts && restoreTooling({ questions: Array.from({ length: 30 }, (_, i) => ({ key: `q${i}`, findings: [] })) }).questions.length === TOOL_LIMITS.questions && restoreTooling({ fetches: 99999 }).fetches <= 999, '')

  // ---- 14. human language
  const sentences = [
    say.version('jinja2'), say.checking('jinja2'), say.recheck('jinja2'), say.answered(r1.question), say.answered(r9.question), say.answered(r10.question), say.conflict(r4.question.conflicts[0]), say.inconclusive('jinja2'),
    say.unavailable(), say.traced('the failure inside prices/loader.py together with the real values the code was working with'), say.traceUnavailable(), say.local(), say.backToCode(),
    first.say ?? '', second.say ?? '', traceNeeded.say ?? '', valueMany.say ?? '', restraint.say ?? '', pkg.say ?? '', r1.question.implication ?? '', r9.question.implication ?? '',
  ]
  check('N_every_sentence_the_commander_reads_is_natural_language_without_enums_scores_or_counters', sentences.every(text => text.length > 20 && !looksInternal(text) && !/\b(TERMINAL|WEB|NONE|PROJECT_SEARCH|ANSWERED|INCONCLUSIVE|CALL_TRACE|tier|budget|wave)\b/.test(text)), sentences.find(text => looksInternal(text) || /\b(TERMINAL|WEB|NONE|ANSWERED|tier|wave)\b/.test(text)) ?? '')
  check('N_the_examples_in_the_brief_read_the_same_way', /version-specific/.test(say.checking('adapter')) && /don't need the web/.test(say.local()) && /official release notes/.test(say.answered(r1.question)) && /updating the code that uses it/.test(say.answered(r1.question)), say.answered(r1.question))
  check('N_internals_belong_to_details_only', /WEB \[start\]/.test(described) && looksInternal('TOOL_SELECT=WEB RESEARCH_SCORE=0.91 SEARCH_BUDGET=2/3'), '')

  // ---- 15. memory integration: remembered, freshness by version and age, never a substitute for fresh reading
  const projectSources = await readProjectSources(fixtureDir('c-jinja'))
  const index = buildIndex(projectSources)
  const mission = (resolved: boolean, over: Partial<Parameters<typeof researchMemoriesFromMission>[0]> = {}) => researchMemoriesFromMission({
    mission: 'm1', session: 's1', at: AT, resolved, index, filesMutated: ['reports/renderer.py'],
    questions: [{ key: q.key, text: q.text, root: 'jinja2', symbol: 'Markup', status: 'ANSWERED', installedVersion: '3.1.6', python: '3.14.4', finding: { action: 'MOVED', version: '3.1.0', replacement: 'MarkupSafe', url: 'https://jinja.palletsprojects.com/changes/', tier: 3, quote: 'Markup and escape should be imported from MarkupSafe.' } }], ...over,
  })
  const written = mission(true)
  check('O_a_finding_is_remembered_only_after_the_change_it_led_to_passed_and_from_a_primary_source', written.length === 1 && written[0].kind === 'RESEARCH_FINDING' && written[0].evidence.some(item => item.type === 'SOURCE_DOC') && written[0].evidence.some(item => item.type === 'TEST_PASS') && mission(false).length === 0, '')
  const community = researchMemoriesFromMission({ mission: 'm1', session: null, at: AT, resolved: true, index, filesMutated: ['reports/renderer.py'], questions: [{ key: 'k', text: 't', root: 'jinja2', symbol: 'Markup', status: 'ANSWERED', installedVersion: '3.1.6', python: '3.14.4', finding: { action: 'REMOVED', version: '3.2', replacement: null, url: 'https://forum.example/x', tier: 7, quote: 'q' } }, { key: 'k2', text: 't', root: 'jinja2', symbol: 'Other', status: 'INCONCLUSIVE', installedVersion: '3.1.6', python: '3.14.4', finding: null }] })
  check('O_community_and_inconclusive_answers_write_nothing', community.length === 0 && !checkWriteEligibility({ ...written[0], detail: { ...(written[0].detail as object), tier: 7 } as never }).ok && !checkWriteEligibility({ ...written[0], evidence: written[0].evidence.filter(item => item.type !== 'TEST_PASS') }).ok, '')
  const store = mergeMemories(emptyStore(makeIdentity({ root: '/p', projectId: 'p1' }), AT), written, AT)
  check('O_the_same_question_for_the_same_installed_version_is_found_and_offered_as_a_place_to_look_first', findResearchMemory(store, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: LATER })?.url === 'https://jinja.palletsprojects.com/changes/' && findResearchMemory(store, { root: 'jinja2', symbol: 'escape', installed: '3.1.6', now: LATER }) === null && findResearchMemory(store, { root: 'yaml', symbol: 'Markup', installed: '3.1.6', now: LATER }) === null, '')
  const newer = revalidateResearch(store, { jinja2: '3.2.0' }, LATER, 'm2')
  check('O_a_changed_library_version_downgrades_the_finding_with_its_reason_and_it_is_no_longer_offered', newer.changed.length === 1 && newer.store.entries[0].status === 'STALE' && /3\.2\.0/.test(newer.store.entries[0].history.at(-1)?.why ?? '') && findResearchMemory(newer.store, { root: 'jinja2', symbol: 'Markup', installed: '3.2.0', now: LATER }) === null && findResearchMemory(newer.store, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: LATER }) === null, '')
  check('O_the_same_version_changes_nothing', revalidateResearch(store, { jinja2: '3.1.6' }, LATER, 'm2').changed.length === 0 && revalidateResearch(store, {}, LATER, 'm2').changed.length === 0, '')
  const aged = revalidateStore(store, index, MUCH_LATER, 'm3')
  check('O_an_old_finding_goes_stale_by_age_and_a_recent_one_keeps_its_date', aged.store.entries[0].status === 'STALE' && revalidateStore(store, index, LATER, 'm3').store.entries[0].status === 'VERIFIED' && revalidateStore(store, index, LATER, 'm3').store.entries[0].lastVerified === AT && findResearchMemory(store, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: MUCH_LATER }) === null, '')
  const again = mergeMemories(store, mission(true, { at: LATER, mission: 'm9' }), LATER)
  check('O_researching_the_same_thing_again_updates_the_one_entry_instead_of_duplicating_it', again.entries.length === store.entries.length && (again.entries[0].detail as { checkedAt: string }).checkedAt === LATER && again.entries[0].evidence.length >= 3, `${again.entries.length}`)
  check('O_generic_retrieval_never_returns_a_research_finding_so_it_cannot_be_mistaken_for_a_project_fact', retrieveMemories(store, { sessionId: 's1', goal: 'bold renderer', files: ['reports/renderer.py'], symbols: ['Markup'], tests: [], failure: null }, index).hits.length === 0, '')
  check('O_the_remembered_entry_carries_provenance_and_no_secret', written[0].sourceMission === 'm1' && written[0].history.length === 1 && !/token|password|secret/i.test(JSON.stringify(written[0])), '')

  // ---- 16. wiring in the runtime and the plan
  const runtime = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
  const plan = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringPlan.ts'), 'utf8')
  const campaign = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringCampaign.ts'), 'utf8').replace(/\r\n/g, '\n')
  const io = readFileSync(path.join(repo, 'lib/native-builder/foundryToolReasoningIO.ts'), 'utf8')
  const pure = readFileSync(path.join(repo, 'lib/native-builder/foundryToolReasoning.ts'), 'utf8')
  check('P_the_tool_step_runs_after_the_first_failing_run_and_after_every_failing_integration', runtime.includes("await investigate(raw, 'start')") && runtime.includes("await investigate(`${result.stdout}\\n${result.stderr}`, 'failure')"), '')
  check('P_the_tool_step_is_inert_unless_the_mission_is_context_driven', /const investigate = async \(raw: string, stage: 'start' \| 'failure'\) => \{\n    if \(!contextOn\(\)\) return/.test(runtime), '')
  check('P_each_result_leads_to_the_next_choice_and_the_loop_is_bounded', /for \(let step = 0; step < 4; step \+= 1\) \{\n      const next = chooseNextTool\(/.test(runtime), '')
  check('P_probes_are_typed_argument_lists_with_a_fixed_script_and_never_a_shell_string', runtime.includes("['-c', VERSION_PROBE_SCRIPT, ext.root]") && runtime.includes("['-c', CALL_TRACE_SCRIPT, analysis.testId]") && runtime.includes("['-c', PACKAGE_PROBE_SCRIPT, name]") && !/shell:\s*true|exec\(`/.test(runtime.slice(runtime.indexOf('const investigate'), runtime.indexOf('const noteVerifiedAfterTools'))), '')
  check('P_probes_run_through_the_governed_command_path_with_a_short_display_command', runtime.includes('display?: string') && runtime.includes('display ?? [cmd, ...args].join'), '')
  check('P_web_reads_are_governed_get_only_public_fetches_bound_to_the_mission', runtime.includes('research.classifyResearchRequest({ url, method: \'GET\' })') && runtime.includes('transport.foundryResearchFetch(url') && runtime.includes('{ missionId: repairId }') && !/method: 'POST'/.test(runtime.slice(runtime.indexOf('const governedFetch'), runtime.indexOf('const shortUrl'))), '')
  check('P_trace_notes_are_written_with_the_project_folder_and_its_resolved_spelling_removed', /traceNotes\(trace, \[root, await realpath\(root\)/.test(runtime) && !runtime.includes("split(`${root}/`)"), '')
  const noteYaml = 'Checked just now (yaml) in official release notes, https://pyyaml.org/x: the Loader argument became required in 6.0. Change the code that uses it; do not add a workaround.'
  const noteJinja = 'Checked just now (jinja2) in official release notes, https://jinja.palletsprojects.com/changes/: Markup moved in 3.1.0. Change the code that uses it; do not add a workaround.'
  const noteJinjaAgain = 'Checked just now (jinja2) in official release notes, https://jinja.palletsprojects.com/changes/: Markup moved in 3.1.0 (checked again). Change the code that uses it; do not add a workaround.'
  const both = mergeResearchNote(mergeResearchNote([], noteYaml, 'yaml', TOOL_LIMITS.notes), noteJinja, 'jinja2', TOOL_LIMITS.notes)
  check('F_a_second_answer_does_not_erase_the_first_one_the_editor_still_needs', both.length === 2 && both[0] === noteYaml && both[1] === noteJinja, both.map(item => item.slice(0, 30)).join(' | '))
  check('F_a_re_check_of_the_same_library_replaces_only_its_own_note', JSON.stringify(mergeResearchNote(both, noteJinjaAgain, 'jinja2', TOOL_LIMITS.notes)) === JSON.stringify([noteYaml, noteJinjaAgain]))
  check('F_other_notes_such_as_the_trace_and_package_names_are_kept_and_the_bound_still_holds', (() => { const other = ['Runtime trace of the failing test: x', 'The package MarkupSafe is installed as MarkupSafe 3.0.3; the module to import is `markupsafe`']; const merged = mergeResearchNote([...other, noteYaml], noteJinja, 'jinja2', TOOL_LIMITS.notes); return merged.includes(other[0]) && merged.includes(other[1]) && merged.includes(noteYaml) && merged.length <= TOOL_LIMITS.notes; })())
  check('F_a_root_that_only_shares_a_prefix_is_not_treated_as_the_same_library', mergeResearchNote(['Checked just now (jinja2) in a: x'], 'Checked just now (jinja) in b: y', 'jinja', TOOL_LIMITS.notes).length === 2)
  check('F_the_note_names_the_library_it_is_about', /^Checked just now \(yaml\) in /.test(researchNote({ key: 'k', text: 't', root: 'yaml', symbol: null, status: 'ANSWERED', waves: 1, consulted: [], findings: [], conflicts: [], implication: 'x', installedVersion: null, answeredAt: null }) ?? ''))
  check('F_the_runtime_merges_research_notes_by_library_and_no_longer_wipes_every_earlier_one', runtime.includes('mergeResearchNote(tooling.notes, note, question.root, TOOL_LIMITS.notes)') && !runtime.includes("startsWith('Checked just now')"), '')
  // ---- memory reuse when still valid, fresh research when not (live proofs RESEARCH_MEMORY_LIVE_REUSE / RESEARCH_MEMORY_STALE_REFRESH run the same paths for real)
  {
    const reuseQuestion = q
    const stored = store
    const spyState = { fetches: 0 }
    const noFetch = { fetchText: async () => { spyState.fetches += 1; return { ok: false } }, localNotes: async () => [], now: () => LATER }
    const hit = findResearchMemory(stored, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: LATER })
    const tooling = emptyTooling(); tooling.installed.jinja2 = INFO_JINJA
    const reused = hit ? answerFromMemory({ question: reuseQuestion, info: INFO_JINJA, tooling, remembered: { url: hit.url, claim: hit.claim, finding: hit.finding }, now: LATER }) : null
    check('R_a_valid_remembered_answer_is_used_with_no_web_read_at_all', Boolean(reused) && reused!.memoryHit === 'REUSED' && reused!.fetched === 0 && reused!.urls.length === 0 && reused!.question.status === 'ANSWERED' && reused!.question.fromMemory?.checkedAt === AT && spyState.fetches === 0, `${reused?.memoryHit} fetched=${reused?.fetched}`)
    check('R_the_remembered_answer_is_worded_and_weighed_like_a_fresh_one', /MarkupSafe/.test(reused?.question.implication ?? '') && /3\.1\.0/.test(reused?.question.implication ?? '') && reused?.question.findings[0]?.tier === 3 && reused?.question.findings[0]?.replacement === 'MarkupSafe', reused?.question.implication ?? '')
    const memoryNote = reused ? researchNote(reused.question, { MarkupSafe: { version: '3.0.3', modules: ['markupsafe'] } }) ?? '' : ''
    check('R_the_editor_note_says_the_answer_is_from_earlier_with_its_date_and_the_same_installed_version', /^From earlier in this project \(jinja2\), checked 2026-09-26 in official release notes/.test(memoryNote) && /same installed version/.test(memoryNote) && /`markupsafe`/.test(memoryNote), memoryNote.slice(0, 120))
    check('R_a_remembered_note_and_a_fresh_note_about_the_same_library_replace_each_other_and_others_stay', mergeResearchNote(['From earlier in this project (jinja2), checked x: a', 'other'], 'Checked just now (jinja2) in y: b', 'jinja2', TOOL_LIMITS.notes).join('|') === 'other|Checked just now (jinja2) in y: b')
    check('R_the_human_sentences_say_it_was_already_researched_for_the_same_version', /same installed version/.test(say.reused('jinja2')) && /From my earlier research in this project/.test(reused ? say.answered(reused.question) : ''))
    const upgraded = revalidateResearch(stored, { jinja2: '3.2.0' }, LATER, 'm2')
    check('R_a_changed_library_version_makes_the_answer_stale_and_it_is_not_reused', upgraded.store.entries[0].status === 'STALE' && findResearchMemory(upgraded.store, { root: 'jinja2', symbol: 'Markup', installed: '3.2.0', now: LATER }) === null)
    const stale = revalidateResearch(stored, { jinja2: '3.1.6' }, MUCH_LATER, 'm3')
    check('R_an_old_answer_is_not_reused_either', findResearchMemory(stale.store, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: MUCH_LATER }) === null)
    const freshTooling = emptyTooling(); freshTooling.installed.jinja2 = { ...INFO_JINJA, version: '3.2.0' }
    let fetched = 0
    const refreshed = await researchQuestion({ question: reuseQuestion, info: { ...INFO_JINJA, version: '3.2.0' }, tooling: freshTooling, deps: { fetchText: async url => { fetched += 1; return /jinja\.palletsprojects\.com\/changes/.test(url) ? { ok: true, status: 200, text: JINJA_CHANGES } : { ok: false } }, localNotes: async () => [], now: () => LATER } })
    check('R_when_the_answer_is_stale_the_question_is_researched_again_from_the_source', fetched >= 1 && refreshed.fetched >= 1 && refreshed.question.fromMemory === undefined && refreshed.question.consulted.some(item => item.ok), `fetched=${fetched}`)
    const weak = { ...store, entries: [{ ...store.entries[0], detail: { ...(store.entries[0].detail as object), tier: 7 } as never }] }
    const weakHit = findResearchMemory(weak, { root: 'jinja2', symbol: 'Markup', installed: '3.1.6', now: LATER })
    check('R_an_answer_that_did_not_come_from_a_primary_source_is_never_reused_without_reading_again', !weakHit || answerFromMemory({ question: reuseQuestion, info: INFO_JINJA, tooling: emptyTooling(), remembered: { url: weakHit.url, claim: weakHit.claim, finding: weakHit.finding }, now: LATER }).memoryHit === null)
    const runtimeReuse = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
    check('R_the_runtime_takes_the_remembered_answer_before_any_research_and_records_it_as_no_web_read', runtimeReuse.includes('answerFromMemory({ question, info, tooling, remembered') && runtimeReuse.includes("tool: usedMemory ? 'NONE' : 'WEB'") && runtimeReuse.includes('used the answer remembered from an earlier mission (no web read)') && runtimeReuse.indexOf('answerFromMemory({') < runtimeReuse.indexOf('await researchQuestion({'))
  }
  check('P_research_and_trace_findings_reach_the_editor_as_notes_and_the_record_shows_them', runtime.includes('...dropStaleHints(state.tooling?.notes ?? [], ') && runtime.includes('notes: notesForCall') && runtime.includes('tooling.notes = ['), '')
  check('P_after_research_the_plan_is_revised_and_the_mode_returns_to_coding', runtime.includes("revisePlanFor(usedMemory ? 'MEMORY_USED' : 'RESEARCH_USED'") && runtime.includes("tooling.mode = 'CODING'") && runtime.includes("revisePlanFor('RUNTIME_EVIDENCE'"), '')
  check('P_the_first_edit_is_not_delayed_by_research_that_is_not_needed', runtime.includes('if (next.tool === \'NONE\') {') && runtime.includes("reason === 'LOCAL_SUFFICIENT'"), '')
  check('P_the_tool_record_is_part_of_the_persisted_campaign_and_restored_on_resume', campaign.includes("tooling?: import('./foundryToolReasoning').ToolingState") && runtime.includes('restoreTooling(state.tooling)'), '')
  check('P_research_is_remembered_after_a_verified_completion_and_checked_again_before_use', runtime.includes('researchMemoriesFromMission({') && runtime.includes('findResearchMemory(') && runtime.includes('revalidateResearch(store'), '')
  check('P_a_search_query_is_only_ever_the_safe_identifier_query', io.includes('safeQueryFor(question, info)') && /deps\.search\(query\)/.test(io), '')
  check('P_the_pure_module_has_no_filesystem_network_or_clock', !/from 'node:(fs|net|http|https|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(pure), '')
  check('P_the_new_plan_triggers_read_as_plain_sentences', /RESEARCH_USED: "I checked the official docs/.test(plan) && /RUNTIME_EVIDENCE: "I ran the failing test under a trace/.test(plan) && !looksInternal("I checked the official docs for the part that depends on a library version, so I'm updating the plan around what they say."), '')

  // ---- 17. fixtures: each fails the way its proof needs, and none of them contains the answer
  const listFiles = (dir: string, rel = ''): string[] => readdirSync(dir).flatMap(name => { const abs = path.join(dir, name); const r = rel ? `${rel}/${name}` : name; return statSync(abs).isDirectory() ? listFiles(abs, r) : [r] })
  const fixtureText = (name: string) => listFiles(fixtureDir(name)).filter(file => /\.(py|md)$/.test(file)).map(file => readFileSync(path.join(fixtureDir(name), file), 'utf8')).join('\n')
  check('Q_the_fixtures_fail_at_baseline_for_the_reason_each_proof_needs', [['a-prices', 'KeyError'], ['b-loyalty', 'AssertionError'], ['c-jinja', 'ImportError'], ['d-local', 'AssertionError'], ['e-notes', 'ImportError'], ['f-config', 'TypeError']].every(([name, exception]) => new RegExp(exception).test(unittestOutput(name))), '')
  check('Q_no_fixture_contains_the_answer_the_research_must_find', !/markupsafe/i.test(fixtureText('c-jinja').replace(/Disposable.*\n/, '')) && !/safe_load|SafeLoader|Loader=/.test(fixtureText('f-config')) && !/utf-8-sig|\\ufeff/.test(fixtureText('a-prices')) && !/ceil/.test(fixtureText('d-local')), '')
  check('Q_the_data_file_the_source_does_not_show_carries_the_hidden_defect_and_is_not_a_source_language', readFileSync(path.join(fixtureDir('a-prices'), 'data', 'prices.csv')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), '')
  check('Q_the_contradicting_note_exists_only_in_the_notes_fixture', listFiles(fixtureDir('e-notes')).includes('docs/library-notes.md') && !listFiles(fixtureDir('c-jinja')).includes('docs/library-notes.md') && /removed in Jinja 3\.2/.test(readFileSync(path.join(fixtureDir('e-notes'), 'docs', 'library-notes.md'), 'utf8')), '')
  check('Q_the_two_library_fixture_hides_the_second_question_behind_the_first', /import Markup/.test(readFileSync(path.join(fixtureDir('f-config'), 'app', 'title.py'), 'utf8')) && !/ImportError/.test(unittestOutput('f-config')) && yamlA.external?.root === 'yaml', '')
  check('Q_no_fixture_holds_a_real_env_file_or_bytecode', ['a-prices', 'b-loyalty', 'c-jinja', 'd-local', 'e-notes', 'f-config'].every(name => !listFiles(fixtureDir(name)).some(file => /(^|\/)\.env$|\.pyc$/.test(file))), '')
  const ownSource = readFileSync(path.join(repo, 'lib/native-builder/foundryToolReasoning.validation.ts'), 'utf8')
  check('T_no_fixture_is_read_from_tmp', !/['"`]tmp\/foundry/.test(ownSource) && ownSource.includes(FIXTURES), '')

  const failed = results.filter(item => !item.pass)
  console.log(`TOOL_REASONING_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
main()
