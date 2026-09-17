/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/streetView/streetView.validation.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  TERRA_CRUDE_EXTRUSION_DEFAULT,
  TERRA_DEFAULT_BUILDING_MODE,
  TERRA_FOOTPRINT_PICKABILITY,
  TERRA_ION_OSM_BUILDINGS_DEFAULT,
  TERRA_OSM_BUILDINGS_AUTOLOAD,
  TERRA_REEARTH_BUILDINGS_DEFAULT,
} from '@/lib/terra/buildingVisual'
import { composeStreetViewState } from './lookup'
import { streetViewButtonLabel } from './buttonLabel'
import { STREET_VIEW_NO_COVERAGE_BODY, STREET_VIEW_NO_COVERAGE_TITLE } from './copy'
import { isGoogleStreetViewHost, isAllowedStreetViewHost } from './hosts'
import { navigationFlags, selectAdjacentIndex, selectTurnIndex } from './navigation'
import type { StreetViewItem, StreetViewProviderAttempt } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function item(partial: Partial<StreetViewItem> & Pick<StreetViewItem, 'id'>): StreetViewItem {
  return {
    provider: 'PANORAMAX',
    latitude: 38.8977,
    longitude: -77.0365,
    headingDeg: 90,
    capturedAt: '2024-06-01T12:00:00.000Z',
    distanceMeters: 12,
    imageUrl: 'https://api.panoramax.xyz/api/pictures/1/sd.jpg',
    thumbUrl: 'https://api.panoramax.xyz/api/pictures/1/thumb.jpg',
    viewerUrl: 'https://panoramax.xyz/#pic=1',
    sourceUrl: 'https://panoramax.xyz/#pic=1',
    license: 'CC-BY-SA',
    attribution: 'Panoramax contributors',
    sequenceId: 'seq-1',
    hasPrevious: true,
    hasNext: true,
    canTurn: true,
    authModel: 'PANORAMAX_PUBLIC',
    ...partial,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('default_building_mode_is_imagery_first', TERRA_DEFAULT_BUILDING_MODE === 'IMAGERY_FIRST', TERRA_DEFAULT_BUILDING_MODE))
  results.push(check('crude_extrusion_default_off', TERRA_CRUDE_EXTRUSION_DEFAULT === false, String(TERRA_CRUDE_EXTRUSION_DEFAULT)))
  results.push(check('ion_osm_buildings_default_off', TERRA_ION_OSM_BUILDINGS_DEFAULT === false, String(TERRA_ION_OSM_BUILDINGS_DEFAULT)))
  results.push(check('reearth_buildings_default_off', TERRA_REEARTH_BUILDINGS_DEFAULT === false, String(TERRA_REEARTH_BUILDINGS_DEFAULT)))
  results.push(check('osm_buildings_do_not_autoload', TERRA_OSM_BUILDINGS_AUTOLOAD === false, String(TERRA_OSM_BUILDINGS_AUTOLOAD)))
  results.push(check('footprint_pickability_preserved', TERRA_FOOTPRINT_PICKABILITY === true, String(TERRA_FOOTPRINT_PICKABILITY)))

  const available = composeStreetViewState([{
    provider: 'PANORAMAX',
    state: 'AVAILABLE',
    authModel: 'PANORAMAX_PUBLIC',
    itemCount: 1,
    honesty: 'ok',
  }], 1)
  results.push(check('coverage_is_available_when_items_exist', available.state === 'AVAILABLE', available.state))

  const noCoverage: StreetViewProviderAttempt[] = [
    { provider: 'PANORAMAX', state: 'NO_COVERAGE', authModel: 'PANORAMAX_PUBLIC', itemCount: 0, honesty: 'none' },
    { provider: 'MAPILLARY', state: 'NO_COVERAGE', authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN', itemCount: 0, honesty: 'none' },
  ]
  const empty = composeStreetViewState(noCoverage, 0)
  results.push(check('no_items_is_no_coverage', empty.state === 'NO_COVERAGE', empty.state))

  const authOnly = composeStreetViewState([
    { provider: 'PANORAMAX', state: 'NO_COVERAGE', authModel: 'PANORAMAX_PUBLIC', itemCount: 0, honesty: 'none' },
    { provider: 'MAPILLARY', state: 'PROVIDER_AUTH_REQUIRED', authModel: 'MAPILLARY_OAUTH_CLIENT_TOKEN', itemCount: 0, honesty: 'token' },
  ], 0)
  results.push(check('mapillary_auth_with_panoramax_empty_is_no_public_coverage', authOnly.state === 'NO_COVERAGE', authOnly.state))

  const label = streetViewButtonLabel('NO_COVERAGE')
  results.push(check('button_label_honest_when_no_coverage', label.primary === 'Street View' && label.secondary === 'No public coverage', `${label.primary} / ${label.secondary}`))

  results.push(check('google_hosts_are_rejected', isGoogleStreetViewHost('maps.googleapis.com') && isGoogleStreetViewHost('www.google.com') && !isAllowedStreetViewHost('maps.google.com'), 'google blocked'))
  results.push(check('panoramax_and_mapillary_hosts_allowed', isAllowedStreetViewHost('api.panoramax.xyz') && isAllowedStreetViewHost('graph.mapillary.com'), 'lawful hosts'))

  const items = [
    item({ id: 'a', headingDeg: 10, distanceMeters: 8 }),
    item({ id: 'b', headingDeg: 95, longitude: -77.0364, distanceMeters: 11 }),
    item({ id: 'c', headingDeg: 280, longitude: -77.0366, distanceMeters: 14 }),
  ]
  results.push(check('previous_next_require_sequence', selectAdjacentIndex(items.length, 0, 1) === 1 && selectAdjacentIndex(1, 0, -1) === null, 'sequence'))
  results.push(check('turn_right_uses_heading', selectTurnIndex(items, 0, 'right') === 1, String(selectTurnIndex(items, 0, 'right'))))
  results.push(check('turn_left_uses_heading', selectTurnIndex(items, 0, 'left') === 2, String(selectTurnIndex(items, 0, 'left'))))
  const flags = navigationFlags([item({ id: 'solo', headingDeg: null, canTurn: false })], 0)
  results.push(check('solo_image_disables_nav', flags.canPrevious === false && flags.canTurnLeft === false && flags.canTurnRight === false && flags.canGoToLocation === true, 'solo'))

  results.push(check('no_coverage_copy_is_honest', STREET_VIEW_NO_COVERAGE_TITLE === 'STREET VIEW UNAVAILABLE HERE' && STREET_VIEW_NO_COVERAGE_BODY.includes('No public street imagery provider'), `${STREET_VIEW_NO_COVERAGE_TITLE} / ${STREET_VIEW_NO_COVERAGE_BODY}`))
  const urban = readFileSync(resolve('components/war-room/terra/TerraUrbanDetail.tsx'), 'utf8')
  results.push(check('footprint_path_omits_extruded_height', urban.includes('CRUDE_EXTRUSION = DISABLED_BY_DEFAULT') && urban.includes('IMAGERY_FIRST footprint') && urban.includes('classificationType: Cesium.ClassificationType.TERRAIN'), 'footprints not extruded'))
  const globe = readFileSync(resolve('components/war-room/terra/TerraGlobe.tsx'), 'utf8')
  const osmBuildings = readFileSync(resolve('components/war-room/terra/TerraCesiumOsmBuildings.tsx'), 'utf8')
  results.push(check('globe_does_not_autoload_osm_buildings', !globe.includes('createOsmBuildingsAsync'), 'boot path imagery-first'))
  results.push(check('osm_buildings_are_commander_opt_in', osmBuildings.includes('createOsmBuildingsAsync') && osmBuildings.includes('Commander opt-in'), 'opt-in tileset'))
  const shell = readFileSync(resolve('components/war-room/terra/TerraShell.tsx'), 'utf8')
  results.push(check('shell_defaults_use_imagery_first_constants', shell.includes('TERRA_CRUDE_EXTRUSION_DEFAULT') && shell.includes('TERRA_ION_OSM_BUILDINGS_DEFAULT') && shell.includes('TerraCesiumOsmBuildings'), 'shell defaults'))
  const command = readFileSync(resolve('components/war-room/terra/TerraLocationCommandInput.tsx'), 'utf8')
  const streetControl = readFileSync(resolve('components/war-room/terra/TerraStreetViewControl.tsx'), 'utf8')
  const buttonLabel = readFileSync(resolve('lib/terra/streetView/buttonLabel.ts'), 'utf8')
  results.push(check('street_view_is_first_class_command', command.includes('TerraStreetViewControl') && command.includes('onStreetView') && streetControl.includes('data-testid="terra-street-view"') && buttonLabel.includes("'Street View'"), 'command cluster'))
  const api = readFileSync(resolve('app/api/terra/street-view/route.ts'), 'utf8')
  results.push(check('street_view_api_is_coordinate_only', api.includes('latitude') && api.includes('longitude') && api.includes('nominatimUsed: false') && api.includes('googleUsed: false') && !api.includes('googleapis') && !api.includes('maps.google'), 'coords only'))
  return results
}

export function runStreetViewValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runStreetViewValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Street view validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
