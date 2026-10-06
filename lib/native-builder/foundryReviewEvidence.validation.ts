/**
 * Evidence-bound review. Pure scenarios on the real Phase 5 fixture files (the Proof E memory mission), then mutation checks:
 * every rule of the module is removed in turn and a scenario must notice.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptanceBasis } from './foundryAcceptanceBasis'
import * as reviewEvidence from './foundryReviewEvidence'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const ROOT = resolveRepoRoot()
const FIXTURE = path.join(ROOT, 'lib/native-builder/__fixtures__/foundry-phase5/e-notes')
const read = (rel: string) => readFileSync(path.join(FIXTURE, rel), 'utf8')

const REQUEST = 'Make bold text safe to embed in the report renderer'
// The repaired state on disk: the fix is in, the tests pass on exactly these files.
const RENDERER_GREEN = read('reports/renderer.py').replace('from jinja2 import Environment, Markup', 'from jinja2 import Environment\nfrom markupsafe import Markup')
const sources = [
  { file: 'reports/renderer.py', text: RENDERER_GREEN, role: 'source' as const },
  { file: 'reports/money.py', text: read('reports/money.py'), role: 'source' as const },
  { file: 'tests/test_renderer.py', text: read('tests/test_renderer.py'), role: 'test' as const },
]
const basis = acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: [] })
const contractBasis = acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: ['ACCEPTANCE_ESCAPES = "bold escapes the text it is given"\nACCEPTANCE_AMOUNT = "a row shows the amount with two decimals"\n'] })
const green = { basis, earlierClaims: [] as string[], testsGreenNow: true, filesMeetCriteria: null as boolean | null, sources }

// The claim the local reviewer really produced on a green, accepted mission (recorded run).
const SPURIOUS = "STATUS fail: The bold function makes text safe to embed in a page, but the REQUEST is to make bold text safe to embed in the report renderer."
const ABSENT_PRESENT = 'STATUS fail: the `bold` function is missing from the renderer.'
const ABSENT_REAL = 'STATUS fail: the `format_amount` function is missing, so a row does not show the amount with two decimals.'
const TEST_FAIL_CLAIM = 'STATUS fail: test_bold_escapes_the_text does not pass because money is wrong in the renderer.'
const UNMET_PROSE = 'STATUS fail: the row does not show the amount with two decimals.'
const NUMBERED_CLAIM = 'STATUS fail: acceptance criterion 2 is not satisfied, the row shows the amount with one decimal.'
const CRITERION_CLAIM = 'STATUS fail: ACCEPTANCE_AMOUNT is not implemented, a row does not show two decimals.'
const UNCOVERED_CLAIM = 'STATUS fail: the money amount in a row does not show two decimals when it is large.'
const PROSE_CLAIM = 'STATUS fail: the report does not feel safe enough for the request.'

type Module = typeof reviewEvidence

/** The scenarios, run against a module (the real one, or a mutant). Returns the names of the scenarios that failed. */
function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }
  const decide = (claim: string, evidence: Partial<typeof green> & { basis?: typeof basis }) => module.decideReviewClaim(claim, { ...green, ...evidence } as never).decision
  // green state + unsupported claim: retired, no rework
  expect('green_unsupported_claim_is_retired', decide(SPURIOUS, {}) === 'RETIRED_CONTRADICTED_BY_TESTS')
  expect('green_prose_that_points_at_nothing_is_retired', decide(PROSE_CLAIM, {}) === 'RETIRED_CONTRADICTED_BY_TESTS')
  // a legitimate finding still reworks
  expect('failing_tests_still_rework', decide(SPURIOUS, { testsGreenNow: false }) === 'REOPEN')
  expect('an_unmet_explicit_criterion_still_reworks', decide(UNMET_PROSE, { basis: contractBasis, filesMeetCriteria: false }) === 'REOPEN')
  expect('the_same_prose_is_retired_when_the_files_meet_the_criteria', decide(UNMET_PROSE, { basis: contractBasis, filesMeetCriteria: true }) === 'RETIRED_CONTRADICTED_BY_TESTS')
  expect('a_claim_naming_a_criterion_still_reworks_on_green_tests', decide(NUMBERED_CLAIM, { basis: contractBasis }) === 'REOPEN')
  expect('a_missing_thing_that_is_really_missing_still_reworks', decide(ABSENT_REAL, { basis: contractBasis }) === 'REOPEN')
  expect('a_concern_about_code_no_test_covers_still_reworks', decide(UNCOVERED_CLAIM, { basis: contractBasis }) === 'REOPEN')
  // contradiction with disk truth
  expect('a_missing_claim_contradicted_by_the_disk_is_retired', decide(ABSENT_PRESENT, {}) === 'RETIRED_CONTRADICTED_BY_DISK')
  // contradiction with a passing acceptance test
  expect('a_failing_test_claim_contradicted_by_a_passing_suite_is_retired', decide(TEST_FAIL_CLAIM, {}) === 'RETIRED_CONTRADICTED_BY_TESTS')
  expect('the_same_claim_with_failing_tests_is_not_retired', decide(TEST_FAIL_CLAIM, { testsGreenNow: false }) === 'REOPEN')
  // no false reopening
  const key = module.decideReviewClaim(CRITERION_CLAIM, { ...green, basis: contractBasis } as never).key
  expect('the_same_handled_claim_again_is_settled', decide(CRITERION_CLAIM, { basis: contractBasis, earlierClaims: [key] }) === 'SET_ASIDE_SETTLED')
  expect('an_ordinary_word_is_not_a_missing_name', module.claimedAbsent('STATUS fail: the status filter is missing from the board').length === 0)
  expect('a_code_name_is_a_missing_name', module.claimedAbsent(ABSENT_PRESENT).join() === 'bold')
  return failed
}

async function main() {
  const failedReal = scenarios(reviewEvidence)
  const names = ['green_unsupported_claim_is_retired', 'green_prose_that_points_at_nothing_is_retired', 'failing_tests_still_rework', 'an_unmet_explicit_criterion_still_reworks', 'the_same_prose_is_retired_when_the_files_meet_the_criteria', 'a_claim_naming_a_criterion_still_reworks_on_green_tests', 'a_missing_thing_that_is_really_missing_still_reworks', 'a_concern_about_code_no_test_covers_still_reworks', 'a_missing_claim_contradicted_by_the_disk_is_retired', 'a_failing_test_claim_contradicted_by_a_passing_suite_is_retired', 'the_same_claim_with_failing_tests_is_not_retired', 'the_same_handled_claim_again_is_settled', 'an_ordinary_word_is_not_a_missing_name', 'a_code_name_is_a_missing_name']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  // The recorded claim, decided step by step on the fixture files.
  const verdict = reviewEvidence.decideReviewClaim(SPURIOUS, green as never)
  check('S_the_recorded_spurious_claim_retires_because_the_tests_cover_bold', verdict.decision === 'RETIRED_CONTRADICTED_BY_TESTS' && /bold/.test(verdict.because), verdict.because)
  check('S_the_notes_are_plain_language', (['RETIRED_CONTRADICTED_BY_DISK', 'RETIRED_CONTRADICTED_BY_TESTS', 'SET_ASIDE_UNSUPPORTED', 'SET_ASIDE_SETTLED'] as const).every(kind => reviewEvidence.evidenceNote(kind).length > 30 && !/RETIRED|SET_ASIDE|CONTRADICTED/.test(reviewEvidence.evidenceNote(kind))), '')
  check('S_a_claim_matching_no_criterion_is_still_set_aside_first', reviewEvidence.decideReviewClaim('The weather is nice today', green as never).decision === 'SET_ASIDE_UNSUPPORTED', '')

  // ---- wiring
  const runtime = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8')
  check('W_the_reviewer_claim_is_decided_against_disk_tests_and_criteria', ['decideReviewClaim(call.result.summary, {', 'testsGreenNow: testsGreenAtCurrentGeneration(state)', 'sources: evidenceSourcesOf()', "if (verdict.decision !== 'REOPEN')"].every(text => runtime.includes(text)), '')
  check('W_a_retired_claim_is_recorded_and_explained_plainly', runtime.includes('REVIEW_SET_ASIDE') && runtime.includes('evidenceNote(setAside)'), '')
  const module = readFileSync(path.join(ROOT, 'lib/native-builder/foundryReviewEvidence.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(module), '')

  // ---- mutation checks: remove each rule, a scenario must notice
  const file = path.join(ROOT, 'lib/native-builder/foundryReviewEvidence.ts')
  const mutations: Mutation[] = [
    { name: 'unmet_criterion_no_longer_reopens', from: "if (evidence.filesMeetCriteria === false) return reopen('the files do not meet an explicit acceptance criterion')", to: '' },
    { name: 'failing_tests_no_longer_reopen', from: "if (!evidence.testsGreenNow) return reopen('the tests do not pass on the current files')", to: '' },
    { name: 'disk_contradiction_disabled', from: 'if (present.length && present.length === absent.length) return retire', to: 'if (false as boolean) return retire' },
    { name: 'a_missing_thing_is_never_missing', from: "if (absent.length) return reopen(", to: "if (false as boolean) return reopen(" },
    { name: 'passing_test_contradiction_disabled', from: 'if (failing.length) return retire', to: 'if (false as boolean) return retire' },
    { name: 'test_coverage_never_retires', from: 'if (covered.length) return retire', to: 'if (false as boolean) return retire' },
    { name: 'pointing_at_nothing_never_retires', from: 'if (!subjects.length) return retire', to: 'if (false as boolean) return retire' },
    { name: 'a_named_criterion_no_longer_protects_the_claim', from: "if (citesCriterion(claim, evidence.basis)) return reopen('it names an explicit acceptance criterion')", to: '' },
    { name: 'every_word_counts_as_a_code_name', from: "if (/_/.test(name) || /[a-z][A-Z]/.test(name)) return true", to: 'return true' },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`REVIEW_EVIDENCE_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
