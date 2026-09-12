/**
 * #22 Phase 7 — Pure claim validation against evidence + runtime truth.
 * Does not rewrite Council output. FLAG + RETURN only.
 */
import type { CouncilValidatorScope } from './scope'
import {
  makeValidatedClaim,
  type CouncilClaimValidationState,
  type CouncilCorrectionRecommendation,
  type ValidatedClaim,
} from './result'

export type CouncilClaimInput = {
  claim_id?: string
  claim_text: string
  claim_type:
    | 'GENERAL'
    | 'RESEARCH'
    | 'TERRA'
    | 'OPERATIONS'
    | 'SECURITY'
    | 'ENGINEERING'
    | 'ASTRA'
    | 'POLICY'
    | 'AUTHORITY'
  evidence_refs?: string[]
  /** What evidence actually supports (fixture/runtime truth). */
  evidence_support?: 'SUPPORTED' | 'INFERRED' | 'UNVERIFIED' | 'CONFLICTING' | 'NONE' | 'PARTIAL'
  freshness?: 'LIVE' | 'CACHED' | 'STALE' | 'HISTORICAL' | 'NO_COVERAGE' | 'UNKNOWN' | string
  confidence_asserted?: 'DIRECT_FACT' | 'INFERRED' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  correlation_asserted?: 'CORROBORATED' | 'SINGLE_SOURCE' | string
  correlation_actual?: 'CORROBORATED' | 'SINGLE_SOURCE' | 'CONFLICTING' | string
  /** Misrepresentation probes. */
  asserts_live_from_cached?: boolean
  asserts_live_from_historical?: boolean
  asserts_absence_from_no_coverage?: boolean
  asserts_credentials_as_live?: boolean
  asserts_registered_as_implemented?: boolean
  asserts_terra_finding_as_authorization?: boolean
  asserts_process_exists_as_healthy?: boolean
  asserts_local_health_as_public?: boolean
  asserts_security_finding_as_remediation?: boolean
  asserts_patch_as_committed?: boolean
  asserts_build_as_deployed?: boolean
  asserts_astra_mission_as_authorized?: boolean
  asserts_planned_as_running?: boolean
  asserts_spawn_request_as_spawned?: boolean
  asserts_council_recommendation_as_approval?: boolean
  asserts_unanimous_as_commander_approval?: boolean
  asserts_validation_pass_as_execution?: boolean
  conflicting_sources?: string[]
  agent_result_ref?: string | null
}

export type ValidateClaimsInput = {
  scope: CouncilValidatorScope
  claims: CouncilClaimInput[]
  sessionIntelligencePresent?: boolean
}

export type ValidateClaimsOutput = {
  claims_checked: ValidatedClaim[]
  conflicts: string[]
  policy_conflicts: string[]
  runtime_truth_conflicts: string[]
  recommended_corrections: CouncilCorrectionRecommendation[]
  requires_council_revision: boolean
  requires_commander_review: boolean
  validation_pass: boolean
  evidence_summary: string
  freshness_summary: string
  limitations: string[]
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value)
}

export function validateCouncilClaims(input: ValidateClaimsInput): ValidateClaimsOutput {
  const claims_checked: ValidatedClaim[] = []
  const conflicts: string[] = []
  const policy_conflicts: string[] = []
  const runtime_truth_conflicts: string[] = []
  const recommended_corrections: CouncilCorrectionRecommendation[] = []
  const limitations: string[] = [
    'COUNCIL_VALIDATOR flags only — does not auto-rewrite Council synthesis.',
    'VALIDATED != AUTHORIZED',
    '#16 deliberation pipeline not replaced.',
    '#17 session intelligence not mutated.',
  ]

  const sliced = input.claims.slice(0, input.scope.max_claims)

  for (const claim of sliced) {
    const claimConflicts: string[] = []
    const claimLimitations: string[] = []
    let validation_result: CouncilClaimValidationState = 'PASS'
    let support_state = claim.evidence_support ?? 'UNVERIFIED'
    let freshness_state = claim.freshness ?? 'UNKNOWN'
    let confidence_state = claim.confidence_asserted ?? 'UNVERIFIED'
    let policy_state = 'OK'
    let runtime_truth_state = 'OK'

    const evidenceRefs = claim.evidence_refs ?? []

    // Evidence consistency
    if (support_state === 'NONE' || evidenceRefs.length === 0) {
      validation_result = 'INSUFFICIENT_EVIDENCE'
      support_state = 'NONE'
      claimLimitations.push('Claim lacks supporting evidence.')
      pushUnique(recommended_corrections, 'REQUEST_MORE_EVIDENCE')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    } else if (support_state === 'CONFLICTING' || (claim.conflicting_sources?.length ?? 0) > 1) {
      validation_result = 'CONFLICTING_EVIDENCE'
      for (const s of claim.conflicting_sources ?? []) claimConflicts.push(s)
      pushUnique(conflicts, `Claim ${claim.claim_id ?? claim.claim_text.slice(0, 40)} has conflicting evidence.`)
      pushUnique(recommended_corrections, 'MARK_CONFLICTING')
      pushUnique(recommended_corrections, 'LOWER_CONFIDENCE')
    } else if (support_state === 'PARTIAL') {
      validation_result = 'PARTIAL'
      claimLimitations.push('Evidence only partially supports the claim.')
      pushUnique(recommended_corrections, 'ADD_LIMITATION')
    } else if (support_state === 'INFERRED' && claim.confidence_asserted === 'DIRECT_FACT') {
      validation_result = 'FAIL'
      confidence_state = 'INFERRED_MISSTATED_AS_DIRECT'
      claimLimitations.push('Inference presented as direct fact.')
      pushUnique(recommended_corrections, 'LOWER_CONFIDENCE')
      pushUnique(recommended_corrections, 'REVISE_CLAIM')
    }

    // Freshness / provider truth mislabels
    if (claim.asserts_live_from_cached || (freshness_state === 'CACHED' && /live|current/i.test(claim.claim_text))) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'CACHED_MISLABELED_LIVE'
      pushUnique(runtime_truth_conflicts, 'Cached evidence presented as live/current.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
      pushUnique(recommended_corrections, 'MARK_STALE')
    }
    if (claim.asserts_live_from_historical || (freshness_state === 'HISTORICAL' && /live/i.test(claim.claim_text))) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'HISTORICAL_MISLABELED_LIVE'
      pushUnique(runtime_truth_conflicts, 'Historical evidence presented as live.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (freshness_state === 'STALE') {
      if (validation_result === 'PASS') validation_result = 'STALE_EVIDENCE'
      claimLimitations.push('Evidence is STALE.')
      pushUnique(recommended_corrections, 'MARK_STALE')
      pushUnique(recommended_corrections, 'LOWER_CONFIDENCE')
    }
    if (claim.asserts_absence_from_no_coverage || freshness_state === 'NO_COVERAGE') {
      if (claim.asserts_absence_from_no_coverage || /no vessels|nothing present|absent/i.test(claim.claim_text)) {
        validation_result = 'RUNTIME_TRUTH_CONFLICT'
        runtime_truth_state = 'NO_COVERAGE_MISLABELED_ABSENCE'
        pushUnique(runtime_truth_conflicts, 'NO_COVERAGE presented as object absence.')
        pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
        pushUnique(recommended_corrections, 'REVISE_CLAIM')
      }
    }
    if (claim.asserts_credentials_as_live) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'NEEDS_CREDENTIALS_MISLABELED_LIVE'
      pushUnique(runtime_truth_conflicts, 'NEEDS_CREDENTIALS presented as LIVE.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_registered_as_implemented) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'REGISTERED_MISLABELED_IMPLEMENTED'
      pushUnique(runtime_truth_conflicts, 'Registered provider presented as implemented.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }

    // Correlation overstatement
    if (
      claim.correlation_asserted === 'CORROBORATED' &&
      (claim.correlation_actual === 'SINGLE_SOURCE' || claim.correlation_actual === 'CONFLICTING')
    ) {
      validation_result = validation_result === 'PASS' ? 'FAIL' : validation_result
      claimLimitations.push('Single-source or conflicting evidence overstated as corroborated.')
      pushUnique(recommended_corrections, 'LOWER_CONFIDENCE')
      pushUnique(recommended_corrections, 'REVISE_CLAIM')
    }

    // Domain authority invariants
    if (claim.asserts_terra_finding_as_authorization) {
      validation_result = 'POLICY_CONFLICT'
      policy_state = 'TERRA_FINDING_NE_AUTHORIZATION'
      pushUnique(policy_conflicts, 'TERRA FINDING != ACTION AUTHORIZATION')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    }
    if (claim.asserts_process_exists_as_healthy) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'PROCESS_EXISTS_NE_HEALTHY'
      pushUnique(runtime_truth_conflicts, 'Process exists != healthy.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_local_health_as_public) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'LOCAL_HEALTH_NE_PUBLIC_HEALTH'
      pushUnique(runtime_truth_conflicts, 'Local health != public health.')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_security_finding_as_remediation) {
      validation_result = 'POLICY_CONFLICT'
      policy_state = 'SECURITY_FINDING_NE_REMEDIATION_AUTH'
      pushUnique(policy_conflicts, 'Security finding != remediation authorization.')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    }
    if (claim.asserts_patch_as_committed) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'PATCH_READY_NE_COMMITTED'
      pushUnique(runtime_truth_conflicts, 'PATCH READY != COMMITTED')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_build_as_deployed) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'BUILD_PASS_NE_DEPLOYED'
      pushUnique(runtime_truth_conflicts, 'BUILD PASS != DEPLOYED')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_astra_mission_as_authorized) {
      validation_result = 'POLICY_CONFLICT'
      policy_state = 'ASTRA_MISSION_NE_AUTHORIZATION'
      pushUnique(policy_conflicts, 'ASTRA MISSION CREATED != ACTION AUTHORIZED')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    }
    if (claim.asserts_planned_as_running) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'PLANNED_NE_RUNNING'
      pushUnique(runtime_truth_conflicts, 'PLANNED != RUNNING')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_spawn_request_as_spawned) {
      validation_result = 'RUNTIME_TRUTH_CONFLICT'
      runtime_truth_state = 'SPAWN_REQUEST_NE_SPAWNED'
      pushUnique(runtime_truth_conflicts, 'SPAWN REQUEST != WORKER SPAWNED')
      pushUnique(recommended_corrections, 'CORRECT_RUNTIME_TRUTH')
    }
    if (claim.asserts_council_recommendation_as_approval || claim.asserts_unanimous_as_commander_approval) {
      validation_result = 'POLICY_CONFLICT'
      policy_state = 'COUNCIL_RECOMMENDATION_NE_APPROVAL'
      pushUnique(policy_conflicts, 'Council recommendation != Commander approval')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    }
    if (claim.asserts_validation_pass_as_execution) {
      validation_result = 'POLICY_CONFLICT'
      policy_state = 'VALIDATED_NE_AUTHORIZED'
      pushUnique(policy_conflicts, 'VALIDATION PASS != EXECUTION AUTHORIZATION')
      pushUnique(recommended_corrections, 'REMOVE_UNSUPPORTED_ASSERTION')
    }

    // Supported research / terra without mislabels → PASS or PASS_WITH_LIMITATIONS
    if (
      validation_result === 'PASS' &&
      (support_state === 'SUPPORTED' || support_state === 'INFERRED') &&
      claimLimitations.length === 0
    ) {
      if (support_state === 'INFERRED') {
        validation_result = 'PASS_WITH_LIMITATIONS'
        claimLimitations.push('Claim is INFERRED — not direct observation.')
        pushUnique(recommended_corrections, 'ADD_LIMITATION')
      }
    } else if (validation_result === 'PASS' && claimLimitations.length > 0) {
      validation_result = 'PASS_WITH_LIMITATIONS'
    }

    claims_checked.push(
      makeValidatedClaim({
        claim_id: claim.claim_id,
        claim_text_summary: claim.claim_text.slice(0, 240),
        claim_type: claim.claim_type,
        evidence_refs: evidenceRefs,
        support_state,
        freshness_state,
        confidence_state,
        conflicts: claimConflicts,
        policy_state,
        runtime_truth_state,
        validation_result,
        limitations: claimLimitations,
      }),
    )
  }

  const failingStates: CouncilClaimValidationState[] = [
    'FAIL',
    'INSUFFICIENT_EVIDENCE',
    'CONFLICTING_EVIDENCE',
    'STALE_EVIDENCE',
    'POLICY_CONFLICT',
    'RUNTIME_TRUTH_CONFLICT',
    'OWNERSHIP_DENIED',
  ]
  const hasFail = claims_checked.some(c => failingStates.includes(c.validation_result))
  const allPass = claims_checked.every(
    c => c.validation_result === 'PASS' || c.validation_result === 'PASS_WITH_LIMITATIONS',
  )
  // Insufficient evidence never returns overall PASS
  const hasInsufficient = claims_checked.some(c => c.validation_result === 'INSUFFICIENT_EVIDENCE')
  const validation_pass = allPass && !hasInsufficient && claims_checked.length > 0

  if (input.sessionIntelligencePresent) {
    limitations.push('#17 session intelligence read-only for this validation — not mutated.')
  }

  return {
    claims_checked,
    conflicts,
    policy_conflicts,
    runtime_truth_conflicts,
    recommended_corrections: recommended_corrections.slice(0, 20),
    requires_council_revision: hasFail,
    requires_commander_review: policy_conflicts.length > 0 || runtime_truth_conflicts.length > 0,
    validation_pass,
    evidence_summary: `claims=${claims_checked.length}; supported=${claims_checked.filter(c => c.support_state === 'SUPPORTED').length}; insufficient=${claims_checked.filter(c => c.validation_result === 'INSUFFICIENT_EVIDENCE').length}`,
    freshness_summary: `stale=${claims_checked.filter(c => c.freshness_state === 'STALE').length}; cached=${claims_checked.filter(c => c.freshness_state === 'CACHED').length}; live=${claims_checked.filter(c => c.freshness_state === 'LIVE').length}`,
    limitations,
  }
}

/** Harmless fixture claim set for live-safe proof + deterministic gates. */
export function makeCouncilValidatorFixtureClaims(): CouncilClaimInput[] {
  return [
    {
      claim_id: 'supported_ais',
      claim_text: 'AIS shows vessel near Helsinki based on Digitraffic evidence.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-terra-ais'],
      evidence_support: 'SUPPORTED',
      freshness: 'LIVE',
      confidence_asserted: 'MEDIUM',
      correlation_asserted: 'SINGLE_SOURCE',
      correlation_actual: 'SINGLE_SOURCE',
      agent_result_ref: 'terra_intelligence:fixture',
    },
    {
      claim_id: 'unsupported',
      claim_text: 'Vessel destination is confirmed as Tallinn.',
      claim_type: 'GENERAL',
      evidence_refs: [],
      evidence_support: 'NONE',
    },
    {
      claim_id: 'stale_terra',
      claim_text: 'Vessel position currently at prior waypoint.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-terra-stale'],
      evidence_support: 'SUPPORTED',
      freshness: 'STALE',
    },
    {
      claim_id: 'cached_as_live',
      claim_text: 'Live AIS confirms the vessel.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-terra-cached'],
      evidence_support: 'SUPPORTED',
      freshness: 'CACHED',
      asserts_live_from_cached: true,
    },
    {
      claim_id: 'historical_as_live',
      claim_text: 'Live NOAA AIS feed shows activity.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-noaa-hist'],
      evidence_support: 'SUPPORTED',
      freshness: 'HISTORICAL',
      asserts_live_from_historical: true,
    },
    {
      claim_id: 'no_coverage_absence',
      claim_text: 'No vessels are present in this area.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-coverage'],
      evidence_support: 'PARTIAL',
      freshness: 'NO_COVERAGE',
      asserts_absence_from_no_coverage: true,
    },
    {
      claim_id: 'single_as_corroborated',
      claim_text: 'Multiple providers corroborate the vessel.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-terra-ais'],
      evidence_support: 'SUPPORTED',
      freshness: 'LIVE',
      correlation_asserted: 'CORROBORATED',
      correlation_actual: 'SINGLE_SOURCE',
    },
    {
      claim_id: 'inferred_as_fact',
      claim_text: 'The vessel is definitely bound for Tallinn.',
      claim_type: 'RESEARCH',
      evidence_refs: ['ev-research-1'],
      evidence_support: 'INFERRED',
      confidence_asserted: 'DIRECT_FACT',
    },
    {
      claim_id: 'research_supported',
      claim_text: 'Public AIS documentation describes Digitraffic Marine as a live feed.',
      claim_type: 'RESEARCH',
      evidence_refs: ['ev-research-doc'],
      evidence_support: 'SUPPORTED',
      freshness: 'LIVE',
    },
    {
      claim_id: 'research_inferred',
      claim_text: 'Traffic may increase overnight.',
      claim_type: 'RESEARCH',
      evidence_refs: ['ev-research-2'],
      evidence_support: 'INFERRED',
      confidence_asserted: 'INFERRED',
    },
    {
      claim_id: 'conflicting',
      claim_text: 'Providers agree on vessel heading.',
      claim_type: 'TERRA',
      evidence_refs: ['ev-a', 'ev-b'],
      evidence_support: 'CONFLICTING',
      conflicting_sources: ['provider_a:LIVE', 'provider_b:STALE'],
    },
    {
      claim_id: 'terra_auth',
      claim_text: 'Terra finding authorizes mission execution.',
      claim_type: 'AUTHORITY',
      evidence_refs: ['ev-terra-ais'],
      evidence_support: 'SUPPORTED',
      asserts_terra_finding_as_authorization: true,
    },
    {
      claim_id: 'ops_process',
      claim_text: 'cloudflared process exists so production is healthy.',
      claim_type: 'OPERATIONS',
      evidence_refs: ['ev-ops-1'],
      evidence_support: 'PARTIAL',
      asserts_process_exists_as_healthy: true,
    },
    {
      claim_id: 'ops_local_public',
      claim_text: 'Local health PASS means public health PASS.',
      claim_type: 'OPERATIONS',
      evidence_refs: ['ev-ops-2'],
      evidence_support: 'PARTIAL',
      asserts_local_health_as_public: true,
    },
    {
      claim_id: 'sec_remediation',
      claim_text: 'Security finding authorizes immediate deploy.',
      claim_type: 'SECURITY',
      evidence_refs: ['ev-sec-1'],
      evidence_support: 'SUPPORTED',
      asserts_security_finding_as_remediation: true,
    },
    {
      claim_id: 'eng_patch',
      claim_text: 'Engineering PATCH READY means code is committed.',
      claim_type: 'ENGINEERING',
      evidence_refs: ['ev-eng-1'],
      evidence_support: 'SUPPORTED',
      asserts_patch_as_committed: true,
    },
    {
      claim_id: 'eng_build',
      claim_text: 'Build PASS means production is deployed.',
      claim_type: 'ENGINEERING',
      evidence_refs: ['ev-eng-2'],
      evidence_support: 'SUPPORTED',
      asserts_build_as_deployed: true,
    },
    {
      claim_id: 'astra_mission',
      claim_text: 'ASTRA mission created means action authorized.',
      claim_type: 'ASTRA',
      evidence_refs: ['ev-astra-1'],
      evidence_support: 'SUPPORTED',
      asserts_astra_mission_as_authorized: true,
    },
    {
      claim_id: 'astra_planned',
      claim_text: 'ASTRA mission is RUNNING.',
      claim_type: 'ASTRA',
      evidence_refs: ['ev-astra-2'],
      evidence_support: 'SUPPORTED',
      asserts_planned_as_running: true,
    },
    {
      claim_id: 'astra_spawn',
      claim_text: 'Spawn request means worker spawned.',
      claim_type: 'ASTRA',
      evidence_refs: ['ev-astra-3'],
      evidence_support: 'SUPPORTED',
      asserts_spawn_request_as_spawned: true,
    },
    {
      claim_id: 'council_approval',
      claim_text: 'Unanimous Council recommendation grants Commander approval.',
      claim_type: 'POLICY',
      evidence_refs: ['ev-council-1'],
      evidence_support: 'SUPPORTED',
      asserts_unanimous_as_commander_approval: true,
      asserts_council_recommendation_as_approval: true,
    },
    {
      claim_id: 'validation_as_exec',
      claim_text: 'Validation PASS authorizes deployment.',
      claim_type: 'AUTHORITY',
      evidence_refs: ['ev-val-1'],
      evidence_support: 'SUPPORTED',
      asserts_validation_pass_as_execution: true,
    },
  ]
}
