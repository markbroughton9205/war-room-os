/**
 * Terra vessel staleness rule — mirrors lib/terra/aircraftStaleness.ts exactly for the Maritime
 * layer. digitraffic_marine's /locations response is self-purging the same way OpenSky's
 * /states/all is (a vessel that stops reporting simply stops appearing next fetch), so this only
 * covers the remaining honest case: a vessel still present in the current response whose own
 * receiver timestamp is old enough that its position should no longer be presented as fresh.
 * AIS position reports are typically far less frequent than ADS-B (moored/anchored vessels can go
 * many minutes between reports even on a healthy feed), so the threshold is deliberately looser
 * than aircraft's 90s, not copy-pasted from it.
 */
export const TERRA_VESSEL_STALE_AFTER_MS = 10 * 60 * 1000

export function isTerraVesselStale(observedAtIso: string | null, nowIso: string, staleAfterMs: number = TERRA_VESSEL_STALE_AFTER_MS): boolean {
  if (!observedAtIso) return true
  const observedMs = Date.parse(observedAtIso)
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return true
  return nowMs - observedMs > staleAfterMs
}
