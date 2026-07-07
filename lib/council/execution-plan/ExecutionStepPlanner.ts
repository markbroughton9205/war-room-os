import type { BrainRecommendation } from '../brain-selection'
import type { RoutingNote } from '../routing'
import type { ExecutionActionType, ExecutionRiskLevel, ExecutionStep } from './types'

function riskFromRouting(routingNote: RoutingNote): ExecutionRiskLevel {
  return routingNote.riskLevel === 'high' ? 'high' : routingNote.riskLevel === 'medium' ? 'medium' : 'low'
}

function actionForSkill(skillId: string): ExecutionActionType {
  if (skillId.includes('risk') || skillId.includes('contradiction') || skillId.includes('scam')) return 'critique'
  if (skillId.includes('writing') || skillId.includes('synthesis')) return 'draft'
  if (skillId.includes('implementation') || skillId.includes('technical')) return 'propose_action'
  if (skillId.includes('research') || skillId.includes('source') || skillId.includes('internet')) return 'gather_context'
  return 'reason'
}

export class ExecutionStepPlanner {
  plan(input: {
    routingNote: RoutingNote
    brainRecommendation: BrainRecommendation
    blockedReason: string | null
  }): ExecutionStep[] {
    const { routingNote, brainRecommendation, blockedReason } = input
    const riskLevel = riskFromRouting(routingNote)
    const selectedBrainCandidateId = brainRecommendation.selectedCandidateId
    const steps: ExecutionStep[] = [
      {
        stepId: 'step_classify_intent',
        label: 'Classify commander request',
        ownerEntityId: null,
        skillId: null,
        brainCandidateId: null,
        actionType: 'classify',
        description: 'Use the existing RoutingNote classification as dry-run lineage.',
        requiresApproval: false,
        riskLevel: 'low',
        status: 'not_executed',
      },
    ]

    const plannedSkillIds = routingNote.intent === 'unknown'
      ? routingNote.selectedSkillIds.slice(0, 1)
      : routingNote.selectedSkillIds

    for (const [index, skillId] of plannedSkillIds.entries()) {
      steps.push({
        stepId: `step_skill_${index + 1}_${skillId}`,
        label: `Plan ${skillId}`,
        ownerEntityId: routingNote.selectedEntityIds[index % Math.max(routingNote.selectedEntityIds.length, 1)] ?? null,
        skillId,
        brainCandidateId: selectedBrainCandidateId,
        actionType: actionForSkill(skillId),
        description: `Dry-run planning step for ${skillId}; no provider, tool, database, or repo action is executed.`,
        requiresApproval: routingNote.approvalRequired,
        riskLevel,
        status: blockedReason ? 'blocked' : 'planned',
      })
    }

    if (routingNote.routingConfidence < 0.6) {
      steps.push({
        stepId: 'step_ask_clarification',
        label: 'Ask for clarification',
        ownerEntityId: null,
        skillId: null,
        brainCandidateId: null,
        actionType: 'ask_clarification',
        description: 'Commander clarification would be requested before any future execution because routing confidence is low.',
        requiresApproval: false,
        riskLevel: 'low',
        status: 'blocked',
      })
    }

    if (routingNote.approvalRequired) {
      steps.push({
        stepId: 'step_await_approval',
        label: 'Await commander approval',
        ownerEntityId: null,
        skillId: null,
        brainCandidateId: selectedBrainCandidateId,
        actionType: 'await_approval',
        description: 'Future execution would wait for approval; this phase remains dry-run only.',
        requiresApproval: true,
        riskLevel,
        status: 'blocked',
      })
    }

    steps.push({
      stepId: 'step_synthesize_plan',
      label: 'Synthesize dry-run plan',
      ownerEntityId: routingNote.selectedEntityIds[0] ?? null,
      skillId: routingNote.selectedSkillIds[0] ?? null,
      brainCandidateId: selectedBrainCandidateId,
      actionType: 'synthesize',
      description: 'Summarize how War Room would handle the request in a later approved execution phase.',
      requiresApproval: false,
      riskLevel,
      status: 'not_executed',
    })

    return steps
  }
}
