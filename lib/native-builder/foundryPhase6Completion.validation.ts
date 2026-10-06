/**
 * Phase 6 completion-gate validation: the receipt combining self-review, independent verification, and disagreement
 * resolution, plus the loop-bound (retired-finding dedupe) helpers. Real scenarios, then mutation checks.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as completionModule from './foundryPhase6Completion'
import type { IndependentVerdict } from './foundryIndependentVerifier'
import type { SelfReviewResult } from './foundrySelfReview'
import type { DisagreementRecord } from './foundryReviewDisagreement'
import type { Phase6Finding } from './foundryPhase6Types'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }
const ROOT = resolveRepoRoot()

function selfReview(findings: Phase6Finding[], recommendation: 'COMPLETE' | 'REPAIR_NEEDED'): SelfReviewResult {
  return { missionId: 'm1', generation: 1, reviewedArtifactIds: [], acceptanceCoverage: [], findings, contradictions: [], regressionRisks: [], evidenceGaps: [], scopeAssessment: { inScope: [], outOfScope: [] }, implementationAssessment: '', recommendation, evidenceRefs: [] }
}
function independent(findings: Phase6Finding[], recommendation: 'COMPLETE' | 'REPAIR_NEEDED'): IndependentVerdict {
  return { missionId: 'm1', generation: 1, acceptanceCoverage: [], findings, recommendation, evidenceRefs: [] }
}
const provenFinding: Phase6Finding = { findingId: 'f1', severity: 'BLOCKING', claim: 'a real gap', evidenceRefs: [], affectedFiles: [], confidenceClass: 'DIRECTLY_PROVEN', actionability: 'REPAIR' }
const resolvedComplete: DisagreementRecord = { disagreementId: 'd1', selfReviewRecommendation: 'COMPLETE', independentRecommendation: 'REPAIR_NEEDED', status: 'DISAGREEMENT_RESOLVED', resolution: 'COMPLETE', reason: 'unsupported' }
const resolvedRepair: DisagreementRecord = { disagreementId: 'd2', selfReviewRecommendation: 'COMPLETE', independentRecommendation: 'REPAIR_NEEDED', status: 'DISAGREEMENT_RESOLVED', resolution: 'REPAIR_NEEDED', reason: 'proven' }
const openProbe: DisagreementRecord = { disagreementId: 'd3', selfReviewRecommendation: 'COMPLETE', independentRecommendation: 'REPAIR_NEEDED', status: 'DISAGREEMENT_PROBE', reason: 'needs a probe' }

type Module = typeof completionModule

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }

  const clean = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'COMPLETE'), disagreement: null })
  expect('correct_work_with_no_findings_completes', clean.complete === true)

  const blocked = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([provenFinding], 'REPAIR_NEEDED'), independentVerdict: independent([], 'COMPLETE'), disagreement: null })
  expect('a_directly_proven_blocking_finding_prevents_completion', blocked.complete === false)

  const retired = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([provenFinding], 'REPAIR_NEEDED'), independentVerdict: independent([], 'COMPLETE'), disagreement: null, retiredFindingKeys: [module.findingKey(provenFinding)] })
  expect('a_retired_finding_no_longer_blocks_completion', retired.complete === true)

  const openDisagreement = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'REPAIR_NEEDED'), disagreement: openProbe })
  expect('an_open_disagreement_blocks_completion', openDisagreement.complete === false)

  const disagreementResolvedComplete = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'REPAIR_NEEDED'), disagreement: resolvedComplete })
  expect('a_disagreement_resolved_to_complete_allows_completion', disagreementResolvedComplete.complete === true)

  const disagreementResolvedRepair = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'REPAIR_NEEDED'), disagreement: resolvedRepair })
  expect('a_disagreement_resolved_to_repair_blocks_completion', disagreementResolvedRepair.complete === false)

  const persistenceFail = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'COMPLETE'), disagreement: null, persistence: { required: true, survived: false } })
  expect('failed_required_persistence_blocks_completion', persistenceFail.complete === false)

  const persistenceOk = module.phase6CompletionAllowed({ missionId: 'm1', generation: 1, selfReview: selfReview([], 'COMPLETE'), independentVerdict: independent([], 'COMPLETE'), disagreement: null, persistence: { required: true, survived: true } })
  expect('held_required_persistence_allows_completion', persistenceOk.complete === true)

  return failed
}

async function main() {
  const failedReal = scenarios(completionModule)
  const names = ['correct_work_with_no_findings_completes', 'a_directly_proven_blocking_finding_prevents_completion', 'a_retired_finding_no_longer_blocks_completion', 'an_open_disagreement_blocks_completion', 'a_disagreement_resolved_to_complete_allows_completion', 'a_disagreement_resolved_to_repair_blocks_completion', 'failed_required_persistence_blocks_completion', 'held_required_persistence_allows_completion']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundryPhase6Completion.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(src), '')
  check('W_reuses_the_same_claim_key_as_the_reviewer', src.includes("from './foundryAcceptanceBasis'") && src.includes('reviewClaimKey'), '')

  const file = path.join(ROOT, 'lib/native-builder/foundryPhase6Completion.ts')
  const mutations: Mutation[] = [
    { name: 'blocking_findings_no_longer_block_completion', from: 'unresolvedBlockingFindings.length === 0 && persistenceOk && !disagreementOpen && !disagreementBlocksCompletion', to: 'true' },
    { name: 'retired_findings_no_longer_removed', from: 'return findings.filter(item => !retired.has(findingKey(item)))', to: 'return findings' },
    { name: 'open_disagreement_no_longer_blocks', from: "Boolean(input.disagreement && input.disagreement.status !== 'DISAGREEMENT_RESOLVED')", to: 'false' },
    { name: 'a_disagreement_resolved_to_repair_no_longer_blocks', from: "input.disagreement?.status === 'DISAGREEMENT_RESOLVED' && input.disagreement.resolution === 'REPAIR_NEEDED'", to: 'false' },
    { name: 'required_persistence_no_longer_checked', from: '!input.persistence?.required || input.persistence.survived', to: 'true' },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  // This one suite proves both the loop bound (retired findings stay retired) and the persistence gate (required survival blocks completion).
  console.log(`REVIEW_LOOP_BOUND_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  console.log(`PERSISTENCE_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
