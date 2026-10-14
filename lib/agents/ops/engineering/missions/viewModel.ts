import type { MissionView } from './service'

export type Badge = { label: string; tone: 'run' | 'ok' | 'bad' | 'warn' | 'idle'; note: string }

/** What the operator is told about a mission. A state is shown as running only when the worker is demonstrably alive; every other reading is spelled out. */
export function stateBadge(v: Pick<MissionView, 'state' | 'liveness' | 'stateReason' | 'worker'>): Badge {
  const active = ['QUEUED', 'RUNNING', 'VERIFYING', 'APPLYING', 'INSTALLING'].includes(v.state)
  if (active && v.liveness.verdict === 'DEAD') return { label: 'WORKER LOST', tone: 'bad', note: `shown as ${v.state} on disk but ${v.liveness.reason}; the next reconciliation moves it to INTERRUPTED` }
  if (active && v.liveness.verdict === 'STALLED') return { label: `${v.state} (STALLED)`, tone: 'warn', note: v.liveness.reason }
  if (active) return { label: v.state, tone: 'run', note: v.worker ? `worker ${v.worker.workerId}, heartbeat ${v.worker.heartbeatAgeSec} s ago, last progress ${v.worker.progressAgeSec} s ago` : v.stateReason }
  if (v.state === 'COMPLETED') return { label: 'COMPLETED', tone: 'ok', note: v.stateReason }
  if (v.state === 'INTERRUPTED') return { label: 'INTERRUPTED (recoverable)', tone: 'warn', note: v.stateReason }
  if (v.state === 'CANCELLED') return { label: 'CANCELLED', tone: 'idle', note: v.stateReason }
  return { label: 'FAILED', tone: 'bad', note: v.stateReason }
}

export const isActive = (v: Pick<MissionView, 'state'>) => ['QUEUED', 'RUNNING', 'VERIFYING', 'APPLYING', 'INSTALLING'].includes(v.state)
export function roleLine(roles: Record<string, { model: string; calls: number }[]>): string[] {
  return Object.entries(roles).map(([r, ms]) => `${r.replace(/_/g, ' ')}: ${ms.map((m) => `${m.model} × ${m.calls}`).join(', ')}`)
}
