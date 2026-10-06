/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/weather/atmosphere/atmosphere.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  CESIUM_WEATHER_IMAGERY_ORDER,
  CLOUD_HISTORICAL_MAX_SKEW_MS,
  CLOUD_OPACITY_CITY,
  CLOUD_OPACITY_ORBIT,
  CLOUD_OPACITY_STREET,
  cloudOpacityForHeight,
  GEOCOLOR_TRANSLUCENCY_NOTE,
  HISTORICAL_UNAVAILABLE_LABEL,
  historicalWeatherAvailability,
  nearestMeasuredFrame,
  RADAR_HISTORICAL_MAX_SKEW_MS,
  radarOpacityForHeight,
  reservedWeatherProviders,
  WEATHER_FEDERATION_PROVIDERS,
  WEATHER_INTERPOLATION_KIND,
  WEATHER_OPACITY_MODEL,
  WEATHER_RENDER_ORDER,
  wiredWeatherProviders,
} from './index'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const orbit = cloudOpacityForHeight({ heightMeters: 8_000_000, commanderOpacity: 1, depthAuto: true })
  const regional = cloudOpacityForHeight({ heightMeters: 200_000, commanderOpacity: 1, depthAuto: true })
  const city = cloudOpacityForHeight({ heightMeters: 20_000, commanderOpacity: 1, depthAuto: true })
  const street = cloudOpacityForHeight({ heightMeters: 400, commanderOpacity: 1, depthAuto: true })
  results.push(check('cloud_orbit_in_band', orbit >= 0.6 && orbit <= 0.9, String(orbit)))
  results.push(check('cloud_street_in_band', street >= 0.1 && street <= 0.3, String(street)))
  results.push(check('cloud_descends_through_atmosphere', orbit > regional && regional > city && city > street, `${orbit}>${regional}>${city}>${street}`))
  results.push(check('cloud_orbit_stop', Math.abs(orbit - CLOUD_OPACITY_ORBIT) < 1e-9, String(orbit)))
  results.push(check('cloud_city_stop', Math.abs(city - CLOUD_OPACITY_CITY) < 1e-9, String(city)))
  results.push(check('cloud_street_stop', Math.abs(street - CLOUD_OPACITY_STREET) < 1e-9, String(street)))
  results.push(check('cloud_commander_zero', cloudOpacityForHeight({ heightMeters: 8_000_000, commanderOpacity: 0, depthAuto: true }) === 0, 'nonzero'))
  results.push(check(
    'cloud_depth_off_stays_orbit',
    cloudOpacityForHeight({ heightMeters: 400, commanderOpacity: 1, depthAuto: false }) === CLOUD_OPACITY_ORBIT,
    'faded without auto',
  ))

  const radarOrbit = radarOpacityForHeight({ heightMeters: 8_000_000, commanderOpacity: 1, depthAuto: true })
  const radarStreet = radarOpacityForHeight({ heightMeters: 400, commanderOpacity: 1, depthAuto: true })
  results.push(check('radar_translucent_at_orbit', radarOrbit > 0.2 && radarOrbit < 0.55, String(radarOrbit)))
  results.push(check('radar_fades_at_street', radarStreet < radarOrbit && radarStreet >= 0.08 && radarStreet <= 0.3, String(radarStreet)))
  results.push(check('radar_not_opaque', radarOrbit < 1 && radarStreet < 1, `${radarOrbit}/${radarStreet}`))

  results.push(check('opacity_is_presentation', WEATHER_INTERPOLATION_KIND === 'INTERPOLATED PRESENTATION', WEATHER_INTERPOLATION_KIND))
  results.push(check('opacity_not_optical_depth', /Not a retrieved cloud optical depth/i.test(WEATHER_OPACITY_MODEL), WEATHER_OPACITY_MODEL))
  results.push(check('geocolor_not_cloud_mask', /not a measured cloud-mask/i.test(GEOCOLOR_TRANSLUCENCY_NOTE), GEOCOLOR_TRANSLUCENCY_NOTE.slice(0, 80)))

  results.push(check('render_order_clouds_above_radar', WEATHER_RENDER_ORDER.indexOf('CLOUDS') < WEATHER_RENDER_ORDER.indexOf('RADAR_PRECIPITATION'), WEATHER_RENDER_ORDER.join('>')))
  results.push(check(
    'cesium_stack_radar_below_clouds',
    CESIUM_WEATHER_IMAGERY_ORDER.indexOf('RADAR_PRECIPITATION') < CESIUM_WEATHER_IMAGERY_ORDER.indexOf('CLOUDS')
      && CESIUM_WEATHER_IMAGERY_ORDER.indexOf('EARTH_IMAGERY') < CESIUM_WEATHER_IMAGERY_ORDER.indexOf('RADAR_PRECIPITATION'),
    CESIUM_WEATHER_IMAGERY_ORDER.join('>'),
  ))

  const wired = wiredWeatherProviders().map(item => item.id)
  const reserved = reservedWeatherProviders().map(item => item.id)
  results.push(check('goes_wired', wired.includes('nasa_gibs_goes_geocolor'), wired.join(',')))
  results.push(check('iem_wired', wired.includes('iem_nexrad_n0q'), wired.join(',')))
  results.push(check('eumetsat_reserved', reserved.includes('eumetsat_msg'), reserved.join(',')))
  results.push(check('himawari_reserved', reserved.includes('jma_himawari'), reserved.join(',')))
  results.push(check('realearth_reserved', reserved.includes('ssec_realearth_globalir'), reserved.join(',')))
  results.push(check('no_fake_eumetsat_wired', WEATHER_FEDERATION_PROVIDERS.find(item => item.id === 'eumetsat_msg')?.status === 'RESERVED_NO_COVERAGE', 'wired'))

  const frames = [
    { timestampIso: '2026-09-18T07:00:00.000Z' },
    { timestampIso: '2026-09-18T07:10:00.000Z' },
  ]
  const nearest = nearestMeasuredFrame(frames, '2026-09-18T07:09:00.000Z')
  results.push(check('nearest_is_measured', nearest?.frame.timestampIso === '2026-09-18T07:10:00.000Z', nearest?.frame.timestampIso ?? 'none'))
  results.push(check(
    'historical_ok_within_skew',
    historicalWeatherAvailability({ timeMode: 'historical', terraTime: '2026-09-18T07:12:00.000Z', frames, maxSkewMs: CLOUD_HISTORICAL_MAX_SKEW_MS }) === 'ok',
    'far',
  ))
  results.push(check(
    'historical_unavailable_when_far',
    historicalWeatherAvailability({ timeMode: 'historical', terraTime: '2026-09-10T07:00:00.000Z', frames, maxSkewMs: RADAR_HISTORICAL_MAX_SKEW_MS }) === 'UNAVAILABLE_FOR_SELECTED_TIME',
    'ok',
  ))
  results.push(check(
    'live_ignores_skew',
    historicalWeatherAvailability({ timeMode: 'live', terraTime: '2026-09-10T07:00:00.000Z', frames, maxSkewMs: RADAR_HISTORICAL_MAX_SKEW_MS }) === 'ok',
    'blocked live',
  ))
  results.push(check('unavailable_label', HISTORICAL_UNAVAILABLE_LABEL === 'UNAVAILABLE FOR SELECTED TIME', HISTORICAL_UNAVAILABLE_LABEL))
  results.push(check('does_not_invent_midpoint_timestamp', nearestMeasuredFrame(frames, '2026-09-18T07:05:00.000Z')?.frame.timestampIso !== '2026-09-18T07:05:00.000Z', 'invented'))

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra weather atmosphere validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
