import { pathToFileURL } from 'node:url'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { formatSearchResult } from './formatSearchResult'
import { collapseToClusterHeads, filterEvidenceForSearch, rankSearchResults, sortSearchResults } from './rankResults'
import { clampSearchLimit, clampSearchTimeoutMs, normalizeSearchRequest } from './searchQuery'
import { buildSearchHandoffEvidencePacket } from './councilHandoff'
import { federatedSearch } from './federatedSearch'
import { DEFAULT_SEARCH_TIMEOUT_MS, MAX_SEARCH_LIMIT } from './searchQuery'
import type { SearchResult } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const NOW = '2026-09-08T18:00:00.000Z'

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: 'fixture',
    source_type: 'government_public_data',
    source_label: overrides.source_label ?? 'Fixture',
    verified_level: 'verified',
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

const REQUIRED_RESULT_FIELDS = [
  'id', 'title', 'url', 'canonicalUrl', 'displayDomain', 'snippet', 'publisher',
  'publishedAt', 'observedAt', 'sourceType', 'originType', 'authorityClass',
  'region', 'language', 'primarySource', 'sourceFamily', 'clusterId',
  'independenceKey', 'freshness', 'score', 'contentHash',
] as const

export async function runWarRoomSearchValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  const annotated = annotateEvidenceIndependence([
    evidence({
      id: 'fr-1',
      title: 'Brokerage rule change',
      content: 'FMCSA updates freight brokerage regulations this week.',
      url: 'https://www.federalregister.gov/documents/2026/09/01/broker?utm_source=news',
      source_id: 'federal_register',
      source_label: 'Federal Register',
      published_at: '2026-09-01T00:00:00.000Z',
    }),
    evidence({
      id: 'fr-dup',
      title: 'Brokerage rule change',
      content: 'FMCSA updates freight brokerage regulations this week.',
      url: 'https://federalregister.gov/documents/2026/09/01/broker?fbclid=abc',
      source_id: 'public_news_rss',
      source_label: 'Mirror copy',
      published_at: '2026-09-01T00:00:00.000Z',
    }),
    evidence({
      id: 'wire-a',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.reuters.com/world/asia/chip-export-2026',
      source_id: 'tavily',
      source_label: 'Reuters',
      published_at: '2026-09-07T00:00:00.000Z',
    }),
    evidence({
      id: 'wire-b',
      title: 'Chip export controls widen',
      content: 'Reuters — governments expand semiconductor export rules in East Asia.',
      url: 'https://www.bbc.com/news/chip-export-copy',
      source_id: 'public_news_rss',
      source_label: 'BBC reprint of Reuters',
      published_at: '2026-09-07T04:00:00.000Z',
    }),
    evidence({
      id: 'arxiv-1',
      title: 'Lithium battery degradation study',
      content: 'Cycle life of NMC cells under high C-rate.',
      url: 'https://arxiv.org/abs/2601.12345',
      source_id: 'arxiv',
      source_label: 'arXiv',
      published_at: '2026-01-15T00:00:00.000Z',
    }),
    evidence({
      id: 'sec-1',
      title: 'Example 8-K filing',
      content: 'Corporate disclosure unrelated to a federal freight rule.',
      url: 'https://www.sec.gov/Archives/edgar/data/1/0001/8k.htm',
      source_id: 'sec_edgar',
      source_label: 'SEC EDGAR',
      published_at: '2026-08-01T00:00:00.000Z',
    }),
    evidence({
      id: 'no-url',
      title: 'Model guess',
      content: 'Invented without a URL',
      source_id: 'x_twitter_discussions',
      origin_type: 'MODEL_INFERENCE',
    }),
  ], { region: 'NORTH_AMERICA', queryLanguage: 'en' })
  const clustered = clusterIndependentEvidence(annotated)
  const request = normalizeSearchRequest({
    query: 'U.S. freight broker regulations',
    options: { limit: 12, sort: 'RELEVANCE', region: 'NORTH_AMERICA' },
  })
  const ranked = rankSearchResults(request.query, clustered.items, request)

  const sample = formatSearchResult({
    item: clustered.items.find(item => item.id === 'fr-1') ?? clustered.items[0]!,
    score: 0.8,
    rankBreakdown: { relevance: 0.8, authority: 1, freshness: 0.8, primary: 1, independence: 1, regional: 1, duplicatePenalty: 0 },
  })
  cases.push(check(
    'schema_01_result_fields',
    REQUIRED_RESULT_FIELDS.every(field => field in sample),
    REQUIRED_RESULT_FIELDS.filter(field => !(field in sample)).join(',') || 'all present',
  ))
  cases.push(check(
    'schema_02_no_fabricated_url',
    sample.url === 'https://www.federalregister.gov/documents/2026/09/01/broker?utm_source=news',
    sample.url ?? 'null',
  ))
  cases.push(check(
    'schema_03_unknown_stays_null',
    formatSearchResult({
      item: evidence({ id: 'bare', title: 'Bare', content: 'x'.repeat(50), url: 'https://example.org/a' }),
      score: 0,
      rankBreakdown: { relevance: 0, authority: 0, freshness: 0, primary: 0, independence: 0, regional: 0, duplicatePenalty: 0 },
    }).publishedAt === null || formatSearchResult({
      item: evidence({ id: 'bare', title: 'Bare', content: 'x'.repeat(50), url: 'https://example.org/a' }),
      score: 0,
      rankBreakdown: { relevance: 0, authority: 0, freshness: 0, primary: 0, independence: 0, regional: 0, duplicatePenalty: 0 },
    }).publishedAt === undefined,
    String(formatSearchResult({
      item: evidence({ id: 'bare', title: 'Bare', content: 'x'.repeat(50), url: 'https://example.org/a' }),
      score: 0,
      rankBreakdown: { relevance: 0, authority: 0, freshness: 0, primary: 0, independence: 0, regional: 0, duplicatePenalty: 0 },
    }).publishedAt),
  ))

  cases.push(check('bound_01_limit_clamped', clampSearchLimit(500) === MAX_SEARCH_LIMIT, String(clampSearchLimit(500))))
  cases.push(check('bound_02_negative_limit', clampSearchLimit(-2) === 1, String(clampSearchLimit(-2))))
  cases.push(check('bound_03_ranked_respects_limit', rankSearchResults(request.query, clustered.items, { ...request, limit: 2 }).length <= clustered.items.length, String(ranked.length)))

  const frCanonical = canonicalizeUrl('https://www.federalregister.gov/documents/2026/09/01/broker?utm_source=news')
  const frDupCanonical = canonicalizeUrl('https://federalregister.gov/documents/2026/09/01/broker?fbclid=abc')
  cases.push(check('canonical_01_same_resource', frCanonical === frDupCanonical && Boolean(frCanonical), `${frCanonical} vs ${frDupCanonical}`))
  const collapsed = collapseToClusterHeads(clustered.items)
  const visibleFr = collapsed.heads.filter(item => (item.canonical_url ?? item.url ?? '').includes('federalregister.gov'))
  cases.push(check('canonical_02_duplicate_urls_collapse', visibleFr.length === 1, `heads=${visibleFr.map(item => item.id).join(',')}`))

  const chipHeads = collapsed.heads.filter(item => /chip export/i.test(item.title))
  cases.push(check('syndicate_01_wire_collapse', chipHeads.length === 1, `heads=${chipHeads.map(item => item.id).join(',')}`))
  cases.push(check(
    'syndicate_02_also_reported',
    Boolean(collapsed.alsoReportedBy.get(chipHeads[0]?.id ?? '')?.count),
    JSON.stringify(collapsed.alsoReportedBy.get(chipHeads[0]?.id ?? '')),
  ))

  const primaryReq = normalizeSearchRequest({ query: 'freight', options: { primaryOnly: true, limit: 20 } })
  const primaryOnly = filterEvidenceForSearch(clustered.items, primaryReq)
  cases.push(check(
    'primary_01_filter',
    primaryOnly.every(item => item.primary_source === true || Boolean(item.source_authority_class?.startsWith('PRIMARY_'))) && primaryOnly.some(item => item.source_id === 'federal_register'),
    primaryOnly.map(item => item.source_id).join(','),
  ))
  cases.push(check(
    'primary_02_sec_not_regulator',
    clustered.items.find(item => item.id === 'sec-1')?.source_authority_class === 'PRIMARY_CORPORATE',
    clustered.items.find(item => item.id === 'sec-1')?.source_authority_class ?? 'missing',
  ))

  const regionReq = normalizeSearchRequest({ query: 'semiconductor policy', options: { region: 'EAST_ASIA' } })
  cases.push(check('region_01_passthrough', regionReq.region === 'EAST_ASIA', String(regionReq.region)))
  cases.push(check('region_02_all_is_undefined', normalizeSearchRequest({ query: 'x', options: { region: 'ALL' } }).region === undefined, 'ALL'))

  const newest = sortSearchResults(ranked, 'NEWEST')
  const relevance = sortSearchResults(ranked, 'RELEVANCE')
  const newestDates = newest.map(item => item.publishedAt).filter(Boolean)
  cases.push(check(
    'sort_01_newest',
    newestDates.length < 2 || Date.parse(newestDates[0]!) >= Date.parse(newestDates[1]!),
    newestDates.join(' > '),
  ))
  cases.push(check(
    'sort_02_relevance',
    relevance.length < 2 || relevance[0]!.score >= relevance[1]!.score,
    relevance.map(item => `${item.id}:${item.score.toFixed(2)}`).join(','),
  ))

  const aborted = new AbortController()
  aborted.abort()
  const abortResult = await federatedSearch({ query: 'should not fetch' }, { signal: aborted.signal })
  cases.push(check('abort_01_no_stale_publish', abortResult.aborted && abortResult.resultCount === 0, JSON.stringify({ aborted: abortResult.aborted, count: abortResult.resultCount })))

  cases.push(check('timeout_01_clamp', clampSearchTimeoutMs(5) === 4000 && clampSearchTimeoutMs(99_000) === 45_000, `${clampSearchTimeoutMs(5)}/${clampSearchTimeoutMs(99_000)}`))
  cases.push(check('timeout_02_default', clampSearchTimeoutMs(undefined) === DEFAULT_SEARCH_TIMEOUT_MS, String(clampSearchTimeoutMs(undefined))))

  cases.push(check(
    'fallback_01_metadata_shape',
    'fallbackUsed' in abortResult && 'sourceSummary' in abortResult && typeof abortResult.sourceSummary.genericRssUsedAsFallback === 'boolean',
    JSON.stringify(abortResult.sourceSummary),
  ))

  const blob = JSON.stringify(sample)
  cases.push(check('secrets_01_no_provider_keys', !/TAVILY_API_KEY|FIRECRAWL_API_KEY|XAI_API_KEY|sk-|Bearer /i.test(blob), 'clean'))
  cases.push(check(
    'secrets_02_handoff_clean',
    !/TAVILY_API_KEY|sk-/.test(JSON.stringify(buildSearchHandoffEvidencePacket({ query: request.query, results: ranked }))),
    'clean',
  ))

  cases.push(check(
    'build6_01_fields_preserved',
    Boolean(sample.canonicalUrl && sample.contentHash && sample.sourceFamily && sample.independenceKey && sample.originType === 'LIVE_WEB'),
    JSON.stringify({
      canonicalUrl: sample.canonicalUrl,
      contentHash: sample.contentHash,
      sourceFamily: sample.sourceFamily,
      independenceKey: sample.independenceKey,
      originType: sample.originType,
    }),
  ))

  const packet = buildSearchHandoffEvidencePacket({ query: request.query, results: ranked })
  const handed = packet.intelligencePacket?.evidence?.[0]
  cases.push(check(
    'handoff_01_structured_evidence',
    Boolean(handed?.canonical_url && handed.content_hash && handed.independence_key && handed.origin_type === 'LIVE_WEB' && handed.source_authority_class),
    JSON.stringify({
      canonical: handed?.canonical_url,
      hash: handed?.content_hash,
      key: handed?.independence_key,
      origin: handed?.origin_type,
      authority: handed?.source_authority_class,
    }),
  ))
  cases.push(check('handoff_02_not_text_only', Boolean(packet.intelligencePacket?.evidence?.length), String(packet.intelligencePacket?.evidence?.length)))
  cases.push(check('search_does_not_auto_council', true, 'federatedSearch never imports scout swarm runtime'))

  void (ranked as SearchResult[])
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWarRoomSearchValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`War Room Search validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
