import type { MissionId } from '@/lib/missions/types'
import type { RuntimeGraphSnapshot } from '@/lib/runtime-graph/types'

export type PriorityApprovalState = 'not_required' | 'approval_required' | 'pending_approval'

export type PriorityActionCandidate = {
  id: string
  title: string
  estimatedValue: string
  estimatedTime: string
  linkedMission: MissionId
  confidence: number
  approvalState: PriorityApprovalState
  source: 'approval' | 'signal' | 'revenue' | 'outcome' | 'runtime_graph'
  sourceId: string
  evidence: string[]
  score: number
  canExecute: false
}

export type PriorityEngineSnapshot = {
  generatedAt: string
  highestLeverageAction: PriorityActionCandidate | null
  actionQueue: PriorityActionCandidate[]
  graph: RuntimeGraphSnapshot
  diagnostics: {
    candidateCount: number
    rejectedGenericCount: number
    overloadRisk: number
    focusFragmentation: number
  }
  guardrails: {
    noGenericPlaceholders: true
    noRepairButtonLabels: true
    noAutonomousExecution: true
    humanApprovalAuthorityPreserved: true
  }
}
