/** Child process for the cross-process race test (not a validator). */
import { AgentOpsLog } from './log'
import { executeWorker } from './workers'

const [dir, workerId, approvalRid, barrier, tag] = process.argv.slice(2)
while (Date.now() < Number(barrier)) { /* spin until the shared start instant */ }
const res = await executeWorker(new AgentOpsLog(dir), workerId, async (ctx) => {
  await new Promise((r) => setTimeout(r, 300))
  try { ctx.requestEffect('spend'); return { outputs: [{ kind: 'k', ref: tag, summary: 'SPENT' }] } } catch { return {} }
}, { approvalRid: approvalRid || undefined, runId: `race-${tag}` })
console.log(JSON.stringify({ tag, ok: res.ok, reason: res.ok ? null : res.reason, status: res.ok ? res.run.status : null }))
