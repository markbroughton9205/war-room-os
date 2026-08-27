/**
 * Deterministic regression suite for Terra Related Intelligence normalization — media-type
 * classification (including honest "official source" gating) and provider-status/empty-result
 * normalization. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/relatedIntelligence.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { normalizeTerraRelatedIntelligence } from './relatedIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'exa:https://example.com/article',
    provider: 'exa',
    providerRecordId: 'https://example.com/article',
    title: 'Earthquake strikes Solomon Islands',
    summary: 'A magnitude 4.9 earthquake struck near Lata.',
    contentSnippet: 'A magnitude 4.9 earthquake struck near Lata.',
    canonicalUrl: 'https://example.com/article',
    sourceUrl: 'https://example.com/article',
    sourceName: 'Exa',
    contentType: 'web_page',
    authors: [],
    organization: null,
    publishedAt: '2026-08-26T10:05:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-26T10:06:00.000Z',
    geography: null,
    language: null,
    identifiers: {},
    subjects: [],
    license: null,
    accessStatus: 'unknown',
    score: null,
    providerRank: 1,
    citations: [],
    provenance: { provider: 'exa', sourceUrl: 'https://example.com/article', retrievedAt: '2026-08-26T10:06:00.000Z', requestDurationMs: 200, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return {
    provider: 'exa',
    ok: true,
    documents: [],
    timeSeries: [],
    geoFeatures: [],
    entities: [],
    error: null,
    durationMs: 200,
    fromCache: false,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- A ReliefWeb humanitarian report is labeled official_report + isOfficialSource ---
  {
    const doc = makeDoc({ id: 'reliefweb:123', provider: 'reliefweb', sourceName: 'OCHA', contentType: 'humanitarian_report' })
    const { results: normalized } = normalizeTerraRelatedIntelligence([doc], [])
    results.push(check('reliefweb_humanitarian_report_is_labeled_official_source', normalized[0]?.mediaType === 'official_report' && normalized[0]?.isOfficialSource === true, JSON.stringify(normalized[0])))
  }

  // --- An Exa web_page is labeled article, and never marked official just because it looks it ---
  {
    const doc = makeDoc({ sourceName: 'usgs.gov (via web search)' })
    const { results: normalized } = normalizeTerraRelatedIntelligence([doc], [])
    results.push(check('exa_web_page_is_labeled_article_not_official', normalized[0]?.mediaType === 'article' && normalized[0]?.isOfficialSource === false, JSON.stringify(normalized[0])))
  }

  // --- An unrecognized contentType is honestly labeled 'other', never fabricated as news ---
  {
    const doc = makeDoc({ contentType: 'unknown_thing' })
    const { results: normalized } = normalizeTerraRelatedIntelligence([doc], [])
    results.push(check('unrecognized_content_type_is_labeled_other', normalized[0]?.mediaType === 'other', JSON.stringify(normalized[0])))
  }

  // --- canonicalUrl is preferred as the source link; falls back to sourceUrl when absent ---
  {
    const doc = makeDoc({ canonicalUrl: null, sourceUrl: 'https://example.com/fallback' })
    const { results: normalized } = normalizeTerraRelatedIntelligence([doc], [])
    results.push(check('missing_canonical_url_falls_back_to_source_url', normalized[0]?.sourceUrl === 'https://example.com/fallback', JSON.stringify(normalized[0])))
  }

  // --- Provider failure (not_configured, e.g. ReliefWeb with no app name) is surfaced honestly ---
  {
    const response = makeResponse({ provider: 'reliefweb', ok: false, documents: [], error: { provider: 'reliefweb', category: 'not_configured', message: 'RELIEFWEB_APPNAME is not configured.', httpStatus: null } })
    const { providerStatuses } = normalizeTerraRelatedIntelligence([], [response])
    const status = providerStatuses[0]
    results.push(check('not_configured_provider_is_surfaced_as_unconfigured_not_silently_dropped', status?.configured === false && status?.ok === false && status?.message === 'RELIEFWEB_APPNAME is not configured.', JSON.stringify(status)))
  }

  // --- A provider the router rejected before any adapter ran (e.g. ReliefWeb with no
  //     RELIEFWEB_APPNAME configured) is still surfaced honestly, not silently omitted ---
  {
    const { providerStatuses } = normalizeTerraRelatedIntelligence([], [], [{ provider: 'reliefweb', reason: 'required environment variable(s) not configured: RELIEFWEB_APPNAME' }])
    const status = providerStatuses.find(s => s.provider === 'reliefweb')
    results.push(check('router_rejected_provider_is_surfaced_as_unconfigured', status?.configured === false && status?.message?.includes('RELIEFWEB_APPNAME') === true, JSON.stringify(status)))
  }

  // --- Zero documents overall is an honest empty result, never fake fallback content ---
  {
    const okResponse = makeResponse({ provider: 'exa', ok: true, documents: [] })
    const { results: normalized, providerStatuses } = normalizeTerraRelatedIntelligence([], [okResponse])
    results.push(check('zero_documents_is_an_honest_empty_result', normalized.length === 0 && providerStatuses[0]?.ok === true && providerStatuses[0]?.resultCount === 0, `results=${normalized.length}`))
  }

  return results
}

export function runTerraRelatedIntelligenceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraRelatedIntelligenceValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra relatedIntelligence validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
