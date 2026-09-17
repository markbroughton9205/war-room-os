import { TRUSTED_RSS_FEEDS } from '@/lib/research/publicRssFeeds'
import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { diagnoseSearxng } from './searxngDiagnostic'
import { searxngStartPolicy } from './searxngPolicy'
import { PlanetaryRegistryStore } from './registryStore'
import { applyHealthResult, persistVerifiedCandidate } from './registryVerify'
import { wave1Catalog } from './wave1Catalog'
import { buildRegistryCoverageFacts } from './registryCoverage'
import { WAVE1_CANDIDATE_CAP, type Wave1Candidate } from './registryTypes'
import { LOCAL_FILESYSTEM_FALLBACK } from './livePersistence'
import { resolvePlanetaryRegistryTarget } from './registryPaths'

export type HealthProbe = (url: string, extra?: { etag?: string | null; lastModified?: string | null }) => Promise<{
  httpStatus: number | null
  latencyMs: number | null
  etag: string | null
  lastModified: string | null
  errorClass: string | null
}>

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTrustedRss(candidates: Wave1Candidate[]): Wave1Candidate[] {
  return candidates.map(candidate => {
    if (candidate.endpointUrl) return candidate
    const host = hostnameFromUrl(candidate.homepage)?.replace(/^www\./, '')
    const feed = TRUSTED_RSS_FEEDS.find(item => hostnameFromUrl(item.url)?.replace(/^www\./, '') === host || hostnameFromUrl(item.url)?.endsWith(host || '---'))
    if (!feed) return candidate
    return { ...candidate, endpointUrl: feed.url, endpointType: 'RSS', discoveryMethod: `${candidate.discoveryMethod}+trusted_rss` }
  })
}

export async function discoverWikidataNewspapers(input: {
  fetchImpl?: typeof fetch
  remaining: number
}): Promise<Wave1Candidate[]> {
  if (input.remaining <= 0) return []
  const fetchImpl = input.fetchImpl
  if (!fetchImpl) return []
  const countries: Array<{ qid: string; country: string; geo: Wave1Candidate['region']; continent: string; lang: string }> = [
    { qid: 'Q17', country: 'Japan', geo: 'EAST_ASIA', continent: 'Asia', lang: 'ja' },
    { qid: 'Q252', country: 'Indonesia', geo: 'SOUTHEAST_ASIA', continent: 'Asia', lang: 'id' },
    { qid: 'Q114', country: 'Kenya', geo: 'EAST_AFRICA', continent: 'Africa', lang: 'sw' },
    { qid: 'Q155', country: 'Brazil', geo: 'LATIN_AMERICA', continent: 'Americas', lang: 'pt' },
    { qid: 'Q96', country: 'Mexico', geo: 'LATIN_AMERICA', continent: 'Americas', lang: 'es' },
    { qid: 'Q183', country: 'Germany', geo: 'EUROPE', continent: 'Europe', lang: 'de' },
    { qid: 'Q668', country: 'India', geo: 'SOUTH_ASIA', continent: 'Asia', lang: 'hi' },
    { qid: 'Q79', country: 'Egypt', geo: 'MIDDLE_EAST', continent: 'Middle East', lang: 'ar' },
  ]
  const out: Wave1Candidate[] = []
  for (const country of countries) {
    if (out.length >= input.remaining) break
    const sparql = `SELECT ?itemLabel ?url WHERE { ?item wdt:P31/wdt:P279* wd:Q11032 . ?item wdt:P17 wd:${country.qid} . ?item wdt:P856 ?url . SERVICE wikibase:label { bd:serviceParam wikibase:language "${country.lang},en". } } LIMIT 20`
    try {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`
      const response = await fetchImpl(url, {
        headers: { accept: 'application/sparql-results+json', 'user-agent': 'WarRoomPlanetaryRegistry/1.0 (local source discovery; metadata only)' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) continue
      await delay(250)
      const body = await response.json() as { results?: { bindings?: Array<{ itemLabel?: { value?: string }; url?: { value?: string } }> } }
      for (const row of body.results?.bindings ?? []) {
        const homepage = row.url?.value
        const name = row.itemLabel?.value
        if (!homepage || !name || !/^https?:\/\//i.test(homepage)) continue
        out.push({
          canonicalName: name,
          homepage,
          country: country.country,
          region: country.geo,
          continent: country.continent,
          localityClass: 'NATIONAL',
          sourceRole: 'NATIONAL',
          primaryLanguage: country.lang,
          supportedLanguages: [country.lang],
          sourceType: 'JOURNALISM',
          ownershipType: 'UNKNOWN',
          publisher: name,
          parentCompany: null,
          discoveryMethod: 'wikidata_sparql_newspaper',
          requestedDiscoveryLanguage: country.lang,
          actualQueryLanguage: country.lang,
          gapPriority: 'wikidata-enrichment',
        })
        if (out.length >= input.remaining) break
      }
    } catch {
      continue
    }
  }
  return out
}

export async function defaultHealthProbe(url: string, extra?: { etag?: string | null; lastModified?: string | null }): Promise<{
  httpStatus: number | null
  latencyMs: number | null
  etag: string | null
  lastModified: string | null
  errorClass: string | null
}> {
  const started = Date.now()
  try {
    const headers: Record<string, string> = { 'user-agent': 'WarRoomPlanetaryRegistry/1.0 (conditional GET; metadata only)' }
    if (extra?.etag) headers['if-none-match'] = extra.etag
    if (extra?.lastModified) headers['if-modified-since'] = extra.lastModified
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8_000), redirect: 'follow' })
    return {
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      errorClass: response.status >= 400 ? `HTTP_${response.status}` : null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      httpStatus: null,
      latencyMs: Date.now() - started,
      etag: extra?.etag ?? null,
      lastModified: extra?.lastModified ?? null,
      errorClass: /timeout/i.test(message) ? 'TIMEOUT' : /fetch failed|econnrefused/i.test(message) ? 'CONNECTION' : 'OTHER',
    }
  }
}

export async function runSourceFabricWave1(input: {
  rootDir?: string
  nowIso?: string
  health?: HealthProbe | null
  wikidata?: boolean
  healthLimit?: number
  skipSearxng?: boolean
}): Promise<{
  classification: 'PLANETARY_SOURCE_FABRIC_WAVE1_READY' | 'PLANETARY_SOURCE_FABRIC_WAVE1_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE1_BLOCKED'
  storePath: string
  candidatesDiscovered: number
  candidatesVerified: number
  duplicates: number
  rejected: number
  liveSources: number
  liveEndpoints: number
  statusBreakdown: Record<string, number>
  facts: ReturnType<typeof buildRegistryCoverageFacts>
  searxng: Awaited<ReturnType<typeof diagnoseSearxng>> & { startPolicy: ReturnType<typeof searxngStartPolicy> }
  persistence: ReturnType<typeof resolvePlanetaryRegistryTarget>
  missionFallback: typeof LOCAL_FILESYSTEM_FALLBACK
}> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const store = new PlanetaryRegistryStore(input.rootDir)
  const catalog = withTrustedRss(wave1Catalog())
  let extras: Wave1Candidate[] = []
  if (input.wikidata) {
    extras = await discoverWikidataNewspapers({ fetchImpl: fetch, remaining: Math.max(0, WAVE1_CANDIDATE_CAP - catalog.length) })
  }
  const discovered = [...catalog, ...extras].slice(0, WAVE1_CANDIDATE_CAP)
  let verified = 0
  let duplicates = 0
  let rejected = 0
  for (const candidate of discovered) {
    const result = persistVerifiedCandidate(store, candidate, nowIso)
    if (result.duplicate) duplicates += 1
    else if (result.accepted) verified += 1
    else rejected += 1
  }

  const healthLimit = input.healthLimit ?? 0
  const probe = input.health === null ? null : input.health ?? (healthLimit > 0 ? defaultHealthProbe : null)
  if (probe && healthLimit > 0) {
    const sources = store.listSources()
    const endpoints = store.listEndpoints().filter(item => item.endpointType !== 'HTML')
    const priority = [...sources].sort((a, b) => Number(Boolean(b.gapPriority)) - Number(Boolean(a.gapPriority)))
    let probed = 0
    for (const source of priority) {
      if (probed >= healthLimit) break
      const endpoint = endpoints.find(item => item.sourceId === source.sourceId)
      if (!endpoint) continue
      const health = await probe(endpoint.url, { etag: endpoint.etag, lastModified: endpoint.lastModified })
      applyHealthResult(store, source, endpoint, { ...health, nowIso })
      probed += 1
      await delay(250)
    }
  }

  const facts = buildRegistryCoverageFacts(store)
  const searxng = input.skipSearxng
    ? { configured: false, category: 'NOT_CONFIGURED' as const, label: 'SEARXNG_NOT_CONFIGURED', hostKind: 'missing' as const, statusCode: null, detail: 'skipped' }
    : await diagnoseSearxng()
  const counts = store.counts()
  const statusBreakdown: Record<string, number> = {}
  for (const source of store.listSources()) {
    statusBreakdown[source.status] = (statusBreakdown[source.status] ?? 0) + 1
  }
  store.close()
  let classification: 'PLANETARY_SOURCE_FABRIC_WAVE1_READY' | 'PLANETARY_SOURCE_FABRIC_WAVE1_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE1_BLOCKED' = 'PLANETARY_SOURCE_FABRIC_WAVE1_PARTIAL'
  if (verified >= 100 && counts.sources >= 100 && facts.continents.length >= 5 && facts.nativeLanguageSources >= 40) {
    classification = 'PLANETARY_SOURCE_FABRIC_WAVE1_READY'
  }
  if (verified < 20) classification = 'PLANETARY_SOURCE_FABRIC_WAVE1_BLOCKED'
  return {
    classification,
    storePath: store.dbPath,
    candidatesDiscovered: discovered.length,
    candidatesVerified: verified,
    duplicates,
    rejected,
    liveSources: counts.liveSources,
    liveEndpoints: counts.liveEndpoints,
    statusBreakdown,
    facts,
    searxng: { ...searxng, startPolicy: searxngStartPolicy() },
    persistence: resolvePlanetaryRegistryTarget(input.rootDir),
    missionFallback: LOCAL_FILESYSTEM_FALLBACK,
  }
}
