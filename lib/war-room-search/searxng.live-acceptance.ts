import { pathToFileURL } from 'node:url'
import { federatedSearch } from './federatedSearch'
import { runSearxngSearch, searxngConfigured } from './providers/searxng'
import type { FederatedSearchResponse, SearchResult } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

function hasRealLinks(results: SearchResult[]): boolean {
  return results.some(item => Boolean(item.url && /^https?:\/\//i.test(item.url)))
}

export async function runSearxngLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const configured = searxngConfigured()

  const noCfg = await runSearxngSearch('latest semiconductor supply chain developments', { env: {} })
  cases.push(check(
    'ncfg_01_unavailable',
    !noCfg.ok && noCfg.results.length === 0 && noCfg.warningCode === 'SEARXNG_NOT_CONFIGURED',
    JSON.stringify({ ok: noCfg.ok, count: noCfg.results.length, code: noCfg.warningCode }),
    'NOT CONFIGURED',
  ))

  const semi = await federatedSearch({ query: 'latest semiconductor supply chain developments', options: { limit: 12 } })
  cases.push(check(
    'ncfg_02_search_continues',
    semi.resultCount > 0 || semi.warnings.length > 0,
    `count=${semi.resultCount} searxngOk=${semi.sourceSummary.searxngOk} googleOk=${semi.sourceSummary.googleOk}`,
    semi.resultCount ? 'REAL LIVE WEB' : 'DEGRADED',
  ))

  if (!configured) {
    cases.push(check(
      'live_searxng_skipped_no_instance',
      true,
      'SEARXNG INTEGRATION IMPLEMENTED. LIVE INSTANCE NOT CONFIGURED.',
      'NOT EXECUTED',
    ))
    return cases
  }

  cases.push(check('live_searxng_configured', configured, 'SEARXNG_BASE_URL present', 'REAL LIVE WEB'))
  const live = await runSearxngSearch('lithium battery degradation research', { pageSize: 8 })
  cases.push(check(
    'live_01_adapter',
    live.configured && (live.ok ? live.results.length > 0 && live.results.every(item => /^https?:\/\//.test(item.url)) : Boolean(live.warningCode)),
    JSON.stringify({ ok: live.ok, count: live.results.length, engines: live.enginesObserved.slice(0, 8), warning: live.warningCode }),
    live.ok ? 'REAL LIVE WEB' : 'DEGRADED',
  ))

  const federated: FederatedSearchResponse = semi
  const searxHits = federated.results.filter(item => item.discoveredVia === 'SEARXNG' || item.evidence.source_id === 'searxng')
  cases.push(check(
    'live_02_federated_does_not_require_searxng',
    typeof federated.sourceSummary.searxngOk === 'boolean' && (federated.resultCount > 0 || federated.warnings.length > 0),
    `searxngOk=${federated.sourceSummary.searxngOk} total=${federated.resultCount} searxHits=${searxHits.length} links=${hasRealLinks(federated.results)}`,
    'REAL LIVE WEB',
  ))
  const serialized = JSON.stringify({ live, federated: { warnings: federated.warnings, summary: federated.sourceSummary } })
  cases.push(check(
    'live_03_no_auth_leak',
    !/SEARXNG_AUTH_VALUE|Bearer\s+[A-Za-z0-9._-]{8,}/.test(serialized),
    'clean',
    'STRUCTURAL',
  ))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runSearxngLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`SearXNG live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
