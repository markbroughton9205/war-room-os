export type SourceNetworkTier = 'local_regional' | 'state_national' | 'international' | 'weak_signal_emerging'

export type PersistentSourceCategory =
  | 'local_news'
  | 'public_alerts'
  | 'broadcast_news'
  | 'local_audio_video'
  | 'community_discussion'
  | 'wire_service'
  | 'national_news'
  | 'business_finance'
  | 'politics_policy'
  | 'international_news'
  | 'state_media_or_perspective'
  | 'weak_signal'

export type SourceRetrievalMode = 'search_discovery' | 'direct_feed' | 'direct_fetch' | 'framing_only' | 'unconfigured'

export type SourceCategoryDefinition = {
  category: PersistentSourceCategory
  tier: SourceNetworkTier
  defaultReliability: number
  defaultManipulationRisk: 'low' | 'medium' | 'high'
  retrievalMode: SourceRetrievalMode
  operationalTruthEligible: boolean
}

export const SOURCE_CATEGORY_REGISTRY: SourceCategoryDefinition[] = [
  {
    category: 'local_news',
    tier: 'local_regional',
    defaultReliability: 0.78,
    defaultManipulationRisk: 'low',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'public_alerts',
    tier: 'local_regional',
    defaultReliability: 0.9,
    defaultManipulationRisk: 'low',
    retrievalMode: 'direct_feed',
    operationalTruthEligible: true,
  },
  {
    category: 'broadcast_news',
    tier: 'local_regional',
    defaultReliability: 0.74,
    defaultManipulationRisk: 'low',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'local_audio_video',
    tier: 'local_regional',
    defaultReliability: 0.42,
    defaultManipulationRisk: 'medium',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: false,
  },
  {
    category: 'community_discussion',
    tier: 'weak_signal_emerging',
    defaultReliability: 0.28,
    defaultManipulationRisk: 'high',
    retrievalMode: 'framing_only',
    operationalTruthEligible: false,
  },
  {
    category: 'wire_service',
    tier: 'state_national',
    defaultReliability: 0.9,
    defaultManipulationRisk: 'low',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'national_news',
    tier: 'state_national',
    defaultReliability: 0.78,
    defaultManipulationRisk: 'medium',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'business_finance',
    tier: 'state_national',
    defaultReliability: 0.84,
    defaultManipulationRisk: 'low',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'politics_policy',
    tier: 'state_national',
    defaultReliability: 0.76,
    defaultManipulationRisk: 'medium',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'international_news',
    tier: 'international',
    defaultReliability: 0.78,
    defaultManipulationRisk: 'medium',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: true,
  },
  {
    category: 'state_media_or_perspective',
    tier: 'international',
    defaultReliability: 0.48,
    defaultManipulationRisk: 'high',
    retrievalMode: 'search_discovery',
    operationalTruthEligible: false,
  },
  {
    category: 'weak_signal',
    tier: 'weak_signal_emerging',
    defaultReliability: 0.24,
    defaultManipulationRisk: 'high',
    retrievalMode: 'framing_only',
    operationalTruthEligible: false,
  },
]

export function getSourceCategoryDefinition(category: PersistentSourceCategory): SourceCategoryDefinition {
  return SOURCE_CATEGORY_REGISTRY.find(item => item.category === category) ?? SOURCE_CATEGORY_REGISTRY[SOURCE_CATEGORY_REGISTRY.length - 1]!
}
