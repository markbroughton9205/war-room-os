/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/weather/radar/radarActive.validation.ts
 *
 * Covers the active-radar product surface: the status vocabulary, coverage fit, the intensity
 * legend, and the rule that "no precipitation" and "no data" are never the same answer.
 */
import { pathToFileURL } from 'node:url'
import { radarCoverageLabel, viewWithinRadarCoverage } from './coverage'
import { RADAR_INTENSITY_BANDS, RADAR_INTENSITY_UNIT, radarIntensityBandLabel } from './legend'
import { radarEchoTilesForView, RADAR_ECHO_MAX_TILES, measureTileEchoPixels, lonToTileX, latToTileY } from './echoProbe'
import {
  RADAR_EXPECTED_UPDATE_SECONDS,
  buildRadarActiveDetails,
  parseRadarQuorum,
  radarCoverageFit,
  radarEchoCopy,
  radarFrameTimeLabels,
  resolveRadarEchoState,
  resolveRadarPresentationStatus,
} from './presentation'
import { RADAR_ATTRIBUTION, RADAR_PRODUCT, RADAR_PRODUCT_LABEL, RADAR_PROVIDER_ID, RADAR_PROVIDER_NAME, RADAR_TRUTH_KIND, IEM_DISCLAIMER, IEM_OGC_DOCS, IEM_USCOMP_COVERAGE, type RadarCatalog, type RadarFrame } from './types'
import { radarFrameFromIso } from './frames'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-18T18:24:00.000Z'
const FRESH = radarFrameFromIso('2026-09-18T18:20:00Z', 'n0q_meta') as RadarFrame
const OLD = radarFrameFromIso('2026-09-18T17:30:00Z', 'n0q_meta') as RadarFrame

function catalog(overrides: Partial<RadarCatalog> = {}): RadarCatalog {
  return {
    provider: RADAR_PROVIDER_ID,
    providerName: RADAR_PROVIDER_NAME,
    product: RADAR_PRODUCT,
    productLabel: RADAR_PRODUCT_LABEL,
    truthKind: RADAR_TRUTH_KIND,
    attribution: RADAR_ATTRIBUTION,
    docsUrl: IEM_OGC_DOCS,
    disclaimerUrl: IEM_DISCLAIMER,
    coverage: IEM_USCOMP_COVERAGE,
    frames: [FRESH],
    latest: FRESH,
    retrievedAt: NOW,
    generatedAt: null,
    fromCache: false,
    catalogState: 'AVAILABLE',
    error: null,
    radarQuorum: '145/147',
    ...overrides,
  }
}

const INSIDE = { west: -85, south: 39, east: -83, north: 41 }
const STRADDLING = { west: -130, south: 20, east: -100, north: 55 }
const OUTSIDE = { west: 10, south: 45, east: 20, north: 55 }

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // ---- coverage fit -------------------------------------------------------
  results.push(check('view_inside_mosaic_is_full', radarCoverageFit(INSIDE) === 'FULL', radarCoverageFit(INSIDE)))
  results.push(check('view_straddling_edge_is_partial', radarCoverageFit(STRADDLING) === 'PARTIAL', radarCoverageFit(STRADDLING)))
  results.push(check('view_outside_mosaic_is_none', radarCoverageFit(OUTSIDE) === 'NONE', radarCoverageFit(OUTSIDE)))
  results.push(check('straddling_view_is_not_reported_as_contained', !viewWithinRadarCoverage(STRADDLING), 'contained'))
  results.push(check('coverage_label_is_not_worldwide', !/worldwide/i.test(radarCoverageLabel()) && /CONUS/.test(radarCoverageLabel()), radarCoverageLabel()))

  // ---- status vocabulary --------------------------------------------------
  const status = (input: Parameters<typeof resolveRadarPresentationStatus>[0]) => resolveRadarPresentationStatus(input).status
  const base = { catalogState: 'AVAILABLE' as const, viewState: 'AVAILABLE' as const, quorum: { contributing: 147, total: 147 }, servedFromLastGood: false, nowIso: NOW }
  results.push(check('fresh_contained_frame_is_active', status({ ...base, frame: FRESH, coverageFit: 'FULL' }) === 'ACTIVE', status({ ...base, frame: FRESH, coverageFit: 'FULL' })))
  results.push(check('partial_coverage_is_partial', status({ ...base, frame: FRESH, coverageFit: 'PARTIAL' }) === 'PARTIAL', status({ ...base, frame: FRESH, coverageFit: 'PARTIAL' })))
  results.push(check('no_intersection_is_out_of_coverage', status({ ...base, frame: FRESH, coverageFit: 'NONE' }) === 'OUT_OF_COVERAGE', status({ ...base, frame: FRESH, coverageFit: 'NONE' })))
  results.push(check('old_frame_is_stale', status({ ...base, frame: OLD, coverageFit: 'FULL' }) === 'STALE', status({ ...base, frame: OLD, coverageFit: 'FULL' })))
  results.push(check('no_frame_is_unavailable', status({ ...base, frame: null, coverageFit: 'FULL' }) === 'UNAVAILABLE', status({ ...base, frame: null, coverageFit: 'FULL' })))
  results.push(check('rate_limited_without_frame_is_rate_limited', status({ ...base, catalogState: 'RATE_LIMITED', frame: null, coverageFit: 'FULL' }) === 'RATE_LIMITED', status({ ...base, catalogState: 'RATE_LIMITED', frame: null, coverageFit: 'FULL' })))
  results.push(check('thin_quorum_is_degraded', status({ ...base, frame: FRESH, coverageFit: 'FULL', quorum: { contributing: 100, total: 147 } }) === 'DEGRADED', status({ ...base, frame: FRESH, coverageFit: 'FULL', quorum: { contributing: 100, total: 147 } })))
  results.push(check('routine_maintenance_quorum_stays_active', status({ ...base, frame: FRESH, coverageFit: 'FULL', quorum: { contributing: 144, total: 147 } }) === 'ACTIVE', status({ ...base, frame: FRESH, coverageFit: 'FULL', quorum: { contributing: 144, total: 147 } })))
  results.push(check('last_good_after_upstream_error_is_degraded', status({ ...base, frame: FRESH, coverageFit: 'FULL', servedFromLastGood: true }) === 'DEGRADED', status({ ...base, frame: FRESH, coverageFit: 'FULL', servedFromLastGood: true })))

  // ---- quorum parsing -----------------------------------------------------
  results.push(check('quorum_parses_provider_string', parseRadarQuorum('144/147')?.contributing === 144, JSON.stringify(parseRadarQuorum('144/147'))))
  results.push(check('quorum_rejects_garbage', parseRadarQuorum('n/a') === null && parseRadarQuorum(null) === null, 'parsed'))

  // ---- PHASE 11: no precip is not no data --------------------------------
  const echo = (echoFraction: number | null, s: Parameters<typeof resolveRadarEchoState>[0]['status'] = 'ACTIVE', fit: Parameters<typeof resolveRadarEchoState>[0]['coverageFit'] = 'FULL') =>
    resolveRadarEchoState({ status: s, coverageFit: fit, echoFraction })
  results.push(check('measured_zero_echo_is_no_precip', echo(0) === 'NO_PRECIP', echo(0)))
  results.push(check('measured_echo_is_precip_present', echo(0.12) === 'PRECIP_PRESENT', echo(0.12)))
  results.push(check('unmeasured_is_undetermined_not_no_precip', echo(null) === 'UNDETERMINED', echo(null)))
  results.push(check('unavailable_radar_is_no_data', echo(null, 'UNAVAILABLE') === 'NO_DATA', echo(null, 'UNAVAILABLE')))
  results.push(check('rate_limited_radar_is_no_data', echo(null, 'RATE_LIMITED') === 'NO_DATA', echo(null, 'RATE_LIMITED')))
  results.push(check('outside_mosaic_is_out_of_coverage_not_no_data', echo(0, 'ACTIVE', 'NONE') === 'OUT_OF_COVERAGE', echo(0, 'ACTIVE', 'NONE')))
  results.push(check('no_precip_and_no_data_are_distinct_states', echo(0) !== echo(null, 'UNAVAILABLE'), `${echo(0)} vs ${echo(null, 'UNAVAILABLE')}`))
  results.push(check('no_data_and_no_coverage_are_distinct_states', echo(null, 'UNAVAILABLE') !== echo(0, 'ACTIVE', 'NONE'), 'collapsed'))
  results.push(check('no_precip_copy_says_measured', /measured/i.test(radarEchoCopy('NO_PRECIP', 0)) && !/no data/i.test(radarEchoCopy('NO_PRECIP', 0)), radarEchoCopy('NO_PRECIP', 0)))
  results.push(check('no_data_copy_does_not_claim_clear', !/no precip/i.test(radarEchoCopy('NO_DATA', null)), radarEchoCopy('NO_DATA', null)))
  results.push(check('light_returns_are_reported_with_share_not_as_rainfall', /0\.6% of probed tiles/.test(radarEchoCopy('PRECIP_PRESENT', 0.006)), radarEchoCopy('PRECIP_PRESENT', 0.006)))

  // ---- legend -------------------------------------------------------------
  results.push(check('legend_declares_dbz_units', RADAR_INTENSITY_UNIT === 'dBZ', RADAR_INTENSITY_UNIT))
  results.push(check('legend_has_ordered_bands', RADAR_INTENSITY_BANDS.length >= 5 && RADAR_INTENSITY_BANDS.every((b, i) => i === 0 || b.minDbz >= (RADAR_INTENSITY_BANDS[i - 1]?.minDbz ?? 0)), String(RADAR_INTENSITY_BANDS.length)))
  results.push(check('legend_top_band_is_open_ended', RADAR_INTENSITY_BANDS[RADAR_INTENSITY_BANDS.length - 1]?.maxDbz === null, 'closed'))
  results.push(check('legend_band_labels_carry_units', radarIntensityBandLabel(RADAR_INTENSITY_BANDS[0]!).includes('dBZ'), radarIntensityBandLabel(RADAR_INTENSITY_BANDS[0]!)))

  // ---- frame time ---------------------------------------------------------
  const labels = radarFrameTimeLabels('2026-09-18T18:20:00.000Z', 'America/New_York')
  results.push(check('frame_time_exposes_utc', labels.utc === '18:20:00Z', labels.utc))
  results.push(check('frame_time_exposes_local', labels.local === '14:20:00', String(labels.local)))
  results.push(check('missing_frame_time_is_none_not_now', radarFrameTimeLabels(null).utc === 'NONE', radarFrameTimeLabels(null).utc))

  // ---- probe budget -------------------------------------------------------
  results.push(check('probe_is_bounded_for_local_view', radarEchoTilesForView(INSIDE).length <= RADAR_ECHO_MAX_TILES, String(radarEchoTilesForView(INSIDE).length)))
  results.push(check('probe_is_bounded_for_global_view', radarEchoTilesForView({ west: -180, south: -85, east: 180, north: 85 }).length <= RADAR_ECHO_MAX_TILES, String(radarEchoTilesForView({ west: -180, south: -85, east: 180, north: 85 }).length)))
  results.push(check('tile_y_grows_southward', latToTileY(60, 5) < latToTileY(20, 5), `${latToTileY(60, 5)} vs ${latToTileY(20, 5)}`))
  results.push(check('tile_x_grows_eastward', lonToTileX(-120, 5) < lonToTileX(-70, 5), `${lonToTileX(-120, 5)} vs ${lonToTileX(-70, 5)}`))
  results.push(check('non_png_bytes_do_not_yield_a_reading', measureTileEchoPixels(Buffer.from('not a png at all')) === null, 'decoded'))

  // ---- assembled details --------------------------------------------------
  const active = buildRadarActiveDetails({ catalog: catalog(), viewState: 'AVAILABLE', frame: FRESH, ageLabel: '4 minutes ago', view: INSIDE, nowIso: NOW, echoFraction: 0.08, timeZone: 'UTC' })
  results.push(check('details_expose_expected_update_interval', active.expectedUpdateSeconds === RADAR_EXPECTED_UPDATE_SECONDS, String(active.expectedUpdateSeconds)))
  results.push(check('details_expose_provider_and_product', active.provider === RADAR_PROVIDER_NAME && active.product === RADAR_PRODUCT, `${active.provider}/${active.product}`))
  results.push(check('details_expose_frame_time_age_coverage_legend_attribution', Boolean(active.frameAt) && active.ageLabel === '4 minutes ago' && active.coverageFit === 'FULL' && active.legendBands.length > 0 && active.attribution.length > 0, 'missing detail'))
  results.push(check('details_expose_quorum', active.quorumLabel === '145/147 radars', String(active.quorumLabel)))
  results.push(check('details_are_more_than_an_on_switch', active.status === 'ACTIVE' && active.statusReason.length > 0 && active.echoState === 'PRECIP_PRESENT', `${active.status}/${active.echoState}`))

  const noData = buildRadarActiveDetails({ catalog: catalog({ frames: [], latest: null, catalogState: 'UNAVAILABLE', radarQuorum: null }), viewState: 'UNAVAILABLE', frame: null, ageLabel: 'UNKNOWN', view: INSIDE, nowIso: NOW, echoFraction: null })
  results.push(check('no_frame_details_report_no_data', noData.status === 'UNAVAILABLE' && noData.echoState === 'NO_DATA', `${noData.status}/${noData.echoState}`))

  const offMosaic = buildRadarActiveDetails({ catalog: catalog(), viewState: 'NO_COVERAGE', frame: FRESH, ageLabel: '4 minutes ago', view: OUTSIDE, nowIso: NOW, echoFraction: null })
  results.push(check('off_mosaic_details_report_out_of_coverage', offMosaic.status === 'OUT_OF_COVERAGE' && offMosaic.echoState === 'OUT_OF_COVERAGE', `${offMosaic.status}/${offMosaic.echoState}`))

  const clear = buildRadarActiveDetails({ catalog: catalog(), viewState: 'AVAILABLE', frame: FRESH, ageLabel: '4 minutes ago', view: INSIDE, nowIso: NOW, echoFraction: 0 })
  results.push(check('clear_measured_view_reports_no_precip_while_active', clear.status === 'ACTIVE' && clear.echoState === 'NO_PRECIP', `${clear.status}/${clear.echoState}`))

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra active radar product: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
