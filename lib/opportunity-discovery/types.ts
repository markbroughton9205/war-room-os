export const DISCOVERY_ONLY = true as const

export type DiscoveryProvider = 'adzuna' | 'remote_ok' | 'sam_gov' | 'usaspending'
export type MatchSignal = 'SOFTWARE' | 'AI_AUTOMATION' | 'MACHINE_LEARNING' | 'DATA' | 'REMOTE_TECHNICAL' | 'GOVERNMENT_IT_CONTRACT'
export type LiveVerificationState = 'LIVE_VERIFIED' | 'BLOCKED_BY_ENVIRONMENT' | 'FAILED' | 'HISTORICAL_INTELLIGENCE'

export type DiscoveryOpportunity = {
  id: string
  provider: DiscoveryProvider
  providerRecordId: string
  title: string
  organization: string | null
  description: string | null
  location: string | null
  remoteStatus: 'REMOTE' | 'REMOTE_ELIGIBLE' | 'ONSITE' | 'UNKNOWN'
  opportunityType: 'JOB' | 'CONTRACT' | 'GOVERNMENT_SOLICITATION' | 'HISTORICAL_AWARD_INTELLIGENCE'
  employmentType: string | null
  compensation: { minimum: number | null; maximum: number | null; text: string | null } | null
  currency: string | null
  publishedAt: string | null
  deadline: string | null
  officialUrl: string | null
  discoveredAt: string
  retrievedAt: string
  attribution: string
  provenance: { endpoint: string; classification: string }
  rawSourceClassification: string
  matchReasons: string[]
  matchSignals: MatchSignal[]
  confidence: number
  liveVerificationState: LiveVerificationState
}

export type ProviderDiscoveryResult = {
  provider: DiscoveryProvider
  state: LiveVerificationState
  records: DiscoveryOpportunity[]
  error: string | null
  retrievedAt: string
}

export type NotificationResult = {
  state: 'NOTIFICATION_GENERATED' | 'EXTERNAL_DELIVERY' | 'BLOCKED_BY_ENVIRONMENT' | 'NOT_REQUIRED'
  channel: null
  providerMessageId: string | null
  body: string | null
  error: string | null
}
