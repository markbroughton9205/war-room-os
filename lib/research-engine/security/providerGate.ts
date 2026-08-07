import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'

/**
 * In-process concurrency limiter + failure cooldown per provider. Intentionally
 * in-memory only (no Redis/DB) per the Research Engine's "no new paid
 * infrastructure" constraint — this resets on redeploy, which is acceptable
 * for a soft rate-limit/circuit-breaker, not a correctness guarantee.
 */

const MAX_CONCURRENT_PER_PROVIDER = 2
const COOLDOWN_AFTER_FAILURES = 3
const COOLDOWN_MS = 30_000

type ProviderState = {
  inFlight: number
  waiters: (() => void)[]
  consecutiveFailures: number
  cooldownUntil: number | null
}

const state = new Map<ResearchProviderId, ProviderState>()

function stateFor(provider: ResearchProviderId): ProviderState {
  let existing = state.get(provider)
  if (!existing) {
    existing = { inFlight: 0, waiters: [], consecutiveFailures: 0, cooldownUntil: null }
    state.set(provider, existing)
  }
  return existing
}

export function providerCooldownRemainingMs(provider: ResearchProviderId): number {
  const s = stateFor(provider)
  if (!s.cooldownUntil) return 0
  return Math.max(0, s.cooldownUntil - Date.now())
}

export function recordProviderOutcome(provider: ResearchProviderId, ok: boolean): void {
  const s = stateFor(provider)
  if (ok) {
    s.consecutiveFailures = 0
    s.cooldownUntil = null
    return
  }
  s.consecutiveFailures += 1
  if (s.consecutiveFailures >= COOLDOWN_AFTER_FAILURES) {
    s.cooldownUntil = Date.now() + COOLDOWN_MS
  }
}

async function acquireSlot(provider: ResearchProviderId): Promise<() => void> {
  const s = stateFor(provider)
  if (s.inFlight < MAX_CONCURRENT_PER_PROVIDER) {
    s.inFlight += 1
    return () => releaseSlot(provider)
  }
  await new Promise<void>(resolve => s.waiters.push(resolve))
  s.inFlight += 1
  return () => releaseSlot(provider)
}

function releaseSlot(provider: ResearchProviderId): void {
  const s = stateFor(provider)
  s.inFlight = Math.max(0, s.inFlight - 1)
  const next = s.waiters.shift()
  if (next) next()
}

/** Runs `fn` under the provider's concurrency limit; throws immediately if the provider is cooling down. */
export async function withProviderGate<T>(provider: ResearchProviderId, fn: () => Promise<T>): Promise<T> {
  const remaining = providerCooldownRemainingMs(provider)
  if (remaining > 0) {
    throw new Error(`Provider ${provider} is in a failure cooldown for ${Math.ceil(remaining / 1000)}s more`)
  }
  const release = await acquireSlot(provider)
  try {
    const result = await fn()
    recordProviderOutcome(provider, true)
    return result
  } catch (error) {
    recordProviderOutcome(provider, false)
    throw error
  } finally {
    release()
  }
}

export function __resetProviderGateForTests(): void {
  state.clear()
}
