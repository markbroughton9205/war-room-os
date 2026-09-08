import type { ScoutGovernorLimits, ScoutPlan } from './types'

export const DEFAULT_SCOUT_GOVERNOR_LIMITS: ScoutGovernorLimits = Object.freeze({
  maxScoutsPerSeat: 5,
  maxTotalScoutsPerRound: 16,
  maxConcurrentModelCalls: 1,
  maxConcurrentWebCalls: 3,
  perScoutTimeoutMs: 22_000,
  phaseTimeoutMs: 180_000,
  maxSpawnDepth: 1,
})

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function loadScoutGovernorLimits(): ScoutGovernorLimits {
  return {
    maxScoutsPerSeat: envInt('WAR_ROOM_SCOUT_MAX_PER_SEAT', DEFAULT_SCOUT_GOVERNOR_LIMITS.maxScoutsPerSeat, 1, 8),
    maxTotalScoutsPerRound: envInt('WAR_ROOM_SCOUT_MAX_PER_ROUND', DEFAULT_SCOUT_GOVERNOR_LIMITS.maxTotalScoutsPerRound, 1, 24),
    maxConcurrentModelCalls: envInt('WAR_ROOM_SCOUT_MAX_CONCURRENT_MODEL', DEFAULT_SCOUT_GOVERNOR_LIMITS.maxConcurrentModelCalls, 1, 2),
    maxConcurrentWebCalls: envInt('WAR_ROOM_SCOUT_MAX_CONCURRENT_WEB', DEFAULT_SCOUT_GOVERNOR_LIMITS.maxConcurrentWebCalls, 1, 8),
    perScoutTimeoutMs: envInt('WAR_ROOM_SCOUT_TIMEOUT_MS', DEFAULT_SCOUT_GOVERNOR_LIMITS.perScoutTimeoutMs, 5_000, 60_000),
    phaseTimeoutMs: envInt('WAR_ROOM_SCOUT_PHASE_TIMEOUT_MS', DEFAULT_SCOUT_GOVERNOR_LIMITS.phaseTimeoutMs, 30_000, 300_000),
    maxSpawnDepth: 1,
  }
}

export type ScoutGovernor = {
  limits: ScoutGovernorLimits
  accepted: ScoutPlan[]
  rejected: Array<{ plan: ScoutPlan; reason: string }>
  concurrentWeb: number
  concurrentModel: number
}

export function createScoutGovernor(limits: ScoutGovernorLimits = loadScoutGovernorLimits()): ScoutGovernor {
  return {
    limits,
    accepted: [],
    rejected: [],
    concurrentWeb: 0,
    concurrentModel: 0,
  }
}

export function admitScout(governor: ScoutGovernor, plan: ScoutPlan): { ok: boolean; reason?: string } {
  if (plan.spawnDepth !== 1 || plan.spawnDepth > governor.limits.maxSpawnDepth) {
    governor.rejected.push({ plan, reason: 'recursive_spawn_forbidden' })
    return { ok: false, reason: 'recursive_spawn_forbidden' }
  }
  const seatCount = governor.accepted.filter(item => item.seatId === plan.seatId).length
  if (seatCount >= governor.limits.maxScoutsPerSeat) {
    governor.rejected.push({ plan, reason: 'max_scouts_per_seat' })
    return { ok: false, reason: 'max_scouts_per_seat' }
  }
  if (governor.accepted.length >= governor.limits.maxTotalScoutsPerRound) {
    governor.rejected.push({ plan, reason: 'max_total_scouts' })
    return { ok: false, reason: 'max_total_scouts' }
  }
  governor.accepted.push(plan)
  return { ok: true }
}

export function scoutCannotSpawnSwarm(plan: ScoutPlan): boolean {
  return plan.spawnDepth === 1
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) break
      const index = next
      next += 1
      results[index] = await fn(items[index]!, index)
    }
  })
  if (items.length === 0) return []
  await Promise.all(workers)
  return results
}

export function isCurrentRoundIdentity(
  expected: { missionId: string; roundRequestId: string; logicalRequestId: string },
  actual: { missionId: string; roundRequestId: string; logicalRequestId: string },
): boolean {
  return (
    expected.missionId === actual.missionId
    && expected.roundRequestId === actual.roundRequestId
    && expected.logicalRequestId === actual.logicalRequestId
  )
}
