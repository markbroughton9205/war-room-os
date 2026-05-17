import type { NewsCategory, NewsDashboardCard, NewsDashboardSnapshot } from '@/lib/intelligence/environment/liveEnvironmentTypes'

const NEWS_TIMEOUT_MS = 8000
const NEWS_ENV_NAMES = ['NEWS_RSS_FEEDS', 'RSS_FEED_URLS']

type FeedRegistration = {
  name: string
  category: NewsCategory
  url: string
}

function setupSnapshot(detail: string): NewsDashboardSnapshot {
  return {
    status: 'unavailable',
    provider: 'RSS feed registry',
    cards: [],
    fetchedAt: null,
    freshness: 'unknown',
    source: 'No RSS feeds configured',
    detail,
    setup: {
      envVarNames: NEWS_ENV_NAMES,
      blockedFeature: 'Live Environment news slideshow',
      recommendedSetup: 'Set NEWS_RSS_FEEDS or RSS_FEED_URLS to a semicolon-separated registry. Each entry may be category|source name|https://feed.url/rss.',
    },
  }
}

function textBetween(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? cleanXml(match[1]) : null
}

function cleanXml(value: string): string {
  return value
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
  const raw = process.env.NEWS_RSS_FEEDS?.trim() || process.env.RSS_FEED_URLS?.trim()
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

function freshnessLabel(publishedAt: string | null, fetchedAt: string): string {
  const basis = publishedAt ?? fetchedAt
  const ageMs = Date.now() - Date.parse(basis)
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'fresh'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m old`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h old`
  return `${Math.round(hours / 24)}d old`
}

function signalForCategory(category: NewsCategory): NewsDashboardCard['signalLabel'] {
  if (category === 'local' || category === 'regional') return 'emerging'
  return 'verified'
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

function parseFeedItems(feed: FeedRegistration, xml: string, fetchedAt: string): NewsDashboardCard[] {
  const itemBlocks = Array.from(xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)).map(match => match[0])
  return itemBlocks.slice(0, 4).flatMap((item, index) => {
    const title = textBetween(item, 'title')
    if (!title) return []
    const link = textBetween(item, 'link') ?? attr(item.match(/<link\b[^>]*>/i)?.[0] ?? '', 'href')
    const publishedRaw = textBetween(item, 'pubDate') ?? textBetween(item, 'published') ?? textBetween(item, 'updated')
    const publishedAt = publishedRaw && Number.isFinite(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null
    return [{
      id: `${feed.name}-${index}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
      title,
      url: link,
      sourceName: feed.name,
      category: feed.category,
      imageUrl: imageFromItem(item),
      publishedAt,
      freshness: freshnessLabel(publishedAt, fetchedAt),
      confidenceLabel: feed.category === 'local' || feed.category === 'regional' ? 'emerging' : 'verified',
      signalLabel: signalForCategory(feed.category),
      detail: `${feed.category} RSS item from a configured source. Thumbnail is shown only when the feed provides media metadata.`,
    }]
  })
}

export async function buildNewsDashboardSnapshot(): Promise<NewsDashboardSnapshot> {
  const registry = parseRegistry()
  if (!registry.length) return setupSnapshot('No bounded RSS feed registry is configured.')
  const fetchedAt = new Date().toISOString()
  const results = await Promise.allSettled(registry.map(async feed => parseFeedItems(feed, await fetchText(feed.url), fetchedAt)))
  const cards = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).slice(0, 12)
  const failures = results.filter(result => result.status === 'rejected').length

  if (!cards.length) {
    return {
      ...setupSnapshot(failures ? 'Configured RSS feeds were unreachable or returned no parseable items.' : 'Configured RSS feeds returned no items.'),
      status: failures ? 'error' : 'unavailable',
      fetchedAt,
      freshness: freshnessLabel(null, fetchedAt),
    }
  }

  return {
    status: failures ? 'error' : 'available',
    provider: 'RSS feed registry',
    cards,
    fetchedAt,
    freshness: freshnessLabel(null, fetchedAt),
    source: `${registry.length} configured RSS feed${registry.length === 1 ? '' : 's'}`,
    detail: failures
      ? `${cards.length} source-backed news cards loaded; ${failures} feed request${failures === 1 ? '' : 's'} failed.`
      : `${cards.length} source-backed news cards loaded from the bounded RSS registry.`,
  }
}
