export type LocalSourceCategory = 'verified_structured' | 'emerging_hyperlocal'

export type LocalSourceType =
  | 'local_newspaper'
  | 'city_county_alert'
  | 'public_safety_feed'
  | 'dot_traffic_feed'
  | 'municipal_notice'
  | 'local_government_release'
  | 'local_podcast'
  | 'independent_local_reporter'
  | 'community_blog'
  | 'regional_youtube'
  | 'local_subreddit'
  | 'local_x_twitter'
  | 'local_discussion_community'
  | 'public_scanner_discussion'
  | 'niche_regional_page'

export type LocalityDepth = 'none' | 'regional' | 'city' | 'neighborhood' | 'street_or_venue'
export type LocalFreshness = 'live' | 'recent' | 'aging' | 'stale' | 'unknown'
export type LocalManipulationRisk = 'low' | 'medium' | 'high'

export type LocalSourceDefinition = {
  source_id: string
  label: string
  source_type: LocalSourceType
  category: LocalSourceCategory
  reliability_score: number
  locality_depth: LocalityDepth
  freshness: LocalFreshness
  confidence_history: number[]
  corroboration_count: number
  manipulation_risk: LocalManipulationRisk
  signal_velocity: number
  configured: boolean
  notes: string
}

export function getLocalSourceRegistry(): LocalSourceDefinition[] {
  return [
    {
      source_id: 'local_newspapers',
      label: 'Local newspapers',
      source_type: 'local_newspaper',
      category: 'verified_structured',
      reliability_score: 0.82,
      locality_depth: 'city',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.25,
      configured: false,
      notes: 'Configured adapters may include city papers, regional outlets, or source-specific RSS feeds.',
    },
    {
      source_id: 'city_county_alerts',
      label: 'City / county alerts',
      source_type: 'city_county_alert',
      category: 'verified_structured',
      reliability_score: 0.9,
      locality_depth: 'city',
      freshness: 'live',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.65,
      configured: false,
      notes: 'Official alert source placeholder; not fetched unless an adapter is configured.',
    },
    {
      source_id: 'public_safety_feeds',
      label: 'Public safety feeds',
      source_type: 'public_safety_feed',
      category: 'verified_structured',
      reliability_score: 0.86,
      locality_depth: 'city',
      freshness: 'live',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.7,
      configured: false,
      notes: 'Public-only feed slot; never infer live incidents without returned evidence.',
    },
    {
      source_id: 'dot_traffic_feeds',
      label: 'DOT / traffic feeds',
      source_type: 'dot_traffic_feed',
      category: 'verified_structured',
      reliability_score: 0.84,
      locality_depth: 'street_or_venue',
      freshness: 'live',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.72,
      configured: false,
      notes: 'Traffic and road condition adapter placeholder.',
    },
    {
      source_id: 'municipal_notices',
      label: 'Municipal notices',
      source_type: 'municipal_notice',
      category: 'verified_structured',
      reliability_score: 0.88,
      locality_depth: 'city',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.28,
      configured: false,
      notes: 'Council, permit, closure, and service notice adapter placeholder.',
    },
    {
      source_id: 'local_government_releases',
      label: 'Local government releases',
      source_type: 'local_government_release',
      category: 'verified_structured',
      reliability_score: 0.9,
      locality_depth: 'city',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'low',
      signal_velocity: 0.3,
      configured: false,
      notes: 'Official local government source placeholder.',
    },
    {
      source_id: 'local_podcasts',
      label: 'Local podcasts',
      source_type: 'local_podcast',
      category: 'emerging_hyperlocal',
      reliability_score: 0.38,
      locality_depth: 'city',
      freshness: 'aging',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'medium',
      signal_velocity: 0.4,
      configured: false,
      notes: 'OHCHIPSX-style local podcast/community signal slot; classified as weak until corroborated.',
    },
    {
      source_id: 'independent_local_reporters',
      label: 'Independent local reporters',
      source_type: 'independent_local_reporter',
      category: 'emerging_hyperlocal',
      reliability_score: 0.56,
      locality_depth: 'neighborhood',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'medium',
      signal_velocity: 0.52,
      configured: false,
      notes: 'Useful for early local signals; not operational truth without corroboration.',
    },
    {
      source_id: 'community_blogs',
      label: 'Community blogs',
      source_type: 'community_blog',
      category: 'emerging_hyperlocal',
      reliability_score: 0.36,
      locality_depth: 'neighborhood',
      freshness: 'aging',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'medium',
      signal_velocity: 0.32,
      configured: false,
      notes: 'Neighborhood narrative source slot.',
    },
    {
      source_id: 'regional_youtube_channels',
      label: 'Regional YouTube channels',
      source_type: 'regional_youtube',
      category: 'emerging_hyperlocal',
      reliability_score: 0.3,
      locality_depth: 'regional',
      freshness: 'aging',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'high',
      signal_velocity: 0.45,
      configured: false,
      notes: 'Narrative source slot with elevated manipulation/inflation risk.',
    },
    {
      source_id: 'local_subreddit_discussions',
      label: 'Local subreddit discussions',
      source_type: 'local_subreddit',
      category: 'emerging_hyperlocal',
      reliability_score: 0.28,
      locality_depth: 'city',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'high',
      signal_velocity: 0.62,
      configured: false,
      notes: 'Community chatter source slot; classify as local chatter or weak signal.',
    },
    {
      source_id: 'local_x_twitter_chatter',
      label: 'Local X / Twitter chatter',
      source_type: 'local_x_twitter',
      category: 'emerging_hyperlocal',
      reliability_score: 0.24,
      locality_depth: 'neighborhood',
      freshness: 'live',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'high',
      signal_velocity: 0.78,
      configured: Boolean(process.env.XAI_API_KEY?.trim()),
      notes: 'Fast local chatter/radar framing; not proof of live incidents.',
    },
    {
      source_id: 'local_discussion_communities',
      label: 'Local discussion communities',
      source_type: 'local_discussion_community',
      category: 'emerging_hyperlocal',
      reliability_score: 0.26,
      locality_depth: 'neighborhood',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'high',
      signal_velocity: 0.58,
      configured: false,
      notes: 'Facebook/Nextdoor-style community discussion placeholder; no private access.',
    },
    {
      source_id: 'public_scanner_style_discussion',
      label: 'Public scanner-style discussion',
      source_type: 'public_scanner_discussion',
      category: 'emerging_hyperlocal',
      reliability_score: 0.22,
      locality_depth: 'street_or_venue',
      freshness: 'live',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'high',
      signal_velocity: 0.82,
      configured: false,
      notes: 'Legally accessible public discussion only; never treated as verified incident evidence alone.',
    },
    {
      source_id: 'niche_regional_pages',
      label: 'Niche regional pages',
      source_type: 'niche_regional_page',
      category: 'emerging_hyperlocal',
      reliability_score: 0.3,
      locality_depth: 'regional',
      freshness: 'recent',
      confidence_history: [],
      corroboration_count: 0,
      manipulation_risk: 'medium',
      signal_velocity: 0.5,
      configured: false,
      notes: 'Regional pages and niche local interest sources.',
    },
  ]
}

export function getLocalSource(sourceId: string): LocalSourceDefinition | undefined {
  return getLocalSourceRegistry().find(source => source.source_id === sourceId)
}
