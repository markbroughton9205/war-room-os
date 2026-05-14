export type IncomeWorkerId =
  | 'job_scout'
  | 'gig_scout'
  | 'freight_lead'
  | 'remote_work'
  | 'contract_opportunity'
  | 'digital_product'
  | 'affiliate_lead_gen'
  | 'automation_service'
  | 'revenue_tracker'
  | 'payout_preparation'

export type IncomeWorkerStatus = 'idle' | 'scouting' | 'verifying' | 'assigned' | 'blocked' | 'error'

export type IncomeWorkerRiskLevel = 'low' | 'medium' | 'high'

export type IncomeWorkerMissionStatus =
  | 'scouted'
  | 'verified'
  | 'scored'
  | 'assigned'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'paid'
  | 'blocked'

export type IncomeWorker = {
  id: IncomeWorkerId
  name: string
  focus: string
  capabilities: string[]
  status: IncomeWorkerStatus
  requiresApproval: boolean
  payoutProofRequired: boolean
  secureApprovalRequiredForPayouts: boolean
}

export type IncomeWorkerWorkflowStep = {
  order: number
  id: string
  label: string
  approvalRequired: boolean
}

export type IncomeWorkerCandidate = {
  title: string
  url: string
  source: string
  country: string
  type: string
  payout: string | null
  currency: string | null
  expiration: string | null
  riskLevel: IncomeWorkerRiskLevel
  verificationStatus: 'candidate' | 'rejected'
  reason: string
  provider: string
  score: number
  eligibleWorkers: IncomeWorkerId[]
}

export type IncomeWorkerScoutResult = {
  status: 'found' | 'no_results' | 'error' | 'config_needed'
  message: string
  scannedAt: string
  providerUsed: string
  sourcesChecked: number
  candidates: IncomeWorkerCandidate[]
  rejected: IncomeWorkerCandidate[]
}

export type IncomeWorkerAssignmentRequest = {
  candidate?: IncomeWorkerCandidate
  opportunityId?: string
  workerId?: IncomeWorkerId
  notes?: string
}

export type IncomeWorkerAssignmentPlan = {
  missionId: string
  workerId: IncomeWorkerId
  workerName: string
  status: IncomeWorkerMissionStatus
  title: string
  sourceUrl: string | null
  expectedPayout: string | null
  actualPayout: null
  payoutProofRequired: true
  secureApprovalRequiredForPayouts: true
  actionPlan: string[]
  approvalRequired: true
}
