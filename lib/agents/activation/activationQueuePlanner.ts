import type { WorkerKind } from '@/lib/agents/foundry/agentBlueprints'
import type { ActivationAgentCandidate } from './agentActivationWorkflow'

export type ActivationQueueType = WorkerKind | 'governance_review'

export type ActivationQueueAssignment = {
  agentId: string
  queueKey: string
  queueType: ActivationQueueType
  taskScope: string[]
  concurrencyLimit: number
  escalationRules: string[]
  retryPolicy: {
    maxAttempts: number
    backoff: 'manual_review' | 'linear_review'
  }
  degradationThresholds: {
    queueDepth: number
    staleMinutes: number
    contradictionCount: number
  }
  approvalBound: true
  monitorable: true
  auditable: true
  externalExecutionAllowed: false
}

function queueTypeForRole(role: ActivationAgentCandidate['operationalRole']): ActivationQueueType {
  if (role === 'retrieval') return 'retrieval'
  if (role === 'forecasting') return 'forecasting'
  if (role === 'repair_analysis') return 'repair_monitoring'
  if (role === 'provider_health') return 'provider_health'
  if (role === 'workflow_coordination' || role === 'engineering_coordination') return 'workflow_coordination'
  if (role === 'monitoring') return 'monitoring'
  return 'analytics'
}

function concurrencyForRisk(riskLevel: ActivationAgentCandidate['riskLevel']) {
  if (riskLevel === 'high') return 1
  if (riskLevel === 'elevated') return 1
  if (riskLevel === 'moderate') return 2
  return 3
}

export function planActivationQueues(candidates: ActivationAgentCandidate[]): ActivationQueueAssignment[] {
  return candidates.map((candidate) => ({
    agentId: candidate.agentId,
    queueKey: `activation-${candidate.blueprintId}`,
    queueType: queueTypeForRole(candidate.operationalRole),
    taskScope: [
      'scoped_task_routing',
      'orchestration_participation',
      'analyst_collaboration',
      'red_team_review_hooks',
    ],
    concurrencyLimit: concurrencyForRisk(candidate.riskLevel),
    escalationRules: [
      'Escalate stale queue items to Commander review.',
      'Escalate contradiction findings before task promotion.',
      'Escalate degraded prerequisites before worker preparation.',
    ],
    retryPolicy: {
      maxAttempts: candidate.riskLevel === 'high' ? 1 : 2,
      backoff: candidate.riskLevel === 'low' ? 'linear_review' : 'manual_review',
    },
    degradationThresholds: {
      queueDepth: candidate.riskLevel === 'high' ? 3 : 5,
      staleMinutes: candidate.riskLevel === 'low' ? 120 : 60,
      contradictionCount: 1,
    },
    approvalBound: true,
    monitorable: true,
    auditable: true,
    externalExecutionAllowed: false,
  }))
}
