import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { viewIntersectsRadarCoverage } from './coverage'
import { RADAR_STALE_AFTER_MS, type RadarCatalog, type RadarCoverageState, type RadarFrame } from './types'

export function radarFrameAgeMs(frame: RadarFrame | null, nowIso: string): number | null {
  if (!frame) return null
  const then = Date.parse(frame.timestampIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null
  return Math.max(0, now - then)
}

export function resolveRadarViewState(input: {
  catalog: Pick<RadarCatalog, 'catalogState' | 'latest' | 'frames'>
  view: TerraDegreeRectangle | null
  nowIso: string
  enabled: boolean
}): {
  state: RadarCoverageState
  frame: RadarFrame | null
  showLayer: boolean
  label: string
} {
  const catalogState = input.catalog.catalogState
  if (catalogState === 'RATE_LIMITED' && !input.catalog.latest) {
    return { state: 'RATE_LIMITED', frame: null, showLayer: false, label: 'RATE LIMITED' }
  }
  if (catalogState === 'ERROR_UPSTREAM' && !input.catalog.latest) {
    return { state: 'ERROR_UPSTREAM', frame: null, showLayer: false, label: 'ERROR UPSTREAM' }
  }
  if (catalogState === 'UNAVAILABLE' && !input.catalog.latest) {
    return { state: 'UNAVAILABLE', frame: null, showLayer: false, label: 'UNAVAILABLE' }
  }

  const frame = input.catalog.latest
  if (!frame) {
    return { state: 'UNAVAILABLE', frame: null, showLayer: false, label: 'UNAVAILABLE' }
  }

  if (!viewIntersectsRadarCoverage(input.view)) {
    return { state: 'NO_COVERAGE', frame, showLayer: false, label: 'NO COVERAGE' }
  }

  const age = radarFrameAgeMs(frame, input.nowIso)
  const stale = age != null && age > RADAR_STALE_AFTER_MS
  const state: RadarCoverageState = stale || catalogState === 'STALE' || catalogState === 'ERROR_UPSTREAM' || catalogState === 'RATE_LIMITED'
    ? 'STALE'
    : 'AVAILABLE'
  return {
    state,
    frame,
    showLayer: input.enabled && (state === 'AVAILABLE' || state === 'STALE'),
    label: state === 'STALE' ? 'STALE' : 'AVAILABLE',
  }
}
