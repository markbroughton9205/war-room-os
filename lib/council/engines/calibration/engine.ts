import { createEngineReceipt } from '../receipts'
import type { CalibrationInput, CalibrationResult, CalibrationSignals, CalibrationState } from './types'

function collectSignals(input: CalibrationInput): CalibrationSignals {
  const assessments = input.assessments ?? []
  const accepted = assessments.filter(row => row.decision === 'ACCEPT')
  const bindings = input.bindings ?? []
  const conflicts = (input.conflicts ?? []).filter(row => row.resolution_state === 'open')
  const usable = bindings.length
    ? new Set(bindings.flatMap(row => row.evidence_refs)).size
    : accepted.length
  const independent = bindings.length
    ? new Set(bindings.flatMap(row => row.source_refs)).size
    : accepted.filter(row => row.independence_state === 'INDEPENDENT').length
  const primary = accepted.filter(row => row.primaryness_score >= 1).length
    || bindings.filter(row => row.support_type === 'DIRECT' || row.support_type === 'CORROBORATING').length
  const verified = bindings.filter(row => row.verification_state === 'VERIFIED' || row.verification_state === 'SUPPORTED').length
  const missing: string[] = []
  if (usable === 0) missing.push('usable evidence')
  if (independent < 2 && usable >= 1) missing.push('independent corroboration')
  if (primary === 0 && usable >= 1) missing.push('primary source class')
  return {
    usable_source_count: usable,
    independent_source_count: independent,
    authority_accept_count: accepted.filter(row => row.authority_score >= 0.9).length,
    primary_source_count: primary,
    freshness_in_window_count: accepted.filter(row => row.freshness_state === 'IN_WINDOW').length,
    freshness_required: assessments.some(row => row.decision === 'DATE_UNKNOWN' || row.decision === 'REJECT_STALE' || row.freshness_state !== 'DATE_UNKNOWN' && row.reasons.some(reason => /window/i.test(reason))),
    contradiction_count: conflicts.length + bindings.filter(row => row.support_type === 'CONTRADICTING').length,
    missing_required_evidence: missing,
    tool_failures: input.tool_failures ?? assessments.filter(row => row.decision === 'REJECT_EXTRACTION_FAILED').length,
    stale_evidence_count: assessments.filter(row => row.decision === 'REJECT_STALE').length + bindings.filter(row => row.verification_state === 'STALE').length,
    verification_coverage: bindings.length ? verified / bindings.length : 0,
    question_ambiguous: input.question_ambiguous === true,
    cross_model_disagreement: input.cross_model_disagreement === true,
    source_diversity: independent,
  }
}

function commanderFacing(state: CalibrationState): string {
  switch (state) {
    case 'HIGH_SUPPORT':
      return 'multiple independent primary sources agree'
    case 'MODERATE_SUPPORT':
      return 'supported by authoritative sources'
    case 'SINGLE_SOURCE':
      return 'supported by one authoritative source'
    case 'CONFLICTING':
      return 'sources conflict'
    case 'STALE':
      return 'evidence is stale'
    case 'LIVE_VERIFICATION_FAILED':
      return 'live verification failed'
    case 'INSUFFICIENT_EVIDENCE':
    case 'UNVERIFIED':
      return 'live verification failed'
    case 'PARTIALLY_VERIFIED':
      return 'supported by one authoritative source'
  }
}

export function calibrateUncertainty(input: CalibrationInput): CalibrationResult {
  const started = Date.now()
  const signals = collectSignals(input)
  const reasons: string[] = []
  let state: CalibrationState = 'UNVERIFIED'

  if (signals.contradiction_count > 0) {
    state = 'CONFLICTING'
    reasons.push(`${signals.contradiction_count} open contradiction(s) preserved; certainty is not averaged away`)
  } else if (signals.usable_source_count === 0 && signals.tool_failures > 0) {
    state = 'LIVE_VERIFICATION_FAILED'
    reasons.push(`${signals.tool_failures} tool/fetch failure(s) and zero usable evidence`)
  } else if (signals.usable_source_count === 0) {
    state = 'INSUFFICIENT_EVIDENCE'
    reasons.push('zero usable evidence; cannot become VERIFIED or externally SUPPORTED')
  } else if (signals.stale_evidence_count > 0 && signals.freshness_in_window_count === 0 && signals.freshness_required) {
    state = 'STALE'
    reasons.push('strict freshness window is unmet; retrieved_at is not publication freshness')
  } else if (signals.independent_source_count <= 1) {
    state = 'SINGLE_SOURCE'
    reasons.push(`${signals.usable_source_count} usable source(s) collapse to ${signals.independent_source_count} independent identit${signals.independent_source_count === 1 ? 'y' : 'ies'}`)
  } else if (signals.verification_coverage > 0 && signals.verification_coverage < 1) {
    state = 'PARTIALLY_VERIFIED'
    reasons.push(`verification coverage ${Math.round(signals.verification_coverage * 100)}%`)
  } else if (signals.independent_source_count >= 2 && signals.primary_source_count >= 1 && signals.missing_required_evidence.length === 0) {
    state = 'HIGH_SUPPORT'
    reasons.push(`${signals.independent_source_count} independent sources`)
    reasons.push(`${signals.primary_source_count} primary source(s)`)
    reasons.push('no contradiction')
  } else if (signals.independent_source_count >= 2) {
    state = 'MODERATE_SUPPORT'
    reasons.push(`${signals.independent_source_count} independent authoritative sources`)
    reasons.push(`${signals.primary_source_count} primary source(s)`)
    reasons.push('no contradiction')
    if (signals.missing_required_evidence.length) reasons.push(`missing: ${signals.missing_required_evidence.join(', ')}`)
  } else {
    state = 'UNVERIFIED'
    reasons.push('observable signals do not support a stronger calibration state')
  }

  if (signals.question_ambiguous) reasons.push('question remains ambiguous')
  if (signals.cross_model_disagreement) reasons.push('cross-model disagreement present')

  return {
    state,
    reasons,
    commander_facing: commanderFacing(state),
    signals,
    receipt: createEngineReceipt({
      engine: 'calibration',
      mission_id: input.mission_id,
      input_refs: [`usable:${signals.usable_source_count}`, `independent:${signals.independent_source_count}`],
      output_refs: [state],
      started_at: started,
      decision_count: 1,
      failure_state: state === 'INSUFFICIENT_EVIDENCE' || state === 'LIVE_VERIFICATION_FAILED' ? 'no_usable_evidence' : signals.contradiction_count ? 'conflict_open' : 'none',
    }),
  }
}
