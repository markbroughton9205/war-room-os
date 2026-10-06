/**
 * Self-review validation. Real scenarios on the e-notes fixture files, then mutation checks: every rule of the module is
 * removed in turn and a scenario must notice.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptanceBasis } from './foundryAcceptanceBasis'
import { runSelfReview, type SelfReviewInput } from './foundrySelfReview'
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
const UNRELATED = 'def helper():\n    return 1\n'
const basis = acceptanceBasis({
  request: REQUEST,
  acceptance: [REQUEST],
  contracts: ['ACCEPTANCE_ESCAPES = "bold escapes the text it is given"\nACCEPTANCE_AMOUNT = "a row shows the amount with two decimals"\n'],
})

function baseInput(overrides: Partial<SelfReviewInput> = {}): SelfReviewInput {
  return {
    missionId: 'm1',
    generation: 1,
    basis,
    sources: [
      { file: 'reports/renderer.py', text: RENDERER_GREEN, role: 'source' },
      { file: 'reports/money.py', text: MONEY, role: 'source' },
      { file: 'tests/test_renderer.py', text: TEST, role: 'test' },
    ],
    touchedFiles: ['reports/renderer.py'],
    primaryFiles: ['reports/renderer.py'],
    testsGreenNow: true,
    ...overrides,
  }
}

type Module = { runSelfReview: typeof runSelfReview }

/** The scenarios, run against a module (the real one, or a mutant). Returns the names of the scenarios that failed. */
function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }

  const clean = module.runSelfReview(baseInput())
  expect('clean_implementation_is_complete', clean.recommendation === 'COMPLETE' && clean.findings.length === 0)

  const missingCriterion = module.runSelfReview(baseInput({
    basis: acceptanceBasis({ request: REQUEST, acceptance: [REQUEST], contracts: ['ACCEPTANCE_NEVER = "a receipt id is logged for every export"\n'] }),
  }))
  expect('an_uncovered_criterion_blocks_completion', missingCriterion.recommendation === 'REPAIR_NEEDED' && missingCriterion.findings.some(item => item.claim.includes('receipt')))

  const outOfScope = module.runSelfReview(baseInput({
    sources: [
      { file: 'reports/renderer.py', text: RENDERER_GREEN, role: 'source' },
      { file: 'reports/money.py', text: MONEY, role: 'source' },
      { file: 'reports/unrelated.py', text: UNRELATED, role: 'source' },
      { file: 'tests/test_renderer.py', text: TEST, role: 'test' },
    ],
    touchedFiles: ['reports/renderer.py', 'reports/unrelated.py'],
  }))
  expect('a_touched_file_unreachable_from_primary_is_out_of_scope', outOfScope.scopeAssessment.outOfScope.includes('reports/unrelated.py') && outOfScope.recommendation === 'REPAIR_NEEDED')

  const reachableDependency = module.runSelfReview(baseInput({ touchedFiles: ['reports/renderer.py', 'reports/money.py'] }))
  expect('a_touched_dependency_reachable_from_primary_is_in_scope', reachableDependency.scopeAssessment.inScope.includes('reports/money.py') && reachableDependency.scopeAssessment.outOfScope.length === 0)

  const redTests = module.runSelfReview(baseInput({ testsGreenNow: false }))
  expect('tests_not_green_blocks_completion', redTests.recommendation === 'REPAIR_NEEDED')

  const falseClaim = module.runSelfReview(baseInput({ implementerClaim: 'The `bold` function is missing from the renderer.' }))
  expect('a_claim_the_disk_contradicts_is_recorded', falseClaim.contradictions.some(item => item.includes('bold')))

  const restartFail = module.runSelfReview(baseInput({ restartEvidence: { required: true, survived: false } }))
  expect('required_persistence_that_fails_blocks_completion', restartFail.recommendation === 'REPAIR_NEEDED' && restartFail.contradictions.some(item => item.includes('restart')))

  const restartOk = module.runSelfReview(baseInput({ restartEvidence: { required: true, survived: true } }))
  expect('required_persistence_that_holds_does_not_block', restartOk.recommendation === 'COMPLETE')

  return failed
}

async function main() {
  const module = { runSelfReview }
  const failedReal = scenarios(module)
  const names = ['clean_implementation_is_complete', 'an_uncovered_criterion_blocks_completion', 'a_touched_file_unreachable_from_primary_is_out_of_scope', 'a_touched_dependency_reachable_from_primary_is_in_scope', 'tests_not_green_blocks_completion', 'a_claim_the_disk_contradicts_is_recorded', 'required_persistence_that_fails_blocks_completion', 'required_persistence_that_holds_does_not_block']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  // ---- wiring
  const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundrySelfReview.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(src), '')
  check('W_uses_the_same_evidence_binding_as_the_reviewer', src.includes("from './foundryReviewEvidence'") && src.includes("from './foundryEditScope'"), '')

  // ---- mutation checks
  const file = path.join(ROOT, 'lib/native-builder/foundrySelfReview.ts')
  const mutations: Mutation[] = [
    { name: 'uncovered_criterion_no_longer_blocks', from: "if (!evidenced) {", to: 'if (false as boolean) {' },
    { name: 'out_of_scope_no_longer_recorded', from: "for (const file of scopeAssessment.outOfScope) {", to: 'for (const file of [] as string[]) {' },
    { name: 'red_tests_no_longer_block', from: "if (!input.testsGreenNow) {", to: 'if (false as boolean) {' },
    { name: 'contradiction_no_longer_recorded', from: 'if (present.length) contradictions.push', to: 'if (false as boolean) contradictions.push' },
    { name: 'persistence_failure_no_longer_recorded', from: 'if (input.restartEvidence?.required && !input.restartEvidence.survived) {', to: 'if (false as boolean) {' },
    { name: 'recommendation_ignores_blocking_findings', from: "findings.some(item => item.severity === 'BLOCKING') ? 'REPAIR_NEEDED' : 'COMPLETE'", to: "'COMPLETE' as const" },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`SELF_REVIEW_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
