/**
 * Foundry visual mapping. Pure functions over Commander-visible state.
 * Not a second state machine — tones and Matrix channels derive from FoundryCommanderState.
 */
import type { FoundryCommanderState } from './types'
import type { MatrixChannel } from '@/lib/ui/matrixStatusBus'

export type FoundryVisualTone = 'green' | 'amber' | 'red' | 'cyan' | 'dim'

export type FoundryVisualTreatment = {
  tone: FoundryVisualTone
  matrixChannel: MatrixChannel | null
  intensity: 'dim' | 'normal' | 'active'
  label: string
}

const STATE_TREATMENT: Record<FoundryCommanderState, FoundryVisualTreatment> = {
  IDLE: { tone: 'dim', matrixChannel: 'green', intensity: 'dim', label: 'IDLE' },
  PLANNING: { tone: 'amber', matrixChannel: 'amber', intensity: 'normal', label: 'PLANNING' },
  BUILDING: { tone: 'green', matrixChannel: 'green', intensity: 'active', label: 'BUILDING' },
  RUNNING: { tone: 'green', matrixChannel: 'green', intensity: 'active', label: 'RUNNING' },
  TESTING: { tone: 'cyan', matrixChannel: 'cyan', intensity: 'active', label: 'TESTING' },
  REPAIRING: { tone: 'amber', matrixChannel: 'amber', intensity: 'normal', label: 'REPAIRING' },
  AWAITING_APPROVAL: { tone: 'amber', matrixChannel: 'amber', intensity: 'normal', label: 'AWAITING APPROVAL' },
  COMPLETE: { tone: 'green', matrixChannel: 'green', intensity: 'normal', label: 'COMPLETE' },
  BLOCKED: { tone: 'red', matrixChannel: 'red', intensity: 'normal', label: 'BLOCKED' },
  CANCELLED: { tone: 'dim', matrixChannel: 'green', intensity: 'dim', label: 'CANCELLED' },
}

export function foundryVisualForState(state: FoundryCommanderState | string | undefined): FoundryVisualTreatment {
  if (state && state in STATE_TREATMENT) return STATE_TREATMENT[state as FoundryCommanderState]
  return STATE_TREATMENT.IDLE
}

export function foundryToneClass(tone: FoundryVisualTone): string {
  if (tone === 'green') return 'text-emerald-300'
  if (tone === 'amber') return 'text-amber-300'
  if (tone === 'red') return 'text-red-400'
  if (tone === 'cyan') return 'text-cyan-300'
  return 'text-slate-500'
}

export function foundryToneBorder(tone: FoundryVisualTone): string {
  if (tone === 'green') return 'border-emerald-400/50'
  if (tone === 'amber') return 'border-amber-400/50'
  if (tone === 'red') return 'border-red-400/50'
  if (tone === 'cyan') return 'border-cyan-400/50'
  return 'border-white/10'
}

export function shortSessionTitle(title: string | undefined): string {
  const cleaned = (title ?? '')
    .replace(/^\s*WAR ROOM OS\s*[—–-]\s*/i, '')
    .split(/\r?\n/)[0]
    .trim()
  if (!cleaned) return 'New Coding Session'
  if (cleaned.length <= 42) return cleaned
  return `${cleaned.slice(0, 41).trimEnd()}…`
}

export type FoundrySessionHistoryGroup<T = { id: string; title: string; updatedAt: string }> = {
  label: 'Today' | 'Yesterday' | 'Earlier'
  items: T[]
}

export function groupFoundrySessionsByDay<T extends { id: string; title: string; updatedAt: string }>(
  sessions: T[],
  nowMs = Date.now(),
): FoundrySessionHistoryGroup<T>[] {
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  const yesterday = today - 86_400_000
  const buckets: Record<FoundrySessionHistoryGroup['label'], T[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  }
  for (const session of sessions) {
    const t = new Date(session.updatedAt).getTime()
    if (!Number.isFinite(t)) buckets.Earlier.push(session)
    else if (t >= today) buckets.Today.push(session)
    else if (t >= yesterday) buckets.Yesterday.push(session)
    else buckets.Earlier.push(session)
  }
  return (['Today', 'Yesterday', 'Earlier'] as const)
    .filter(label => buckets[label].length > 0)
    .map(label => ({ label, items: buckets[label] }))
}

export function relativeSessionTime(iso: string | undefined, nowMs = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const delta = nowMs - then
  const m = Math.round(delta / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) {
    return new Date(then).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const d = Math.round(h / 24)
  return `${d}d`
}

export function sessionHistoryKind(input: {
  selected: boolean
  commanderState?: FoundryCommanderState | string
  hasChat: boolean
}): 'ACTIVE' | 'RUNNING' | 'COMPLETE' | 'CANCELLED' | 'FAILED' | 'HISTORICAL' | 'NEW' {
  if (!input.selected) {
    if (!input.hasChat) return 'NEW'
    return 'HISTORICAL'
  }
  const state = input.commanderState
  if (state === 'COMPLETE') return 'COMPLETE'
  if (state === 'CANCELLED') return 'CANCELLED'
  if (state === 'BLOCKED') return 'FAILED'
  if (state && state !== 'IDLE') return 'RUNNING'
  if (!input.hasChat) return 'NEW'
  return 'ACTIVE'
}

export function researchFreshnessLabel(status: string | undefined): 'LIVE' | 'FRESH' | 'CACHED' | 'STALE' | null {
  if (!status) return null
  const u = status.toUpperCase()
  if (u.includes('LIVE')) return 'LIVE'
  if (u.includes('STALE')) return 'STALE'
  if (u.includes('CACHE')) return 'CACHED'
  if (u.includes('FRESH') || u.includes('OK') || u.includes('USED')) return 'FRESH'
  return 'FRESH'
}

export function workstreamMarker(item: { ok?: boolean; kind?: string; text?: string }): { icon: string; className: string } {
  if (item.ok === false || /fail|blocked|error/i.test(item.text ?? '')) return { icon: '⚠', className: 'text-amber-300' }
  if (item.kind === 'test' && item.ok !== true) return { icon: '●', className: 'text-cyan-300' }
  if (item.kind === 'complete' || item.ok === true) return { icon: '✓', className: 'text-emerald-300' }
  if (item.kind === 'repair') return { icon: '⚠', className: 'text-amber-300' }
  return { icon: '●', className: 'text-slate-400' }
}

export const FOUNDRY_LIVE_MISSION_STATES = new Set<FoundryCommanderState>([
  'PLANNING',
  'BUILDING',
  'RUNNING',
  'TESTING',
  'REPAIRING',
  'AWAITING_APPROVAL',
])
