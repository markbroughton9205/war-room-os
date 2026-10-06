import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentOpsLog } from './log'
import { AgentRegistry, type AgentDraft } from './registry'
import { detectNeed } from './need'
import { NEED_CRITERIA, type AgentSpec } from './types'

export { harness } from '@/lib/recursive-learning/testkit'
export const NOW = new Date('2026-10-06T12:00:00.000Z')
export const mins = (n: number) => new Date(NOW.getTime() + n * 60_000)
export const tmp = () => mkdtempSync(path.join(tmpdir(), 'p10-'))
export const freshOps = () => { const dir = tmp(); return { dir, log: new AgentOpsLog(dir), reg: new AgentRegistry(new AgentOpsLog(dir)) } }

export function fullNeed(title = 'Recurring docs freshness checks') {
  return detectNeed({
    title,
    evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: `evidence for ${criterion}`, evidenceRefs: [`ref:${criterion}`] })),
  }, NOW)
}
export const draft = (over: Partial<AgentDraft> = {}): AgentDraft => ({
  name: 'Docs freshness agent', purpose: 'Report stale documentation', specialization: 'documentation_synthesis', riskCeiling: 'low',
  permissionScope: ['read_docs', 'write_own_reports'], memoryScope: ['docs', 'agent_operational'],
  ioContract: { input: 'docs directory listing', output: 'staleness report' }, escalationPath: 'commander', reviewProcess: 'weekly Commander review of reports and failures', ...over,
})
/** Registry with one ACTIVE agent. */
export function activeAgent(over: Partial<AgentDraft> = {}) {
  const o = freshOps()
  const need = fullNeed()
  o.reg.recordNeed(need)
  const spec: AgentSpec = o.reg.propose(need.id, draft(over), NOW)
  o.reg.transition(spec.id, 'APPROVED', 'commander:mark', 'approved', NOW)
  o.reg.transition(spec.id, 'ACTIVE', 'commander:mark', 'activated', NOW)
  return { ...o, spec }
}
