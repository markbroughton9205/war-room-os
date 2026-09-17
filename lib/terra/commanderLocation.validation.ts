/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/commanderLocation.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  classifyBrowserSource,
  classifyLocationMovement,
  COMMANDER_LOCATION_HISTORY_DEFAULT,
  COMMANDER_LOCATION_PRIVACY_CLASS,
  deriveUiState,
  INITIAL_COMMANDER_LOCATION_STATE,
  shouldRefreshLocalIntel,
  shouldReverseGeocode,
} from './commanderLocation'
import { PHONE_LOCATION_BRIDGE, PHONE_LOCATION_PUBLIC_BROADCAST } from './phoneLocationBridge'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'privacy_class_is_commander_private',
    COMMANDER_LOCATION_PRIVACY_CLASS === 'COMMANDER_PRIVATE' && COMMANDER_LOCATION_HISTORY_DEFAULT === 'OFF',
    `${COMMANDER_LOCATION_PRIVACY_CLASS}/${COMMANDER_LOCATION_HISTORY_DEFAULT}`,
  ))
  results.push(check(
    'phone_bridge_is_interface_only_not_public',
    PHONE_LOCATION_BRIDGE.status === 'INTERFACE_ONLY' && PHONE_LOCATION_PUBLIC_BROADCAST === false && PHONE_LOCATION_BRIDGE.ingestRoute === null,
    PHONE_LOCATION_BRIDGE.status,
  ))
  results.push(check(
    'initial_state_is_off_without_coordinates',
    INITIAL_COMMANDER_LOCATION_STATE.tracking === 'OFF'
      && INITIAL_COMMANDER_LOCATION_STATE.location === null
      && INITIAL_COMMANDER_LOCATION_STATE.uiState === 'GPS_OFF',
    INITIAL_COMMANDER_LOCATION_STATE.uiState,
  ))
  results.push(check(
    'gps_jitter_does_not_refresh_intel',
    classifyLocationMovement({ lat: 41.0814, lon: -81.519 }, { lat: 41.0815, lon: -81.5191 }) === 'none'
      && !shouldRefreshLocalIntel({
        previous: { lat: 41.0814, lon: -81.519, at: 1_000 },
        next: { lat: 41.0815, lon: -81.5191 },
        now: 2_000,
      }),
    'jitter',
  ))
  results.push(check(
    'meaningful_move_refreshes_after_interval',
    classifyLocationMovement({ lat: 41.0814, lon: -81.519 }, { lat: 41.084, lon: -81.519 }) === 'meaningful'
      && shouldRefreshLocalIntel({
        previous: { lat: 41.0814, lon: -81.519, at: 1_000 },
        next: { lat: 41.084, lon: -81.519 },
        now: 25_000,
      }),
    'meaningful',
  ))
  results.push(check(
    'city_scale_move_is_jurisdiction',
    classifyLocationMovement({ lat: 41.0814, lon: -81.519 }, { lat: 41.15, lon: -81.60 }) === 'jurisdiction',
    'jurisdiction',
  ))
  results.push(check(
    'reverse_geocode_ignores_watch_jitter',
    !shouldReverseGeocode({
      previous: { lat: 41.0814, lon: -81.519, at: 1_000 },
      next: { lat: 41.0816, lon: -81.5192 },
      now: 5_000,
    }),
    'no reverse on jitter',
  ))
  results.push(check(
    'coarse_accuracy_is_network_not_gps',
    classifyBrowserSource(2500) === 'NETWORK_COARSE' && classifyBrowserSource(12) === 'DEVICE_GPS',
    'source heuristic',
  ))
  results.push(check(
    'denied_ui_state_is_not_collapsed_to_unavailable',
    deriveUiState({
      tracking: 'ERROR',
      permission: 'DENIED',
      location: null,
      mode: 'OFF',
      reason: 'denied',
    }) === 'LOCATION_DENIED',
    'denied',
  ))
  results.push(check(
    'locating_with_granted_permission_is_requesting_not_gps_off',
    deriveUiState({
      tracking: 'LOCATING',
      permission: 'GRANTED',
      location: null,
      mode: 'LOCATE_ONCE',
      reason: 'requesting',
    }) === 'REQUESTING_PERMISSION',
    'requesting',
  ))
  results.push(check(
    'no_invented_initial_coordinates',
    INITIAL_COMMANDER_LOCATION_STATE.location === null,
    'null',
  ))
  return results
}

export function runCommanderLocationValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Commander location: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
