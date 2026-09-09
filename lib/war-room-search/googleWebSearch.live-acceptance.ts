import { pathToFileURL } from 'node:url'
import { federatedSearch } from './federatedSearch'
import {
  googleWebSearchConfigured,
  runGoogleWebSearch,
} from './providers/googleWebSearch'
import type { FederatedSearchResponse, SearchResult } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

function hasRealLinks(results: SearchResult[]): boolean {
  return results.some(item => Boolean(item.url && /^https?:\/\//i.test(item.url)))
}

function duplicatedCanonicals(results: SearchResult[]): string[] {
  const seen = new Map<string, number>()
  for (const item of results) {
    const key = item.canonicalUrl || item.url
    if (!key) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}

function googleHits(response: FederatedSearchResponse): SearchResult[] {
  return response.results.filter(item => item.discoveredVia === 'GOOGLE' || item.evidence.source_id === 'google_web_search')
}

export async function runGoogleWebSearchLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const configured = googleWebSearchConfigured()

  const noCred = await runGoogleWebSearch('latest semiconductor supply chain developments', { env: {} })
  cases.push(check(
    'ncred_01_unavailable',
    !noCred.ok && noCred.results.length === 0 && noCred.warningCode === 'GOOGLE_UNAVAILABLE',
    JSON.stringify({ ok: noCred.ok, count: noCred.results.length, code: noCred.warningCode }),
    'NO CREDENTIAL',
  ))
  cases.push(check('ncred_02_no_fake_results', noCred.results.every(item => Boolean(item.url)) && noCred.results.length === 0, String(noCred.results.length), 'NO CREDENTIAL'))

  const SEMI = 'latest semiconductor supply chain developments'
  const FREIGHT = 'U.S. freight broker regulations'
  const SCIENCE = 'lithium battery degradation research'
  const EAST = 'semiconductor policy'

  const semi = await federatedSearch({ query: SEMI, options: { limit: 16, sort: 'RELEVANCE' } })
  cases.push(check(
    'ncred_03_search_continues',
    semi.resultCount > 0 || semi.warnings.length > 0,
    `count=${semi.resultCount} googleOk=${semi.sourceSummary.googleOk} warnings=${semi.warnings.slice(0, 4).join(' | ')}`,
    semi.resultCount ? 'REAL LIVE WEB' : 'DEGRADED',
  ))
  if (!configured) {
    cases.push(check(
      'ncred_04_honest_google_status',
      semi.sourceSummary.googleOk === false && (semi.sourceSummary.googleWarning === 'GOOGLE_UNAVAILABLE' || semi.sourceSummary.googleWarning === 'GOOGLE_AUTH_REQUIRED' || semi.warnings.includes('GOOGLE_UNAVAILABLE')),
      JSON.stringify({ googleOk: semi.sourceSummary.googleOk, warning: semi.sourceSummary.googleWarning, warnings: semi.warnings.slice(0, 6) }),
      'NO CREDENTIAL',
    ))
  }

  if (!configured) {
    cases.push(check('live_google_skipped_no_credentials', true, 'GOOGLE_WEB_SEARCH_API_KEY / GOOGLE_WEB_SEARCH_CLIENT_ID unset; live Google assertions skipped honestly', 'NOT EXECUTED'))
    return cases
  }

  cases.push(check('live_google_configured', configured, 'credentials present', 'REAL LIVE WEB'))

  const gSemi = googleHits(semi)
  cases.push(check('live_semi_01_google_results', semi.sourceSummary.googleOk && gSemi.length > 0 && hasRealLinks(gSemi), `google=${gSemi.length} total=${semi.resultCount}`, 'REAL LIVE WEB'))
  cases.push(check('live_semi_02_real_urls', gSemi.every(item => /^https?:\/\//i.test(item.url ?? '')), gSemi.map(item => item.url).slice(0, 5).join(' | '), 'REAL LIVE WEB'))
  cases.push(check('live_semi_03_no_dup_inflation', duplicatedCanonicals(semi.results).length === 0, duplicatedCanonicals(semi.results).join(' | ') || 'none', 'REAL LIVE WEB'))
  cases.push(check(
    'live_semi_04_publisher_not_google_family',
    gSemi.every(item => item.sourceFamily !== 'google' && item.sourceFamily !== 'google_web_search'),
    gSemi.map(item => item.sourceFamily).slice(0, 6).join(','),
    'REAL LIVE WEB',
  ))

  const freight = await federatedSearch({ query: FREIGHT, options: { limit: 16 } })
  cases.push(check('live_freight_01_results', freight.resultCount > 0 && hasRealLinks(freight.results), `count=${freight.resultCount} googleOk=${freight.sourceSummary.googleOk}`, 'REAL LIVE WEB'))
  cases.push(check(
    'live_freight_02_primary_route_intact',
    freight.sourceSummary.researchEngineProviders.includes('federal_register')
      || freight.results.some(item => item.authorityClass === 'PRIMARY_REGULATOR' || /federalregister\.gov/i.test(item.url ?? '')),
    JSON.stringify({ providers: freight.sourceSummary.researchEngineProviders, authorities: [...new Set(freight.results.map(item => item.authorityClass))] }),
    'REAL LIVE WEB',
  ))
  cases.push(check(
    'live_freight_03_sec_not_regulator',
    freight.results.filter(item => /sec\.gov/i.test(item.url ?? '')).every(item => item.authorityClass !== 'PRIMARY_REGULATOR'),
    freight.results.filter(item => /sec\.gov/i.test(item.url ?? '')).map(item => `${item.authorityClass}:${item.discoveredVia}`).join(',') || 'no sec urls',
    'REAL LIVE WEB',
  ))

  const science = await federatedSearch({ query: SCIENCE, options: { limit: 16 } })
  const academic = science.results.filter(item => item.authorityClass === 'PRIMARY_ACADEMIC' || /arxiv\.org|nih\.gov|crossref/i.test(item.url ?? ''))
  cases.push(check('live_science_01_results', science.resultCount > 0, `count=${science.resultCount} googleOk=${science.sourceSummary.googleOk}`, 'REAL LIVE WEB'))
  cases.push(check(
    'live_science_02_academic_authority',
    academic.length > 0 || science.sourceSummary.researchEngineProviders.some(id => ['arxiv', 'crossref', 'ncbi'].includes(id)),
    JSON.stringify({ academic: academic.length, providers: science.sourceSummary.researchEngineProviders, google: googleHits(science).length }),
    'REAL LIVE WEB',
  ))

  const east = await federatedSearch({ query: EAST, options: { limit: 16, region: 'EAST_ASIA' } })
  cases.push(check(
    'live_east_01_region_not_suppressed',
    east.sourceSummary.region === 'EAST_ASIA' && east.sourceSummary.primaryAttempted.length > 0,
    JSON.stringify({ region: east.sourceSummary.region, primary: east.sourceSummary.primaryAttempted, googleOk: east.sourceSummary.googleOk }),
    'REAL LIVE WEB',
  ))
  cases.push(check('live_east_02_results_or_honest', east.resultCount > 0 || east.warnings.length > 0, `count=${east.resultCount}`, 'REAL LIVE WEB'))

  const serialized = JSON.stringify(semi)
  cases.push(check(
    'live_privacy_01_no_keys',
    !/GOOGLE_WEB_SEARCH_API_KEY|GOOGLE_WEB_SEARCH_CLIENT_ID|AIza[0-9A-Za-z_-]{10,}/.test(serialized),
    'clean',
    'REAL LIVE WEB',
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runGoogleWebSearchLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Google Web Search live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
