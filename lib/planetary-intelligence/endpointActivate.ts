import { sourceAndEndpointAreDistinct } from './registryVerify'
import { sourceMatchesGap } from './registryCoverage'
import { classifyFetchedBody, discoverFeedsFromHtml, homepage200IsNotLiveContent, decodeFetchedBytes } from './endpointDiscover'
import { ingestItems } from './documentIngest'
import { recommendedPollInterval } from './registryPoll'
import type { PlanetaryRegistryStore } from './registryStore'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'
import { WAVE2_ACTIVATION_CAP, WAVE2_DOCS_PER_ENDPOINT } from './registryTypes'
import type { RetrievedDocument } from './types'

function nativeIngestQuery(source: RegistrySource): string {
  if (source.primaryLanguage === 'ja') return `${source.canonicalName} 日本語の一次情報 現地報道 今日`
  if (source.primaryLanguage === 'sw') return `${source.canonicalName} habari asili kwa Kiswahili leo`
  if (source.primaryLanguage === 'id') return `${source.canonicalName} sumber berbahasa Indonesia hari ini`
  if (source.primaryLanguage === 'ar') return `${source.canonicalName} مصادر محلية أصلية اليوم`
  if (source.primaryLanguage === 'de') return `${source.canonicalName} unabhängige deutsche quelle heute`
  if (source.primaryLanguage === 'hi') return `${source.canonicalName} स्वतंत्र हिंदी स्रोत आज`
  if (source.primaryLanguage === 'es') return `${source.canonicalName} fuentes locales español hoy`
  return `${source.canonicalName} independently originated coverage today`
}

const GAP_KEYS = ['ja-infra', 'sw-health', 'id-infra', 'ar-safety', 'de-energy', 'es-science', 'hi-econ', 'oceania-weather'] as const

export type Wave2Fetch = (url: string, extra?: { etag?: string | null; lastModified?: string | null }) => Promise<{
  httpStatus: number | null
  contentType: string | null
  body: string
  etag: string | null
  lastModified: string | null
  latencyMs: number
  errorClass: string | null
}>

export function scoreActivationCandidate(source: RegistrySource, endpoints: RegistryEndpoint[]): number {
  let score = 0
  for (const key of GAP_KEYS) if (sourceMatchesGap(source, key)) score += 80
  if (source.gapPriority) score += 20
  if (source.localityClass === 'CITY_LOCAL' || source.localityClass === 'REGIONAL' || source.localityClass === 'HYPERLOCAL') score += 40
  if (source.sourceRole === 'OFFICIAL' || source.sourceRole === 'SCIENTIFIC' || source.sourceRole === 'WEATHER' || source.sourceRole === 'PUBLIC_SAFETY') score += 30
  if (endpoints.some(item => item.sourceId === source.sourceId && item.endpointType !== 'HTML')) score += 25
  if (source.status === 'LIVE') score += 10
  return score
}

export function selectActivationCandidates(sources: RegistrySource[], endpoints: RegistryEndpoint[], cap = WAVE2_ACTIVATION_CAP): RegistrySource[] {
  return [...sources]
    .map(source => ({ source, score: scoreActivationCandidate(source, endpoints) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(row => row.source)
}

export function hyperlocalRequiresProof(source: Pick<RegistrySource, 'localityClass' | 'cityLocality' | 'coverageGeometry'>): boolean {
  if (source.localityClass !== 'HYPERLOCAL') return true
  return Boolean(source.coverageGeometry) && Boolean(source.cityLocality)
}

export async function defaultWave2Fetch(url: string, extra?: { etag?: string | null; lastModified?: string | null }): Promise<{
  httpStatus: number | null
  contentType: string | null
  body: string
  etag: string | null
  lastModified: string | null
  latencyMs: number
  errorClass: string | null
}> {
  const started = Date.now()
  try {
    const headers: Record<string, string> = {
      'user-agent': 'WarRoomPlanetaryRegistry/3.0 (bounded activation; metadata only)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/geo+json, application/json, text/html;q=0.8',
    }
    if (extra?.etag) headers['if-none-match'] = extra.etag
    if (extra?.lastModified) headers['if-modified-since'] = extra.lastModified
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8_000), redirect: 'follow' })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type')
    const body = decodeFetchedBytes(bytes, contentType).slice(0, 1_500_000)
    return {
      httpStatus: response.status,
      contentType,
      body,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      latencyMs: Date.now() - started,
      errorClass: response.status >= 400 ? `HTTP_${response.status}` : null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      httpStatus: null,
      contentType: null,
      body: '',
      etag: extra?.etag ?? null,
      lastModified: extra?.lastModified ?? null,
      latencyMs: Date.now() - started,
      errorClass: /timeout/i.test(message) ? 'TIMEOUT' : 'CONNECTION',
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function activateSources(input: {
  store: PlanetaryRegistryStore
  sources: RegistrySource[]
  fetchImpl: Wave2Fetch
  missionId: string
  nowIso: string
  docsPerEndpoint?: number
  spacingMs?: number
}): Promise<{
  discovered: number
  live: number
  rss: number
  atom: number
  sitemap: number
  api: number
  htmlOnly: number
  noMachine: number
  failures: number
  documents: RetrievedDocument[]
  inserted: number
  duplicates: number
}> {
  const docsPerEndpoint = input.docsPerEndpoint ?? WAVE2_DOCS_PER_ENDPOINT
  let discovered = 0
  let live = 0
  let rss = 0
  let atom = 0
  let sitemap = 0
  let api = 0
  let htmlOnly = 0
  let noMachine = 0
  let failures = 0
  let inserted = 0
  let duplicates = 0
  const documents: RetrievedDocument[] = []
  const existing = input.store.listEndpoints()

  for (const source of input.sources) {
    if (source.localityClass === 'HYPERLOCAL' && !hyperlocalRequiresProof(source)) continue
    const current = existing.filter(item => item.sourceId === source.sourceId)
    const machine = current.filter(item => item.endpointType !== 'HTML')
    let targets: Array<{ url: string; endpoint: RegistryEndpoint | null; typeHint?: string }> = machine.map(item => ({ url: item.url, endpoint: item }))
    if (!targets.length) {
      const homepage = current.find(item => item.endpointType === 'HTML')
      const fetched = await input.fetchImpl(source.homepage, { etag: homepage?.etag, lastModified: homepage?.lastModified })
      const classified = classifyFetchedBody({ url: source.homepage, httpStatus: fetched.httpStatus, contentType: fetched.contentType, body: fetched.body })
      if (homepage200IsNotLiveContent(classified) && classified.activationState === 'HTML_ONLY') {
        htmlOnly += 1
        if (homepage) {
          input.store.upsertEndpoint({
            ...homepage,
            httpStatus: fetched.httpStatus,
            latencyMs: fetched.latencyMs,
            lastFetchAt: input.nowIso,
            activationState: 'HTML_ONLY',
            contentType: fetched.contentType,
            itemCount: 0,
          })
        }
      }
      const feeds = classified.activationState === 'DISCOVERED'
        ? classified.items.map(item => ({ url: item.url, endpoint: null, typeHint: item.title }))
        : discoverFeedsFromHtml(fetched.body, source.homepage).map(feed => ({ url: feed.url, endpoint: null, typeHint: feed.endpointType }))
      targets = feeds.filter(feed => sourceAndEndpointAreDistinct(source.homepage, feed.url))
      if (!targets.length && classified.activationState !== 'HTML_ONLY') noMachine += 1
      await delay(input.spacingMs ?? 250)
    }

    for (const target of targets.slice(0, 2)) {
      discovered += 1
      const fetched = await input.fetchImpl(target.url, { etag: target.endpoint?.etag, lastModified: target.endpoint?.lastModified })
      const classified = classifyFetchedBody({ url: target.url, httpStatus: fetched.httpStatus, contentType: fetched.contentType, body: fetched.body })
      const endpoint: RegistryEndpoint = target.endpoint ?? {
        endpointId: `ep-${source.sourceId}-${classified.endpointType.toLowerCase()}-${discovered}`,
        sourceId: source.sourceId,
        endpointType: classified.endpointType,
        url: target.url,
        status: classified.live ? 'OK' : fetched.httpStatus === 304 ? 'NOT_MODIFIED' : fetched.httpStatus === 429 ? 'RATE_LIMITED' : 'ERROR',
        lastFetchAt: input.nowIso,
        lastSuccessAt: classified.live ? input.nowIso : null,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        retryAfter: null,
        observedPublishCadenceSeconds: null,
        recommendedPollIntervalSeconds: recommendedPollInterval(source),
        errorClass: fetched.errorClass,
        consecutiveFailures: classified.live ? 0 : 1,
        httpStatus: fetched.httpStatus,
        latencyMs: fetched.latencyMs,
        activationState: classified.activationState,
        contentType: fetched.contentType,
        itemCount: classified.items.length,
      }
      const next: RegistryEndpoint = {
        ...endpoint,
        status: classified.live ? 'OK' : endpoint.status,
        lastFetchAt: input.nowIso,
        lastSuccessAt: classified.live ? input.nowIso : endpoint.lastSuccessAt,
        etag: fetched.etag ?? endpoint.etag,
        lastModified: fetched.lastModified ?? endpoint.lastModified,
        httpStatus: fetched.httpStatus,
        latencyMs: fetched.latencyMs,
        errorClass: fetched.errorClass,
        consecutiveFailures: classified.live ? 0 : endpoint.consecutiveFailures + 1,
        activationState: classified.activationState,
        contentType: fetched.contentType,
        itemCount: classified.items.length,
      }
      input.store.upsertEndpoint(next)
      if (classified.activationState === 'LIVE') {
        live += 1
        if (classified.endpointType === 'RSS') rss += 1
        if (classified.endpointType === 'ATOM') atom += 1
        if (classified.endpointType === 'SITEMAP' || classified.endpointType === 'NEWS_SITEMAP') sitemap += 1
        if (classified.endpointType === 'API' || classified.endpointType === 'PUBLIC_ALERT_FEED') api += 1
        const ingested = ingestItems({
          store: input.store,
          missionId: input.missionId,
          source,
          endpoint: next,
          items: classified.items,
          requestedLanguage: source.primaryLanguage,
          query: nativeIngestQuery(source),
          nowIso: input.nowIso,
          limit: docsPerEndpoint,
        })
        inserted += ingested.inserted
        duplicates += ingested.duplicates
        documents.push(...ingested.documents)
        if (classified.live) {
          input.store.upsertSource({ ...source, status: 'LIVE', lastHealthyAt: input.nowIso, lastVerifiedAt: input.nowIso })
        }
      } else if (classified.activationState === 'HTML_ONLY') htmlOnly += 1
      else if (classified.activationState === 'NO_MACHINE_ENDPOINT') noMachine += 1
      else failures += 1
      await delay(input.spacingMs ?? 250)
    }
  }

  return { discovered, live, rss, atom, sitemap, api, htmlOnly, noMachine, failures, documents, inserted, duplicates }
}
