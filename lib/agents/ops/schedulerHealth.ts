import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type SchedulerHealth = { instanceId: string; pid: number; startedAt: string; intervalMs: number; lastTickAt: string | null; lastHeartbeatAt: string | null; busySince: string | null; lastTickRan: number; lastError: string | null }
const file = (dir: string) => path.join(dir, 'scheduler-health.json')

/** Small overwritten file (not part of the audit log): health is what the last tick reported, never inferred from a timer existing. */
export function writeSchedulerHealth(dir: string, h: SchedulerHealth): void {
  const tmp = file(dir) + `.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(h), 'utf8')
  renameSync(tmp, file(dir))
}

export function readSchedulerHealth(dir: string, now: Date = new Date()): { state: 'RUNNING' | 'DEGRADED' | 'STALE' | 'UNKNOWN'; detail: string; health: SchedulerHealth | null } {
  if (!existsSync(file(dir))) return { state: 'UNKNOWN', detail: 'no scheduler has reported for this data root', health: null }
  try {
    const h = JSON.parse(readFileSync(file(dir), 'utf8')) as SchedulerHealth
    const beat = Date.parse(h.lastHeartbeatAt ?? h.lastTickAt ?? '')
    if (!Number.isFinite(beat) || !Number.isFinite(h.intervalMs)) return { state: 'UNKNOWN', detail: h.lastTickAt || h.lastHeartbeatAt ? 'health file has an unexpected shape' : `instance ${h.instanceId} started but has not reported a tick`, health: h }
    const age = now.getTime() - beat
    if (age > h.intervalMs * 3 + 5_000) return { state: 'STALE', detail: `no heartbeat for ${Math.round(age / 1000)}s; scheduler appears stopped (last instance ${h.instanceId})`, health: h }
    if (h.lastError) return { state: 'DEGRADED', detail: `alive (instance ${h.instanceId}) but the last tick failed: ${h.lastError}`, health: h }
    return { state: 'RUNNING', detail: `${h.busySince ? `busy with a scheduled run since ${h.busySince}; ` : ''}heartbeat ${Math.round(age / 1000)}s ago (instance ${h.instanceId})`, health: h }
  } catch { return { state: 'UNKNOWN', detail: 'health file unreadable', health: null } }
}
