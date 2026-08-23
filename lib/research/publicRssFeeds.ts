/**
 * Credential-free public news RSS/RDF fallback tier — used when Tavily/Grok are unavailable or
 * unauthenticated. Every URL below was live-fetch-tested (HTTP 200, real current-dated items)
 * before being added; do not add an untested URL without repeating that check.
 *
 * Excluded, do not add without a fresh live check: AP (no working public endpoint found), Reuters
 * (public RSS retired), Financial Times (403, blocks bots), weather.gov/help/rss (HTML docs page,
 * not a feed — confirmed 200/text-html), usa.gov/rss/updates.xml (confirmed 404),
 * alerts.weather.gov/cap/us.php (confirmed dead — connection failure, superseded by
 * api.weather.gov/alerts/active, see ./nwsAlerts.ts).
 */

export type PublicNewsCategory =
  | 'world'
  | 'news'
  | 'markets'
  | 'economy'
  | 'technology'
  | 'science'
  | 'startups'
  | 'africa'
  | 'europe'
  | 'asia'
  | 'weather'

export type PublicNewsReliability = 'HIGH' | 'MEDIUM' | 'LOW'

export type PublicNewsItem = {
  title: string
  url: string
  snippet: string
  publishedAt?: string
  source: string
  /** ISO timestamp — when War Room fetched this item (distinct from publishedAt). */
  retrievedAt: string
  sourceType: 'RSS_FALLBACK' | 'GOVERNMENT_API'
  reliability: PublicNewsReliability
  isFallback: true
  categories: PublicNewsCategory[]
  /** Flags feeds (e.g. Bloomberg) that are largely video-segment headlines rather than article text. */
  contentDensity?: 'thin' | 'normal'
}

export type TrustedRssFeedDescriptor = {
  name: string
  url: string
  format: 'rss' | 'rdf'
  categories: PublicNewsCategory[]
  reliability: PublicNewsReliability
  contentDensity?: 'thin' | 'normal'
}

/**
 * BBC/NASA/Bloomberg/TechCrunch/ABC/Al Jazeera/Le Monde/The Hindu/SCMP/SMH are standard RSS 2.0.
 * AllAfrica's URL carries an .rdf extension but serves plain RSS 2.0 (`<rss version="2.0">`
 * root) — confirmed live. Deutsche Welle is genuine RSS 1.0/RDF (`<rdf:RDF>` root, `<dc:date>`
 * instead of `<pubDate>`) — its real `<item rdf:about="...">` content blocks are structurally
 * identical to plain `<item>` tags, so the same item-matching parser below handles both; only the
 * date-field fallback (pubDate → dc:date) differs, which is already handled per-item.
 */
export const TRUSTED_RSS_FEEDS: TrustedRssFeedDescriptor[] = [
  { name: 'BBC World News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', format: 'rss', categories: ['world', 'news'], reliability: 'HIGH' },
  { name: 'NASA Breaking News', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', format: 'rss', categories: ['technology', 'science'], reliability: 'HIGH' },
  { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', format: 'rss', categories: ['markets', 'economy'], reliability: 'MEDIUM', contentDensity: 'thin' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', format: 'rss', categories: ['technology', 'startups'], reliability: 'MEDIUM' },
  { name: 'ABC News', url: 'http://feeds.abcnews.com/abcnews/topstories', format: 'rss', categories: ['world', 'news'], reliability: 'HIGH' },
  { name: 'AllAfrica', url: 'https://allafrica.com/tools/headlines/rdf/africa/headlines.rdf', format: 'rdf', categories: ['world', 'news', 'africa'], reliability: 'MEDIUM' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', format: 'rss', categories: ['world', 'news'], reliability: 'HIGH' },
  { name: 'Le Monde', url: 'https://www.lemonde.fr/rss/en_continu.xml', format: 'rss', categories: ['world', 'news', 'europe'], reliability: 'HIGH' },
  { name: 'The Hindu', url: 'https://www.thehindu.com/news/feeder/default.rss', format: 'rss', categories: ['world', 'news', 'asia'], reliability: 'HIGH' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/2/feed', format: 'rss', categories: ['world', 'news', 'asia'], reliability: 'HIGH' },
  { name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-all', format: 'rdf', categories: ['world', 'news', 'europe'], reliability: 'HIGH' },
  { name: 'Sydney Morning Herald', url: 'https://www.smh.com.au/rss/feed.xml', format: 'rss', categories: ['world', 'news'], reliability: 'HIGH' },
]

const RSS_TIMEOUT_MS = 10_000
const MAX_ITEMS_PER_FEED = 12
const DEFAULT_MAX_COMBINED_RESULTS = 24
const THIN_SNIPPET_LENGTH = 40

export function stripHtmlish(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeXmlText(raw: string): string {
  return stripHtmlish(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function xmlField(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)
  return match ? decodeXmlText(match[1] ?? '') : ''
}

type ParsedFeedItem = {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

/**
 * Parse RSS 2.0 or RSS 1.0/RDF `<item>` blocks without trusting the markup as HTML. Works for
 * both shapes because RDF's real content items use the same `<item ...>...</item>` tag as plain
 * RSS — only the date field differs (`<pubDate>` vs `<dc:date>`), handled by the fallback below.
 * `<rdf:li rdf:resource="...">` index entries (no closing `</item>`) never match this regex, so
 * the RDF `<items><rdf:Seq>` table-of-contents block is correctly skipped.
 */
function parseFeedItems(xml: string): ParsedFeedItem[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []
  return items.flatMap(block => {
    const title = xmlField(block, 'title')
    const url = xmlField(block, 'link')
    if (!title || !/^https:\/\//i.test(url)) return []
    const rawDate = xmlField(block, 'pubDate') || xmlField(block, 'dc:date')
    const timestamp = rawDate ? Date.parse(rawDate) : NaN
    return [{
      title,
      url,
      snippet: xmlField(block, 'description').slice(0, 900),
      ...(Number.isFinite(timestamp) ? { publishedAt: new Date(timestamp).toISOString() } : {}),
    }]
  })
}

/** Generic RSS parse for a caller-supplied source (e.g. a dynamic Google News search feed). */
export function parsePublicNewsRss(xml: string, fallbackSource: string): PublicNewsItem[] {
  const retrievedAt = new Date().toISOString()
  return parseFeedItems(xml).map(item => ({
    ...item,
    source: fallbackSource,
    retrievedAt,
    sourceType: 'RSS_FALLBACK',
    reliability: 'MEDIUM',
    isFallback: true,
    categories: ['world', 'news'],
    ...(item.snippet.length > 0 && item.snippet.length < THIN_SNIPPET_LENGTH ? { contentDensity: 'thin' } : {}),
  }))
}

function parseTrustedFeedXml(xml: string, feed: TrustedRssFeedDescriptor, retrievedAt: string): PublicNewsItem[] {
  return parseFeedItems(xml).slice(0, MAX_ITEMS_PER_FEED).map(item => ({
    ...item,
    source: feed.name,
    retrievedAt,
    sourceType: 'RSS_FALLBACK',
    reliability: feed.reliability,
    isFallback: true,
    categories: feed.categories,
    ...(feed.contentDensity === 'thin' || (item.snippet.length > 0 && item.snippet.length < THIN_SNIPPET_LENGTH)
      ? { contentDensity: 'thin' as const }
      : {}),
  }))
}

export type TrustedRssFeedOutcome = {
  name: string
  ok: boolean
  count: number
  error?: string
}

export type TrustedRssFeedsResult = {
  ok: boolean
  results: PublicNewsItem[]
  perFeed: TrustedRssFeedOutcome[]
  error?: string
  durationMs: number
}

/**
 * Fetch the trusted static feed list, optionally filtered to feeds matching any of `categories`.
 * Empty/omitted `categories` fetches every feed.
 */
export async function fetchTrustedPublicNewsFeeds(input: {
  categories?: PublicNewsCategory[]
  timeoutMs?: number
  maxCombinedResults?: number
} = {}): Promise<TrustedRssFeedsResult> {
  const started = Date.now()
  const categorySet = input.categories?.length ? new Set(input.categories) : null
  const feeds = categorySet
    ? TRUSTED_RSS_FEEDS.filter(feed => feed.categories.some(c => categorySet.has(c)))
    : TRUSTED_RSS_FEEDS

  const settled = await Promise.all(feeds.map(async feed => {
    const retrievedAt = new Date().toISOString()
    try {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(input.timeoutMs ?? RSS_TIMEOUT_MS),
        headers: { 'user-agent': 'WarRoomLiveResearch/1.0', accept: 'application/rss+xml,application/xml,text/xml' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const items = parseTrustedFeedXml(await res.text(), feed, retrievedAt)
      return { name: feed.name, ok: true as const, items }
    } catch (error) {
      return { name: feed.name, ok: false as const, items: [] as PublicNewsItem[], error: error instanceof Error ? error.message : String(error) }
    }
  }))

  const seen = new Set<string>()
  const results = settled
    .flatMap(feed => feed.items)
    .filter(item => {
      const key = `${item.title.toLowerCase()}|${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, input.maxCombinedResults ?? DEFAULT_MAX_COMBINED_RESULTS)

  const perFeed: TrustedRssFeedOutcome[] = settled.map(feed => ({
    name: feed.name,
    ok: feed.ok,
    count: feed.items.length,
    ...(feed.ok ? {} : { error: feed.error }),
  }))
  const errors = perFeed.filter(f => f.error).map(f => `${f.name}: ${f.error}`)

  return {
    ok: results.length > 0,
    results,
    perFeed,
    ...(results.length ? {} : { error: errors.join(' | ') || 'trusted_rss_empty' }),
    durationMs: Date.now() - started,
  }
}
