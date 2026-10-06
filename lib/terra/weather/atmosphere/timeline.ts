/** Nearest measured frame for Terra Timeline. Does not invent timestamps. */

export const RADAR_HISTORICAL_MAX_SKEW_MS = 20 * 60_000
export const CLOUD_HISTORICAL_MAX_SKEW_MS = 25 * 60_000

export type HistoricalWeatherAvailability = 'ok' | 'UNAVAILABLE_FOR_SELECTED_TIME'

export function nearestMeasuredFrame<T extends { timestampIso: string }>(
  frames: readonly T[],
  terraTime: string,
): { frame: T; skewMs: number } | null {
  const target = Date.parse(terraTime)
  if (!Number.isFinite(target) || frames.length === 0) return null
  let best: { frame: T; skewMs: number } | null = null
  for (const frame of frames) {
    const observed = Date.parse(frame.timestampIso)
    if (!Number.isFinite(observed)) continue
    const skewMs = Math.abs(observed - target)
    if (!best || skewMs < best.skewMs) best = { frame, skewMs }
  }
  return best
}

export function historicalWeatherAvailability(input: {
  timeMode: 'live' | 'historical'
  terraTime: string
  frames: readonly { timestampIso: string }[]
  maxSkewMs: number
}): HistoricalWeatherAvailability {
  if (input.timeMode !== 'historical') return 'ok'
  const nearest = nearestMeasuredFrame(input.frames, input.terraTime)
  if (!nearest) return 'UNAVAILABLE_FOR_SELECTED_TIME'
  return nearest.skewMs <= input.maxSkewMs ? 'ok' : 'UNAVAILABLE_FOR_SELECTED_TIME'
}

export const HISTORICAL_UNAVAILABLE_LABEL = 'UNAVAILABLE FOR SELECTED TIME'
