/**
 * Source-supplied camera direction only. Never infers heading from neighbors or road geometry.
 */
const COMPASS_DEGREES: Record<string, number> = {
  n: 0,
  north: 0,
  northbound: 0,
  nb: 0,
  ne: 45,
  northeast: 45,
  e: 90,
  east: 90,
  eastbound: 90,
  eb: 90,
  se: 135,
  southeast: 135,
  s: 180,
  south: 180,
  southbound: 180,
  sb: 180,
  sw: 225,
  southwest: 225,
  w: 270,
  west: 270,
  westbound: 270,
  wb: 270,
  nw: 315,
  northwest: 315,
}

export function sourcedCameraBearingDegrees(direction: unknown): number | null {
  if (typeof direction === 'number' && Number.isFinite(direction)) {
    return ((direction % 360) + 360) % 360
  }
  if (typeof direction !== 'string') return null
  const normalized = direction.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) return null
  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) return ((numeric % 360) + 360) % 360
  return COMPASS_DEGREES[normalized] ?? null
}
