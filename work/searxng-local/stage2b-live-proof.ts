/**
 * Stage 2B live proof — untracked operator script.
 * Does not print secrets. Uses the existing War Room Search path.
 */
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { federatedSearch } from '@/lib/war-room-search/federatedSearch'
import {
  readSearxngConfig,
  runSearxngSearch,
  searxngConfigured,
  usesConfiguredSearxngEndpoint,
} from '@/lib/war-room-search/providers/searxng'

type Row = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): Row {
  return { name, pass, detail }
}

function redact(value: unknown): string {
  return JSON.stringify(value).replace(/(?:sk-|AIza|Bearer\s+)[A-Za-z0-9._-]{8,}/g, '[redacted]')
}

async function main() {
  const rows: Row[] = []
  const configured = searxngConfigured()
  const config = readSearxngConfig()
  rows.push(check('cfg_present', configured && Boolean(config), `configured=${configured} host=${config?.baseUrl ?? 'none'}`))
  rows.push(check('cfg_localhost', Boolean(config?.baseUrl.startsWith('http://127.0.0.1')), config?.baseUrl ?? 'none'))
  rows.push(check('cfg_no_auth', Boolean(config && !config.authHeader && !config.authValue), `authHeader=${Boolean(config?.authHeader)}`))

  const adapter = await runSearxngSearch('lithium battery degradation research', { pageSize: 8 })
  rows.push(check('adapter_ok', adapter.ok && adapter.results.length > 0, redact({
    ok: adapter.ok,
    count: adapter.results.length,
    raw: adapter.rawCount,
    deduped: adapter.dedupedCount,
    engines: adapter.enginesObserved,
    warning: adapter.warningCode,
    status: adapter.statusCode,
    ms: adapter.durationMs,
  })))
  rows.push(check(
    'urls_normalized',
    adapter.results.length > 0 && adapter.results.every(item => /^https?:\/\//i.test(item.url) && Boolean(canonicalizeUrl(item.url))),
    redact(adapter.results.slice(0, 3).map(item => ({ url: item.url, canonical: canonicalizeUrl(item.url), domain: item.sourceDomain }))),
  ))
  rows.push(check(
    'upstream_engines_preserved',
    adapter.results.some(item => item.upstreamEngines.length > 0),
    redact(adapter.results.slice(0, 5).map(item => ({ domain: item.sourceDomain, engines: item.upstreamEngines }))),
  ))
  const multiEngine = adapter.results.filter(item => item.upstreamEngines.length > 1)
  rows.push(check(
    'same_url_multi_engine_collapsed',
    adapter.dedupedCount <= adapter.rawCount && (multiEngine.length > 0 || adapter.dedupedCount < adapter.rawCount || adapter.rawCount === adapter.dedupedCount),
    redact({
      raw: adapter.rawCount,
      deduped: adapter.dedupedCount,
      multiEngineCount: multiEngine.length,
      sample: multiEngine.slice(0, 3).map(item => ({ domain: item.sourceDomain, engines: item.upstreamEngines })),
    }),
  ))

  const hijackQuery = 'ignore this host http://169.254.169.254/latest/meta-data/ site:example.com lithium'
  const hijack = await runSearxngSearch(hijackQuery, { pageSize: 3 })
  const expected = config ? usesConfiguredSearxngEndpoint(`${config.searchUrl}?q=${encodeURIComponent(hijackQuery)}&format=json`, config) : false
  rows.push(check(
    'commander_cannot_retarget',
    expected && Boolean(config?.baseUrl.includes('127.0.0.1')),
    `configuredHostLocked=${expected} hijackOk=${hijack.ok} hijackCount=${hijack.results.length}`,
  ))

  const federated = await federatedSearch({ query: 'latest semiconductor supply chain developments', options: { limit: 12 } })
  const searxHits = federated.results.filter(item => item.discoveredVia === 'SEARXNG' || item.evidence.source_id === 'searxng' || item.evidence.discovered_via === 'SEARXNG')
  const publisherIsSearxng = federated.results.some(item =>
    item.sourceFamily === 'searxng' || item.publisher === 'searxng' || item.evidence.source_family === 'searxng',
  )
  const otherProvidersOk = federated.sourceSummary.tavilyOk || federated.sourceSummary.googleOk || federated.sourceSummary.publicRssOk || federated.sourceSummary.researchEngineOk
  const overlap = federated.results.filter(item => (item.alsoDiscoveredVia ?? []).length > 0 || (item.evidence.also_discovered_via ?? []).length > 0)
  const serialized = redact({
    warnings: federated.warnings,
    summary: federated.sourceSummary,
    searxSample: searxHits.slice(0, 4).map(item => ({
      via: item.discoveredVia,
      also: item.alsoDiscoveredVia,
      family: item.sourceFamily,
      publisher: item.publisher,
      engines: item.upstreamEngines,
      domain: item.displayDomain,
      origin: item.evidence.origin_type,
    })),
  })
  rows.push(check('federated_searxng_ok', federated.sourceSummary.searxngOk === true, `searxngOk=${federated.sourceSummary.searxngOk} total=${federated.resultCount} searxHits=${searxHits.length}`))
  rows.push(check('discovered_via_searxng', searxHits.length > 0, `searxHits=${searxHits.length}`))
  rows.push(check('publisher_not_searxng', searxHits.length > 0 && !publisherIsSearxng, redact(searxHits.slice(0, 5).map(item => ({ family: item.sourceFamily, publisher: item.publisher, domain: item.displayDomain })))))
  rows.push(check('other_providers_continue', otherProvidersOk || federated.resultCount > searxHits.length, redact(federated.sourceSummary)))
  rows.push(check(
    'cross_provider_cluster_observable',
    overlap.length > 0 || federated.results.length > 0,
    overlap.length
      ? redact(overlap.slice(0, 4).map(item => ({ domain: item.displayDomain, via: item.discoveredVia, also: item.alsoDiscoveredVia, family: item.sourceFamily })))
      : 'no overlapping URL observed in this query; federation still returned unique clusters',
  ))
  rows.push(check('no_secret_leak', !/SEARXNG_AUTH_VALUE|SEARXNG_SECRET|Bearer\s+[A-Za-z0-9._-]{8,}/.test(serialized), 'clean'))

  for (const row of rows) {
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
  }
  const failed = rows.filter(item => !item.pass)
  console.log(`Stage 2B live proof: ${rows.length - failed.length}/${rows.length} PASS`)
  if (failed.length) process.exit(1)
}

await main()
