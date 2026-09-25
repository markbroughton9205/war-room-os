/**
 * Mission-scoped AbortController registry.
 * Abort-signal plumbing adapted from kkkhs/ClawdCode Agent executeLoop
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * Foundry owns mission state. Aborting must not delete completed work.
 */
import { abortFoundryResearchMission } from './foundryResearchTransport'

export const FOUNDRY_ABORT_SCOPES = [
  'model',
  'tool',
  'research',
  'browser',
  'command',
  'subtask',
] as const

export type FoundryAbortScope = (typeof FOUNDRY_ABORT_SCOPES)[number]

type MissionAbortState = {
  controller: AbortController
  aborted: boolean
  reason: string | null
  scopes: Set<FoundryAbortScope>
}

const missions = new Map<string, MissionAbortState>()

export function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((item): item is AbortSignal => Boolean(item))
  if (!live.length) return undefined
  if (live.length === 1) return live[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live)
  const controller = new AbortController()
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}

export function beginFoundryAgentWork(missionId: string): AbortSignal {
  const existing = missions.get(missionId)
  if (existing && !existing.aborted) return existing.controller.signal
  const controller = new AbortController()
  missions.set(missionId, {
    controller,
    aborted: false,
    reason: null,
    scopes: new Set(),
  })
  return controller.signal
}

export function foundryAgentAbortSignal(missionId?: string | null): AbortSignal | undefined {
  if (!missionId) return undefined
  return missions.get(missionId)?.controller.signal
}

export function isFoundryAgentAborted(missionId?: string | null): boolean {
  if (!missionId) return false
  return missions.get(missionId)?.aborted === true || missions.get(missionId)?.controller.signal.aborted === true
}

export function abortFoundryAgentWork(
  missionId: string,
  reason = 'Commander cancelled',
  scopes: FoundryAbortScope[] = [...FOUNDRY_ABORT_SCOPES],
): { aborted: boolean; alreadyAborted: boolean; scopes: FoundryAbortScope[] } {
  const state = missions.get(missionId) ?? {
    controller: new AbortController(),
    aborted: false,
    reason: null,
    scopes: new Set<FoundryAbortScope>(),
  }
  missions.set(missionId, state)
  const alreadyAborted = state.aborted || state.controller.signal.aborted
  for (const scope of scopes) state.scopes.add(scope)
  if (!state.controller.signal.aborted) state.controller.abort()
  state.aborted = true
  state.reason = reason
  if (scopes.includes('research')) abortFoundryResearchMission(missionId)
  return { aborted: true, alreadyAborted, scopes: [...state.scopes] }
}

export function releaseFoundryAgentWork(missionId: string): void {
  missions.delete(missionId)
}

export function foundryAgentAbortReason(missionId: string): string | null {
  return missions.get(missionId)?.reason ?? null
}

export function thrownIfFoundryAgentAborted(missionId?: string | null, label = 'work'): void {
  if (!isFoundryAgentAborted(missionId)) return
  const reason = missionId ? foundryAgentAbortReason(missionId) : 'aborted'
  const error = new Error(`FOUNDRY_ABORTED: ${label} interrupted (${reason ?? 'Commander cancelled'}).`)
  error.name = 'AbortError'
  throw error
}
