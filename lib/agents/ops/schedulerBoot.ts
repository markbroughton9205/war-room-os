import path from 'node:path'
import { AgentOpsLog } from './log'
import { newInstanceId, schedulerTick } from './scheduler'
import { writeSchedulerHealth, type SchedulerHealth } from './schedulerHealth'
import { recoverInterruptedRuns } from './workers'

const KEY = Symbol.for('war-room.agent-ops.scheduler')
type Handle = { instanceId: string; stop: () => void }

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/**
 * Agent Foundry scheduler lifecycle. Separate from Foundry mission startup/recovery: it imports no mission code and never
 * touches mission records. Singleton per process; failure-safe; timers are unref'd so they never keep a process alive.
 * Start order: (1) recover unfinished Agent Ops runs, (2) bounded ticks.
 */
export function startAgentScheduler(opts: { dir?: string; intervalMs?: number; startupDelayMs?: number } = {}): Handle | null {
  if (process.env.WAR_ROOM_AGENT_SCHEDULER === 'off') return null
  const g = globalThis as unknown as Record<symbol, Handle | undefined>
  if (g[KEY]) return g[KEY]!
  const intervalMs = clamp(opts.intervalMs ?? (Number(process.env.WAR_ROOM_AGENT_SCHEDULER_INTERVAL_MS) || 30_000), 2_000, 300_000)
  const startupDelayMs = clamp(opts.startupDelayMs ?? (Number(process.env.WAR_ROOM_AGENT_SCHEDULER_STARTUP_DELAY_MS) || 15_000), 0, 120_000)
  const instanceId = newInstanceId()
  let log: AgentOpsLog
  try { log = new AgentOpsLog(opts.dir) } catch { return null }
  const dir = path.dirname(log.file)
  const health: SchedulerHealth = { instanceId, pid: process.pid, startedAt: new Date().toISOString(), intervalMs, lastTickAt: null, lastHeartbeatAt: null, busySince: null, lastTickRan: 0, lastError: null }
  let busy = false
  const report = () => { health.lastHeartbeatAt = new Date().toISOString(); try { writeSchedulerHealth(dir, health) } catch { /* health is best effort */ } }
  const tick = async () => {
    if (busy) return
    busy = true
    health.busySince = new Date().toISOString()
    report()
    try {
      recoverInterruptedRuns(log, new Date())
      const r = await schedulerTick(log, { instanceId })
      health.lastTickAt = r.at
      health.lastTickRan = r.ran.length
      health.lastError = null
    } catch (err) {
      health.lastTickAt = new Date().toISOString()
      health.lastError = (err instanceof Error ? err.message : 'tick failed').slice(0, 200)
    } finally { busy = false; health.busySince = null; report() }
  }
  report()
  let interval: ReturnType<typeof setInterval> | undefined
  const first = setTimeout(() => { void tick(); interval = setInterval(() => void tick(), intervalMs); interval.unref?.() }, startupDelayMs)
  first.unref?.()
  // heartbeat is independent of ticking so a long scheduled run does not make a live scheduler look stopped
  const beat = setInterval(report, clamp(Math.floor(intervalMs / 2), 1_000, 15_000))
  beat.unref?.()
  const handle: Handle = { instanceId, stop: () => { clearTimeout(first); if (interval) clearInterval(interval); clearInterval(beat); delete g[KEY] } }
  g[KEY] = handle
  return handle
}
