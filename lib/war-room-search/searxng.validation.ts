import { pathToFileURL } from 'node:url'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from './discoveryProvider'
import { formatSearchResult } from './formatSearchResult'
import { collapseToClusterHeads, rankSearchResults } from './rankResults'
import { normalizeSearchRequest } from './searchQuery'
import { federatedSearch } from './federatedSearch'
import { buildSearchHandoffEvidencePacket } from './councilHandoff'
import {
  classifySearxngError,
  collapseSearxngHitsByCanonicalUrl,
  mapSearxngResults,
  readSearxngConfig,
  runSearxngSearch,
  searxngConfigured,
  searxngTimeRangeFromDate,
  validateSearxngBaseUrl,
} from './providers/searxng'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const NOW = '2026-09-08T18:00:00.000Z'

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: 'fixture',
    source_type: 'search',
    source_label: overrides.source_label ?? 'Fixture',
    verified_level: 'semi_verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: NOW,
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'recent',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export async function runSearxngValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  cases.push(check('cfg_01_not_configured', searxngConfigured({}) === false, 'false'))
  cases.push(check('cfg_02_invalid_scheme', validateSearxngBaseUrl('file:///etc/passwd').ok === false, 'rejected'))
  cases.push(check('cfg_03_metadata_blocked', validateSearxngBaseUrl('http://169.254.169.254/').ok === false, 'rejected'))
  cases.push(check('cfg_04_userinfo_blocked', validateSearxngBaseUrl('https://user:secret@search.example.internal/').ok === false, 'rejected'))
  cases.push(check('cfg_05_lan_http_allowed', validateSearxngBaseUrl('http://127.0.0.1:8888/').ok === true, 'lan'))
  cases.push(check('cfg_06_https_internal_allowed', validateSearxngBaseUrl('https://search.example.internal').ok === true, 'internal'))
  cases.push(check('cfg_06b_public_http_rejected', validateSearxngBaseUrl('http://example.com').ok === false, 'https-required'))
  const cfg = readSearxngConfig({ SEARXNG_BASE_URL: 'https://search.example.internal' })
  cases.push(check(
    'cfg_07_search_path_pinned',
    Boolean(cfg?.searchUrl.endsWith('/search') && cfg.baseUrl === 'https://search.example.internal'),
    cfg?.searchUrl ?? 'none',
  ))

  let fetchCalls = 0
  const blockedFetch: typeof fetch = async () => {
    fetchCalls += 1
    throw new Error('SearXNG fetch should not run without a base URL')
  }
  const missing = await runSearxngSearch('latest semiconductor supply chain developments', {
    env: {},
    fetchImpl: blockedFetch,
  })
  cases.push(check('ncfg_01_no_fetch', fetchCalls === 0 && !missing.ok && missing.results.length === 0, `calls=${fetchCalls}`))
  cases.push(check('ncfg_02_code', missing.warningCode === 'SEARXNG_NOT_CONFIGURED', String(missing.warningCode)))

  const mapped = mapSearxngResults({
    results: [
      {
        title: 'Chip export controls widen',
        url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=brave',
        content: 'Reuters — governments expand semiconductor export rules in East Asia.',
        engine: 'brave',
        engines: ['brave'],
        score: 1.2,
        category: 'news',
        publishedDate: '2026-09-01T00:00:00.000Z',
      },
      {
        title: 'Chip export controls widen',
        url: 'https://www.reuters.com/world/asia/chip-export-2026',
        content: 'Reuters — governments expand semiconductor export rules in East Asia.',
        engine: 'duckduckgo',
        engines: ['duckduckgo', 'brave'],
      },
      { title: 'No URL', content: 'should drop' },
      { title: 'Bad scheme', url: 'javascript:alert(1)', content: 'should drop' },
    ],
  })
  cases.push(check('map_01_real_urls', mapped.length === 2 && mapped.every(item => /^https?:\/\//.test(item.url)), mapped.map(item => item.url).join(' | ')))
  cases.push(check('map_02_upstream_engine', mapped[0]?.upstreamEngines.includes('brave') === true, JSON.stringify(mapped[0]?.upstreamEngines)))
  cases.push(check('map_03_published_only_if_supplied', mapped[0]?.publishedAt === '2026-09-01T00:00:00.000Z' && mapped[1]?.publishedAt === null, `${mapped[0]?.publishedAt}/${mapped[1]?.publishedAt}`))

  const collapsedHits = collapseSearxngHitsByCanonicalUrl(mapped)
  cases.push(check('dedupe_01_same_url_one_hit', collapsedHits.length === 1, `count=${collapsedHits.length}`))
  cases.push(check(
    'dedupe_02_engines_merged',
    Boolean(collapsedHits[0]?.upstreamEngines.includes('brave') && collapsedHits[0]?.upstreamEngines.includes('duckduckgo')),
    JSON.stringify(collapsedHits[0]?.upstreamEngines),
  ))

  const annotated = annotateEvidenceIndependence(stampDiscoveryProvenance([
    evidence({
      id: 's-reuters',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.reuters.com/world/asia/chip-export-2026',
      source_id: 'searxng',
      source_label: 'SearXNG',
      discovered_via: 'SEARXNG',
      upstream_engines: ['brave', 'duckduckgo'],
    }),
    evidence({
      id: 't-reuters',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=tavily',
      source_id: 'tavily',
      source_label: 'Tavily Search',
      discovered_via: 'TAVILY',
    }),
    evidence({
      id: 'g-reuters',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=google',
      source_id: 'google_web_search',
      source_label: 'Google Web Search',
      discovered_via: 'GOOGLE',
    }),
    evidence({
      id: 'fr-1',
      title: 'Brokerage rule change',
      content: 'FMCSA updates freight brokerage regulations this week.',
      url: 'https://www.federalregister.gov/documents/2026/09/01/broker',
      source_id: 'federal_register',
      source_label: 'Federal Register',
      discovered_via: 'RESEARCH_ENGINE',
      source_type: 'government_public_data',
    }),
  ]), { region: 'NORTH_AMERICA', queryLanguage: 'en' })
  const clustered = clusterIndependentEvidence(annotated)
  const reutersFamily = clustered.items.filter(item => item.source_family === 'reuters')
  const searxngAsFamily = clustered.items.some(item => item.source_family === 'searxng')
  cases.push(check(
    'indep_01_searxng_not_publisher',
    !searxngAsFamily && reutersFamily.length > 0,
    clustered.items.map(item => `${item.id}:${item.source_family}:${item.discovered_via}`).join(' | '),
  ))
  cases.push(check(
    'indep_02_engines_preserved',
    JSON.stringify(clustered.items.find(item => item.id === 's-reuters')?.upstream_engines) === JSON.stringify(['brave', 'duckduckgo']),
    JSON.stringify(clustered.items.find(item => item.id === 's-reuters')?.upstream_engines),
  ))

  const collapsed = collapseToClusterHeads(clustered.items)
  const reutersHeads = collapsed.heads.filter(item => (item.canonical_url ?? item.url ?? '').includes('reuters.com'))
  cases.push(check('dedupe_03_cross_provider_one_head', reutersHeads.length === 1, `heads=${reutersHeads.map(item => item.id).join(',')}`))
  const reutersHead = reutersHeads[0]
  const alsoVia = new Set(reutersHead?.also_discovered_via ?? [])
  const allVia = new Set([reutersHead?.discovered_via, ...alsoVia].filter(Boolean))
  cases.push(check(
    'prov_01_multi_discovery_preserved',
    allVia.has('SEARXNG') && allVia.has('TAVILY') && allVia.has('GOOGLE'),
    JSON.stringify({ discovered: reutersHead?.discovered_via, also: reutersHead?.also_discovered_via, engines: reutersHead?.upstream_engines }),
  ))
  cases.push(check(
    'indep_03_one_independence_key',
    new Set(reutersFamily.map(item => item.independence_key)).size === 1,
    [...new Set(reutersFamily.map(item => item.independence_key))].join(' | '),
  ))

  const ranked = rankSearchResults('semiconductor export', clustered.items, normalizeSearchRequest({
    query: 'semiconductor export',
    options: { sort: 'RELEVANCE', limit: 4 },
  }))
  cases.push(check('limit_01_respects_war_room_limit', ranked.length <= 4, String(ranked.length)))
  cases.push(check('rank_01_format_has_engines', ranked.some(item => (item.upstreamEngines ?? []).includes('brave')), JSON.stringify(ranked[0]?.upstreamEngines)))

  let capturedUrl = ''
  const captureFetch: typeof fetch = async (input) => {
    capturedUrl = String(input)
    return jsonResponse(200, {
      results: [
        { title: 'Hit A', url: 'https://example.org/a', content: 'ok', engine: 'brave', engines: ['brave'] },
        { title: 'Hit B', url: 'https://example.org/b', content: 'ok', engine: 'google', engines: ['google'] },
        { title: 'Hit C', url: 'https://example.org/c', content: 'ok', engine: 'duckduckgo' },
        { title: 'Hit D', url: 'https://example.org/d', content: 'ok', engine: 'bing' },
        { title: 'Hit E', url: 'https://example.org/e', content: 'ok', engine: 'qwant' },
        { title: 'Hit F', url: 'https://example.org/f', content: 'ok', engine: 'wikipedia' },
      ],
    })
  }
  const ok = await runSearxngSearch('semiconductor policy', {
    env: { SEARXNG_BASE_URL: 'https://search.example.internal' },
    fetchImpl: captureFetch,
    pageSize: 3,
    language: 'ja',
    timeRange: 'week',
    safeSearch: true,
  })
  cases.push(check('req_01_host_pinned', /^https:\/\/search\.example\.internal\/search\?/.test(capturedUrl), capturedUrl))
  cases.push(check(
    'req_02_filters_mapped',
    /[?&]q=semiconductor/i.test(capturedUrl) && /format=json/.test(capturedUrl) && /language=ja/.test(capturedUrl) && /time_range=week/.test(capturedUrl) && /safesearch=1/.test(capturedUrl),
    capturedUrl,
  ))
  cases.push(check('req_03_query_cannot_change_host', !capturedUrl.includes('169.254.169.254'), capturedUrl))
  cases.push(check('limit_02_adapter_trims', ok.ok && ok.results.length === 3 && ok.rawCount === 6, `raw=${ok.rawCount} out=${ok.results.length}`))
  cases.push(check('obs_01_engines_observed', ok.enginesObserved.includes('brave') && ok.enginesObserved.includes('google'), ok.enginesObserved.join(',')))

  const recentFrom = new Date(Date.now() - 3 * 86_400_000).toISOString()
  cases.push(check('filter_01_time_range', searxngTimeRangeFromDate(recentFrom) === 'week', String(searxngTimeRangeFromDate(recentFrom))))

  const authFetch: typeof fetch = async () => jsonResponse(401, { message: 'Bearer super-secret-token denied' })
  const auth = await runSearxngSearch('q', {
    env: {
      SEARXNG_BASE_URL: 'https://search.example.internal',
      SEARXNG_AUTH_HEADER: 'Authorization',
      SEARXNG_AUTH_VALUE: 'Bearer super-secret-token',
    },
    fetchImpl: authFetch,
  })
  cases.push(check('err_01_auth', auth.warningCode === 'SEARXNG_AUTH_REQUIRED' && !auth.ok, String(auth.warningCode)))
  cases.push(check('err_02_no_secret', !/super-secret-token|Bearer super-secret/.test(JSON.stringify(auth)), JSON.stringify(auth)))

  const malformed = await runSearxngSearch('q', {
    env: { SEARXNG_BASE_URL: 'https://search.example.internal' },
    fetchImpl: async () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  })
  cases.push(check('err_03_malformed', malformed.warningCode === 'SEARXNG_INVALID_RESPONSE' && malformed.results.length === 0, String(malformed.warningCode)))

  const timeoutCode = classifySearxngError({ timeout: true })
  const rate = classifySearxngError({ status: 429, message: 'too many requests' })
  cases.push(check('err_04_timeout_rate', timeoutCode === 'SEARXNG_TIMEOUT' && rate === 'SEARXNG_RATE_LIMITED', `${timeoutCode}/${rate}`))

  const timeoutFetch: typeof fetch = async () => {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    throw err
  }
  const timed = await runSearxngSearch('q', {
    env: { SEARXNG_BASE_URL: 'https://search.example.internal' },
    fetchImpl: timeoutFetch,
  })
  cases.push(check('err_05_timeout_leg', timed.warningCode === 'SEARXNG_TIMEOUT' && !timed.ok, String(timed.warningCode)))

  const hijackQuery = 'http://169.254.169.254/latest/meta-data/'
  let hijackUrl = ''
  const hijackFetch: typeof fetch = async (input) => {
    hijackUrl = String(input)
    return jsonResponse(200, { results: [] })
  }
  await runSearxngSearch(hijackQuery, {
    env: { SEARXNG_BASE_URL: 'https://search.example.internal' },
    fetchImpl: hijackFetch,
  })
  const hijackHost = (() => { try { return new URL(hijackUrl).host } catch { return 'parse-failed' } })()
  cases.push(check('ssrf_01_query_cannot_retarget', hijackHost === 'search.example.internal', hijackHost))

  const aborted = new AbortController()
  aborted.abort()
  const abortResult = await federatedSearch({ query: 'should not fetch' }, { signal: aborted.signal })
  cases.push(check(
    'iso_01_federated_survives_without_searxng',
    abortResult.aborted && abortResult.resultCount === 0 && abortResult.sourceSummary.searxngOk === false && abortResult.sourceSummary.googleOk === false,
    JSON.stringify({ aborted: abortResult.aborted, searxngOk: abortResult.sourceSummary.searxngOk, googleOk: abortResult.sourceSummary.googleOk }),
  ))

  const sample = formatSearchResult({
    item: clustered.items.find(item => item.id === 's-reuters') ?? clustered.items[0]!,
    score: 0.5,
    rankBreakdown: { relevance: 0.5, authority: 0.55, freshness: 0.8, primary: 0.15, independence: 1, regional: 0.4, duplicatePenalty: 0 },
  })
  const blob = JSON.stringify(sample)
  cases.push(check('privacy_01_no_auth', !/SEARXNG_AUTH_VALUE|super-secret-token|Bearer /i.test(blob), 'clean'))

  const packet = buildSearchHandoffEvidencePacket({ query: 'chips', results: ranked })
  cases.push(check(
    'handoff_01_no_authority_bypass',
    packet.honestyNotes?.some(note => /SearXNG is a federated discovery provider/i.test(note)) === true,
    JSON.stringify(packet.honestyNotes),
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runSearxngValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`SearXNG validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
