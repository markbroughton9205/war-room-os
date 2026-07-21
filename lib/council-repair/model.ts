export type RepairClassification =
  | 'bug'
  | 'ui_issue'
  | 'provider_runtime_issue'
  | 'needs_scope'
  | 'supabase_schema_issue'
  | 'performance_issue'
  | 'routing_orchestration_issue'
  | 'council_prompt_issue'
  | 'security_truth_boundary_issue'

export type RepairApprovalStatus = 'awaiting_commander_approval' | 'approved_for_manual_cursor' | 'rejected'

export type RepairPacketStatus =
  | 'detected'
  | 'analysis_required'
  | 'awaiting_council'
  | 'awaiting_red_team'
  | 'proposal_ready'
  | 'awaiting_commander'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'repair_unavailable'
  | 'report_generated'
  | 'archived'

export type RepairSeverity = 'critical' | 'high' | 'medium' | 'low'

/** Projects the full lifecycle status onto the older, narrower approval badge status. */
export function deriveApprovalStatusFromStatus(status: RepairPacketStatus): RepairApprovalStatus {
  if (status === 'approved') return 'approved_for_manual_cursor'
  if (status === 'rejected') return 'rejected'
  return 'awaiting_commander_approval'
}

import type { OperatorNextStepsPayload } from '@/lib/operator/nextStepsReport'

export type RepairFamilyKey = 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'red_team' | 'baby_observer'

export type RepairFamilyContribution = {
  family: RepairFamilyKey
  label: string
  role: string
  contribution: string
  approvalRequired: true
  canExecute: false
}

export type BabyRepairLessonCandidate = {
  id: string
  summary: string
  source: 'repair_outcome'
  lessonState: 'candidate'
  commanderApprovalRequired: true
  canExecute: false
}

export type CouncilRepairRequest = {
  id: string
  decree: string
  sourceMessageId: string | null
  sourceFamily: string | null
  sourceContent: string | null
  classification: RepairClassification
  matchedTriggers: string[]
  createdAt: string
  advisoryOnly: true
}

export type CouncilRepairPacket = {
  id: string
  requestId: string
  title: string
  classification: RepairClassification
  concreteIssue: string
  affectedPanelRoute: string
  evidence: string[]
  source: {
    decree: string
    sourceMessageId: string | null
    sourceFamily: string | null
    sourceContent: string | null
    packetSource: string
  }
  observedSymptoms: string[]
  suspectedRootCause: string
  filesRoutesToInspect: string[]
  recommendedFix: string[]
  validationCommands: [
    'pnpm exec tsc --noEmit',
    'pnpm exec eslint app components lib --max-warnings=0',
    'pnpm run build',
  ]
  riskNotes: string[]
  rollbackNotes: string[]
  /** Spec-aligned alias of rollbackNotes (same content); rollbackNotes remains the rendered field. */
  rollbackPlan: string[]
  approvalStatus: RepairApprovalStatus
  /** Full repair lifecycle status — source of truth; approvalStatus is derived from this. */
  status: RepairPacketStatus
  sourcePanel: string
  sourceEventId: string | null
  summary: string
  severity: RepairSeverity
  detectedAt: string
  lastObservedAt: string
  affectedSubsystem: string
  securityImpact: string
  userImpact: string
  reliabilityImpact: string
  councilRecommendation: string
  redTeamRecommendation: string
  proposedRepair: string
  verificationRequirements: string[]
  familyContributions: RepairFamilyContribution[]
  riskReview: RepairFamilyContribution
  babyLessonCandidate: BabyRepairLessonCandidate
  connectedSurfaces: string[]
  guardrails: {
    advisoryOnly: true
    approvalRequired: true
    browserSideExecution: false
    fileMutation: false
    shellExecution: false
    cursorApiInvocation: false
    automaticDeploy: false
    fakeRepairCompletion: false
  }
  cursorReadyPrompt: string
  operatorNextSteps: OperatorNextStepsPayload['report']
  operatorNextStepsMarkdown: string
  createdAt: string
}

export type CouncilRepairSnapshot = {
  generatedAt: string
  latestRequest: CouncilRepairRequest | null
  latestPacket: CouncilRepairPacket | null
  requests: CouncilRepairRequest[]
  packets: CouncilRepairPacket[]
  persistenceNote: string
  guardrails: CouncilRepairPacket['guardrails']
}

export type RepairPacketCreateResult =
  | { ok: true; request: CouncilRepairRequest; packet: CouncilRepairPacket }
  | { ok: false; scope: 'needs_scope'; request: CouncilRepairRequest; clarification: string; affectedPanelRoute: string | null }

export type CreateRepairRequestInput = {
  decree: string
  sourceMessageId?: string | null
  sourceFamily?: string | null
  sourceContent?: string | null
}

export type CreateRepairPacketInput = CreateRepairRequestInput & {
  request?: CouncilRepairRequest | null
  /** Originating dashboard panel, when the packet is triggered from somewhere other than a decree. */
  sourcePanel?: string | null
  /** Originating WarRoomEvent id, when the packet is triggered from an event rather than a decree. */
  sourceEventId?: string | null
}

export const REPAIR_VALIDATION_COMMANDS: CouncilRepairPacket['validationCommands'] = [
  'pnpm exec tsc --noEmit',
  'pnpm exec eslint app components lib --max-warnings=0',
  'pnpm run build',
]

export const COUNCIL_REPAIR_GUARDRAILS: CouncilRepairPacket['guardrails'] = {
  advisoryOnly: true,
  approvalRequired: true,
  browserSideExecution: false,
  fileMutation: false,
  shellExecution: false,
  cursorApiInvocation: false,
  automaticDeploy: false,
  fakeRepairCompletion: false,
}
