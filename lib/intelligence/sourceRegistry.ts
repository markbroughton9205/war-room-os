export type IntelligenceSourceCategory = 'verified_structured' | 'emerging_weak_signal'

export type IntelligenceSourceType =
  | 'search'
  | 'crawl'
  | 'direct_fetch'
  | 'weather'
  | 'finance'
  | 'government_public_data'
  | 'rss'
  | 'logistics'
  | 'economic_indicator'
  | 'podcast'
  | 'local_reporter'
  | 'independent_blog'
  | 'subreddit'
  | 'x_twitter'
  | 'niche_community'
  | 'rumor_feed'

export type SourceVerifiedLevel = 'verified' | 'semi_verified' | 'unverified'
export type SourceCostLevel = 'free' | 'low' | 'medium' | 'high'
export type SourceFailureBehavior = 'skip' | 'degrade' | 'block_operational_truth'

export type IntelligenceSourceCapability =
  | 'broad_web_search'
  | 'page_extraction'
  | 'current_conditions'
  | 'market_data'
  | 'official_records'
  | 'feed_monitoring'
  | 'route_status'
  | 'macro_indicators'
  | 'longform_signal'
  | 'local_reporting'
  | 'community_discussion'
  | 'social_velocity'
  | 'rumor_detection'
  | 'weak_signal_detection'

export type IntelligenceUseCase =
  | 'income_generation'
  | 'local_awareness'
  | 'market_research'
  | 'weather_risk'
  | 'finance_monitoring'
  | 'public_policy'
  | 'supply_chain'
  | 'weak_signal_detection'
  | 'contradiction_analysis'
  | 'general_research'

export type IntelligenceRateLimit = {
  requests: number
  windowSeconds: number
}

export type IntelligenceSourceDefinition = {
  source_id: string
  label: string
  category: IntelligenceSourceCategory
  source_type: IntelligenceSourceType
  capabilities: IntelligenceSourceCapability[]
  verified_level: SourceVerifiedLevel
  freshness_window: string
  reliability_score: number
  cost_level: SourceCostLevel
  configured: boolean
  allowed_use_cases: IntelligenceUseCase[]
  rate_limits: IntelligenceRateLimit | null
  failure_behavior: SourceFailureBehavior
}

const configured = (envName: string) => Boolean(process.env[envName]?.trim())

export function getIntelligenceSourceRegistry(): IntelligenceSourceDefinition[] {
  return [
    {
      source_id: 'tavily',
      label: 'Tavily Search',
      category: 'verified_structured',
      source_type: 'search',
      capabilities: ['broad_web_search', 'feed_monitoring'],
      verified_level: 'semi_verified',
      freshness_window: 'minutes-to-days depending on indexed result',
      reliability_score: 0.78,
      cost_level: 'medium',
      configured: configured('TAVILY_API_KEY'),
      allowed_use_cases: ['general_research', 'income_generation', 'market_research', 'local_awareness', 'contradiction_analysis'],
      rate_limits: { requests: 30, windowSeconds: 60 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'firecrawl',
      label: 'Firecrawl',
      category: 'verified_structured',
      source_type: 'crawl',
      capabilities: ['page_extraction', 'broad_web_search'],
      verified_level: 'semi_verified',
      freshness_window: 'page fetch time',
      reliability_score: 0.74,
      cost_level: 'medium',
      configured: configured('FIRECRAWL_API_KEY'),
      allowed_use_cases: ['general_research', 'income_generation', 'market_research', 'contradiction_analysis'],
      rate_limits: { requests: 20, windowSeconds: 60 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'direct_fetch',
      label: 'Validated Direct URL Fetch',
      category: 'verified_structured',
      source_type: 'direct_fetch',
      capabilities: ['page_extraction'],
      verified_level: 'semi_verified',
      freshness_window: 'fetch time',
      reliability_score: 0.72,
      cost_level: 'free',
      configured: true,
      allowed_use_cases: ['general_research', 'market_research', 'local_awareness', 'contradiction_analysis'],
      rate_limits: { requests: 2, windowSeconds: 30 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'weather_api',
      label: 'Weather APIs',
      category: 'verified_structured',
      source_type: 'weather',
      capabilities: ['current_conditions'],
      verified_level: 'verified',
      freshness_window: 'minutes-to-hours',
      reliability_score: 0.86,
      cost_level: 'low',
      configured: configured('WEATHER_API_KEY'),
      allowed_use_cases: ['weather_risk', 'local_awareness', 'supply_chain'],
      rate_limits: { requests: 60, windowSeconds: 60 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'finance_api',
      label: 'Finance APIs',
      category: 'verified_structured',
      source_type: 'finance',
      capabilities: ['market_data'],
      verified_level: 'verified',
      freshness_window: 'seconds-to-hours',
      reliability_score: 0.88,
      cost_level: 'medium',
      configured: configured('FINANCE_API_KEY'),
      allowed_use_cases: ['finance_monitoring', 'market_research', 'income_generation'],
      rate_limits: { requests: 60, windowSeconds: 60 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'government_public_data',
      label: 'Government / Public Data',
      category: 'verified_structured',
      source_type: 'government_public_data',
      capabilities: ['official_records'],
      verified_level: 'verified',
      freshness_window: 'hours-to-months by dataset',
      reliability_score: 0.92,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['public_policy', 'local_awareness', 'market_research', 'contradiction_analysis'],
      rate_limits: null,
      failure_behavior: 'block_operational_truth',
    },
    {
      source_id: 'rss_feeds',
      label: 'RSS Feeds',
      category: 'verified_structured',
      source_type: 'rss',
      capabilities: ['feed_monitoring'],
      verified_level: 'semi_verified',
      freshness_window: 'minutes-to-days',
      reliability_score: 0.68,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['general_research', 'local_awareness', 'market_research'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
    {
      source_id: 'logistics_api',
      label: 'Logistics APIs',
      category: 'verified_structured',
      source_type: 'logistics',
      capabilities: ['route_status'],
      verified_level: 'verified',
      freshness_window: 'minutes-to-hours',
      reliability_score: 0.84,
      cost_level: 'medium',
      configured: configured('LOGISTICS_API_KEY'),
      allowed_use_cases: ['supply_chain', 'local_awareness'],
      rate_limits: { requests: 40, windowSeconds: 60 },
      failure_behavior: 'degrade',
    },
    {
      source_id: 'economic_indicators',
      label: 'Economic Indicators',
      category: 'verified_structured',
      source_type: 'economic_indicator',
      capabilities: ['macro_indicators', 'official_records'],
      verified_level: 'verified',
      freshness_window: 'days-to-months',
      reliability_score: 0.9,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['market_research', 'income_generation', 'public_policy', 'contradiction_analysis'],
      rate_limits: null,
      failure_behavior: 'degrade',
    },
    {
      source_id: 'podcasts',
      label: 'Podcasts',
      category: 'emerging_weak_signal',
      source_type: 'podcast',
      capabilities: ['longform_signal'],
      verified_level: 'unverified',
      freshness_window: 'hours-to-weeks',
      reliability_score: 0.42,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['weak_signal_detection', 'market_research'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
    {
      source_id: 'local_reporters',
      label: 'Small / Local Reporters',
      category: 'emerging_weak_signal',
      source_type: 'local_reporter',
      capabilities: ['local_reporting', 'weak_signal_detection'],
      verified_level: 'semi_verified',
      freshness_window: 'hours-to-days',
      reliability_score: 0.58,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['local_awareness', 'weak_signal_detection', 'contradiction_analysis'],
      rate_limits: null,
      failure_behavior: 'degrade',
    },
    {
      source_id: 'independent_blogs',
      label: 'Independent Blogs',
      category: 'emerging_weak_signal',
      source_type: 'independent_blog',
      capabilities: ['longform_signal', 'weak_signal_detection'],
      verified_level: 'unverified',
      freshness_window: 'days-to-weeks',
      reliability_score: 0.38,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['weak_signal_detection', 'market_research', 'contradiction_analysis'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
    {
      source_id: 'subreddit_discussions',
      label: 'Subreddit Discussions',
      category: 'emerging_weak_signal',
      source_type: 'subreddit',
      capabilities: ['community_discussion', 'social_velocity', 'rumor_detection'],
      verified_level: 'unverified',
      freshness_window: 'minutes-to-days',
      reliability_score: 0.32,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['weak_signal_detection', 'local_awareness', 'market_research'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
    {
      source_id: 'x_twitter_discussions',
      label: 'X / Twitter Discussions',
      category: 'emerging_weak_signal',
      source_type: 'x_twitter',
      capabilities: ['social_velocity', 'rumor_detection'],
      verified_level: 'unverified',
      freshness_window: 'seconds-to-days',
      reliability_score: 0.28,
      cost_level: 'medium',
      configured: configured('XAI_API_KEY'),
      allowed_use_cases: ['weak_signal_detection', 'local_awareness', 'market_research', 'contradiction_analysis'],
      rate_limits: { requests: 30, windowSeconds: 60 },
      failure_behavior: 'skip',
    },
    {
      source_id: 'niche_communities',
      label: 'Niche Communities',
      category: 'emerging_weak_signal',
      source_type: 'niche_community',
      capabilities: ['community_discussion', 'weak_signal_detection'],
      verified_level: 'unverified',
      freshness_window: 'hours-to-weeks',
      reliability_score: 0.3,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['weak_signal_detection', 'market_research'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
    {
      source_id: 'rumor_signal_feeds',
      label: 'Emerging Rumor / Signal Feeds',
      category: 'emerging_weak_signal',
      source_type: 'rumor_feed',
      capabilities: ['rumor_detection', 'weak_signal_detection'],
      verified_level: 'unverified',
      freshness_window: 'minutes-to-days',
      reliability_score: 0.2,
      cost_level: 'free',
      configured: false,
      allowed_use_cases: ['weak_signal_detection', 'contradiction_analysis'],
      rate_limits: null,
      failure_behavior: 'skip',
    },
  ]
}

export function getIntelligenceSource(sourceId: string): IntelligenceSourceDefinition | undefined {
  return getIntelligenceSourceRegistry().find(source => source.source_id === sourceId)
}

export function configuredIntelligenceSources(): IntelligenceSourceDefinition[] {
  return getIntelligenceSourceRegistry().filter(source => source.configured)
}
