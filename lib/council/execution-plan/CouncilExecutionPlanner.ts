import { ExecutionPlanBuilder } from './ExecutionPlanBuilder'
import { ExecutionStepPlanner } from './ExecutionStepPlanner'
import { FallbackPlanner } from './FallbackPlanner'
import { SafetyCheckPlanner } from './SafetyCheckPlanner'
import type { CouncilExecutionPlanInput, ExecutionPlan } from './types'

function resolveBlockedReason(input: CouncilExecutionPlanInput): string | null {
  if (input.brainRecommendation.selectedCandidateId === null) {
    return 'No eligible brain candidate is available for this dry-run lineage.'
  }
  if (input.routingNote.routingConfidence < 0.6) {
    return 'Routing confidence is low; commander clarification is recommended before execution.'
  }
  if (input.brainRecommendation.requiredBrainProfile.liveResearchNeed) {
    return 'Live research is required but Phase 46E cannot execute tools or providers.'
  }
  if (input.routingNote.approvalRequired) {
    return 'Commander approval is required before any future execution.'
  }
  return null
}

export class CouncilExecutionPlanner {
  constructor(
    private readonly stepPlanner: ExecutionStepPlanner = new ExecutionStepPlanner(),
    private readonly safetyCheckPlanner: SafetyCheckPlanner = new SafetyCheckPlanner(),
    private readonly fallbackPlanner: FallbackPlanner = new FallbackPlanner(),
    private readonly planBuilder: ExecutionPlanBuilder = new ExecutionPlanBuilder(),
  ) {}

  plan(input: CouncilExecutionPlanInput): ExecutionPlan {
    const blockedReason = resolveBlockedReason(input)
    const executionSteps = this.stepPlanner.plan({
      routingNote: input.routingNote,
      brainRecommendation: input.brainRecommendation,
      blockedReason,
    })
    const safetyChecks = this.safetyCheckPlanner.plan({
      routingNote: input.routingNote,
      brainRecommendation: input.brainRecommendation,
      blockedReason,
    })
    const fallbackPlan = this.fallbackPlanner.plan({
      routingNote: input.routingNote,
      brainRecommendation: input.brainRecommendation,
      blockedReason,
    })

    return this.planBuilder.build({
      commanderMessage: input.commanderMessage,
      routingNote: input.routingNote,
      brainRecommendation: input.brainRecommendation,
      blockedReason,
      executionSteps,
      safetyChecks,
      fallbackPlan,
      createdAt: input.createdAt,
      executionPlanId: input.executionPlanId,
    })
  }
}
