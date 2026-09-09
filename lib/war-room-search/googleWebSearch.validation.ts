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
  classifyGoogleWebSearchError,
  clientIpFromRequestHeaders,
  dateRestrictFromSearchRange,
  GOOGLE_WEB_SEARCH_ENDPOINT,
  GOOGLE_WEB_SEARCH_SERVICE,
  googleWebSearchConfigured,
  mapGoogleWebSearchResults,
  RETIRED_SITE_RESTRICTED_CUSTOM_SEARCH_PATH,
  runGoogleWebSearch,
  usesOfficialGoogleWebSearchEndpoint,
} from './providers/googleWebSearch'

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

export async function runGoogleWebSearchValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  cases.push(check(
    'endpoint_01_official_service',
    GOOGLE_WEB_SEARCH_ENDPOINT === 'https://websearchservice.googleapis.com/v1:search'
      && usesOfficialGoogleWebSearchEndpoint(GOOGLE_WEB_SEARCH_ENDPOINT),
    GOOGLE_WEB_SEARCH_ENDPOINT,
  ))
  cases.push(check(
    'endpoint_02_not_site_restricted_cse',
    !GOOGLE_WEB_SEARCH_ENDPOINT.includes(RETIRED_SITE_RESTRICTED_CUSTOM_SEARCH_PATH)
      && GOOGLE_WEB_SEARCH_SERVICE === 'websearchservice.googleapis.com'
      && !usesOfficialGoogleWebSearchEndpoint('https://www.googleapis.com/customsearch/v1/siterestrict'),
    RETIRED_SITE_RESTRICTED_CUSTOM_SEARCH_PATH,
  ))

  let fetchCalls = 0
  const blockedFetch: typeof fetch = async () => {
    fetchCalls += 1
    throw new Error('Google fetch should not run without credentials')
  }
  const missing = await runGoogleWebSearch('latest semiconductor supply chain developments', {
    env: {},
    fetchImpl: blockedFetch,
  })
  cases.push(check('creds_01_missing_no_fetch', fetchCalls === 0 && !missing.ok && missing.results.length === 0, `calls=${fetchCalls} ok=${missing.ok}`))
  cases.push(check('creds_02_unavailable_code', missing.warningCode === 'GOOGLE_UNAVAILABLE' && missing.error === 'GOOGLE_UNAVAILABLE', String(missing.warningCode)))
  cases.push(check('creds_03_configured_helper', googleWebSearchConfigured({}) === false, 'false'))

  const missingClient = await runGoogleWebSearch('q', {
    env: { GOOGLE_WEB_SEARCH_API_KEY: 'AIzaSy-test-not-real' },
    fetchImpl: blockedFetch,
  })
  cases.push(check('creds_04_key_without_client', missingClient.warningCode === 'GOOGLE_AUTH_REQUIRED' && fetchCalls === 0, String(missingClient.warningCode)))

  const mapped = mapGoogleWebSearchResults({
    results: [
      {
        title: 'Chip export controls widen',
        url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=google',
        snippet: 'Reuters — governments expand semiconductor export rules in East Asia.',
        displayUrl: 'www.reuters.com',
        languageCode: 'en',
      },
      {
        title: 'Brokerage rule change',
        link: 'https://www.federalregister.gov/documents/2026/09/01/broker',
        snippet: 'FMCSA updates freight brokerage regulations this week.',
        publishedTime: '2026-09-01T00:00:00.000Z',
      },
      { title: 'No URL', snippet: 'should drop' },
      { title: 'Google SERP', url: 'https://www.google.com/search?q=chips', snippet: 'should drop' },
    ],
  })
  cases.push(check('map_01_real_urls', mapped.length === 2 && mapped.every(item => /^https?:\/\//.test(item.url)), mapped.map(item => item.url).join(' | ')))
  cases.push(check('map_02_no_fabricated_date', mapped[0]?.publishedAt === null && mapped[1]?.publishedAt === '2026-09-01T00:00:00.000Z', `${mapped[0]?.publishedAt}/${mapped[1]?.publishedAt}`))
  cases.push(check('map_03_language_only_if_supplied', mapped[0]?.language === 'en' && mapped[1]?.language === null, `${mapped[0]?.language}/${mapped[1]?.language}`))
  cases.push(check('map_04_google_rank_is_signal_only', mapped[0]?.providerRank === 1 && mapped[1]?.providerRank === 2, String(mapped[0]?.providerRank)))

  const cseShape = mapGoogleWebSearchResults({
    items: [{ title: 'arXiv paper', link: 'https://arxiv.org/abs/2601.12345', snippet: 'Cycle life of NMC cells.', displayLink: 'arxiv.org' }],
  })
  cases.push(check('map_05_cse_items_shape', cseShape[0]?.url === 'https://arxiv.org/abs/2601.12345', cseShape[0]?.url ?? 'none'))

  const annotated = annotateEvidenceIndependence(stampDiscoveryProvenance([
    evidence({
      id: 'g-reuters',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.reuters.com/world/asia/chip-export-2026',
      source_id: 'google_web_search',
      source_label: 'Google Web Search',
      discovered_via: 'GOOGLE',
      discovery_rank: 1,
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
      id: 'fr-1',
      title: 'Brokerage rule change',
      content: 'FMCSA updates freight brokerage regulations this week.',
      url: 'https://www.federalregister.gov/documents/2026/09/01/broker',
      source_id: 'federal_register',
      source_label: 'Federal Register',
      discovered_via: 'RESEARCH_ENGINE',
      source_type: 'government_public_data',
    }),
    evidence({
      id: 'g-sec',
      title: 'Example 8-K filing',
      content: 'Corporate disclosure unrelated to a federal freight rule.',
      url: 'https://www.sec.gov/Archives/edgar/data/1/0001/8k.htm',
      source_id: 'google_web_search',
      source_label: 'sec.gov',
      discovered_via: 'GOOGLE',
      discovery_rank: 1,
    }),
  ]), { region: 'NORTH_AMERICA', queryLanguage: 'en' })
  const clustered = clusterIndependentEvidence(annotated)
  const reutersFamily = clustered.items.filter(item => item.source_family === 'reuters')
  const googleAsFamily = clustered.items.some(item => item.source_family === 'google' || item.source_family === 'google_web_search')
  cases.push(check('prov_01_google_not_publisher', !googleAsFamily && reutersFamily.length > 0, clustered.items.map(item => `${item.id}:${item.source_family}:${item.discovered_via}`).join(' | ')))
  cases.push(check(
    'prov_02_discovered_via_separate',
    clustered.items.find(item => item.id === 'g-reuters')?.discovered_via === 'GOOGLE'
      && clustered.items.find(item => item.id === 't-reuters')?.discovered_via === 'TAVILY'
      && clustered.items.find(item => item.id === 'g-reuters')?.source_family === 'reuters',
    JSON.stringify(clustered.items.find(item => item.id === 'g-reuters')),
  ))

  const collapsed = collapseToClusterHeads(clustered.items)
  const reutersHeads = collapsed.heads.filter(item => (item.canonical_url ?? item.url ?? '').includes('reuters.com'))
  cases.push(check('dedupe_01_google_tavily_same_page', reutersHeads.length === 1, `heads=${reutersHeads.map(item => item.id).join(',')}`))
  cases.push(check(
    'dedupe_02_sec_not_regulator',
    clustered.items.find(item => item.id === 'g-sec')?.source_authority_class === 'PRIMARY_CORPORATE',
    clustered.items.find(item => item.id === 'g-sec')?.source_authority_class ?? 'missing',
  ))

  const ranked = rankSearchResults('U.S. freight broker regulations', clustered.items, normalizeSearchRequest({
    query: 'U.S. freight broker regulations',
    options: { sort: 'RELEVANCE', limit: 12 },
  }))
  const frIndex = ranked.findIndex(item => /federalregister\.gov/i.test(item.url ?? ''))
  const googleSecIndex = ranked.findIndex(item => /sec\.gov/i.test(item.url ?? ''))
  cases.push(check(
    'rank_01_google_position_does_not_replace_war_room',
    frIndex !== -1 && (googleSecIndex === -1 || frIndex < googleSecIndex),
    ranked.map(item => `${item.id}:${item.score.toFixed(2)}:${item.authorityClass}:${item.discoveredVia}`).join(' | '),
  ))
  cases.push(check('rank_02_format_has_discovered_via', ranked.every(item => 'discoveredVia' in item), 'present'))

  const sample = formatSearchResult({
    item: clustered.items.find(item => item.id === 'g-reuters') ?? clustered.items[0]!,
    score: 0.5,
    rankBreakdown: { relevance: 0.5, authority: 0.55, freshness: 0.8, primary: 0.15, independence: 1, regional: 0.4, duplicatePenalty: 0 },
  })
  const blob = JSON.stringify(sample)
  cases.push(check('privacy_01_no_keys', !/GOOGLE_WEB_SEARCH_API_KEY|GOOGLE_WEB_SEARCH_CLIENT_ID|AIzaSy-test/i.test(blob), 'clean'))
  cases.push(check('privacy_02_no_user_ip_in_result', !/203\.0\.113\./.test(blob), 'clean'))

  const ip = clientIpFromRequestHeaders({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1', 'x-real-ip': '198.51.100.2' })
  cases.push(check('privacy_03_ip_from_request_only', ip === '203.0.113.10', String(ip)))
  cases.push(check('privacy_04_no_fabricated_ip', clientIpFromRequestHeaders({}) === null, 'null'))
  const recentFrom = new Date(Date.now() - 3 * 86_400_000).toISOString()
  cases.push(check('privacy_05_date_restrict_optional', dateRestrictFromSearchRange(recentFrom, null) === 'd7', String(dateRestrictFromSearchRange(recentFrom, null))))

  const authFetch: typeof fetch = async () => jsonResponse(403, { error: { status: 'PERMISSION_DENIED', message: 'API key AIzaSy-secret-value denied' } })
  const auth = await runGoogleWebSearch('q', {
    env: { GOOGLE_WEB_SEARCH_API_KEY: 'AIzaSy-secret-value', GOOGLE_WEB_SEARCH_CLIENT_ID: 'client-123' },
    fetchImpl: authFetch,
    userIp: '203.0.113.10',
  })
  cases.push(check('err_01_auth', auth.warningCode === 'GOOGLE_AUTH_REQUIRED' && !auth.ok, String(auth.warningCode)))
  cases.push(check('err_02_no_secret_in_error', !/AIzaSy-secret-value|client-123/.test(JSON.stringify(auth)), JSON.stringify(auth)))
  cases.push(check('err_03_ip_not_persisted_on_leg', !/203\.0\.113\.10/.test(JSON.stringify(auth)), JSON.stringify(auth)))

  const timeout = classifyGoogleWebSearchError({ timeout: true })
  const quota = classifyGoogleWebSearchError({ status: 429, message: 'RESOURCE_EXHAUSTED quota' })
  cases.push(check('err_04_timeout_quota', timeout === 'GOOGLE_TIMEOUT' && quota === 'GOOGLE_QUOTA', `${timeout}/${quota}`))

  let capturedUrl = ''
  const captureFetch: typeof fetch = async (input) => {
    capturedUrl = String(input)
    return jsonResponse(200, { results: [{ title: 'Hit', url: 'https://example.org/a', snippet: 'ok' }] })
  }
  const ok = await runGoogleWebSearch('semiconductor policy', {
    env: { GOOGLE_WEB_SEARCH_API_KEY: 'AIzaSy-test-not-real', GOOGLE_WEB_SEARCH_CLIENT_ID: 'client-123' },
    fetchImpl: captureFetch,
    pageSize: 8,
    safeSearch: true,
    languageCode: 'ja',
    regionCode: 'JP',
  })
  cases.push(check('req_01_official_url', usesOfficialGoogleWebSearchEndpoint(capturedUrl) && !capturedUrl.includes('siterestrict'), capturedUrl.split('?')[0] ?? capturedUrl))
  cases.push(check('req_02_query_params', /query=semiconductor/i.test(capturedUrl) && /regionCode=JP/.test(capturedUrl) && /languageCode=ja/.test(capturedUrl), capturedUrl.replace(/key=[^&]+/, 'key=[redacted]').replace(/clientId=[^&]+/, 'clientId=[redacted]')))
  cases.push(check('req_03_results', ok.ok && ok.results[0]?.url === 'https://example.org/a', JSON.stringify(ok.results)))

  const aborted = new AbortController()
  aborted.abort()
  const abortResult = await federatedSearch({ query: 'should not fetch' }, { signal: aborted.signal })
  cases.push(check('abort_01_federated_survives', abortResult.aborted && abortResult.resultCount === 0 && abortResult.sourceSummary.googleOk === false, JSON.stringify({ aborted: abortResult.aborted, googleOk: abortResult.sourceSummary.googleOk })))

  const packet = buildSearchHandoffEvidencePacket({ query: 'freight', results: ranked })
  cases.push(check(
    'handoff_01_structured',
    Boolean(packet.intelligencePacket?.evidence?.some(item => item.canonical_url && item.independence_key)),
    String(packet.intelligencePacket?.evidence?.length),
  ))
  cases.push(check(
    'handoff_02_no_google_bypass',
    packet.honestyNotes?.some(note => /discovered_via/i.test(note)) === true,
    JSON.stringify(packet.honestyNotes),
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runGoogleWebSearchValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Google Web Search validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
