/**
 * Council **resolution** lifecycle for a single decree packet (gather → moderate → release).
 * Distinct from `CouncilLifecycleState` in councilSessionTypes (idle/active/paused).
 */
export type CouncilResolutionSessionState = 'OPEN' | 'FINALIZING' | 'CLOSED'

export type CouncilResolutionTimestamps = {
  openedAtMs: number
  finalizingAtMs?: number
  closedAtMs?: number
}

export function initialResolutionTimestamps(openedAtMs: number): CouncilResolutionTimestamps {
  return { openedAtMs }
}

export function transitionToFinalizing(ts: CouncilResolutionTimestamps, atMs: number): CouncilResolutionTimestamps {
  return { ...ts, finalizingAtMs: atMs }
}

export function transitionToClosed(ts: CouncilResolutionTimestamps, atMs: number): CouncilResolutionTimestamps {
  return { ...ts, closedAtMs: atMs }
}

/**
 * After CLOSE, visible family replies for the same packet round must be rejected.
 * Optional `familyId` reserved for logging / future per-family gates.
 */
export function canAcceptVisibleReply(state: CouncilResolutionSessionState, familyId?: string): boolean {
  void familyId
  if (state === 'CLOSED') return false
  return true
}
