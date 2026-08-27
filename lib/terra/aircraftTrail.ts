/**
 * Bounded session-only aircraft trail. OpenSky's `/states/all` endpoint supplies only current
 * state, never a historical track — this is deliberately built ONLY from actual successive
 * observations received during the current browser session (components/war-room/terra
 * /useTerraAircraftTrails.ts appends one point per real fetch), never a provider historical track
 * and never fabricated between two real observations. Capped by both point count and age so it
 * can never grow into an unbounded history.
 */
export type TerraAircraftTrailPoint = { longitude: number; latitude: number; observedAtMs: number }

export const TERRA_AIRCRAFT_TRAIL_MAX_POINTS = 6
export const TERRA_AIRCRAFT_TRAIL_MAX_AGE_MS = 10 * 60 * 1000

export function updateTerraAircraftTrail(
  existing: TerraAircraftTrailPoint[],
  nextPoint: TerraAircraftTrailPoint,
  maxPoints: number = TERRA_AIRCRAFT_TRAIL_MAX_POINTS,
  maxAgeMs: number = TERRA_AIRCRAFT_TRAIL_MAX_AGE_MS,
): TerraAircraftTrailPoint[] {
  const cutoffMs = nextPoint.observedAtMs - maxAgeMs
  const withoutStale = existing.filter(point => point.observedAtMs >= cutoffMs)

  const last = withoutStale[withoutStale.length - 1]
  // A re-render with the exact same last-known observation (same position, same instant) must
  // never grow the trail — only a genuinely new observation appends a point.
  if (last && last.longitude === nextPoint.longitude && last.latitude === nextPoint.latitude && last.observedAtMs === nextPoint.observedAtMs) {
    return withoutStale
  }

  const appended = [...withoutStale, nextPoint]
  return appended.length > maxPoints ? appended.slice(appended.length - maxPoints) : appended
}
