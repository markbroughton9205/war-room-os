import type { EvidenceConfidenceTier } from '@/lib/intelligence/intelligencePacket'
import type { EnvAliasDiagnostic } from '@/lib/configuration/envAlias'
import type {
  SignalFreshnessStatus,
  SignalOperationalStatus,
  SignalSourceStatus,
  SignalTimeIntegrityStatus,
} from '@/lib/signals/model'

export type ProviderAvailability = 'available' | 'unavailable' | 'error'
export type WeatherProviderState = 'configured_but_fetch_failed' | 'configured_and_live' | 'missing_key' | 'missing_provider'

export type EnvironmentSetupGuidance = {
  envVarNames: string[]
  preferredEnvName: string | null
  aliasDetected: boolean
  configured: boolean
  aliasRecommendation: string | null
  envAliasDiagnostics: EnvAliasDiagnostic[]
  blockedFeature: string
  recommendedSetup: string
}

export type WeatherForecastPoint = {
  label: string
  tempF: number | null
  condition: string
  precipitationChance: number | null
  wind: string | null
}

export type WeatherAlert = {
  title: string
  severity: string
  expiresAt: string | null
  source: string
}

export type WeatherDashboardSnapshot = {
  status: ProviderAvailability
  providerState: WeatherProviderState
  provider: string
  locationLabel: string
  currentTempF: number | null
  condition: string
  highF: number | null
  lowF: number | null
  precipitationChance: number | null
  wind: string | null
  alerts: WeatherAlert[]
  hourlyForecast: WeatherForecastPoint[]
  dailyForecast: WeatherForecastPoint[]
  freshness: string
  fetchedAt: string | null
  source: string
  detail: string
  diagnostics?: string[]
  setup?: EnvironmentSetupGuidance
}

export type NewsCategory = 'local' | 'regional' | 'national' | 'international'

export type NewsDashboardCard = {
  id: string
  title: string
  url: string | null
  sourceName: string
  category: NewsCategory
  imageUrl: string | null
  /** Article publication instant — never ingestion time. */
  articlePublishedAt: string | null
  /** When War Room ingested/cached the card. */
  signalIngestedAt: string
  signalVerifiedAt: string | null
  /** @deprecated Use timestampLabel — kept for API compatibility. */
  publishedAt: string | null
  /** Primary card line: Published … · Ingested … · Source */
  timestampLabel: string
  /** @deprecated Use timestampLabel */
  freshness: string
  sourceStatus: SignalSourceStatus
  freshnessStatus: SignalFreshnessStatus
  operationalStatus: SignalOperationalStatus
  timeIntegrityStatus: SignalTimeIntegrityStatus
  displayLabel: string
  confidenceLabel: EvidenceConfidenceTier
  signalLabel: 'verified' | 'emerging' | 'weak-signal'
  detail: string
  provider?: 'guardian' | 'newsapi' | 'rss' | 'intelligence'
}

export type NewsFreshnessDiagnostics = {
  freshAcceptedCount: number
  recentAcceptedCount: number
  staleSuppressedCount: number
  oldestActiveResultAgeDays: number | null
  oldestStoredResultAgeDays: number | null
  cacheFilteredCount: number
}

export type NewsDashboardSnapshot = {
  status: ProviderAvailability
  provider: string
  cards: NewsDashboardCard[]
  fetchedAt: string | null
  freshness: string
  source: string
  detail: string
  diagnostics?: string[]
  freshnessDiagnostics?: NewsFreshnessDiagnostics
  setup?: EnvironmentSetupGuidance
}

export type FinanceQuote = {
  symbol: string
  price: number | null
  change: number | null
  percentChange: number | null
  currency: string | null
  marketType: 'index' | 'stock' | 'crypto' | 'commodity' | 'unknown'
  direction: 'up' | 'down' | 'flat' | 'unknown'
  movementSummary: string
  marketStatus: string | null
  freshness: string
  fetchedAt: string | null
}

export type FinanceDashboardSnapshot = {
  status: ProviderAvailability
  provider: string
  quotes: FinanceQuote[]
  fetchedAt: string | null
  freshness: string
  source: string
  detail: string
  setup?: EnvironmentSetupGuidance
}

export type LiveEnvironmentDashboardPayload = {
  weather: WeatherDashboardSnapshot
  news: NewsDashboardSnapshot
  finance: FinanceDashboardSnapshot
  generatedAt: string
  safety: {
    exposesSecretValues: false
    runtimeTruthOnly: true
    sourceBackedOnly: true
  }
}
