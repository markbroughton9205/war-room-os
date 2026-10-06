/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/solarLighting.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'
import { TERRA_NIGHT_LIGHTS_COMPOSITE_DATE, TERRA_NIGHT_LIGHTS_GIBS_LAYER_ID } from './nightLightsSource'
import {
  displayedLightingState,
  lightingStateFromElevation,
  nightBlendFromElevation,
  nightLightsVisibleAtActiveLocation,
  parseTerraLightingMode,
  resolveNightLayerVisual,
  resolveSolarLighting,
  TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE,
  TERRA_GLOBE_LIGHTING_FADE_OUT_DISTANCE,
  TERRA_DAYTIME_LAYER_NIGHT_ALPHA,
} from './solarLighting'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/** Acceptance fixtures only — not a routing table. */
const FIXTURES = {
  akron: { name: 'Akron', latitude: 41.0814, longitude: -81.519 },
  losAngeles: { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  newYork: { name: 'New York', latitude: 40.7128, longitude: -74.006 },
  london: { name: 'London', latitude: 51.5074, longitude: -0.1278 },
  helsinki: { name: 'Helsinki', latitude: 60.1699, longitude: 24.9384 },
  tokyo: { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
  singapore: { name: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  sydney: { name: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
} as const

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const instant = '2026-09-18T16:00:00.000Z'

  results.push(check('bands_day', lightingStateFromElevation(12) === 'DAY', String(lightingStateFromElevation(12))))
  results.push(check('bands_civil', lightingStateFromElevation(-3) === 'CIVIL_TWILIGHT', String(lightingStateFromElevation(-3))))
  results.push(check('bands_nautical', lightingStateFromElevation(-9) === 'NAUTICAL_TWILIGHT', String(lightingStateFromElevation(-9))))
  results.push(check('bands_night', lightingStateFromElevation(-20) === 'NIGHT', String(lightingStateFromElevation(-20))))
  results.push(check('blend_day_is_zero', nightBlendFromElevation(10) === 0, String(nightBlendFromElevation(10))))
  results.push(check('blend_night_is_one', nightBlendFromElevation(-12) === 1, String(nightBlendFromElevation(-12))))
  results.push(check(
    'blend_civil_is_partial',
    nightBlendFromElevation(-3) > 0 && nightBlendFromElevation(-3) < 1,
    String(nightBlendFromElevation(-3)),
  ))

  const resolved = Object.fromEntries(
    Object.entries(FIXTURES).map(([id, row]) => [id, resolveSolarLighting(row.latitude, row.longitude, instant)]),
  ) as Record<keyof typeof FIXTURES, ReturnType<typeof resolveSolarLighting>>

  for (const [id, row] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, (typeof FIXTURES)[keyof typeof FIXTURES]]>) {
    const solar = resolved[id]
    results.push(check(
      `${id}_resolves`,
      Boolean(solar && Number.isFinite(solar.elevationDegrees) && solar.terraTime === instant),
      solar ? `${solar.lightingState} elev=${solar.elevationDegrees.toFixed(2)}` : 'null',
    ))
    results.push(check(
      `${id}_not_machine_hour`,
      Boolean(solar && solar.latitude === row.latitude && solar.longitude === row.longitude),
      solar ? `${solar.latitude},${solar.longitude}` : 'null',
    ))
  }

  const akron = resolved.akron
  const tokyo = resolved.tokyo
  const sydney = resolved.sydney
  const helsinki = resolved.helsinki
  results.push(check(
    'akron_day_at_16z',
    Boolean(akron && akron.elevationDegrees > 0 && akron.lightingState === 'DAY'),
    akron ? `${akron.lightingState} ${akron.elevationDegrees.toFixed(2)}` : 'null',
  ))
  results.push(check(
    'tokyo_night_at_16z',
    Boolean(tokyo && tokyo.elevationDegrees < 0 && (tokyo.lightingState === 'NIGHT' || tokyo.lightingState === 'NAUTICAL_TWILIGHT')),
    tokyo ? `${tokyo.lightingState} ${tokyo.elevationDegrees.toFixed(2)}` : 'null',
  ))
  results.push(check(
    'sydney_night_at_16z',
    Boolean(sydney && sydney.elevationDegrees < 0),
    sydney ? `${sydney.lightingState} ${sydney.elevationDegrees.toFixed(2)}` : 'null',
  ))
  results.push(check(
    'opposite_hemisphere_not_same_state',
    Boolean(akron && tokyo && akron.lightingState !== tokyo.lightingState),
    `akron=${akron?.lightingState ?? '?'} tokyo=${tokyo?.lightingState ?? '?'}`,
  ))
  results.push(check(
    'helsinki_has_sunrise_sunset',
    Boolean(helsinki?.sunriseUtc && helsinki.sunsetUtc && helsinki.sunriseUtc !== helsinki.sunsetUtc),
    `${helsinki?.sunriseLocal ?? helsinki?.sunriseUtc ?? 'none'} / ${helsinki?.sunsetLocal ?? helsinki?.sunsetUtc ?? 'none'}`,
  ))
  results.push(check(
    'akron_has_sunrise_sunset',
    Boolean(akron?.sunriseUtc && akron.sunsetUtc),
    `${akron?.sunriseLocal ?? 'none'} / ${akron?.sunsetLocal ?? 'none'}`,
  ))

  const polarSummer = resolveSolarLighting(90, 0, '2026-06-21T12:00:00.000Z')
  results.push(check(
    'north_pole_june_is_day',
    Boolean(polarSummer && polarSummer.elevationDegrees > 0 && polarSummer.lightingState === 'DAY'),
    polarSummer ? `${polarSummer.lightingState} ${polarSummer.elevationDegrees.toFixed(2)}` : 'null',
  ))

  results.push(check('parse_default_auto', parseTerraLightingMode(null) === 'AUTO', parseTerraLightingMode(null)))
  results.push(check('parse_night', parseTerraLightingMode('NIGHT') === 'NIGHT', parseTerraLightingMode('NIGHT')))
  results.push(check('parse_junk_auto', parseTerraLightingMode('dusk') === 'AUTO', parseTerraLightingMode('dusk')))

  const autoVisual = resolveNightLayerVisual('AUTO')
  const dayVisual = resolveNightLayerVisual('DAY')
  const nightVisual = resolveNightLayerVisual('NIGHT')
  results.push(check(
    'auto_terminator_nightalpha_only',
    autoVisual.enableLighting && autoVisual.dayAlpha === 0 && autoVisual.nightAlpha === 1 && !autoVisual.manual,
    JSON.stringify(autoVisual),
  ))
  results.push(check(
    'day_override_hides_lights',
    !dayVisual.enableLighting && dayVisual.alpha === 0 && dayVisual.manual && !dayVisual.nightLightsVisible,
    JSON.stringify(dayVisual),
  ))
  results.push(check(
    'night_override_shows_lights_and_is_manual',
    nightVisual.enableLighting && nightVisual.dayAlpha === 1 && nightVisual.nightAlpha === 1 && nightVisual.manual,
    JSON.stringify(nightVisual),
  ))
  results.push(check(
    'displayed_manual_night_does_not_claim_auto_day',
    displayedLightingState('NIGHT', akron) === 'NIGHT' && displayedLightingState('AUTO', akron) === 'DAY',
    `${displayedLightingState('NIGHT', akron)} / ${displayedLightingState('AUTO', akron)}`,
  ))
  results.push(check(
    'auto_tokyo_lights_akron_no_lights',
    nightLightsVisibleAtActiveLocation('AUTO', tokyo) === true && nightLightsVisibleAtActiveLocation('AUTO', akron) === false,
    `tokyo=${String(nightLightsVisibleAtActiveLocation('AUTO', tokyo))} akron=${String(nightLightsVisibleAtActiveLocation('AUTO', akron))}`,
  ))

  const later = resolveSolarLighting(FIXTURES.tokyo.latitude, FIXTURES.tokyo.longitude, '2026-09-18T00:00:00.000Z')
  results.push(check(
    'tokyo_day_at_00z_proves_time_not_place_hardcode',
    Boolean(later && later.elevationDegrees > 0 && later.lightingState === 'DAY' && tokyo && tokyo.lightingState !== later.lightingState),
    later ? `${later.lightingState} ${later.elevationDegrees.toFixed(2)} vs 16z ${tokyo?.lightingState}` : 'null',
  ))

  const nightUrl = buildGibsTileUrlTemplate(TERRA_NIGHT_LIGHTS_GIBS_LAYER_ID, TERRA_NIGHT_LIGHTS_COMPOSITE_DATE)
  results.push(check(
    'night_lights_is_tiled_gibs_wmts',
    nightUrl.includes('/VIIRS_Night_Lights/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'),
    nightUrl,
  ))
  results.push(check(
    'city_scale_lighting_fade_in_exceeds_fade_out',
    TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE > TERRA_GLOBE_LIGHTING_FADE_OUT_DISTANCE,
    `out=${TERRA_GLOBE_LIGHTING_FADE_OUT_DISTANCE} in=${TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE}`,
  ))
  results.push(check(
    'city_scale_lighting_fade_in_below_earth_radius',
    TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE > 0 && TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE < 6_371_000,
    String(TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE),
  ))
  results.push(check(
    'daytime_night_alpha_dims_not_black',
    TERRA_DAYTIME_LAYER_NIGHT_ALPHA > 0.1 && TERRA_DAYTIME_LAYER_NIGHT_ALPHA < 0.4,
    String(TERRA_DAYTIME_LAYER_NIGHT_ALPHA),
  ))

  return results
}

export function runTerraSolarLightingValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraSolarLightingValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra solar lighting: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
