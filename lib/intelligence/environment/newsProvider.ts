import 'server-only'

import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import { getEnvAliasNames, getEnvAliasValue, resolveEnvAlias } from '@/lib/configuration/envAlias'
import type { NewsCategory, NewsDashboardCard, NewsDashboardSnapshot, NewsFreshnessDiagnostics } from '@/lib/intelligence/environment/liveEnvironmentTypes'
import {
  classifyFreshness,
  LIVE_SIGNAL_MAX_AGE_DAYS,
  newsCardDisplayLabel,
  newsCardTimestampLabel,
  newsDateWindow,
  PUBLICATION_TIME_UNAVAILABLE,
} from '@/lib/signals/freshness'

const NEWS_TIMEOUT_MS = 8000
const NEWS_ENV_NAMES = [...getEnvAliasNames('newsRssFeeds'), ...getEnvAliasNames('newsApiKey'), ...getEnvAliasNames('guardianApiKey')]

type FeedRegistration = {
  name: string
  category: NewsCategory
  url: string
}

type NewsApiArticle = {
  source?: { name?: string }
  author?: string | null
  title?: string
  description?: string | null
  url?: string
  urlToImage?: string | null
  publishedAt?: string
}

type NewsApiResponse = {
  status?: string
  totalResults?: number
  articles?: NewsApiArticle[]
  message?: string
}

type GuardianResponse = {
  response?: {
    status?: string
    results?: {
      id?: string
      webTitle?: string
      webUrl?: string
      sectionName?: string
      webPublicationDate?: string
      fields?: {
        thumbnail?: string
        trailText?: string
      }
    }[]
  }
  message?: string
}

function setupSnapshot(detail: string): NewsDashboardSnapshot {
  const aliasDiagnostics = [resolveEnvAlias('newsRssFeeds'), resolveEnvAlias('newsApiKey'), resolveEnvAlias('guardianApiKey')]
  const primaryDiagnostic = aliasDiagnostics.find(diagnostic => diagnostic.configured) ?? aliasDiagnostics[0]
  const aliasRecommendation = aliasDiagnostics.find(diagnostic => diagnostic.recommendation)?.recommendation ?? null

  return {
    status: 'unavailable',
    provider: getEnvAliasValue('guardianApiKey') ? 'Guardian' : getEnvAliasValue('newsApiKey') ? 'NewsAPI' : 'RSS feed registry',
    cards: [],
    fetchedAt: null,
    freshness: 'unknown',
    source: 'No news source returned data',
    detail,
    setup: {
      envVarNames: NEWS_ENV_NAMES,
      preferredEnvName: primaryDiagnostic.preferredEnvName,
      aliasDetected: aliasDiagnostics.some(diagnostic => diagnostic.aliasDetected),
      configured: aliasDiagnostics.some(diagnostic => diagnostic.configured),
      aliasRecommendation,
      envAliasDiagnostics: aliasDiagnostics,
      blockedFeature: 'Live Environment news intelligence cards',
      recommendedSetup: aliasRecommendation ?? 'Set GUARDIAN_API_KEY for richer cards, NEWS_API_KEY for headlines, or NEWS_RSS_FEEDS/RSS_FEED_URLS to a semicolon-separated registry. Each RSS entry may be category|source name|https://feed.url/rss.',
    },
  }
}

function textBetween(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? cleanXml(match[1]) : null
}

function cleanXml(value: unknown): string {
  const text = toDisplayText(value)
  if (!text) return ''
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
  return match?.[1] ?? null
}

function imageFromItem(item: string): string | null {
  const media = item.match(/<media:(?:content|thumbnail)\b[^>]*>/i)?.[0]
  const enclosure = item.match(/<enclosure\b[^>]*>/i)?.[0]
  const enclosureType = enclosure ? attr(enclosure, 'type') : null
  return (media ? attr(media, 'url') : null)
    ?? (enclosure && enclosureType?.startsWith('image/') ? attr(enclosure, 'url') : null)
}

function parseCategory(value: string | undefined): NewsCategory {
  if (value === 'local' || value === 'regional' || value === 'national' || value === 'international') return value
  return 'national'
}

function parseRegistry(): FeedRegistration[] {
  const raw = getEnvAliasValue('newsRssFeeds')
  if (!raw) return []
  return raw
    .split(/[;\n]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .slice(0, 12)
    .flatMap(entry => {
      const parts = entry.split('|').map(part => part.trim())
      const url = parts.length >= 3 ? parts[2] : parts[0]
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') return []
        return [{
          category: parts.length >= 3 ? parseCategory(parts[0]) : 'national',
          name: parts.length >= 3 ? parts[1] || parsed.hostname : parsed.hostname,
          url: parsed.toString(),
        }]
      } catch {
        return []
      }
    })
}

function signalForCategory(category: NewsCategory): NewsDashboardCard['signalLabel'] {
  if (category === 'local' || category === 'regional') return 'emerging'
  return 'verified'
}

function buildNewsCard(input: {
  id: string
  title: string
  url: string | null
  sourceName: string
  category: NewsCategory
  imageUrl: string | null
  publishedAt: string | null
  fetchedAt: string
  detail: string
  provider: NonNullable<NewsDashboardCard['provider']>
  confidenceLabel: NewsDashboardCard['confidenceLabel']
}): NewsDashboardCard | null {
  const freshness = classifyFreshness(input.publishedAt, {
    maxAgeDays: LIVE_SIGNAL_MAX_AGE_DAYS,
    provider: input.provider === 'newsapi' || input.provider === 'guardian' ? input.provider : 'rss',
  })
  if (!freshness.acceptedForLiveSignal) return null
  const articlePublishedAt = freshness.articlePublishedAt
  const signalIngestedAt = input.fetchedAt
  const timestampLabel = newsCardTimestampLabel({
    articlePublishedAt,
    signalIngestedAt,
    sourceName: input.sourceName,
  })
  return {
    id: input.id,
    title: input.title,
    url: input.url,
    sourceName: input.sourceName,
    category: input.category,
    imageUrl: input.imageUrl,
    articlePublishedAt,
    signalIngestedAt,
    signalVerifiedAt: freshness.sourceStatus === 'VERIFIED' ? signalIngestedAt : null,
    publishedAt: articlePublishedAt,
    timestampLabel,
    freshness: timestampLabel,
    sourceStatus: freshness.sourceStatus,
    freshnessStatus: freshness.status,
    operationalStatus: freshness.operationalStatus,
    timeIntegrityStatus: freshness.timeIntegrityStatus,
    displayLabel: newsCardDisplayLabel({
      sourceStatus: freshness.sourceStatus,
      freshnessStatus: freshness.status,
      operationalStatus: freshness.operationalStatus,
    }),
    confidenceLabel: input.confidenceLabel,
    signalLabel: signalForCategory(input.category),
    detail: input.detail,
    provider: input.provider,
  }
}

function newsFreshnessDiagnostics(stored: NewsDashboardCard[], active: NewsDashboardCard[]): NewsFreshnessDiagnostics {
  let oldestStoredAgeDays: number | null = null
  for (const card of stored) {
    const provider = card.provider === 'newsapi' || card.provider === 'guardian' ? card.provider : 'rss'
    const freshness = classifyFreshness(card.articlePublishedAt, { maxAgeDays: LIVE_SIGNAL_MAX_AGE_DAYS, provider })
    if (freshness.ageDays !== null) {
      oldestStoredAgeDays = oldestStoredAgeDays === null ? freshness.ageDays : Math.max(oldestStoredAgeDays, freshness.ageDays)
    }
  }
  let oldestActiveResultAgeDays: number | null = null
  let freshAcceptedCount = 0
  let recentAcceptedCount = 0
  for (const card of active) {
    if (card.freshnessStatus === 'LIVE') freshAcceptedCount += 1
    if (card.freshnessStatus === 'RECENT') recentAcceptedCount += 1
    const provider = card.provider === 'newsapi' || card.provider === 'guardian' ? card.provider : 'rss'
    const freshness = classifyFreshness(card.articlePublishedAt, { maxAgeDays: LIVE_SIGNAL_MAX_AGE_DAYS, provider })
    if (freshness.ageDays !== null) {
      oldestActiveResultAgeDays = oldestActiveResultAgeDays === null ? freshness.ageDays : Math.max(oldestActiveResultAgeDays, freshness.ageDays)
    }
  }
  const cacheFilteredCount = Math.max(0, stored.length - active.length)
  return {
    freshAcceptedCount,
    recentAcceptedCount,
    staleSuppressedCount: cacheFilteredCount,
    oldestActiveResultAgeDays,
    oldestStoredResultAgeDays: oldestStoredAgeDays,
    cacheFilteredCount,
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'WarRoomLiveEnvironment/1.0',
      },
    })
    if (!res.ok) throw new Error(`RSS feed returned ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WarRoomLiveEnvironment/1.0',
      },
    })
    if (!res.ok) throw new Error(`News provider returned HTTP ${res.status}`)
    return await res.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

function parseFeedItems(feed: FeedRegistration, xml: string, fetchedAt: string): NewsDashboardCard[] {
  const itemBlocks = Array.from(xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)).map(match => match[0])
  return itemBlocks.slice(0, 4).flatMap((item, index) => {
    const title = textBetween(item, 'title')
    if (!title) return []
    const link = textBetween(item, 'link') ?? attr(item.match(/<link\b[^>]*>/i)?.[0] ?? '', 'href')
    const publishedRaw = textBetween(item, 'pubDate') ?? textBetween(item, 'published') ?? textBetween(item, 'updated')
    const publishedAt = publishedRaw && Number.isFinite(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null
    const card = buildNewsCard({
      id: `${feed.name}-${index}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
      title,
      url: link,
      sourceName: feed.name,
      category: feed.category,
      imageUrl: imageFromItem(item),
      publishedAt,
      fetchedAt,
      confidenceLabel: feed.category === 'local' || feed.category === 'regional' ? 'emerging' : 'verified',
      detail: `${feed.category} RSS item from a configured source. Thumbnail is shown only when the feed provides media metadata.`,
      provider: 'rss',
    })
    return card ? [card] : []
  })
}

function parseNewsApiArticles(data: NewsApiResponse, fetchedAt: string): NewsDashboardCard[] {
  if (data.status && data.status !== 'ok') throw new Error(data.message ?? 'NewsAPI returned an error')
  return (data.articles ?? []).slice(0, 12).flatMap((article, index) => {
    const title = toDisplayText(article.title)
    if (!title) return []
    const publishedAt = article.publishedAt && Number.isFinite(Date.parse(article.publishedAt))
      ? new Date(article.publishedAt).toISOString()
      : null
    const sourceName = article.source?.name?.trim() || 'NewsAPI source'
    const card = buildNewsCard({
      id: `newsapi-${sourceName}-${index}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
      title,
      url: article.url ?? null,
      sourceName,
      category: 'national',
      imageUrl: article.urlToImage ?? null,
      publishedAt,
      fetchedAt,
      confidenceLabel: 'verified',
      detail: article.description?.trim()
        ? `Source-backed NewsAPI headline. ${article.description.trim()}`
        : 'Source-backed NewsAPI headline. Image is shown only when the source provides one.',
      provider: 'newsapi',
    })
    return card ? [card] : []
  })
}

async function fetchNewsApiCards(apiKey: string, fetchedAt: string): Promise<NewsDashboardCard[]> {
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=12&apiKey=${encodeURIComponent(apiKey)}`
  return parseNewsApiArticles(await fetchJson<NewsApiResponse>(url), fetchedAt)
}

function parseGuardianCards(data: GuardianResponse, fetchedAt: string): NewsDashboardCard[] {
  if (data.response?.status && data.response.status !== 'ok') throw new Error(data.message ?? 'Guardian returned an error')
  return (data.response?.results ?? []).slice(0, 12).flatMap((article, index) => {
    const title = toDisplayText(article.webTitle)
    if (!title) return []
    const publishedAt = article.webPublicationDate && Number.isFinite(Date.parse(article.webPublicationDate))
      ? new Date(article.webPublicationDate).toISOString()
      : null
    const imageUrl = article.fields?.thumbnail?.startsWith('https://') ? article.fields.thumbnail : null
    const section = article.sectionName?.toLowerCase()
    const category: NewsCategory = section?.includes('world') ? 'international' : section?.includes('us') ? 'national' : 'national'
    const card = buildNewsCard({
      id: `guardian-${article.id ?? index}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
      title,
      url: article.webUrl ?? null,
      sourceName: 'The Guardian',
      category,
      imageUrl,
      publishedAt,
      fetchedAt,
      confidenceLabel: 'verified',
      detail: article.fields?.trailText?.trim()
        ? `Source-backed Guardian story. ${cleanXml(article.fields.trailText)}`
        : 'Source-backed Guardian story. Thumbnail is shown only when Guardian provides one.',
      provider: 'guardian',
    })
    return card ? [card] : []
  })
}

async function fetchGuardianCards(apiKey: string, fetchedAt: string): Promise<NewsDashboardCard[]> {
  const { fromDate, toDate } = newsDateWindow(LIVE_SIGNAL_MAX_AGE_DAYS)
  const params = new URLSearchParams({
    'api-key': apiKey,
    'show-fields': 'thumbnail,trailText',
    'page-size': '12',
    'from-date': fromDate,
    'to-date': toDate,
    'order-by': 'newest',
    q: 'Akron OR "Summit County" OR business OR economy OR weather OR public safety',
  })
  return parseGuardianCards(await fetchJson<GuardianResponse>(`https://content.guardianapis.com/search?${params.toString()}`), fetchedAt)
}

function dedupeCards(cards: NewsDashboardCard[]): NewsDashboardCard[] {
  const seen = new Set<string>()
  return cards.filter(card => {
    const key = compactDisplayWhitespace(card.url ?? card.title).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function buildNewsDashboardSnapshot(): Promise<NewsDashboardSnapshot> {
  const registry = parseRegistry()
  const apiKey = getEnvAliasValue('newsApiKey')
  const guardianApiKey = getEnvAliasValue('guardianApiKey')
  if (!registry.length && !apiKey && !guardianApiKey) return setupSnapshot('No bounded RSS feed registry, Guardian key, or NewsAPI key is configured.')
  const fetchedAt = new Date().toISOString()
  const guardianResults = guardianApiKey ? await Promise.allSettled([fetchGuardianCards(guardianApiKey, fetchedAt)]) : []
  const rssResults = await Promise.allSettled(registry.map(async feed => parseFeedItems(feed, await fetchText(feed.url), fetchedAt)))
  const apiResults = apiKey ? await Promise.allSettled([fetchNewsApiCards(apiKey, fetchedAt)]) : []
  const guardianCards = guardianResults.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const rssCards = rssResults.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const apiCards = apiResults.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const storedCards = dedupeCards([...guardianCards, ...rssCards, ...apiCards])
  const cards = storedCards
    .filter(card => card.operationalStatus === 'ACTIONABLE')
    .slice(0, 12)
  const freshnessDiagnostics = newsFreshnessDiagnostics(storedCards, cards)
  const failures = [...guardianResults, ...rssResults, ...apiResults].filter(result => result.status === 'rejected').length
  const sourceParts = [
    guardianApiKey ? 'Guardian content API' : null,
    registry.length ? `${registry.length} configured RSS feed${registry.length === 1 ? '' : 's'}` : null,
    apiKey ? 'NewsAPI top headlines' : null,
  ].filter(Boolean)

  if (!cards.length) {
    return {
      ...setupSnapshot(failures ? 'Configured news sources were unreachable or returned no parseable items.' : 'Configured news sources returned no items.'),
      status: failures ? 'error' : 'unavailable',
      fetchedAt,
      freshness: PUBLICATION_TIME_UNAVAILABLE,
    }
  }

  const snapshotTimestampLabel = newsCardTimestampLabel({
    articlePublishedAt: cards[0]?.articlePublishedAt ?? null,
    signalIngestedAt: fetchedAt,
    sourceName: sourceParts[0] ?? 'news',
  })

  return {
    status: failures ? 'error' : 'available',
    provider: sourceParts.join(' + '),
    cards,
    fetchedAt,
    freshness: snapshotTimestampLabel,
    source: sourceParts.join(' + '),
    detail: failures
      ? `${cards.length} source-backed news cards loaded; ${failures} news request${failures === 1 ? '' : 's'} failed.`
      : `${cards.length} source-backed news cards loaded from configured news sources.`,
    diagnostics: [
      `Guardian cards: ${guardianCards.length}`,
      `RSS cards: ${rssCards.length}`,
      `NewsAPI cards: ${apiCards.length}`,
      `Snapshot ingested at: ${fetchedAt}`,
      `Failed source requests: ${failures}`,
      `Fresh accepted: ${freshnessDiagnostics.freshAcceptedCount}`,
      `Recent accepted: ${freshnessDiagnostics.recentAcceptedCount}`,
      `Stale suppressed: ${freshnessDiagnostics.staleSuppressedCount}`,
      `Cache filtered: ${freshnessDiagnostics.cacheFilteredCount}`,
      `Oldest active age: ${freshnessDiagnostics.oldestActiveResultAgeDays ?? 'none'}d`,
      `Oldest stored age: ${freshnessDiagnostics.oldestStoredResultAgeDays ?? 'none'}d`,
    ],
    freshnessDiagnostics,
  }
}
