/**
 * ENGINE-05E PolicyPromotionEngine
 * Recommendation only. Commander fingerprint required. No self-promotion.
 */
import { createHash } from 'node:crypto'
import { ENGINE_05_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { loadPolicy, savePolicy, savePromotion } from '../evaluation/store'
import type {
  EmpiricalPolicyCandidate,
  PolicyEvaluationResult,
  PolicyParameters,
  PromotionReceipt,
  PromotionRecommendation,
} from '../evaluation/types'
import { PROMOTION_RECEIPT_SCHEMA } from '../evaluation/types'

export function fingerprintPolicy(policy_id: string, version: string, params: PolicyParameters): string {
  return createHash('sha256').update(`${policy_id}|${version}|${JSON.stringify(params)}`).digest('hex').slice(0, 24)
}

export function recommendPromotion(evalResult: PolicyEvaluationResult): PromotionRecommendation {
  if (evalResult.auto_promoted) return 'DO_NOT_PROMOTE'
  if (evalResult.authority_regression || evalResult.truth_regression || evalResult.safety_regression) return 'DO_NOT_PROMOTE'
  if (evalResult.overfit) return 'DO_NOT_PROMOTE'
  if (evalResult.baseline_policy === 'BASELINE_UNAVAILABLE') return 'MORE_EVIDENCE_REQUIRED'
  if (evalResult.sample_count < 3) return 'MORE_EVIDENCE_REQUIRED'
  if (evalResult.result === 'SUPPORTED' && evalResult.held_out && evalResult.development) return 'PROMOTE'
  if (evalResult.result === 'REJECTED') return 'DO_NOT_PROMOTE'
  return 'INCONCLUSIVE'
}

export function mayReachCommanderReview(evalResult: PolicyEvaluationResult): boolean {
  return recommendPromotion(evalResult) === 'PROMOTE'
    && !evalResult.overfit
    && !evalResult.authority_regression
    && !evalResult.truth_regression
    && !evalResult.safety_regression
    && evalResult.sample_count >= 3
    && Boolean(evalResult.held_out)
}

export async function buildPromotionReceipt(input: {
  mission_id: string
  evalResult: PolicyEvaluationResult
  persist?: boolean
}): Promise<PromotionReceipt> {
  const started = Date.now()
  const recommendation = recommendPromotion(input.evalResult)
  const candidate = input.evalResult.candidate
  const fp = fingerprintPolicy(candidate.policy_id, candidate.version, candidate.changed_parameters)
  const row: PromotionReceipt = {
    schema: PROMOTION_RECEIPT_SCHEMA,
    promotion_id: `promo-${candidate.policy_id}-${started}`,
    policy_id: candidate.policy_id,
    baseline: String(input.evalResult.baseline_policy),
    candidate_version: candidate.version,
    evaluations: [input.evalResult.evaluation_id],
    improvements: input.evalResult.result === 'SUPPORTED' ? ['observed_dev_and_held_out_pass'] : [],
    regressions: [
      input.evalResult.authority_regression ? 'authority' : '',
      input.evalResult.truth_regression ? 'truth' : '',
      input.evalResult.overfit ? 'POLICY_OVERFIT' : '',
    ].filter(Boolean),
    tradeoffs: [candidate.hypothesis.proposed_change, candidate.hypothesis.falsifier],
    sample_size: input.evalResult.sample_count,
    confidence_state: input.evalResult.sample_count < 3 ? 'INSUFFICIENT_SAMPLE' : input.evalResult.result === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'OBSERVED',
    known_limitations: input.evalResult.limitations,
    rollback_policy: candidate.baseline_policy,
    recommendation,
    commander_decision: 'PENDING',
    approval_fingerprint: fp,
    auto_promoted: false,
    effective_at: null,
    receipt: createEngineReceipt({
      engine: 'policy-promotion',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: 1,
      decision: recommendation,
    }),
  }
  if (input.persist !== false) await savePromotion(row)
  return row
}

export async function applyCommanderApproval(input: {
  candidate: EmpiricalPolicyCandidate
  presented_fingerprint: string
  receipt: PromotionReceipt
}): Promise<{ ok: boolean; reason: string; candidate: EmpiricalPolicyCandidate; receipt: PromotionReceipt }> {
  const expected = fingerprintPolicy(input.candidate.policy_id, input.candidate.version, input.candidate.changed_parameters)
  if (input.presented_fingerprint !== expected || input.receipt.approval_fingerprint !== expected) {
    return { ok: false, reason: 'approval_fingerprint_mismatch', candidate: input.candidate, receipt: input.receipt }
  }
  if (input.receipt.recommendation !== 'PROMOTE') {
    return { ok: false, reason: 'recommendation_not_promote', candidate: input.candidate, receipt: input.receipt }
  }
  const approved: EmpiricalPolicyCandidate = {
    ...input.candidate,
    status: 'APPROVED',
    approval_fingerprint: expected,
    rollback_target: input.candidate.baseline_policy,
    applies_automatically: false,
  }
  const receipt: PromotionReceipt = {
    ...input.receipt,
    commander_decision: 'APPROVED',
    approval_fingerprint: expected,
    auto_promoted: false,
  }
  await savePolicy(approved)
  await savePromotion(receipt)
  return { ok: true, reason: 'approved_not_yet_production', candidate: approved, receipt }
}

export async function promoteApproved(input: {
  candidate: EmpiricalPolicyCandidate
  fingerprint: string
  receipt: PromotionReceipt
}): Promise<{ ok: boolean; reason: string; candidate: EmpiricalPolicyCandidate; receipt: PromotionReceipt }> {
  const expected = fingerprintPolicy(input.candidate.policy_id, input.candidate.version, input.candidate.changed_parameters)
  if (input.candidate.status !== 'APPROVED') return { ok: false, reason: 'not_approved', candidate: input.candidate, receipt: input.receipt }
  if (input.fingerprint !== expected) return { ok: false, reason: 'fingerprint_invalidated', candidate: input.candidate, receipt: input.receipt }
  const promoted: EmpiricalPolicyCandidate = {
    ...input.candidate,
    status: 'PROMOTED',
    rollback_target: input.candidate.rollback_target ?? input.candidate.baseline_policy,
  }
  const receipt: PromotionReceipt = {
    ...input.receipt,
    commander_decision: 'APPROVED',
    effective_at: new Date().toISOString(),
    rollback_policy: promoted.rollback_target ?? promoted.baseline_policy,
    auto_promoted: false,
  }
  await savePolicy(promoted)
  await savePromotion(receipt)
  return { ok: true, reason: 'promoted_with_commander', candidate: promoted, receipt }
}

export async function rollbackPolicy(input: {
  promoted: EmpiricalPolicyCandidate
  receipt: PromotionReceipt
}): Promise<{ ok: boolean; history_retained: true; candidate: EmpiricalPolicyCandidate; receipt: PromotionReceipt }> {
  const rolled: EmpiricalPolicyCandidate = {
    ...input.promoted,
    status: 'RETIRED',
  }
  const receipt: PromotionReceipt = {
    ...input.receipt,
    commander_decision: 'ROLLED_BACK',
    auto_promoted: false,
  }
  await savePolicy(rolled)
  await savePromotion(receipt)
  if (input.promoted.rollback_target) {
    const previous = await loadPolicy(input.promoted.rollback_target)
    void previous
  }
  return { ok: true, history_retained: true, candidate: rolled, receipt }
}

export function mutatingCandidateInvalidatesApproval(before: EmpiricalPolicyCandidate, after: PolicyParameters): boolean {
  return fingerprintPolicy(before.policy_id, before.version, before.changed_parameters)
    !== fingerprintPolicy(before.policy_id, before.version, after)
}

export const ENGINE_05_RUNTIME = ENGINE_05_VERSION
