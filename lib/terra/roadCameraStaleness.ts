/**
 * God's Eye Traffic & Camera Intelligence phase — the mandatory camera/feed truth doctrine:
 * "Never call a still image live video. Never call stale media live." This module is the one
 * place that classification happens, so every camera-bearing layer/panel reads the same real,
 * source-timestamp-derived state instead of each consumer inventing its own freshness math.
 *
 * Mission's staleness principle, applied literally:
 *   - live:    within ~2x the source's own declared refresh/collection interval
 *   - stale:   beyond that, but still within a reasonable historical freshness window
 *   - offline: far beyond that window, or the source itself reports the feed unavailable
 *   - unknown: no usable capture timestamp or refresh interval was supplied at all — an honest
 *     "we cannot classify this," never silently defaulted to "live"
 *
 * `live` is deliberately split into `live_video` and `still_image` at the type level — a still
 * camera (digitraffic_road_cameras' only feedType this phase) can never be reported as
 * `live_video` no matter how fresh its capture time is; `resolveTerraCameraFreshness` enforces
 * this by construction, not by caller discipline.
 */

export type TerraCameraFeedType = 'still' | 'video'

export type TerraCameraFreshnessState = 'live_video' | 'still_image' | 'stale' | 'offline' | 'unknown'

export const TERRA_CAMERA_FRESHNESS_LABELS: Record<TerraCameraFreshnessState, string> = {
  live_video: 'LIVE VIDEO',
  still_image: 'STILL IMAGE — CURRENT',
  stale: 'STALE',
  offline: 'OFFLINE',
  unknown: 'UNKNOWN',
}

/** Beyond 2x the declared refresh interval but within this window, a still image is "stale," not
 * "offline" — a plausible gap (a slow upstream refresh cycle, a brief network hiccup), not
 * evidence the camera itself is down. Matches the mission's own "reasonable historical freshness
 * window" language; not tied to any single source's specific SLA. */
const STALE_WINDOW_MS = 6 * 60 * 60 * 1000

export function resolveTerraCameraFreshness(params: {
  feedType: TerraCameraFeedType
  /** The source's own collection/refresh cadence in seconds — null when not reported (never
   * assumed/defaulted to a guessed value). */
  refreshIntervalSec: number | null
  /** The most recent real capture/measurement timestamp the source reported — null when not
   * reported. */
  capturedAtIso: string | null
  nowIso: string
  /** True when the source's own status field explicitly reports the feed as not currently
   * collecting (e.g. digitraffic_road_cameras' collectionStatus !== 'GATHERING') — trusted over a
   * recent-looking timestamp, since the provider is the authority on its own operating state. */
  sourceReportsUnavailable: boolean
}): TerraCameraFreshnessState {
  const { feedType, refreshIntervalSec, capturedAtIso, nowIso, sourceReportsUnavailable } = params
  if (sourceReportsUnavailable) return 'offline'
  if (!capturedAtIso || refreshIntervalSec === null || refreshIntervalSec <= 0) return 'unknown'

  const capturedMs = Date.parse(capturedAtIso)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs)) return 'unknown'

  const ageMs = nowMs - capturedMs
  const liveThresholdMs = refreshIntervalSec * 1000 * 2

  if (ageMs <= liveThresholdMs) return feedType === 'video' ? 'live_video' : 'still_image'
  if (ageMs <= STALE_WINDOW_MS) return 'stale'
  return 'offline'
}
