/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/localIntelRelevance.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { localNewsSearchQuery, localSectionDisplayCount, scoreLocalIntelItem } from './localIntelRelevance'
import type { TerraGeographicContext } from './geographicContext'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const akron: TerraGeographicContext = {
  lat: 41.0814,
  lon: -81.519,
  bbox: { west: -81.7, south: 40.95, east: -81.3, north: 41.2 },
  zoomLevel: 'CITY',
  placeName: 'Akron, Ohio',
  nativePlaceName: 'Akron',
  city: 'Akron',
  county: 'Summit County',
  state: 'Ohio',
  country: 'United States',
  countryCode: 'US',
  accuracyMeters: null,
  contextType: 'SEARCH',
  source: 'nominatim',
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'local_query_uses_city_state',
    localNewsSearchQuery(akron) === 'Akron Ohio',
    localNewsSearchQuery(akron) ?? 'none',
  ))
  results.push(check(
    'gps_place_is_not_a_query',
    localNewsSearchQuery({ ...akron, city: null, county: null, state: null, country: null, placeName: 'GPS ±12 m' }) === null,
    'gps skipped',
  ))
  const sameCity = scoreLocalIntelItem({
    originalHeadline: 'Akron fire crews respond downtown',
    originalSummary: 'Summit County officials are on scene.',
    lat: null,
    lon: null,
    source: 'Beacon Journal',
    provider: 'public_rss',
  }, akron)
  results.push(check('same_city_included', sameCity.includeInLocal && sameCity.relation === 'SAME_CITY', `${sameCity.relation}`))
  const publisher = scoreLocalIntelItem({
    originalHeadline: 'Markets close mixed',
    originalSummary: 'Stocks were mixed.',
    lat: null,
    lon: null,
    source: 'Akron Wire Service',
    provider: 'public_rss',
  }, akron)
  results.push(check('publisher_hq_is_not_local', publisher.includeInLocal === false, publisher.relation))
  const sameCountry = scoreLocalIntelItem({
    originalHeadline: 'United States issues a travel advisory',
    originalSummary: 'Nationwide notice.',
    lat: null,
    lon: null,
    source: 'BBC',
    provider: 'public_rss',
  }, akron)
  results.push(check('same_country_is_not_nearby', sameCountry.includeInLocal === false, sameCountry.relation))
  const nearbyQuake = scoreLocalIntelItem({
    originalHeadline: 'M 2.1 Ohio',
    lat: 41.09,
    lon: -81.52,
    source: 'USGS',
    provider: 'usgs_earthquake_feed',
  }, akron)
  results.push(check(
    'geolocated_uses_distance_tier',
    nearbyQuake.includeInLocal && nearbyQuake.distanceKm !== null && nearbyQuake.radiusTier === 'IMMEDIATE',
    `${nearbyQuake.relation}:${nearbyQuake.radiusTier}:${nearbyQuake.distanceKm}`,
  ))
  const farQuake = scoreLocalIntelItem({
    originalHeadline: 'M 6.0 Japan',
    lat: 35.6,
    lon: 139.7,
    source: 'USGS',
    provider: 'usgs_earthquake_feed',
  }, akron)
  results.push(check('far_event_outside_scope', farQuake.relation === 'OUTSIDE_SCOPE' && farQuake.includeInLocal === false, farQuake.relation))
  results.push(check('display_unavailable_is_word', localSectionDisplayCount('UNAVAILABLE', 0) === 'UNAVAILABLE', localSectionDisplayCount('UNAVAILABLE', 0)))
  results.push(check('display_live_zero_sparse', localSectionDisplayCount('LIVE', 0, 'SPARSE') === 'SPARSE', localSectionDisplayCount('LIVE', 0, 'SPARSE')))
  results.push(check('display_rich_zero_is_rich', localSectionDisplayCount('LIVE', 0, 'RICH_COVERAGE') === 'RICH_COVERAGE', localSectionDisplayCount('LIVE', 0, 'RICH_COVERAGE')))
  results.push(check('display_no_coverage_word', localSectionDisplayCount('NO_COVERAGE', 0) === 'NO_COVERAGE', localSectionDisplayCount('NO_COVERAGE', 0)))
  results.push(check('display_partial_with_count', localSectionDisplayCount('PARTIAL', 4, 'PARTIAL') === '4', localSectionDisplayCount('PARTIAL', 4, 'PARTIAL')))
  return results
}

export function runLocalIntelRelevanceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Local intel relevance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
