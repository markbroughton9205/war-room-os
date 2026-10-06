/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/streetNameGuard.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { expandStreetSuffix, normalizeStreetName, streetNameGuard } from './streetNameGuard'
import { selectGeocodeCandidates } from './geocodeCandidateSelect'
import { classifyAddressMatchQuality, matchQualityLabel } from './geocodeMatchQuality'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('st_normalizes_to_street', normalizeStreetName('Springdale St')?.type === 'street' && normalizeStreetName('Springdale St')?.stem === 'springdale', JSON.stringify(normalizeStreetName('Springdale St'))))
  results.push(check('dr_normalizes_to_drive', normalizeStreetName('Springdale Drive')?.type === 'drive', JSON.stringify(normalizeStreetName('Springdale Drive'))))
  results.push(check('street_not_drive', streetNameGuard('Springdale St', 'Springdale Drive').status === 'conflict', streetNameGuard('Springdale St', 'Springdale Drive').status))
  results.push(check('street_matches_street', streetNameGuard('Springdale St', 'Springdale Street').status === 'match', streetNameGuard('Springdale St', 'Springdale Street').status))
  results.push(check('street_not_road', streetNameGuard('Main St', 'Main Rd').status === 'conflict', streetNameGuard('Main St', 'Main Rd').status))
  results.push(check('drive_not_avenue', streetNameGuard('Oak Dr', 'Oak Ave').status === 'conflict', streetNameGuard('Oak Dr', 'Oak Ave').status))
  results.push(check('expand_rd', expandStreetSuffix('Market Rd') === 'Market Road', expandStreetSuffix('Market Rd')))

  const mixed = selectGeocodeCandidates({
    requestedStreet: 'Springdale St',
    requestedHouseNumber: '932',
    candidates: [
      { label: 'Springdale Drive, Akron, Ohio', road: 'Springdale Drive', placeClass: 'highway', placeType: 'residential' },
      { label: 'Springdale Street, Akron, Ohio', road: 'Springdale Street', placeClass: 'highway', placeType: 'residential' },
    ],
  })
  results.push(check(
    'springdale_street_not_drive',
    mixed.quality === 'strong' && mixed.quality === 'strong' && mixed.candidate.road === 'Springdale Street' && mixed.addressMatchQuality === 'STREET',
    JSON.stringify(mixed),
  ))

  const driveOnly = selectGeocodeCandidates({
    requestedStreet: 'Springdale St',
    candidates: [{ label: 'Springdale Drive, Akron, Ohio', road: 'Springdale Drive', placeClass: 'highway', placeType: 'residential' }],
  })
  results.push(check('drive_only_is_ambiguous_not_auto_selected', driveOnly.quality === 'ambiguous', JSON.stringify(driveOnly)))

  const twoCities = selectGeocodeCandidates({
    requestedStreet: null,
    candidates: [
      { label: 'Richmond, London, UK' },
      { label: 'Richmond, Virginia, USA' },
    ],
  })
  results.push(check('multi_hit_is_ambiguous', twoCities.quality === 'ambiguous' && twoCities.candidates.length === 2, JSON.stringify(twoCities)))

  results.push(check('highway_is_street_quality', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', requestedHouseNumber: '932' }) === 'STREET', 'STREET'))
  results.push(check('road_never_rooftop', classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', houseNumber: null }) !== 'ROOFTOP', 'not rooftop'))
  results.push(check(
    'nominatim_house_node_is_address_point_not_rooftop',
    classifyAddressMatchQuality({ placeClass: 'building', placeType: 'house', osmType: 'node', houseNumber: '932', requestedHouseNumber: '932' }) === 'ADDRESS_POINT',
    'ADDRESS_POINT',
  ))
  results.push(check(
    'highway_never_promoted_to_rooftop',
    classifyAddressMatchQuality({ placeClass: 'highway', placeType: 'residential', houseNumber: '936', requestedHouseNumber: '936' }) === 'STREET',
    'STREET',
  ))
  results.push(check(
    'interpolated_way_house',
    classifyAddressMatchQuality({ placeClass: 'place', placeType: 'house', osmType: 'way', houseNumber: '932', requestedHouseNumber: '932' }) === 'INTERPOLATED',
    'INTERPOLATED',
  ))
  results.push(check('city_is_place_not_address', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'city' }) === 'PLACE', 'PLACE'))
  results.push(check('postcode_is_place_not_address', classifyAddressMatchQuality({ placeClass: 'place', placeType: 'postcode' }) === 'PLACE', 'PLACE'))
  results.push(check('street_label', matchQualityLabel('STREET') === 'STREET — APPROXIMATE', matchQualityLabel('STREET')))
  results.push(check('ambiguous_label', matchQualityLabel('AMBIGUOUS') === 'AMBIGUOUS — SELECT LOCATION', matchQualityLabel('AMBIGUOUS')))
  results.push(check('calle_is_not_street', streetNameGuard('Calle Mayor', 'Mayor Street').status === 'conflict', streetNameGuard('Calle Mayor', 'Mayor Street').status))
  results.push(check('rue_is_not_street', streetNameGuard('Rue Rivoli', 'Rivoli Street').status === 'conflict', streetNameGuard('Rue Rivoli', 'Rivoli Street').status))
  results.push(check('jalan_is_not_road', streetNameGuard('Jalan Sultan', 'Sultan Road').status === 'conflict', streetNameGuard('Jalan Sultan', 'Sultan Road').status))
  results.push(check('helsinki_katu_unconstrained_vs_us_suffix', streetNameGuard('Mannerheiminkatu', 'Mannerheimintie').status === 'unconstrained', streetNameGuard('Mannerheiminkatu', 'Mannerheimintie').status))
  return results
}

export function runStreetNameGuardValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Street name guard: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
