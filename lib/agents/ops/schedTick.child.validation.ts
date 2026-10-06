/** Child process for the scheduler cross-process race test (not a validator). */
import { AgentOpsLog } from './log'
import { schedulerTick } from './scheduler'

const [dir, tag, barrier, nowIso] = process.argv.slice(2)
while (Date.now() < Number(barrier)) { /* spin until the shared start instant */ }
const r = await schedulerTick(new AgentOpsLog(dir), {
  now: new Date(nowIso), instanceId: `scheduler-child-${tag}`,
  runners: { documentation_freshness: async () => { await new Promise((res) => setTimeout(res, 400)); return { outputs: [{ kind: 'k', ref: tag, summary: 'ran' }] } } },
})
console.log(JSON.stringify({ tag, ran: r.ran.length, skipped: r.skipped.map((x) => x.reason) }))
