export const MISSION_STATUSES = ['ACTIVE', 'PAUSED', 'BLOCKED', 'AT_TRIGGER', 'COMPLETE'] as const

export type MissionStatus = (typeof MISSION_STATUSES)[number]

export const MISSION_APPROVAL_STATES = ['none_required', 'pending', 'approved', 'rejected'] as const

export type MissionApprovalState = (typeof MISSION_APPROVAL_STATES)[number]

export type MissionId =
  | 'phase-0-cashflow-base'
  | 'content-automation'
  | 'automation-services'
  | 'real-estate-monitor'
  | 'debt-freedom-trigger'

export type Mission = {
  id: MissionId
  title: string
  description: string
  status: MissionStatus
  current_stage: string
  priority_score: number
  momentum_score: number
  blocker_score: number
  compounding_score: number
  revenue_score: number
  linked_packets: string[]
  linked_signals: string[]
  linked_outcomes: string[]
  linked_repairs: string[]
  approval_state: MissionApprovalState
  updated_at: string
}

export type MissionSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  missions: Mission[]
  guardrails: {
    persistentMissionSet: true
    humanApprovalAuthorityPreserved: true
    noAutonomousExecution: true
    noPlaceholderMissions: true
  }
}
