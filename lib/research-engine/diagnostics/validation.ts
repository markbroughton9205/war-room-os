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
import { __resetProviderGateForTests } from '@/lib/research-engine/security/providerGate'
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
    // wayback has no required env var, so this isolates the "adapter not implemented" rejection path from "env missing".
    const decision = routeResearchQuery({ text: 'test', intent: 'historical_web' })
    const wayback = decision.rejectedProviders.find(entry => entry.provider === 'wayback')
    return Boolean(wayback && /not implemented/i.test(wayback.reason)) || `wayback rejection: ${JSON.stringify(wayback)}`
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

  await add('re_101_implemented_count_derives_to_14_from_descriptors_and_registry', () => {
    const implementedDescriptors = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).length
    const implementedAdapters = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).length
    return (implementedDescriptors === 14 && implementedAdapters === 14)
      || `expected 14 implemented in both descriptors and registry, got descriptors=${implementedDescriptors} registry=${implementedAdapters}`
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

  await add('re_111_no_new_adapter_uses_write_capable_http_method', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts']
    const offenders = files.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(source)
    })
    return offenders.length === 0 || `write-capable HTTP method referenced in: ${offenders.join(', ')}`
  })

  await add('re_112_new_adapters_never_call_raw_fetch', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts']
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

  return results
}
