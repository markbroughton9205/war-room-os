/**
 * Terra aircraft staleness rule. OpenSky's `/states/all` response is self-purging by nature — an
 * aircraft that stops broadcasting simply stops appearing in the next fetch, and
 * TerraFeatureLayer.tsx's existing full removeAll()+rebuild already removes it from the globe on
 * that next refresh with no extra code. This function covers the remaining honest case: an
 * aircraft still present in the current response whose own `last_contact` is old enough that its
 * position should no longer be presented as fresh — a per-aircraft signal, distinct from the
 * whole-layer LIVE/STALE/ERROR state useTerraLayer.ts already reports.
 */
export const TERRA_AIRCRAFT_STALE_AFTER_MS = 90_000

export function isTerraAircraftStale(observedAtIso: string | null, nowIso: string, staleAfterMs: number = TERRA_AIRCRAFT_STALE_AFTER_MS): boolean {
  if (!observedAtIso) return true
  const observedMs = Date.parse(observedAtIso)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return true
  return nowMs - observedMs > staleAfterMs
}
