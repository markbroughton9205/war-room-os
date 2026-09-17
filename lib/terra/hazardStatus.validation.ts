/**
 * Hazard counter honesty tests. Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/hazardStatus.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { composeTerraHazardCounters } from './hazardStatus'
import type { TerraLiveProviderStatus } from './liveGeoIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function provider(partial: Partial<TerraLiveProviderStatus> & Pick<TerraLiveProviderStatus, 'id' | 'displayName' | 'freshness' | 'objectCount'>): TerraLiveProviderStatus {
  return {
    layer: 'intelligence_events',
    implemented: true,
    configurationState: 'ENABLED',
    reason: 'test',
    ...partial,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const healthy = composeTerraHazardCounters({
    fetchedAt: '2026-09-16T12:00:00.000Z',
    providers: [
      provider({ id: 'usgs_earthquake_feed', displayName: 'USGS', freshness: 'LIVE', objectCount: 12 }),
      provider({ id: 'nhc_current_storms', displayName: 'NHC', freshness: 'LIVE', objectCount: 0 }),
      provider({ id: 'nws_severe_weather_alerts', displayName: 'NWS', freshness: 'LIVE', objectCount: 4 }),
      provider({ id: 'nasa_firms', displayName: 'NASA FIRMS', freshness: 'AUTH_REQUIRED', objectCount: 0, configurationState: 'NEEDS_CREDENTIALS' }),
      provider({ id: 'nasa_eonet_volcanoes', displayName: 'NASA EONET', freshness: 'LIVE', objectCount: 7 }),
    ],
  })
  const byId = Object.fromEntries(healthy.map(row => [row.id, row]))
  results.push(check('usgs_healthy_shows_actual_count', byId.earthquakes.value === 12 && byId.earthquakes.displayValue === '12', JSON.stringify(byId.earthquakes)))
  results.push(check('nhc_healthy_zero_is_legitimate_zero', byId.cyclones.value === 0 && byId.cyclones.displayValue === '0' && byId.cyclones.health === 'HEALTHY', JSON.stringify(byId.cyclones)))
  results.push(check('firms_missing_key_is_dash_not_zero', byId.fires.value === null && byId.fires.displayValue === '—' && byId.fires.health === 'AUTH_REQUIRED', JSON.stringify(byId.fires)))
  results.push(check('volcanoes_are_partial_not_global', byId.volcanoes.health === 'PARTIAL' && byId.volcanoes.coverage.includes('PARTIAL'), JSON.stringify(byId.volcanoes)))

  const failedUsgs = composeTerraHazardCounters({
    fetchedAt: null,
    providers: [
      provider({ id: 'usgs_earthquake_feed', displayName: 'USGS', freshness: 'UNAVAILABLE', objectCount: 0, reason: 'HTTP 503' }),
      provider({ id: 'nhc_current_storms', displayName: 'NHC', freshness: 'UNAVAILABLE', objectCount: 0 }),
    ],
  })
  const failed = Object.fromEntries(failedUsgs.map(row => [row.id, row]))
  results.push(check('usgs_failure_is_unavailable_not_zero', failed.earthquakes.displayValue === '—' && failed.earthquakes.health === 'UNAVAILABLE', JSON.stringify(failed.earthquakes)))
  results.push(check('nhc_failure_is_unavailable_not_zero', failed.cyclones.displayValue === '—' && failed.cyclones.value === null, JSON.stringify(failed.cyclones)))

  const stale = composeTerraHazardCounters({
    fetchedAt: '2026-09-16T12:00:00.000Z',
    providers: [provider({ id: 'usgs_earthquake_feed', displayName: 'USGS', freshness: 'CACHED', objectCount: 9 })],
  })
  results.push(check('cached_feed_is_stale_not_live', stale[0].health === 'STALE' && stale[0].value === 9, JSON.stringify(stale[0])))

  const freshCachedEmpty = composeTerraHazardCounters({
    fetchedAt: new Date().toISOString(),
    providers: [provider({ id: 'nhc_current_storms', displayName: 'NHC', freshness: 'CACHED', objectCount: 0 })],
  })
  const nhc = freshCachedEmpty.find(row => row.id === 'cyclones')
  results.push(check('fresh_cached_empty_nhc_is_live_zero', nhc?.health === 'HEALTHY' && nhc.displayValue === '0' && nhc.freshness === 'LIVE', JSON.stringify(nhc)))

  const missing = composeTerraHazardCounters({ fetchedAt: null, providers: [] })
  results.push(check('missing_usgs_row_is_dash', missing.find(row => row.id === 'earthquakes')?.displayValue === '—', JSON.stringify(missing.find(row => row.id === 'earthquakes'))))
  results.push(check('missing_firms_is_auth_required_dash', missing.find(row => row.id === 'fires')?.health === 'AUTH_REQUIRED' && missing.find(row => row.id === 'fires')?.displayValue === '—', JSON.stringify(missing.find(row => row.id === 'fires'))))

  const rateLimited = composeTerraHazardCounters({
    fetchedAt: null,
    providers: [provider({ id: 'usgs_earthquake_feed', displayName: 'USGS', freshness: 'RATE_LIMITED', objectCount: 0 })],
  })
  results.push(check('rate_limited_is_dash_not_zero', rateLimited[0].displayValue === '—' && rateLimited[0].health === 'RATE_LIMITED', JSON.stringify(rateLimited[0])))

  return results
}

export function runTerraHazardStatusValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraHazardStatusValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra hazardStatus validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
