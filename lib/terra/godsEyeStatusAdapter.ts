/**
 * Adapter boundary for God's Eye runtime status.
 * No producer is wired in this runtime, so the public label is NOT CONFIGURED.
 * UNKNOWN is reserved for a live producer that returned no classifiable severity,
 * and that case must carry a reason. Absence of a producer is not GREEN.
 */

export const COUNCIL_GODS_EYE_SEVERITIES = ['RED', 'AMBER', 'GREEN', 'UNKNOWN'] as const
export type CouncilGodsEyeSeverity = (typeof COUNCIL_GODS_EYE_SEVERITIES)[number]

export type CouncilGodsEyeStatus = {
  severity: CouncilGodsEyeSeverity
  /** Human-readable reason for the current severity; null when there is nothing to report yet. */
  reason: string | null
  /** Where this status came from -- 'not_yet_available' until Node01 ships a real producer. */
  source: 'godseye_runtime' | 'not_yet_available'
  /** ISO timestamp of the underlying observation, or null when there is none. */
  freshness: string | null
}

export const UNKNOWN_GODS_EYE_STATUS: CouncilGodsEyeStatus = Object.freeze({
  severity: 'UNKNOWN',
  reason: "God's Eye normalized status is not yet exposed by this runtime.",
  source: 'not_yet_available',
  freshness: null,
})

/**
 * Adapter entry point. Pass `undefined`/`null` (the only thing any current caller can pass, since
 * no producer exists yet) to get the honest UNKNOWN status. Once Node01 exposes a real field,
 * wire its shape into the `input` parameter here -- this is the one place that needs to change.
 */
export function resolveCouncilGodsEyeStatus(
  input?: Partial<CouncilGodsEyeStatus> | null,
): CouncilGodsEyeStatus {
  if (!input || !input.severity) return UNKNOWN_GODS_EYE_STATUS
  if (!COUNCIL_GODS_EYE_SEVERITIES.includes(input.severity)) return UNKNOWN_GODS_EYE_STATUS
  return {
    severity: input.severity,
    reason: input.reason ?? null,
    source: input.source === 'godseye_runtime' ? 'godseye_runtime' : 'not_yet_available',
    freshness: input.freshness ?? null,
  }
}

/** Visible strip label. Not-configured is not reported as a bare UNKNOWN. */
export function godsEyePublicLabel(status: CouncilGodsEyeStatus = UNKNOWN_GODS_EYE_STATUS): string {
  if (status.source !== 'godseye_runtime') return "GOD'S EYE NOT CONFIGURED"
  if (status.severity === 'GREEN') return "GOD'S EYE READY"
  if (status.severity === 'AMBER') return "GOD'S EYE DEGRADED"
  if (status.severity === 'RED') return "GOD'S EYE OFFLINE"
  return status.reason ? `GOD'S EYE UNKNOWN — ${status.reason}` : "GOD'S EYE UNKNOWN"
}
