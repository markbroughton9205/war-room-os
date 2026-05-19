import type { SignalProviderId, SignalResult } from '../model'

export const INTELLIGENCE_CATEGORIES = [
  'geopolitics',
  'markets',
  'local_economy',
  'business_opportunity',
  'operational_risk',
  'infrastructure',
  'AI_industry',
  'emergency',
] as const

export type IntelligenceCategory = (typeof INTELLIGENCE_CATEGORIES)[number]

export const INTELLIGENCE_OPERATIONAL_CLASSES = [
  'ACTIONABLE',
  'WATCHLIST',
  'ARCHIVAL',
  'CONFLICTED',
] as const

export type IntelligenceOperationalClass = (typeof INTELLIGENCE_OPERATIONAL_CLASSES)[number]

export const INTELLIGENCE_SEVERITY_LEVELS = [
  'low',
  'moderate',
  'elevated',
  'critical',
] as const

export type IntelligenceSeverity = (typeof INTELLIGENCE_SEVERITY_LEVELS)[number]

export type IntelligenceTruthLabel = 'PROPOSED' | 'SOURCE_BACKED' | 'APPROVAL_REQUIRED'

export type SignalClassification = {
  intelligenceCategory: IntelligenceCategory
  categoryConfidence: number
  classificationConfidence: number
  sourceCredibilityScore: number
  operationalClass: IntelligenceOperationalClass
  intelligenceSeverity: IntelligenceSeverity
  truthLabel: IntelligenceTruthLabel
  operatorSourceVerified: boolean
  canonicalSummary: string
  rawHeadline: string
  narrativeGroupId: string | null
  contradictionGroupId: string | null
  collapsedDuplicateCount: number
  contradictionPeerIds: string[]
  classificationDiagnostics: string[]
  classificationFailed: boolean
}

export type ClassificationPipelineDiagnostics = {
  processedCount: number
  actionableCount: number
  watchlistCount: number
  archivalCount: number
  conflictedCount: number
  collapsedNarrativeCount: number
  contradictionGroups: number
  failures: Array<{ signalId: string; error: string }>
}

export type ClassifiedSignalResult = SignalResult & {
  classification: SignalClassification
}

export type ClassificationInput = Pick<
  SignalResult,
  'id' | 'title' | 'summary' | 'source' | 'provider' | 'url' | 'category' | 'scores' | 'metadata' | 'approvalStatus'
>

export type CredibilityInput = {
  provider: SignalProviderId
  sourceLabel: string
  url: string
  reliabilityScore?: number
}
