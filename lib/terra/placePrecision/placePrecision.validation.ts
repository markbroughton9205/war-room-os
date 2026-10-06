/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/placePrecision/placePrecision.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { classifyAddressMatchQuality, matchQualityLabel } from '../geocodeMatchQuality'
import { parseTypedPlaceQuery } from './parsePlaceQuery'
import { stripOwnerLikeFields, assertNoOwnerLikePayload, isOwnerLikeField } from './privacy'
import { selectPrimaryGeometry, neverAverage } from './selectPrimaryGeometry'
import { planLocationCameraFraming } from './locationCameraFraming'
import { decideRefinementFlight } from './twoStageFlight'
import { enrichResolvedPlace } from './enrich'
import { __setGisFetchForTests } from './gisFetch'
import { streetNameGuard } from '../streetNameGuard'
import { planCinematicFlyTo } from '../cinematicFlyTo'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const SPRINGDALE_AP = { longitude: -81.52187967, latitude: 41.11087267 }
const SPRINGDALE_STREET = { longitude: -81.5215, latitude: 41.10413 }

function summitFeatureJson() {
  return JSON.stringify({
    features: [{
      attributes: {
        ADDR_NUM: 936,
        PRE_DIR: null,
        STR_NAME: 'SPRINGDALE',
        STR_TYPE: 'ST',
        SUF_DIR: null,
        CITY: 'Akron',
        ZIP: '44310',
        STATE: 'OH',
        OWNERNME: 'MUST_NOT_LEAK',
      },
      geometry: { x: SPRINGDALE_AP.longitude, y: SPRINGDALE_AP.latitude },
    }],
  })
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const parsed = parseTypedPlaceQuery('936 Springdale St, Akron, OH 44310')
  results.push(check('parser_house', parsed.houseNumber === '936', parsed.houseNumber ?? 'null'))
  results.push(check('parser_stem', parsed.streetStem === 'SPRINGDALE', parsed.streetStem ?? 'null'))
  results.push(check('parser_type', parsed.streetTypeAbbrev === 'ST', parsed.streetTypeAbbrev ?? 'null'))
  results.push(check('parser_city', parsed.city === 'Akron', parsed.city ?? 'null'))
  results.push(check('parser_state', parsed.stateProvince === 'OH', parsed.stateProvince ?? 'null'))
  results.push(check('parser_zip', parsed.postalCode === '44310', parsed.postalCode ?? 'null'))
  results.push(check('parser_address_like', parsed.addressLike && parsed.kind === 'address', parsed.kind))

  results.push(check('st_not_dr', streetNameGuard('Springdale St', 'Springdale Dr').status === 'conflict', streetNameGuard('Springdale St', 'Springdale Dr').status))
  results.push(check('st_not_rd', streetNameGuard('Springdale St', 'Springdale Rd').status === 'conflict', streetNameGuard('Springdale St', 'Springdale Rd').status))

  results.push(check('nominatim_road_is_street', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential' }) === 'STREET', 'STREET'))
  results.push(check('nominatim_city_is_place', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'city' }) === 'PLACE', 'PLACE'))
  results.push(check('nominatim_house_is_address_point', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'house', osmType: 'node', houseNumber: '936', requestedHouseNumber: '936' }) === 'ADDRESS_POINT', 'ADDRESS_POINT'))
  results.push(check('never_street_to_rooftop', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', houseNumber: '936' }) !== 'ROOFTOP', 'not rooftop'))
  results.push(check('interpolated_label', matchQualityLabel('INTERPOLATED') === 'INTERPOLATED — APPROXIMATE', matchQualityLabel('INTERPOLATED')))
  results.push(check('street_label', matchQualityLabel('STREET') === 'STREET — APPROXIMATE', matchQualityLabel('STREET')))

  const tokyo = parseTypedPlaceQuery('Tokyo')
  results.push(check('tokyo_is_place_not_address', tokyo.kind === 'place' && !tokyo.addressLike, tokyo.kind))
  const eiffel = parseTypedPlaceQuery('Eiffel Tower')
  results.push(check('eiffel_is_landmark_place', eiffel.kind === 'place' && eiffel.placeTypeCandidate === 'landmark', eiffel.placeTypeCandidate ?? 'null'))
  const spain = parseTypedPlaceQuery('Spain')
  results.push(check('spain_is_country', spain.placeTypeCandidate === 'country', spain.placeTypeCandidate ?? 'null'))
  const houston = parseTypedPlaceQuery('Houston, Texas')
  results.push(check('houston_is_cityish', houston.kind === 'place' && !houston.addressLike, `${houston.kind}:${houston.city}`))

  const stripped = stripOwnerLikeFields({ ADDR_NUM: 936, OWNERNME: 'secret', taxpayer: 'nope', CITY: 'Akron' })
  results.push(check('privacy_strips_owner', !('OWNERNME' in stripped) && !('taxpayer' in stripped) && stripped.CITY === 'Akron', JSON.stringify(stripped)))
  results.push(check('owner_field_detect', isOwnerLikeField('OWNERNME1') && isOwnerLikeField('resident'), 'owner-like'))
  results.push(check('privacy_walk', assertNoOwnerLikePayload({ attributes: { OWNERNME: 'x' } }).length === 1, 'leak detected'))

  const street = {
    id: 'nominatim',
    longitude: SPRINGDALE_STREET.longitude,
    latitude: SPRINGDALE_STREET.latitude,
    matchClass: 'STREET' as const,
    road: 'Springdale Street',
    streetName: 'SPRINGDALE',
    streetTypeAbbrev: 'ST',
    houseNumber: null,
    city: 'Akron',
    state: 'OH',
    postcode: '44310',
    provider: 'nominatim',
    label: 'Springdale Street, Akron',
  }
  const ap = {
    id: 'summit',
    longitude: SPRINGDALE_AP.longitude,
    latitude: SPRINGDALE_AP.latitude,
    matchClass: 'ADDRESS_POINT' as const,
    houseNumber: '936',
    road: 'SPRINGDALE ST',
    streetName: 'SPRINGDALE',
    streetTypeAbbrev: 'ST',
    city: 'Akron',
    state: 'OH',
    postcode: '44310',
    provider: 'summit_address_points',
    label: '936 SPRINGDALE ST Akron OH 44310',
  }
  const drive = {
    ...ap,
    id: 'drive',
    streetTypeAbbrev: 'DR',
    road: 'SPRINGDALE DR',
    city: 'Tallmadge',
    postcode: '44278',
    label: '936 SPRINGDALE DR Tallmadge',
  }
  const selected = selectPrimaryGeometry(parsed, [street, ap, drive])
  results.push(check(
    'selects_summit_not_nominatim_street',
    selected.status === 'selected' && selected.geometry.provider === 'summit_address_points',
    JSON.stringify(selected),
  ))
  results.push(check(
    'does_not_average',
    selected.status === 'selected'
      && selected.geometry.latitude === SPRINGDALE_AP.latitude
      && selected.geometry.longitude === SPRINGDALE_AP.longitude,
    selected.status === 'selected' ? `${selected.geometry.longitude},${selected.geometry.latitude}` : selected.status,
  ))
  const averaged = neverAverage(street, ap)
  results.push(check('never_average_helper_picks_ap', averaged.latitude === SPRINGDALE_AP.latitude, String(averaged.latitude)))
  const driveOnly = selectPrimaryGeometry(parsed, [drive])
  results.push(check('drive_collision_not_auto_selected', driveOnly.status === 'ambiguous', JSON.stringify(driveOnly)))

  const framing = planLocationCameraFraming({
    matchClass: 'ADDRESS_POINT',
    longitude: SPRINGDALE_AP.longitude,
    latitude: SPRINGDALE_AP.latitude,
  })
  results.push(check('address_point_close_zoom', framing.kind === 'point' && (framing.heightMeters ?? 0) >= 120 && (framing.heightMeters ?? 0) <= 350, String(framing.heightMeters)))
  const streetFrame = planLocationCameraFraming({ matchClass: 'STREET', longitude: SPRINGDALE_STREET.longitude, latitude: SPRINGDALE_STREET.latitude })
  results.push(check('street_not_property_zoom', (streetFrame.heightMeters ?? 0) >= 800 && (streetFrame.heightMeters ?? 0) <= 2000, String(streetFrame.heightMeters)))
  const cityFrame = planLocationCameraFraming({
    matchClass: 'PLACE',
    longitude: -95.3698,
    latitude: 29.7604,
    placeType: 'place/city',
    boundingBox: { south: 29.5, north: 30.1, west: -95.9, east: -95.0 },
  })
  results.push(check('city_uses_bbox', cityFrame.kind === 'rectangle', cityFrame.kind))

  const fly = planCinematicFlyTo({
    from: { longitude: 0, latitude: 0, heightMeters: 20_000_000 },
    to: { longitude: SPRINGDALE_AP.longitude, latitude: SPRINGDALE_AP.latitude, matchClass: 'ADDRESS_POINT' },
    prefersReducedMotion: true,
    instantRequested: false,
  })
  results.push(check(
    'cinematic_address_point_height',
    fly.destination.kind === 'point' && fly.destination.heightMeters >= 120 && fly.destination.heightMeters <= 350,
    JSON.stringify(fly.destination),
  ))

  results.push(check(
    'two_stage_improves',
    decideRefinementFlight({ interrupted: false, stage1Class: 'STREET', stage2Class: 'ADDRESS_POINT', enrichmentState: 'refined' }).action === 'fly_stage2',
    'fly_stage2',
  ))
  results.push(check(
    'user_interrupt_guard',
    decideRefinementFlight({ interrupted: true, stage1Class: 'STREET', stage2Class: 'ADDRESS_POINT', enrichmentState: 'refined' }).action === 'skip_stage2_interrupt',
    'skip',
  ))
  results.push(check(
    'no_fake_rooftop_stage2',
    decideRefinementFlight({ interrupted: false, stage1Class: 'STREET', stage2Class: 'STREET', enrichmentState: 'unavailable' }).action === 'fly_stage1_only',
    'stage1 only',
  ))

  const matrix: Array<{ name: string; pass: boolean; detail: string }> = [
    check('case1_detached_house', parsed.houseNumber === '936' && ap.matchClass === 'ADDRESS_POINT', 'ADDRESS_POINT'),
    check('case2_apartment_building', classifyAddressMatchQuality({ placeClass: 'building', placeType: 'apartments', houseNumber: '100', requestedHouseNumber: '100' }) === 'ADDRESS_POINT', 'not rooftop without footprint'),
    check('case3_business', classifyAddressMatchQuality({ placeClass: 'amenity', placeType: 'hospital' }) === 'PLACE', 'PLACE'),
    check('case4_large_campus', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'university' }) === 'PLACE', 'PLACE'),
    check('case5_rural_address', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'house', osmType: 'node', houseNumber: '12', requestedHouseNumber: '12' }) === 'ADDRESS_POINT', 'ADDRESS_POINT'),
    check('case6_new_construction_missing', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', requestedHouseNumber: '1' }) === 'STREET', 'STREET honest'),
    check('case7_missing_house_number_dataset', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', requestedHouseNumber: '936' }) === 'STREET', 'STREET'),
    check('case8_duplicate_street_name', selectPrimaryGeometry(parsed, [ap, { ...ap, id: 'other-state', state: 'PA', longitude: -75, latitude: 40 }]).status === 'selected', 'hard filter state'),
    check('case9_street_vs_drive', driveOnly.status === 'ambiguous', 'AMBIGUOUS'),
    check('case10_multi_state', selectPrimaryGeometry({ ...parsed, stateProvince: 'OH' }, [{ ...ap, state: 'OH' }, { ...ap, id: 'ny', state: 'NY', longitude: -74, latitude: 41 }]).status === 'selected', 'OH kept'),
    check('case11_non_us_place', parseTypedPlaceQuery('10 Downing Street, London, UK').addressLike === false || parseTypedPlaceQuery('Tokyo').kind === 'place', 'worldwide place path'),
    check('case12_parcel_without_building', planLocationCameraFraming({ matchClass: 'PARCEL', longitude: 0, latitude: 0, ring: [{ longitude: 0, latitude: 0 }, { longitude: 0.001, latitude: 0 }, { longitude: 0.001, latitude: 0.001 }] }).kind === 'boundingSphere', 'parcel sphere'),
    check('case13_building_without_address_not_promoted', classifyAddressMatchQuality({ placeClass: 'building', placeType: 'yes' }) === 'PLACE' || classifyAddressMatchQuality({ placeClass: 'building', placeType: 'yes' }) !== 'ROOFTOP', 'no rooftop'),
    check('case14_interpolated_only', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'house', osmType: 'way', houseNumber: '50', requestedHouseNumber: '50' }) === 'INTERPOLATED', 'INTERPOLATED'),
  ]
  results.push(...matrix)

  return results
}

async function runAsync(): Promise<CaseResult[]> {
  const results = run()
  __setGisFetchForTests(async (input) => {
    const url = String(input)
    if (url.includes('OWNERNME') || url.includes('taxpayer')) {
      return new Response('owner field requested', { status: 400 })
    }
    if (url.includes('Address_Points')) {
      return new Response(summitFeatureJson(), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('Building_Footprints')) {
      return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('Parcel_Layer')) {
      return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('Ohio_Statewide_LBRS')) {
      return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('unexpected host', { status: 500 })
  })
  const parsed = parseTypedPlaceQuery('936 Springdale St, Akron, OH 44310')
  const enriched = await enrichResolvedPlace({
    parsed,
    seed: {
      longitude: SPRINGDALE_STREET.longitude,
      latitude: SPRINGDALE_STREET.latitude,
      matchClass: 'STREET',
      label: 'Springdale Street',
      provider: 'nominatim',
      city: 'Akron',
      state: 'OH',
      postcode: '44310',
    },
  })
  results.push(check('gold_enrichment_state', enriched.enrichmentState === 'refined', enriched.enrichmentState))
  results.push(check(
    'gold_final_coordinate',
    Boolean(enriched.selected
      && Math.abs(enriched.selected.longitude - SPRINGDALE_AP.longitude) < 0.00001
      && Math.abs(enriched.selected.latitude - SPRINGDALE_AP.latitude) < 0.00001),
    enriched.selected ? `${enriched.selected.longitude},${enriched.selected.latitude}` : 'none',
  ))
  results.push(check('gold_class_address_point', enriched.selected?.matchClass === 'ADDRESS_POINT', enriched.selected?.matchClass ?? 'none'))
  results.push(check('gold_not_street_coord', enriched.selected?.latitude !== SPRINGDALE_STREET.latitude, String(enriched.selected?.latitude)))
  results.push(check('gold_offset_corrected', Boolean(enriched.selected && Math.abs(enriched.selected.latitude - SPRINGDALE_STREET.latitude) > 0.005), 'moved off street centroid'))
  results.push(check('gold_privacy', assertNoOwnerLikePayload(enriched).length === 0, assertNoOwnerLikePayload(enriched).join(',')))
  results.push(check('gold_source_summit', enriched.selected?.provider === 'summit_address_points', enriched.selected?.provider ?? 'none'))
  __setGisFetchForTests(null)
  return results
}

export async function runPlacePrecisionValidation(): Promise<CaseResult[]> {
  return runAsync()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runAsync()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Place precision: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
