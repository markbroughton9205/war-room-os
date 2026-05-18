import { BABY_AI_AGENTS, type BabyAgent, type BabyLearningSource } from './model'
import { buildBabyAiProposal, babyAiGovernanceRules, type BabyAiProposal } from './governance'

export type BabyCouncilObservation = {
  agentKey: string
  agentName: string
  familyIdentity: string
  observation: string
  suggestedCouncilUse: string
  approvalGate: string
  canExecute: false
}

export type BabyCouncilIntegration = {
  liveCouncilRole: 'observation_and_task_proposal'
  executionAllowed: false
  localBridgeDependency: 'optional_accelerator'
  observations: BabyCouncilObservation[]
  proposals: BabyAiProposal[]
  rules: string[]
}

function sourceForAgent(agent: BabyAgent): BabyLearningSource {
  if (agent.key === 'income-operations-baby') return 'opportunity_result'
  if (agent.key === 'analyst-baby') return 'analyst_finding'
  if (agent.key === 'red-team-baby') return 'rejected_action'
  if (agent.key === 'bridge-architect-baby' || agent.key === 'claude-family-baby') return 'repair_outcome'
  return 'approved_council_output'
}

export function buildBabyCouncilObservations(agents: BabyAgent[] = BABY_AI_AGENTS): BabyCouncilObservation[] {
  return agents.map(agent => ({
    agentKey: agent.key,
    agentName: agent.displayName,
    familyIdentity: agent.familyIdentity,
    observation: agent.latestLesson,
    suggestedCouncilUse: agent.nextTrainingNeed,
    approvalGate: 'Commander approval required before task queueing, permanent memory, or capability expansion.',
    canExecute: false,
  }))
}

export function buildBabyCouncilIntegration(agents: BabyAgent[] = BABY_AI_AGENTS): BabyCouncilIntegration {
  return {
    liveCouncilRole: 'observation_and_task_proposal',
    executionAllowed: false,
    localBridgeDependency: 'optional_accelerator',
    observations: buildBabyCouncilObservations(agents),
    proposals: agents.map(agent => buildBabyAiProposal(agent, 'task_proposal', sourceForAgent(agent))),
    rules: babyAiGovernanceRules(),
  }
}

export function buildBabyCouncilPromptAddendum(): string {
  return [
    'Baby AI Family Growth System: Baby agents may contribute observations, improvement suggestions, and approval-gated task proposals.',
    'They cannot execute actions, mutate files, run shell commands, control deployments, spend money, or self-approve lessons.',
    'Treat local LM Studio/Ollama as optional acceleration only; Baby AI learning remains available when the local node is offline.',
  ].join('\n')
}
