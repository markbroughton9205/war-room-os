/**
 * Adapter boundary for the normalized RED/AMBER/GREEN/UNKNOWN God's Eye runtime status the Mac
 * lane is building. This file intentionally has nothing real to adapt yet -- it exists so the
 * Council UI has one stable, typed shape to consume today (always UNKNOWN) and Node01 can wire a
 * real producer into `resolveCouncilGodsEyeStatus` later without any UI change.
 *
 * Hard rule (mission doctrine, matches Terra's existing coverage-truth pattern in
 * lib/terra/maritimeCoverage.ts): "no events returned" is never GREEN, and nothing here may claim
 * SAFE/NORMAL/CLEAR without a real, source-backed field to point to. Until Node01 exposes that
 * field, every caller gets UNKNOWN_GODS_EYE_STATUS, unconditionally.
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
