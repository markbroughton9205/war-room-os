import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ProviderFamilyOutcomeStatus =
  | 'READY'
  | 'RESPONDED'
  | 'TIMED_OUT'
  | 'DEGRADED'
  | 'FAILED'
  | 'SKIPPED'
  /** Response still in flight after a soft gather window (no client abort). */
  | 'IN_FLIGHT'

export type ProviderFamilyRuntimeOutcome = {
  status: ProviderFamilyOutcomeStatus
  family: CouncilOrchestrationFamily
  /** Present when status is RESPONDED or DEGRADED (degraded note text). */
  detail?: string
}

export type RaceWithTimeoutResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'timeout' }
  | { ok: false; reason: 'rejected'; error: unknown }

/**
 * Races `promise` against a timer. Does not cancel the underlying promise.
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<RaceWithTimeoutResult<T>> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise.then(
      value => ({ ok: true, value }),
      error => ({ ok: false, reason: 'rejected', error }),
    )
  }
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms)
    promise.then(
      value => {
        clearTimeout(t)
        resolve({ ok: true, value })
      },
      error => {
        clearTimeout(t)
        resolve({ ok: false, reason: 'rejected', error })
      },
    )
  })
}

export function markTimedOut(family: CouncilOrchestrationFamily, detail?: string): ProviderFamilyRuntimeOutcome {
  return { status: 'TIMED_OUT', family, detail }
}

export function markSkipped(family: CouncilOrchestrationFamily, detail?: string): ProviderFamilyRuntimeOutcome {
  return { status: 'SKIPPED', family, detail }
}

export function markFailed(family: CouncilOrchestrationFamily, detail?: string): ProviderFamilyRuntimeOutcome {
  return { status: 'FAILED', family, detail }
}

export function markResponded(family: CouncilOrchestrationFamily): ProviderFamilyRuntimeOutcome {
  return { status: 'RESPONDED', family }
}

export function markDegraded(family: CouncilOrchestrationFamily, detail: string): ProviderFamilyRuntimeOutcome {
  return { status: 'DEGRADED', family, detail }
}
