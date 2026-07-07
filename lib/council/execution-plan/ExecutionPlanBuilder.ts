import type { BrainCandidate, BrainRecommendation } from '../brain-selection'
import type { RoutingNote } from '../routing'
import type {
  EstimatedCostClass,
  EstimatedLatencyClass,
  ExecutionPlan,
  ExecutionStep,
  ExpectedInput,
  ExpectedOutput,
  FallbackPlan,
  SafetyCheck,
} from './types'

function createExecutionPlanId(createdAt: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `exec_${createdAt.replace(/[^0-9]/g, '')}_${randomPart}`
}

function estimateCostClass(candidate: BrainCandidate | null): EstimatedCostClass {
  if (!candidate) return 'none'
  if (candidate.providerFamily === 'static') return 'none'
  if (candidate.providerFamily === 'local') return 'low'
  if (candidate.costScore >= 0.65) return 'low'
  if (candidate.costScore >= 0.5) return 'medium'
  return 'high'
}

function estimateLatencyClass(candidate: BrainCandidate | null): EstimatedLatencyClass {
  if (!candidate) return 'instant'
  if (candidate.providerFamily === 'static') return 'instant'
  if (candidate.latencyScore >= 0.8) return 'fast'
  if (candidate.latencyScore >= 0.6) return 'normal'
  return 'slow'
}

function buildExpectedInputs(approvalRequired: boolean): ExpectedInput[] {
  const inputs: ExpectedInput[] = [
    {
      inputId: 'input_commander_message',
      label: 'Commander message',
      required: true,
      source: 'commander_message',
    },
    {
      inputId: 'input_routing_note',
      label: 'Routing Note',
      required: true,
      source: 'routing_note',
    },
    {
      inputId: 'input_brain_recommendation',
      label: 'Brain Recommendation',
      required: true,
      source: 'brain_recommendation',
    },
  ]

  if (approvalRequired) {
    inputs.push({
      inputId: 'input_operator_approval',
      label: 'Commander approval',
      required: true,
      source: 'operator_approval',
    })
  }

  return inputs
}

function buildExpectedOutputs(steps: ExecutionStep[]): ExpectedOutput[] {
  return [
    {
      outputId: 'output_dry_run_plan',
      label: 'Dry-run execution plan',
      description: 'A non-executing plan describing how War Room would handle the request.',
      producedByStepId: steps.at(-1)?.stepId ?? null,
    },
    {
      outputId: 'output_safety_posture',
      label: 'Safety posture',
      description: 'A list of checks explaining why no provider, tool, database, or repo action was executed.',
      producedByStepId: null,
    },
  ]
}

export class ExecutionPlanBuilder {
  build(input: {
    commanderMessage: string
    routingNote: RoutingNote
    brainRecommendation: BrainRecommendation
    blockedReason: string | null
    executionSteps: ExecutionStep[]
    safetyChecks: SafetyCheck[]
    fallbackPlan: FallbackPlan
    createdAt?: string
    executionPlanId?: string
  }): ExecutionPlan {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const selectedCandidate =
      input.brainRecommendation.rankedCandidates.find(
        candidate => candidate.candidateId === input.brainRecommendation.selectedCandidateId,
      ) ?? null
    const approvalRequired = input.routingNote.approvalRequired
      || input.blockedReason === 'No eligible brain candidate is available for this dry-run lineage.'
      || input.blockedReason === 'Live research is required but Phase 46E cannot execute tools or providers.'
      || input.blockedReason === 'Commander approval is required before any future execution.'

    return {
      executionPlanId: input.executionPlanId ?? createExecutionPlanId(createdAt),
      routingId: input.routingNote.routingId,
      recommendationId: input.brainRecommendation.recommendationId,
      commanderMessage: input.commanderMessage,
      intent: input.routingNote.intent,
      selectedSkillIds: [...input.routingNote.selectedSkillIds],
      selectedEntityIds: [...input.routingNote.selectedEntityIds],
      recommendedBrainCandidateIds: input.brainRecommendation.rankedCandidates.map(candidate => candidate.candidateId),
      selectedBrainCandidateId: input.brainRecommendation.selectedCandidateId,
      approvalRequired,
      blockedReason: input.blockedReason,
      executionAllowed: false,
      executionMode: 'dry_run',
      executionSteps: input.executionSteps,
      expectedInputs: buildExpectedInputs(approvalRequired),
      expectedOutputs: buildExpectedOutputs(input.executionSteps),
      safetyChecks: input.safetyChecks,
      estimatedCostClass: estimateCostClass(selectedCandidate),
      estimatedLatencyClass: estimateLatencyClass(selectedCandidate),
      fallbackPlan: input.fallbackPlan,
      decisionPath: [
        `ExecutionPlan attached to RoutingNote ${input.routingNote.routingId}.`,
        `ExecutionPlan attached to BrainRecommendation ${input.brainRecommendation.recommendationId}.`,
        ...input.routingNote.decisionPath.map(line => `Routing lineage: ${line}`),
        ...input.brainRecommendation.decisionPath.map(line => `Brain lineage: ${line}`),
        input.blockedReason
          ? `Execution blocked: ${input.blockedReason}`
          : 'Execution remains disabled by Phase 46E dry-run policy.',
        `Fallback strategy: ${input.fallbackPlan.strategy}.`,
      ],
      createdAt,
    }
  }
}
