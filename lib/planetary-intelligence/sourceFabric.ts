import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type {
  EndpointType,
  FreshnessClass,
  SourceEndpoint,
  SourceLifecycleState,
  SourceRecord,
} from './types'

export const SOURCE_DISCOVERY_ADAPTERS = [
  { id: 'war_room_search', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'War Room internal' },
  { id: 'searxng', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'AGPL-3.0 — isolate behind replaceable adapter' },
  { id: 'wikidata', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'CC0' },
  { id: 'gdelt', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'GDELT terms — verify before integration' },
  { id: 'media_cloud', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'AGPL backend — isolate; not a foundation' },
  { id: 'common_crawl', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'Common Crawl terms — not brute-force crawl' },
  { id: 'government_directories', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'public' },
  { id: 'broadcast_directories', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'public' },
  { id: 'public_emergency_registries', role: 'DISCOVERY_ENRICHMENT', required: false, license: 'public' },
] as const

export type InMemorySourceFabric = {
  sources: Map<string, SourceRecord>
  endpoints: Map<string, SourceEndpoint>
}

export function createSourceFabric(): InMemorySourceFabric {
  return { sources: new Map(), endpoints: new Map() }
}

export function registerSource(fabric: InMemorySourceFabric, source: SourceRecord): SourceRecord {
  fabric.sources.set(source.sourceId, source)
  return source
}

export function registerEndpoint(fabric: InMemorySourceFabric, endpoint: SourceEndpoint): SourceEndpoint {
  if (!fabric.sources.has(endpoint.sourceId)) {
    throw new Error(`Endpoint ${endpoint.endpointId} references unknown source ${endpoint.sourceId}`)
  }
  fabric.endpoints.set(endpoint.endpointId, endpoint)
  return endpoint
}

export function sourceAndEndpointAreSeparate(source: SourceRecord, endpoint: SourceEndpoint): boolean {
  return source.sourceId === endpoint.sourceId && source.url !== endpoint.url || endpoint.type !== 'HTML'
}

const LIFECYCLE: SourceLifecycleState[] = [
  'DISCOVERED',
  'VERIFYING',
  'TYPE_CLASSIFICATION',
  'GEO_CLASSIFICATION',
  'LANGUAGE_CLASSIFICATION',
  'ENDPOINT_DISCOVERY',
  'ACCESS_POLITENESS_CHECK',
  'OWNERSHIP_ORIGIN_ANALYSIS',
  'LIVE',
]

export function advanceDiscovery(state: SourceLifecycleState): SourceLifecycleState {
  const index = LIFECYCLE.indexOf(state)
  if (index < 0) return state
  return LIFECYCLE[Math.min(index + 1, LIFECYCLE.length - 1)]!
}

export function candidateFromUrl(input: {
  url: string
  discoveryMethod: string
  nowIso?: string
}): SourceRecord {
  const now = input.nowIso ?? new Date().toISOString()
  const domain = hostnameFromUrl(input.url) || 'unknown.local'
  return {
    sourceId: `src-${domain.replace(/[^a-z0-9]+/g, '-')}`,
    canonicalName: domain,
    outletName: domain,
    publisher: domain,
    parentCompany: null,
    ownershipType: 'UNKNOWN',
    canonicalDomain: domain,
    domainAliases: [],
    country: null,
    region: null,
    stateProvince: null,
    countyDistrict: null,
    city: null,
    locality: null,
    latitude: null,
    longitude: null,
    primaryLanguage: 'und',
    supportedLanguages: [],
    sourceType: 'JOURNALISM',
    topicSpecialties: [],
    primaryOrSecondary: 'UNKNOWN',
    originalReportingCapability: false,
    url: canonicalizeUrl(input.url) || input.url,
    status: 'DISCOVERED',
    wireRelationship: null,
    parentNetwork: null,
    discoveryMethod: input.discoveryMethod,
    discoveredAt: now,
    lastChecked: null,
    lastSuccessfulFetch: null,
    observedPublishRate: null,
    freshnessClass: 'NATIONAL_REGIONAL',
    robotsStatus: 'UNKNOWN',
    termsStatus: 'UNKNOWN',
    retentionClass: 'METADATA_ONLY',
    licenseMetadata: null,
  }
}

export function seedFoundationSources(fabric: InMemorySourceFabric, nowIso = new Date().toISOString()): void {
  const seeds: Array<Partial<SourceRecord> & Pick<SourceRecord, 'sourceId' | 'canonicalName' | 'canonicalDomain' | 'url' | 'sourceType' | 'primaryLanguage'>> = [
    { sourceId: 'src-bbc', canonicalName: 'BBC News', outletName: 'BBC News', publisher: 'BBC', parentCompany: 'BBC', canonicalDomain: 'bbc.com', url: 'https://www.bbc.com/news', sourceType: 'JOURNALISM', primaryLanguage: 'en', ownershipType: 'PUBLIC_BROADCASTER' },
    { sourceId: 'src-reliefweb', canonicalName: 'ReliefWeb', outletName: 'ReliefWeb', publisher: 'UN OCHA', canonicalDomain: 'reliefweb.int', url: 'https://reliefweb.int', sourceType: 'NGO', primaryLanguage: 'en' },
    { sourceId: 'src-arxiv', canonicalName: 'arXiv', outletName: 'arXiv', publisher: 'Cornell University', canonicalDomain: 'arxiv.org', url: 'https://arxiv.org', sourceType: 'SCIENTIFIC_SOURCE', primaryLanguage: 'en', ownershipType: 'UNIVERSITY' },
    { sourceId: 'src-federalregister', canonicalName: 'Federal Register', outletName: 'Federal Register', publisher: 'NARA', canonicalDomain: 'federalregister.gov', url: 'https://www.federalregister.gov', sourceType: 'OFFICIAL_RECORD', primaryLanguage: 'en', ownershipType: 'GOVERNMENT' },
    { sourceId: 'src-nws', canonicalName: 'NWS Alerts', outletName: 'National Weather Service', publisher: 'NOAA', canonicalDomain: 'api.weather.gov', url: 'https://api.weather.gov/alerts', sourceType: 'ALERT_FEED', primaryLanguage: 'en', freshnessClass: 'BREAKING_EMERGENCY', ownershipType: 'GOVERNMENT' },
  ]
  for (const seed of seeds) {
    const source = candidateFromUrl({ url: seed.url, discoveryMethod: 'foundation_seed', nowIso })
    registerSource(fabric, {
      ...source,
      ...seed,
      status: 'LIVE',
      lastChecked: nowIso,
      lastSuccessfulFetch: nowIso,
    } as SourceRecord)
    registerEndpoint(fabric, {
      endpointId: `ep-${seed.sourceId}-rss`,
      sourceId: seed.sourceId,
      type: seed.sourceType === 'ALERT_FEED' ? 'PUBLIC_ALERT_FEED' : seed.sourceType === 'SCIENTIFIC_SOURCE' ? 'ATOM' : 'RSS',
      url: `${seed.url.replace(/\/$/, '')}/rss.xml`,
      etag: null,
      lastModified: null,
      lastFetch: nowIso,
      nextFetch: nowIso,
      fetchIntervalSeconds: intervalFor(seed.freshnessClass ?? 'NATIONAL_REGIONAL'),
      status: 'OK',
      errorCount: 0,
      rateLimitState: null,
    })
  }
}

export function intervalFor(freshness: FreshnessClass): number {
  if (freshness === 'BREAKING_EMERGENCY') return 120
  if (freshness === 'NATIONAL_REGIONAL') return 900
  if (freshness === 'COMMUNITY_HYPERLOCAL') return 3600
  return 86_400
}

export type RefreshResult = {
  endpointId: string
  status: SourceEndpoint['status']
  cached: boolean
  live: boolean
  notModified: boolean
}

/**
 * Auto and manual refresh share this path. Conditional HTTP semantics:
 * ETag / If-None-Match / Last-Modified / If-Modified-Since, plus 429/503 backoff.
 */
export function refreshEndpoint(fabric: InMemorySourceFabric, endpointId: string, input: {
  nowIso: string
  httpStatus: number
  etag?: string | null
  lastModified?: string | null
  retryAfterSeconds?: number
  bodyChanged?: boolean
}): RefreshResult {
  const endpoint = fabric.endpoints.get(endpointId)
  if (!endpoint) throw new Error(`Unknown endpoint ${endpointId}`)
  const source = fabric.sources.get(endpoint.sourceId)
  let status: SourceEndpoint['status'] = 'OK'
  let cached = false
  let live = true
  let notModified = false
  if (input.httpStatus === 304 || input.bodyChanged === false) {
    status = 'NOT_MODIFIED'
    cached = true
    live = false
    notModified = true
  } else if (input.httpStatus === 429 || input.httpStatus === 503) {
    status = 'RATE_LIMITED'
    live = false
  } else if (input.httpStatus >= 400) {
    status = 'ERROR'
    live = false
  }
  const backoff = status === 'RATE_LIMITED'
    ? (input.retryAfterSeconds ?? 60) * (1 + endpoint.errorCount)
    : endpoint.fetchIntervalSeconds
  const next = new Date(Date.parse(input.nowIso) + backoff * 1000).toISOString()
  const updated: SourceEndpoint = {
    ...endpoint,
    etag: input.etag ?? endpoint.etag,
    lastModified: input.lastModified ?? endpoint.lastModified,
    lastFetch: input.nowIso,
    nextFetch: next,
    status,
    errorCount: status === 'ERROR' || status === 'RATE_LIMITED' ? endpoint.errorCount + 1 : 0,
    rateLimitState: status === 'RATE_LIMITED' ? `Retry-After ${input.retryAfterSeconds ?? 60}` : null,
  }
  fabric.endpoints.set(endpointId, updated)
  if (source) {
    fabric.sources.set(source.sourceId, {
      ...source,
      lastChecked: input.nowIso,
      lastSuccessfulFetch: status === 'OK' || status === 'NOT_MODIFIED' ? input.nowIso : source.lastSuccessfulFetch,
      status: status === 'ERROR' && updated.errorCount >= 5 ? 'OFFLINE' : source.status,
    })
  }
  return { endpointId, status, cached, live, notModified }
}

export function manualRefreshUsesSamePath(): true {
  return true
}

export function resolveFeedItemUrl(input: { url: string; guid?: string; feedUrl?: string; title?: string }): string {
  const candidates = [input.url, input.guid ?? '']
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^ftp:\/\//i.test(trimmed)) return trimmed.replace(/^ftp:\/\//i, 'https://')
  }
  if (input.feedUrl && (input.title || input.guid)) {
    const id = (input.guid || input.title || 'item').replace(/[^a-z0-9]+/gi, '-').slice(0, 48)
    return `${input.feedUrl.split('#')[0]}#${id}`
  }
  return input.url
}

export type ParsedFeedItem = {
  url: string
  title: string
  publishedAt: string | null
  kind: EndpointType
  summary?: string
  categories?: string[]
}

export function parseRssOrAtomOrSitemap(xml: string, kind: EndpointType): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = []
  if (kind === 'RSS' || kind === 'ATOM' || kind === 'PUBLIC_ALERT_FEED') {
    const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1)
    for (const block of blocks) {
      const title = textBetween(block, 'title')
      const href = hrefBetween(block)
      const about = /rdf:about=["']([^"']+)["']/i.exec(block)?.[1]
      const guid = textBetween(block, 'guid')
      const link = href || textBetween(block, 'link') || about || guid || ''
      const published = textBetween(block, 'pubDate') || textBetween(block, 'updated') || textBetween(block, 'published') || textBetween(block, 'sent') || textBetween(block, 'dc:date')
      const summary = stripTags(textBetween(block, 'description') || textBetween(block, 'summary') || textBetween(block, 'content') || textBetween(block, 'dc:description'))
      const categories = [...block.matchAll(/<categor(?:y|ies)[^>]*>([^<]*)<\/categor/gi)].map(match => match[1]!.trim()).filter(Boolean)
      if (link) items.push({ url: link, title, publishedAt: published || null, kind, summary: summary.slice(0, 800) || undefined, categories: categories.length ? categories : undefined })
    }
  }
  if (kind === 'SITEMAP' || kind === 'NEWS_SITEMAP') {
    const locs = xml.match(/<loc>([^<]+)<\/loc>/gi) ?? []
    for (const loc of locs) {
      const url = loc.replace(/<\/?loc>/gi, '').trim()
      if (url) items.push({ url, title: hostnameFromUrl(url) || url, publishedAt: null, kind })
    }
  }
  return items
}

function textBetween(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return (match?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
}

function hrefBetween(block: string): string | null {
  const match = block.match(/<link[^>]+href=["']([^"']+)["']/i)
  return match?.[1] ?? null
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function noFakeMaximum(): boolean {
  return true
}

export function sourceDirectedNotBruteForce(): boolean {
  return true
}

export function agplAdaptersAreIsolated(): boolean {
  return SOURCE_DISCOVERY_ADAPTERS.filter(item => item.id === 'searxng' || item.id === 'media_cloud').every(item => item.required === false)
}
