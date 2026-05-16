import type { LocalityDepth } from '@/lib/intelligence/local/localSourceRegistry'
import type { PersistentSourceCategory, SourceNetworkTier } from '@/lib/intelligence/sources/sourceCategoryRegistry'
import { getSourceCategoryDefinition, type SourceRetrievalMode } from '@/lib/intelligence/sources/sourceCategoryRegistry'

export type PersistentSourceNode = {
  source_id: string
  label: string
  tier: SourceNetworkTier
  category: PersistentSourceCategory
  home_region?: string
  locality_depth: LocalityDepth
  reliability_score: number
  manipulation_risk: 'low' | 'medium' | 'high'
  retrieval_mode: SourceRetrievalMode
  configured: boolean
  search_aliases: string[]
  freshness_window_minutes: number
}

function node(args: Omit<PersistentSourceNode, 'reliability_score' | 'manipulation_risk' | 'retrieval_mode'> & Partial<Pick<PersistentSourceNode, 'reliability_score' | 'manipulation_risk' | 'retrieval_mode'>>): PersistentSourceNode {
  const category = getSourceCategoryDefinition(args.category)
  return {
    ...args,
    reliability_score: args.reliability_score ?? category.defaultReliability,
    manipulation_risk: args.manipulation_risk ?? category.defaultManipulationRisk,
    retrieval_mode: args.retrieval_mode ?? category.retrievalMode,
  }
}

export function getPersistentSourceNetwork(): PersistentSourceNode[] {
  const tavilyConfigured = Boolean(process.env.TAVILY_API_KEY?.trim())
  const xaiConfigured = Boolean(process.env.XAI_API_KEY?.trim())
  return [
    node({ source_id: 'akron_beacon_journal', label: 'Akron Beacon Journal', tier: 'local_regional', category: 'local_news', home_region: 'Akron, Ohio', locality_depth: 'city', configured: tavilyConfigured, search_aliases: ['Akron Beacon Journal', 'beaconjournal.com'], freshness_window_minutes: 1440 }),
    node({ source_id: 'signal_akron', label: 'Signal Akron', tier: 'local_regional', category: 'local_news', home_region: 'Akron, Ohio', locality_depth: 'city', configured: tavilyConfigured, search_aliases: ['Signal Akron', 'signalakron.org'], freshness_window_minutes: 1440 }),
    node({ source_id: 'cleveland19', label: 'Cleveland19', tier: 'local_regional', category: 'broadcast_news', home_region: 'Northeast Ohio', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['Cleveland 19 News', 'cleveland19.com'], freshness_window_minutes: 720 }),
    node({ source_id: 'wkyc', label: 'WKYC', tier: 'local_regional', category: 'broadcast_news', home_region: 'Northeast Ohio', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['WKYC', 'wkyc.com'], freshness_window_minutes: 720 }),
    node({ source_id: 'wews', label: 'WEWS News 5 Cleveland', tier: 'local_regional', category: 'broadcast_news', home_region: 'Northeast Ohio', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['WEWS News 5 Cleveland', 'news5cleveland.com'], freshness_window_minutes: 720 }),
    node({ source_id: 'fox8_cleveland', label: 'FOX8 Cleveland', tier: 'local_regional', category: 'broadcast_news', home_region: 'Northeast Ohio', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['FOX 8 Cleveland', 'fox8.com'], freshness_window_minutes: 720 }),
    node({ source_id: 'local_podcasts', label: 'Local podcasts', tier: 'local_regional', category: 'local_audio_video', home_region: 'local/regional', locality_depth: 'city', configured: tavilyConfigured, search_aliases: ['local podcast', 'OHCHIPSX'], freshness_window_minutes: 10080 }),
    node({ source_id: 'local_radio_news', label: 'Local radio/news', tier: 'local_regional', category: 'local_audio_video', home_region: 'local/regional', locality_depth: 'city', configured: tavilyConfigured, search_aliases: ['local radio news'], freshness_window_minutes: 1440 }),
    node({ source_id: 'local_public_alerts', label: 'Local public alerts', tier: 'local_regional', category: 'public_alerts', home_region: 'local/regional', locality_depth: 'city', configured: false, search_aliases: ['city alerts', 'county alerts', 'public alerts'], freshness_window_minutes: 120 }),
    node({ source_id: 'local_community_feeds', label: 'Local community feeds', tier: 'weak_signal_emerging', category: 'community_discussion', home_region: 'local/regional', locality_depth: 'neighborhood', configured: false, search_aliases: ['community discussion', 'local chatter'], freshness_window_minutes: 360 }),

    node({ source_id: 'ap', label: 'Associated Press', tier: 'state_national', category: 'wire_service', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Associated Press', 'AP News'], freshness_window_minutes: 720 }),
    node({ source_id: 'reuters', label: 'Reuters', tier: 'state_national', category: 'wire_service', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Reuters'], freshness_window_minutes: 720 }),
    node({ source_id: 'pbs', label: 'PBS', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['PBS NewsHour'], freshness_window_minutes: 1440 }),
    node({ source_id: 'npr', label: 'NPR', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['NPR'], freshness_window_minutes: 1440 }),
    node({ source_id: 'cnn', label: 'CNN', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['CNN'], freshness_window_minutes: 720 }),
    node({ source_id: 'fox_news', label: 'Fox News', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Fox News'], freshness_window_minutes: 720 }),
    node({ source_id: 'nbc', label: 'NBC', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['NBC News'], freshness_window_minutes: 720 }),
    node({ source_id: 'abc', label: 'ABC', tier: 'state_national', category: 'national_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['ABC News'], freshness_window_minutes: 720 }),
    node({ source_id: 'bloomberg', label: 'Bloomberg', tier: 'state_national', category: 'business_finance', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Bloomberg'], freshness_window_minutes: 720 }),
    node({ source_id: 'wsj', label: 'Wall Street Journal', tier: 'state_national', category: 'business_finance', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Wall Street Journal', 'WSJ'], freshness_window_minutes: 1440 }),
    node({ source_id: 'politico', label: 'Politico', tier: 'state_national', category: 'politics_policy', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Politico'], freshness_window_minutes: 1440 }),

    node({ source_id: 'reuters_world', label: 'Reuters World', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Reuters World'], freshness_window_minutes: 720 }),
    node({ source_id: 'al_jazeera', label: 'Al Jazeera', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Al Jazeera'], freshness_window_minutes: 720 }),
    node({ source_id: 'rt', label: 'RT', tier: 'international', category: 'state_media_or_perspective', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['RT'], freshness_window_minutes: 1440 }),
    node({ source_id: 'bbc', label: 'BBC', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['BBC'], freshness_window_minutes: 720 }),
    node({ source_id: 'dw', label: 'DW', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['Deutsche Welle', 'DW News'], freshness_window_minutes: 1440 }),
    node({ source_id: 'france24', label: 'France 24', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['France 24'], freshness_window_minutes: 1440 }),
    node({ source_id: 'nhk', label: 'NHK', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['NHK World'], freshness_window_minutes: 1440 }),
    node({ source_id: 'scmp', label: 'SCMP', tier: 'international', category: 'international_news', locality_depth: 'none', configured: tavilyConfigured, search_aliases: ['South China Morning Post', 'SCMP'], freshness_window_minutes: 1440 }),

    node({ source_id: 'podcasts_weak_signal', label: 'Podcasts', tier: 'weak_signal_emerging', category: 'weak_signal', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['podcast discussion'], freshness_window_minutes: 10080 }),
    node({ source_id: 'independent_reporters', label: 'Independent reporters', tier: 'weak_signal_emerging', category: 'weak_signal', locality_depth: 'city', configured: tavilyConfigured, search_aliases: ['independent reporter'], freshness_window_minutes: 2880 }),
    node({ source_id: 'reddit_discussions', label: 'Reddit discussions', tier: 'weak_signal_emerging', category: 'community_discussion', locality_depth: 'city', configured: false, search_aliases: ['Reddit discussion'], freshness_window_minutes: 720 }),
    node({ source_id: 'x_twitter_discussions', label: 'X / Twitter discussions', tier: 'weak_signal_emerging', category: 'community_discussion', locality_depth: 'city', configured: xaiConfigured, search_aliases: ['X Twitter discussion'], freshness_window_minutes: 180 }),
    node({ source_id: 'regional_youtube_commentary', label: 'Regional YouTube/news commentary', tier: 'weak_signal_emerging', category: 'weak_signal', locality_depth: 'regional', configured: tavilyConfigured, search_aliases: ['regional YouTube commentary'], freshness_window_minutes: 10080 }),
  ]
}

export function getPersistentSource(sourceId: string): PersistentSourceNode | undefined {
  return getPersistentSourceNetwork().find(source => source.source_id === sourceId)
}
