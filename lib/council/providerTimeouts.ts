import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { IntentKind } from '@/lib/council/intentClassifier'

/** Client decree gather: user cancel only until this wall clock; avoids mirroring soft packet windows. */
export const DECREE_GATHER_HARD_HANG_MS = 55_000

/** HTTP `body.mode` from Live Council (expanded = higher token budget, slightly longer budget). */
export type CouncilHttpBodyMode = 'continue' | 'expanded' | string | undefined

function expandedBump(ms: number, mode: CouncilHttpBodyMode): number {
  if (mode === 'expanded') return Math.min(Math.round(ms * 1.15), ms + 4000)
  return ms
}

/**
 * Per-provider ceiling for a single `/api/chat` family call.
 * Tiers: attendance 3–5s, natural 5–8s, council_analysis 10–18s, deep research 20–30s.
 */
export function resolveProviderTimeoutMs(args: {
  intentKind: IntentKind
  mode: CouncilHttpBodyMode
  councilCommand?: CouncilCommand
}): number {
  const cmdMode = args.councilCommand?.mode
  const ik = args.intentKind

  if (cmdMode === 'attendance' || ik === 'attendance') {
    // Short path for autonomous / tools; decree gather uses `decreeSoftGather` server budget instead.
    return expandedBump(4000, args.mode)
  }

  if (ik === 'research' || cmdMode === 'research') {
    return expandedBump(26_000, args.mode) // 20–30s
  }

  if (
    ik === 'council_analysis'
    || cmdMode === 'analysis'
    || cmdMode === 'council'
    || cmdMode === 'debate'
    || cmdMode === 'execution'
    || cmdMode === 'emergency'
    || cmdMode === 'red_team_only'
    || ik === 'architecture'
    || ik === 'execution'
    || ik === 'debugging'
    || ik === 'brainstorming'
    || ik === 'business_ops'
  ) {
    return expandedBump(14_000, args.mode) // 10–18s
  }

  if (ik === 'greeting' || ik === 'natural' || ik === 'silent') {
    return expandedBump(6500, args.mode) // 5–8s
  }

  return expandedBump(6500, args.mode)
}

/**
 * Server-side provider budget for `/api/chat` when the client uses soft decree gather
 * (no early fetch abort). Stays below hard hang so the route can return `timed_out` before the client drops.
 */
export function resolveDecreeSoftGatherServerBudgetMs(args: {
  intentKind: IntentKind
  mode: CouncilHttpBodyMode
  councilCommand?: CouncilCommand
}): number {
  const base = resolveProviderTimeoutMs(args)
  return Math.max(base, DECREE_GATHER_HARD_HANG_MS - 5000)
}

/** Engine-control status fetch budget during attendance preflight (no generate). */
export const ATTENDANCE_PREFLIGHT_STATUS_FETCH_MS = 8000

/** Per-family classification slice after status map is loaded (sync work only). */
export const ATTENDANCE_PREFLIGHT_PER_FAMILY_MS = 500

/** Visual release window for attendance gather (parallel batch) — ~2–5s. */
export function resolveAttendanceBatchCeilingMs(args: { familyCount: number }): number {
  const n = Math.max(1, args.familyCount)
  const scaled = 2000 + Math.min(n, 6) * 400
  return Math.min(5000, Math.max(2000, scaled))
}

/** Hard close after visual release — allows late merge before session closes. */
export function resolveAttendanceHardCloseMs(args: { familyCount: number }): number {
  const visual = resolveAttendanceBatchCeilingMs(args)
  const n = Math.max(1, args.familyCount)
  return visual + 8000 + Math.min(n, 6) * 1000
}
