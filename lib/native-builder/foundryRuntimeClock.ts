/**
 * Single injectable Foundry runtime clock. Tests may advance time; production uses wall clock.
 * Do not scatter Date.now() through Mission 06 runtime logic.
 */
export type FoundryRuntimeClock = {
  nowMs(): number
  nowIso(): string
}

let injected: FoundryRuntimeClock | null = null
let fakeMs: number | null = null

const wall: FoundryRuntimeClock = {
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
}

export function foundryRuntimeNowMs(): number {
  if (injected) return injected.nowMs()
  if (fakeMs != null) return fakeMs
  return wall.nowMs()
}

export function foundryRuntimeNowIso(): string {
  if (injected) return injected.nowIso()
  return new Date(foundryRuntimeNowMs()).toISOString()
}

export function setFoundryRuntimeClock(clock: FoundryRuntimeClock | null): void {
  injected = clock
  if (!clock) fakeMs = null
}

export function resetFoundryRuntimeClock(): void {
  injected = null
  fakeMs = null
}

export function installFoundryFakeClock(startMs = Date.parse('2026-09-22T00:00:00.000Z')): void {
  fakeMs = startMs
  injected = {
    nowMs: () => fakeMs as number,
    nowIso: () => new Date(fakeMs as number).toISOString(),
  }
}

export function advanceFoundryRuntimeClock(ms: number): number {
  if (fakeMs == null) installFoundryFakeClock(foundryRuntimeNowMs())
  fakeMs = (fakeMs as number) + Math.max(0, ms)
  return fakeMs
}
