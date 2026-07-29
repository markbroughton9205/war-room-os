import type { Mission, MissionId, MissionStatus } from '@/lib/missions/types'
import type { PriorityApprovalState, PriorityActionCandidate } from '@/lib/priority-engine/types'

export const OPERATOR_TRUTH_LABELS = [
  'SOURCE_BACKED',
  'MANUAL_LOGGED',
  'PROPOSED',
  'APPROVAL_REQUIRED',
  'UNAVAILABLE',
] as const

export type OperatorTruthLabel = (typeof OPERATOR_TRUTH_LABELS)[number]

export type OperatorActionStatus = 'proposed' | 'approved' | 'completed' | 'skipped'

export type OperatorAction = {
  id: string
  title: string
  linkedMission: MissionId
  linkedMissionTitle: string
  estimatedPay: number | null
  estimatedPayLabel: string
  estimatedTimeMinutes: number | null
  estimatedTimeLabel: string
  source: PriorityActionCandidate['source'] | 'manual' | 'operator'
  sourceId: string | null
  confidence: number
  approvalState: PriorityApprovalState
  status: OperatorActionStatus
  optionalLink: string | null
  createdAt: string
  truthLabel: OperatorTruthLabel
  evidence: string[]
}

export type OperatorFinancialMetric = {
  key:
    | 'liquid_balance'
    | 'weekly_earnings'
    | 'projected_30_day_income'
    | 'six_hundred_trigger'
    | 'debt_freedom_distance'
    | 'last_logged_earning'
  label: string
  value: string
  numericValue: number | null
  progress: number | null
  truthLabel: OperatorTruthLabel
  source: string | null
}

export type OperatorMissionStatus = {
  id: MissionId
  title: string
  status: MissionStatus
  keyMetric: string
  progress: number
  momentum: number
  lastUpdated: string
  triggerCondition: string
  approvalState: Mission['approval_state']
  truthLabel: OperatorTruthLabel
}

export type OperatorPacketSummary = {
  id: string
  title: string
  packetType: 'approval_packet' | 'email_draft' | 'queue_refresh' | 'council_proposal' | 'unknown'
  status: 'pending' | 'approved' | 'drafted' | 'completed'
  body: string
  recipient: string | null
  proposedEffect: string
  approvalRequirement: string
  executionRelationship: string
  createdAt: string
  truthLabel: OperatorTruthLabel
}

export type OperatorActivity = {
  id: string
  type: string
  summary: string
  createdAt: string
  truthLabel: OperatorTruthLabel
}

export type OperatorDeckSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  realtimeAvailable: boolean
  stateLabel: OperatorTruthLabel
  actionQueue: OperatorAction[]
  financialTelemetry: OperatorFinancialMetric[]
  missions: OperatorMissionStatus[]
  packets: OperatorPacketSummary[]
  lastPacket: OperatorPacketSummary | null
  recentActivity: OperatorActivity[]
  integrations: {
    liveCouncil: OperatorTruthLabel
    babyAiObserver: OperatorTruthLabel
    revenueEngine: OperatorTruthLabel
    signalRadar: OperatorTruthLabel
    growthCalendar: OperatorTruthLabel
    outcomeLedger: OperatorTruthLabel
    commanderOs: OperatorTruthLabel
    approvalQueue: OperatorTruthLabel
  }
  guardrails: {
    noFakeEarnings: true
    noFakeBalances: true
    noHiddenActions: true
    noAutonomousSpending: true
    noAutomaticEmailSending: true
    commanderApprovalRequired: true
  }
}

export type OperatorActionCommand =
  | {
      command: 'skip'
      actionId: string
      reason?: string | null
    }
  | {
      command: 'request_better_queue'
    }
  | {
      command: 'approve_last_packet'
      confirmed: boolean
    }
  | {
      command: 'approve_packet'
      packetId: string
      confirmed: boolean
    }
  | {
      command: 'manual_email_alert'
      recipient?: string | null
      subject?: string | null
      body?: string | null
      confirmed: boolean
    }

export type OperatorLogEarningsInput = {
  actionId?: string | null
  title: string
  missionId: MissionId
  amountEarned: number
  timeSpentMinutes: number
  notes?: string | null
  sourceUri?: string | null
  confirmed: boolean
}

export type OperatorWriteResult = {
  ok: boolean
  persistenceAvailable: boolean
  message: string
  snapshot?: OperatorDeckSnapshot
}
