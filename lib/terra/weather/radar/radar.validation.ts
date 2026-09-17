/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/weather/radar/radar.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { radarFrameAgeLabel } from './age'
import { IEM_USCOMP_COVERAGE, RADAR_ATTRIBUTION, RADAR_STALE_AFTER_MS, RADAR_TRUTH_KIND } from './types'
import { iemStampFromIso, mergeRadarFrames, ridgeTileUrlTemplate } from './frames'
import { pointInRadarCoverage, viewIntersectsRadarCoverage } from './coverage'
import { resolveRadarViewState } from './state'
import type { RadarCatalog } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function catalog(partial: Partial<RadarCatalog> & Pick<RadarCatalog, 'catalogState' | 'frames' | 'latest'>): Pick<RadarCatalog, 'catalogState' | 'latest' | 'frames'> {
  return partial
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const iso = '2026-09-17T05:55:00.000Z'
  results.push(check('iem_stamp_from_iso', iemStampFromIso(iso) === '202609170555', String(iemStampFromIso(iso))))
  results.push(check(
    'tile_url_is_documented_ridge_tms',
    ridgeTileUrlTemplate('202609170555') === 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-202609170555/{z}/{x}/{y}.png',
    ridgeTileUrlTemplate('202609170555'),
  ))
  results.push(check('truth_kind_is_measured', RADAR_TRUTH_KIND === 'MEASURED', RADAR_TRUTH_KIND))
  results.push(check('attribution_names_iem_and_noaa', /Iowa Environmental Mesonet/i.test(RADAR_ATTRIBUTION) && /NOAA\/NWS/.test(RADAR_ATTRIBUTION), RADAR_ATTRIBUTION.slice(0, 80)))

  const merged = mergeRadarFrames({
    metaValid: '2026-09-17T05:55:00Z',
    scans: ['2026-09-17T05:50Z', '2026-09-17T05:55Z', '2026-09-17T05:45Z'],
  })
  results.push(check('history_uses_only_provider_timestamps', merged.length === 3 && merged.map(item => item.iemStamp).join(',') === '202609170545,202609170550,202609170555', merged.map(item => item.iemStamp).join(',')))
  results.push(check('does_not_invent_missing_five_minute_slot', !merged.some(item => item.iemStamp === '202609170540'), 'invented'))

  results.push(check('grant_in_is_covered', pointInRadarCoverage(40.53, -85.65), 'false'))
  results.push(check('paris_is_no_coverage', !pointInRadarCoverage(48.86, 2.35), 'covered'))
  results.push(check('conus_view_intersects', viewIntersectsRadarCoverage({ west: -90, south: 35, east: -80, north: 42 }), 'false'))
  results.push(check('europe_view_does_not_intersect', !viewIntersectsRadarCoverage({ west: -5, south: 40, east: 10, north: 52 }), 'intersects'))
  results.push(check('null_planet_view_keeps_mosaic_eligible', viewIntersectsRadarCoverage(null), 'false'))
  results.push(check('coverage_bbox_is_conus', IEM_USCOMP_COVERAGE.west === -126 && IEM_USCOMP_COVERAGE.east === -65, JSON.stringify(IEM_USCOMP_COVERAGE)))

  const latest = merged[merged.length - 1]!
  const available = resolveRadarViewState({
    catalog: catalog({ catalogState: 'AVAILABLE', frames: merged, latest }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: true,
  })
  results.push(check('fresh_conus_is_available_not_live', available.state === 'AVAILABLE' && available.showLayer && available.label !== 'LIVE', available.state))

  const stale = resolveRadarViewState({
    catalog: catalog({ catalogState: 'AVAILABLE', frames: merged, latest }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: new Date(Date.parse(iso) + RADAR_STALE_AFTER_MS + 60_000).toISOString(),
    enabled: true,
  })
  results.push(check('old_frame_is_stale_not_live', stale.state === 'STALE' && stale.showLayer && stale.label !== 'LIVE', stale.state))

  const none = resolveRadarViewState({
    catalog: catalog({ catalogState: 'AVAILABLE', frames: merged, latest }),
    view: { west: 2, south: 48, east: 3, north: 49 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: true,
  })
  results.push(check('outside_mosaic_is_no_coverage', none.state === 'NO_COVERAGE' && !none.showLayer, none.state))

  const error = resolveRadarViewState({
    catalog: catalog({ catalogState: 'ERROR_UPSTREAM', frames: [], latest: null }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: true,
  })
  results.push(check('upstream_error_without_frame', error.state === 'ERROR_UPSTREAM' && !error.showLayer, error.state))

  const staleHold = resolveRadarViewState({
    catalog: catalog({ catalogState: 'ERROR_UPSTREAM', frames: merged, latest }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: true,
  })
  results.push(check('error_with_prior_frame_is_stale', staleHold.state === 'STALE' && staleHold.showLayer, staleHold.state))

  const limited = resolveRadarViewState({
    catalog: catalog({ catalogState: 'RATE_LIMITED', frames: [], latest: null }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: true,
  })
  results.push(check('rate_limited_without_frame', limited.state === 'RATE_LIMITED' && !limited.showLayer, limited.state))

  results.push(check('disabled_hides_layer', !resolveRadarViewState({
    catalog: catalog({ catalogState: 'AVAILABLE', frames: merged, latest }),
    view: { west: -90, south: 35, east: -80, north: 42 },
    nowIso: '2026-09-17T05:58:00.000Z',
    enabled: false,
  }).showLayer, 'shown'))
  results.push(check('future_frame_age_is_not_one_day_ago', radarFrameAgeLabel(iso, '2026-09-17T05:54:00.000Z') === 'just now', radarFrameAgeLabel(iso, '2026-09-17T05:54:00.000Z')))
  results.push(check('fresh_frame_age_minutes', radarFrameAgeLabel(iso, '2026-09-17T05:58:00.000Z') === '3 minutes ago', radarFrameAgeLabel(iso, '2026-09-17T05:58:00.000Z')))

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra weather phase 2 radar validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
