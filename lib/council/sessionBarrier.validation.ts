import { shouldSuppressStaleAutonomousReveal, shouldSuppressVisibleLateResponse } from './sessionBarrier'
import { shouldAcceptCouncilAsyncResult } from '@/lib/conversation-runtime/asyncGuards'

/**
 * Regression coverage for the superseded-Commander-decree repair (live-council-intelligence-repair
 * branch). The actual gating logic lives inline inside app/page.tsx's submitDecree/gatherFamily/
 * runFamilyDeliberationGather/revealOrchestrationTurn closures (not exported — those functions
 * close over per-submit local state like `myRound` and are not unit-testable in isolation). This
 * file proves the real, exported comparator primitives those closures call behave correctly, and
 * separately proves the abort-controller-ownership pattern used at the same call site is correct.
 * It does not execute app/page.tsx itself — see the mission report for what remains verified only
 * by code inspection of the applied diff versus what is proven here.
 */

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runSessionBarrierValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // CASE 1 — a round-1 decree/autonomous reveal must be suppressed once round 2 is current.
  results.push(check(
    'case1_old_decree_round_blocked',
    shouldSuppressStaleAutonomousReveal(1, 2) === true,
    'round-1 fetch resolving while round 2 is current must be suppressed',
  ))
  results.push(check(
    'case1_shouldAcceptCouncilAsyncResult_rejects_stale_round',
    shouldAcceptCouncilAsyncResult({
      mounted: true,
      expectedSessionId: 's1',
      activeSessionId: 's1',
      expectedDecreeRound: 1,
      activeDecreeRound: 2,
    }) === false,
    'isCurrentDecreeAsync()-equivalent must reject a stale round even when session/mount match',
  ))

  // CASE 2 — the current round's own reveal must be allowed.
  results.push(check(
    'case2_current_decree_round_allowed',
    shouldSuppressStaleAutonomousReveal(2, 2) === false,
    'round-2 fetch resolving during round 2 must not be suppressed',
  ))
  results.push(check(
    'case2_shouldAcceptCouncilAsyncResult_accepts_current_round',
    shouldAcceptCouncilAsyncResult({
      mounted: true,
      expectedSessionId: 's1',
      activeSessionId: 's1',
      expectedDecreeRound: 2,
      activeDecreeRound: 2,
    }) === true,
    'isCurrentDecreeAsync()-equivalent must accept a same-round, same-session, mounted result',
  ))

  // Same-round late-arrival guard — the pre-existing precedent this repair generalizes to
  // cross-round supersession.
  results.push(check(
    'same_round_late_arrival_guard_precedent',
    shouldSuppressVisibleLateResponse({ sessionState: 'CLOSED', messageTimestampMs: 200, closeTimestampMs: 100 }) === true,
    'proves the codebase already had a working "reject content arriving after close" pattern',
  ))

  // CASE 6 — abort-controller ownership. This is the exact pattern applied at
  // app/page.tsx:9223-9231 (abort the previous decree's controller, then assign a new one) and at
  // every existing `if (abortControllerRef.current === controller) abortControllerRef.current =
  // null` cleanup site — reproduced here as plain AbortController logic, no app dependencies.
  {
    const abortControllerRef: { current: AbortController | null } = { current: null }

    // Old decree starts, owns controller A.
    const previousA = abortControllerRef.current
    if (previousA && !previousA.signal.aborted) previousA.abort()
    const controllerA = new AbortController()
    abortControllerRef.current = controllerA

    // New decree starts, must abort A before owning controller B.
    const previousB = abortControllerRef.current
    if (previousB && !previousB.signal.aborted) previousB.abort()
    const controllerB = new AbortController()
    abortControllerRef.current = controllerB

    results.push(check(
      'case6_old_controller_aborted_when_new_decree_starts',
      controllerA.signal.aborted === true,
      `controllerA.signal.aborted=${controllerA.signal.aborted}`,
    ))
    results.push(check(
      'case6_new_controller_not_aborted',
      controllerB.signal.aborted === false,
      `controllerB.signal.aborted=${controllerB.signal.aborted}`,
    ))

    // Old decree's finally block runs late (after B is already current) and must not clear B.
    if (abortControllerRef.current === controllerA) abortControllerRef.current = null
    results.push(check(
      'case6_late_finally_does_not_clear_newer_controller',
      abortControllerRef.current === controllerB,
      `abortControllerRef.current === controllerB: ${abortControllerRef.current === controllerB}`,
    ))
  }

  return results
}
