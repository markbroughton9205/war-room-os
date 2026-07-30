/**
 * Pure selection/reset logic for GapFinderPanel's manual "Run Self-Audit" override versus the
 * live base canonicalStatus. Extracted so this logic is directly testable without a DOM/React
 * test runner — the component only calls these functions, it contains no branching of its own.
 */
import type { CanonicalGapSnapshot } from './gapFinder'

export type CanonicalBaseSnapshot = {
  status: CanonicalGapSnapshot | null
  unavailable: boolean
}

export type CanonicalOverrideState = {
  override: CanonicalGapSnapshot | null
  overrideFailed: boolean
  hasOverride: boolean
}

export type SelectedCanonicalStatus = {
  canonicalStatus: CanonicalGapSnapshot | null
  canonicalStatusUnavailable: boolean
}

export function baseSnapshotFromContext(
  canonicalStatus: CanonicalGapSnapshot | null | undefined,
  canonicalStatusUnavailable: boolean | undefined,
): CanonicalBaseSnapshot {
  return { status: canonicalStatus ?? null, unavailable: canonicalStatusUnavailable ?? false }
}

/** True when the live base has moved on from what was last observed — the manual override (if
 * any) must be dropped so the fresher base wins instead of silently disagreeing with it. */
export function baseSnapshotChanged(current: CanonicalBaseSnapshot, lastSeen: CanonicalBaseSnapshot): boolean {
  return current.status !== lastSeen.status || current.unavailable !== lastSeen.unavailable
}

/** `hasOverride` — not the override's data — decides whether the override wins. A failed manual
 * scan has `override: null` (no fresh snapshot) but `hasOverride: true`, and must still win over
 * the base with `canonicalStatusUnavailable: true`; gating on the override value's truthiness
 * instead would silently drop that failure and let a stale/healthy-looking base reappear. */
export function selectCanonicalStatus(
  overrideState: CanonicalOverrideState,
  base: CanonicalBaseSnapshot,
): SelectedCanonicalStatus {
  if (overrideState.hasOverride) {
    return { canonicalStatus: overrideState.override, canonicalStatusUnavailable: overrideState.overrideFailed }
  }
  return { canonicalStatus: base.status, canonicalStatusUnavailable: base.unavailable }
}
