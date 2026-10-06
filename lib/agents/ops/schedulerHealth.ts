import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type SchedulerHealth = { instanceId: string; pid: number; startedAt: string; intervalMs: number; lastTickAt: string | null; lastTickRan: number; lastError: string | null }
const file = (dir: string) => path.join(dir, 'scheduler-health.json')

/** Small overwritten file (not part of the audit log): health is what the last tick reported, never inferred from a timer existing. */
export function writeSchedulerHealth(dir: string, h: SchedulerHealth): void {
  const tmp = file(dir) + `.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(h), 'utf8')
  renameSync(tmp, file(dir))
}

export function readSchedulerHealth(dir: string, now: Date = new Date()): { state: 'RUNNING' | 'STALE' | 'UNKNOWN'; detail: string; health: SchedulerHealth | null } {
  if (!existsSync(file(dir))) return { state: 'UNKNOWN', detail: 'no scheduler has reported for this data root', health: null }
  try {
    const h = JSON.parse(readFileSync(file(dir), 'utf8')) as SchedulerHealth
    if (!h.lastTickAt) return { state: 'UNKNOWN', detail: `instance ${h.instanceId} started but has not ticked`, health: h }
    const age = now.getTime() - Date.parse(h.lastTickAt)
    return age <= h.intervalMs * 3 + 5_000 ? { state: 'RUNNING', detail: `last tick ${Math.round(age / 1000)}s ago (instance ${h.instanceId})`, health: h } : { state: 'STALE', detail: `last tick ${Math.round(age / 1000)}s ago; scheduler appears stopped`, health: h }
  } catch { return { state: 'UNKNOWN', detail: 'health file unreadable', health: null } }
}
