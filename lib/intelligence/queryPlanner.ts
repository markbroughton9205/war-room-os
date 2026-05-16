import {
  getIntelligenceSourceRegistry,
  type IntelligenceSourceDefinition,
  type IntelligenceUseCase,
} from '@/lib/intelligence/sourceRegistry'

export type IntelligenceSourcePlan = {
  source_id: string
  priority: number
  required: boolean
  purpose: string
  use_cases: IntelligenceUseCase[]
  query_hint: string
  configured: boolean
}

export type IntelligenceQueryPlan = {
  decree: string
  normalized_query: string
  intent_tags: string[]
  use_cases: IntelligenceUseCase[]
  source_plans: IntelligenceSourcePlan[]
  weak_signal_sources: string[]
  verification_sources: string[]
  notes: string[]
}

const SOURCE_PURPOSE: Record<string, string> = {
  tavily: 'Broad current web evidence and mainstream reporting discovery.',
  firecrawl: 'Page extraction and candidate result verification when a real URL is available.',
  weather_api: 'Current weather / environmental conditions.',
  finance_api: 'Market prices, earnings, securities, and finance data.',
  government_public_data: 'Official records, public datasets, and agency-grounded verification.',
  rss_feeds: 'Publisher feed monitoring and local headline discovery.',
  logistics_api: 'Supply chain, shipping, route, and logistics conditions.',
  economic_indicators: 'Macro, employment, inflation, and regional economic data.',
  podcasts: 'Longform emerging narrative and expert chatter.',
  local_reporters: 'Local, small outlet, and community-grounded reporting.',
  independent_blogs: 'Early niche commentary and non-mainstream opportunity/risk signals.',
  subreddit_discussions: 'Community discussion and rumor surface scanning.',
  x_twitter_discussions: 'Realtime social velocity and fast-moving signal framing.',
  niche_communities: 'Specialized community chatter before mainstream pickup.',
  rumor_signal_feeds: 'Explicit rumor detection; never operational truth without corroboration.',
}

function cleanDecree(decree: string): string {
  return decree.replace(/\s+/g, ' ').trim().slice(0, 600)
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text)
}

function pushUnique<T>(target: T[], values: T[]) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
  }
}

function resolveUseCasesForDecree(decree: string): { useCases: IntelligenceUseCase[]; tags: string[] } {
  const text = decree.toLowerCase()
  const useCases: IntelligenceUseCase[] = ['general_research']
  const tags: string[] = []

  if (has(text, /\b(income|money|revenue|side\s*hustle|paid|business|opportunit|generate\s+income)\b/i)) {
    pushUnique(useCases, ['income_generation', 'market_research', 'weak_signal_detection'])
    tags.push('income_opportunity')
  }
  if (has(text, /\b(akron|local|near\s+me|city|county|neighborhood|what'?s\s+happening)\b/i)) {
    pushUnique(useCases, ['local_awareness', 'weather_risk', 'weak_signal_detection'])
    tags.push('local_awareness')
  }
  if (has(text, /\b(water|drought|reservoir|weather|storm|heat|flood|climate|environment)\b/i)) {
    pushUnique(useCases, ['weather_risk', 'public_policy', 'contradiction_analysis'])
    tags.push('environmental_risk')
  }
  if (has(text, /\b(stock|market|earnings|crypto|rate|inflation|economic|jobs|unemployment)\b/i)) {
    pushUnique(useCases, ['finance_monitoring', 'market_research', 'contradiction_analysis'])
    tags.push('finance_economy')
  }
  if (has(text, /\b(government|public\s+data|policy|law|regulation|agency|official|texas)\b/i)) {
    pushUnique(useCases, ['public_policy', 'contradiction_analysis'])
    tags.push('official_verification')
  }
  if (has(text, /\b(reddit|twitter|x\.com|social|rumor|chatter|trend|signal|emerging)\b/i)) {
    pushUnique(useCases, ['weak_signal_detection', 'contradiction_analysis'])
    tags.push('weak_signal_requested')
  }
  if (has(text, /\b(verify|fact[-\s]?check|contradiction|is\s+it\s+true|running\s+out)\b/i)) {
    pushUnique(useCases, ['contradiction_analysis'])
    tags.push('verification_required')
  }

  return { useCases, tags: tags.length ? tags : ['general_research'] }
}

function sourceMatchesUseCases(source: IntelligenceSourceDefinition, useCases: IntelligenceUseCase[]): boolean {
  return source.allowed_use_cases.some(useCase => useCases.includes(useCase))
}

function priorityForSource(source: IntelligenceSourceDefinition, useCases: IntelligenceUseCase[], tags: string[]): number {
  let score = source.reliability_score
  if (source.configured) score += 0.25
  if (source.category === 'verified_structured') score += 0.15
  if (source.allowed_use_cases.some(useCase => useCases.includes(useCase))) score += 0.2
  if (tags.includes('income_opportunity') && ['tavily', 'economic_indicators', 'x_twitter_discussions', 'subreddit_discussions'].includes(source.source_id)) score += 0.2
  if (tags.includes('local_awareness') && ['local_reporters', 'rss_feeds', 'weather_api', 'x_twitter_discussions'].includes(source.source_id)) score += 0.2
  if (tags.includes('environmental_risk') && ['government_public_data', 'weather_api', 'tavily', 'local_reporters'].includes(source.source_id)) score += 0.25
  if (tags.includes('verification_required') && source.category === 'verified_structured') score += 0.15
  if (source.category === 'emerging_weak_signal' && useCases.includes('weak_signal_detection')) score += 0.12
  return Math.round(score * 100)
}

export function planIntelligenceQuery(decree: string): IntelligenceQueryPlan {
  const normalized = cleanDecree(decree)
  const { useCases, tags } = resolveUseCasesForDecree(normalized)
  const sources = getIntelligenceSourceRegistry()
    .filter(source => sourceMatchesUseCases(source, useCases))
    .map(source => ({
      source,
      priority: priorityForSource(source, useCases, tags),
    }))
    .sort((a, b) => b.priority - a.priority)

  const sourcePlans = sources.map(({ source, priority }) => ({
    source_id: source.source_id,
    priority,
    required:
      source.category === 'verified_structured'
      && (source.source_id === 'tavily' || source.verified_level === 'verified')
      && !useCases.every(useCase => useCase === 'weak_signal_detection'),
    purpose: SOURCE_PURPOSE[source.source_id] ?? 'Source-specific intelligence gathering.',
    use_cases: source.allowed_use_cases.filter(useCase => useCases.includes(useCase)),
    query_hint: normalized,
    configured: source.configured,
  }))

  const weakSignalSources = sourcePlans
    .filter(plan => getIntelligenceSourceRegistry().find(source => source.source_id === plan.source_id)?.category === 'emerging_weak_signal')
    .map(plan => plan.source_id)

  const verificationSources = sourcePlans
    .filter(plan => getIntelligenceSourceRegistry().find(source => source.source_id === plan.source_id)?.category === 'verified_structured')
    .map(plan => plan.source_id)

  const notes = [
    'Families receive the same intelligence packet; role-specific routing changes only analysis framing.',
    'Weak signals are allowed into the packet but cannot become operational truth without corroboration.',
  ]
  if (!sourcePlans.some(plan => plan.configured)) {
    notes.push('No configured live source from this plan is currently available; packet construction will expose gaps.')
  }

  return {
    decree: normalized,
    normalized_query: normalized,
    intent_tags: tags,
    use_cases: useCases,
    source_plans: sourcePlans,
    weak_signal_sources: weakSignalSources,
    verification_sources: verificationSources,
    notes,
  }
}
