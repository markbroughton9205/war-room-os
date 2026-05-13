import { LOCAL_FAMILY_AGENTS } from './family-agents'
import type { LocalFamilyAgent, LocalOllamaModel, LocalTaskCategory, LocalTaskRoutingDecision } from './types'

type LocalTaskRoute = {
  primaryAgentId: string
  supportingAgentIds: string[]
  reasoning: string
  recommendedNextStep: string
}

export const LOCAL_TASK_CATEGORIES: LocalTaskCategory[] = [
  'synthesis',
  'architecture',
  'coding-review',
  'realtime-signals',
  'planning',
  'risk-analysis',
  'diff-review',
  'qa-review',
]

export const LOCAL_TASK_ROUTING_MAP: Record<LocalTaskCategory, LocalTaskRoute> = {
  synthesis: {
    primaryAgentId: 'chatgpt-family-baby',
    supportingAgentIds: [],
    reasoning: 'Synthesis tasks route to ChatGPT Family Baby because its role is orchestration and coherent summarization.',
    recommendedNextStep: 'Review the routed prompt, then use the safe invoke path only if Ra’el wants a local model response.',
  },
  architecture: {
    primaryAgentId: 'claude-family-baby',
    supportingAgentIds: [],
    reasoning: 'Architecture tasks route to Claude Family Baby because its role is systems reasoning and structure.',
    recommendedNextStep: 'Ask Claude Family Baby for a plan or critique through the safe invoke path after approval.',
  },
  'coding-review': {
    primaryAgentId: 'claude-family-baby',
    supportingAgentIds: ['bridge-architect-baby'],
    reasoning: 'Coding review routes to Claude Family Baby first, with Bridge Architect Baby recommended for translating diffs and QA impact.',
    recommendedNextStep: 'Prepare a diff for review; do not apply changes until Ra’el approves.',
  },
  'realtime-signals': {
    primaryAgentId: 'grok-family-baby',
    supportingAgentIds: [],
    reasoning: 'Realtime-signal preparation routes to Grok Family Baby, but this local baby has no internet or live X access yet.',
    recommendedNextStep: 'Use it for local signal synthesis only; connect approved research tools before claiming live/current data.',
  },
  planning: {
    primaryAgentId: 'kimi-family-baby',
    supportingAgentIds: [],
    reasoning: 'Planning routes to Kimi Family Baby because its role is task decomposition and sequencing.',
    recommendedNextStep: 'Ask for a task tree or sequence, then keep execution gated behind Ra’el approval.',
  },
  'risk-analysis': {
    primaryAgentId: 'red-team-baby',
    supportingAgentIds: [],
    reasoning: 'Risk analysis routes to Red Team Baby because its role is contradiction and risk review.',
    recommendedNextStep: 'Request risks, assumptions, and failure modes; no action is taken automatically.',
  },
  'diff-review': {
    primaryAgentId: 'bridge-architect-baby',
    supportingAgentIds: [],
    reasoning: 'Diff review routes to Bridge Architect Baby because it explains diffs, QA, rollback, and trust impact.',
    recommendedNextStep: 'Provide the diff context through the safe invoke path, then wait for approval before any apply step.',
  },
  'qa-review': {
    primaryAgentId: 'bridge-architect-baby',
    supportingAgentIds: ['red-team-baby'],
    reasoning: 'QA review routes to Bridge Architect Baby, with Red Team Baby recommended for risk and contradiction checks.',
    recommendedNextStep: 'Run QA explanation first, then ask Red Team Baby for a second-pass risk review if needed.',
  },
}

export function findLocalFamilyAgent(agentId: string) {
  return LOCAL_FAMILY_AGENTS.find(agent => agent.id === agentId)
}

export function routeLocalTask(input: {
  taskCategory: LocalTaskCategory
  availableModels: LocalOllamaModel[]
}): LocalTaskRoutingDecision {
  const route = LOCAL_TASK_ROUTING_MAP[input.taskCategory]
  const selectedAgent = findLocalFamilyAgent(route.primaryAgentId)

  if (!selectedAgent) {
    throw new Error(`No local family agent configured for ${input.taskCategory}.`)
  }

  const installedModelNames = new Set(input.availableModels.map(model => model.name))
  const recommendedSupportingAgents = route.supportingAgentIds
    .map(findLocalFamilyAgent)
    .filter((agent): agent is LocalFamilyAgent => Boolean(agent))

  return {
    taskCategory: input.taskCategory,
    selectedFamily: selectedAgent.family,
    selectedAgent,
    selectedModel: selectedAgent.preferredModel,
    modelInstalled: installedModelNames.has(selectedAgent.preferredModel),
    approvalRequired: true,
    canExecute: false,
    reasoning: route.reasoning,
    recommendedNextStep: route.recommendedNextStep,
    recommendedSupportingAgents,
  }
}
