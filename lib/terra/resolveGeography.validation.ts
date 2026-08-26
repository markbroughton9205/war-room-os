/**
 * Deterministic regression suite for the geo-resolution boundary — the exact/ambiguous/unresolved
 * ambiguity handling this mission's mission text requires, tested against mocked nominatim HTTP
 * responses (never a real network call in this file; see the Phase 4 completion report for the
 * bounded live-verification evidence). Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/resolveGeography.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { __setResearchFetchForTests } from '@/lib/research-engine/security/safeFetch'
import { __resetCacheForTests } from '@/lib/research-engine/cache/ttlCache'
import { __resetProviderGateForTests } from '@/lib/research-engine/security/providerGate'
import { resolvePlaceNameViaNominatim, reverseResolveCoordinatesViaNominatim } from './resolveGeography'
import { parseTerraCoordinates } from './locationCommand'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function withMockedFetch<T>(response: Response, fn: () => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  __setResearchFetchForTests((async () => response) as typeof fetch)
  try {
    return await fn()
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const direct = parseTerraCoordinates('40.7128, -74.0060')
  results.push(check('typed_coordinates_resolve_without_guessing', direct?.latitude === 40.7128 && direct.longitude === -74.006, JSON.stringify(direct)))
  results.push(check('out_of_range_coordinates_are_rejected', parseTerraCoordinates('91, 181') === null, '91, 181'))

  // --- Exact/strong: exactly one real coordinate-bearing candidate ---
  await withMockedFetch(
    jsonResponse([{ place_id: 145205353, osm_type: 'relation', osm_id: 62422, lat: '52.5173885', lon: '13.3951309', display_name: 'Berlin, Deutschland', name: 'Berlin', class: 'boundary', type: 'administrative' }]),
    async () => {
      const resolved = await resolvePlaceNameViaNominatim('Berlin, Germany', 'edh:test-1')
      results.push(check('single_candidate_resolves_strong', resolved.quality === 'strong', `quality=${resolved.quality}`))
      if (resolved.quality === 'strong' || resolved.quality === 'exact') {
        results.push(check('resolved_coordinates_match_mocked_response', resolved.latitude === 52.5173885 && resolved.longitude === 13.3951309, `lat=${resolved.latitude} lon=${resolved.longitude}`))
        results.push(check('resolver_provider_id_is_nominatim', resolved.resolverProviderId === 'nominatim', `resolverProviderId=${resolved.resolverProviderId}`))
        results.push(check('source_entity_id_preserved', resolved.sourceEntityId === 'edh:test-1', `sourceEntityId=${resolved.sourceEntityId}`))
        results.push(check('query_used_preserved', resolved.queryUsed === 'Berlin, Germany', `queryUsed=${resolved.queryUsed}`))
        results.push(check('resolution_method_is_place_name_lookup', resolved.resolutionMethod === 'place_name_lookup', `resolutionMethod=${resolved.resolutionMethod}`))
        results.push(check('no_fake_confidence_score_only_categorical_quality', !('confidence' in resolved), `keys=${Object.keys(resolved).join(',')}`))
      }
    },
  )

  // --- Click-to-context reverse resolution: provider label enriches the exact clicked point. ---
  await withMockedFetch(
    jsonResponse({ place_id: 99, osm_type: 'node', osm_id: 1234, lat: '40.71275', lon: '-74.00595', display_name: 'City Hall, 260 Broadway, New York, New York, USA', name: 'New York City Hall', class: 'amenity', type: 'townhall', address: { house_number: '260', road: 'Broadway', city: 'New York', state: 'New York', country: 'United States' } }),
    async () => {
      const resolved = await reverseResolveCoordinatesViaNominatim({ latitude: 40.7128, longitude: -74.006, height: 12, hasTerrainHeight: true, selectedAt: '2026-08-26T12:00:00.000Z' })
      results.push(check('reverse_click_resolves_provider_supported_context', resolved.status === 'resolved' && resolved.location.confidence === 'provider_supported', JSON.stringify(resolved)))
      results.push(check('reverse_click_preserves_exact_clicked_coordinates', resolved.location.latitude === 40.7128 && resolved.location.longitude === -74.006, `lat=${resolved.location.latitude} lon=${resolved.location.longitude}`))
      results.push(check('reverse_click_preserves_height_provenance', resolved.location.height === 12 && resolved.location.hasTerrainHeight, `height=${resolved.location.height}`))
      results.push(check('reverse_click_carries_nominatim_provenance', resolved.location.source === 'nominatim' && Boolean(resolved.location.sourceUrl), `source=${resolved.location.source}`))
      results.push(check('reverse_click_exposes_place_address_region', resolved.location.place === 'New York City Hall' && resolved.location.address === '260 Broadway, New York' && resolved.location.region === 'New York, United States', JSON.stringify(resolved.location)))
    },
  )

  // A valid Earth coordinate remains active when the provider has no reverse match. No fallback
  // place name is inferred from a nearby result or fabricated locally.
  await withMockedFetch(jsonResponse({ error: 'Unable to geocode' }), async () => {
    const resolved = await reverseResolveCoordinatesViaNominatim({ latitude: 0, longitude: -140, height: null, hasTerrainHeight: false })
    results.push(check('reverse_unavailable_retains_coordinate_only_context', resolved.status === 'coordinate_only' && resolved.location.latitude === 0 && resolved.location.longitude === -140, JSON.stringify(resolved)))
    results.push(check('reverse_unavailable_is_explicitly_unresolved', resolved.location.status === 'coordinate_only' && resolved.location.detail.includes('unavailable'), resolved.location.detail))
  })

  // --- Ambiguous: two distinct coordinate-bearing candidates — must NOT auto-select either ---
  await withMockedFetch(
    jsonResponse([
      { place_id: 1, lat: '51.5', lon: '-0.1', display_name: 'Richmond, London, UK', name: 'Richmond' },
      { place_id: 2, lat: '37.5', lon: '-77.4', display_name: 'Richmond, Virginia, USA', name: 'Richmond' },
    ]),
    async () => {
      const resolved = await resolvePlaceNameViaNominatim('Richmond', 'edh:test-2')
      results.push(check('multiple_candidates_stay_ambiguous_not_auto_selected', resolved.quality === 'ambiguous', `quality=${resolved.quality}`))
      results.push(check('ambiguous_result_carries_no_coordinates', !('longitude' in resolved), `keys=${Object.keys(resolved).join(',')}`))
    },
  )

  // --- Unresolved: zero candidates ---
  await withMockedFetch(jsonResponse([]), async () => {
    const resolved = await resolvePlaceNameViaNominatim('Nonexistent Place Xyzzy123', 'edh:test-3')
    results.push(check('missing_place_stays_unresolved_not_fabricated', resolved.quality === 'unresolved', `quality=${resolved.quality}`))
    results.push(check('unresolved_result_carries_no_coordinates', !('longitude' in resolved), `keys=${Object.keys(resolved).join(',')}`))
  })

  // --- Empty query text: unresolved without even attempting a network call ---
  {
    const resolved = await resolvePlaceNameViaNominatim('   ', 'edh:test-4')
    results.push(check('empty_query_text_is_unresolved_immediately', resolved.quality === 'unresolved', `quality=${resolved.quality}`))
  }

  // --- A candidate whose geography is present but not a real coordinate string (e.g. a country
  // list) is not miscounted as a valid candidate ---
  await withMockedFetch(
    jsonResponse([{ place_id: 3, lat: 'not-a-number', lon: '13.4', display_name: 'Malformed', name: 'Malformed' }]),
    async () => {
      const resolved = await resolvePlaceNameViaNominatim('Malformed Place', 'edh:test-5')
      results.push(check('malformed_coordinate_candidate_is_not_treated_as_valid', resolved.quality === 'unresolved', `quality=${resolved.quality}`))
    },
  )

  return results
}

export async function runTerraResolveGeographyValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTerraResolveGeographyValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(r => !r.pass)
    console.log(`Terra resolveGeography validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
