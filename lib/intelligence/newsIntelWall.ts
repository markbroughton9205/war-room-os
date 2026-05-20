import type { NewsDashboardCard } from '@/lib/intelligence/environment/liveEnvironmentTypes'
import { classifyIntelligenceCategory } from '@/lib/signals/classification/categories'
import type { IntelligenceCategory } from '@/lib/signals/classification/types'
import { detectContradictionGroups } from '@/lib/signals/contradictions'
import type { ClassificationInput } from '@/lib/signals/classification/types'
import type {
  SignalFreshnessStatus,
  SignalOperationalStatus,
  SignalProviderId,
  SignalResult,
  SignalSourceStatus,
} from '@/lib/signals/model'

export const NEWS_INTEL_WATCH_SECTIONS = [
  'top_stories',
  'usa_watch',
  'world_watch',
  'economy_watch',
  'geopolitics_war',
  'ai_tech_watch',
  'akron_watch',
  'freight_logistics',
  'contradictions',
  'actionable_signals',
] as const

export type NewsIntelWatchSection = (typeof NEWS_INTEL_WATCH_SECTIONS)[number]

export const NEWS_INTEL_SECTION_LABELS: Record<NewsIntelWatchSection, string> = {
  top_stories: 'Top Stories',
  usa_watch: 'USA Watch',
  world_watch: 'World Watch',
  economy_watch: 'Economy Watch',
  geopolitics_war: 'Geopolitics / War Watch',
  ai_tech_watch: 'AI / Tech Watch',
  akron_watch: 'Local Akron Watch',
  freight_logistics: 'Freight / Logistics Watch',
  contradictions: 'Contradictions',
  actionable_signals: 'Actionable Signals',
}

export type NewsIntelSourceMixKey =
  | 'rss'
  | 'guardian'
  | 'newsapi'
  | 'tavily'
  | 'cache'
  | 'manual'
  | 'brave'
  | 'firecrawl'
  | 'other'

export type NewsIntelStory = {
  id: string
  headline: string
  source: string
  publishedAt: string | null
  ingestedAt: string
  freshnessStatus: SignalFreshnessStatus
  sourceStatus: SignalSourceStatus
  operationalStatus: SignalOperationalStatus
  confidence: number
  category: string
  intelligenceCategory: IntelligenceCategory | 'uncategorized'
  shortSummary: string
  whyItMatters: string
  affectedMissions: string[]
  url: string | null
  primarySection: NewsIntelWatchSection
  provider: NewsIntelSourceMixKey
  leverageScore: number
  contradictionGroupId: string | null
  contradictionPeerIds: string[]
  displayLabel: string
  localScope: 'local' | 'global' | 'mixed'
}

export type NewsIntelContradictionGroup = {
  id: string
  storyIds: string[]
  headlineHint: string
}

export type NewsIntelSourceMixCounts = Record<NewsIntelSourceMixKey, number>

export type NewsIntelWallPayload = {
  stories: NewsIntelStory[]
  sections: Record<NewsIntelWatchSection, NewsIntelStory[]>
  contradictionGroups: NewsIntelContradictionGroup[]
  sourceMix: NewsIntelSourceMixCounts
  hasLiveSourceBackedIntel: boolean
  loadedAt: string
  diagnostics: string[]
}

export type NewsIntelWallFilters = {
  liveOnly: boolean
  recentOnly: boolean
  source: NewsIntelSourceMixKey | 'all'
  category: IntelligenceCategory | 'all'
  minConfidence: number
  missionImpactOnly: boolean
  localGlobal: 'all' | 'local' | 'global'
}

const MISSION_LABELS: Record<string, string> = {
  'phase-0-cashflow-base': 'Phase 0 Cashflow Base',
  'content-automation': 'Content Automation',
  'automation-services': 'Automation Services',
  'real-estate-monitor': 'Real Estate Monitor',
  'debt-freedom-trigger': 'Debt Freedom Trigger',
}

function providerToMix(provider: string | undefined): NewsIntelSourceMixKey {
  switch (provider) {
    case 'rss':
      return 'rss'
    case 'guardian':
      return 'guardian'
    case 'newsapi':
      return 'newsapi'
    case 'tavily':
      return 'tavily'
    case 'cached':
    case 'historical':
      return 'cache'
    case 'manual_registry':
      return 'manual'
    case 'brave':
      return 'brave'
    case 'firecrawl':
      return 'firecrawl'
    default:
      return 'other'
  }
}

function inferMissions(text: string, category: IntelligenceCategory): string[] {
  const missions: string[] = []
  const lower = text.toLowerCase()
  if (/akron|summit county|ohio|local/.test(lower) || category === 'local_economy') {
    missions.push(MISSION_LABELS['real-estate-monitor']!)
  }
  if (/debt|layoff|warning|risk|operational_risk|emergency/.test(lower) || category === 'operational_risk') {
    missions.push(MISSION_LABELS['debt-freedom-trigger']!)
  }
  if (/automation|smb|customer|business_opportunity/.test(lower) || category === 'business_opportunity') {
    missions.push(MISSION_LABELS['automation-services']!)
  }
  if (/content|media|creator/.test(lower)) {
    missions.push(MISSION_LABELS['content-automation']!)
  }
  if (/freight|logistics|truck|load board|sprinter/.test(lower)) {
    missions.push(MISSION_LABELS['phase-0-cashflow-base']!)
  }
  if (!missions.length) missions.push(MISSION_LABELS['phase-0-cashflow-base']!)
  return [...new Set(missions)]
}

function whyItMattersFor(category: IntelligenceCategory, operationalStatus: SignalOperationalStatus): string {
  if (operationalStatus === 'EXCLUDED') {
    return 'Held for awareness only — excluded from automatic action paths until Commander review.'
  }
  switch (category) {
    case 'emergency':
      return 'May affect immediate safety, family timing, or operational continuity.'
    case 'geopolitics':
      return 'Geopolitical shifts can change supply chains, markets, and regional risk posture.'
    case 'markets':
      return 'Market context informs timing for income moves without implying trading advice.'
    case 'local_economy':
      return 'Local economic signals are closest to executable Akron/Summit opportunities.'
    case 'business_opportunity':
      return 'Potential revenue or automation angle — requires verification before pursuit.'
    case 'operational_risk':
      return 'Risk signal — validate before committing resources or family plans.'
    case 'infrastructure':
      return 'Infrastructure and logistics movement can affect freight, travel, and delivery timing.'
    case 'AI_industry':
      return 'AI/tech shifts may affect tooling, automation bets, and competitive positioning.'
    default:
      return 'Source-backed context for Council review — no autonomous execution.'
  }
}

function localScopeFor(
  category: IntelligenceCategory,
  text: string,
  newsCategory?: string,
): 'local' | 'global' | 'mixed' {
  if (/akron|summit county|northeast ohio/i.test(text) || newsCategory === 'local' || newsCategory === 'regional') {
    return 'local'
  }
  if (category === 'local_economy') return 'local'
  if (newsCategory === 'international' || category === 'geopolitics') return 'global'
  return 'mixed'
}

function sectionForStory(
  story: Pick<NewsIntelStory, 'intelligenceCategory' | 'headline' | 'shortSummary' | 'operationalStatus' | 'localScope' | 'category'>,
): NewsIntelWatchSection {
  const text = `${story.headline} ${story.shortSummary} ${story.category}`
  if (story.operationalStatus === 'ACTIONABLE') return 'actionable_signals'
  if (/akron|summit county/i.test(text) || story.localScope === 'local') return 'akron_watch'
  if (/freight|logistics|truck|load board|sprinter|port|rail\b/i.test(text) || story.category.includes('freight')) {
    return 'freight_logistics'
  }
  switch (story.intelligenceCategory) {
    case 'geopolitics':
    case 'emergency':
      return 'geopolitics_war'
    case 'markets':
      return 'economy_watch'
    case 'AI_industry':
      return 'ai_tech_watch'
    case 'local_economy':
      return 'akron_watch'
    case 'infrastructure':
      return 'freight_logistics'
    default:
      break
  }
  if (story.localScope === 'global' || story.category === 'international') return 'world_watch'
  if (story.category === 'national' || story.localScope === 'mixed') return 'usa_watch'
  return 'top_stories'
}

function storyFromNewsCard(card: NewsDashboardCard): NewsIntelStory | null {
  if (!card.title.trim()) return null
  const text = `${card.title} ${card.detail}`
  const { category: intelligenceCategory, confidence: categoryConfidence } = classifyIntelligenceCategory(text, card.category)
  const confidence = Math.round(
    (categoryConfidence + (card.confidenceLabel === 'verified' ? 78 : card.confidenceLabel === 'emerging' ? 55 : 48)) / 2,
  )
  const affectedMissions = inferMissions(text, intelligenceCategory)
  const localScope = localScopeFor(intelligenceCategory, text, card.category)
  const base: NewsIntelStory = {
    id: `news-${card.id}`,
    headline: card.title,
    source: card.sourceName,
    publishedAt: card.articlePublishedAt ?? card.publishedAt,
    ingestedAt: card.signalIngestedAt,
    freshnessStatus: card.freshnessStatus,
    sourceStatus: card.sourceStatus,
    operationalStatus: card.operationalStatus,
    confidence,
    category: card.category,
    intelligenceCategory,
    shortSummary: card.detail || card.title,
    whyItMatters: whyItMattersFor(intelligenceCategory, card.operationalStatus),
    affectedMissions,
    url: card.url,
    primarySection: 'top_stories',
    provider: providerToMix(card.provider),
    leverageScore: confidence,
    contradictionGroupId: null,
    contradictionPeerIds: [],
    displayLabel: card.displayLabel,
    localScope,
  }
  return { ...base, primarySection: sectionForStory(base) }
}

function storyFromSignal(signal: SignalResult): NewsIntelStory | null {
  if (!signal.guardrails.sourceBacked || !signal.title.trim()) return null
  const rawHeadline = typeof signal.metadata.rawHeadline === 'string' ? signal.metadata.rawHeadline : signal.title
  const rawSummary = typeof signal.metadata.rawSummary === 'string' ? signal.metadata.rawSummary : signal.summary
  const text = `${rawHeadline} ${rawSummary} ${signal.category}`
  const intelligenceCategory =
    typeof signal.metadata.intelligenceCategory === 'string'
      ? (signal.metadata.intelligenceCategory as IntelligenceCategory)
      : classifyIntelligenceCategory(text, signal.category).category
  const freshnessStatus = (signal.metadata.freshnessStatus as SignalFreshnessStatus | undefined) ?? 'UNKNOWN_DATE'
  const sourceStatus = (signal.metadata.sourceStatus as SignalSourceStatus | undefined) ?? 'UNKNOWN'
  const operationalStatus = (signal.metadata.operationalStatus as SignalOperationalStatus | undefined) ?? 'CONTEXT_ONLY'
  const publishedAt =
    typeof signal.metadata.articlePublishedAt === 'string'
      ? signal.metadata.articlePublishedAt
      : typeof signal.metadata.publishedAt === 'string'
        ? signal.metadata.publishedAt
        : null
  const ingestedAt =
    typeof signal.metadata.signalIngestedAt === 'string'
      ? signal.metadata.signalIngestedAt
      : signal.capturedAt
  const confidence = Math.round(
    typeof signal.metadata.classificationConfidence === 'number'
      ? signal.metadata.classificationConfidence
      : signal.scores.confidence,
  )
  const displayLabel =
    typeof signal.metadata.displayLabel === 'string'
      ? signal.metadata.displayLabel
      : signal.approvalStatus.replace(/_/g, ' ')
  const localScope = localScopeFor(intelligenceCategory, text)
  const base: NewsIntelStory = {
    id: `signal-${signal.id}`,
    headline: rawHeadline,
    source: signal.source,
    publishedAt,
    ingestedAt,
    freshnessStatus,
    sourceStatus,
    operationalStatus,
    confidence,
    category: signal.category.replace(/_/g, ' '),
    intelligenceCategory,
    shortSummary: rawSummary,
    whyItMatters: whyItMattersFor(intelligenceCategory, operationalStatus),
    affectedMissions: inferMissions(text, intelligenceCategory),
    url: signal.url.startsWith('https://') ? signal.url : null,
    primarySection: 'top_stories',
    provider: providerToMix(signal.provider),
    leverageScore: Math.round(signal.scores.highestLeverage),
    contradictionGroupId:
      typeof signal.metadata.contradictionGroupId === 'string' ? signal.metadata.contradictionGroupId : null,
    contradictionPeerIds: Array.isArray(signal.metadata.contradictionPeerIds)
      ? signal.metadata.contradictionPeerIds.filter((id): id is string => typeof id === 'string')
      : [],
    displayLabel,
    localScope,
  }
  return { ...base, primarySection: sectionForStory(base) }
}

function dedupeStories(stories: NewsIntelStory[]): NewsIntelStory[] {
  const seen = new Set<string>()
  const out: NewsIntelStory[] = []
  for (const story of stories.sort((a, b) => b.leverageScore - a.leverageScore)) {
    const key = (story.url ?? story.headline).toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(story)
  }
  return out
}

function applyContradictions(stories: NewsIntelStory[]): NewsIntelStory[] {
  const inputs: ClassificationInput[] = stories.map(story => ({
    id: story.id,
    title: story.headline,
    summary: story.shortSummary,
    source: story.source,
    provider: story.provider as SignalProviderId,
    url: story.url ?? '',
    category: 'AI_trends',
    scores: {
      relevance: story.confidence,
      incomePotential: 0,
      urgency: 0,
      confidence: story.confidence,
      startupCost: 0,
      timeToProfit: 0,
      repeatability: 0,
      strategicAlignment: 0,
      familyImpact: 0,
      highestLeverage: story.leverageScore,
    },
    metadata: {
      articlePublishedAt: story.publishedAt,
      publishedAt: story.publishedAt,
    },
    approvalStatus: 'pending_review',
  }))

  const groups = detectContradictionGroups(inputs)
  const peerMap = new Map<string, { groupId: string; peers: string[] }>()
  for (const [groupId, ids] of groups.entries()) {
    for (const id of ids) {
      peerMap.set(id, { groupId, peers: ids.filter(peer => peer !== id) })
    }
  }

  return stories.map(story => {
    const hit = peerMap.get(story.id)
    if (!hit) return story
    return {
      ...story,
      contradictionGroupId: hit.groupId,
      contradictionPeerIds: hit.peers,
      primarySection: 'contradictions',
    }
  })
}

function buildSections(stories: NewsIntelStory[]): Record<NewsIntelWatchSection, NewsIntelStory[]> {
  const sections = Object.fromEntries(
    NEWS_INTEL_WATCH_SECTIONS.map(section => [section, [] as NewsIntelStory[]]),
  ) as Record<NewsIntelWatchSection, NewsIntelStory[]>

  const topCandidates = [...stories]
    .filter(s => s.url && s.operationalStatus !== 'EXCLUDED')
    .sort((a, b) => b.leverageScore - a.leverageScore)
    .slice(0, 12)
  sections.top_stories = topCandidates

  for (const story of stories) {
    if (story.contradictionGroupId) {
      sections.contradictions.push(story)
    }
    const target = story.primarySection
    if (target !== 'top_stories' && target !== 'contradictions') {
      sections[target].push(story)
    }
    if (story.operationalStatus === 'ACTIONABLE' && !sections.actionable_signals.some(s => s.id === story.id)) {
      sections.actionable_signals.push(story)
    }
  }

  for (const section of NEWS_INTEL_WATCH_SECTIONS) {
    sections[section] = sections[section].sort((a, b) => b.leverageScore - a.leverageScore)
  }

  return sections
}

function buildSourceMix(stories: NewsIntelStory[]): NewsIntelSourceMixCounts {
  const mix: NewsIntelSourceMixCounts = {
    rss: 0,
    guardian: 0,
    newsapi: 0,
    tavily: 0,
    cache: 0,
    manual: 0,
    brave: 0,
    firecrawl: 0,
    other: 0,
  }
  for (const story of stories) {
    mix[story.provider] += 1
  }
  return mix
}

export function buildNewsIntelWall(input: {
  newsCards: NewsDashboardCard[]
  signals: SignalResult[]
}): NewsIntelWallPayload {
  const diagnostics: string[] = []
  const fromCards = input.newsCards.map(storyFromNewsCard).filter((s): s is NewsIntelStory => Boolean(s))
  const fromSignals = input.signals.map(storyFromSignal).filter((s): s is NewsIntelStory => Boolean(s))
  if (!fromCards.length && input.newsCards.length) diagnostics.push('News cards present but none passed source-backed filters.')
  if (!fromSignals.length && input.signals.length) diagnostics.push('Signal results present but none passed source-backed filters.')

  const merged = applyContradictions(dedupeStories([...fromCards, ...fromSignals]))
  const hasLiveSourceBackedIntel = merged.some(
    story => Boolean(story.url) && (story.freshnessStatus === 'LIVE' || story.freshnessStatus === 'RECENT'),
  )

  const contradictionGroups: NewsIntelContradictionGroup[] = []
  const groupIds = new Set<string>()
  for (const story of merged) {
    if (!story.contradictionGroupId || groupIds.has(story.contradictionGroupId)) continue
    groupIds.add(story.contradictionGroupId)
    const peers = merged.filter(s => s.contradictionGroupId === story.contradictionGroupId)
    contradictionGroups.push({
      id: story.contradictionGroupId,
      storyIds: peers.map(s => s.id),
      headlineHint: peers[0]?.headline ?? 'Conflicting narratives',
    })
  }

  return {
    stories: merged,
    sections: buildSections(merged),
    contradictionGroups,
    sourceMix: buildSourceMix(merged),
    hasLiveSourceBackedIntel,
    loadedAt: new Date().toISOString(),
    diagnostics,
  }
}

export function filterNewsIntelStories(stories: NewsIntelStory[], filters: NewsIntelWallFilters): NewsIntelStory[] {
  return stories.filter(story => {
    if (filters.liveOnly && story.freshnessStatus !== 'LIVE') return false
    if (filters.recentOnly && story.freshnessStatus !== 'LIVE' && story.freshnessStatus !== 'RECENT') return false
    if (filters.source !== 'all' && story.provider !== filters.source) return false
    if (filters.category !== 'all' && story.intelligenceCategory !== filters.category) return false
    if (story.confidence < filters.minConfidence) return false
    if (filters.missionImpactOnly && story.affectedMissions.length === 0) return false
    if (filters.localGlobal === 'local' && story.localScope !== 'local') return false
    if (filters.localGlobal === 'global' && story.localScope === 'local') return false
    return true
  })
}

export function filterNewsIntelSections(
  sections: Record<NewsIntelWatchSection, NewsIntelStory[]>,
  filters: NewsIntelWallFilters,
): Record<NewsIntelWatchSection, NewsIntelStory[]> {
  const filtered = Object.fromEntries(
    NEWS_INTEL_WATCH_SECTIONS.map(section => [
      section,
      filterNewsIntelStories(sections[section], filters),
    ]),
  ) as Record<NewsIntelWatchSection, NewsIntelStory[]>
  return filtered
}

export async function fetchNewsIntelWallData(location: {
  mode: string
  city?: string | null
  neighborhood?: string | null
}): Promise<{ newsCards: NewsDashboardCard[]; signals: SignalResult[] }> {
  const [dashboardRes, signalsRes] = await Promise.all([
    fetch('/api/environment/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ location }),
    }),
    fetch('/api/signals/results', { cache: 'no-store' }),
  ])

  const newsCards: NewsDashboardCard[] = []
  let signals: SignalResult[] = []

  if (dashboardRes.ok) {
    const dashboard = await dashboardRes.json() as { news?: { cards?: NewsDashboardCard[] } }
    newsCards.push(...(dashboard.news?.cards ?? []))
  }

  if (signalsRes.ok) {
    const body = await signalsRes.json() as { results?: SignalResult[] }
    signals = body.results ?? []
  }

  return { newsCards, signals }
}
