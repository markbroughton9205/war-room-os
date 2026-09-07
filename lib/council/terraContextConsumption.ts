/**
 * Terra globe context must attach to the decree that consumed it, and only that decree — a
 * Commander's globe pin must never silently carry forward into an unrelated later decree (Build #4
 * readiness audit finding: `terraCouncilContextRef` was read but never cleared, so the UI's own
 * "Terra context is attached to the current turn only" claim was false in practice).
 *
 * This is a tiny, pure, framework-free module specifically so the one-turn-consumption behavior is
 * unit-testable without importing app/page.tsx (a large 'use client' component with browser-only
 * dependencies that a Node validation script cannot load).
 *
 * IMPORTANT — why this is a *signature comparison*, not a *clear on read*: `terraCouncilContextRef`
 * is kept continuously live-mirrored by GodsEyeCommandCenter's TerraCouncilContextBridge, which
 * re-composes and re-writes the full context string whenever ANY of its own dependencies changes —
 * including layerCoverage, which is refreshed by an unrelated periodic background fetch completely
 * independent of any decree submission. An earlier "read the ref, then set it to null" design was
 * confirmed live to fail exactly here: clearing the ref after decree 1 consumed it did stop the
 * leak for a few hundred milliseconds, but the very next layerCoverage-driven re-render of the
 * bridge component re-wrote the same still-active selection straight back into the ref before
 * decree 2 was ever submitted, so decree 2 saw it again. Comparing against the last-consumed value
 * survives that: it doesn't matter how many times the mirror re-writes the *same* text between
 * decrees, only whether the text actually changed since it was last attached to a decree.
 */

export type TerraContextRefLike = { current: string | null }

/**
 * Reads the live-mirrored Terra context ref and returns it only if it differs from whatever was
 * last attached to a decree — i.e. the underlying Terra selection (or its observed facts) has
 * genuinely changed since the last time a decree consumed it. Returns null for: no active
 * selection, an unchanged selection already attached to a prior decree, or a `continue` turn
 * (a synthetic follow-up, not a new Commander decree — it must neither attach nor mark anything
 * as consumed, leaving state untouched for whichever real decree follows it).
 */
export function consumeTerraContextForDecree(
  liveRef: TerraContextRefLike,
  consumedSignatureRef: TerraContextRefLike,
  mode?: string,
): string | null {
  if (mode === 'continue') return null
  const current = liveRef.current
  if (current === null) return null
  if (current === consumedSignatureRef.current) return null
  consumedSignatureRef.current = current
  return current
}
