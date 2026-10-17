import { AgentOpsLog } from '../../log'
import { reconcileMissions } from './reconcile'
import { MissionStore } from './store'

const KEY = Symbol.for('war-room.engineering-missions.supervisor')
/** Boot-time and periodic dead-run reconciliation. A mission whose worker died with a previous server process becomes INTERRUPTED within seconds of the next start. */
export function startMissionSupervisor(opts: { dir?: string; intervalMs?: number } = {}): { stop: () => void } | null {
  if (process.env.WAR_ROOM_ENG_SUPERVISOR === 'off') return null
  const g = globalThis as unknown as Record<symbol, { stop: () => void } | undefined>
  if (g[KEY]) return g[KEY]!
  let log: AgentOpsLog
  try { log = new AgentOpsLog(opts.dir) } catch { return null }
  const store = new MissionStore(log)
  const run = () => {
    try { reconcileMissions(log, store, undefined, 'system:supervisor') } catch { /* never throws into the server */ }
    // the autonomous controller continues commands that were in flight (recovery after a restart, retries, the next step); it never throws into the server either
    void import('../autonomy/service').then((m) => m.autonomyController().advance()).catch(() => undefined)
  }
  const first = setTimeout(run, 1000); first.unref?.()
  const t = setInterval(run, Math.min(Math.max(opts.intervalMs ?? 10_000, 1000), 120_000)); t.unref?.()
  const h = { stop: () => { clearTimeout(first); clearInterval(t); delete g[KEY] } }
  g[KEY] = h
  return h
}
