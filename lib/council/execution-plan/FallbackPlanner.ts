import type { BrainRecommendation } from '../brain-selection'
import type { RoutingNote } from '../routing'
import type { FallbackPlan, FallbackStrategy } from './types'

function createFallbackPlanId(routingId: string): string {
  return `fallback_${routingId.replace(/[^a-zA-Z0-9]/g, '_')}`
}

export class FallbackPlanner {
  plan(input: {
    routingNote: RoutingNote
    brainRecommendation: BrainRecommendation
    blockedReason: string | null
  }): FallbackPlan {
    const { routingNote, brainRecommendation, blockedReason } = input
    let strategy: FallbackStrategy = 'no_action'
    const steps: string[] = []

    if (brainRecommendation.selectedCandidateId === null) {
      strategy = 'defer_execution'
      steps.push('Do not execute; request commander clarification or approval before choosing a brain.')
    } else if (routingNote.routingConfidence < 0.6) {
      strategy = 'ask_clarification'
      steps.push('Ask the commander to clarify scope, target, or desired output.')
    } else if (brainRecommendation.requiredBrainProfile.liveResearchNeed) {
      strategy = 'defer_execution'
      steps.push('Explain that live research would require a later approved provider/tool execution phase.')
    } else if (routingNote.approvalRequired || brainRecommendation.approvalRequired) {
      strategy = 'await_approval'
      steps.push('Wait for explicit commander approval before any future execution.')
    } else if (brainRecommendation.requiredBrainProfile.privacySensitivity === 'high') {
      strategy = 'local_only'
      steps.push('Prefer local/static planning until privacy approval is granted.')
    } else if (routingNote.riskLevel === 'high') {
      strategy = 'route_to_skeptic'
      steps.push('Route through Skeptic-style review before any future action.')
    } else {
      strategy = 'static_template_only'
      steps.push('Use a static dry-run template and take no external action.')
    }

    steps.push('Keep executionAllowed false and executionMode dry_run.')

    return {
      fallbackPlanId: createFallbackPlanId(routingNote.routingId),
      reason: blockedReason ?? 'No live execution is allowed in Phase 46E.',
      strategy,
      steps,
    }
  }
}
