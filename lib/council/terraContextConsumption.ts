/**
 * Terra globe context must attach to the decree that consumed it, and only that decree — a
 * Commander's globe pin must never silently carry forward into an unrelated later decree (Build #4
 * readiness audit finding: `terraCouncilContextRef` was read but never cleared, so the UI's own
 * "Terra context is attached to the current turn only" claim was false in practice).
 *
 * This is a tiny, pure, framework-free module specifically so the one-turn-consumption behavior is
 * unit-testable without importing app/page.tsx (a large 'use client' component with browser-only
 * dependencies that a Node validation script cannot load).
 */

export type TerraContextRefLike = { current: string | null }

/**
 * Reads and clears the Terra context ref together, so the same value can never be read by two
 * decrees. `mode === 'continue'` is a synthetic follow-up turn, not a new Commander decree — it
 * neither attaches nor consumes Terra context, leaving the ref intact for whichever real decree
 * follows it.
 */
export function consumeTerraContextForDecree(ref: TerraContextRefLike, mode?: string): string | null {
  if (mode === 'continue') return null
  const value = ref.current
  ref.current = null
  return value
}
