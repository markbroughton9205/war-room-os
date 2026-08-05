/**
 * Phase 49-C-1 — Opportunity Agent Workforce core types.
 *
 * Truth rules baked into these types:
 * - Estimated money and actual received money are separate fields and can never
 *   share a value object (`RevenueFigure.basis` marks confirmed vs estimate).
 * - Evidence-gated statuses (RUNNING, SUBMITTED, WON, COMPLETED, VERIFIED) may
 *   only be set through the Work Execution Coordinator with evidence — see
 *   workExecutionCoordinator.ts.
 * - All outbound materials are `DraftMaterial.status: 'draft'` and cannot be
 *   marked sent through this module.
 */

/** Initial categories — the union is a string so new categories can be added
 * without touching this file; CATEGORY_REGISTRY carries per-category rules. */
export type OpportunityCategory =
  | 'transportation_delivery'
  | 'local_service_leads'
  | 'ai_automation_services'
  | 'warroom_licensing_consulting'
  | 'remote_contract_work'
  | 'government_procurement'
  | 'private_subcontracting'
  | 'grants_business_assistance'
  | 'partnerships'
  | 'digital_products_services'
  | 'customer_lead_generation'
  | (string & {})

export const OPPORTUNITY_STATUSES = [
  'DISCOVERED',
  'RESEARCHING',
  'QUALIFIED',
  'REJECTED',
  'DEFERRED',
  'PREPARING',
  'AWAITING_COMMANDER_APPROVAL',
  'APPROVED_FOR_PURSUIT',
  'QUEUED',
  'RUNNING',
  'SUBMITTED',
  'AWAITING_RESPONSE',
  'WON',
  'LOST',
  'COMPLETED',
  'VERIFIED',
  'BLOCKED',
  'FAILED',
] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

/** Statuses that must never be set without supporting evidence. */
export const EVIDENCE_GATED_STATUSES: readonly OpportunityStatus[] = [
  'RUNNING',
  'SUBMITTED',
  'WON',
  'COMPLETED',
  'VERIFIED',
]

export const QUALIFICATION_STATUSES = [
  'HIGH_FIT',
  'POSSIBLE_FIT',
  'LOW_FIT',
  'NOT_ELIGIBLE',
  'NEEDS_MORE_EVIDENCE',
  'EXPIRED',
  'DUPLICATE',
] as const
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number]

export const EVIDENCE_STATUSES = [
  'LIVE_VERIFIED',
  'CACHED_CURRENT',
  'HISTORICAL',
  'MODEL_JUDGMENT',
  'UNKNOWN',
] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

export const FRESHNESS_STATUSES = ['CURRENT', 'EXPIRED', 'UNCERTAIN', 'HISTORICAL'] as const
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number]

export type RiskLevel = 'low' | 'medium' | 'high'
export type EffortLevel = 'low' | 'medium' | 'high'

export type RevenueFigure = {
  /** Numeric amount when parseable; null when only a narrative exists. */
  amount: number | null
  currency: string
  /** 'confirmed' only for numbers coming from a source document; 'estimate' for
   * anything the Revenue Analyst computed. Never 'guaranteed'. */
  basis: 'confirmed' | 'estimate'
  notes: string
}

export type OpportunityAuditEntry = {
  at: string
  /** 'scout' | 'qualification' | 'revenue' | 'planner' | 'coordinator' | 'verification' | 'auditor' | 'commander' | 'system' */
  actor: string
  fromStatus: OpportunityStatus | null
  toStatus: OpportunityStatus | null
  message: string
  evidence?: string | null
}

export type DraftMaterial = {
  kind: 'proposal' | 'application' | 'capability_statement' | 'quote' | 'outreach_email' | 'call_script' | 'customer_message' | 'partnership_message' | 'document_checklist'
  title: string
  body: string
  /** Always 'draft'. Outbound use requires explicit Commander approval. */
  status: 'draft'
  createdBy: 'proposal_agent' | 'lead_outreach_agent'
  createdAt: string
}

export type LeadRecord = {
  id: string
  name: string
  contactSource: string
  relevance: string
  status: 'queued_for_approval'
  outreachDraftId: string | null
  createdAt: string
}

export type OpportunityRecord = {
  id: string
  title: string
  category: OpportunityCategory
  summary: string
  source: string
  sourceUrl: string | null
  sourceReference: string | null
  noticeId: string | null
  solicitationNumber: string | null
  placeOfPerformance: string | null
  naicsCodes: string[]
  pscCodes: string[]
  setAsideCode: string | null
  setAsideDescription: string | null
  sourcePublishedAt: string | null
  retrievedAt: string
  deadline: string | null
  location: string | null
  opportunityValue: RevenueFigure | null
  estimatedRevenue: RevenueFigure | null
  estimatedCosts: RevenueFigure | null
  estimatedMargin: RevenueFigure | null
  upfrontCashRequired: RevenueFigure | null
  paymentTerms: string | null
  eligibility: string[]
  qualificationStatus: QualificationStatus
  evidenceStatus: EvidenceStatus
  freshnessStatus: FreshnessStatus
  riskLevel: RiskLevel
  effortLevel: EffortLevel
  timeToRevenue: string | null
  requiredResources: string[]
  missingRequirements: string[]
  nextAction: string | null
  commanderApprovalRequired: true
  status: OpportunityStatus
  assignedAgents: string[]
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  completedAt: string | null
  verifiedAt: string | null
  /** Actual money received — only set by the Result Verification Agent with evidence. */
  actualRevenue: RevenueFigure | null
  actualCosts: RevenueFigure | null
  actualProfit: RevenueFigure | null
  outcomeEvidence: string | null
  auditHistory: OpportunityAuditEntry[]
}

export type PursuitPlanStep = {
  order: number
  action: string
  requiresCommanderApproval: boolean
  dependsOn: number[]
}

export type PursuitPlan = {
  steps: PursuitPlanStep[]
  requiredDocuments: string[]
  earliestNextAction: string
  completionEvidence: string
  commanderApprovalsRequired: string[]
}

export type OpportunityWorkPacket = {
  opportunityId: string
  generatedAt: string
  persistenceNote: string
  opportunitySummary: string
  evidenceAndSources: { source: string; sourceUrl: string | null; sourceReference: string | null; noticeId: string | null; solicitationNumber: string | null; placeOfPerformance: string | null; naicsCodes: string[]; pscCodes: string[]; setAsideCode: string | null; setAsideDescription: string | null; publishedAt: string | null; retrievedAt: string; evidenceStatus: EvidenceStatus; freshnessStatus: FreshnessStatus }
  whyItFits: string[]
  whyItMayNotFit: string[]
  eligibilityRequirements: string[]
  estimatedRevenue: RevenueFigure | null
  estimatedCosts: RevenueFigure | null
  estimatedProfit: RevenueFigure | null
  timeToFirstRevenue: string | null
  riskAssessment: { level: RiskLevel; factors: string[] }
  missingResources: string[]
  requiredDocuments: string[]
  recommendedDecision: 'pursue' | 'defer' | 'reject' | 'research_more'
  exactNextSteps: string[]
  draftMaterials: DraftMaterial[]
  commanderApprovalsRequired: string[]
  verificationPlan: string
  expirationOrDeadline: string | null
  confidenceLevel: number
  factsVsEstimates: { facts: string[]; estimates: string[] }
}

export type AuditorFlagKind =
  | 'unsupported_success_claim'
  | 'stale_opportunity'
  | 'duplicate'
  | 'deadline_exceeded'
  | 'awaiting_commander_approval'

export type AuditorFlag = {
  kind: AuditorFlagKind
  message: string
  raisedAt: string
}

export type CommanderDecisionAction = 'approve' | 'reject' | 'defer' | 'request_research'


export type RevenueAnalysis = {
  opportunityId: string
  estimatedRevenue: RevenueFigure | null
  estimatedCosts: RevenueFigure | null
  estimatedProfit: RevenueFigure | null
  upfrontCashRequired: RevenueFigure | null
  paymentTerms: string | null
  timeToRevenue: string | null
  facts: string[]
  estimates: string[]
}

export type ActionPlan = {
  opportunityId: string
  generatedAt: string
  steps: PursuitPlanStep[]
  requiredDocuments: string[]
  commanderApprovalsRequired: string[]
  verificationPlan: string
  earliestNextAction: string
}

export type ResultVerificationStatus =
  | 'planned'
  | 'attempted'
  | 'submitted'
  | 'accepted'
  | 'awarded'
  | 'invoiced'
  | 'paid'
  | 'independently_verified'

export type ResultVerification = {
  opportunityId: string
  status: ResultVerificationStatus
  evidence: string | null
  actualRevenue: RevenueFigure | null
  actualCosts: RevenueFigure | null
  actualProfit: RevenueFigure | null
  verifiedAt: string | null
  safeToReportRevenue: boolean
}

export type OpportunityWorkflowStage =
  | 'DISCOVER'
  | 'SOURCE_VERIFY'
  | 'DUPLICATE_CHECK'
  | 'QUALIFY'
  | 'REVENUE_ANALYSIS'
  | 'RISK_REVIEW'
  | 'PREPARE_WORK_PACKET'
  | 'PREPARE_DRAFTS'
  | 'AWAIT_COMMANDER_APPROVAL'

export type OpportunityWorkflowRun = {
  id: string
  opportunityId: string
  createdAt: string
  stages: OpportunityWorkflowStage[]
  record: OpportunityRecord
  qualification: QualificationResultSummary
  revenue: RevenueAnalysis
  actionPlan: ActionPlan
  workPacket: OpportunityWorkPacket
  draftMaterials: DraftMaterial[]
  lead: LeadRecord | null
  auditFlags: AuditorFlag[]
  approvalRequired: true
  externalActionsExecuted: false
  persistence: 'session_only'
}

export type QualificationResultSummary = {
  qualificationStatus: QualificationStatus
  whyItFits: string[]
  whyItMayNotFit: string[]
  missingRequirements: string[]
}
