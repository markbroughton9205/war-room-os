import 'server-only'

import { getEnvAliasValue } from '@/lib/configuration/envAlias'
import type { SignalRawItem, SignalSourceDefinition } from './model'
import {
  createFreshnessCounters,
  evaluateFreshness,
  freshnessDiagnostics,
  maxAgeDaysForProvider,
  newsDateWindow,
  recordFreshness,
  withFreshnessMetadata,
} from './freshness'
import { isAllowedCloudUrl } from './sources'

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  raw_content?: string | null
  score?: number
  published_date?: string
  publishedDate?: string
}

type TavilyResponse = {
  results?: TavilyResult[]
  error?: string
}

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: {
      title?: string
      sourceURL?: string
      url?: string
    }
  }
  error?: string
}

type NewsApiResponse = {
  status?: string
  articles?: Array<{
    source?: { name?: string }
    title?: string
    description?: string | null
    url?: string
    publishedAt?: string
  }>
  message?: string
}

type GuardianResponse = {
  response?: {
    status?: string
    results?: Array<{
      id?: string
      webTitle?: string
      webUrl?: string
      sectionName?: string
      webPublicationDate?: string
      fields?: { trailText?: string }
    }>
  }
  message?: string
}

export type ProviderRunResult = {
  items: SignalRawItem[]
  diagnostics: Record<string, unknown>
}

const FETCH_TIMEOUT_MS = 10_000
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

const TAVILY_QUERIES = [
  {
    query: 'Akron Ohio small business automation demand customer operations missed calls',
    sourceId: 'tavily-smb-automation',
    sourceLabel: 'Tavily SMB automation search',
    categories: ['SMB_automation', 'customer_operations', 'call_center', 'local_Akron'] as const,
  },
  {
    query: 'Ohio sprinter van freight courier local delivery routes logistics demand',
    sourceId: 'tavily-freight-logistics',
    sourceLabel: 'Tavily freight logistics search',
    categories: ['freight', 'sprinter_van', 'local_delivery', 'load_board', 'Ohio_business'] as const,
  },
  {
    query: 'remote data annotation AI evaluation jobs gigs pay tasks availability',
    sourceId: 'tavily-ai-evaluation-gigs',
    sourceLabel: 'Tavily AI evaluation gig search',
    categories: ['job', 'gig', 'data_annotation', 'AI_evaluation'] as const,
  },
  {
    query: 'AI agent app factory opportunity trend small business workflow 2026',
    sourceId: 'tavily-ai-trends',
    sourceLabel: 'Tavily AI trend search',
    categories: ['AI_trends', 'app_factory_opportunity', 'SMB_automation'] as const,
  },
  {
    query: 'Akron Ohio local economic development business grants workforce logistics',
    sourceId: 'tavily-akron-ohio-economy',
    sourceLabel: 'Tavily Akron Ohio economy search',
    categories: ['local_Akron', 'Ohio_business', 'economic_warning'] as const,
  },
]

function compact(value: string, limit = 900): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
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

function textBetween(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? cleanXml(match[1]) : null
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
  return match?.[1] ?? null
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml, text/html',
      'User-Agent': 'WarRoomSignalRadar/1.0',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Source URL returned HTTP ${response.status}`)
  return response.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WarRoomSignalRadar/1.0',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`JSON source returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function runTavilySignalSearch(capturedAt: string): Promise<ProviderRunResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) {
    return { items: [], diagnostics: { configured: false, error: 'TAVILY_API_KEY is not configured' } }
  }

  const maxAgeDays = maxAgeDaysForProvider('tavily')
  const counters = createFreshnessCounters(maxAgeDays)
  const settled = await Promise.allSettled(TAVILY_QUERIES.map(async search => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: search.query,
        search_depth: 'advanced',
        topic: 'general',
        time_range: 'month',
        max_results: 4,
        include_answer: false,
        include_raw_content: 'markdown',
        include_images: false,
        include_favicon: false,
      }),
      signal: AbortSignal.timeout(16_000),
    })
    const data = await response.json() as TavilyResponse
    if (!response.ok) throw new Error(data.error || `Tavily search failed for ${search.query}`)
    return (data.results ?? []).flatMap((result): SignalRawItem[] => {
      const url = String(result.url ?? '')
      const title = String(result.title ?? '').trim()
      if (!title || !isAllowedCloudUrl(url)) return []
      const publishedAt = result.published_date ?? result.publishedDate
      const freshness = publishedAt ? evaluateFreshness(publishedAt, { maxAgeDays }) : null
      if (freshness) {
        recordFreshness(counters, freshness)
        if (!freshness.acceptedForLiveSignal) return []
      }
      return [{
        provider: 'tavily',
        sourceId: search.sourceId,
        sourceLabel: search.sourceLabel,
        sourceKind: 'search',
        title,
        url,
        summary: compact(`${String(result.content ?? '')} ${String(result.raw_content ?? '')}`, 1000),
        categories: [...search.categories],
        rawScore: typeof result.score === 'number' ? result.score : null,
        capturedAt,
        metadata: freshness
          ? withFreshnessMetadata({ query: search.query }, freshness, capturedAt)
          : { query: search.query, maxAgeDays, signalIngestedAt: capturedAt },
      }]
    })
  }))

  const items = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const errors = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))

  return {
    items,
    diagnostics: {
      configured: true,
      queryCount: TAVILY_QUERIES.length,
      resultCount: items.length,
      ...freshnessDiagnostics(counters),
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}

export async function runFirecrawlOrDirectSources(sources: SignalSourceDefinition[], capturedAt: string): Promise<ProviderRunResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  const targets = sources.filter(source => source.url && source.configured && isAllowedCloudUrl(source.url)).slice(0, 10)
  if (!targets.length) return { items: [], diagnostics: { configured: Boolean(apiKey), targets: 0 } }

  const settled = await Promise.allSettled(targets.map(async source => {
    if (!source.url) return null
    if (apiKey) {
      const response = await fetch(FIRECRAWL_SCRAPE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: source.url,
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: FETCH_TIMEOUT_MS,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 2_000),
      })
      const data = await response.json() as FirecrawlScrapeResponse
      if (!response.ok || data.success === false) throw new Error(data.error || `Firecrawl failed for ${source.url}`)
      const markdown = compact(String(data.data?.markdown ?? ''), 1200)
      if (!markdown) throw new Error(`Firecrawl returned no content for ${source.url}`)
      return {
        provider: 'firecrawl' as const,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceKind: source.kind,
        title: String(data.data?.metadata?.title ?? source.label),
        url: data.data?.metadata?.sourceURL ?? data.data?.metadata?.url ?? source.url,
        summary: markdown,
        categories: source.categories,
        rawScore: source.reliabilityScore,
        capturedAt,
        metadata: { extraction: 'firecrawl' },
      } satisfies SignalRawItem
    }

    const html = await fetchText(source.url)
    const title = textBetween(html, 'title') ?? source.label
    const body = compact(cleanXml(html), 1200)
    if (!body) throw new Error(`Direct source fetch returned no text for ${source.url}`)
    return {
      provider: 'source_url' as const,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceKind: source.kind,
      title,
      url: source.url,
      summary: body,
      categories: source.categories,
      rawScore: source.reliabilityScore,
      capturedAt,
      metadata: { extraction: 'direct_fetch' },
    } satisfies SignalRawItem
  }))

  const items = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  const errors = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))

  return {
    items,
    diagnostics: {
      configured: Boolean(apiKey),
      extraction: apiKey ? 'firecrawl' : 'direct_fetch',
      targets: targets.length,
      resultCount: items.length,
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}

export async function runRssSources(sources: SignalSourceDefinition[], capturedAt: string): Promise<ProviderRunResult> {
  const feeds = sources.filter(source => source.provider === 'rss' && source.url && isAllowedCloudUrl(source.url)).slice(0, 12)
  const maxAgeDays = maxAgeDaysForProvider('rss')
  const counters = createFreshnessCounters(maxAgeDays)
  const settled = await Promise.allSettled(feeds.map(async source => {
    if (!source.url) return []
    const xml = await fetchText(source.url)
    const itemBlocks = Array.from(xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)).map(match => match[0])
    return itemBlocks.slice(0, 3).flatMap((block, index): SignalRawItem[] => {
      const title = textBetween(block, 'title')
      const link = textBetween(block, 'link') ?? attr(block.match(/<link\b[^>]*>/i)?.[0] ?? '', 'href')
      const description = textBetween(block, 'description') ?? textBetween(block, 'summary') ?? textBetween(block, 'content') ?? title
      const publishedAt = textBetween(block, 'pubDate') ?? textBetween(block, 'published') ?? textBetween(block, 'updated') ?? textBetween(block, 'dc:date')
      if (!title || !link || !isAllowedCloudUrl(link)) return []
      const freshness = evaluateFreshness(publishedAt, { maxAgeDays })
      recordFreshness(counters, freshness)
      if (!freshness.acceptedForLiveSignal) return []
      return [{
        provider: 'rss',
        sourceId: source.id,
        sourceLabel: source.label,
        sourceKind: 'rss',
        title,
        url: link,
        summary: compact(description ?? title, 900),
        categories: source.categories,
        rawScore: source.reliabilityScore,
        capturedAt,
        metadata: withFreshnessMetadata({ feedUrl: source.url, itemIndex: index }, freshness, capturedAt),
      }]
    })
  }))

  const items = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const errors = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
  return {
    items,
    diagnostics: {
      configured: feeds.length > 0,
      feedCount: feeds.length,
      resultCount: items.length,
      ...freshnessDiagnostics(counters),
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}

export async function runNewsProviders(capturedAt: string): Promise<ProviderRunResult> {
  const newsApiKey = getEnvAliasValue('newsApiKey')
  const guardianKey = getEnvAliasValue('guardianApiKey')
  const tasks: Array<Promise<SignalRawItem[]>> = []
  const newsApiMaxAgeDays = maxAgeDaysForProvider('newsapi')
  const guardianMaxAgeDays = maxAgeDaysForProvider('guardian')
  const newsApiCounters = createFreshnessCounters(newsApiMaxAgeDays)
  const guardianCounters = createFreshnessCounters(guardianMaxAgeDays)
  const now = new Date(capturedAt)

  if (newsApiKey) {
    const { fromDate, toDate } = newsDateWindow(newsApiMaxAgeDays, now)
    const params = new URLSearchParams({
      q: 'Akron Ohio business economy AI jobs logistics automation',
      language: 'en',
      pageSize: '10',
      sortBy: 'publishedAt',
      from: fromDate,
      to: toDate,
      apiKey: newsApiKey,
    })
    tasks.push(fetchJson<NewsApiResponse>(`https://newsapi.org/v2/everything?${params.toString()}`).then(data => {
      if (data.status && data.status !== 'ok') throw new Error(data.message ?? 'NewsAPI returned an error')
      return (data.articles ?? []).slice(0, 10).flatMap((article): SignalRawItem[] => {
        const title = article.title?.trim()
        const url = article.url?.trim()
        if (!title || !url || !isAllowedCloudUrl(url)) return []
        const freshness = evaluateFreshness(article.publishedAt, { now, maxAgeDays: newsApiMaxAgeDays })
        recordFreshness(newsApiCounters, freshness)
        if (!freshness.acceptedForLiveSignal) return []
        return [{
          provider: 'newsapi',
          sourceId: 'newsapi-economic-news',
          sourceLabel: article.source?.name ?? 'NewsAPI economic news',
          sourceKind: 'news_api',
          title,
          url,
          summary: compact(article.description ?? title),
          categories: ['AI_trends', 'Ohio_business', 'economic_warning', 'app_factory_opportunity'],
          rawScore: 0.76,
          capturedAt,
          metadata: withFreshnessMetadata({ providerDateField: 'publishedAt' }, freshness, capturedAt),
        }]
      })
    }))
  }

  if (guardianKey) {
    const { fromDate, toDate } = newsDateWindow(guardianMaxAgeDays, now)
    const params = new URLSearchParams({
      'api-key': guardianKey,
      'show-fields': 'trailText',
      'page-size': '10',
      'from-date': fromDate,
      'to-date': toDate,
      'order-by': 'newest',
      q: 'Akron OR Ohio OR business OR economy OR AI OR logistics OR jobs',
    })
    tasks.push(fetchJson<GuardianResponse>(`https://content.guardianapis.com/search?${params.toString()}`).then(data => {
      if (data.response?.status && data.response.status !== 'ok') throw new Error(data.message ?? 'Guardian returned an error')
      return (data.response?.results ?? []).slice(0, 10).flatMap((article): SignalRawItem[] => {
        const title = article.webTitle?.trim()
        const url = article.webUrl?.trim()
        if (!title || !url || !isAllowedCloudUrl(url)) return []
        const freshness = evaluateFreshness(article.webPublicationDate, { now, maxAgeDays: guardianMaxAgeDays })
        recordFreshness(guardianCounters, freshness)
        if (!freshness.acceptedForLiveSignal) return []
        return [{
          provider: 'guardian',
          sourceId: 'guardian-economic-news',
          sourceLabel: 'The Guardian',
          sourceKind: 'guardian',
          title,
          url,
          summary: compact(article.fields?.trailText ? cleanXml(article.fields.trailText) : title),
          categories: ['AI_trends', 'Ohio_business', 'economic_warning', 'app_factory_opportunity'],
          rawScore: 0.82,
          capturedAt,
          metadata: withFreshnessMetadata({
            section: article.sectionName ?? null,
            providerDateField: 'webPublicationDate',
            guardianId: article.id ?? null,
          }, freshness, capturedAt),
        }]
      })
    }))
  }

  if (!tasks.length) {
    return { items: [], diagnostics: { newsapiConfigured: false, guardianConfigured: false, resultCount: 0 } }
  }

  const settled = await Promise.allSettled(tasks)
  const items = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const errors = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))

  return {
    items,
    diagnostics: {
      newsapiConfigured: Boolean(newsApiKey),
      guardianConfigured: Boolean(guardianKey),
      resultCount: items.length,
      maxAgeDays: Math.max(newsApiMaxAgeDays, guardianMaxAgeDays),
      freshResultCount: newsApiCounters.accepted + guardianCounters.accepted,
      liveCount: newsApiCounters.live + guardianCounters.live,
      recentCount: newsApiCounters.recent + guardianCounters.recent,
      staleDiscardedCount: newsApiCounters.staleDiscarded + guardianCounters.staleDiscarded,
      staleDiscarded: newsApiCounters.staleDiscarded + guardianCounters.staleDiscarded,
      unknownDateDiscardedCount: newsApiCounters.unknownDateDiscarded + guardianCounters.unknownDateDiscarded,
      oldestAcceptedAgeDays: [newsApiCounters.oldestAcceptedAgeDays, guardianCounters.oldestAcceptedAgeDays]
        .filter((value): value is number => typeof value === 'number')
        .reduce<number | null>((oldest, value) => oldest === null ? value : Math.max(oldest, value), null),
      newsapi: freshnessDiagnostics(newsApiCounters),
      guardian: freshnessDiagnostics(guardianCounters),
      failures: errors.length,
      firstError: errors[0] ?? null,
    },
  }
}
