import { classifyFetchedBody, discoverFeedsFromHtml } from '@/lib/planetary-intelligence/endpointDiscover'
import { parseRssOrAtomOrSitemap } from '@/lib/planetary-intelligence/sourceFabric'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import { haversineKm } from '@/lib/terra/cinematicFlyTo'
import { parseLocalContext } from './context'
import { matchLocalSources, classifyAreaCoverage, coverageLevelsPresent, localSourceUsability, summarizeLocalRuntimeHealth } from './match'
import { qualifyLocalStory } from './qualify'
import { TERRA_LOCAL_SOURCE_SEEDS } from './registry'
import {
  LOCAL_SOURCE_STALE_MS,
  LOCAL_STORY_NEARBY_RADIUS_KM,
  type TerraLocalContext,
  type TerraLocalFetchedItem,
  type TerraLocalIntelReport,
  type TerraLocalMatchedSource,
  type TerraLocalMixRow,
  type TerraLocalSource,
  type TerraLocalSourceHealth,
  type TerraLocalSourceRuntime,
  type TerraLocalSourceType,
  type TerraLocalStoryFreshness,
} from './types'

const USER_AGENT = 'WarRoomTerraLocal/1.0 (local source discovery; public feeds only)'
const FETCH_TIMEOUT_MS = 8_000
const LIVE_MS = 2 * 60 * 60 * 1000
const LOCAL_CACHE_TTL_MS = 5 * 60 * 1000
const localIntelCache = new Map<string, { value: TerraLocalIntelReport; expiresAt: number }>()

function mixLabel(type: TerraLocalSourceType): { key: string; label: string } {
  if (type === 'TV') return { key: 'TV', label: 'TV' }
  if (type === 'RADIO') return { key: 'RADIO', label: 'RADIO' }
  if (type === 'NEWSPAPER') return { key: 'NEWSPAPER', label: 'NEWSPAPER' }
  if (type === 'PUBLIC_AGENCY' || type === 'EMERGENCY') return { key: 'PUBLIC SAFETY', label: 'PUBLIC SAFETY' }
  if (type === 'TRANSPORTATION') return { key: 'TRAFFIC', label: 'TRAFFIC' }
  if (type === 'WEATHER') return { key: 'WEATHER', label: 'WEATHER' }
  return { key: 'EVENTS', label: 'EVENTS' }
}

function buildMix(items: TerraLocalFetchedItem[]): TerraLocalMixRow[] {
  const counts = new Map<string, TerraLocalMixRow>()
  for (const item of items) {
    const mix = mixLabel(item.sourceType)
    const current = counts.get(mix.key) ?? { key: mix.key, label: mix.label, count: 0 }
    current.count += 1
    counts.set(mix.key, current)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

async function fetchBody(url: string): Promise<{ status: number | null; contentType: string | null; body: string; error: string | null }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml, */*',
      },
    })
    const body = await response.text()
    return { status: response.status, contentType: response.headers.get('content-type'), body, error: null }
  } catch (error) {
    return { status: null, contentType: null, body: '', error: error instanceof Error ? error.message : String(error) }
  }
}

function healthFromClassification(activation: string, newest: string | null, nowMs: number): TerraLocalSourceHealth {
  if (activation === 'RATE_LIMITED') return 'RATE_LIMITED'
  if (activation === 'BLOCKED') return 'BLOCKED'
  if (activation === 'OFFLINE' || activation === 'INVALID') return 'UNAVAILABLE'
  if (activation === 'HTML_ONLY' || activation === 'NO_MACHINE_ENDPOINT' || activation === 'DISCOVERED') return 'NO_FEED'
  if (newest) {
    const published = Date.parse(newest)
    if (Number.isFinite(published) && nowMs - published > LOCAL_SOURCE_STALE_MS) return 'STALE'
  }
  return 'ACTIVE'
}

function toIso(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function storyFreshness(publishedAt: string | null, now: string): TerraLocalStoryFreshness {
  if (!publishedAt) return 'STALE'
  const age = Date.parse(now) - Date.parse(publishedAt)
  if (!Number.isFinite(age)) return 'STALE'
  if (age <= LIVE_MS) return 'LIVE'
  if (age <= LOCAL_SOURCE_STALE_MS) return 'RECENT'
  return 'STALE'
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _
    })
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _
    })
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stampItem(item: Omit<TerraLocalFetchedItem, 'eventLocalTime' | 'sourceLocalTime' | 'freshnessState'>): TerraLocalFetchedItem {
  return {
    ...item,
    title: decodeBasicEntities(item.title),
    summary: item.summary ? decodeBasicEntities(item.summary) : item.summary,
    eventLocalTime: item.publishedAt,
    sourceLocalTime: item.retrievedAt,
    freshnessState: storyFreshness(item.publishedAt, item.retrievedAt),
  }
}

async function discoverWikidataCitySources(context: TerraLocalContext): Promise<TerraLocalSource[]> {
  const city = context.city
  if (!city) return []
  const lang = context.countryCode === 'JP' ? 'ja,en' : 'en'
  const sparql = `SELECT ?itemLabel ?url ?instanceLabel WHERE {
    VALUES ?type { wd:Q1616075 wd:Q11032 wd:Q14350 }
    ?item wdt:P31/wdt:P279* ?type .
    ?item wdt:P856 ?url .
    ?item wdt:P131* ?place .
    ?place rdfs:label "${city.replace(/"/g, '')}"@en .
    ?item wdt:P31 ?instance .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}". }
  } LIMIT 8`
  try {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`
    const response = await fetch(url, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return []
    const body = await response.json() as { results?: { bindings?: Array<{ itemLabel?: { value?: string }; url?: { value?: string }; instanceLabel?: { value?: string } }> } }
    const out: TerraLocalSource[] = []
    for (const row of body.results?.bindings ?? []) {
      const homepage = row.url?.value
      const name = row.itemLabel?.value
      if (!homepage || !name || !/^https?:\/\//i.test(homepage)) continue
      const instance = (row.instanceLabel?.value ?? '').toLowerCase()
      const type: TerraLocalSourceType = /television|tv station|broadcaster/.test(instance)
        ? 'TV'
        : /radio/.test(instance)
          ? 'RADIO'
          : 'NEWSPAPER'
      out.push({
        id: `wikidata:${homepage}`,
        name,
        type,
        city,
        county: context.county,
        metro: context.metro,
        region: context.metro,
        state: context.state,
        country: context.country ?? 'Unknown',
        countryCode: context.countryCode ?? 'XX',
        coverageLevel: 'CITY',
        serviceArea: `${city}${context.county ? ` / ${context.county}` : ''}`,
        aliases: [city, context.county, context.metro].filter((value): value is string => Boolean(value)),
        homepage,
        feedUrl: null,
        feedType: 'NONE',
        language: context.countryCode === 'JP' ? 'ja' : 'en',
        provider: 'Wikidata',
        lastVerified: new Date().toISOString().slice(0, 10),
        status: 'NO_FEED',
        licenseClass: 'PUBLIC_HTML',
        provenance: 'Wikidata metadata discovery via Research Engine path; homepage only until a public feed is verified.',
      })
    }
    return out
  } catch {
    return []
  }
}

async function probeHomepageFeed(source: TerraLocalSource): Promise<string | null> {
  const fetched = await fetchBody(source.homepage)
  if (!fetched.body) return null
  const feeds = discoverFeedsFromHtml(fetched.body, source.homepage).filter(feed => feed.endpointType === 'RSS' || feed.endpointType === 'ATOM')
  return feeds[0]?.url ?? null
}

async function itemsFromSource(source: TerraLocalMatchedSource, now: string): Promise<{
  health: TerraLocalSourceHealth
  items: TerraLocalFetchedItem[]
  error: string | null
}> {
  if (source.status === 'BLOCKED') {
    return { health: 'BLOCKED', items: [], error: 'Feed is blocked or forbidden.' }
  }
  if (source.licenseClass === 'RESTRICTED' || source.status === 'AUTH_REQUIRED') {
    return { health: 'AUTH_REQUIRED', items: [], error: 'Feed is not publicly readable.' }
  }
  if (!source.feedUrl || source.feedType === 'NONE') {
    const discovered = await probeHomepageFeed(source)
    if (!discovered) return { health: 'NO_FEED', items: [], error: 'No public RSS/API feed verified.' }
    source.feedUrl = discovered
    source.feedType = 'RSS'
  }
  if (source.feedUrl === 'nws:point') {
    return { health: 'ACTIVE', items: [], error: null }
  }
  const fetched = await fetchBody(source.feedUrl)
  if (fetched.error) return { health: 'UNAVAILABLE', items: [], error: fetched.error }
  if (fetched.status === 403) return { health: 'BLOCKED', items: [], error: 'HTTP 403' }
  if (fetched.status === 401) return { health: 'AUTH_REQUIRED', items: [], error: 'HTTP 401' }
  if (source.feedType === 'JSON' || /application\/json/i.test(fetched.contentType ?? '')) {
    return parseJsonSource(source, fetched.body, fetched.status, now)
  }
  const classified = classifyFetchedBody({
    url: source.feedUrl,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    body: fetched.body,
  })
  if (!classified.live) {
    return {
      health: healthFromClassification(classified.activationState, null, Date.parse(now)),
      items: [],
      error: classified.reason,
    }
  }
  const parsed = classified.items.length
    ? classified.items
    : parseRssOrAtomOrSitemap(fetched.body, 'RSS')
  const items: TerraLocalFetchedItem[] = parsed.slice(0, 20).map(item => stampItem({
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    serviceArea: source.serviceArea,
    title: item.title || source.name,
    summary: item.summary ?? null,
    url: item.url,
    publishedAt: toIso(item.publishedAt),
    retrievedAt: now,
    language: source.language,
    geography: null,
    qualification: { qualified: false, relevance: null, reason: 'pending' },
  }))
  const newest = items.map(item => item.publishedAt).filter(Boolean).sort().at(-1) ?? null
  return { health: healthFromClassification('LIVE', newest, Date.parse(now)), items, error: null }
}

function parseJsonSource(source: TerraLocalMatchedSource, body: string, status: number | null, now: string): {
  health: TerraLocalSourceHealth
  items: TerraLocalFetchedItem[]
  error: string | null
} {
  if (status === 429) return { health: 'RATE_LIMITED', items: [], error: 'HTTP 429' }
  if (status === 403) return { health: 'BLOCKED', items: [], error: 'HTTP 403' }
  if (status === 401) return { health: 'AUTH_REQUIRED', items: [], error: 'HTTP 401' }
  if (status !== null && status >= 400) return { health: 'UNAVAILABLE', items: [], error: `HTTP ${status}` }
  try {
    const parsed = JSON.parse(body) as unknown
    const items: TerraLocalFetchedItem[] = []

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'targetArea' in parsed && 'text' in parsed) {
      const record = parsed as { publishingOffice?: string; reportDatetime?: string; targetArea?: string; headlineText?: string; text?: string }
      const area = record.targetArea?.trim() || source.city || source.serviceArea
      const headline = record.headlineText?.trim()
      items.push(stampItem({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        serviceArea: source.serviceArea,
        title: headline || `${area} weather overview`,
        summary: record.text?.trim() || null,
        url: source.homepage,
        publishedAt: toIso(record.reportDatetime) ?? now,
        retrievedAt: now,
        language: source.language,
        geography: area,
        qualification: { qualified: false, relevance: null, reason: 'pending' },
      }))
      return { health: 'ACTIVE', items, error: null }
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { results?: unknown[] }).results)) {
      const rows = (parsed as { results: Array<Record<string, unknown>> }).results
      for (const row of rows.slice(0, 20)) {
        const title = typeof row.title === 'string' ? row.title : null
        if (!title) continue
        const url = typeof row.url === 'string' ? row.url : source.homepage
        const summary = typeof row.lead_text === 'string' ? row.lead_text : null
        const geography = typeof row.address_city === 'string' ? row.address_city : source.city
        const published = typeof row.date_start === 'string' ? row.date_start : typeof row.updated_at === 'string' ? row.updated_at : now
        items.push(stampItem({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          serviceArea: source.serviceArea,
          title,
          summary,
          url,
          publishedAt: toIso(published) ?? now,
          retrievedAt: now,
          language: source.language,
          geography,
          qualification: { qualified: false, relevance: null, reason: 'pending' },
        }))
      }
      return { health: 'ACTIVE', items, error: null }
    }

    const rows = Array.isArray(parsed) ? parsed : []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as { name?: string; lineStatuses?: Array<{ statusSeverity?: number; statusSeverityDescription?: string; reason?: string }> }
      const disruptions = (record.lineStatuses ?? []).filter(statusRow => (statusRow.statusSeverity ?? 10) < 10)
      if (!disruptions.length) continue
      const reason = disruptions.map(statusRow => statusRow.reason || statusRow.statusSeverityDescription).filter(Boolean).join(' · ')
      items.push(stampItem({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        serviceArea: source.serviceArea,
        title: `${record.name ?? 'Line'} — ${disruptions[0]?.statusSeverityDescription ?? 'disruption'}`,
        summary: reason || null,
        url: source.homepage,
        publishedAt: now,
        retrievedAt: now,
        language: source.language,
        geography: source.city,
        qualification: { qualified: true, relevance: 'Same city', reason: 'Official local transport status.' },
      }))
    }
    return { health: 'ACTIVE', items, error: null }
  } catch {
    return { health: 'UNAVAILABLE', items: [], error: 'JSON parse failed.' }
  }
}

function nearbyGeoItems(context: TerraLocalContext, objects: TerraLiveGeoObject[] | undefined, now: string): TerraLocalFetchedItem[] {
  if (!objects?.length) return []
  const items: TerraLocalFetchedItem[] = []
  for (const object of objects) {
    if (!Number.isFinite(object.latitude) || !Number.isFinite(object.longitude)) continue
    const km = haversineKm(
      { latitude: context.latitude, longitude: context.longitude },
      { latitude: object.latitude, longitude: object.longitude },
    )
    if (km > LOCAL_STORY_NEARBY_RADIUS_KM) continue
    const type: TerraLocalSourceType = object.type === 'severe_weather_alert'
      ? 'WEATHER'
      : object.type === 'traffic_event'
        ? 'TRANSPORTATION'
        : 'EVENTS'
    items.push(stampItem({
      sourceId: `geo:${object.provider}:${object.id}`,
      sourceName: object.publisherFamily ?? object.provider,
      sourceType: type,
      serviceArea: context.shortLabel,
      title: object.title,
      summary: object.summary ?? null,
      url: object.sourceUrl,
      publishedAt: object.observedAt,
      retrievedAt: now,
      language: 'en',
      geography: object.region ?? object.country ?? `${km.toFixed(1)} km`,
      qualification: {
        qualified: true,
        relevance: km <= 12 ? 'Same city' : 'Nearby event',
        reason: `${km.toFixed(1)} km from active Terra location.`,
      },
    }))
  }
  return items
}

function overallHealth(runtime: TerraLocalSourceRuntime[]): TerraLocalSourceHealth | 'PARTIAL' {
  const queried = runtime.filter(row => row.source.feedType !== 'NONE' || row.health !== 'NO_FEED')
  const live = queried.filter(row => row.health === 'ACTIVE' || row.health === 'STALE')
  if (!queried.length) return 'NO_FEED'
  if (live.length === queried.length) return live.some(row => row.health === 'STALE') ? 'STALE' : 'ACTIVE'
  if (live.length) return 'PARTIAL'
  if (queried.every(row => row.health === 'BLOCKED')) return 'BLOCKED'
  if (queried.every(row => row.health === 'AUTH_REQUIRED' || row.health === 'BLOCKED')) return 'AUTH_REQUIRED'
  if (queried.every(row => row.health === 'RATE_LIMITED')) return 'RATE_LIMITED'
  if (queried.every(row => row.health === 'NO_FEED')) return 'NO_FEED'
  return 'UNAVAILABLE'
}

export async function loadTerraLocalIntel(input: {
  latitude: number
  longitude: number
  place?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  timezone?: string | null
  zoom?: string | null
  objects?: TerraLiveGeoObject[]
  now?: string
}): Promise<TerraLocalIntelReport> {
  void input.zoom
  const now = input.now ?? new Date().toISOString()
  const context = parseLocalContext(input)
  const cacheKey = `terra-local:v3:${context.countryCode ?? 'x'}:${context.state ?? 'x'}:${context.county ?? 'x'}:${context.city ?? 'x'}:${context.latitude.toFixed(2)}:${context.longitude.toFixed(2)}`
  const cached = localIntelCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = await loadUncached(context, input.objects, now)
  localIntelCache.set(cacheKey, { value, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS })
  return value
}

async function loadUncached(context: TerraLocalContext, objects: TerraLiveGeoObject[] | undefined, now: string): Promise<TerraLocalIntelReport> {
  let matched = matchLocalSources(context, TERRA_LOCAL_SOURCE_SEEDS)
  const hasActiveFeed = matched.some(source => source.status === 'ACTIVE' && source.feedUrl && source.feedUrl !== 'nws:point')
  if (!hasActiveFeed && context.city) {
    const discovered = await discoverWikidataCitySources(context)
    const extra = matchLocalSources(context, discovered)
    const seen = new Set(matched.map(source => source.homepage))
    for (const source of extra) {
      if (seen.has(source.homepage)) continue
      matched.push(source)
      seen.add(source.homepage)
    }
  }

  const fetchedRows = await Promise.all(matched.map(source => itemsFromSource(source, now)))
  const runtime: TerraLocalSourceRuntime[] = []
  const qualified: TerraLocalFetchedItem[] = []
  const rejected: TerraLocalFetchedItem[] = []

  matched.forEach((source, index) => {
    const fetched = fetchedRows[index]!
    let qCount = 0
    let rCount = 0
    for (const item of fetched.items) {
      const qualification = item.qualification.qualified
        ? item.qualification
        : qualifyLocalStory({
          title: item.title,
          summary: item.summary,
          geography: item.geography,
          context,
          source,
        })
      const next = { ...item, qualification }
      if (qualification.qualified) {
        qualified.push(next)
        qCount += 1
      } else {
        rejected.push(next)
        rCount += 1
      }
    }
    runtime.push({
      source,
      health: fetched.health,
      usability: localSourceUsability(fetched.health),
      itemCount: fetched.items.length,
      qualifiedCount: qCount,
      rejectedCount: rCount,
      newestPublishedAt: fetched.items.map(item => item.publishedAt).filter(Boolean).sort().at(-1) ?? null,
      error: fetched.error,
    })
  })

  const geoItems = nearbyGeoItems(context, objects, now)
  for (const item of geoItems) {
    if (qualified.some(existing => existing.url && existing.url === item.url)) continue
    qualified.push(item)
  }

  qualified.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  const coverage = classifyAreaCoverage(matched, runtime)
  const health = overallHealth(runtime)
  const mix = buildMix(qualified)
  const reason = !matched.length
    ? `No registered local sources for ${context.shortLabel}. Registry is not a complete global station list.`
    : health === 'UNAVAILABLE' || health === 'NO_FEED' || health === 'AUTH_REQUIRED' || health === 'BLOCKED'
      ? `Local sources for ${context.shortLabel} did not yield a healthy feed set (${health}).`
      : qualified.length
        ? `Local sources serving ${context.shortLabel}; stories require geographic qualification.`
        : `Healthy local source set queried for ${context.shortLabel}; zero qualifying local stories.`

  return {
    context,
    coverage,
    coverageLevelsPresent: coverageLevelsPresent(matched),
    health,
    matchedSources: matched,
    sourceRuntime: runtime,
    mix,
    qualified,
    rejected,
    reason,
  }
}

export function localTypeStatus(
  report: TerraLocalIntelReport,
  types: TerraLocalSourceType[],
): 'ACTIVE' | 'PARTIAL' | 'NO_COVERAGE' {
  const rows = report.sourceRuntime.filter(row => types.includes(row.source.type))
  if (!rows.length) return 'NO_COVERAGE'
  const live = rows.filter(row => row.health === 'ACTIVE' || row.health === 'STALE')
  if (live.length && live.length === rows.length) return 'ACTIVE'
  if (live.length) return 'PARTIAL'
  return 'NO_COVERAGE'
}
