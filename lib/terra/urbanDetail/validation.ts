/**
 * Deterministic regression suite for Terra automatic urban geography.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/urbanDetail/validation.ts
 */
import { pathToFileURL } from 'node:url'
import { resolveUrbanBuildingHeight, parseOsmHeightMeters, parseOsmBuildingLevels } from './height'
import {
  isHouseBuildingType,
  TERRA_URBAN_FLOOR_HEIGHT_M,
  TERRA_URBAN_HIGHWAY_CLASSES,
  TERRA_URBAN_INCLUDE_BUILDINGS,
  TERRA_URBAN_INCLUDE_HOUSE_NUMBERS,
  TERRA_URBAN_OBJECT_CAPS,
  urbanLodForHeightMeters,
  urbanViewportIsFetchable,
} from './lod'
import { normalizeOverpassUrbanGeometry } from './normalize'
import { findUrbanBuildingAt, findUrbanRoadAt, findUrbanSignalAt, isTerraUrbanBuildingPick, registerUrbanGeometryForPick, resolveTerraUrbanBuildingFromPick, TERRA_URBAN_BUILDING_ENTITY_PREFIX, urbanBuildingToSelection } from './pick'
import { buildUrbanOverpassQuery } from './query'
import { lon2tile, lat2tile, tileBounds, tilesForBounds, urbanTileCacheKey, expandBounds } from './tiles'
import { TERRA_LIVE_SIGNAL_PHASE, TERRA_SIGNAL_INFRASTRUCTURE_STATUS, TERRA_URBAN_TILE_VERSION } from './types'
import {
  TERRA_URBAN_CAMERA_DEBOUNCE_MS,
  TERRA_URBAN_OVERPASS_MAX_RETRIES,
  TERRA_URBAN_RETRY_SUPPRESS_MIN_MS,
  URBAN_REQUEST_SUPERSEDED,
  asStaleUrbanPayload,
  classifyUrbanCacheFreshness,
  computeOverpassBackoffMs,
  createUrbanFetchCoordinator,
  parseRetryAfterMs,
} from './requestControl'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const AKRON = { latitude: 41.0814, longitude: -81.519 }

function houseWay(id: number, building: string, tags: Record<string, string> = {}) {
  return {
    type: 'way' as const,
    id,
    tags: { building, ...tags },
    geometry: [
      { lat: 41.0810, lon: -81.5190 },
      { lat: 41.0810, lon: -81.5187 },
      { lat: 41.0813, lon: -81.5187 },
      { lat: 41.0813, lon: -81.5190 },
      { lat: 41.0810, lon: -81.5190 },
    ],
  }
}

function roadWay(id: number, highway: string, name?: string) {
  return {
    type: 'way' as const,
    id,
    tags: { highway, ...(name ? { name } : {}) },
    geometry: [
      { lat: 41.08, lon: -81.52 },
      { lat: 41.081, lon: -81.519 },
    ],
  }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  results.push(check('global_altitude_has_no_urban_lod', urbanLodForHeightMeters(4_000_000) === null, 'global'))
  results.push(check('regional_altitude_has_no_urban_lod', urbanLodForHeightMeters(400_000) === null, 'regional'))
  results.push(check('city_altitude_is_city_lod', urbanLodForHeightMeters(50_000) === 'city', 'city'))
  results.push(check('local_altitude_is_local_lod', urbanLodForHeightMeters(8_000) === 'local', 'local'))
  results.push(check('street_altitude_is_building_lod', urbanLodForHeightMeters(900) === 'building', 'building'))

  results.push(check('city_does_not_fetch_buildings', TERRA_URBAN_INCLUDE_BUILDINGS.city === false, 'city buildings off'))
  results.push(check('local_fetches_buildings', TERRA_URBAN_INCLUDE_BUILDINGS.local === true, 'local buildings on'))
  results.push(check('building_lod_includes_residential_roads', TERRA_URBAN_HIGHWAY_CLASSES.building.includes('residential'), 'residential'))
  results.push(check('city_roads_exclude_residential', !TERRA_URBAN_HIGHWAY_CLASSES.city.includes('residential'), 'city no residential'))

  results.push(check('wide_viewport_rejected_at_building_lod', urbanViewportIsFetchable({ west: -84, south: 39, east: -80, north: 42 }, 'building') === false, 'state-sized bbox'))
  results.push(check('neighborhood_viewport_accepted', urbanViewportIsFetchable({ west: -81.53, south: 41.07, east: -81.50, north: 41.09 }, 'building') === true, 'akron neighborhood'))

  results.push(check('height_tag_is_source', resolveUrbanBuildingHeight({ height: '11.5', building: 'house' }).heightSource === 'SOURCE', 'SOURCE'))
  results.push(check('height_tag_not_called_observed_if_only_levels', resolveUrbanBuildingHeight({ 'building:levels': '2', building: 'house' }).heightSource === 'INFERRED', 'INFERRED from levels'))
  results.push(check('levels_use_documented_floor_height', resolveUrbanBuildingHeight({ 'building:levels': '3', building: 'apartments' }).heightMeters === 3 * TERRA_URBAN_FLOOR_HEIGHT_M, '9m'))
  results.push(check('missing_height_is_inferred_default', resolveUrbanBuildingHeight({ building: 'house' }).heightMethod === 'type_default', 'type_default'))
  results.push(check('house_default_is_not_a_tower', resolveUrbanBuildingHeight({ building: 'house' }).heightMeters <= 8, String(resolveUrbanBuildingHeight({ building: 'house' }).heightMeters)))
  results.push(check('apartments_default_taller_than_house', resolveUrbanBuildingHeight({ building: 'apartments' }).heightMeters > resolveUrbanBuildingHeight({ building: 'house' }).heightMeters, 'varied heights'))
  results.push(check('feet_height_converted', parseOsmHeightMeters("32 ft") !== null && Math.abs((parseOsmHeightMeters("32 ft") ?? 0) - 32 * 0.3048) < 0.05, 'ft'))
  results.push(check('bogus_levels_rejected', parseOsmBuildingLevels('nope') === null, 'invalid levels'))

  results.push(check('house_types_include_residential_footprints', isHouseBuildingType('house') && isHouseBuildingType('detached') && isHouseBuildingType('terrace') && isHouseBuildingType('residential'), 'houses'))
  results.push(check('commercial_is_not_a_house', isHouseBuildingType('commercial') === false, 'commercial'))

  const cityGeometry = normalizeOverpassUrbanGeometry({
    elements: [roadWay(1, 'motorway', 'I-76'), roadWay(2, 'residential', 'Highland Ave'), houseWay(3, 'house'), { type: 'node' as const, id: 4, lat: 41.081, lon: -81.519, tags: { highway: 'traffic_signals' } }],
  }, 'city')
  results.push(check('city_lod_keeps_motorway', cityGeometry.roads.some(road => road.highway === 'motorway'), 'motorway'))
  results.push(check('city_lod_drops_residential_roads', !cityGeometry.roads.some(road => road.highway === 'residential'), 'no residential'))
  results.push(check('city_lod_drops_buildings', cityGeometry.buildings.length === 0, 'no buildings at city'))
  results.push(check('city_lod_drops_signals', cityGeometry.signals.length === 0, 'no signals at city'))

  const streetGeometry = normalizeOverpassUrbanGeometry({
    elements: [
      roadWay(10, 'residential', 'Highland Ave'),
      houseWay(11, 'house', { 'addr:housenumber': '12', 'addr:street': 'Highland Ave' }),
      houseWay(12, 'apartments', { height: '18' }),
      houseWay(13, 'commercial'),
      {
        type: 'node' as const,
        id: 99,
        lat: 41.0812,
        lon: -81.5189,
        tags: { highway: 'traffic_signals' },
      },
    ],
  }, 'building')
  results.push(check('street_lod_keeps_residential_road', streetGeometry.roads.some(road => road.name === 'Highland Ave'), 'highland'))
  results.push(check('houses_appear_when_present', streetGeometry.buildings.some(building => building.buildingType === 'house'), 'house footprint'))
  results.push(check('address_preserved_when_present', streetGeometry.buildings.some(building => building.address === '12 Highland Ave'), streetGeometry.buildings[0]?.address ?? 'none'))
  results.push(check('actual_height_marked_source', streetGeometry.buildings.find(building => building.buildingType === 'apartments')?.heightSource === 'SOURCE', 'apartments SOURCE'))
  results.push(check('house_without_height_marked_inferred', streetGeometry.buildings.find(building => building.buildingType === 'house')?.heightSource === 'INFERRED', 'house INFERRED'))
  results.push(check('street_labels_use_real_names', streetGeometry.labels.some(label => label.text === 'Highland Ave' && label.kind === 'street'), 'label'))
  results.push(check('house_number_label_uses_sourced_tag', streetGeometry.labels.some(label => label.kind === 'house_number' && label.text === '12'), streetGeometry.labels.filter(label => label.kind === 'house_number').map(label => label.text).join(',') || 'none'))
  results.push(check('house_without_tag_has_no_number', streetGeometry.buildings.find(building => building.buildingType === 'commercial')?.houseNumber === null, 'no inferred commercial number'))
  const unlabeledNeighbor = normalizeOverpassUrbanGeometry({
    elements: [
      houseWay(21, 'house', { 'addr:housenumber': '12', 'addr:street': 'Highland Ave' }),
      houseWay(22, 'house'),
    ],
  }, 'building')
  const numbered = unlabeledNeighbor.buildings.find(building => building.osmId === 21)
  const neighbor = unlabeledNeighbor.buildings.find(building => building.osmId === 22)
  results.push(check('neighbor_does_not_inherit_house_number', numbered?.houseNumber === '12' && neighbor?.houseNumber === null, `${numbered?.houseNumber ?? 'none'}/${neighbor?.houseNumber ?? 'none'}`))
  results.push(check('neighbor_has_no_house_number_label', !unlabeledNeighbor.labels.some(label => label.kind === 'house_number' && label.osmId === 22), 'no inferred label'))
  const lanesGeometry = normalizeOverpassUrbanGeometry({
    elements: [
      { ...roadWay(31, 'residential', 'Highland Ave'), tags: { highway: 'residential', name: 'Highland Ave', lanes: '2' } },
      roadWay(32, 'motorway', 'I-76'),
      houseWay(33, 'house', { entrance: 'main' }),
      houseWay(34, 'house'),
    ],
  }, 'building')
  results.push(check('lanes_keep_sourced_tag', lanesGeometry.roads.find(road => road.osmId === 31)?.lanes === '2', lanesGeometry.roads.find(road => road.osmId === 31)?.lanes ?? 'none'))
  results.push(check('lanes_not_inferred_from_highway_class', lanesGeometry.roads.find(road => road.osmId === 32)?.lanes === null, lanesGeometry.roads.find(road => road.osmId === 32)?.lanes ?? 'none'))
  results.push(check('entrance_keeps_sourced_tag', lanesGeometry.buildings.find(building => building.osmId === 33)?.entrance === 'main', lanesGeometry.buildings.find(building => building.osmId === 33)?.entrance ?? 'none'))
  results.push(check('entrance_not_inferred_from_neighbor', lanesGeometry.buildings.find(building => building.osmId === 34)?.entrance === null, 'no inferred entrance'))
  results.push(check('city_lod_has_selective_street_names', cityGeometry.labels.some(label => label.text === 'I-76' && label.kind === 'street'), cityGeometry.labels.map(label => label.text).join(',') || 'none'))
  results.push(check('city_lod_hides_residential_street_names', !cityGeometry.labels.some(label => label.text === 'Highland Ave'), 'no highland at city'))
  results.push(check('city_lod_hides_house_numbers', !cityGeometry.labels.some(label => label.kind === 'house_number') && TERRA_URBAN_INCLUDE_HOUSE_NUMBERS.city === false, 'no house numbers at city'))
  results.push(check('street_lod_keeps_signal_infrastructure', streetGeometry.signals.length === 1 && streetGeometry.signals[0].nodeKind === 'traffic_light_node', String(streetGeometry.signals.length)))
  results.push(check('signal_status_is_static_infrastructure', streetGeometry.signals[0]?.status === TERRA_SIGNAL_INFRASTRUCTURE_STATUS, streetGeometry.signals[0]?.status ?? 'none'))
  results.push(check('signal_live_phase_is_no_coverage', streetGeometry.signals[0]?.livePhase === TERRA_LIVE_SIGNAL_PHASE, streetGeometry.signals[0]?.livePhase ?? 'none'))
  results.push(check('signal_phase_is_not_a_light_color', !['RED', 'YELLOW', 'GREEN'].includes(streetGeometry.signals[0]?.livePhase ?? ''), streetGeometry.signals[0]?.livePhase ?? 'none'))
  results.push(check('empty_overpass_is_empty_not_fake', normalizeOverpassUrbanGeometry({ elements: [] }, 'building').buildings.length === 0, 'no fake city'))
  results.push(check('malformed_overpass_is_empty', normalizeOverpassUrbanGeometry(null, 'building').roads.length === 0, 'null'))

  const many = {
    elements: Array.from({ length: TERRA_URBAN_OBJECT_CAPS.building.buildings + 40 }, (_, index) => houseWay(1000 + index, 'house')),
  }
  const capped = normalizeOverpassUrbanGeometry(many, 'building')
  results.push(check('object_cap_truncates', capped.truncated && capped.buildings.length === TERRA_URBAN_OBJECT_CAPS.building.buildings, `${capped.buildings.length}`))

  const numberedHouses = {
    elements: Array.from({ length: TERRA_URBAN_OBJECT_CAPS.building.houseNumbers + 20 }, (_, index) => houseWay(3000 + index, 'house', { 'addr:housenumber': String(index + 1) })),
  }
  const numberedGeom = normalizeOverpassUrbanGeometry(numberedHouses, 'building')
  results.push(check(
    'house_number_cap_is_36_at_street',
    numberedGeom.labels.filter(label => label.kind === 'house_number').length === TERRA_URBAN_OBJECT_CAPS.building.houseNumbers && numberedGeom.truncated,
    String(numberedGeom.labels.filter(label => label.kind === 'house_number').length),
  ))
  const cityNamed = {
    elements: Array.from({ length: 40 }, (_, index) => ({
      type: 'way' as const,
      id: 4000 + index,
      tags: { highway: 'motorway', name: `Route ${index}` },
      geometry: [
        { lat: 41.08, lon: -81.52 },
        { lat: 41.081, lon: -81.51 },
      ],
    })),
  }
  const cityNamedGeom = normalizeOverpassUrbanGeometry(cityNamed, 'city')
  results.push(check(
    'city_street_name_cap_is_24',
    cityNamedGeom.labels.filter(label => label.kind === 'street').length === TERRA_URBAN_OBJECT_CAPS.city.streetLabels,
    String(cityNamedGeom.labels.filter(label => label.kind === 'street').length),
  ))
  results.push(check(
    'neighborhood_hides_house_numbers',
    normalizeOverpassUrbanGeometry(numberedHouses, 'local').labels.every(label => label.kind !== 'house_number'),
    'no house numbers at local LOD',
  ))

  const akronTileX = lon2tile(AKRON.longitude, 15)
  const akronTileY = lat2tile(AKRON.latitude, 15)
  const akronBounds = tileBounds(15, akronTileX, akronTileY)
  results.push(check('akron_tile_contains_akron', akronBounds.west <= AKRON.longitude && akronBounds.east >= AKRON.longitude && akronBounds.south <= AKRON.latitude && akronBounds.north >= AKRON.latitude, JSON.stringify(akronBounds)))
  const helsinkiTiles = tilesForBounds({ west: 24.93, south: 60.16, east: 24.95, north: 60.18 }, 15, 'building')
  results.push(check('helsinki_viewport_is_bounded_tile_set', helsinkiTiles.length >= 1 && helsinkiTiles.length <= 9, String(helsinkiTiles.length)))

  const cacheKey = urbanTileCacheKey({ z: 15, x: akronTileX, y: akronTileY, lod: 'building' }, TERRA_URBAN_TILE_VERSION)
  results.push(check('cache_key_has_version_lod_and_xyz', cacheKey.includes(TERRA_URBAN_TILE_VERSION) && cacheKey.includes('building') && cacheKey.includes(`${akronTileX}`), cacheKey))

  const cityQuery = buildUrbanOverpassQuery(akronBounds, 'city')
  const buildingQuery = buildUrbanOverpassQuery(akronBounds, 'building')
  results.push(check('city_query_has_no_building_clause', !cityQuery.includes('["building"]'), cityQuery.slice(0, 80)))
  results.push(check('city_query_has_no_signal_nodes', !cityQuery.includes('traffic_signals'), cityQuery.slice(0, 80)))
  results.push(check('building_query_requests_footprints', buildingQuery.includes('way["building"]') && buildingQuery.includes('out geom'), 'geom'))
  results.push(check('building_query_requests_signal_nodes', buildingQuery.includes('node["highway"="traffic_signals"]'), 'signals'))
  results.push(check('query_is_bbox_bounded', buildingQuery.includes(String(akronBounds.south)) && buildingQuery.includes(String(akronBounds.west)), 'bbox'))

  const pick = isTerraUrbanBuildingPick({ terraUrban: true, kind: 'building', building: streetGeometry.buildings[0] })
  results.push(check('urban_pick_id_recognized', pick, 'pick'))
  results.push(check('intelligence_entity_not_treated_as_building', isTerraUrbanBuildingPick({ id: 'terra-feature:digitraffic_marine:1' }) === false, 'entity'))
  registerUrbanGeometryForPick({ buildings: streetGeometry.buildings, roads: streetGeometry.roads, signals: streetGeometry.signals })
  results.push(check('footprint_click_selects_house', findUrbanBuildingAt(-81.51885, 41.08115)?.buildingType === 'house', 'inside house'))
  results.push(check('click_outside_footprint_is_not_a_building', findUrbanBuildingAt(-81.53, 41.09) === null, 'outside'))
  results.push(check('signal_click_selects_static_node', findUrbanSignalAt(-81.5189, 41.0812)?.livePhase === TERRA_LIVE_SIGNAL_PHASE, 'signal'))
  results.push(check('road_click_selects_named_way', findUrbanRoadAt(-81.5195, 41.0805)?.name === 'Highland Ave', findUrbanRoadAt(-81.5195, 41.0805)?.name ?? 'none'))
  const fromEntity = resolveTerraUrbanBuildingFromPick(`${TERRA_URBAN_BUILDING_ENTITY_PREFIX}${streetGeometry.buildings[0].id}`)
  results.push(check('entity_id_resolves_registered_building', fromEntity?.id === streetGeometry.buildings[0].id, fromEntity?.id ?? 'none'))
  results.push(check('compact_pick_id_resolves_without_embedding_footprint', resolveTerraUrbanBuildingFromPick({ terraUrban: true, kind: 'building', buildingId: streetGeometry.buildings[0].id })?.id === streetGeometry.buildings[0].id, 'compact'))
  const selection = urbanBuildingToSelection(streetGeometry.buildings[0])
  results.push(check('selection_does_not_invent_occupant', !('owner' in selection) && !('occupant' in selection), 'no owner'))

  const expanded = expandBounds({ west: -81.52, south: 41.08, east: -81.51, north: 41.09 }, 0.12)
  results.push(check('margin_stays_small', expanded.east - expanded.west < 0.03, String(expanded.east - expanded.west)))

  results.push(check(
    'retry_after_seconds_honored',
    parseRetryAfterMs('12') === 12_000,
    String(parseRetryAfterMs('12')),
  ))
  results.push(check(
    'backoff_uses_retry_after_floor',
    computeOverpassBackoffMs(1, 2_000) === TERRA_URBAN_RETRY_SUPPRESS_MIN_MS,
    String(computeOverpassBackoffMs(1, 2_000)),
  ))
  results.push(check(
    'backoff_grows_without_header',
    computeOverpassBackoffMs(3, null) > computeOverpassBackoffMs(1, null),
    `${computeOverpassBackoffMs(1, null)}→${computeOverpassBackoffMs(3, null)}`,
  ))
  results.push(check('fresh_cache_is_fresh', classifyUrbanCacheFreshness(Date.now() + 1000, Date.now() + 2000) === 'FRESH', 'fresh'))
  results.push(check('expired_fresh_within_stale_window_is_stale', classifyUrbanCacheFreshness(Date.now() - 1000, Date.now() + 2000) === 'STALE', 'stale'))
  results.push(check('past_stale_window_is_expired', classifyUrbanCacheFreshness(Date.now() - 2000, Date.now() - 1000) === 'EXPIRED', 'expired'))
  results.push(check('debounce_is_below_one_second', TERRA_URBAN_CAMERA_DEBOUNCE_MS >= 250 && TERRA_URBAN_CAMERA_DEBOUNCE_MS <= 800, String(TERRA_URBAN_CAMERA_DEBOUNCE_MS)))
  results.push(check('overpass_does_not_internal_retry', TERRA_URBAN_OVERPASS_MAX_RETRIES === 0, String(TERRA_URBAN_OVERPASS_MAX_RETRIES)))

  const coordinator = createUrbanFetchCoordinator<string>()
  let factoryCalls = 0
  const slow = (label: string, ms: number) => () => new Promise<string>(resolve => {
    factoryCalls += 1
    setTimeout(() => resolve(label), ms)
  })
  const first = coordinator.run('a', slow('A', 40))
  const duplicate = coordinator.run('a', slow('A-dup', 40))
  const superseded = coordinator.run('b', slow('B', 10)).catch((error: unknown) => error instanceof Error ? error.message : 'fail')
  const newest = coordinator.run('c', slow('C', 10))
  results.push(check('inflight_dedupe_reuses_same_key', first === duplicate, 'same promise'))
  const newestResult = await newest.catch((error: unknown) => error instanceof Error ? error.message : 'fail')
  const supersededResult = await superseded
  const firstResult = await first
  results.push(check('duplicate_same_key_does_not_start_second_factory', factoryCalls === 2, `calls=${factoryCalls}`))
  results.push(check('newest_viewport_wins', newestResult === 'C', String(newestResult)))
  results.push(check('obsolete_queued_viewport_is_dropped', supersededResult === URBAN_REQUEST_SUPERSEDED, String(supersededResult)))
  results.push(check('running_request_still_completes', firstResult === 'A', firstResult))

  const stalePayload = asStaleUrbanPayload({
    version: TERRA_URBAN_TILE_VERSION,
    source: 'openstreetmap_overpass',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    key: { z: 15, x: 1, y: 1, lod: 'building' },
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    truncated: false,
    roads: [{ id: 'w1', osmType: 'way', osmId: 1, highway: 'residential', name: 'Main', lanes: null, maxspeed: null, geometry: [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 1 }] }],
    buildings: [],
    signals: [],
    labels: [],
    diagnostics: { roads: 'LIVE', buildings: 'UNAVAILABLE', signals: 'UNAVAILABLE', labels: 'UNAVAILABLE' },
    error: null,
  }, 'Overpass HTTP 429', 8000)
  results.push(check('stale_payload_keeps_geometry', stalePayload.roads.length === 1 && stalePayload.diagnostics.roads === 'STALE', stalePayload.diagnostics.roads))
  results.push(check('stale_payload_marks_rate_limited', stalePayload.rateLimited === true, String(stalePayload.rateLimited)))
  results.push(check('height_hierarchy_unchanged_source', resolveUrbanBuildingHeight({ height: '11.5', building: 'house' }).heightSource === 'SOURCE', 'SOURCE'))
  results.push(check('height_hierarchy_unchanged_inferred', resolveUrbanBuildingHeight({ building: 'house' }).heightSource === 'INFERRED', 'INFERRED'))

  return results
}

export async function runUrbanDetailValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runUrbanDetailValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra urbanDetail validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
