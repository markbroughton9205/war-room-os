import type { BrainRecommendation } from '../brain-selection'
import type { RoutingNote } from '../routing'
import type { SafetyCheck } from './types'

export class SafetyCheckPlanner {
  plan(input: {
    routingNote: RoutingNote
    brainRecommendation: BrainRecommendation
    blockedReason: string | null
  }): SafetyCheck[] {
    const { routingNote, brainRecommendation, blockedReason } = input
    const checks: SafetyCheck[] = [
      {
        checkId: 'provider_calls_disabled',
        label: 'Provider calls disabled',
        status: 'pass',
        reason: 'Dry-run planner never calls OpenAI, Anthropic, Google, xAI, Moonshot/Kimi, or local providers.',
      },
      {
        checkId: 'execution_allowed_false',
        label: 'executionAllowed false',
        status: 'pass',
        reason: 'Generated plans hardcode executionAllowed to false.',
      },
      {
        checkId: 'external_side_effects_disabled',
        label: 'No external side effects',
        status: 'pass',
        reason: 'Planner does not send messages, execute tools, call APIs, mutate databases, or mutate repositories.',
      },
      {
        checkId: 'database_mutation_disabled',
        label: 'No database mutation',
        status: 'pass',
        reason: 'Planner creates in-memory structures only and does not import Supabase clients.',
      },
      {
        checkId: 'repo_mutation_disabled',
        label: 'No repo mutation',
        status: 'pass',
        reason: 'Execution steps describe future behavior only; no filesystem or repo action is planned as execution.',
      },
    ]

    if (brainRecommendation.requiredBrainProfile.liveResearchNeed) {
      checks.push({
        checkId: 'live_research_not_executed',
        label: 'Live research not executed',
        status: 'blocked',
        reason: 'Routing indicates live/current data may be needed, but Phase 46E cannot run live research.',
      })
    }

    if (routingNote.approvalRequired || brainRecommendation.approvalRequired) {
      checks.push({
        checkId: 'approval_required',
        label: 'Approval required before high-risk or external action',
        status: 'requires_approval',
        reason: 'Routing or brain recommendation requires commander approval before any later execution.',
      })
    }

    if (brainRecommendation.requiredBrainProfile.privacySensitivity === 'high') {
      checks.push({
        checkId: 'privacy_sensitive_requires_approval',
        label: 'Privacy-sensitive request requires approval',
        status: 'requires_approval',
        reason: 'Brain profile marks privacy sensitivity high.',
      })
    }

    if (routingNote.routingConfidence < 0.6) {
      checks.push({
        checkId: 'low_confidence_requires_clarification',
        label: 'Low confidence requires clarification',
        status: 'blocked',
        reason: 'Routing confidence is below 0.60, so clarification is recommended before execution.',
      })
    }

    if (brainRecommendation.selectedCandidateId === null) {
      checks.push({
        checkId: 'no_eligible_brain_candidate',
        label: 'No eligible brain candidate blocks execution',
        status: 'blocked',
        reason: 'BrainRecommendation did not select an eligible candidate.',
      })
    }

    if (blockedReason) {
      checks.push({
        checkId: 'blocked_reason_present',
        label: 'Blocked reason present',
        status: 'blocked',
        reason: blockedReason,
      })
    }

    return checks
  }
}
