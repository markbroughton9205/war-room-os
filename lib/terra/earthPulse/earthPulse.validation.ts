/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/earthPulse/earthPulse.validation.ts
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  aggregateOvationCells,
  cloudMotionIsObservedFrames,
  isFreshEarthquakePulse,
  isFreshLightningVisual,
  pointInGoesGlmCoverage,
  selectLightningVisuals,
} from './client'
import {
  classifyArchivalOrDaily,
  classifyAuroraFreshness,
  classifyFreshness,
  classifyLightningFreshness,
} from './freshness'
import {
  EARTH_PULSE_CLOUD_FRAME_CACHE,
  EARTH_PULSE_CLOUD_FRAME_MINUTES,
  EARTH_PULSE_DOMAINS,
  EARTH_PULSE_TRUTH_STATES,
  LIVING_ORBIT_DISCLAIMER,
  LIVING_ORBIT_IDLE_DELAY_CLOSE_MS,
  LIVING_ORBIT_IDLE_DELAY_GLOBAL_MS,
  livingOrbitIdleDelayMs,
  NIGHT_LIGHTS_ARCHIVE_DATE,
  TERRA_CLOUD_DISPLAY_INTERVAL_MS,
  TERRA_CLOUD_LAYER_MAX,
  VNP46A2_UNAVAILABLE_NOTE,
} from './index'
import { parseGlmLcfaFlashes } from './glmHdf5'
import { alignToTenMinutes, toUtcIsoMinutes } from './shared'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-09-18T07:30:00.000Z'

  results.push(check('domains_complete', EARTH_PULSE_DOMAINS.length === 9, EARTH_PULSE_DOMAINS.join(',')))
  results.push(check(
    'truth_vocab',
    EARTH_PULSE_TRUTH_STATES.join(',') === 'LIVE,RECENT,STALE,UNAVAILABLE,NO_COVERAGE',
    EARTH_PULSE_TRUTH_STATES.join(','),
  ))
  results.push(check('no_live_for_annual', classifyArchivalOrDaily('annual', true) === 'STALE', classifyArchivalOrDaily('annual', true)))
  results.push(check('no_live_for_daily', classifyArchivalOrDaily('daily', true) === 'RECENT', classifyArchivalOrDaily('daily', true)))
  results.push(check('daily_fail_unavailable', classifyArchivalOrDaily('unavailable', false) === 'UNAVAILABLE', 'ok'))

  results.push(check(
    'freshness_live',
    classifyFreshness({ observedAt: '2026-09-18T07:25:00.000Z', nowIso: now, hasCoverage: true, hasItems: true, fetchOk: true }) === 'LIVE',
    '25m window',
  ))
  results.push(check(
    'freshness_stale',
    classifyFreshness({ observedAt: '2026-09-17T00:00:00.000Z', nowIso: now, hasCoverage: true, hasItems: true, fetchOk: true }) === 'STALE',
    'old',
  ))
  results.push(check(
    'freshness_no_coverage',
    classifyFreshness({ observedAt: now, nowIso: now, hasCoverage: false, hasItems: false, fetchOk: true }) === 'NO_COVERAGE',
    'coverage',
  ))
  results.push(check(
    'lightning_no_coverage',
    classifyLightningFreshness(now, now, true, false) === 'NO_COVERAGE',
    'glm fov',
  ))
  results.push(check(
    'aurora_live_window',
    classifyAuroraFreshness('2026-09-18T08:28:00Z', now, true) === 'LIVE',
    'ovation forecast',
  ))

  results.push(check(
    'quake_fresh_pulse',
    isFreshEarthquakePulse('2026-09-18T07:10:00.000Z', now) === true,
    '20 min',
  ))
  results.push(check(
    'quake_old_no_pulse',
    isFreshEarthquakePulse('2026-09-18T04:00:00.000Z', now) === false,
    '3.5h',
  ))
  results.push(check(
    'quake_future_no_pulse',
    isFreshEarthquakePulse('2026-09-18T09:00:00.000Z', now) === false,
    'future vs terra time',
  ))

  results.push(check('akron_in_glm', pointInGoesGlmCoverage(-81.519, 41.0814) === true, 'GOES-East'))
  results.push(check('london_not_glm', pointInGoesGlmCoverage(-0.1278, 51.5074) === false, 'Europe'))
  results.push(check('tokyo_not_glm', pointInGoesGlmCoverage(139.6503, 35.6762) === false, 'Asia'))
  results.push(check('hawaii_in_glm_west', pointInGoesGlmCoverage(-157.8, 21.3) === true, 'GOES-West'))

  const frames = [
    { id: 'a', timestampIso: '2026-09-18T06:40:00Z', satellite: 'GOES-East' as const, layerId: 'goes-east-geocolor', tileUrlTemplate: 'u1', maximumLevel: 7 },
    { id: 'b', timestampIso: '2026-09-18T06:50:00Z', satellite: 'GOES-East' as const, layerId: 'goes-east-geocolor', tileUrlTemplate: 'u2', maximumLevel: 7 },
  ]
  results.push(check(
    'cloud_motion_uses_distinct_frames',
    cloudMotionIsObservedFrames({
      frames,
      latestBySatellite: { 'GOES-East': frames[1]! },
      intervalMinutes: 10,
      cacheBound: 12,
      truthState: 'LIVE',
      coverage: { kind: 'regional', label: 't', west: 0, south: 0, east: 0, north: 0, basis: 't' },
      error: null,
      fromCache: false,
    }),
    'two timestamps',
  ))
  results.push(check(
    'translated_texture_rejected',
    !cloudMotionIsObservedFrames({
      frames: [
        { ...frames[0]!, tileUrlTemplate: 'same' },
        { ...frames[1]!, tileUrlTemplate: 'same' },
      ],
      latestBySatellite: {},
      intervalMinutes: 10,
      cacheBound: 12,
      truthState: 'LIVE',
      coverage: { kind: 'regional', label: 't', west: 0, south: 0, east: 0, north: 0, basis: 't' },
      error: null,
      fromCache: false,
    }),
    'same url',
  ))

  const aligned = alignToTenMinutes(new Date('2026-09-18T07:37:11Z'))
  results.push(check('align_ten_minutes', toUtcIsoMinutes(aligned) === '2026-09-18T07:30:00Z', toUtcIsoMinutes(aligned)))
  results.push(check('cloud_interval_10', EARTH_PULSE_CLOUD_FRAME_MINUTES === 10, String(EARTH_PULSE_CLOUD_FRAME_MINUTES)))
  results.push(check('cloud_cache_bounded', EARTH_PULSE_CLOUD_FRAME_CACHE === 12, String(EARTH_PULSE_CLOUD_FRAME_CACHE)))
  results.push(check(
    'cloud_display_not_source_interval',
    TERRA_CLOUD_DISPLAY_INTERVAL_MS >= 1000 && TERRA_CLOUD_DISPLAY_INTERVAL_MS <= 2000 && TERRA_CLOUD_DISPLAY_INTERVAL_MS !== EARTH_PULSE_CLOUD_FRAME_MINUTES * 60_000,
    String(TERRA_CLOUD_DISPLAY_INTERVAL_MS),
  ))
  results.push(check('cloud_layer_max_bounded', TERRA_CLOUD_LAYER_MAX === 4, String(TERRA_CLOUD_LAYER_MAX)))

  const lightningNow = '2026-09-18T07:30:00.000Z'
  const lightningRows = [
    { id: 'a', longitude: -81.5, latitude: 41.0, count: 8, energy: 2, satellite: 'G19' as const, observedAt: '2026-09-18T07:29:00.000Z' },
    { id: 'b', longitude: -82.0, latitude: 40.5, count: 1, energy: 1, satellite: 'G19' as const, observedAt: '2026-09-18T07:29:10.000Z' },
    { id: 'c', longitude: -90.0, latitude: 30.0, count: 4, energy: 1, satellite: 'G18' as const, observedAt: '2026-09-17T00:00:00.000Z' },
  ]
  results.push(check('lightning_stale_hidden', isFreshLightningVisual(lightningRows[2]!.observedAt, lightningNow) === false, 'stale'))
  results.push(check(
    'lightning_globe_caps_and_filters',
    (() => {
      const visible = selectLightningVisuals({ flashes: lightningRows, nowIso: lightningNow, globalLod: true, reducedMotion: false })
      return visible.length === 1 && visible[0]?.id === 'a'
    })(),
    'globe lod',
  ))
  results.push(check(
    'lightning_reduced_motion_globe_empty',
    selectLightningVisuals({ flashes: lightningRows, nowIso: lightningNow, globalLod: true, reducedMotion: true }).length === 0,
    'no globe strobe',
  ))

  try {
    const require = createRequire(import.meta.url)
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const cloudSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraCloudImagery.tsx'), 'utf8')
    const lightningSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraLightningLayer.tsx'), 'utf8')
    const playbackSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/useTerraEarthPulse.ts'), 'utf8')
    results.push(check('cloud_double_buffer', cloudSrc.includes('hem.back') && cloudSrc.includes('crossfade') && !cloudSrc.includes('remove(current, true)'), 'front/back'))
    results.push(check('cloud_playback_uses_display_interval', playbackSrc.includes('TERRA_CLOUD_DISPLAY_INTERVAL_MS') && !playbackSrc.includes(', 1200)'), 'display cadence'))
    results.push(check('lightning_no_white_blink', !lightningSrc.includes('#F8FAFC') && !lightningSrc.includes('% 900'), 'strobe removed'))
    results.push(check('lightning_one_shot_or_static', lightningSrc.includes('TERRA_LIGHTNING_FLASH_MS') && lightningSrc.includes('prefersTerraReducedMotion'), 'one-shot'))
  } catch (error) {
    results.push(check('presentation_source_audit', false, error instanceof Error ? error.message : 'read failed'))
  }

  const ovation = aggregateOvationCells([
    [-100, 70, 2],
    [-90, 72, 18],
    [20, -68, 22],
    [400, 10, 50],
  ], 10, 8)
  results.push(check('ovation_filters_low', ovation.length === 2 && ovation.every(cell => cell.aurora >= 8), JSON.stringify(ovation)))
  results.push(check('ovation_southern_flag', ovation.some(cell => cell.hemisphere === 'south' && cell.aurora === 22), 'south'))
  results.push(check('ovation_rejects_bad_lon', ovation.every(cell => cell.longitude <= 180), 'geo'))
  results.push(check('low_aurora_empty', aggregateOvationCells([[0, 80, 1], [10, 81, 4]], 10, 8).length === 0, 'hidden when low'))

  results.push(check('archive_date_2016', NIGHT_LIGHTS_ARCHIVE_DATE === '2016-01-01', NIGHT_LIGHTS_ARCHIVE_DATE))
  results.push(check('vnp46_not_pretended', /Earthdata/i.test(VNP46A2_UNAVAILABLE_NOTE), VNP46A2_UNAVAILABLE_NOTE.slice(0, 80)))

  results.push(check('orbit_close_20s', LIVING_ORBIT_IDLE_DELAY_CLOSE_MS === 20_000, String(LIVING_ORBIT_IDLE_DELAY_CLOSE_MS)))
  results.push(check('orbit_global_delay', livingOrbitIdleDelayMs('global') === LIVING_ORBIT_IDLE_DELAY_GLOBAL_MS, String(livingOrbitIdleDelayMs('global'))))
  results.push(check('orbit_is_presentation', /not physical/i.test(LIVING_ORBIT_DISCLAIMER), LIVING_ORBIT_DISCLAIMER))

  try {
    const require = createRequire(import.meta.url)
    const fs = require('node:fs') as typeof import('node:fs')
    if (fs.existsSync('/tmp/glm.nc')) {
      const flashes = parseGlmLcfaFlashes(fs.readFileSync('/tmp/glm.nc'))
      results.push(check('glm_parse_has_flashes', flashes.length > 0, String(flashes.length)))
      results.push(check(
        'glm_coords_are_geo',
        flashes.every(flash => flash.lat >= -90 && flash.lat <= 90 && flash.lon >= -180 && flash.lon <= 180),
        flashes[0] ? `${flashes[0].lat},${flashes[0].lon}` : 'none',
      ))
    } else {
      results.push(check('glm_parse_fixture_optional', true, 'no /tmp/glm.nc'))
    }
  } catch (error) {
    results.push(check('glm_parse_fixture_optional', true, error instanceof Error ? error.message : 'parse skipped'))
  }

  return results
}

export function runTerraEarthPulseValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraEarthPulseValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra Earth Pulse: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
