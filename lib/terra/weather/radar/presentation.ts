/**
 * Radar active-product presentation. Radar is a first-class Terra layer, so whenever it is on the
 * globe Commander must be able to read provider, product, frame time, age, expected update
 * interval, coverage fit, intensity legend and attribution — not just an on/off glow.
 *
 * Two independent questions are modelled separately and must not be collapsed:
 *   1. Can the radar report at all?          -> RadarPresentationStatus
 *   2. Did the radar measure any echo here?  -> RadarEchoState
 * "No precipitation" is a measurement. "No data" is an absence of measurement.
 */

import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { radarCoverageLabel, viewIntersectsRadarCoverage, viewWithinRadarCoverage } from './coverage'
import { RADAR_INTENSITY_BANDS, RADAR_INTENSITY_UNIT, radarLegendSummary } from './legend'
import { radarFrameAgeMs } from './state'
import { RADAR_STALE_AFTER_MS, type RadarCatalog, type RadarCoverageState, type RadarFrame } from './types'

/** The N0Q mosaic is produced on a 5-minute cadence. */
export const RADAR_EXPECTED_UPDATE_SECONDS = 300

/**
 * A national mosaic routinely runs with a few contributing radars in maintenance. Only a
 * materially thinned network is reported as DEGRADED so the state keeps meaning.
 */
export const RADAR_QUORUM_DEGRADED_BELOW = 0.9

export const RADAR_PRESENTATION_STATUSES = [
  'ACTIVE',
  'DEGRADED',
  'OUT_OF_COVERAGE',
  'UNAVAILABLE',
  'STALE',
  'RATE_LIMITED',
  'PARTIAL',
] as const
export type RadarPresentationStatus = (typeof RADAR_PRESENTATION_STATUSES)[number]

export const RADAR_ECHO_STATES = [
  'PRECIP_PRESENT',
  'NO_PRECIP',
  'NO_DATA',
  'OUT_OF_COVERAGE',
  'UNDETERMINED',
] as const
export type RadarEchoState = (typeof RADAR_ECHO_STATES)[number]

export const RADAR_COVERAGE_FITS = ['FULL', 'PARTIAL', 'NONE'] as const
export type RadarCoverageFit = (typeof RADAR_COVERAGE_FITS)[number]

export type RadarQuorum = { contributing: number; total: number } | null

export function parseRadarQuorum(raw: string | null | undefined): RadarQuorum {
  if (typeof raw !== 'string') return null
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw)
  if (!match) return null
  const contributing = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(contributing) || !Number.isFinite(total) || total <= 0) return null
  return { contributing, total }
}

export function radarQuorumRatio(quorum: RadarQuorum): number | null {
  return quorum ? quorum.contributing / quorum.total : null
}

export function radarCoverageFit(view: TerraDegreeRectangle | null): RadarCoverageFit {
  if (!viewIntersectsRadarCoverage(view)) return 'NONE'
  return viewWithinRadarCoverage(view) ? 'FULL' : 'PARTIAL'
}

export type RadarFrameTimeLabels = {
  utc: string
  local: string | null
  localZone: string | null
}

export function radarFrameTimeLabels(iso: string | null, timeZone?: string | null): RadarFrameTimeLabels {
  if (!iso) return { utc: 'NONE', local: null, localZone: null }
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return { utc: 'UNKNOWN', local: null, localZone: null }
  const utc = `${new Date(ms).toISOString().slice(11, 19)}Z`
  try {
    const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    const local = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: zone,
    }).format(new Date(ms))
    return { utc, local, localZone: zone ?? null }
  } catch {
    return { utc, local: null, localZone: null }
  }
}

/**
 * Echo state requires a real measurement. Without a probe result Terra reports UNDETERMINED
 * rather than claiming clear skies.
 */
export function resolveRadarEchoState(input: {
  status: RadarPresentationStatus
  coverageFit: RadarCoverageFit
  /** Fraction of probed mosaic pixels carrying reflectivity, or null when not probed. */
  echoFraction: number | null
}): RadarEchoState {
  if (input.coverageFit === 'NONE' || input.status === 'OUT_OF_COVERAGE') return 'OUT_OF_COVERAGE'
  if (input.status === 'UNAVAILABLE' || input.status === 'RATE_LIMITED') return 'NO_DATA'
  if (input.echoFraction === null) return 'UNDETERMINED'
  return input.echoFraction > 0 ? 'PRECIP_PRESENT' : 'NO_PRECIP'
}

/**
 * Copy stays literal about what was measured. Low-dBZ returns legitimately include ground clutter,
 * biological scatter and anomalous propagation, so a non-zero reading is reported as "returns",
 * with its coverage share, rather than asserted as rainfall.
 */
export function radarEchoCopy(state: RadarEchoState, echoFraction: number | null): string {
  if (state === 'PRECIP_PRESENT') {
    const pct = echoFraction === null ? null : echoFraction * 100
    const share = pct === null ? '' : ` · ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of probed tiles`
    return `RETURNS PRESENT · reflectivity measured in this view${share}`
  }
  if (state === 'NO_PRECIP') return 'NO PRECIP · radar measured these tiles and found no return'
  if (state === 'NO_DATA') return 'NO DATA · radar could not report a frame for this area'
  if (state === 'OUT_OF_COVERAGE') return 'OUT OF COVERAGE · this view is outside the radar mosaic'
  return 'PRECIP UNDETERMINED · echo not measured for this view'
}

export type RadarActiveDetails = {
  status: RadarPresentationStatus
  statusReason: string
  provider: string
  providerId: string
  product: string
  productLabel: string
  truthKind: string
  frameAt: string | null
  frameTime: RadarFrameTimeLabels
  ageMs: number | null
  ageLabel: string
  expectedUpdateSeconds: number
  coverageFit: RadarCoverageFit
  coverageLabel: string
  quorum: RadarQuorum
  quorumLabel: string | null
  echoState: RadarEchoState
  echoLabel: string
  echoFraction: number | null
  legendSummary: string
  legendUnit: string
  legendBands: typeof RADAR_INTENSITY_BANDS
  attribution: string
  error: string | null
}

export function resolveRadarPresentationStatus(input: {
  catalogState: RadarCoverageState
  viewState: RadarCoverageState
  frame: RadarFrame | null
  coverageFit: RadarCoverageFit
  quorum: RadarQuorum
  servedFromLastGood: boolean
  nowIso: string
}): { status: RadarPresentationStatus; reason: string } {
  const { frame, coverageFit } = input
  if (!frame) {
    if (input.catalogState === 'RATE_LIMITED') {
      return { status: 'RATE_LIMITED', reason: 'provider rate limited and no frame is available' }
    }
    return { status: 'UNAVAILABLE', reason: 'provider returned no usable radar frame' }
  }
  if (coverageFit === 'NONE' || input.viewState === 'NO_COVERAGE') {
    return { status: 'OUT_OF_COVERAGE', reason: 'view does not intersect the radar mosaic domain' }
  }

  const ageMs = radarFrameAgeMs(frame, input.nowIso)
  if ((ageMs != null && ageMs > RADAR_STALE_AFTER_MS) || input.viewState === 'STALE' || input.catalogState === 'STALE') {
    return { status: 'STALE', reason: 'latest frame is older than the expected mosaic cadence' }
  }
  if (input.catalogState === 'RATE_LIMITED') {
    return { status: 'RATE_LIMITED', reason: 'provider rate limited; showing the last verified frame' }
  }

  const ratio = radarQuorumRatio(input.quorum)
  if (ratio != null && ratio < RADAR_QUORUM_DEGRADED_BELOW) {
    return {
      status: 'DEGRADED',
      reason: `only ${input.quorum?.contributing}/${input.quorum?.total} contributing radars reported`,
    }
  }
  if (input.catalogState === 'ERROR_UPSTREAM' || input.servedFromLastGood) {
    return { status: 'DEGRADED', reason: 'provider metadata failed; showing the last verified frame' }
  }
  if (coverageFit === 'PARTIAL') {
    return { status: 'PARTIAL', reason: 'view extends beyond the radar mosaic domain' }
  }
  return { status: 'ACTIVE', reason: 'current mosaic frame covers this view' }
}

export function buildRadarActiveDetails(input: {
  catalog: RadarCatalog
  viewState: RadarCoverageState
  frame: RadarFrame | null
  ageLabel: string
  view: TerraDegreeRectangle | null
  nowIso: string
  echoFraction: number | null
  timeZone?: string | null
}): RadarActiveDetails {
  const coverageFit = radarCoverageFit(input.view)
  const quorum = parseRadarQuorum(input.catalog.radarQuorum)
  const { status, reason } = resolveRadarPresentationStatus({
    catalogState: input.catalog.catalogState,
    viewState: input.viewState,
    frame: input.frame,
    coverageFit,
    quorum,
    servedFromLastGood: input.catalog.fromCache && Boolean(input.catalog.error),
    nowIso: input.nowIso,
  })
  const echoState = resolveRadarEchoState({ status, coverageFit, echoFraction: input.echoFraction })
  return {
    status,
    statusReason: reason,
    provider: input.catalog.providerName,
    providerId: input.catalog.provider,
    product: input.catalog.product,
    productLabel: input.catalog.productLabel,
    truthKind: input.catalog.truthKind,
    frameAt: input.frame?.timestampIso ?? null,
    frameTime: radarFrameTimeLabels(input.frame?.timestampIso ?? null, input.timeZone),
    ageMs: radarFrameAgeMs(input.frame, input.nowIso),
    ageLabel: input.ageLabel,
    expectedUpdateSeconds: RADAR_EXPECTED_UPDATE_SECONDS,
    coverageFit,
    coverageLabel: radarCoverageLabel(),
    quorum,
    quorumLabel: quorum ? `${quorum.contributing}/${quorum.total} radars` : null,
    echoState,
    echoLabel: radarEchoCopy(echoState, input.echoFraction),
    echoFraction: input.echoFraction,
    legendSummary: radarLegendSummary(),
    legendUnit: RADAR_INTENSITY_UNIT,
    legendBands: RADAR_INTENSITY_BANDS,
    attribution: input.catalog.attribution,
    error: input.catalog.error,
  }
}
