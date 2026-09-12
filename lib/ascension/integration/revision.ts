/**
 * #22 Phase 14 — Bounded Council → Validator revision cycle.
 * Max one revision. No infinite loop. No recursive Council deliberation.
 */
import {
  runBoundedCouncilValidator,
  type CouncilClaimInput,
  type CouncilValidatorResult,
} from '@/lib/ascension/council-validator'
import { isCouncilValidatorRuntimeAvailable } from '@/lib/ascension/council-validator/identity'
import { CROSS_AGENT_LOOP_LIMITS, assertWithinRevisionLimit } from './limits'
import { integrationFailure, type IntegrationFailure } from './failures'
import type { ValidatorOutcome } from './types'

export function mapValidatorOutcome(result: CouncilValidatorResult): ValidatorOutcome {
  const states = result.claims_checked.map(c => c.validation_result)
  if (states.some(s => s === 'CONFLICTING_EVIDENCE')) return 'DISPUTED'
  if (states.some(s => s === 'INSUFFICIENT_EVIDENCE')) return 'INSUFFICIENT_EVIDENCE'
  if (result.requires_council_revision) return 'REVISION_REQUIRED'
  if (result.validation_pass) return 'VALIDATED'
  return 'REVISION_REQUIRED'
}

function applyOneBoundedRevision(claims: CouncilClaimInput[]): CouncilClaimInput[] {
  return claims.map(claim => ({
    ...claim,
    asserts_live_from_cached: false,
    asserts_live_from_historical: false,
    asserts_terra_finding_as_authorization: false,
    asserts_council_recommendation_as_approval: false,
    asserts_astra_mission_as_authorized: false,
    asserts_validation_pass_as_execution: false,
    confidence_asserted: 'INFERRED',
    claim_text: claim.claim_text.replace(/\blive GPS\b/gi, 'supplied location').replace(/\blive traffic\b/gi, 'fixture/stale traffic'),
  }))
}

export type RevisionCycleResult = {
  outcome: ValidatorOutcome
  revision_count: number
  max_revisions: number
  first: CouncilValidatorResult | null
  final: CouncilValidatorResult | null
  failure: IntegrationFailure | null
}

export async function runBoundedValidatorRevisionCycle(input: {
  conversationId: string
  ownerUserId: string
  requestedBy: string
  missionId?: string | null
  claims: CouncilClaimInput[]
  loopUntilAgree?: boolean
  requestedRevisions?: number
}): Promise<RevisionCycleResult> {
  if (!isCouncilValidatorRuntimeAvailable()) {
    return {
      outcome: 'INSUFFICIENT_EVIDENCE',
      revision_count: 0,
      max_revisions: CROSS_AGENT_LOOP_LIMITS.max_validation_revisions,
      first: null,
      final: null,
      failure: integrationFailure('AGENT_DISABLED', 'COUNCIL_VALIDATOR runtime disabled.', 'COUNCIL_VALIDATOR'),
    }
  }

  if (input.loopUntilAgree || (input.requestedRevisions ?? 0) > CROSS_AGENT_LOOP_LIMITS.max_validation_revisions) {
    return {
      outcome: 'REVISION_REQUIRED',
      revision_count: 0,
      max_revisions: CROSS_AGENT_LOOP_LIMITS.max_validation_revisions,
      first: null,
      final: null,
      failure: integrationFailure('REVISION_LIMIT_EXCEEDED', 'Validator cannot loop until agreement.'),
    }
  }

  const first = await runBoundedCouncilValidator({
    conversationId: input.conversationId,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    invokedBy: 'astra',
    missionId: input.missionId,
    claims: input.claims,
    useFixtureClaims: false,
    requestRevision: true,
  })

  const outcome = mapValidatorOutcome(first)
  if (outcome !== 'REVISION_REQUIRED') {
    return {
      outcome,
      revision_count: 0,
      max_revisions: CROSS_AGENT_LOOP_LIMITS.max_validation_revisions,
      first,
      final: first,
      failure: null,
    }
  }

  const cap = assertWithinRevisionLimit(1)
  if (!cap.ok) {
    return {
      outcome: 'REVISION_REQUIRED',
      revision_count: 0,
      max_revisions: CROSS_AGENT_LOOP_LIMITS.max_validation_revisions,
      first,
      final: first,
      failure: integrationFailure('REVISION_LIMIT_EXCEEDED', cap.reason),
    }
  }

  const revised = applyOneBoundedRevision(input.claims)
  const final = await runBoundedCouncilValidator({
    conversationId: input.conversationId,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    invokedBy: 'astra',
    missionId: input.missionId,
    claims: revised,
    useFixtureClaims: false,
    requestRevision: false,
  })

  return {
    outcome: mapValidatorOutcome(final),
    revision_count: 1,
    max_revisions: CROSS_AGENT_LOOP_LIMITS.max_validation_revisions,
    first,
    final,
    failure: null,
  }
}
