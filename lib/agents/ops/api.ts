import { AdaptationError, applyApprovedScopeChange, decideAdaptation, proposeAdaptation } from './adaptation'
import { BUILTIN_RUNNERS } from './builtinWorkers'
import { FeedbackError, evaluateAgent, recommendForAgent, recordFeedback } from './evaluation'
import { AgentTransitionError, isCommander } from './lifecycle'
import { SchedulerError, setSchedule, setSchedulerGlobal } from './scheduler'
import type { AgentOpsLog } from './log'
import { detectNeed } from './need'
import { buildOpsSnapshot } from './readModel'
import { AgentRegistry, NeedGateError, deriveAgents } from './registry'
import { WorkerError, approveEffect, deriveWorkers, executeWorker, recoverInterruptedRuns, registerWorker, resumeWorker, stopWorker } from './workers'
import type { AgentState } from './types'

export const READ_SECTIONS = ['summary', 'agents', 'workers', 'runs', 'approvals', 'evaluations', 'errors', 'run'] as const
type ApiResult = { status: number; body: unknown }

/** Pure read handler. Opens nothing for writing; never mutates. */
export function handleOpsRead(url: URL, log: AgentOpsLog, now: Date = new Date()): ApiResult {
  const section = url.searchParams.get('section') ?? 'summary'
  if (!(READ_SECTIONS as readonly string[]).includes(section)) return { status: 400, body: { error: 'unknown section', sections: READ_SECTIONS } }
  const snap = buildOpsSnapshot(log, now, { runLimit: Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 200) })
  const env = (data: unknown) => ({ status: 200, body: { generatedAt: snap.generatedAt, totals: snap.totals, governance: snap.governance, data } })
  switch (section) {
    case 'summary': return env(snap)
    case 'agents': return env(snap.agents)
    case 'workers': return env(snap.workers)
    case 'runs': return env(snap.recentRuns)
    case 'approvals': return env(snap.pendingApprovals)
    case 'evaluations': return env(snap.agents.map((a) => ({ agentId: a.view.spec.id, evaluation: a.evaluation, latestRecommendation: a.latestRecommendation })))
    case 'errors': return env(snap.errors)
    default: {
      const id = url.searchParams.get('id') ?? ''
      const run = snap.recentRuns.find((r) => r.runId === id) ?? [...deriveWorkers(log).workers.values()].flatMap((w) => w.runs).find((r) => r.runId === id)
      return run ? { status: 200, body: { readOnly: true, run } } : { status: 404, body: { error: 'unknown run', id } }
    }
  }
}

/** Commander actor from an authenticated session user id. The request body can never supply the actor. */
export function commanderActor(userId: string | null | undefined): string | null {
  const clean = String(userId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)
  return clean ? `commander:${clean}` : null
}

export const CONTROL_ACTIONS = ['detectNeed', 'proposeAgent', 'transitionAgent', 'registerWorker', 'stopWorker', 'resumeWorker', 'approveEffect', 'runWorker', 'proposeAdaptation', 'decideAdaptation', 'applyScopeChange', 'recordFeedback', 'evaluateAgent', 'recoverRuns', 'setSchedule', 'setSchedulerGlobal'] as const

type Body = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** Commander control surface. `actor` MUST come from the authenticated session. Typed errors map to 4xx; nothing partial is written on refusal. */
export async function handleOpsControl(body: Body, actor: string | null, log: AgentOpsLog, now: Date = new Date()): Promise<ApiResult> {
  if (!actor || !isCommander(actor)) return { status: 403, body: { error: 'Commander session required', code: 'NOT_AUTHORIZED' } }
  if (JSON.stringify(body).length > 65_536) return { status: 413, body: { error: 'request too large', code: 'TOO_LARGE' } }
  const action = s(body.action)
  if (!(CONTROL_ACTIONS as readonly string[]).includes(action)) return { status: 400, body: { error: 'unknown action', actions: CONTROL_ACTIONS } }
  const reg = new AgentRegistry(log)
  try {
    switch (action) {
      case 'detectNeed': { const need = detectNeed({ title: s(body.title), evidence: (body.evidence as never) ?? [] }, now); reg.recordNeed(need); return { status: 201, body: { need } } }
      case 'proposeAgent': return { status: 201, body: { agent: reg.propose(s(body.needId), body.draft as never, now) } }
      case 'transitionAgent': { const v = reg.transition(s(body.agentId), s(body.to) as AgentState, actor, s(body.reason), now); return { status: 200, body: { agent: { id: v.spec.id, state: v.state } } } }
      case 'registerWorker': return { status: 201, body: { worker: registerWorker(log, body.draft as never, actor, now) } }
      case 'stopWorker': stopWorker(log, s(body.workerId), actor, s(body.reason), now); return { status: 200, body: { stopped: true } }
      case 'resumeWorker': resumeWorker(log, s(body.workerId), actor, s(body.reason), now); return { status: 200, body: { resumed: true } }
      case 'approveEffect': return { status: 201, body: { approval: approveEffect(log, s(body.workerId), (body.effects as never) ?? [], actor, s(body.reason), now) } }
      case 'runWorker': {
        const w = deriveWorkers(log).workers.get(s(body.workerId))
        if (!w) return { status: 404, body: { error: 'unknown worker' } }
        const runner = BUILTIN_RUNNERS[w.spec.category]
        if (!runner) return { status: 409, body: { error: `no built-in runner for category ${w.spec.category}`, code: 'NO_RUNNER' } }
        const res = await executeWorker(log, w.spec.id, runner, { now, approvalRid: s(body.approvalRid) || undefined })
        return res.ok ? { status: 200, body: { run: res.run } } : { status: 409, body: { error: res.detail, code: res.reason } }
      }
      case 'proposeAdaptation': return { status: 201, body: { proposal: proposeAdaptation(log, s(body.agentId), body.proposal as never, now) } }
      case 'decideAdaptation': decideAdaptation(log, s(body.proposalId), s(body.status) as 'APPROVED', actor, s(body.reason), now); return { status: 200, body: { decided: true } }
      case 'applyScopeChange': { const v = applyApprovedScopeChange(log, s(body.proposalId), actor, now); return { status: 200, body: { agent: { id: v.spec.id, version: v.spec.version } } } }
      case 'recordFeedback': recordFeedback(log, s(body.runId), s(body.verdict) as 'accepted', actor, s(body.note), { usefulEscalation: typeof body.usefulEscalation === 'boolean' ? body.usefulEscalation : undefined }, now); return { status: 201, body: { recorded: true } }
      case 'evaluateAgent': {
        const id = s(body.agentId)
        if (!deriveAgents(log).agents.has(id)) return { status: 404, body: { error: 'unknown agent' } }
        return { status: 200, body: { evaluation: evaluateAgent(log, id, now), recommendation: recommendForAgent(log, id, now, { persist: body.persist === true, flagForReview: body.flagForReview === true }) } }
      }
      case 'setSchedule': { const rec = setSchedule(log, s(body.workerId), { enabled: body.enabled === true, cadenceMinutes: Number(body.cadenceMinutes) }, actor, s(body.reason) || 'Commander schedule change', now); return { status: 200, body: { schedule: { workerId: s(body.workerId), enabled: body.enabled === true, rid: rec.rid } } } }
      case 'setSchedulerGlobal': setSchedulerGlobal(log, body.enabled === true, actor, s(body.reason) || (body.enabled === true ? 'Commander resumed scheduling' : 'Commander paused scheduling'), now); return { status: 200, body: { schedulerEnabled: body.enabled === true } }
      default: return { status: 200, body: { interrupted: recoverInterruptedRuns(log, now) } }
    }
  } catch (err) {
    if (err instanceof AgentTransitionError) return { status: err.code === 'ACTOR_NOT_AUTHORIZED' ? 403 : 409, body: { error: err.message, code: err.code } }
    if (err instanceof NeedGateError) return { status: 422, body: { error: err.message, code: 'NEED_GATE', missing: err.missing } }
    if (err instanceof AdaptationError || err instanceof WorkerError) return { status: err.code === 'NOT_AUTHORIZED' ? 403 : 400, body: { error: err.message, code: err.code } }
    if (err instanceof SchedulerError) return { status: err.code === 'NOT_AUTHORIZED' ? 403 : err.code === 'NOT_ELIGIBLE' ? 409 : 400, body: { error: err.message, code: err.code } }
    if (err instanceof FeedbackError) return { status: 400, body: { error: err.message, code: 'FEEDBACK' } }
    return { status: 400, body: { error: err instanceof Error ? err.message.slice(0, 200) : 'invalid request', code: 'INVALID' } }
  }
}
