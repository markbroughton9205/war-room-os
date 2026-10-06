/**
 * Independent verifier validation. Real scenarios on the e-notes fixture, then mutation checks.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptanceBasis } from './foundryAcceptanceBasis'
import * as verifierModule from './foundryIndependentVerifier'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const ROOT = resolveRepoRoot()
const FIXTURE = path.join(ROOT, 'lib/native-builder/__fixtures__/foundry-phase5/e-notes')
const read = (rel: string) => readFileSync(path.join(FIXTURE, rel), 'utf8')

const REQUEST = 'Make bold text safe to embed in the report renderer'
const RENDERER_GREEN = read('reports/renderer.py').replace('from jinja2 import Environment, Markup', 'from jinja2 import Environment\nfrom markupsafe import Markup')
const MONEY = read('reports/money.py')
const TEST = read('tests/test_renderer.py')
const contractBasis = acceptanceBasis({
  request: REQUEST,
  acceptance: [REQUEST],
  contracts: ['ACCEPTANCE_ESCAPES = "bold escapes the text it is given"\nACCEPTANCE_AMOUNT = "a row shows the amount with two decimals"\n'],
})
const sources = [
  { file: 'reports/renderer.py', text: RENDERER_GREEN, role: 'source' as const },
  { file: 'reports/money.py', text: MONEY, role: 'source' as const },
  { file: 'tests/test_renderer.py', text: TEST, role: 'test' as const },
]

const SPURIOUS = "STATUS fail: The bold function makes text safe to embed in a page, but the REQUEST is to make bold text safe to embed in the report renderer."
const ABSENT_REAL = 'STATUS fail: the `format_amount` function is missing, so a row does not show the amount with two decimals.'
const UNCOVERED = 'STATUS fail: the money amount in a row does not show two decimals when it is large.'

type Module = typeof verifierModule

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }

  const clean = module.runIndependentVerification({
    missionId: 'm1', generation: 1, basis: contractBasis, sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: true, filesMeetCriteria: true,
  })
  expect('correct_implementation_with_no_claim_is_complete', clean.recommendation === 'COMPLETE' && clean.findings.length === 0)

  const wrongGoal = module.runIndependentVerification({
    missionId: 'm1', generation: 1, basis: contractBasis, sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: true, filesMeetCriteria: false,
  })
  expect('direct_contract_failure_blocks_even_without_a_reviewer_claim', wrongGoal.recommendation === 'REPAIR_NEEDED' && wrongGoal.findings.some(item => item.confidenceClass === 'DIRECTLY_PROVEN'))

  const withSpuriousClaim = module.runIndependentVerification({
    missionId: 'm1', generation: 1, basis: contractBasis, sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: true, filesMeetCriteria: true, claim: SPURIOUS,
  })
  expect('an_unsupported_contrary_claim_does_not_force_repair', withSpuriousClaim.recommendation === 'COMPLETE')

  const retiredClaimClass = module.classifyIndependentClaim(SPURIOUS, { basis: contractBasis, earlierClaims: [], testsGreenNow: true, filesMeetCriteria: true, sources })
  expect('a_claim_the_evidence_retires_classifies_as_unsupported', retiredClaimClass.confidenceClass === 'UNSUPPORTED' && retiredClaimClass.severity === 'ADVISORY')

  const withRealClaim = module.runIndependentVerification({
    missionId: 'm1', generation: 1, basis: contractBasis, sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: true, filesMeetCriteria: false, claim: ABSENT_REAL,
  })
  expect('an_unmet_explicit_criterion_forces_repair', withRealClaim.recommendation === 'REPAIR_NEEDED' && withRealClaim.findings.some(item => item.confidenceClass === 'DIRECTLY_PROVEN'))

  const uncovered = module.classifyIndependentClaim(UNCOVERED, {
    basis: contractBasis, earlierClaims: [], testsGreenNow: true, filesMeetCriteria: true, sources,
  })
  expect('a_claim_about_real_code_no_test_covers_needs_a_probe', uncovered.confidenceClass === 'PLAUSIBLE_NEEDS_PROBE' && uncovered.actionability === 'PROBE')

  const missingCoverage = module.runIndependentVerification({
    missionId: 'm1', generation: 1,
    basis: acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: ['ACCEPTANCE_NEVER = "a receipt id is logged for every export"\n'] }),
    sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: true, filesMeetCriteria: null,
  })
  expect('own_acceptance_mapping_catches_an_uncovered_criterion_with_no_claim_at_all', missingCoverage.recommendation === 'REPAIR_NEEDED')

  const redTests = module.runIndependentVerification({
    missionId: 'm1', generation: 1, basis: contractBasis, sources, primaryFiles: ['reports/renderer.py'], testsGreenNow: false, filesMeetCriteria: true,
  })
  expect('red_tests_force_repair', redTests.recommendation === 'REPAIR_NEEDED')

  return failed
}

async function main() {
  const failedReal = scenarios(verifierModule)
  const names = ['direct_contract_failure_blocks_even_without_a_reviewer_claim', 'correct_implementation_with_no_claim_is_complete', 'an_unsupported_contrary_claim_does_not_force_repair', 'a_claim_the_evidence_retires_classifies_as_unsupported', 'an_unmet_explicit_criterion_forces_repair', 'a_claim_about_real_code_no_test_covers_needs_a_probe', 'own_acceptance_mapping_catches_an_uncovered_criterion_with_no_claim_at_all', 'red_tests_force_repair']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  // ---- wiring / independence
  const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundryIndependentVerifier.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(src), '')
  check('W_never_takes_the_implementer_conclusion_as_input', !/implementerClaim|implementationSucceeded|testsPassedAccordingToImplementer/.test(src), '')
  check('W_reuses_the_same_disk_evidence_binding_as_the_reviewer', src.includes('decideReviewClaim'), '')

  // ---- mutation checks
  const file = path.join(ROOT, 'lib/native-builder/foundryIndependentVerifier.ts')
  const mutations: Mutation[] = [
    { name: 'direct_contract_failure_no_longer_blocks', from: 'if (input.filesMeetCriteria === false) {', to: 'if (false as boolean) {' },
    { name: 'unsupported_claim_now_forces_repair', from: "confidenceClass: 'UNSUPPORTED',\n    actionability: 'NONE',", to: "confidenceClass: 'DIRECTLY_PROVEN' as const,\n    actionability: 'REPAIR' as const," },
    { name: 'needs_probe_case_treated_as_directly_proven', from: "const confidenceClass: EvidenceClass = needsProbe ? 'PLAUSIBLE_NEEDS_PROBE' : 'DIRECTLY_PROVEN'", to: "const confidenceClass: EvidenceClass = 'DIRECTLY_PROVEN'" },
    { name: 'uncovered_criterion_no_longer_reported', from: "if (item.evidenced) continue", to: 'continue' },
    { name: 'red_tests_no_longer_block', from: "if (!input.testsGreenNow) {", to: 'if (false as boolean) {' },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`INDEPENDENT_VERIFICATION_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
