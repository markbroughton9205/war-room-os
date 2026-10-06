/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/vehicleIcons.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { terraAircraftBillboardRotationRadians } from './aircraftOrientation'
import {
  aircraftSilhouetteSvg,
  classifyAircraftIconType,
  classifyVesselIconType,
  filterVehicleFeatures,
  silhouetteContainsAbstractArrow,
  sourcedVehicleHeadingDeg,
  vehicleBillboardRotationRadians,
  vehicleClusterPixelRange,
  vehicleIconScale,
  vehicleMatchesLayerFilter,
  vehicleObservationFreshness,
  vehicleShowHeadingTick,
  vesselIconTypeFromAisCode,
  vesselSilhouetteSvg,
} from './vehicleIcons'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'missing_opensky_category_is_unknown_aircraft',
    classifyAircraftIconType({}) === 'UNKNOWN_AIRCRAFT',
    classifyAircraftIconType({}),
  ))
  results.push(check(
    'opensky_rotorcraft_is_helicopter',
    classifyAircraftIconType({ emitterCategory: 8 }) === 'HELICOPTER',
    classifyAircraftIconType({ emitterCategory: 8 }),
  ))
  results.push(check(
    'opensky_light_is_general_aviation',
    classifyAircraftIconType({ emitterCategory: 2 }) === 'GENERAL_AVIATION',
    classifyAircraftIconType({ emitterCategory: 2 }),
  ))
  results.push(check(
    'opensky_heavy_is_not_invented_airliner',
    classifyAircraftIconType({ emitterCategory: 6 }) === 'UNKNOWN_AIRCRAFT',
    classifyAircraftIconType({ emitterCategory: 6 }),
  ))
  results.push(check(
    'opensky_high_performance_is_not_invented_military',
    classifyAircraftIconType({ emitterCategory: 7 }) === 'UNKNOWN_AIRCRAFT',
    classifyAircraftIconType({ emitterCategory: 7 }),
  ))
  results.push(check(
    'callsign_does_not_invent_airliner',
    classifyAircraftIconType({ callsign: 'UAL123', originCountry: 'United States' }) === 'UNKNOWN_AIRCRAFT',
    classifyAircraftIconType({ callsign: 'UAL123' }),
  ))

  results.push(check('ais_70_is_cargo', vesselIconTypeFromAisCode(70) === 'CARGO', vesselIconTypeFromAisCode(70)))
  results.push(check('ais_80_is_tanker', vesselIconTypeFromAisCode(82) === 'TANKER', vesselIconTypeFromAisCode(82)))
  results.push(check('ais_60_is_passenger_not_invented_ferry', vesselIconTypeFromAisCode(60) === 'PASSENGER', vesselIconTypeFromAisCode(60)))
  results.push(check('ais_40_hsc_is_unknown_not_ferry', vesselIconTypeFromAisCode(40) === 'UNKNOWN_VESSEL', vesselIconTypeFromAisCode(40)))
  results.push(check('ais_30_is_fishing', vesselIconTypeFromAisCode(30) === 'FISHING', vesselIconTypeFromAisCode(30)))
  results.push(check('ais_52_is_tug', vesselIconTypeFromAisCode(52) === 'TUG', vesselIconTypeFromAisCode(52)))
  results.push(check('ais_37_is_pleasure', vesselIconTypeFromAisCode(37) === 'PLEASURE', vesselIconTypeFromAisCode(37)))
  results.push(check('ais_35_is_government_from_source', vesselIconTypeFromAisCode(35) === 'GOVERNMENT', vesselIconTypeFromAisCode(35)))
  results.push(check('ais_missing_is_unknown_vessel', classifyVesselIconType({}) === 'UNKNOWN_VESSEL', classifyVesselIconType({})))
  results.push(check(
    'ais_reserved_label_is_unknown',
    classifyVesselIconType({ shipTypeLabel: 'Type 18 (reserved/other)', shipTypeCode: '18' }) === 'UNKNOWN_VESSEL',
    classifyVesselIconType({ shipTypeLabel: 'Type 18 (reserved/other)', shipTypeCode: '18' }),
  ))

  results.push(check(
    'aircraft_heading_uses_true_track_field',
    sourcedVehicleHeadingDeg('aircraft_state', { headingDeg: 271 }) === 271,
    String(sourcedVehicleHeadingDeg('aircraft_state', { headingDeg: 271 })),
  ))
  results.push(check(
    'aircraft_missing_heading_is_null_not_invented',
    sourcedVehicleHeadingDeg('aircraft_state', {}) === null,
    String(sourcedVehicleHeadingDeg('aircraft_state', {})),
  ))
  results.push(check(
    'vessel_heading_prefers_ais_heading',
    sourcedVehicleHeadingDeg('vessel_position', { headingDeg: 90, courseDeg: 100 }) === 90,
    String(sourcedVehicleHeadingDeg('vessel_position', { headingDeg: 90, courseDeg: 100 })),
  ))
  results.push(check(
    'vessel_falls_back_to_sourced_cog',
    sourcedVehicleHeadingDeg('vessel_position', { courseDeg: 180 }) === 180,
    String(sourcedVehicleHeadingDeg('vessel_position', { courseDeg: 180 })),
  ))
  results.push(check(
    'vessel_missing_heading_and_cog_is_null',
    sourcedVehicleHeadingDeg('vessel_position', {}) === null,
    String(sourcedVehicleHeadingDeg('vessel_position', {})),
  ))
  results.push(check(
    'null_heading_uses_neutral_rotation',
    vehicleBillboardRotationRadians(null) === 0,
    String(vehicleBillboardRotationRadians(null)),
  ))
  results.push(check(
    'heading_rotation_matches_aircraft_convention',
    vehicleBillboardRotationRadians(90) === terraAircraftBillboardRotationRadians(90),
    String(vehicleBillboardRotationRadians(90)),
  ))

  const unknownSvg = aircraftSilhouetteSvg('UNKNOWN_AIRCRAFT', false)
  const heliSvg = aircraftSilhouetteSvg('HELICOPTER', true)
  const cargoSvg = vesselSilhouetteSvg('CARGO', false)
  results.push(check('aircraft_silhouette_is_not_abstract_arrow', !silhouetteContainsAbstractArrow(unknownSvg) && unknownSvg.includes('path'), unknownSvg.slice(0, 80)))
  results.push(check('helicopter_silhouette_is_not_abstract_arrow', !silhouetteContainsAbstractArrow(heliSvg) && heliSvg.includes('circle'), heliSvg.slice(0, 90)))
  results.push(check('vessel_silhouette_is_not_abstract_hull_arrow', !silhouetteContainsAbstractArrow(cargoSvg), cargoSvg.slice(0, 80)))
  results.push(check('close_zoom_tick_only_when_requested', aircraftSilhouetteSvg('UNKNOWN_AIRCRAFT', true).includes('M16 28') && !aircraftSilhouetteSvg('UNKNOWN_AIRCRAFT', false).includes('M16 28'), 'tick gated'))

  results.push(check('global_icons_smaller_than_regional', vehicleIconScale('GLOBAL') < vehicleIconScale('REGIONAL'), `${vehicleIconScale('GLOBAL')}/${vehicleIconScale('REGIONAL')}`))
  results.push(check('regional_icons_smaller_than_city', vehicleIconScale('REGIONAL') < vehicleIconScale('CITY'), `${vehicleIconScale('REGIONAL')}/${vehicleIconScale('CITY')}`))
  results.push(check('global_cluster_tighter_than_city', vehicleClusterPixelRange('GLOBAL') > vehicleClusterPixelRange('CITY'), `${vehicleClusterPixelRange('GLOBAL')}/${vehicleClusterPixelRange('CITY')}`))
  results.push(check('heading_tick_only_at_local_bands', vehicleShowHeadingTick('GLOBAL') === false && vehicleShowHeadingTick('CITY') === true, `${vehicleShowHeadingTick('GLOBAL')}/${vehicleShowHeadingTick('CITY')}`))
  results.push(check('selected_does_not_enlarge_excessively', vehicleIconScale('CITY', true) < 1.2, String(vehicleIconScale('CITY', true))))

  results.push(check(
    'freshness_live_within_aircraft_window',
    vehicleObservationFreshness('aircraft_state', '2026-09-18T12:00:00.000Z', '2026-09-18T12:00:30.000Z') === 'LIVE',
    vehicleObservationFreshness('aircraft_state', '2026-09-18T12:00:00.000Z', '2026-09-18T12:00:30.000Z'),
  ))
  results.push(check(
    'freshness_stale_when_old',
    vehicleObservationFreshness('aircraft_state', '2026-09-18T12:00:00.000Z', '2026-09-18T12:10:00.000Z') === 'STALE',
    vehicleObservationFreshness('aircraft_state', '2026-09-18T12:00:00.000Z', '2026-09-18T12:10:00.000Z'),
  ))
  results.push(check(
    'freshness_unavailable_when_missing',
    vehicleObservationFreshness('vessel_position', null, '2026-09-18T12:00:00.000Z') === 'UNAVAILABLE',
    vehicleObservationFreshness('vessel_position', null, '2026-09-18T12:00:00.000Z'),
  ))

  results.push(check(
    'filter_helicopter_excludes_unknown_aircraft',
    vehicleMatchesLayerFilter('aircraft_state', 'UNKNOWN_AIRCRAFT', 'HELICOPTER') === false
      && vehicleMatchesLayerFilter('aircraft_state', 'HELICOPTER', 'HELICOPTER') === true,
    'ok',
  ))
  const mixed = [
    { kind: 'aircraft_state' as const, properties: { emitterCategory: 8 } },
    { kind: 'aircraft_state' as const, properties: {} },
    { kind: 'vessel_position' as const, properties: { shipTypeCode: 70 } },
  ]
  const heliOnly = filterVehicleFeatures(mixed, ['HELICOPTER'])
  results.push(check('filter_does_not_invent_matches', heliOnly.length === 1 && classifyAircraftIconType(heliOnly[0].properties) === 'HELICOPTER', String(heliOnly.length)))
  results.push(check('empty_filters_keep_all', filterVehicleFeatures(mixed, []).length === 3, String(filterVehicleFeatures(mixed, []).length)))

  return results
}

export function runVehicleIconsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runVehicleIconsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra vehicleIcons validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
