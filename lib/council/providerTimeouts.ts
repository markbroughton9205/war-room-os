import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { IntentKind } from '@/lib/council/intentClassifier'

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
    return expandedBump(4000, args.mode) // 3–5s tier
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

/** Hard ceiling for an entire attendance gather wave (parallel batch). */
export function resolveAttendanceBatchCeilingMs(args: { familyCount: number }): number {
  const n = Math.max(1, args.familyCount)
  // 3–8s global cap: scale slightly with roster size but stay within band
  const scaled = 3200 + Math.min(n, 6) * 420
  return Math.min(8000, Math.max(3000, scaled))
}
