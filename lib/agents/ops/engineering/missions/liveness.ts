import { readFileSync } from 'node:fs'
import { ACTIVE_STATES, type Lease, type MissionRecord } from './types'

/**
 * Dead-run detection, as a pure function of facts (so it is testable without killing processes). A mission in an active state is only believed when ALL hold:
 * a lease exists, its process is alive (same pid AND same start time), the heartbeat is fresh, and the lease belongs to a runner this process actually has.
 * A live process that has not progressed for a long time is STALLED (reported, never silently killed or hidden).
 */
export const HEARTBEAT_MS = 5_000
export const LEASE_MS = 45_000
export const STALL_MS = 12 * 60_000

export type Liveness = { verdict: 'ALIVE' | 'DEAD' | 'STALLED' | 'NOT_ACTIVE'; reason: string }
export type LivenessFacts = { pidAlive: (pid: number, pidStart: string | 'UNKNOWN') => boolean; hasLocalRunner: (missionId: string) => boolean; ownPid: number; now: Date }

export const CREATION_GRACE_MS = 120_000
export function assessLiveness(m: Pick<MissionRecord, 'id' | 'state' | 'lease'> & { stateAt?: string }, f: LivenessFacts): Liveness {
  if (!ACTIVE_STATES.includes(m.state)) return { verdict: 'NOT_ACTIVE', reason: `mission is ${m.state}` }
  const l: Lease | null = m.lease
  // a mission that was just reserved has no worker yet: it is being created, not dead
  if (!l && m.state === 'QUEUED' && m.stateAt && f.now.getTime() - Date.parse(m.stateAt) < CREATION_GRACE_MS) return { verdict: 'ALIVE', reason: 'mission is being created' }
  if (!l) return { verdict: 'DEAD', reason: 'no worker lease is recorded for an active mission' }
  if (!f.pidAlive(l.pid, l.pidStart)) return { verdict: 'DEAD', reason: `worker process ${l.pid} is not running` }
  if (l.pid === f.ownPid && !f.hasLocalRunner(m.id)) return { verdict: 'DEAD', reason: 'this server process has no runner for the mission (the runner ended or was lost)' }
  const beat = f.now.getTime() - Date.parse(l.heartbeatAt)
  if (!(beat <= LEASE_MS)) return { verdict: 'DEAD', reason: `worker heartbeat is ${Math.round(beat / 1000)} s old (lease ${LEASE_MS / 1000} s)` }
  const quiet = f.now.getTime() - Date.parse(l.progressAt)
  if (quiet > STALL_MS) return { verdict: 'STALLED', reason: `alive, but no progress for ${Math.round(quiet / 60000)} min (last: ${l.progressNote})` }
  return { verdict: 'ALIVE', reason: 'worker alive, heartbeat fresh' }
}

/** Process start time from /proc (Linux); 'UNKNOWN' elsewhere. Field 22 of /proc/<pid>/stat, parsed after the closing paren of the command name. */
export function pidStartOf(pid: number): string | 'UNKNOWN' {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const rest = s.slice(s.lastIndexOf(')') + 2).split(' ')
    return rest[19] ?? 'UNKNOWN'
  } catch { return 'UNKNOWN' }
}

export function pidAliveReal(pid: number, pidStart: string | 'UNKNOWN'): boolean {
  try { process.kill(pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false }
  if (pidStart === 'UNKNOWN') return true
  const now = pidStartOf(pid)
  return now === 'UNKNOWN' || now === pidStart
}
