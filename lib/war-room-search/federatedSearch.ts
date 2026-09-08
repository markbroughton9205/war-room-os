import { extractUsStateArea, fetchActiveWeatherAlerts, skippedWeatherAlertsLeg } from '@/lib/research/nwsAlerts'
import { buildRetrievalOrchestration, evaluateMandatoryLiveRetrieval } from '@/lib/intelligence/sources/retrievalOrchestrator'
import { hydrateLiveIntelligencePacket } from '@/lib/intelligence/sources/livePacketHydrator'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { tavilyWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import { classifyResearchDomain, matchedDomains } from '@/lib/research/researchDomainRouter'
import { runResearchEngineBridge, type ResearchEngineBridgeLeg } from '@/lib/research/researchEngineBridge'
import {
  fetchPublicNewsRss,
  type LiveResearchRouterResult,
  type PublicRssLeg,
  type TavilyLeg,
} from '@/lib/research/researchRouter'
import { rawIntelligenceFromRouter } from '@/lib/research/researchEvidence'
import {
  googleNewsLocaleForRegion,
  primaryProviderIdsForRegion,
  regionHasPrimaryPublicEndpoint,
  secondaryRssCategoriesForRegion,
} from '@/lib/research/sourceTerritories'
import type { PublicNewsCategory } from '@/lib/research/publicRssFeeds'
import { rankSearchResults } from './rankResults'
import { isSearchRequestEmpty, normalizeSearchRequest } from './searchQuery'
import type { FederatedSearchResponse, SearchRequest, SearchSourceSummary } from './types'

const SECRET_VALUE = /(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/g

function categoriesForSearch(query: string): PublicNewsCategory[] {
  const cats = new Set<PublicNewsCategory>(['world', 'news'])
  if (/\b(tech|technology|ai|software|startup|space|nasa|science|semiconductor|battery)\b/i.test(query)) {
    cats.add('technology')
    cats.add('science')
    cats.add('startups')
  }
  if (/\b(market|econom|gdp|inflation|freight|logistics)\b/i.test(query)) {
    cats.add('markets')
    cats.add('economy')
  }
  if (/\bafrica\b/i.test(query)) cats.add('africa')
  if (/\beurope\b/i.test(query)) cats.add('europe')
  if (/\basia\b/i.test(query)) cats.add('asia')
  return [...cats]
}

function emptyRss(): PublicRssLeg {
  return { ok: false, results: [], durationMs: 0, error: 'not_started' }
}

function emptyTavily(): TavilyLeg {
  return { ok: false, results: [], durationMs: 0, error: 'not_started' }
}

async function runTavilyLeg(query: string): Promise<TavilyLeg> {
  const started = Date.now()
  try {
    const r = await tavilyWarRoomSearch(query, 8)
    const results = (r.results ?? [])
      .filter(x => x.title && x.url && /^https?:\/\//i.test(String(x.url)))
      .map(x => ({
        title: String(x.title),
        url: String(x.url),
        snippet: String(x.content ?? '').slice(0, 900),
      }))
    if (r.ok) return { ok: true, results, durationMs: r.durationMs || Date.now() - started }
    let err = 'tavily_failed'
    if ('error' in r && r.error) err = String(r.error)
    else if ('skipped' in r && r.skipped && 'reason' in r) err = String(r.reason)
    return { ok: false, results, error: err, durationMs: r.durationMs || Date.now() - started }
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

function sanitizeWarnings(warnings: string[]): string[] {
  return warnings
    .map(item => item.replace(SECRET_VALUE, '[redacted]'))
    .filter(Boolean)
    .slice(0, 12)
}

function abortedResponse(query: string, started: number, warnings: string[]): FederatedSearchResponse {
  return {
    query,
    tookMs: Date.now() - started,
    resultCount: 0,
    rawCount: 0,
    deduplicatedCount: 0,
    results: [],
    sourceSummary: {
      tavilyOk: false,
      researchEngineOk: false,
      researchEngineProviders: [],
      publicRssOk: false,
      primaryAttempted: [],
      primaryOk: false,
      genericRssUsedAsFallback: false,
    },
    fallbackUsed: false,
    warnings: sanitizeWarnings(warnings),
    aborted: true,
    timedOut: false,
    profile: 'STANDARD_RESEARCH',
  }
}

export async function federatedSearch(
  input: SearchRequest,
  opts?: { signal?: AbortSignal },
): Promise<FederatedSearchResponse> {
  const started = Date.now()
  const request = normalizeSearchRequest(input)
  if (isSearchRequestEmpty(request.query)) {
    return {
      query: '',
      tookMs: Date.now() - started,
      resultCount: 0,
      rawCount: 0,
      deduplicatedCount: 0,
      results: [],
      sourceSummary: {
        tavilyOk: false,
        researchEngineOk: false,
        researchEngineProviders: [],
        publicRssOk: false,
        primaryAttempted: [],
        primaryOk: false,
        genericRssUsedAsFallback: false,
      },
      fallbackUsed: false,
      warnings: ['Query is required.'],
      aborted: false,
      timedOut: false,
      profile: 'STANDARD_RESEARCH',
    }
  }

  const signal = opts?.signal
  if (signal?.aborted) return abortedResponse(request.query, started, ['Search aborted before retrieval started.'])

  const generatedAt = new Date().toISOString()
  const domain = classifyResearchDomain(request.query)
  const extraProviderIds = request.region ? primaryProviderIdsForRegion(request.region) : []
  const locale = googleNewsLocaleForRegion(request.region)
  const queryLanguage = request.language ?? locale.queryLanguage
  const regionalCategories = request.region
    ? [...new Set([...secondaryRssCategoriesForRegion(request.region), ...categoriesForSearch(request.query)])]
    : categoriesForSearch(request.query)
  const wantsWeather = evaluateMandatoryLiveRetrieval(request.query).reasons.includes('weather')

  let tavily: TavilyLeg = emptyTavily()
  let publicRss: PublicRssLeg = emptyRss()
  const emptyEngine = (): ResearchEngineBridgeLeg => ({
    domain,
    attempted: false,
    providerIds: [],
    results: [],
    documents: [],
    ok: false,
  })
  let researchEngine: ResearchEngineBridgeLeg = emptyEngine()

  // Retrieval-heavy only — Grok framing, Gemini synthesis, and Council seats are not invoked.
  const tavilyBox: { value?: TavilyLeg } = {}
  const rssBox: { value?: PublicRssLeg } = {}
  const engineBox: { value?: ResearchEngineBridgeLeg } = {}

  const tavilyP = runTavilyLeg(request.query).then(value => { tavilyBox.value = value; return value })
  const engineP = runResearchEngineBridge({
    queryText: request.query,
    domain,
    matchedDomains: domain === 'HYBRID' ? matchedDomains(request.query) : [],
    extraProviderIds: extraProviderIds.slice(0, 4),
  }).then(value => { engineBox.value = value; return value }, (): ResearchEngineBridgeLeg => {
    const failed: ResearchEngineBridgeLeg = {
      domain,
      attempted: true,
      providerIds: extraProviderIds.slice(0, 4),
      results: [],
      documents: [],
      ok: false,
    }
    engineBox.value = failed
    return failed
  })
  const rssP = fetchPublicNewsRss(request.query, regionalCategories, {
    region: request.region,
    includeGenericGlobal: !request.region,
  }).then(value => { rssBox.value = value; return value }, error => {
    const failed: PublicRssLeg = { ok: false, results: [], durationMs: 0, error: error instanceof Error ? error.message : String(error) }
    rssBox.value = failed
    return failed
  })

  const weatherP = wantsWeather
    ? fetchActiveWeatherAlerts({ areaState: extractUsStateArea(request.query) })
    : Promise.resolve(skippedWeatherAlertsLeg())

  let timedOut = false
  let aborted = false
  const timeout = new Promise<'timeout'>(resolve => {
    setTimeout(() => resolve('timeout'), request.timeoutMs)
  })
  const abortWatch = signal
    ? new Promise<'aborted'>(resolve => {
      if (signal.aborted) resolve('aborted')
      else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    })
    : new Promise<'aborted'>(() => undefined)

  const settled = await Promise.race([
    Promise.allSettled([tavilyP, engineP, rssP, weatherP]).then(() => 'complete' as const),
    timeout,
    abortWatch,
  ])

  if (settled === 'aborted') {
    aborted = true
    if (!tavilyBox.value && !engineBox.value && !rssBox.value) {
      return abortedResponse(request.query, started, ['Search aborted; no stale results published.'])
    }
  }
  if (settled === 'timeout') timedOut = true

  tavily = tavilyBox.value ?? emptyTavily()
  publicRss = rssBox.value ?? emptyRss()
  researchEngine = engineBox.value ?? emptyEngine()
  const weatherAlerts = settled === 'complete'
    ? await weatherP.catch(() => skippedWeatherAlertsLeg())
    : skippedWeatherAlertsLeg()

  let genericRssUsedAsFallback = false
  let fallbackReason: string | undefined
  const primaryAttempted = researchEngine.providerIds
  const primaryOk = researchEngine.ok
  const primaryLiveAvailable = request.region ? regionHasPrimaryPublicEndpoint(request.region) : researchEngine.attempted

  if (request.region && !primaryOk && !publicRss.ok && !signal?.aborted) {
    const generic = await fetchPublicNewsRss(request.query, ['world', 'news'], { includeGenericGlobal: true }).catch((): PublicRssLeg => ({
      ok: false, results: [], durationMs: 0, error: 'generic_rss_failed',
    }))
    if (generic.ok) {
      publicRss = generic
      genericRssUsedAsFallback = true
      fallbackReason = primaryLiveAvailable
        ? 'Regional primary/public sources returned no documents; generic global RSS used as fallback only.'
        : 'No supported regional-primary public endpoint succeeded; generic global RSS used as fallback. Do not claim regional-primary coverage.'
    } else if (!primaryLiveAvailable) {
      fallbackReason = 'No supported regional-primary public endpoint is live for this territory; generic RSS also empty.'
    } else {
      fallbackReason = 'Regional primary sources were attempted and failed; generic RSS also empty.'
    }
  } else if (request.region && !primaryOk && publicRss.ok) {
    fallbackReason = primaryLiveAvailable
      ? 'Regional primary/public adapters returned no documents; region-specific secondary RSS used.'
      : 'No live regional-primary adapter succeeded; region-specific secondary sources used. Do not claim primary coverage.'
  }

  if (signal?.aborted && !tavily.ok && !researchEngine.ok && !publicRss.ok) {
    return abortedResponse(request.query, started, ['Search aborted; no stale results published.'])
  }

  const router: LiveResearchRouterResult = {
    generatedAt,
    searchQuery: request.query,
    tavily,
    publicRss,
    weatherAlerts,
    grok: { ok: false, text: '' },
    direct: [],
    retrieval: buildRetrievalOrchestration({
      decree: request.query,
      generatedAt,
      tavilyOk: (tavily.ok && tavily.results.length > 0) || publicRss.ok || researchEngine.ok,
      tavilyLatencyMs: Math.min(tavily.durationMs || request.timeoutMs, publicRss.durationMs || request.timeoutMs),
      tavilyError: tavily.ok || publicRss.ok ? undefined : [tavily.error, publicRss.error].filter(Boolean).join(' | '),
      grokOk: false,
      grokError: undefined,
      directOk: false,
    }),
    researchEngine,
    regionalRouting: {
      region: request.region,
      queryLanguage,
      primaryAttempted,
      primaryOk,
      primaryLiveAvailable,
      secondaryAttempted: request.region ? [`google_news:${locale.gl}`, ...regionalCategories] : ['trusted_rss', 'google_news:US'],
      genericRssUsedAsFallback,
      genericRssWasSoleSource: Boolean(request.region) && genericRssUsedAsFallback && !primaryOk && !tavily.ok,
      fallbackReason,
      nativeLanguageRetrieval: Boolean(
        request.region
        && queryLanguage !== 'en'
        && (researchEngine.documents.some(doc => (doc.language ?? '').toLowerCase().startsWith(queryLanguage))
          || publicRss.results.some(item => /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff]/.test(`${item.title} ${item.snippet}`))),
      ),
      googleNewsLocale: `${locale.hl}/${locale.gl}/${locale.ceid}`,
    },
  }

  const intelligencePacket = hydrateLiveIntelligencePacket({
    decree: request.query,
    timestamp: generatedAt,
    rawSources: rawIntelligenceFromRouter(router),
    unsupportedClaims: [],
    retrieval: router.retrieval,
  })
  const { items } = clusterIndependentEvidence(annotateEvidenceIndependence(intelligencePacket.evidence, {
    region: request.region ?? null,
    queryLanguage,
    fallbackUsed: genericRssUsedAsFallback,
    fallbackReason: fallbackReason ?? null,
  }))
  intelligencePacket.evidence = items

  const ranked = rankSearchResults(request.query, items, request)
  const visible = ranked.slice(0, request.limit)

  const warnings: string[] = []
  if (!tavily.ok && tavily.error) warnings.push(`Web search unavailable: ${tavily.error}`)
  if (researchEngine.attempted && !researchEngine.ok) {
    const engineErrors = researchEngine.results.map(r => r.error).filter(Boolean)
    if (engineErrors.length) warnings.push(`Primary adapters: ${engineErrors.slice(0, 3).join(' | ')}`)
    else warnings.push('Primary research adapters returned no documents.')
  }
  if (!publicRss.ok && publicRss.error) warnings.push(`RSS fallback: ${publicRss.error}`)
  if (fallbackReason) warnings.push(fallbackReason)
  if (timedOut) warnings.push('Search timed out; returning partial results that had already arrived.')
  if (aborted) warnings.push('Search aborted after partial retrieval.')
  if (!visible.length) warnings.push('No live results matched this query.')

  const sourceSummary: SearchSourceSummary = {
    tavilyOk: tavily.ok && tavily.results.length > 0,
    researchEngineOk: researchEngine.ok,
    researchEngineProviders: researchEngine.providerIds,
    publicRssOk: publicRss.ok,
    region: request.region,
    primaryAttempted,
    primaryOk,
    genericRssUsedAsFallback,
    fallbackReason,
  }

  return {
    query: request.query,
    tookMs: Date.now() - started,
    resultCount: visible.length,
    rawCount: items.length,
    deduplicatedCount: ranked.length,
    results: visible,
    sourceSummary,
    fallbackUsed: genericRssUsedAsFallback,
    warnings: sanitizeWarnings([...new Set(warnings)]),
    aborted,
    timedOut,
    profile: 'STANDARD_RESEARCH',
  }
}
