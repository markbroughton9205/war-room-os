export type SourceConnectionCategory = 'ai_provider' | 'retrieval' | 'opportunity' | 'public_intelligence' | 'media'

export type SourceConnectionState =
  | 'NOT_CONFIGURED'
  | 'KEY_MISSING'
  | 'ACCOUNT_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'CONNECTION_UNVERIFIED'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'AUTHENTICATION_FAILED'
  | 'MANUAL_ONLY'
  | 'DISABLED'

export type SourceCostClass = 'free' | 'metered' | 'paid' | 'manual' | 'unknown'

export type SourceConnectionDescriptor = {
  id: string
  displayName: string
  category: SourceConnectionCategory
  accessMethod: string
  costClass: SourceCostClass
  requiredEnv: string[]
  accountRequired: boolean
  commanderApprovalRequired: boolean
  notes: string
}

export type SourceConnectionHealth = SourceConnectionDescriptor & {
  configuredState: SourceConnectionState
  connectionState: SourceConnectionState
  lastTest: string | null
  lastSuccessfulResponse: string | null
  lastRefresh: string | null
  currentFailure: string | null
  requiredCommanderAction: string | null
}

export type SourceAdapterHealthResult = {
  sourceId: string
  state: SourceConnectionState
  checkedAt: string
  lastSuccessfulResponse: string | null
  failure: string | null
  rateLimit: { limited: boolean; retryAfterSeconds: number | null } | null
}

export type NormalizedOpportunitySourceRecord = {
  sourceId: string
  sourceName: string
  title: string
  summary: string
  url: string | null
  sourceReference: string | null
  noticeId: string | null
  solicitationNumber: string | null
  placeOfPerformance: string | null
  naicsCodes: string[]
  pscCodes: string[]
  setAsideCode: string | null
  setAsideDescription: string | null
  publicationDate: string | null
  retrievedAt: string
  deadline: string | null
  expiry: string | null
  isActive: boolean
  evidenceStatus: 'LIVE_VERIFIED' | 'CACHED_CURRENT' | 'HISTORICAL' | 'UNKNOWN'
  freshnessStatus: 'CURRENT' | 'EXPIRED' | 'UNCERTAIN' | 'HISTORICAL'
  dedupeFingerprint: string
  estimatedValue: string | null
  categoryHint: string
  rawMetadata: Record<string, unknown>
}

export type SourceRefreshResult = {
  sourceId: string
  status: 'success' | 'partial_success' | 'failed' | 'not_configured'
  requestedAt: string
  completedAt: string
  retrieved: number
  accepted: number
  duplicates: number
  expired: number
  records: NormalizedOpportunitySourceRecord[]
  rejected: { title: string; reason: string }[]
  failure: string | null
  health: SourceAdapterHealthResult
  pagination: {
    pagesRequested: number
    pagesSucceeded: number
    recordsReceived: number
    recordsAccepted: number
    recordsRejected: number
    duplicates: number
    partialFailure: boolean
  }
}

export type OpportunitySourceAdapter = {
  descriptor: SourceConnectionDescriptor
  testConnection: () => Promise<SourceAdapterHealthResult>
  refresh: (input?: { query?: string; limit?: number; pageToken?: string | null; maxPages?: number; maxRecords?: number }) => Promise<SourceRefreshResult>
}
