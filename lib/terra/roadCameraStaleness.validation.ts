/**
 * Deterministic regression suite for the camera freshness truth doctrine. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/roadCameraStaleness.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { resolveTerraCameraFreshness } from './roadCameraStaleness'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-08-28T12:00:00.000Z'

  results.push(check('fresh_still_image_is_still_image_not_live_video', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: '2026-08-28T11:58:00.000Z', nowIso: now, sourceReportsUnavailable: false,
  }) === 'still_image', 'still, 2m old, 10m interval'))

  results.push(check('still_image_never_reported_as_live_video_even_when_extremely_fresh', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: now, nowIso: now, sourceReportsUnavailable: false,
  }) === 'still_image', 'still, 0s old'))

  results.push(check('real_video_feed_within_2x_interval_is_live_video', resolveTerraCameraFreshness({
    feedType: 'video', refreshIntervalSec: 5, capturedAtIso: '2026-08-28T11:59:56.000Z', nowIso: now, sourceReportsUnavailable: false,
  }) === 'live_video', 'video, 4s old, 5s interval'))

  results.push(check('past_2x_interval_but_within_window_is_stale', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: '2026-08-28T11:00:00.000Z', nowIso: now, sourceReportsUnavailable: false,
  }) === 'stale', 'still, 1h old, 10m interval (2x=20m)'))

  results.push(check('far_past_window_is_offline', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: '2026-08-27T00:00:00.000Z', nowIso: now, sourceReportsUnavailable: false,
  }) === 'offline', 'still, 36h old'))

  results.push(check('source_reported_unavailable_is_offline_even_if_timestamp_looks_fresh', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: now, nowIso: now, sourceReportsUnavailable: true,
  }) === 'offline', 'sourceReportsUnavailable=true overrides fresh timestamp'))

  results.push(check('missing_captured_at_is_unknown_not_assumed_live', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: null, nowIso: now, sourceReportsUnavailable: false,
  }) === 'unknown', 'null capturedAt'))

  results.push(check('missing_refresh_interval_is_unknown_not_assumed_live', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: null, capturedAtIso: now, nowIso: now, sourceReportsUnavailable: false,
  }) === 'unknown', 'null refreshIntervalSec'))

  results.push(check('malformed_timestamp_is_honestly_unknown', resolveTerraCameraFreshness({
    feedType: 'still', refreshIntervalSec: 600, capturedAtIso: 'not-a-date', nowIso: now, sourceReportsUnavailable: false,
  }) === 'unknown', 'malformed capturedAt'))

  return results
}

export function runRoadCameraStalenessValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runRoadCameraStalenessValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra roadCameraStaleness validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
