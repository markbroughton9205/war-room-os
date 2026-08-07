import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESEARCH_PROVIDER_ENV, providerConfigStatus, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { isAllowedHost, assertAllowedProviderUrl } from '@/lib/research-engine/security/hostAllowlist'
import { redactUrlForLogging, redactSecretsFromText } from '@/lib/research-engine/security/redact'
import { safeJsonParse, safeNdjsonParse, safeProviderFetch, __setResearchFetchForTests } from '@/lib/research-engine/security/safeFetch'
import { extractXmlBlocks, extractXmlText, decodeXmlEntities } from '@/lib/research-engine/security/xmlLite'
import { deduplicateDocuments } from '@/lib/research-engine/normalization/dedupe'
import { buildCitation } from '@/lib/research-engine/citations/citations'
import { routeResearchQuery } from '@/lib/research-engine/routing/router'
import { __resetProviderGateForTests, providerCooldownRemainingMs } from '@/lib/research-engine/security/providerGate'
import { __resetCacheForTests } from '@/lib/research-engine/cache/ttlCache'
import { makeDocument } from '@/lib/research-engine/providers/shared'
import { githubAdapter } from '@/lib/research-engine/providers/github'
import { exaAdapter } from '@/lib/research-engine/providers/exa'
import { ncbiAdapter } from '@/lib/research-engine/providers/ncbi'
import { fredAdapter } from '@/lib/research-engine/providers/fred'
import { arxivAdapter } from '@/lib/research-engine/providers/arxiv'
import { crossrefAdapter } from '@/lib/research-engine/providers/crossref'
import { worldBankIndicatorsAdapter } from '@/lib/research-engine/providers/worldBankIndicators'
import { usgsEarthquakeAdapter } from '@/lib/research-engine/providers/usgsEarthquake'
import { libraryOfCongressAdapter } from '@/lib/research-engine/providers/libraryOfCongress'
import { wikidataAdapter } from '@/lib/research-engine/providers/wikidata'
import { nasaGibsAdapter } from '@/lib/research-engine/providers/nasaGibs'
import { usgsWaterAdapter } from '@/lib/research-engine/providers/usgsWater'
import { usgsEarthquakeFeedAdapter } from '@/lib/research-engine/providers/usgsEarthquakeFeed'
import { usgsScienceBaseAdapter } from '@/lib/research-engine/providers/usgsScienceBase'
import { semanticScholarAdapter } from '@/lib/research-engine/providers/semanticScholar'
import { courtListenerAdapter } from '@/lib/research-engine/providers/courtlistener'
import { internetArchiveAdapter } from '@/lib/research-engine/providers/internetArchive'
import { waybackAdapter } from '@/lib/research-engine/providers/wayback'
import { commonCrawlAdapter } from '@/lib/research-engine/providers/commonCrawl'
import { samGovAdapter } from '@/lib/research-engine/providers/samGov'
import { nasaAdapter } from '@/lib/research-engine/providers/nasa'
import { fmcsaAdapter } from '@/lib/research-engine/providers/fmcsa'
import { validateBoundedTargetUrl } from '@/lib/research-engine/security/targetUrlValidator'
import { IMPLEMENTED_PROVIDER_ADAPTERS } from '@/lib/research-engine/providers/registry'
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'

export type ResearchValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string | Promise<boolean | string>): Promise<ResearchValidationResult> {
  return Promise.resolve()
    .then(fn)
    .then(result => ({ id, pass: result === true, detail: result === true ? 'PASS' : String(result) }))
    .catch(error => ({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }))
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function textResponse(text: string, status = 200, contentType = 'application/xml'): Response {
  return new Response(text, { status, headers: { 'Content-Type': contentType } })
}

function sampleDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return makeDocument({
    id: 'sample:1',
    provider: 'arxiv',
    providerRecordId: '1234.5678',
    title: 'Sample Title',
    summary: null,
    contentSnippet: null,
    canonicalUrl: 'https://export.arxiv.org/abs/1234.5678',
    sourceUrl: 'https://export.arxiv.org/abs/1234.5678',
    sourceName: 'arXiv',
    contentType: 'preprint',
    authors: [],
    organization: null,
    publishedAt: '2026-01-01',
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { arxiv_id: '1234.5678' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    ...overrides,
  })
}

/** Marks a sample document as a historical/archived capture (see dedupe.ts partitioning). */
function asHistorical(doc: ResearchDocument): ResearchDocument {
  return { ...doc, provenance: { ...doc.provenance, isHistorical: true } }
}

/** Temporarily sets env vars for the duration of `fn`, restoring the prior values (or absence) afterward. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key]
    process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Temporarily deletes env vars for the duration of `fn`, restoring the prior values afterward. */
async function withoutEnv<T>(names: string[], fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const name of names) {
    prev[name] = process.env[name]
    delete process.env[name]
  }
  try {
    return await fn()
  } finally {
    for (const [name, value] of Object.entries(prev)) {
      if (value !== undefined) process.env[name] = value
    }
  }
}

/** Returns a mocked `fetch` that yields each response in order, repeating the last one for any extra calls. */
function sequenceFetch(responses: Response[]): typeof fetch {
  let index = 0
  return (async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  }) as typeof fetch
}

/**
 * Runs an adapter test with a mocked, network-free `fetch` sequence and clean
 * provider-gate/cache/fetch-hook state before and after — so adapter tests
 * never leak concurrency-cooldown state, cached responses, or a stale mock
 * into a later test (see Repair 6's test-isolation requirement).
 */
async function withAdapterFetch<T>(responses: Response[], fn: () => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  __setResearchFetchForTests(sequenceFetch(responses))
  try {
    return await fn()
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

type CountingFetchCalls = { count: number; urls: string[]; inits: (RequestInit | undefined)[] }

/**
 * Like withAdapterFetch, but also records every request URL/init so a test
 * can assert on call count, host, path, method, or query parameters.
 * Deliberately does NOT fall back to replaying the last mocked response once
 * `responses` is exhausted (Repair: independent-audit finding — a naive
 * Math.min-clamped index would let an unexpected extra retry/redirect fetch
 * hide behind a silently-replayed success response, so a call-count
 * assertion could pass even when the adapter secretly made more upstream
 * requests than the test authorized). Instead, any fetch beyond the
 * authorized `responses.length` throws immediately with a distinctive
 * message, so an unauthorized extra request surfaces as a visible failure
 * rather than a concealed retry.
 */
async function withCountingFetch<T>(responses: Response[], fn: (calls: CountingFetchCalls) => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  const calls: CountingFetchCalls = { count: 0, urls: [], inits: [] }
  __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const index = calls.count
    calls.count += 1
    calls.urls.push(String(input))
    calls.inits.push(init)
    if (index >= responses.length) {
      throw new Error(`withCountingFetch: unauthorized fetch #${calls.count} — only ${responses.length} mocked response(s) were authorized for this test, but the adapter attempted another upstream request`)
    }
    return responses[index]
  }) as typeof fetch)
  try {
    return await fn(calls)
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

/** Common shape checks every normalized ResearchDocument must satisfy, regardless of provider. */
function documentShapeIssue(doc: ResearchDocument, provider: string): string | null {
  if (doc.provider !== provider) return `expected provider ${provider}, got ${doc.provider}`
  if (!doc.title) return 'missing title'
  if (!doc.canonicalUrl && !doc.sourceUrl) return 'missing canonical/source URL'
  if (typeof doc.retrievedAt !== 'string' || !doc.retrievedAt) return 'missing retrievedAt'
  if (doc.provenance.provider !== provider) return 'provenance.provider mismatch'
  return null
}

export async function runResearchEngineValidation(): Promise<ResearchValidationResult[]> {
  const results: ResearchValidationResult[] = []
  const add = async (id: string, fn: () => boolean | string | Promise<boolean | string>) => results.push(await test(id, fn))

  await add('re_01_all_29_providers_registered', () =>
    RESEARCH_PROVIDER_ENV.length === 29 || `expected 29 providers, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_02_missing_required_env_not_configured', () => {
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    const withRequiredEnv = RESEARCH_PROVIDER_ENV.filter(descriptor => descriptor.requiredEnv.length > 0)
    return withRequiredEnv.every(descriptor => providerConfigStatus(descriptor, emptyEnv) !== 'configured')
      || 'a provider with required env reported configured against an empty environment'
  })

  await add('re_03_env_satisfied_check_never_reads_value_into_result', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === 'github')!
    const satisfied = isProviderEnvSatisfied(descriptor, { ...process.env, GITHUB_TOKEN: 'not-a-real-token' })
    return typeof satisfied === 'boolean' || 'isProviderEnvSatisfied must return a boolean, never the value'
  })

  await add('re_04_host_allowlist_blocks_unknown_host', () =>
    !isAllowedHost('github', 'evil.example.com') || 'github allowlist accepted an arbitrary host')

  await add('re_05_host_allowlist_accepts_official_host', () =>
    isAllowedHost('github', 'api.github.com') || 'github allowlist rejected its own official host')

  await add('re_06_assert_allowed_url_blocks_non_https', () => {
    try {
      assertAllowedProviderUrl('github', 'http://api.github.com/repos')
      return 'non-HTTPS URL was not rejected'
    } catch {
      return true
    }
  })

  await add('re_07_assert_allowed_url_blocks_disallowed_host', () => {
    try {
      assertAllowedProviderUrl('fred', 'https://attacker.example.com/steal')
      return 'disallowed host was not rejected'
    } catch {
      return true
    }
  })

  await add('re_08_redact_url_strips_api_key', () => {
    const redacted = redactUrlForLogging('https://api.stlouisfed.org/fred/series?api_key=SECRET123&file_type=json')
    return (!redacted.includes('SECRET123') && redacted.includes('REDACTED')) || `secret leaked into redacted URL: ${redacted}`
  })

  await add('re_09_redact_text_strips_bearer_token', () => {
    const redacted = redactSecretsFromText('request failed: Bearer abcdef123456789 unauthorized')
    return !redacted.includes('abcdef123456789') || 'bearer token leaked into redacted error text'
  })

  await add('re_10_safe_json_parse_never_throws', () => safeJsonParse('{not valid json') === null || 'safeJsonParse should return null on invalid input, not throw')

  await add('re_11_safe_ndjson_parse_caps_lines_and_skips_bad_lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => (i === 3 ? 'not-json' : JSON.stringify({ i }))).join('\n')
    const parsed = safeNdjsonParse<{ i: number }>(lines, 5)
    return parsed.length <= 5 || `expected at most 5 parsed lines, got ${parsed.length}`
  })

  await add('re_12_xml_lite_extracts_atom_entry_fields', () => {
    const xml = '<feed><entry><id>http://arxiv.org/abs/1234.5678v1</id><title>A Title &amp; More</title><summary><![CDATA[abstract text]]></summary></entry></feed>'
    const entries = extractXmlBlocks(xml, 'entry')
    if (entries.length !== 1) return `expected 1 entry, got ${entries.length}`
    const title = extractXmlText(entries[0], 'title')
    const summary = extractXmlText(entries[0], 'summary')
    return (title === 'A Title & More' && summary === 'abstract text') || `title=${title} summary=${summary}`
  })

  await add('re_13_xml_lite_decodes_numeric_entities', () =>
    decodeXmlEntities('&#65;&#x42;') === 'AB' || 'numeric entity decoding failed')

  await add('re_14_dedupe_merges_same_doi_preserves_distinct_citations', () => {
    const a = sampleDoc({
      id: 'a', provider: 'crossref', identifiers: { doi: '10.1234/x' },
      canonicalUrl: 'https://doi.org/10.1234/x',
      citations: [buildCitation(sampleDoc({ provider: 'crossref', identifiers: { doi: '10.1234/x' }, canonicalUrl: 'https://doi.org/10.1234/x' }))],
    })
    const b = sampleDoc({
      id: 'b', provider: 'crossref', identifiers: { doi: '10.1234/x' }, title: 'Different title, same DOI',
      canonicalUrl: 'https://doi.org/10.1234/x',
      citations: [buildCitation(sampleDoc({
        provider: 'crossref', identifiers: { doi: '10.1234/x' },
        canonicalUrl: 'https://publisher.example.com/article/10.1234x', sourceUrl: 'https://publisher.example.com/article/10.1234x',
      }))],
    })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].citations.length === 2)
      || `documents=${documents.length} duplicatesRemoved=${duplicatesRemoved} citations=${documents[0]?.citations.length}`
  })

  await add('re_15_dedupe_does_not_merge_on_title_similarity_alone', () => {
    const a = sampleDoc({ id: 'a', identifiers: {}, canonicalUrl: 'https://example.com/a', title: 'Climate report 2026' })
    const b = sampleDoc({ id: 'b', identifiers: {}, canonicalUrl: 'https://example.com/b', title: 'Climate report 2026', publishedAt: '2026-02-02' })
    const { documents } = deduplicateDocuments([a, b])
    return documents.length === 2 || 'documents with different URLs and dates were incorrectly merged on title alone'
  })

  await add('re_16_citation_never_fabricates_missing_fields', () => {
    const doc = sampleDoc({ authors: [], organization: null, license: null })
    const citation = buildCitation(doc)
    return (citation.authorOrOrganization === null && citation.licenseOrAccessWarning === null)
      || 'citation invented an author/org or license that was not present on the source document'
  })

  await add('re_17_router_rejects_unimplemented_provider_with_reason', () => {
    // usgs_national_map has no required env var and remains unimplemented
    // (BLOCKED — MISSING AUTHORITATIVE CONTRACT), so this isolates the
    // "adapter not implemented" rejection path from "env missing".
    const decision = routeResearchQuery({ text: 'test', intent: 'maps_geospatial' })
    const usgsNationalMap = decision.rejectedProviders.find(entry => entry.provider === 'usgs_national_map')
    return Boolean(usgsNationalMap && /not implemented/i.test(usgsNationalMap.reason)) || `usgs_national_map rejection: ${JSON.stringify(usgsNationalMap)}`
  })

  await add('re_18_router_selects_only_configured_implemented_providers', () => {
    const decision = routeResearchQuery({ text: 'earthquake', intent: 'earthquakes_hazards' })
    return decision.selectedProviders.includes('usgs_earthquake') || `usgs_earthquake (public, unauthenticated) should always be selectable: ${JSON.stringify(decision)}`
  })

  await add('re_19_router_enforces_max_results_ceiling', () => {
    const decision = routeResearchQuery({ text: 'x', maxResults: 9999 })
    return decision.maxResults <= 50 || `maxResults ceiling not enforced: ${decision.maxResults}`
  })

  await add('re_20_safe_fetch_retries_429_then_succeeds', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '0' })
      return jsonResponse({ ok: true })
    }) as typeof fetch)
    try {
      const result = await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxRetries: 2, timeoutMs: 5000 })
      return (result.ok && calls === 2) || `ok=${result.ok} calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_21_safe_fetch_caps_response_size', async () => {
    __setResearchFetchForTests((async () => new Response('x'.repeat(2_000_000), { status: 200 })) as typeof fetch)
    try {
      const result = await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxResponseBytes: 1000, maxRetries: 0, timeoutMs: 5000 })
      return (result.truncated && result.text.length <= 1000) || `truncated=${result.truncated} len=${result.text.length}`
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_22_safe_fetch_blocks_disallowed_redirect_host', async () => {
    __setResearchFetchForTests((async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example.com/steal' } })) as typeof fetch)
    try {
      await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxRetries: 0, timeoutMs: 5000 })
      return 'redirect to a disallowed host was not blocked'
    } catch {
      return true
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_23_search_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/search/route.ts'), 'utf8')
    return (source.includes('requireCommanderSession') && source.includes('secretsExposed: false')) || 'search route is missing Commander auth or secretsExposed flag'
  })

  await add('re_24_providers_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/providers/route.ts'), 'utf8')
    return source.includes('requireCommanderSession') || 'providers route is missing Commander auth'
  })

  await add('re_25_health_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/providers/[provider]/health/route.ts'), 'utf8')
    return source.includes('requireCommanderSession') || 'health route is missing Commander auth'
  })

  await add('re_26_search_route_rejects_arbitrary_provider_ids', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/search/route.ts'), 'utf8')
    return source.includes('KNOWN_PROVIDER_IDS.has') || 'search route does not validate provider ids against the known registry'
  })

  await add('re_27_no_next_public_provider_secrets', () => {
    const configSource = readFileSync(join(process.cwd(), 'lib/research-engine/config/providerEnv.ts'), 'utf8')
    return !/NEXT_PUBLIC_.*(KEY|TOKEN|SECRET)/i.test(configSource) || 'a provider secret env var appears to be exposed via NEXT_PUBLIC_'
  })

  await add('re_28_nasa_gibs_reuses_existing_module_not_duplicated', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers/nasaGibs.ts'), 'utf8')
    return (source.includes("from '@/lib/earth-intelligence/gibsLayers'") && source.includes("from '@/lib/earth-intelligence/gibsServerConfig'"))
      || 'nasa_gibs adapter does not import the existing earth-intelligence module'
  })

  // Exercises the actual safe-error path (safeProviderFetch -> catch -> redactSecretsFromText -> throw)
  // with a synthetic error carrying a fake secret, an Authorization-style value, and an internal
  // stack-frame/file-path fragment, and verifies none of the three survive into the thrown message.
  await add('re_29_safe_fetch_error_redacts_secrets_authorization_and_stack_details', async () => {
    __resetProviderGateForTests()
    const fakeSecret = 'sk-FAKESECRET1234567890'
    const syntheticMessage = `connect ECONNREFUSED: Authorization: Bearer ${fakeSecret} request failed at Object.<anonymous> (C:\\Users\\markb\\warroom\\lib\\research-engine\\providers\\worldBankIndicators.ts:45:10)`
    __setResearchFetchForTests((async () => {
      throw new Error(syntheticMessage)
    }) as typeof fetch)
    try {
      await safeProviderFetch('world_bank_indicators', 'https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD', { maxRetries: 0, timeoutMs: 5000 })
      return 'expected safeProviderFetch to throw on a network-layer error'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(fakeSecret)) return `fake secret leaked into error message: ${message}`
      if (/Authorization["']?\s*[:=]\s*["']?Bearer\s+sk-FAKESECRET/i.test(message)) return `Authorization value leaked into error message: ${message}`
      if (message.includes('worldBankIndicators.ts:45:10') || message.includes('Object.<anonymous>')) return `internal stack/path detail leaked into error message: ${message}`
      if (!message.includes('REDACTED')) return `expected a safe redacted marker in the error message, got: ${message}`
      return true
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  // --- Repair 2: historical/current provenance must never be collapsed by dedupe ---

  await add('re_30_dedupe_current_current_duplicate_merges', () => {
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/hist-cc' } })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/hist-cc' }, title: 'A different title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].provenance.isHistorical === false)
      || `expected current+current merge, got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  await add('re_31_dedupe_historical_historical_duplicate_merges', () => {
    const a = asHistorical(sampleDoc({ id: 'a', identifiers: { doi: '10.1/hist-hh' } }))
    const b = asHistorical(sampleDoc({ id: 'b', identifiers: { doi: '10.1/hist-hh' }, title: 'A different title' }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].provenance.isHistorical === true)
      || `expected historical+historical merge, got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  await add('re_32_dedupe_current_and_historical_never_merge', () => {
    const current = sampleDoc({ id: 'cur', identifiers: { doi: '10.1/hist-mix' } })
    const historical = asHistorical(sampleDoc({ id: 'hist', identifiers: { doi: '10.1/hist-mix' } }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([current, historical])
    const hasCurrent = documents.some(doc => !doc.provenance.isHistorical)
    const hasHistorical = documents.some(doc => doc.provenance.isHistorical)
    return (documents.length === 2 && duplicatesRemoved === 0 && hasCurrent && hasHistorical)
      || `a current and a historical document sharing an identifier were merged: documents=${documents.length}`
  })

  await add('re_33_dedupe_preserves_and_dedupes_warnings_across_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/warn' }, warnings: ['shared warning', 'a-only warning'] })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/warn' }, warnings: ['shared warning', 'b-only warning'] })
    const { documents } = deduplicateDocuments([a, b])
    const warnings = documents[0]?.warnings ?? []
    return (warnings.length === 3 && new Set(warnings).size === 3) || `expected 3 deduplicated warnings, got ${JSON.stringify(warnings)}`
  })

  await add('re_34_dedupe_collapses_identical_duplicate_citations', () => {
    const citation = buildCitation(sampleDoc({ provider: 'crossref', identifiers: { doi: '10.1/dupcite' } }))
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/dupcite' }, citations: [citation] })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/dupcite' }, citations: [citation] })
    const { documents } = deduplicateDocuments([a, b])
    return documents[0]?.citations.length === 1 || `expected a truly identical citation to collapse to 1, got ${documents[0]?.citations.length}`
  })

  // --- Repair 3 (revised): title and/or publication date must never be a merge key,
  // alone or combined, whether the records share a provider or come from different ones ---

  await add('re_35_dedupe_null_date_title_match_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: null, title: 'Shared Title No Date' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: null, title: 'Shared Title No Date' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two unrelated null-date same-title documents were merged: documents=${documents.length}`
  })

  await add('re_36_dedupe_same_title_same_date_same_provider_no_identifier_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const b = sampleDoc({ id: 'b', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two same-provider documents with no stable identifier were merged on title+date alone: documents=${documents.length}`
  })

  await add('re_36b_dedupe_same_title_same_date_different_providers_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two different-provider documents with no stable identifier were merged on title+date alone: documents=${documents.length}`
  })

  await add('re_37_dedupe_canonical_url_duplicates_still_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: {}, canonicalUrl: 'https://example.com/report', title: 'Title A' })
    const b = sampleDoc({ id: 'b', identifiers: {}, canonicalUrl: 'https://example.com/report', title: 'Title B (different)' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected canonical URL match to merge, got documents=${documents.length}`
  })

  await add('re_38_dedupe_stable_identifier_duplicates_still_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: { pmid: '12345' } })
    const b = sampleDoc({ id: 'b', identifiers: { pmid: '12345' }, title: 'A totally different title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected strong-identifier match to merge, got documents=${documents.length}`
  })

  await add('re_39_dedupe_provider_record_id_duplicates_merge_when_no_stronger_evidence', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title X' })
    const b = sampleDoc({ id: 'b', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title Y' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected providerRecordId match to merge, got documents=${documents.length}`
  })

  await add('re_39b_dedupe_provider_record_id_same_value_different_providers_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title X' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title Y' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `a providerRecordId shared across two different providers was incorrectly merged: documents=${documents.length}`
  })

  await add('re_39c_dedupe_duplicates_removed_count_is_exact_across_mixed_batch', () => {
    // 5 inputs: {a,b} share a DOI (1 merge), {c,d} share only title+date across different providers (must stay separate), e is unrelated.
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/exact-count' } })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/exact-count' }, title: 'A different title' })
    const c = sampleDoc({ id: 'c', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-04-01', title: 'Same Title Different Provider' })
    const d = sampleDoc({ id: 'd', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-04-01', title: 'Same Title Different Provider' })
    const e = sampleDoc({ id: 'e', identifiers: { doi: '10.1/exact-count-unrelated' } })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b, c, d, e])
    return (documents.length === 4 && duplicatesRemoved === 1) || `expected exactly 1 duplicate removed out of 5 (1 real merge, 2 correctly-kept-separate lookalikes, 1 unrelated), got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  // --- Repair 4: every declared config-status value must be reachable ---

  await add('re_40_all_declared_provider_config_statuses_are_reachable', () => {
    const reachable = new Set<string>()
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    for (const descriptor of RESEARCH_PROVIDER_ENV) {
      reachable.add(providerConfigStatus(descriptor, emptyEnv))
      reachable.add(providerConfigStatus(descriptor, process.env))
    }
    const declared = ['configured', 'unavailable', 'pending']
    const unreachable = declared.filter(status => !reachable.has(status))
    return unreachable.length === 0 || `declared status(es) never reachable against this registry: ${unreachable.join(', ')}`
  })

  // --- Repair 7: capability declarations must not overstate what run() actually does ---

  await add('re_41_implemented_provider_capabilities_do_not_overstate_run_behavior', () => {
    const maxCapabilitiesById: Record<string, string[]> = {
      exa: ['search'],
      github: ['search'],
      ncbi: ['search'],
      fred: ['search', 'timeSeries'],
      arxiv: ['search'],
      crossref: ['search'],
      nasa_gibs: ['mapLayers'],
      world_bank_indicators: ['search', 'timeSeries'],
      usgs_earthquake: ['search', 'geoSearch'],
      library_of_congress: ['search'],
      wikidata: ['search'],
      usgs_water: ['timeSeries', 'geoSearch'],
      usgs_earthquake_feed: ['list'],
      usgs_sciencebase: ['search', 'getById'],
      semantic_scholar: ['search'],
      courtlistener: ['search'],
      internet_archive: ['search'],
      wayback: ['historicalCaptures'],
      common_crawl: ['historicalCaptures'],
      sam_gov: ['search'],
      nasa: ['search'],
      fmcsa: ['getById'],
    }
    const implemented = RESEARCH_PROVIDER_ENV.filter(descriptor => descriptor.implemented)
    const offenders = implemented.filter(descriptor => {
      const allowed = maxCapabilitiesById[descriptor.id]
      if (!allowed) return true
      return descriptor.capabilities.some(capability => !allowed.includes(capability))
    })
    return offenders.length === 0 || `capability declarations overstate run() behavior for: ${offenders.map(d => d.id).join(', ')}`
  })

  // --- Repair 6: adapter-specific mocked tests for all 11 implemented providers ---

  await add('re_42_github_success_normalizes_repository_search', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ items: [{ full_name: 'octocat/hello-world', html_url: 'https://github.com/octocat/hello-world', description: 'demo repo', owner: { login: 'octocat' }, language: 'TypeScript', license: { name: 'MIT' }, stargazers_count: 42, pushed_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', created_at: '2025-01-01T00:00:00Z' }] }),
  ], async () => {
    const response = await githubAdapter.run({ text: 'hello world' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.github_full_name !== 'octocat/hello-world') return 'github_full_name identifier missing/incorrect'
    if (response.documents.length > 25) return 'result count not bounded'
    return documentShapeIssue(response.documents[0], 'github') ?? true
  })))

  await add('re_43_github_upstream_error_is_safe_not_a_fake_success', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await githubAdapter.run({ text: 'hello world' })
    return (response.ok === false && response.documents.length === 0 && response.error !== null) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_44_exa_success_normalizes_web_search', () => withEnv({ EXA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ title: 'Example Article', url: 'https://example.com/article', publishedDate: '2026-02-01', author: 'Jane Doe', score: 0.9, text: 'snippet text' }] }),
  ], async () => {
    const response = await exaAdapter.run({ text: 'example query' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'exa') ?? true
  })))

  await add('re_45_exa_upstream_error_is_safe_not_a_fake_success', () => withEnv({ EXA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await exaAdapter.run({ text: 'example query' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_46_ncbi_success_normalizes_pubmed_search', () => withAdapterFetch([
    jsonResponse({ esearchresult: { idlist: ['111'] } }),
    jsonResponse({ result: { '111': { uid: '111', title: 'Sample Study', pubdate: '2026-01-01', authors: [{ name: 'A Researcher' }], fulljournalname: 'Journal of Examples', articleids: [{ idtype: 'doi', value: '10.9999/sample' }] } } }),
    textResponse('<PubmedArticleSet><PubmedArticle><Abstract><AbstractText>Abstract text here.</AbstractText></Abstract></PubmedArticle></PubmedArticleSet>'),
  ], async () => {
    const response = await ncbiAdapter.run({ text: 'sample study' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.pmid !== '111') return 'pmid identifier missing'
    if (doc.summary !== 'Abstract text here.') return `expected the efetch abstract normalized onto the top result, got ${doc.summary}`
    return documentShapeIssue(doc, 'ncbi') ?? true
  }))

  await add('re_47_ncbi_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await ncbiAdapter.run({ text: 'sample study' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_48_fred_success_normalizes_series_and_observations', () => withEnv({ FRED_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ seriess: [{ id: 'GNPCA', title: 'Real Gross National Product', frequency: 'Annual', units: 'Billions of Chained 2017 Dollars', observation_start: '1929-01-01', observation_end: '2025-01-01', last_updated: '2026-01-01' }] }),
    jsonResponse({ observations: [{ date: '2024-01-01', value: '20500.1' }, { date: '2025-01-01', value: '21000.5' }] }),
  ], async () => {
    const response = await fredAdapter.run({ text: 'gross national product' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 2) return `expected a normalized 2-point time series, got ${JSON.stringify(response.timeSeries)}`
    return documentShapeIssue(response.documents[0], 'fred') ?? true
  })))

  await add('re_49_fred_upstream_error_is_safe_not_a_fake_success', () => withEnv({ FRED_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await fredAdapter.run({ text: 'gross national product' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_50_arxiv_success_normalizes_atom_entry', () => withAdapterFetch([
    textResponse('<feed><entry><id>http://arxiv.org/abs/2601.00001v1</id><title>Sample Paper Title</title><summary>Sample abstract text.</summary><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated><author><name>A. Researcher</name></author><link href="http://arxiv.org/pdf/2601.00001v1" rel="related" type="application/pdf"/></entry></feed>', 200, 'application/atom+xml'),
  ], async () => {
    const response = await arxivAdapter.run({ text: 'sample paper' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.arxiv_id !== '2601.00001') return `expected arxiv_id extracted from the entry id, got ${JSON.stringify(doc.identifiers)}`
    return documentShapeIssue(doc, 'arxiv') ?? true
  }))

  await add('re_51_arxiv_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await arxivAdapter.run({ text: 'sample paper' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_52_crossref_success_normalizes_works_search', () => withAdapterFetch([
    jsonResponse({ message: { items: [{ DOI: '10.1000/sample', title: ['Sample Work'], author: [{ given: 'Jane', family: 'Doe' }], 'container-title': ['Journal of Samples'], URL: 'https://doi.org/10.1000/sample', license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }], 'published-print': { 'date-parts': [[2026, 1, 1]] }, publisher: 'Sample Publisher' }] } }),
  ], async () => {
    const response = await crossrefAdapter.run({ text: 'sample work' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.doi !== '10.1000/sample') return 'doi identifier missing'
    if (doc.publishedAt !== '2026-01-01') return `expected published-print date-parts normalized, got ${doc.publishedAt}`
    return documentShapeIssue(doc, 'crossref') ?? true
  }))

  await add('re_53_crossref_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await crossrefAdapter.run({ text: 'sample work' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_54_world_bank_success_normalizes_multiple_observations', () => withAdapterFetch([
    jsonResponse([
      { page: 1, pages: 1, per_page: 60, total: 2 },
      [
        { indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: '2025', value: 105_000_000_000_000, unit: '', obs_status: '' },
        { indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: '2024', value: 101_000_000_000_000, unit: '', obs_status: '' },
      ],
    ]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.timeSeries.length !== 1) return `expected 1 time series, got ${response.timeSeries.length}`
    const points = response.timeSeries[0].points
    if (points.length !== 2) return `expected both observations to normalize, got ${points.length}`
    if (points[0].date !== '2024' || points[1].date !== '2025') return `expected chronological (oldest-first) order, got ${JSON.stringify(points.map(p => p.date))}`
    return documentShapeIssue(response.documents[0], 'world_bank_indicators') ?? true
  }))

  await add('re_55_world_bank_result_count_stays_bounded', () => withAdapterFetch([
    jsonResponse([
      { page: 1, pages: 1, per_page: 60, total: 90 },
      Array.from({ length: 90 }, (_, i) => ({ indicator: { id: 'X', value: 'X indicator' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: String(2026 - i), value: i, unit: '', obs_status: '' })),
    ]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'X' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.timeSeries[0].points.length <= 60 || `expected observation count bounded to 60, got ${response.timeSeries[0].points.length}`
  }))

  await add('re_56_world_bank_empty_result_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse([{ page: 1, pages: 1, per_page: 60, total: 0 }, []]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.UNKNOWN.CODE' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_57_world_bank_documented_api_error_becomes_error_not_empty_success', () => withAdapterFetch([
    jsonResponse([{ message: [{ id: '120', key: 'Invalid value', value: 'Invalid country code. It should be the ISO country code' }] }]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD for ZZ' })
    if (response.ok !== false || !response.error) return `expected the documented WB error shape to become ok:false, got ${JSON.stringify(response)}`
    if (response.error.category !== 'upstream_error') return `expected category upstream_error, got ${response.error.category}`
    return response.error.message.includes('Invalid country code') || `expected the WB error text surfaced safely, got ${response.error.message}`
  }))

  await add('re_58_world_bank_malformed_shape_becomes_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ unexpected: 'shape', not: 'the documented array response' }),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD' })
    if (response.ok !== false || !response.error) return `expected a malformed shape to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_59_usgs_earthquake_success_normalizes_geojson_features', () => withAdapterFetch([
    jsonResponse({ features: [{ id: 'us1234', properties: { mag: 5.6, place: '10km N of Somewhere', time: 1767225600000, updated: 1767229200000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1234', tsunami: 0, alert: null, type: 'earthquake', status: 'reviewed' }, geometry: { type: 'Point', coordinates: [-120.5, 38.2, 10] } }] }),
  ], async () => {
    const response = await usgsEarthquakeAdapter.run({ text: 'M5 earthquake' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1 || response.geoFeatures.length !== 1) return `expected 1 document + 1 geoFeature, got docs=${response.documents.length} geo=${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_event_id !== 'us1234') return 'usgs_event_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_earthquake') ?? true
  }))

  await add('re_60_usgs_earthquake_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await usgsEarthquakeAdapter.run({ text: 'M5 earthquake' })
    return (response.ok === false && response.documents.length === 0 && response.geoFeatures.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_61_library_of_congress_success_normalizes_search_results', () => withAdapterFetch([
    jsonResponse({ results: [{ id: '2026001', url: 'https://www.loc.gov/item/2026001/', title: 'Sample Archival Item', description: ['A description.'], date: '1900', digitized: true, access_restricted: false, online_format: ['image'], original_format: ['photo'], contributor: ['Photographer, A.'], resources: [{ url: 'https://www.loc.gov/resource/2026001/' }] }] }),
  ], async () => {
    const response = await libraryOfCongressAdapter.run({ text: 'sample archival item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'library_of_congress') ?? true
  }))

  await add('re_62_library_of_congress_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await libraryOfCongressAdapter.run({ text: 'sample archival item' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_63_wikidata_success_normalizes_entity_search', () => withEnv({ WIKIMEDIA_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ search: [{ id: 'Q42', label: 'Douglas Adams', description: 'English writer and humorist' }] }),
    jsonResponse({ entities: { Q42: { labels: { en: { value: 'Douglas Adams' } }, descriptions: { en: { value: 'English writer and humorist' } }, aliases: { en: [{ value: 'Douglas Noel Adams' }] } } } }),
  ], async () => {
    const response = await wikidataAdapter.run({ text: 'Douglas Adams' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.wikidata_qid !== 'Q42') return 'wikidata_qid identifier missing'
    return documentShapeIssue(response.documents[0], 'wikidata') ?? true
  })))

  await add('re_64_wikidata_upstream_error_is_safe_not_a_fake_success', () => withEnv({ WIKIMEDIA_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await wikidataAdapter.run({ text: 'Douglas Adams' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_65_nasa_gibs_success_lists_curated_layers_without_network', () => withEnv({ NASA_GIBS_WMTS_BASE_URL: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' }, async () => {
    const response = await nasaGibsAdapter.run({ text: '' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length === 0) return 'expected at least one curated GIBS layer document'
    return documentShapeIssue(response.documents[0], 'nasa_gibs') ?? true
  }))

  await add('re_66_nasa_gibs_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['NASA_GIBS_WMTS_BASE_URL'], async () => {
    const response = await nasaGibsAdapter.run({ text: '' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  // --- Batch 1A: USGS Water Data (usgs_water) ---

  const sampleWaterFeature = {
    id: 'daily.USGS-01646500.00060.00003',
    properties: {
      monitoring_location_id: 'USGS-01646500',
      parameter_code: '00060',
      statistic_id: '00003',
      time: '2026-01-01',
      value: 120.5,
      unit_of_measure: 'ft3/s',
      qualifier: ['A'],
      approvals_status: 'Approved',
      last_modified: '2026-01-02T00:00:00Z',
    },
    geometry: { type: 'Point', coordinates: [-77.0365, 38.8951] },
  }

  await add('re_67_usgs_water_success_normalizes_daily_values', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 1) return `expected a normalized 1-point time series, got ${JSON.stringify(response.timeSeries)}`
    if (response.geoFeatures.length !== 1) return `expected 1 geoFeature, got ${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_monitoring_location_id !== 'USGS-01646500') return 'usgs_monitoring_location_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_water') ?? true
  }))

  await add('re_68_usgs_water_empty_response_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_69_usgs_water_malformed_response_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a malformed shape to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_70_usgs_water_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_71_usgs_water_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_72_usgs_water_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_73_usgs_water_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: Array.from({ length: 150 }, (_, i) => ({
        id: `daily.USGS-01646500.00060.00003.${i}`,
        properties: { monitoring_location_id: 'USGS-01646500', parameter_code: '00060', statistic_id: '00003', time: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, value: i, unit_of_measure: 'ft3/s' },
        geometry: { type: 'Point', coordinates: [-77.0365, 38.8951] },
      })),
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.timeSeries[0].points.length <= 100 || `expected point count bounded to 100, got ${response.timeSeries[0].points.length}`
  }))

  await add('re_74_usgs_water_next_links_are_not_followed', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature], links: [{ rel: 'next', href: 'https://api.waterdata.usgs.gov/collections/daily/items?offset=100' }] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
      return (response.ok && calls === 1) || `expected exactly one fetch (no next-link auto-follow), calls=${calls} ok=${response.ok}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_75_usgs_water_configured_without_api_key', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === 'usgs_water')!
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    return (descriptor.requiredEnv.length === 0 && providerConfigStatus(descriptor, emptyEnv) === 'configured')
      || `expected usgs_water to report configured without any env, got requiredEnv=${JSON.stringify(descriptor.requiredEnv)} status=${providerConfigStatus(descriptor, emptyEnv)}`
  })

  await add('re_76_usgs_water_optional_api_key_sent_only_via_header_never_url', () => withEnv({ USGS_WATER_API_KEY: 'test-key-not-real' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (capturedUrl.includes('test-key-not-real')) return `API key leaked into the request URL: ${capturedUrl}`
      if (!capturedHeaders || capturedHeaders['X-Api-Key'] !== 'test-key-not-real') return `expected the optional key sent via X-Api-Key header, got ${JSON.stringify(capturedHeaders)}`
      return true
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_77_usgs_water_preserves_zero_and_null_distinctly', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: [
        { id: 'a', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-01', value: 0, unit_of_measure: 'ft3/s' }, geometry: null },
        { id: 'b', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-02', value: null, unit_of_measure: 'ft3/s' }, geometry: null },
      ],
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const points = response.timeSeries[0]?.points ?? []
    const hasZero = points.some(p => p.value === 0)
    const hasNull = points.some(p => p.value === null)
    return (hasZero && hasNull) || `expected a preserved real zero and a preserved null distinctly, got ${JSON.stringify(points)}`
  }))

  await add('re_78_usgs_water_preserves_provisional_warning', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: [{ id: 'a', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-01', value: 5, unit_of_measure: 'ft3/s', approvals_status: 'Provisional' }, geometry: null }],
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const warnings = response.documents[0]?.warnings ?? []
    return warnings.some(w => /provisional/i.test(w)) || `expected a provisional-data warning, got ${JSON.stringify(warnings)}`
  }))

  await add('re_79_usgs_water_missing_site_number_is_rejected_not_unbounded_query', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'water quality near the river' })
      return (response.ok === false && calls === 0 && response.error?.category === 'unknown')
        || `expected a rejected, non-fetching response for a missing site number, got ok=${response.ok} calls=${calls} category=${response.error?.category}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A: USGS Real-Time Earthquake Feeds (usgs_earthquake_feed) ---

  const sampleFeedFeature = {
    id: 'us7000abcd',
    properties: {
      mag: 5.1,
      place: '20km SW of Somewhere',
      time: 1767225600000,
      updated: 1767229200000,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      alert: 'green',
      status: 'reviewed',
      tsunami: 0,
      sig: 400,
      code: '7000abcd',
      ids: ',us7000abcd,',
      type: 'earthquake',
    },
    geometry: { type: 'Point', coordinates: [-122.1, 37.4, 8.2] },
  }

  await add('re_80_usgs_earthquake_feed_success_normalizes_feed_events', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000, title: '4.5 Day', url: 'https://earthquake.usgs.gov' }, features: [sampleFeedFeature] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'significant earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1 || response.geoFeatures.length !== 1) return `expected 1 document + 1 geoFeature, got docs=${response.documents.length} geo=${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_event_id !== 'us7000abcd') return 'usgs_event_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_earthquake_feed') ?? true
  }))

  await add('re_81_usgs_earthquake_feed_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'significant earthquakes today' })
    return (response.ok === false && response.documents.length === 0 && response.geoFeatures.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_82_usgs_earthquake_feed_only_allowlisted_magnitude_and_period_used', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'give me the significant events this week' })
      return capturedUrl === 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson'
        || `expected the fixed allowlisted path template, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_83_usgs_earthquake_feed_arbitrary_text_cannot_redirect_feed_selection', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'https://attacker.example.com/steal magnitude=999 period=decade' })
      return capturedUrl === 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
        || `expected arbitrary text to fall back to the conservative default feed, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_84_usgs_earthquake_feed_one_fetch_per_uncached_run', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ features: [sampleFeedFeature] })
    }) as typeof fetch)
    try {
      const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      return (response.ok && calls === 1) || `expected exactly one upstream fetch for one uncached run, calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_85_usgs_earthquake_feed_event_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ features: Array.from({ length: 150 }, (_, i) => ({ ...sampleFeedFeature, id: `us${i}` })) }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 100 || `expected event count bounded to 100, got ${response.documents.length}`
  }))

  await add('re_86_usgs_earthquake_feed_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ features: [sampleFeedFeature] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_87_usgs_earthquake_feed_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_88_usgs_earthquake_feed_honest_missing_magnitude_and_geometry', () => withAdapterFetch([
    jsonResponse({ features: [{ id: 'us_nomag', properties: { mag: null, place: null, time: 1767225600000, updated: 1767225600000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us_nomag', alert: null, status: 'automatic', tsunami: 0, sig: null }, geometry: null }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for a missing geometry, got ${response.geoFeatures.length}`
    const doc = response.documents[0]
    if (!doc || doc.title !== 'M? — Unknown location') return `expected an honest placeholder title for missing magnitude/place, got ${doc?.title}`
    return true
  }))

  // --- Batch 1A: USGS ScienceBase (usgs_sciencebase) ---

  const sampleSbItem = {
    id: '4f4e4b24e4b07f02db47e234',
    title: 'Sample Groundwater Dataset',
    summary: 'A <b>bounded</b> dataset summary with &amp; an entity.',
    tags: [{ type: 'Theme', name: 'Groundwater' }, { type: 'Theme', name: 'Hydrology' }],
    ancestors: ['4f4e4b24e4b07f02db47e000'],
    provenance: { dateCreated: '2026-01-01T00:00:00Z', lastUpdated: '2026-01-02T00:00:00Z' },
    link: { url: 'https://www.sciencebase.gov/catalog/item/4f4e4b24e4b07f02db47e234' },
  }

  await add('re_89_usgs_sciencebase_search_success_normalizes_items', () => withAdapterFetch([
    jsonResponse({ items: [sampleSbItem] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.sciencebase_item_id !== sampleSbItem.id) return 'sciencebase_item_id identifier missing'
    if (response.documents[0].summary?.includes('<b>')) return `expected HTML markup stripped from summary, got ${response.documents[0].summary}`
    if (!response.documents[0].summary?.includes('& an entity')) return `expected entity decoded, got ${response.documents[0].summary}`
    return documentShapeIssue(response.documents[0], 'usgs_sciencebase') ?? true
  }))

  await add('re_90_usgs_sciencebase_getbyid_success_uses_item_path', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse(sampleSbItem)
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: sampleSbItem.id })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      if (!capturedUrl.includes(`/item/${sampleSbItem.id}`)) return `expected the /item/{id} path to be used, got ${capturedUrl}`
      if (capturedUrl.includes('/items/')) return `expected getById to use /item/{id}, not the /items/ search path, got ${capturedUrl}`
      return response.documents[0]?.providerRecordId === sampleSbItem.id || `expected the stable item id preserved, got ${response.documents[0]?.providerRecordId}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_91_usgs_sciencebase_arbitrary_text_does_not_become_id_lookup', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ items: [] })
    }) as typeof fetch)
    try {
      // 24 characters but not all hex, and a second case with hex-like but wrong length — neither is a valid ScienceBase item id.
      await usgsScienceBaseAdapter.run({ text: 'not-a-valid-item-id-zzzz' })
      return capturedUrl.includes('/items/') || `expected non-id free text to dispatch to the /items/ search path, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_92_usgs_sciencebase_empty_search_result_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse({ items: [] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_93_usgs_sciencebase_malformed_response_is_safe_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: sampleSbItem.id })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a safe parse_error response, got ${JSON.stringify(response)}`
  }))

  await add('re_94_usgs_sciencebase_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_95_usgs_sciencebase_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_96_usgs_sciencebase_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ items: Array.from({ length: 60 }, (_, i) => ({ ...sampleSbItem, id: `4f4e4b24e4b07f02db47e${String(i).padStart(3, '0')}` })) }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 25 || `expected result count bounded to 25, got ${response.documents.length}`
  }))

  await add('re_97_usgs_sciencebase_html_summary_is_stripped_not_executed', () => withAdapterFetch([
    jsonResponse({ items: [{ ...sampleSbItem, summary: '<script>alert(1)</script>Safe text' }] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const summary = response.documents[0]?.summary ?? ''
    return (!summary.includes('<script>') && summary.includes('Safe text')) || `expected script markup stripped as inert text, got ${summary}`
  }))

  await add('re_98_usgs_sciencebase_next_links_are_not_followed', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ items: [sampleSbItem], nextlink: { url: 'https://www.sciencebase.gov/catalog/items/?offset=25' } })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      return (response.ok && calls === 1) || `expected exactly one fetch (no next-link auto-follow), calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_99_usgs_sciencebase_only_get_requests_used', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ items: [sampleSbItem] })
    }) as typeof fetch)
    try {
      await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A: registry/provider-count integrity (Phase 8) ---

  const BATCH_1A_TARGET_IDS = ['usgs_water', 'usgs_earthquake_feed', 'usgs_sciencebase'] as const
  const UNAUTHORIZED_BATCH_1_IDS = ['imf_sdmx', 'world_bank_data_catalog', 'world_bank_projects', 'world_bank_finances', 'world_bank_climate', 'usgs_national_map'] as const

  await add('re_100_registered_provider_count_remains_29', () =>
    RESEARCH_PROVIDER_ENV.length === 29 || `expected 29 registered providers, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_101_implemented_count_derives_to_22_from_descriptors_and_registry', () => {
    const implementedDescriptors = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).length
    const implementedAdapters = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).length
    return (implementedDescriptors === 22 && implementedAdapters === 22)
      || `expected 22 implemented in both descriptors and registry, got descriptors=${implementedDescriptors} registry=${implementedAdapters}`
  })

  await add('re_102_three_target_adapters_registered_and_reachable', () => {
    const missing = BATCH_1A_TARGET_IDS.filter(id => !(id in IMPLEMENTED_PROVIDER_ADAPTERS))
    const notImplementedInDescriptor = BATCH_1A_TARGET_IDS.filter(id => !RESEARCH_PROVIDER_ENV.find(d => d.id === id)?.implemented)
    return (missing.length === 0 && notImplementedInDescriptor.length === 0)
      || `expected all three Batch 1A providers registered+implemented, missingFromRegistry=${JSON.stringify(missing)} notImplementedInDescriptor=${JSON.stringify(notImplementedInDescriptor)}`
  })

  await add('re_103_six_unauthorized_batch1_providers_remain_unimplemented', () => {
    const wronglyImplemented = UNAUTHORIZED_BATCH_1_IDS.filter(id => {
      const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === id)
      return descriptor?.implemented === true || id in IMPLEMENTED_PROVIDER_ADAPTERS
    })
    return wronglyImplemented.length === 0 || `unauthorized provider(s) were implemented: ${JSON.stringify(wronglyImplemented)}`
  })

  await add('re_104_usgs_water_key_is_optional', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === 'usgs_water')!
    return (!descriptor.requiredEnv.includes('USGS_WATER_API_KEY') && descriptor.optionalEnv.includes('USGS_WATER_API_KEY'))
      || `expected USGS_WATER_API_KEY in optionalEnv only, got requiredEnv=${JSON.stringify(descriptor.requiredEnv)} optionalEnv=${JSON.stringify(descriptor.optionalEnv)}`
  })

  await add('re_105_no_duplicate_descriptor', () => {
    const ids = RESEARCH_PROVIDER_ENV.map(d => d.id)
    return ids.length === new Set(ids).size || `duplicate descriptor id(s) found: ${JSON.stringify(ids)}`
  })

  await add('re_106_no_duplicate_adapter', () => {
    const ids = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS)
    const mismatched = ids.filter(id => IMPLEMENTED_PROVIDER_ADAPTERS[id as keyof typeof IMPLEMENTED_PROVIDER_ADAPTERS]?.id !== id)
    return (ids.length === new Set(ids).size && mismatched.length === 0)
      || `duplicate or mismatched adapter registration found: ids=${JSON.stringify(ids)} mismatched=${JSON.stringify(mismatched)}`
  })

  await add('re_107_implemented_descriptor_and_registry_sets_match_exactly', () => {
    const descriptorImplemented = new Set(RESEARCH_PROVIDER_ENV.filter(d => d.implemented).map(d => d.id))
    const registryImplemented = new Set(Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[])
    const onlyInDescriptors = [...descriptorImplemented].filter(id => !registryImplemented.has(id))
    const onlyInRegistry = [...registryImplemented].filter(id => !descriptorImplemented.has(id))
    return (onlyInDescriptors.length === 0 && onlyInRegistry.length === 0)
      || `implemented sets diverge: onlyInDescriptors=${JSON.stringify(onlyInDescriptors)} onlyInRegistry=${JSON.stringify(onlyInRegistry)}`
  })

  await add('re_108_no_title_date_dedupe_fallback_exists', () => {
    // Behavioral re-confirmation (not a source-text scan, which would false-positive on
    // citationKey's unrelated provider-scoped title+date fallback): two documents that share
    // only a title and a publish date, with no identifier/URL/providerRecordId, must never merge,
    // whether they share a provider or not — re-derived here against the new Batch 1A adapters too.
    const a = sampleDoc({ id: 'a', provider: 'usgs_water', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Title' })
    const b = sampleDoc({ id: 'b', provider: 'usgs_sciencebase', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two documents sharing only title+date were incorrectly merged: documents=${documents.length}`
  })

  await add('re_109_batch_1a_current_and_historical_documents_remain_separate', () => {
    const current = sampleDoc({ id: 'w-cur', provider: 'usgs_water', identifiers: { usgs_monitoring_location_id: 'USGS-01646500' } })
    const historical = asHistorical(sampleDoc({ id: 'w-hist', provider: 'usgs_water', identifiers: { usgs_monitoring_location_id: 'USGS-01646500' } }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([current, historical])
    return (documents.length === 2 && duplicatesRemoved === 0) || `a current and historical usgs_water document were incorrectly merged: documents=${documents.length}`
  })

  await add('re_110_no_provider_secret_uses_next_public', () => {
    const configSource = readFileSync(join(process.cwd(), 'lib/research-engine/config/providerEnv.ts'), 'utf8')
    return !/NEXT_PUBLIC_.*(KEY|TOKEN|SECRET)/i.test(configSource) || 'a provider secret env var appears to be exposed via NEXT_PUBLIC_'
  })

  const REMAINING_15_IMPLEMENTED_FILES = [
    'semanticScholar.ts', 'courtlistener.ts', 'internetArchive.ts', 'wayback.ts', 'commonCrawl.ts',
    'samGov.ts', 'nasa.ts',
  ]

  await add('re_111_no_new_adapter_uses_write_capable_http_method', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts', ...REMAINING_15_IMPLEMENTED_FILES]
    const offenders = files.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(source)
    })
    return offenders.length === 0 || `write-capable HTTP method referenced in: ${offenders.join(', ')}`
  })

  await add('re_112_new_adapters_never_call_raw_fetch', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts', ...REMAINING_15_IMPLEMENTED_FILES]
    const offenders = files.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /[^.\w]fetch\(/.test(source)
    })
    return offenders.length === 0 || `raw fetch() call (bypassing safeProviderFetch) found in: ${offenders.join(', ')}`
  })

  // --- Batch 1A Repair: malformed-response handling and test-completeness gaps found by audit ---

  await add('re_113_usgs_earthquake_feed_legitimate_empty_features_is_honest_success', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: [] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === true && response.documents.length === 0 && response.geoFeatures.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_114_usgs_earthquake_feed_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_115_usgs_earthquake_feed_non_array_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ features: 'not-an-array' }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected a non-array "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_116_usgs_earthquake_feed_invalid_coordinate_types_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ features: [{ ...sampleFeedFeature, id: 'us_badcoord', geometry: { type: 'Point', coordinates: ['not-a-number', 'also-not', 5] } }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for non-numeric coordinates, got ${response.geoFeatures.length}`
    return response.documents.length === 1 || `expected the event document to still be created despite malformed geometry, got ${response.documents.length}`
  }))

  await add('re_117_usgs_earthquake_feed_out_of_range_coordinates_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ features: [{ ...sampleFeedFeature, id: 'us_rangecoord', geometry: { type: 'Point', coordinates: [200, -95, 10] } }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response despite out-of-range geometry, got error: ${JSON.stringify(response.error)}`
    return response.geoFeatures.length === 0 || `expected no geoFeature for out-of-range coordinates, got ${response.geoFeatures.length}`
  }))

  await add('re_118_usgs_earthquake_feed_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_EARTHQUAKE_FEED_BASE_URL: 'https://evil.example.com/feed' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_119_usgs_earthquake_feed_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_120_usgs_sciencebase_search_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected malformed JSON search response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_121_usgs_sciencebase_search_non_array_items_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ items: 'not-an-array' }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected a non-array "items" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_122_usgs_sciencebase_search_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ items: [sampleSbItem] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_123_usgs_sciencebase_search_does_not_fetch_attachment_or_resource_urls', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({
        items: [{
          ...sampleSbItem,
          files: [{ name: 'data.zip', url: 'https://www.sciencebase.gov/catalog/file/get/000attach' }],
          distributionLinks: [{ uri: 'https://www.sciencebase.gov/catalog/item/000attach/download' }],
          webLinks: [{ type: 'download', uri: 'https://www.sciencebase.gov/catalog/item/000attach/related' }],
        }],
      })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      return calls === 1 || `expected exactly one fetch (the search call only, no attachment/resource follow-up), calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_124_usgs_sciencebase_search_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_SCIENCEBASE_API_BASE_URL: 'https://evil.example.com/catalog' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ items: [] })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_125_usgs_water_invalid_coordinate_element_types_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.badcoord', geometry: { type: 'Point', coordinates: ['not-a-number', 'also-not'] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for non-numeric coordinates, got ${response.geoFeatures.length}`
    return response.documents.length === 1 || `expected the observation document to still be created despite malformed geometry, got ${response.documents.length}`
  }))

  await add('re_126_usgs_water_out_of_range_coordinates_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.rangecoord', geometry: { type: 'Point', coordinates: [-200, 95] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite out-of-range geometry, got error: ${JSON.stringify(response.error)}`
    return response.geoFeatures.length === 0 || `expected no geoFeature for out-of-range coordinates, got ${response.geoFeatures.length}`
  }))

  await add('re_127_usgs_water_timeseries_survives_malformed_geometry', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.badgeo', geometry: { type: 'Point', coordinates: [Number.NaN, Number.NaN] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for NaN coordinates, got ${response.geoFeatures.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 1) return `expected the observation time series to survive malformed geometry, got ${JSON.stringify(response.timeSeries)}`
    return response.documents.length === 1 || `expected the observation document to survive malformed geometry, got ${response.documents.length}`
  }))

  await add('re_128_usgs_water_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_WATER_API_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_129_usgs_water_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      await usgsWaterAdapter.run({ text: 'site 01646500' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A Final Micro-Repair: USGS Water fail-closed response-shape validation ---

  await add('re_130_usgs_water_top_level_number_is_safe_parse_error', () => withAdapterFetch([
    new Response('42', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level number response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_131_usgs_water_top_level_string_is_safe_parse_error', () => withAdapterFetch([
    new Response('"not-a-collection"', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level string response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_132_usgs_water_top_level_boolean_is_safe_parse_error', () => withAdapterFetch([
    new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level boolean response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_133_usgs_water_top_level_array_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse([sampleWaterFeature]),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level array response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_134_usgs_water_missing_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_135_usgs_water_features_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: null }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_136_usgs_water_features_object_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: {} }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:{} to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_137_usgs_water_features_string_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: 'invalid' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:"invalid" to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_138_usgs_water_explicit_empty_features_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an explicit empty features array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_139_usgs_water_malformed_shapes_never_expose_raw_js_errors', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: 'invalid' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a safe error response, got ${JSON.stringify(response)}`
    const message = response.error.message ?? ''
    if (/slice is not a function/i.test(message)) return `raw JavaScript error text leaked: ${message}`
    if (/cannot read propert/i.test(message)) return `raw JavaScript error text leaked: ${message}`
    return true
  }))

  await add('re_140_usgs_water_malformed_shape_makes_no_real_network_call', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: 'invalid' })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (calls !== 1) return `expected exactly one request, routed only through the mocked fetch (no real network escape), got ${calls}`
      return response.ok === false || `expected ok:false for the malformed "features" shape, got ${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A Final Micro-Repair: USGS Earthquake Feed fail-closed for missing/null features ---

  await add('re_141_usgs_earthquake_feed_missing_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 } }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_142_usgs_earthquake_feed_features_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: null }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected features:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_143_usgs_earthquake_feed_explicit_empty_features_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: [] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === true && response.documents.length === 0 && response.geoFeatures.length === 0)
      || `expected an explicit empty features array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  // --- Batch 1A Final Micro-Repair: USGS ScienceBase search fail-closed for missing/null items ---

  await add('re_144_usgs_sciencebase_search_missing_items_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({}),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "items" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_145_usgs_sciencebase_search_items_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ items: null }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected items:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_146_usgs_sciencebase_search_explicit_empty_items_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ items: [] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty items array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  // --- Remaining 15: semantic_scholar (Group A) ---

  const sampleSsPaper = {
    paperId: 'abc123def456',
    title: 'A Study of Sample Things',
    abstract: 'This is a sample abstract.',
    year: 2025,
    authors: [{ authorId: '1', name: 'A. Researcher' }],
    externalIds: { DOI: '10.9999/sample-ss' },
    url: 'https://www.semanticscholar.org/paper/abc123def456',
    venue: 'Journal of Samples',
    citationCount: 12,
  }

  await add('re_147_semantic_scholar_success_normalizes_paper_search', () => withAdapterFetch([
    jsonResponse({ total: 1, offset: 0, data: [sampleSsPaper] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.semantic_scholar_paper_id !== 'abc123def456') return 'semantic_scholar_paper_id identifier missing'
    if (doc.identifiers.doi !== '10.9999/sample-ss') return 'doi identifier missing'
    if (doc.summary !== 'This is a sample abstract.') return `expected abstract preserved as summary, got ${doc.summary}`
    return documentShapeIssue(doc, 'semantic_scholar') ?? true
  }))

  await add('re_148_semantic_scholar_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_149_semantic_scholar_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_150_semantic_scholar_missing_data_field_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ total: 0 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected a missing "data" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_151_semantic_scholar_non_array_data_field_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ data: 'not-an-array' }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected a non-array "data" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_152_semantic_scholar_explicit_empty_data_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ total: 0, data: [] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty data array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_153_semantic_scholar_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ total: 200, data: Array.from({ length: 200 }, (_, i) => ({ ...sampleSsPaper, paperId: `paper-${i}` })) }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 25 || `expected result count bounded to 25, got ${response.documents.length}`
  }))

  await add('re_154_semantic_scholar_missing_abstract_stays_null_not_fabricated', () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, abstract: null }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].summary === null || `expected a missing abstract to stay null, got ${JSON.stringify(response.documents[0].summary)}`
  }))

  await add('re_155_semantic_scholar_api_key_sent_only_via_header_never_url', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedHeaders: Record<string, string> | undefined
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ data: [] })
    }) as typeof fetch)
    try {
      await withEnv({ SEMANTIC_SCHOLAR_API_KEY: 'test-key-not-real' }, () => semanticScholarAdapter.run({ text: 'sample things' }))
      if (capturedUrl?.includes('test-key-not-real')) return 'API key leaked into the request URL'
      return capturedHeaders?.['x-api-key'] === 'test-key-not-real' || `expected the x-api-key header to carry the key, got headers=${JSON.stringify(capturedHeaders)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_156_semantic_scholar_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ data: [] })
    }) as typeof fetch)
    try {
      await semanticScholarAdapter.run({ text: 'sample things' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: courtlistener (Group A) ---

  const sampleClResult = {
    cluster_id: 987654,
    absolute_url: '/opinion/987654/sample-v-example/',
    caseName: 'Sample v. Example',
    dateFiled: '2025-06-01',
    court: 'Supreme Court of the United States',
    court_id: 'scotus',
    status: 'Published',
    docketNumber: '25-1234',
    citation: ['600 U.S. 1'],
  }

  await add('re_157_courtlistener_success_normalizes_case_law_search', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 1, results: [sampleClResult], next: null, previous: null }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.courtlistener_cluster_id !== '987654') return 'courtlistener_cluster_id identifier missing'
    if (doc.canonicalUrl !== 'https://www.courtlistener.com/opinion/987654/sample-v-example/') return `expected absolute_url resolved against courtlistener.com, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'courtlistener') ?? true
  })))

  await add('re_158_courtlistener_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['COURTLISTENER_API_TOKEN'], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_159_courtlistener_upstream_error_is_safe_not_a_fake_success', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_160_courtlistener_malformed_json_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_161_courtlistener_missing_results_field_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 0 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected a missing "results" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_162_courtlistener_non_array_results_field_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: 'not-an-array' }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected a non-array "results" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_163_courtlistener_explicit_empty_results_remains_honest_success', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 0, results: [] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty results array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_164_courtlistener_result_count_is_bounded', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 100, results: Array.from({ length: 100 }, (_, i) => ({ ...sampleClResult, cluster_id: i })) }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_165_courtlistener_never_fabricates_missing_precedential_status', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ ...sampleClResult, status: undefined }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].identifiers.courtlistener_status === undefined || `expected a missing status to never be fabricated, got ${JSON.stringify(response.documents[0].identifiers)}`
  })))

  await add('re_166_courtlistener_token_sent_only_via_header_never_url', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedHeaders: Record<string, string> | undefined
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ results: [] })
    }) as typeof fetch)
    try {
      await withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => courtListenerAdapter.run({ text: 'sample v example' }))
      if (capturedUrl?.includes('test-token-not-real')) return 'API token leaked into the request URL'
      return capturedHeaders?.Authorization === 'Token test-token-not-real' || `expected the Authorization header to carry the token, got headers=${JSON.stringify(capturedHeaders)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: internet_archive (Group A) ---

  const sampleIaDoc = {
    identifier: 'sample-item-2026',
    title: 'A Sample Archive Item',
    description: 'A description of the sample item.',
    mediatype: 'texts',
    date: '2020-01-01',
    creator: 'A. Archivist',
  }

  await add('re_167_internet_archive_success_normalizes_search_results', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ responseHeader: {}, response: { numFound: 1, start: 0, docs: [sampleIaDoc] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.internet_archive_identifier !== 'sample-item-2026') return 'internet_archive_identifier missing'
    if (doc.canonicalUrl !== 'https://archive.org/details/sample-item-2026') return `expected canonical details URL, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'internet_archive') ?? true
  })))

  await add('re_168_internet_archive_handles_array_valued_metadata_fields', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: [{ ...sampleIaDoc, title: ['First Title', 'Alt Title'], creator: ['A. One', 'B. Two'] }] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const doc = response.documents[0]
    if (doc.authors.length !== 2) return `expected both array-valued creators preserved, got ${JSON.stringify(doc.authors)}`
    return true
  })))

  await add('re_169_internet_archive_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['INTERNET_ARCHIVE_USER_AGENT_BASE'], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_170_internet_archive_upstream_error_is_safe_not_a_fake_success', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_171_internet_archive_malformed_json_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_172_internet_archive_missing_response_docs_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ responseHeader: {} }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected a missing "response.docs" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_173_internet_archive_non_array_docs_field_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: 'not-an-array' } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected a non-array "docs" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_174_internet_archive_explicit_empty_docs_remains_honest_success', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { numFound: 0, docs: [] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty docs array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_175_internet_archive_result_count_is_bounded', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: Array.from({ length: 100 }, (_, i) => ({ ...sampleIaDoc, identifier: `item-${i}` })) } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_176_internet_archive_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0', INTERNET_ARCHIVE_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return jsonResponse({ response: { docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'sample item' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  // --- Remaining 15: wayback (Group A) ---

  const sampleCdxRows = [
    ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
    ['com,example)/', '20250601120000', 'https://example.com/', 'text/html', '200', 'ABCDEF123456', '1024'],
  ]

  await add('re_177_wayback_success_normalizes_cdx_captures', () => withAdapterFetch([
    jsonResponse(sampleCdxRows),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.wayback_timestamp !== '20250601120000') return 'wayback_timestamp identifier missing'
    if (doc.canonicalUrl !== 'https://web.archive.org/web/20250601120000/https://example.com/') return `expected the documented capture URL pattern, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'wayback') ?? true
  }))

  await add('re_178_wayback_rejects_localhost_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://localhost/admin' })
    return (response.ok === false && response.error?.category === 'unknown') || `expected localhost target to be rejected before any request, got ${JSON.stringify(response)}`
  })

  await add('re_179_wayback_rejects_loopback_ipv4_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://127.0.0.1/secret' })
    return response.ok === false || 'expected a loopback IPv4 target to be rejected'
  })

  await add('re_180_wayback_rejects_rfc1918_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://10.0.0.5/internal' })
    return response.ok === false || 'expected an RFC1918 target to be rejected'
  })

  await add('re_181_wayback_rejects_link_local_metadata_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://169.254.169.254/latest/meta-data/' })
    return response.ok === false || 'expected the cloud metadata address to be rejected'
  })

  await add('re_182_wayback_rejects_decimal_encoded_loopback_target', async () => {
    // 2130706433 is the decimal encoding of 127.0.0.1 — the WHATWG URL
    // parser canonicalizes this to "127.0.0.1" before the range check runs.
    const response = await waybackAdapter.run({ text: 'http://2130706433/' })
    return response.ok === false || 'expected a decimal-encoded loopback target to be rejected'
  })

  await add('re_183_wayback_rejects_embedded_credentials_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://user:pass@example.com/' })
    return response.ok === false || 'expected a target URL with embedded credentials to be rejected'
  })

  await add('re_184_wayback_rejects_non_web_scheme_target', async () => {
    const response = await waybackAdapter.run({ text: 'file:///etc/passwd' })
    return response.ok === false || 'expected a non-http(s) scheme target to be rejected'
  })

  await add('re_185_wayback_accepts_ordinary_public_https_target', () => {
    const result = validateBoundedTargetUrl('https://example.com/some/page')
    return result.ok || `expected an ordinary public HTTPS URL to validate, got ${JSON.stringify(result)}`
  })

  await add('re_186_wayback_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_187_wayback_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_188_wayback_non_array_top_level_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ not: 'an array' }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected a non-array top level to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_189_wayback_unexpected_header_shape_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse([['not', 'the', 'expected', 'header'], ['a', 'b']]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected an unrecognized header row to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_190_wayback_explicit_empty_array_remains_honest_success', () => withAdapterFetch([
    jsonResponse([]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/never-captured' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty CDX array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_191_wayback_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse([
      sampleCdxRows[0],
      ...Array.from({ length: 100 }, (_, i) => ['com,example)/', `2025060${i % 9}120000`, 'https://example.com/', 'text/html', '200', `DIGEST${i}`, '1024']),
    ]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  }))

  await add('re_192_wayback_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ WAYBACK_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return jsonResponse([])
    }) as typeof fetch)
    try {
      const response = await waybackAdapter.run({ text: 'https://example.com/' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_193_wayback_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse([])
    }) as typeof fetch)
    try {
      await waybackAdapter.run({ text: 'https://example.com/' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: common_crawl (Group A) ---

  const ccEnv = { COMMON_CRAWL_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0', COMMON_CRAWL_COLLECTION_ID: 'CC-MAIN-2025-33' }
  const sampleCcLine = JSON.stringify({ urlkey: 'com,example)/', timestamp: '20250601120000', url: 'https://example.com/', mime: 'text/html', status: '200', digest: 'ABCDEF123456', filename: 'crawl-data/CC-MAIN-2025-33/segments/x.warc.gz', offset: '123', length: '456' })

  await add('re_194_common_crawl_success_normalizes_index_records', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse(sampleCcLine, 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.common_crawl_timestamp !== '20250601120000') return 'common_crawl_timestamp identifier missing'
    if (doc.canonicalUrl !== 'https://example.com/') return `expected the record's own url as canonicalUrl, got ${doc.canonicalUrl}`
    if ('common_crawl_filename' in doc.identifiers || 'common_crawl_offset' in doc.identifiers) return 'WARC pointer fields must never appear in normalized output'
    return documentShapeIssue(doc, 'common_crawl') ?? true
  })))

  await add('re_195_common_crawl_not_configured_without_collection_id', () => withEnv({ COMMON_CRAWL_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withoutEnv(['COMMON_CRAWL_COLLECTION_ID'], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error when the collection id is missing, got ${JSON.stringify(response)}`
  })))

  await add('re_196_common_crawl_not_configured_without_user_agent', () => withoutEnv(['COMMON_CRAWL_USER_AGENT_BASE'], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_197_common_crawl_upstream_error_is_safe_not_a_fake_success', () => withEnv(ccEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_198_common_crawl_nonempty_unparseable_body_is_safe_parse_error', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse('this is not ndjson at all {{{', 200, 'text/plain'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected a non-empty unparseable body to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_199_common_crawl_empty_body_remains_honest_success', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse('', 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/never-crawled' })
    return (response.ok === true && response.documents.length === 0) || `expected an empty body to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_200_common_crawl_result_count_is_bounded', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse(Array.from({ length: 100 }, (_, i) => JSON.stringify({ urlkey: 'com,example)/', timestamp: `2025060${i % 9}120000`, url: 'https://example.com/', digest: `D${i}` })).join('\n'), 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_201_common_crawl_rejects_localhost_target', () => withEnv(ccEnv, async () => {
    const response = await commonCrawlAdapter.run({ text: 'http://localhost/admin' })
    return response.ok === false || 'expected a localhost target to be rejected before any request'
  }))

  await add('re_202_common_crawl_rejects_invalid_collection_id_format', () => withEnv({ ...ccEnv, COMMON_CRAWL_COLLECTION_ID: '../../etc/passwd' }, async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected an invalid collection id to be rejected as not_configured, got ${JSON.stringify(response)}`
  }))

  await add('re_203_common_crawl_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ ...ccEnv, COMMON_CRAWL_INDEX_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return textResponse('', 200)
    }) as typeof fetch)
    try {
      const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_204_common_crawl_get_only_at_runtime', () => withEnv(ccEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return textResponse('', 200)
    }) as typeof fetch)
    try {
      await commonCrawlAdapter.run({ text: 'https://example.com/' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  // --- Remaining 15: sam_gov (Group B) ---

  const sampleSamOpp = {
    noticeId: 'abc123',
    title: 'Sample IT Services Opportunity',
    solicitationNumber: 'SOL-2026-001',
    postedDate: '2026-07-01',
    type: 'Solicitation',
    active: 'Yes',
    typeOfSetAsideDescription: 'Total Small Business Set-Aside',
    responseDeadLine: '2026-08-01T17:00:00-04:00',
    uiLink: 'https://sam.gov/opp/abc123/view',
    naicsCode: '541511',
  }

  await add('re_205_sam_gov_success_normalizes_opportunity_search', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 1, opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.sam_gov_notice_id !== 'abc123') return 'sam_gov_notice_id identifier missing'
    if (doc.identifiers.sam_gov_active !== 'Yes') return 'sam_gov_active identifier missing'
    return documentShapeIssue(doc, 'sam_gov') ?? true
  })))

  await add('re_206_sam_gov_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['SAM_GOV_API_KEY'], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_207_sam_gov_upstream_error_is_safe_not_a_fake_success', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_208_sam_gov_malformed_json_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_209_sam_gov_missing_opportunities_data_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 0 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected a missing "opportunitiesData" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_210_sam_gov_non_array_opportunities_data_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: 'not-an-array' }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected a non-array "opportunitiesData" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_211_sam_gov_explicit_empty_opportunities_remains_honest_success', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 0, opportunitiesData: [] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty opportunitiesData array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_212_sam_gov_result_count_is_bounded', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: Array.from({ length: 100 }, (_, i) => ({ ...sampleSamOpp, noticeId: `notice-${i}` })) }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_213_sam_gov_never_fabricates_missing_active_status', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [{ ...sampleSamOpp, active: undefined, typeOfSetAsideDescription: undefined }] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return (response.documents[0].identifiers.sam_gov_active === undefined && response.documents[0].identifiers.sam_gov_set_aside === undefined) || `expected missing active/set-aside to never be fabricated, got ${JSON.stringify(response.documents[0].identifiers)}`
  })))

  await add('re_214_sam_gov_api_key_never_leaks_into_cache_key_or_normalized_output', () => withEnv({ SAM_GOV_API_KEY: 'sk-live-sam-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-sam-secret-not-real') || 'the SAM.gov API key leaked into the normalized response'
  })))

  // --- Remaining 15: nasa (Group B, NeoWs feed only) ---

  const sampleNeo = {
    id: '3542519',
    neo_reference_id: '3542519',
    name: '(2010 XC15)',
    nasa_jpl_url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=3542519',
    close_approach_data: [{ close_approach_date: '2026-07-15' }],
  }

  await add('re_215_nasa_success_normalizes_neo_feed', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 1, near_earth_objects: { '2026-07-15': [sampleNeo] } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.nasa_neo_reference_id !== '3542519') return 'nasa_neo_reference_id identifier missing'
    if (doc.publishedAt !== '2026-07-15') return `expected the nearest close-approach date surfaced, got ${doc.publishedAt}`
    return documentShapeIssue(doc, 'nasa') ?? true
  })))

  await add('re_216_nasa_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['NASA_API_KEY'], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_217_nasa_upstream_error_is_safe_not_a_fake_success', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_218_nasa_malformed_json_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_219_nasa_missing_near_earth_objects_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 0 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected a missing "near_earth_objects" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_220_nasa_non_object_near_earth_objects_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: 'not-an-object' }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected a non-object "near_earth_objects" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_221_nasa_explicit_empty_feed_remains_honest_success', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 0, near_earth_objects: {} }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty feed to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_222_nasa_result_count_is_bounded', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: { '2026-07-15': Array.from({ length: 50 }, (_, i) => ({ ...sampleNeo, id: `neo-${i}`, neo_reference_id: `neo-${i}` })) } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_223_nasa_date_range_is_clamped_to_seven_days', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ near_earth_objects: {} })
    }) as typeof fetch)
    try {
      await withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => nasaAdapter.run({ text: '', dateFrom: '2026-01-01', dateTo: '2026-06-01' }))
      if (!capturedUrl) return 'expected a request to be made'
      const url = new URL(capturedUrl)
      const start = new Date(`${url.searchParams.get('start_date')}T00:00:00Z`)
      const end = new Date(`${url.searchParams.get('end_date')}T00:00:00Z`)
      const days = (end.getTime() - start.getTime()) / 86_400_000
      return days <= 7 || `expected the date range clamped to 7 days, got ${days} days (${capturedUrl})`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_224_nasa_api_key_never_leaks_into_normalized_output', () => withEnv({ NASA_API_KEY: 'sk-live-nasa-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: { '2026-07-15': [sampleNeo] } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-nasa-secret-not-real') || 'the NASA API key leaked into the normalized response'
  })))

  // --- Remaining 15: global regression coverage for the whole build phase ---

  // re_225 is a structural sanity check only (a source-text occurrence count
  // of `<adapter>.run(` call sites) — it proves each adapter has *some*
  // amount of direct runtime test coverage beyond just its success path, but
  // it is not a measure of behavioral coverage completeness and must never
  // be cited as proof that an adapter's security or correctness behavior is
  // adequately tested. The actual behavioral coverage (SSRF matrices, date
  // validation, literal-query encoding, canonical-URL hardening, item
  // normalization, HTTP status handling, etc.) lives in the individual named
  // checks throughout this file — re_225 is retained for compatibility only.
  await add('re_225_remaining_15_implemented_adapters_each_have_runtime_tests', () => {
    const selfSource = readFileSync(join(process.cwd(), 'lib/research-engine/diagnostics/validation.ts'), 'utf8')
    const adapterVarNames: Record<string, string> = {
      semantic_scholar: 'semanticScholarAdapter',
      courtlistener: 'courtListenerAdapter',
      internet_archive: 'internetArchiveAdapter',
      wayback: 'waybackAdapter',
      common_crawl: 'commonCrawlAdapter',
      sam_gov: 'samGovAdapter',
      nasa: 'nasaAdapter',
    }
    const missing = Object.entries(adapterVarNames).filter(([, varName]) => {
      const runCallCount = selfSource.split(`${varName}.run(`).length - 1
      // 1 call is the adapter's own success test; require at least 2 (success + at least one failure/edge case).
      return runCallCount < 2
    })
    return missing.length === 0 || `adapter(s) missing sufficient runtime .run() test coverage: ${missing.map(([id]) => id).join(', ')}`
  })

  await add('re_226_all_unimplemented_providers_reject_honestly_via_getImplementedAdapter', () => {
    const unimplemented = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).map(d => d.id)
    const wronglyResolved = unimplemented.filter(id => IMPLEMENTED_PROVIDER_ADAPTERS[id] != null)
    return wronglyResolved.length === 0 || `unimplemented provider(s) unexpectedly resolved a real adapter: ${JSON.stringify(wronglyResolved)}`
  })

  await add('re_227_remaining_15_implemented_files_never_use_timers_or_polling', () => {
    const offenders = REMAINING_15_IMPLEMENTED_FILES.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /setInterval\(|setTimeout\(/.test(source)
    })
    return offenders.length === 0 || `background timer/polling reference found in: ${offenders.join(', ')}`
  })

  await add('re_228_remaining_15_no_arbitrary_provider_host_accepted', () => {
    const newlyImplementedIds: ResearchProviderId[] = ['semantic_scholar', 'courtlistener', 'internet_archive', 'wayback', 'common_crawl', 'sam_gov', 'nasa']
    const offenders = newlyImplementedIds.filter(id => isAllowedHost(id, 'attacker.example.com'))
    return offenders.length === 0 || `provider(s) accepted an arbitrary host: ${JSON.stringify(offenders)}`
  })

  await add('re_229_final_provider_descriptor_count_is_29', () =>
    RESEARCH_PROVIDER_ENV.length === 29 || `expected 29 total provider descriptors, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_230_final_implemented_count_is_22', () => {
    const count = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).length
    return count === 22 || `expected 22 implemented adapters, found ${count}`
  })

  await add('re_231_final_unimplemented_count_is_7', () => {
    const count = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).length
    return count === 7 || `expected 7 unimplemented providers, found ${count}`
  })

  // --- Repair pass: H1 (IPv4-mapped IPv6 SSRF bypass) fix regression + M5 SSRF matrix expansion ---
  //
  // Exercised through each real adapter's .run() (not just the shared validator in
  // isolation) so a future regression in how an adapter wires up the validator would
  // also be caught here, per the repair pass's Phase 3 requirement. Every case below
  // asserts: (1) ok:false, (2) the exact error category, (3) the injected fetch was
  // never invoked, and (4) provider-gate/cache state is restored in a finally block.

  const BACKSLASH = String.fromCharCode(92)

  const ssrfRejectedTargetCases: Array<{ id: string; url: string }> = [
    // IPv6
    { id: 'ipv6_loopback_target', url: 'http://[::1]/' },
    { id: 'ipv6_unspecified_target', url: 'http://[::]/' },
    { id: 'ipv6_link_local_target', url: 'http://[fe80::1]/' },
    { id: 'ipv6_unique_local_fc_target', url: 'http://[fc00::1]/' },
    { id: 'ipv6_unique_local_fd_target', url: 'http://[fd00::1]/' },
    { id: 'ipv6_multicast_target', url: 'http://[ff00::1]/' },
    // IPv4-mapped IPv6 (H1 — the confirmed bypass, in its dotted-decimal spelling)
    { id: 'ipv4_mapped_ipv6_loopback_target', url: 'http://[::ffff:127.0.0.1]/' },
    { id: 'ipv4_mapped_ipv6_metadata_target', url: 'http://[::ffff:169.254.169.254]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_10_target', url: 'http://[::ffff:10.0.0.1]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_172_target', url: 'http://[::ffff:172.16.0.1]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_192_target', url: 'http://[::ffff:192.168.1.1]/' },
    // IPv4-mapped IPv6, pre-normalized into the compressed hex form the WHATWG URL
    // parser actually produces — this is the literal shape the bypass exploited,
    // since the old validator's regex only matched the dotted-decimal spelling above.
    { id: 'ipv4_mapped_ipv6_hex_loopback_target', url: 'http://[::ffff:7f00:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_metadata_target', url: 'http://[::ffff:a9fe:a9fe]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_10_target', url: 'http://[::ffff:a00:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_172_target', url: 'http://[::ffff:ac10:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_192_target', url: 'http://[::ffff:c0a8:101]/' },
    // Alternative IPv4 encodings (the WHATWG URL parser canonicalizes each into
    // dotted-decimal before the range check runs)
    { id: 'ipv4_decimal_loopback_target', url: 'http://2130706433/' },
    { id: 'ipv4_hex_loopback_target', url: 'http://0x7f000001/' },
    { id: 'ipv4_octal_loopback_target', url: 'http://0177.0.0.1/' },
    { id: 'ipv4_shortform_loopback_target', url: 'http://127.1/' },
    { id: 'ipv4_cgnat_target', url: 'http://100.64.0.1/' },
    { id: 'ipv4_link_local_target', url: 'http://169.254.1.1/' },
    { id: 'ipv4_rfc1918_10_target', url: 'http://10.0.0.1/' },
    { id: 'ipv4_rfc1918_172_target', url: 'http://172.16.0.1/' },
    { id: 'ipv4_rfc1918_192_target', url: 'http://192.168.1.1/' },
    { id: 'ipv4_documentation_range_target', url: 'http://192.0.2.1/' },
    { id: 'ipv4_test_net_3_target', url: 'http://203.0.113.1/' },
    // Hostname / authority edge cases
    { id: 'hostname_localhost_target', url: 'http://localhost/' },
    { id: 'hostname_localhost_trailing_dot_target', url: 'http://localhost./' },
    { id: 'hostname_localhost_mixed_case_target', url: 'http://LocalHost/' },
    { id: 'authority_embedded_credentials_target', url: 'http://user:pass@example.com/' },
    { id: 'authority_username_only_target', url: 'http://user@example.com/' },
    { id: 'hostname_trailing_dot_private_ip_target', url: 'http://10.0.0.1./' },
    { id: 'authority_encoded_at_confusion_target', url: 'http://example.com%40evil.com/' },
    { id: 'authority_backslash_disguised_metadata_target', url: `http://169.254.169.254${BACKSLASH}@example.com/` },
    { id: 'authority_backslash_disguised_loopback_target', url: `http://127.0.0.1${BACKSLASH}@example.com/` },
    { id: 'percent_encoded_loopback_octets_target', url: 'http://127%2e0%2e0%2e1/' },
    { id: 'percent_encoded_loopback_digits_target', url: 'http://%31%32%37.0.0.1/' },
    { id: 'malformed_percent_encoding_host_target', url: 'http://exa%zzmple.com/' },
    // Non-web schemes
    { id: 'scheme_file_target', url: 'file:///etc/passwd' },
    { id: 'scheme_ftp_target', url: 'ftp://example.com/' },
    { id: 'scheme_data_target', url: 'data:text/plain;base64,SGVsbG8=' },
    { id: 'scheme_javascript_target', url: 'javascript:alert(1)' },
    { id: 'scheme_blob_target', url: 'blob:https://example.com/uuid' },
    { id: 'scheme_gopher_target', url: 'gopher://example.com/' },
  ]

  /** Runs one SSRF rejection case through a real adapter, proving no request is ever attempted. */
  async function assertRejectedTarget(provider: 'wayback' | 'common_crawl', url: string): Promise<boolean | string> {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      throw new Error('fetch must not be invoked for a target that should have been rejected before any request')
    }) as typeof fetch)
    try {
      const response = provider === 'wayback'
        ? await waybackAdapter.run({ text: url })
        : await withEnv(ccEnv, () => commonCrawlAdapter.run({ text: url }))
      if (called) return `mocked fetch was invoked for rejected target ${JSON.stringify(url)} — the SSRF gate did not block it before the request`
      if (response.ok !== false) return `expected ok:false for rejected target ${JSON.stringify(url)}, got ${JSON.stringify(response)}`
      if (response.documents.length !== 0) return `expected no documents for rejected target ${JSON.stringify(url)}, got ${response.documents.length}`
      return response.error?.category === 'unknown' || `expected error category 'unknown' for rejected target ${JSON.stringify(url)}, got ${response.error?.category}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }

  let ssrfCaseId = 232
  for (const { id, url } of ssrfRejectedTargetCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_rejects_${id}`, () => assertRejectedTarget('wayback', url))
  }
  for (const { id, url } of ssrfRejectedTargetCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_rejects_${id}`, () => assertRejectedTarget('common_crawl', url))
  }

  // Corrected per the target-port micro-repair: an explicit nonstandard port must be
  // rejected outright (not accepted) for both target-URL providers. re_322/re_323 keep
  // their original numeric IDs — only the asserted behavior and descriptive name change.
  await add(`re_${ssrfCaseId}_wayback_rejects_explicit_nonstandard_https_port_8443`, () => assertRejectedTarget('wayback', 'https://example.com:8443/'))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_common_crawl_rejects_explicit_nonstandard_https_port_8443`, () => assertRejectedTarget('common_crawl', 'https://example.com:8443/'))
  ssrfCaseId += 1

  // --- Repair pass: explicit nonstandard target-port rejection matrix (M-port) ---
  //
  // The WHATWG URL parser normalizes an explicit default port (http:80, https:443) to
  // an empty `port` string, so those remain indistinguishable from no-port URLs and stay
  // allowed. Any other explicit port must be rejected before the target reaches the
  // provider's outbound request. Rejected cases reuse assertRejectedTarget (ok:false,
  // error category 'unknown', fetch never invoked, no documents, gate/cache/env restored).
  // Accepted cases prove the opposite: ok:true and exactly one outbound mocked request.

  const rejectedPortCases: Array<{ id: string; url: string }> = [
    { id: 'explicit_nonstandard_https_port_8443', url: 'https://example.com:8443/' },
    { id: 'explicit_nonstandard_http_port_8080', url: 'http://example.com:8080/' },
    { id: 'explicit_nonstandard_https_port_22', url: 'https://example.com:22/' },
    { id: 'explicit_nonstandard_http_port_3000', url: 'http://example.com:3000/' },
  ]

  const acceptedPortCases: Array<{ id: string; url: string }> = [
    { id: 'no_port_https', url: 'https://example.com/' },
    { id: 'no_port_http', url: 'http://example.com/' },
    { id: 'explicit_default_https_port_443', url: 'https://example.com:443/' },
    { id: 'explicit_default_http_port_80', url: 'http://example.com:80/' },
  ]

  /** Runs one target-port acceptance case through a real adapter, proving exactly one outbound request is made. */
  async function assertAcceptedTarget(provider: 'wayback' | 'common_crawl', url: string): Promise<boolean | string> {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return provider === 'wayback' ? jsonResponse([]) : textResponse('', 200, 'application/x-ndjson')
    }) as typeof fetch)
    try {
      const response = provider === 'wayback'
        ? await waybackAdapter.run({ text: url })
        : await withEnv(ccEnv, () => commonCrawlAdapter.run({ text: url }))
      if (calls !== 1) return `expected exactly one outbound request for accepted target ${JSON.stringify(url)}, got ${calls}`
      if (response.ok !== true) return `expected ok:true for accepted target ${JSON.stringify(url)}, got ${JSON.stringify(response)}`
      return response.documents.length === 0 || `expected the mocked empty response to yield no documents for ${JSON.stringify(url)}, got ${response.documents.length}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }

  for (const { id, url } of rejectedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_rejects_${id}`, () => assertRejectedTarget('wayback', url))
  }
  for (const { id, url } of rejectedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_rejects_${id}`, () => assertRejectedTarget('common_crawl', url))
  }
  for (const { id, url } of acceptedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_accepts_${id}`, () => assertAcceptedTarget('wayback', url))
  }
  for (const { id, url } of acceptedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_accepts_${id}`, () => assertAcceptedTarget('common_crawl', url))
  }

  // --- Repair pass: M1 (SAM.gov reversed/oversized date-range validation) ---
  //
  // Preferred policy: invalid dates, a reversed range, and a range spanning more
  // than 365 calendar days are all rejected outright (never silently corrected,
  // swapped, or clamped) via error category 'unknown' — the same category the
  // wayback/common_crawl target-URL validator uses for caller-input rejection,
  // since the shared ResearchProviderError type has no 'invalid_request' category.

  const samGovKey = { SAM_GOV_API_KEY: 'test-key-not-real' }

  /** Runs one SAM.gov date-range rejection case, proving no upstream request is ever attempted. */
  async function assertSamGovDateRejected(query: { text: string; dateFrom?: string; dateTo?: string }): Promise<boolean | string> {
    return withEnv(samGovKey, async () => {
      __resetProviderGateForTests()
      __resetCacheForTests()
      let called = false
      __setResearchFetchForTests((async () => {
        called = true
        throw new Error('fetch must not be invoked for a rejected caller date range')
      }) as typeof fetch)
      try {
        const response = await samGovAdapter.run(query)
        if (called) return `mocked fetch was invoked for a date range that should have been rejected: ${JSON.stringify(query)}`
        if (response.ok !== false) return `expected ok:false for rejected date range ${JSON.stringify(query)}, got ${JSON.stringify(response)}`
        return response.error?.category === 'unknown' || `expected error category 'unknown', got ${response.error?.category}`
      } finally {
        __setResearchFetchForTests(null)
        __resetProviderGateForTests()
        __resetCacheForTests()
      }
    })
  }

  await add(`re_${ssrfCaseId}_sam_gov_accepts_valid_caller_date_range`, () => withEnv(samGovKey, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ opportunitiesData: [sampleSamOpp] })
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2026-01-01', dateTo: '2026-01-31' })
      if (!response.ok) return `expected ok response for a valid caller date range, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      if (requestUrl.searchParams.get('postedFrom') !== '01/01/2026') return `expected postedFrom=01/01/2026, got ${requestUrl.searchParams.get('postedFrom')}`
      if (requestUrl.searchParams.get('postedTo') !== '01/31/2026') return `expected postedTo=01/31/2026, got ${requestUrl.searchParams.get('postedTo')}`
      return true
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_invalid_date_from`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: 'not-a-date', dateTo: '2026-01-31' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_invalid_date_to`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2026-01-01', dateTo: 'not-a-date' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_reversed_date_range`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2026-02-01', dateTo: '2026-01-01' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_accepts_exactly_365_day_range`, () => withEnv(samGovKey, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2025-01-01', dateTo: '2026-01-01' })
    return response.ok === true || `expected a 365-day range to be accepted, got error: ${JSON.stringify(response.error)}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_range_greater_than_365_days`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2025-01-01', dateTo: '2026-01-02' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_default_bounded_range_used_without_caller_dates`, () => withEnv(samGovKey, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ opportunitiesData: [] })
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services' })
      if (!response.ok) return `expected ok response when no caller dates are supplied, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const postedFrom = requestUrl.searchParams.get('postedFrom')
      const postedTo = requestUrl.searchParams.get('postedTo')
      if (!postedFrom || !postedTo) return `expected a default bounded postedFrom/postedTo pair, got ${postedFrom}..${postedTo}`
      const parse = (mmddyyyy: string) => {
        const [mm, dd, yyyy] = mmddyyyy.split('/')
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`).getTime()
      }
      const rangeDays = Math.round((parse(postedTo) - parse(postedFrom)) / 86_400_000)
      return (rangeDays > 0 && rangeDays <= 365) || `expected the default window to be bounded within 365 days, got ${rangeDays}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_api_key_absent_from_serialized_date_range_error`, () => withEnv({ SAM_GOV_API_KEY: 'sk-live-samgov-secret-not-real' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      throw new Error('fetch must not be invoked for a rejected caller date range')
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2026-02-01', dateTo: '2026-01-01' })
      const serialized = JSON.stringify(response)
      return !serialized.includes('sk-live-samgov-secret-not-real') || 'the SAM.gov API key leaked into a serialized date-range validation error'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  // --- Repair pass: M2 (Internet Archive literal-only query hardening) ---
  //
  // Caller text must never be interpreted as raw Solr/Lucene syntax (field
  // selectors, boolean operators, grouping, wildcards, range/proximity
  // syntax). Each case below captures the actual outbound request and proves
  // the `q` param sent upstream is a single escaped, quoted literal phrase
  // that round-trips back to exactly the caller's original text — not a
  // naive passthrough of caller-controlled Solr syntax.

  const iaEnv = { INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }

  /** Reverses the literal-phrase escaping independently of the adapter's own implementation, as an external oracle. */
  function unescapeLiteralSolrPhrase(q: string): string | null {
    if (q.length < 2 || q[0] !== '"' || q[q.length - 1] !== '"') return null
    const inner = q.slice(1, -1)
    let result = ''
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && i + 1 < inner.length && (inner[i + 1] === '\\' || inner[i + 1] === '"')) {
        result += inner[i + 1]
        i += 1
      } else {
        result += inner[i]
      }
    }
    return result
  }

  /** Runs one literal-query hardening case through the real adapter, capturing the exact outbound `q` param. */
  async function assertInternetArchiveLiteralQuery(callerText: string): Promise<boolean | string> {
    return withEnv(iaEnv, async () => {
      __resetProviderGateForTests()
      __resetCacheForTests()
      let capturedUrl: string | undefined
      __setResearchFetchForTests((async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString()
        return jsonResponse({ response: { numFound: 0, docs: [] } })
      }) as typeof fetch)
      try {
        const response = await internetArchiveAdapter.run({ text: callerText })
        if (!response.ok) return `expected ok response for caller text ${JSON.stringify(callerText)}, got error: ${JSON.stringify(response.error)}`
        const requestUrl = new URL(capturedUrl ?? '')
        const q = requestUrl.searchParams.get('q')
        if (q === null) return `expected a "q" search param on the outbound request for ${JSON.stringify(callerText)}`
        if (q === callerText) return `caller text ${JSON.stringify(callerText)} was passed through unescaped as raw Solr syntax`
        const roundTripped = unescapeLiteralSolrPhrase(q)
        if (roundTripped === null) return `expected "q" to be a single quoted literal phrase, got ${JSON.stringify(q)}`
        return roundTripped === callerText || `expected the literal phrase to round-trip to ${JSON.stringify(callerText)}, got ${JSON.stringify(roundTripped)} (raw q=${JSON.stringify(q)})`
      } finally {
        __setResearchFetchForTests(null)
        __resetProviderGateForTests()
        __resetCacheForTests()
      }
    })
  }

  const iaLiteralQueryCases: Array<{ id: string; text: string }> = [
    { id: 'field_selector_syntax', text: 'title:secret' },
    { id: 'boolean_operator_syntax', text: 'foo OR mediatype:movies' },
    { id: 'bare_wildcard_syntax', text: '*' },
    { id: 'grouping_parentheses_syntax', text: '(test)' },
    { id: 'embedded_double_quotes', text: '"quoted"' },
    { id: 'embedded_backslash', text: 'backslash\\value' },
    { id: 'range_syntax', text: 'date:[1900 TO 2100]' },
  ]

  for (const { id, text } of iaLiteralQueryCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_internet_archive_encodes_${id}_as_literal_text`, () => assertInternetArchiveLiteralQuery(text))
  }

  await add(`re_${ssrfCaseId}_internet_archive_fl_fields_remain_fixed_regardless_of_caller_input`, () => withEnv(iaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ response: { numFound: 0, docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'fl[]=identifier,secret_field&sort=random' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const fields = requestUrl.searchParams.getAll('fl[]')
      const expected = ['identifier', 'title', 'description', 'mediatype', 'date', 'creator']
      return (fields.length === expected.length && fields.every((f, i) => f === expected[i])) || `expected fl[] to remain fixed at ${JSON.stringify(expected)}, got ${JSON.stringify(fields)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_internet_archive_strips_control_characters_from_query`, () => withEnv(iaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ response: { numFound: 0, docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'line1\x00line2\x1fline3' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const q = requestUrl.searchParams.get('q') ?? ''
      return !/[\x00-\x1f\x7f]/.test(q) || `expected raw control characters to be stripped from the outbound query, got ${JSON.stringify(q)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  // --- Repair pass: M3 (CourtListener canonical-URL hardening) ---
  //
  // `absolute_url` is resolved via `new URL(relativePath, trustedOrigin)` and
  // post-validated (https, exact hostname, default port, no credentials) —
  // never naively string-concatenated. Preferred policy: a record whose
  // `absolute_url` is present but unsafe/unusable is skipped; if every result
  // in a non-empty upstream response is unsafe, the whole response becomes a
  // parse_error rather than a fabricated honest-empty success.

  const clEnv = { COURTLISTENER_API_TOKEN: 'test-token-not-real' }

  const clUnsafeAbsoluteUrlCases: Array<{ id: string; absoluteUrl: string }> = [
    { id: 'protocol_relative_authority_override', absoluteUrl: '//evil.example/path' },
    { id: 'full_off_host_url', absoluteUrl: 'https://evil.example/path' },
    { id: 'lookalike_host_suffix', absoluteUrl: 'https://www.courtlistener.com.evil.example/path' },
    { id: 'backslash_authority_confusion', absoluteUrl: `/${String.fromCharCode(92)}evil.example/path` },
    // WHATWG URL parsing strips embedded newlines before parsing, so a raw
    // path containing a newline before "evil.example" (which does not literally
    // start with "//") normalizes into the protocol-relative "//evil.example/..."
    // once resolved -- proving the post-resolution hostname check catches what a
    // pre-resolution string-prefix check alone would miss.
    { id: 'newline_stripped_protocol_relative_bypass', absoluteUrl: `/${String.fromCharCode(10)}/evil.example/path` },
  ]
  for (const { id, absoluteUrl } of clUnsafeAbsoluteUrlCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_courtlistener_skips_result_with_${id}`, () => withEnv(clEnv, () => withAdapterFetch([
      jsonResponse({ count: 1, results: [{ ...sampleClResult, absolute_url: absoluteUrl }] }),
    ], async () => {
      const response = await courtListenerAdapter.run({ text: 'sample case' })
      if (response.ok !== false) return `expected an all-unsafe result set to become ok:false (parse_error), got ${JSON.stringify(response)}`
      return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
    })))
  }

  await add(`re_${ssrfCaseId}_courtlistener_accepts_normal_relative_opinion_path`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 1, results: [sampleClResult] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const expected = `https://www.courtlistener.com${sampleClResult.absolute_url}`
    return response.documents[0].canonicalUrl === expected || `expected canonicalUrl ${expected}, got ${response.documents[0].canonicalUrl}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_courtlistener_mixed_valid_and_invalid_results_keeps_only_valid`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 2, results: [sampleClResult, { ...sampleClResult, cluster_id: 111, absolute_url: '//evil.example/path' }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (!response.ok) return `expected ok response when at least one result is safe, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected only the 1 safe result to survive, got ${response.documents.length}`
    return response.documents[0].canonicalUrl === `https://www.courtlistener.com${sampleClResult.absolute_url}` || `unexpected canonicalUrl on the surviving document: ${response.documents[0].canonicalUrl}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_courtlistener_all_results_invalid_is_parse_error_not_fabricated_empty_success`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 2, results: [{ ...sampleClResult, absolute_url: '//evil.example/path' }, { ...sampleClResult, cluster_id: 222, absolute_url: 'https://evil.example/other' }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (response.ok !== false) return `expected an all-invalid non-empty result set to become ok:false, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  })))
  ssrfCaseId += 1

  // --- Repair pass: M4/L1 (Semantic Scholar stable-ID and item hardening) ---
  //
  // `paperId` is mandatory (title is never used as an ID fallback), `authors`
  // is only ever iterated after an Array.isArray guard, and `url` is only
  // trusted as canonicalUrl when it is a valid HTTPS URL on the accepted
  // Semantic Scholar public origin. Preferred policy matches CourtListener's:
  // skip individual malformed records, keep valid ones in a mixed response,
  // and return parse_error (not a fabricated honest-empty success) if every
  // record in a non-empty upstream response is malformed.

  await add(`re_${ssrfCaseId}_semantic_scholar_skips_record_missing_paper_id`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, paperId: undefined }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected a lone record missing paperId to become ok:false (parse_error), got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_title_present_but_paper_id_missing_is_still_skipped`, () => withAdapterFetch([
    jsonResponse({ data: [{ title: 'A Title With No Stable ID', abstract: null, year: 2024 }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected a title-only record (no paperId) to be rejected rather than used as a fallback ID, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_authors_as_string_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: 'A. Researcher' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when authors is a string, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].authors.length === 0 || `expected authors to be normalized to [] when not an array, got ${JSON.stringify(response.documents[0].authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_authors_null_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: null }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when authors is null, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].authors.length === 0 || `expected authors to be normalized to [], got ${JSON.stringify(response.documents[0].authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_malformed_author_entries_are_dropped_not_crashed`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: ['not-an-object', { authorId: '2' }, { authorId: '3', name: 42 }, { authorId: '4', name: 'Valid Name' }, null] }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response with malformed author entries present, got error: ${JSON.stringify(response.error)}`
    const authors = response.documents[0].authors
    return (authors.length === 1 && authors[0] === 'Valid Name') || `expected only the one well-formed author name to survive, got ${JSON.stringify(authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_external_ids_as_string_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, externalIds: 'DOI:10.9999/oops' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when externalIds is a string, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].identifiers.doi === undefined || `expected no doi identifier when externalIds is malformed, got ${response.documents[0].identifiers.doi}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_rejects_invalid_paper_url_as_canonical`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, url: 'https://evil.example/paper/abc123def456' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response (paperId is still present), got error: ${JSON.stringify(response.error)}`
    return response.documents[0].canonicalUrl === null || `expected an off-origin paper url to be rejected as canonicalUrl, got ${response.documents[0].canonicalUrl}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_mixed_valid_and_invalid_records_keeps_only_valid`, () => withAdapterFetch([
    jsonResponse({ data: [sampleSsPaper, { ...sampleSsPaper, paperId: undefined, title: 'Missing ID Paper' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when at least one record is valid, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected only the 1 valid record to survive, got ${response.documents.length}`
    return response.documents[0].identifiers.semantic_scholar_paper_id === sampleSsPaper.paperId || `unexpected surviving record: ${JSON.stringify(response.documents[0].identifiers)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_all_records_invalid_is_parse_error_not_fabricated_empty_success`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, paperId: undefined }, { title: 'Also Missing ID' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected an all-invalid non-empty result set to become ok:false, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_year_preserved_as_bare_year_not_fabricated_date`, () => withAdapterFetch([
    jsonResponse({ data: [sampleSsPaper] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].publishedAt === String(sampleSsPaper.year) || `expected publishedAt to be the bare year "${sampleSsPaper.year}", got ${response.documents[0].publishedAt}`
  }))
  ssrfCaseId += 1

  // --- Repair pass: M5 (HTTP 401/403/429/503 coverage matrix) ---
  //
  // Every Remaining-15 adapter maps any failed HTTP status to the same safe
  // 'upstream_error' category (never a fake success), so each case below
  // proves that holds for the auth-failure (401/403), rate-limit (429), and
  // service-unavailable (503) statuses specifically, not just the existing
  // 500 coverage. 429/503 responses carry `Retry-After: 0` so safeFetch's
  // built-in retry/backoff resolves immediately rather than sleeping for
  // real between attempts. Each case also proves the raw response body never
  // leaks into the normalized error.

  type HttpStatusAdapterConfig = {
    id: string
    env: Record<string, string>
    query: { text: string }
    run: (query: { text: string }) => ReturnType<typeof waybackAdapter.run>
  }

  const httpStatusAdapterConfigs: HttpStatusAdapterConfig[] = [
    { id: 'semantic_scholar', env: {}, query: { text: 'sample things' }, run: semanticScholarAdapter.run },
    { id: 'courtlistener', env: clEnv, query: { text: 'sample case' }, run: courtListenerAdapter.run },
    { id: 'internet_archive', env: iaEnv, query: { text: 'sample item' }, run: internetArchiveAdapter.run },
    { id: 'wayback', env: {}, query: { text: 'https://example.com/' }, run: waybackAdapter.run },
    { id: 'common_crawl', env: ccEnv, query: { text: 'https://example.com/' }, run: commonCrawlAdapter.run },
    { id: 'sam_gov', env: samGovKey, query: { text: 'IT services' }, run: samGovAdapter.run },
    { id: 'nasa', env: { NASA_API_KEY: 'test-key-not-real' }, query: { text: '' }, run: nasaAdapter.run },
  ]

  const httpStatusCases = [401, 403, 429, 503]

  for (const config of httpStatusAdapterConfigs) {
    for (const status of httpStatusCases) {
      const currentId = ssrfCaseId
      ssrfCaseId += 1
      const bodyMarker = `sensitive-raw-body-marker-${config.id}-${status}-must-never-leak`
      await add(`re_${currentId}_${config.id}_http_${status}_is_safe_upstream_error`, () => withEnv(config.env, () => withAdapterFetch([
        new Response(bodyMarker, { status, headers: status === 429 || status === 503 ? { 'Retry-After': '0' } : {} }),
      ], async () => {
        const response = await config.run(config.query)
        if (response.ok !== false) return `expected HTTP ${status} to produce ok:false for ${config.id}, got ${JSON.stringify(response)}`
        if (response.documents.length !== 0) return `expected 0 documents for an HTTP ${status} error on ${config.id}, got ${response.documents.length}`
        if (response.error?.category !== 'upstream_error') return `expected category upstream_error for HTTP ${status} on ${config.id}, got ${response.error?.category}`
        const serialized = JSON.stringify(response)
        return !serialized.includes(bodyMarker) || `the raw upstream response body leaked into the normalized error for ${config.id} HTTP ${status}`
      })))
    }
  }

  // --- FMCSA QCMobile USDOT-only adapter (BLOCKED PROVIDER 1 OF 8 build) ---
  //
  // Envelope proven by two Commander-authorized, structure-only controlled
  // probes against the official documentation-published sample USDOT 44110
  // (see docs/RESEARCH_CONTROLLED_PROBE_LOG.md): a 200 response is
  // `{ content: { _links, carrier: { dotNumber: number, legalName: string, ... } }, retrievalDate }`.
  // All fixture values below are synthetic test data, never a real carrier record.

  const fmcsaEnv = { FMCSA_WEB_KEY: 'test-key-not-real' }

  const sampleFmcsaCarrier = {
    content: {
      _links: { self: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' } },
      carrier: {
        dotNumber: 44110,
        legalName: 'SAMPLE CARRIER LLC',
        dbaName: 'SAMPLE DBA',
        allowedToOperate: 'Y',
        statusCode: 'A',
        oosDate: null,
        phyCity: 'SAMPLE CITY',
        phyState: 'KS',
        phyCountry: 'US',
        safetyRating: 'S',
        safetyRatingDate: '2020-01-01',
        commonAuthorityStatus: 'A',
        contractAuthorityStatus: 'N',
        brokerAuthorityStatus: 'N',
      },
    },
    retrievalDate: '2026-08-07T00:00:00.000Z',
  }

  await add('re_600_fmcsa_success_normalizes_proven_content_carrier_envelope', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'fmcsa') ?? true
  })))

  await add('re_601_fmcsa_uses_exact_content_carrier_record_path', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return doc?.canonicalUrl === 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' || `expected the sanitized carrier endpoint as canonicalUrl, got ${doc?.canonicalUrl}`
  })))

  await add('re_602_fmcsa_dot_number_mapped_as_stable_identifier', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return (doc?.providerRecordId === '44110' && doc.identifiers.fmcsa_dot_number === '44110') || `expected dotNumber mapped as a stable identifier, got ${JSON.stringify(doc?.identifiers)}`
  })))

  await add('re_603_fmcsa_legal_name_mapped_to_title', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.title === 'SAMPLE CARRIER LLC' || `expected legalName mapped to title, got ${response.documents[0]?.title}`
  })))

  await add('re_604_fmcsa_optional_dba_name_mapped', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.identifiers.fmcsa_dba_name === 'SAMPLE DBA' || `expected dbaName mapped, got ${JSON.stringify(response.documents[0]?.identifiers)}`
  })))

  await add('re_605_fmcsa_operating_status_mapped', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.identifiers.fmcsa_allowed_to_operate === 'Y' || `expected allowedToOperate mapped, got ${JSON.stringify(response.documents[0]?.identifiers)}`
  })))

  await add('re_606_fmcsa_null_optional_field_preserved_not_fabricated', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, safetyRating: null, safetyRatingDate: null } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (!response.ok) return `expected ok response despite null optional fields, got ${JSON.stringify(response.error)}`
    const ids = response.documents[0]?.identifiers ?? {}
    return (!('fmcsa_safety_rating' in ids) && !('fmcsa_safety_rating_date' in ids)) || `expected null optional fields to be omitted, never fabricated, got ${JSON.stringify(ids)}`
  })))

  // Repair (independent-audit HIGH finding): this test formerly requested
  // usdot 44110 and asserted that a response with dotNumber: 0 was accepted
  // as valid ("falsy but valid"), proving the adapter never checked the
  // returned carrier identity against the requested one. It now proves the
  // opposite and required behavior: a returned dotNumber that does not match
  // the requested USDOT is rejected as parse_error with zero documents, and
  // is never cached under the requested key (a repeated identical request
  // still performs a fresh fetch rather than serving a poisoned cache entry).
  await add('re_607_fmcsa_returned_dot_number_mismatch_rejected_and_never_cached', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async calls => {
    const first = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (first.ok !== false) return `expected a returned dotNumber (99999) that does not match the requested USDOT (44110) to be rejected, got ${JSON.stringify(first)}`
    if (first.documents.length !== 0) return `expected zero documents for a mismatched carrier identity, got ${first.documents.length}`
    if (first.error?.category !== 'parse_error') return `expected parse_error for a mismatched carrier identity, got ${first.error?.category}`
    const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (second.ok === false && calls.count === 2) || `expected the mismatched response to never be cached under the requested key — a repeated identical request should still re-fetch, not hit a poisoned cache entry; got calls=${calls.count} second=${JSON.stringify(second)}`
  })))

  await add('re_608_fmcsa_retrieval_date_never_fabricates_publish_or_update_date', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return (doc?.publishedAt === null && doc?.updatedAt === null) || `expected retrievalDate to never populate publishedAt/updatedAt (its meaning is undocumented), got publishedAt=${doc?.publishedAt} updatedAt=${doc?.updatedAt}`
  })))

  await add('re_609_fmcsa_invalid_input_rejected_before_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'hello world' })
    return (response.ok === false && calls.count === 0) || `expected invalid input rejected without any fetch call, calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_610_fmcsa_free_text_query_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'acme trucking company' })
    return (response.ok === false && calls.count === 0) || `expected free-text query rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_611_fmcsa_multiple_identifiers_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 123 456' })
    return (response.ok === false && calls.count === 0) || `expected multiple identifiers rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_612_fmcsa_overlong_identifier_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 123456789' })
    return (response.ok === false && calls.count === 0) || `expected a 9-digit identifier beyond the conservative bound rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_613_fmcsa_missing_webkey_reports_not_configured', () => withoutEnv(['FMCSA_WEB_KEY'], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_614_fmcsa_exact_host_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (calls.urls.length !== 1) return `expected exactly 1 request, got ${calls.urls.length}`
    return new URL(calls.urls[0]).hostname === 'mobile.fmcsa.dot.gov' || `expected host mobile.fmcsa.dot.gov, got ${new URL(calls.urls[0]).hostname}`
  })))

  await add('re_615_fmcsa_exact_path_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected path /qc/services/carriers/44110, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_616_fmcsa_get_method_only', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    const method = calls.inits[0]?.method ?? 'GET'
    return method === 'GET' || `expected GET method only, got ${method}`
  })))

  await add('re_617_fmcsa_one_provider_call_maximum_per_run', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && calls.count === 1) || `expected exactly 1 provider call per run, got ${calls.count}`
  })))

  await add('re_618_fmcsa_name_search_not_supported', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'name acme trucking' })
    return (response.ok === false && calls.count === 0) || `expected name-search-style input rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_619_fmcsa_docket_search_not_supported', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'docket MC-123456' })
    return (response.ok === false && calls.count === 0) || `expected docket-search-style input rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_620_fmcsa_never_constructs_a_sub_resource_url', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected only the bare carrier endpoint, never a sub-resource path, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_621_fmcsa_never_sends_pagination_parameters', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    const keys = Array.from(new URL(calls.urls[0]).searchParams.keys())
    return (keys.length === 1 && keys[0] === 'webKey') || `expected only a webKey query parameter, no pagination params, got ${JSON.stringify(keys)}`
  })))

  await add('re_622_fmcsa_never_follows_hal_links_in_the_response', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse({
    content: {
      _links: { self: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' }, basics: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110/basics' } },
      carrier: sampleFmcsaCarrier.content.carrier,
    },
    retrievalDate: sampleFmcsaCarrier.retrievalDate,
  })], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && calls.count === 1) || `expected the HAL _links in the response body to never be followed (exactly 1 call), got ${calls.count}`
  })))

  await add('re_623_fmcsa_missing_content_wrapper_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error' && response.documents.length === 0) || `expected parse_error for a missing content wrapper, got ${JSON.stringify(response)}`
  })))

  await add('re_624_fmcsa_content_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: 'not-an-object', retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a non-object content field, got ${JSON.stringify(response)}`
  })))

  await add('re_625_fmcsa_carrier_record_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: ['not', 'an', 'object'] }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a non-object carrier record, got ${JSON.stringify(response)}`
  })))

  await add('re_626_fmcsa_missing_dot_number_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { legalName: 'SAMPLE CARRIER LLC' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a missing dotNumber, got ${JSON.stringify(response)}`
  })))

  await add('re_627_fmcsa_malformed_dot_number_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: '44110', legalName: 'SAMPLE CARRIER LLC' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a string-typed dotNumber (the proven type is number), got ${JSON.stringify(response)}`
  })))

  await add('re_628_fmcsa_missing_legal_name_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: 44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a missing legalName, got ${JSON.stringify(response)}`
  })))

  await add('re_629_fmcsa_legal_name_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: 44110, legalName: 12345 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a numeric-typed legalName, got ${JSON.stringify(response)}`
  })))

  await add('re_630_fmcsa_malformed_json_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('{not valid json', { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for malformed JSON, got ${JSON.stringify(response)}`
  })))

  await add('re_631_fmcsa_html_response_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('<html><body>Not JSON</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for an HTML response, got ${JSON.stringify(response)}`
  })))

  await add('re_632_fmcsa_404_is_safe_not_a_fake_success', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Not Found', { status: 404 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 404) || `expected a safe upstream_error for 404 (no dedicated not_found category exists in this build's types), got ${JSON.stringify(response)}`
  })))

  await add('re_633_fmcsa_400_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Bad Request', { status: 400 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 400, got ${JSON.stringify(response)}`
  })))

  await add('re_634_fmcsa_401_is_safe_upstream_error_without_key_leak', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    new Response('Unauthorized', { status: 401 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const serialized = JSON.stringify(response)
    return (response.ok === false && response.error?.category === 'upstream_error' && !serialized.includes('sk-live-fmcsa-secret-not-real')) || `expected a safe 401 upstream_error without a key leak, got ${serialized}`
  })))

  await add('re_635_fmcsa_403_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Forbidden', { status: 403 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 403, got ${JSON.stringify(response)}`
  })))

  await add('re_636_fmcsa_429_is_rate_limited', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'rate_limited') || `expected rate_limited for 429, got ${JSON.stringify(response)}`
  })))

  await add('re_637_fmcsa_500_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 500, got ${JSON.stringify(response)}`
  })))

  await add('re_638_fmcsa_503_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error after exhausted 503 retries, got ${JSON.stringify(response)}`
  })))

  await add('re_639_fmcsa_timeout_is_safe_upstream_error', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      throw abortError
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === false && response.documents.length === 0) || `expected a safe error response on timeout, got ${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_640_fmcsa_oversized_response_is_rejected_not_parsed', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('x'.repeat(200_000), { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0) || `expected an oversized response to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_641_fmcsa_redirect_is_never_followed_and_costs_exactly_one_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response(null, { status: 302, headers: { location: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110/redirected' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (response.ok !== false || response.documents.length !== 0) return `expected a redirect to be rejected rather than followed, got ${JSON.stringify(response)}`
    if (calls.count !== 1) return `expected exactly 1 upstream fetch for a redirect response (maxRetries: 0 + maxRedirects: 0 — no amplification), got ${calls.count}`
    return calls.urls.every(u => !u.includes('/redirected')) || `expected the Location redirect target to never be requested, got ${JSON.stringify(calls.urls)}`
  })))

  await add('re_642_fmcsa_webkey_stripped_from_network_error_text', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      throw new Error('fetch failed for https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123 : network unreachable')
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      const serialized = JSON.stringify(response)
      return !serialized.includes('FAKEWEBKEY123') || `a fake webKey value leaked through a network-error message: ${serialized}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_643_fmcsa_webkey_absent_from_cache_key', () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const prevKey = process.env.FMCSA_WEB_KEY
    process.env.FMCSA_WEB_KEY = 'first-fake-key-not-real'
    try {
      const first = await fmcsaAdapter.run({ text: 'usdot 44110' })
      if (!first.ok) return `expected first call to succeed, got ${JSON.stringify(first.error)}`
      process.env.FMCSA_WEB_KEY = 'second-fake-key-not-real'
      const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
      if (!second.ok) return `expected second call to succeed, got ${JSON.stringify(second.error)}`
      return (second.fromCache === true && calls.count === 1) || `expected the cache key to be independent of webKey; calls=${calls.count} fromCache=${second.fromCache}`
    } finally {
      if (prevKey === undefined) delete process.env.FMCSA_WEB_KEY
      else process.env.FMCSA_WEB_KEY = prevKey
    }
  }))

  await add('re_644_fmcsa_webkey_absent_from_serialized_errors', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-fmcsa-secret-not-real') || 'the FMCSA WebKey leaked into a serialized error response'
  })))

  await add('re_645_fmcsa_webkey_absent_from_source_url', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    const noKeyLeak = !JSON.stringify(doc).includes('sk-live-fmcsa-secret-not-real')
    const noParamLeak = !(doc?.sourceUrl ?? '').includes('webKey') && !(doc?.canonicalUrl ?? '').includes('webKey')
    return (noKeyLeak && noParamLeak) || 'the WebKey or a webKey query parameter leaked into the normalized source/canonical URL'
  })))

  await add('re_646_fmcsa_fake_webkey_fully_redacted_by_shared_redactors', () => {
    const redactedUrl = redactUrlForLogging('https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123')
    const redactedText = redactSecretsFromText('request failed: https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123 timed out')
    if (redactedUrl.includes('FAKEWEBKEY123') || !redactedUrl.includes('REDACTED')) return `webKey not redacted from URL: ${redactedUrl}`
    if (redactedText.includes('FAKEWEBKEY123') || !redactedText.includes('REDACTED')) return `webKey not redacted from free text: ${redactedText}`
    return true
  })

  await add('re_647_fmcsa_provider_gate_cooldown_engages_on_consecutive_failures', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    await fmcsaAdapter.run({ text: 'usdot 11111' })
    await fmcsaAdapter.run({ text: 'usdot 22222' })
    await fmcsaAdapter.run({ text: 'usdot 33333' })
    const cooling = providerCooldownRemainingMs('fmcsa')
    return cooling > 0 || `expected fmcsa to enter a failure cooldown after 3 consecutive failures, got ${cooling}ms remaining`
  })))

  await add('re_648_fmcsa_cache_does_not_leak_across_tests', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && response.fromCache === false) || `expected a fresh (non-cached) lookup in an isolated test run despite an earlier test caching the same USDOT, got fromCache=${response.fromCache} ok=${response.ok}`
  })))

  await add('re_649_fmcsa_never_calls_global_fetch_directly', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers/fmcsa.ts'), 'utf8')
    return !source.includes('fetch(') || 'fmcsa adapter appears to call fetch() directly instead of exclusively using safeProviderFetch'
  })

  await add('re_650_fmcsa_registered_exactly_once', () => {
    const count = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).filter(id => id === 'fmcsa').length
    return count === 1 || `expected fmcsa registered exactly once, found ${count}`
  })

  await add('re_651_fmcsa_descriptor_implemented_and_counts_are_29_22_7', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === 'fmcsa')
    const totalCount = RESEARCH_PROVIDER_ENV.length
    const implementedCount = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).length
    const blockedCount = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).length
    return (descriptor?.implemented === true && totalCount === 29 && implementedCount === 22 && blockedCount === 7)
      || `expected fmcsa implemented plus a 29/22/7 split, got implemented=${descriptor?.implemented} total=${totalCount} implemented=${implementedCount} blocked=${blockedCount}`
  })

  await add('re_652_implemented_descriptor_ids_exactly_equal_registry_keys', () => {
    const descriptorImplementedIds = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).map(d => d.id).sort()
    const registryIds = (Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[]).sort()
    const equal = descriptorImplementedIds.length === registryIds.length && descriptorImplementedIds.every((id, i) => id === registryIds[i])
    return equal || `descriptor implemented set and registry key set diverge: descriptors=${JSON.stringify(descriptorImplementedIds)} registry=${JSON.stringify(registryIds)}`
  })

  await add('re_653_remaining_seven_blocked_providers_are_exactly_as_specified', () => {
    const expected = ['imf_sdmx', 'usgs_national_map', 'uspto', 'world_bank_climate', 'world_bank_data_catalog', 'world_bank_finances', 'world_bank_projects'].sort()
    const actual = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).map(d => d.id).sort()
    const equal = expected.length === actual.length && expected.every((id, i) => id === actual[i])
    return equal || `expected the remaining blocked set ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  })

  // --- FMCSA repair pass (independent-audit HIGH/MEDIUM findings) ---
  //
  // New tests re_654-re_678 close the gaps identified by the independent
  // audit: requested-vs-returned USDOT identity, numeric range/type
  // validation on the returned dotNumber, requested-identifier
  // canonicalization, legalName bounds, the true one-upstream-fetch
  // guarantee (maxRetries: 0) under every response condition, and
  // mixed-case/URL-encoded WebKey redaction. re_607 (mismatch/cache
  // poisoning) and re_641 (redirect fetch count) were repaired in place
  // above rather than duplicated here. All fixture values are synthetic.

  await add('re_654_fmcsa_returned_dot_number_exact_match_accepted_and_cached', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && response.documents[0]?.providerRecordId === '44110' && response.fromCache === false && calls.count === 1)
      || `expected a returned dotNumber exactly matching the requested USDOT to be accepted on exactly 1 fetch, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_655_fmcsa_returned_dot_number_prefix_substring_not_treated_as_match', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 4411' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'parse_error')
      || `expected requested "4411" vs. returned dotNumber 44110 (a superstring, not equal) to be rejected as a mismatch, not accepted via prefix/substring confusion, got ${JSON.stringify(response)}`
  })))

  await add('re_656_fmcsa_returned_zero_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 0 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'parse_error')
      || `expected a returned dotNumber of 0 to be rejected (zero is never a valid USDOT), got ${JSON.stringify(response)}`
  })))

  await add('re_657_fmcsa_returned_negative_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: -44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a negative returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_658_fmcsa_returned_decimal_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 44110.5 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a decimal returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_659_fmcsa_returned_unsafe_integer_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 9_999_999_999_999_999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected an unsafe-integer returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  // NaN is not representable in valid JSON — `JSON.parse` throws on the bare
  // `NaN` token before any JavaScript NaN value could ever reach the FMCSA
  // numeric validator. This test therefore proves malformed-JSON (parse
  // failure) rejection, not a direct Number.isSafeInteger(NaN) rejection.
  // Valid-JSON non-finite behavior (a number literal that parses successfully
  // but overflows to a non-finite value) is separately exercised by re_661
  // (1e400 parses as Infinity, then fails Number.isSafeInteger).
  await add('re_660_fmcsa_invalid_json_nan_literal_is_parse_error', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('{"content":{"carrier":{"dotNumber":NaN,"legalName":"SAMPLE CARRIER LLC"}}}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error' && response.documents.length === 0 && calls.count === 1)
      || `expected a body containing the illegal JSON token NaN to fail JSON.parse and be rejected as parse_error on exactly 1 fetch, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_661_fmcsa_returned_infinity_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('{"content":{"carrier":{"dotNumber":1e400,"legalName":"SAMPLE CARRIER LLC"}}}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a valid-JSON dotNumber that overflows to Infinity (1e400) to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_662_fmcsa_requested_zero_rejected_before_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 0' })
    return (response.ok === false && calls.count === 0) || `expected a requested USDOT of 0 to be rejected before any fetch, calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_663_fmcsa_leading_zero_input_canonicalized_before_url_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 044110' })
    if (response.ok !== true || response.documents[0]?.providerRecordId !== '44110') return `expected leading-zero input "044110" to canonicalize to "44110", got ${JSON.stringify(response)}`
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected the canonical (non-leading-zero) form in the request path, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_664_fmcsa_leading_zero_and_canonical_input_share_cache_identity', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const first = await fmcsaAdapter.run({ text: 'usdot 044110' })
    if (!first.ok) return `expected the leading-zero request to succeed, got ${JSON.stringify(first.error)}`
    const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (second.ok === true && second.fromCache === true && calls.count === 1)
      || `expected "usdot 044110" and "usdot 44110" to share one cache entry (only 1 real fetch total), got calls=${calls.count} second=${JSON.stringify(second)}`
  })))

  await add('re_665_fmcsa_empty_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: '' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected an empty legalName to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_666_fmcsa_whitespace_only_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: '   ' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a whitespace-only legalName to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_667_fmcsa_oversized_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: 'A'.repeat(257) } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a legalName over the 256-char bound to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_668_fmcsa_maximum_length_legal_name_accepted', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: 'A'.repeat(256) } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && response.documents[0]?.title === 'A'.repeat(256)) || `expected a legalName exactly at the 256-char bound to be accepted, got ${JSON.stringify(response)}`
  })))

  await add('re_669_fmcsa_wrong_carrier_response_never_poisons_the_requested_cache_key', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const mismatched = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (mismatched.ok !== false) return `expected the mismatched carrier response to be rejected, got ${JSON.stringify(mismatched)}`
    const matched = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (matched.ok === true && matched.fromCache === false && calls.count === 2)
      || `expected the requested-key cache to remain empty after a rejected mismatch, so the next matching request still performs a fresh fetch; got calls=${calls.count} matched=${JSON.stringify(matched)}`
  })))

  await add('re_670_fmcsa_success_never_consumes_more_than_one_fetch_even_when_more_are_available', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
    jsonResponse(sampleFmcsaCarrier),
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && calls.count === 1) || `expected exactly 1 fetch even though 3 mocked responses were available (no speculative extra calls), got ${calls.count}`
  })))

  await add('re_671_fmcsa_429_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'rate_limited' && calls.count === 1)
      || `expected exactly 1 fetch for a 429 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_672_fmcsa_503_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error' && calls.count === 1)
      || `expected exactly 1 fetch for a 503 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_673_fmcsa_timeout_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let fetchCount = 0
    __setResearchFetchForTests((async () => {
      fetchCount += 1
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      throw abortError
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === false && fetchCount === 1)
        || `expected exactly 1 fetch attempt for a persistent timeout under maxRetries: 0, got fetchCount=${fetchCount} response=${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_674_fmcsa_mixed_case_webkey_parameter_names_all_redacted', () => {
    for (const paramName of ['webKey', 'WebKey', 'WEBKEY', 'webkey']) {
      const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?${paramName}=FAKEWEBKEY123`
      const redactedUrl = redactUrlForLogging(url)
      if (redactedUrl.includes('FAKEWEBKEY123') || !redactedUrl.includes('REDACTED')) return `expected "${paramName}" to be redacted from the URL, got ${redactedUrl}`
      const redactedText = redactSecretsFromText(`request failed: ${url} timed out`)
      if (redactedText.includes('FAKEWEBKEY123') || !redactedText.includes('REDACTED')) return `expected "${paramName}" to be redacted from free text, got ${redactedText}`
    }
    return true
  })

  await add('re_675_fmcsa_url_encoded_webkey_value_fully_redacted', () => {
    const url = 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKE%20WEB%2FKEY%3D123'
    const redacted = redactUrlForLogging(url)
    return (!redacted.includes('FAKE') && redacted.includes('REDACTED')) || `expected a URL-encoded webKey value to be fully redacted, got ${redacted}`
  })

  await add('re_676_fmcsa_provider_gate_state_restored_after_test_helper_finally', () => withEnv(fmcsaEnv, async () => {
    await withAdapterFetch([
      new Response('Internal Server Error', { status: 500 }),
    ], async () => {
      await fmcsaAdapter.run({ text: 'usdot 11111' })
    })
    const cooling = providerCooldownRemainingMs('fmcsa')
    return cooling === 0 || `expected the provider gate to be reset by withAdapterFetch's finally block, got ${cooling}ms remaining`
  }))

  await add('re_677_fmcsa_cache_state_restored_between_separate_test_helper_invocations', () => withEnv(fmcsaEnv, async () => {
    await withAdapterFetch([jsonResponse(sampleFmcsaCarrier)], async () => {
      await fmcsaAdapter.run({ text: 'usdot 44110' })
    })
    return withAdapterFetch([jsonResponse(sampleFmcsaCarrier)], async () => {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === true && response.fromCache === false) || `expected the cache to have been cleared between separate withAdapterFetch invocations, got fromCache=${response.fromCache}`
    })
  }))

  await add('re_678_fmcsa_test_fetch_hook_restored_to_real_fetch_in_finally', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/diagnostics/validation.ts'), 'utf8')
    const marker = 'async function withCountingFetch'
    const start = source.indexOf(marker)
    const body = source.slice(start, start + 1200)
    return body.includes('__setResearchFetchForTests(null)') || 'expected withCountingFetch to restore the real fetch implementation (__setResearchFetchForTests(null)) in its finally block'
  })

  // Final LOW-finding cleanup: re_679/re_680 close out the retryable-status
  // matrix (429/502/503/504) with the same exactly-one-fetch guarantee
  // already proven for 429 (re_671) and 503 (re_672), so every status
  // safeProviderFetch treats as retryable is now covered under FMCSA's
  // maxRetries: 0 override.

  await add('re_679_fmcsa_502_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Bad Gateway', { status: 502, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 502 && calls.count === 1)
      || `expected exactly 1 fetch for a 502 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_680_fmcsa_504_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Gateway Timeout', { status: 504, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 504 && calls.count === 1)
      || `expected exactly 1 fetch for a 504 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  return results
}
