export const SIGNAL_CATEGORIES = [
  'freight',
  'sprinter_van',
  'local_delivery',
  'load_board',
  'job',
  'gig',
  'data_annotation',
  'AI_evaluation',
  'SMB_automation',
  'customer_operations',
  'call_center',
  'AI_trends',
  'local_Akron',
  'Ohio_business',
  'economic_warning',
  'app_factory_opportunity',
] as const

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number]

export const SIGNAL_APPROVAL_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'low_confidence',
  'archived',
] as const

export type SignalApprovalStatus = (typeof SIGNAL_APPROVAL_STATUSES)[number]

export type SignalProviderId =
  | 'tavily'
  | 'firecrawl'
  | 'rss'
  | 'newsapi'
  | 'guardian'
  | 'manual_registry'
  | 'source_url'

export type SignalSourceKind =
  | 'search'
  | 'page_extract'
  | 'rss'
  | 'news_api'
  | 'guardian'
  | 'manual_registry'
  | 'job_gig_url'
  | 'freight_url'
  | 'smb_lead_url'
  | 'ai_trend_url'
  | 'local_economic_url'

export type SignalFreshnessStatus =
  | 'LIVE'
  | 'RECENT'
  | 'STALE'
  | 'UNKNOWN_DATE'

export type BabySignalFamily =
  | 'Income Operations Baby'
  | 'Analyst Baby'
  | 'Red Team Baby'
  | 'Feature Builder'
  | 'Grok Family Baby'
  | 'Claude Family Baby'

export type SignalSourceDefinition = {
  id: string
  label: string
  provider: SignalProviderId
  kind: SignalSourceKind
  categories: SignalCategory[]
  url: string | null
  query: string | null
  configured: boolean
  reliabilityScore: number
  notes: string
}

export type SignalRawItem = {
  provider: SignalProviderId
  sourceId: string
  sourceLabel: string
  sourceKind: SignalSourceKind
  title: string
  url: string
  summary: string
  categories: SignalCategory[]
  rawScore: number | null
  capturedAt: string
  metadata?: Record<string, unknown>
}

export type SignalScores = {
  relevance: number
  incomePotential: number
  urgency: number
  confidence: number
  startupCost: number
  timeToProfit: number
  repeatability: number
  strategicAlignment: number
  familyImpact: number
  highestLeverage: number
}

export type SignalResult = {
  id: string
  scanId: string | null
  title: string
  source: string
  provider: SignalProviderId
  sourceKind: SignalSourceKind
  url: string
  summary: string
  category: SignalCategory
  scores: SignalScores
  startupCostEstimate: string
  timeToProfitEstimate: string
  recommendedNextAction: string
  assignedBabyFamily: BabySignalFamily
  approvalStatus: SignalApprovalStatus
  capturedAt: string
  metadata: Record<string, unknown>
  guardrails: {
    sourceBacked: true
    recommendationOnly: true
    approvalRequired: true
    externalExecutionAllowed: false
    hiddenExecutionAllowed: false
    incomeClaimed: false
  }
}

export type SignalAlert = {
  id: string
  severity: 'info' | 'watch' | 'important' | 'critical'
  title: string
  summary: string
  sourceAttribution: string
  approvalRequired: true
  canExecute: false
}

export type SignalScan = {
  id: string
  status: 'completed' | 'partial' | 'failed'
  startedAt: string
  completedAt: string
  sourceCount: number
  resultCount: number
  freshnessSummary?: SignalFreshnessSummary
  providerDiagnostics: Record<string, unknown>
  error: string | null
}

export type SignalFreshnessSummary = {
  latestScanTime: string
  maxAgeDays: number
  freshResultCount: number
  staleDiscardedCount: number
  unknownDateDiscardedCount: number
  oldestAcceptedAgeDays: number | null
  liveCount: number
  recentCount: number
}

export type SignalSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  migrationStatus: 'READY' | 'MIGRATION_REQUIRED' | 'UNAVAILABLE'
  sources: SignalSourceDefinition[]
  latestScan: SignalScan | null
  results: SignalResult[]
  strongestSignal: SignalResult | null
  rejectedOrLowConfidence: SignalResult[]
  alerts: SignalAlert[]
  integrations: {
    revenueEngine: string[]
    babyDailyBriefing: string[]
    opportunityPipeline: string[]
    incomeOperationsBaby: string[]
    analystBaby: string[]
    redTeamBaby: string[]
    featureBuilderSuggestions: string[]
  }
  guardrails: {
    cloudOnly: true
    noLocalAgents: true
    noOllama: true
    noLmStudio: true
    noBridge: true
    noLocalhost: true
    noFakeSignals: true
    noAutomaticOutreachSpendApplicationsOrExecution: true
    approvalRequiredBeforeAction: true
  }
}
