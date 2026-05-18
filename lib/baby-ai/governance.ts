import { BABY_AI_GUARDRAILS, type BabyAgent, type BabyLearningSource } from './model'

export type BabyAiProposalKind = 'observation' | 'improvement' | 'task_proposal' | 'lesson_candidate'

export type BabyAiProposal = {
  id: string
  agentKey: string
  agentName: string
  kind: BabyAiProposalKind
  title: string
  summary: string
  source: BabyLearningSource
  approvalRequired: true
  canExecute: false
  destructiveActionBlocked: true
}

export type BabyAiGovernanceDecision = {
  allowedAsObservation: boolean
  approvalRequired: true
  executionAllowed: false
  permanentMemoryAllowed: boolean
  reasons: string[]
}

const BLOCKED_ACTION_WORDS = /\b(shell|terminal|powershell|bash|cmd|delete|remove|rm\s+-rf|deploy|push|commit|write\s+file|modify\s+file|filesystem|execute|run command)\b/i

export function evaluateBabyAiProposal(input: {
  agent: BabyAgent
  summary: string
  source: BabyLearningSource
  commanderApproved: boolean
  repeatedValidatedOutcomes: number
}): BabyAiGovernanceDecision {
  const blockedActionLanguage = BLOCKED_ACTION_WORDS.test(input.summary)
  const permanentMemoryAllowed = input.commanderApproved || input.repeatedValidatedOutcomes >= 3
  const reasons = [
    `${input.agent.displayName} may contribute observations and task proposals only.`,
    BABY_AI_GUARDRAILS.cloudProviderRequired
      ? 'Cloud provider family context is required.'
      : 'Cloud provider context is not required.',
    'No Baby AI can execute shell, filesystem, deployment, financial, or destructive actions.',
    permanentMemoryAllowed
      ? 'Lesson can become durable because Commander approval or repeated validation exists.'
      : 'Lesson remains a candidate until Commander approval or repeated validation.',
  ]

  if (blockedActionLanguage) {
    reasons.push('Proposal contains execution-like language and must be rewritten as an observation or approval request.')
  }

  return {
    allowedAsObservation: !blockedActionLanguage,
    approvalRequired: true,
    executionAllowed: false,
    permanentMemoryAllowed,
    reasons,
  }
}

export function buildBabyAiProposal(agent: BabyAgent, kind: BabyAiProposalKind, source: BabyLearningSource): BabyAiProposal {
  return {
    id: `${agent.key}:${kind}`,
    agentKey: agent.key,
    agentName: agent.displayName,
    kind,
    title: kind === 'task_proposal' ? agent.nextTrainingNeed : agent.latestLesson,
    summary: `${agent.displayName} can surface this for Commander review: ${kind === 'task_proposal' ? agent.nextTrainingNeed : agent.latestLesson}`,
    source,
    approvalRequired: true,
    canExecute: false,
    destructiveActionBlocked: true,
  }
}

export function babyAiGovernanceRules(): string[] {
  return [
    'Baby AI output is observation, lesson candidate, or approval-gated task proposal only.',
    'No hidden execution, shell command exposure, filesystem mutation, deployment control, or destructive action path.',
    'Permanent lessons require Commander approval or repeated validated outcomes.',
    'Baby AI uses cloud provider families only; offline connector stacks do not participate in growth or training.',
    'Rejected actions remain negative training data and cannot self-promote into lessons.',
  ]
}
