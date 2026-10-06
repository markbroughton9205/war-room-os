import type { AgentOpsLog } from './log'
import { AgentRegistry, deriveAgents, type AgentView } from './registry'
import { evaluateAgent, type AgentEvaluation } from './evaluation'
import { deriveWorkers, type WorkerView } from './workers'
import type { AgentOpsRecord, RunRecord } from './types'
import { SCHEDULER_ELIGIBLE, SCHED_MAX_CONCURRENT, deriveScheduler, evaluateDue, schedulabilityProblem } from './scheduler'
import { readSchedulerHealth } from './schedulerHealth'
import path from 'node:path'

export type OpsSnapshot = {
  generatedAt: string
  governance: { note: string; schedulerProcessStart: string; scheduledRunsDefault: 'off'; externalActionsRequireApproval: true }
  totals: { agents: number; activeAgents: number; workers: number; runningWorkers: number; stoppedWorkers: number; runs: number; blockedRuns: number; corruptLines: number; rejectedRecords: number }
  agents: { view: AgentView; evaluation: AgentEvaluation; latestRecommendation: Extract<AgentOpsRecord, { t: 'recommendation' }>['rec'] | null; workerIds: string[] }[]
  needs: { id: string; title: string; detectedAt: string; hasAgent: boolean }[]
  workers: { view: WorkerView; agentState: string; runsToday: number; lastRun: RunRecord | null; lastMeaningfulProgress: string | 'NO EVIDENCE'; health: 'RUNNING' | 'STOPPED' | 'TRIPPED' | 'AGENT_NOT_ACTIVE' | 'IDLE' }[]
  recentRuns: RunRecord[]
  pendingApprovals: { kind: 'agent_proposal' | 'adaptation' | 'blocked_effect' | 'recommendation'; ref: string; summary: string; payload?: Record<string, unknown> }[]
  errors: { runId: string; workerId: string; at: string; message: string; recovery: string }[]
  scheduler: {
    globalEnabled: boolean
    globalReason: string
    envOff: boolean
    health: { state: 'RUNNING' | 'DEGRADED' | 'STALE' | 'UNKNOWN'; detail: string }
    eligibleCategories: readonly string[]
    maxConcurrent: number
    workers: { workerId: string; schedulable: boolean; schedulableProblem: string | null; enabled: boolean; cadenceMinutes: number | null; nextEligibleAt: string | 'UNKNOWN'; dueSince: string | null; willRunNext: boolean; lastAutomaticRunAt: string | 'NONE'; lastClaimAt: string | 'NONE'; lastDecision: string | 'NONE'; lastSkipReason: string | 'NONE'; lastClaimId: string | 'NONE'; dueNow: boolean }[]
  }
  resourceUsage: { workerId: string; runs: number; totalDurationMs: number; costUsd: number | 'UNKNOWN' }[]
}

export function buildOpsSnapshot(log: AgentOpsLog, now: Date = new Date(), opts: { runLimit?: number } = {}): OpsSnapshot {
  const v = log.view()
  const { agents, needs, rejectedTransitions } = deriveAgents(log)
  const { workers } = deriveWorkers(log)
  const latestRec = new Map<string, Extract<AgentOpsRecord, { t: 'recommendation' }>['rec']>()
  for (const r of v.records) if (r.t === 'recommendation') latestRec.set(r.rec.agentId, r.rec)
  const decided = new Set(v.records.filter((r) => r.t === 'decision').map((r) => (r as Extract<AgentOpsRecord, { t: 'decision' }>).proposalId))
  const allRuns = [...workers.values()].flatMap((w) => w.runs).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const today = now.toISOString().slice(0, 10)
  const agentRows = [...agents.values()].map((view) => ({ view, evaluation: evaluateAgent(log, view.spec.id, now), latestRecommendation: latestRec.get(view.spec.id) ?? null, workerIds: [...workers.values()].filter((w) => w.spec.agentId === view.spec.id).map((w) => w.spec.id) }))
  const workerRows = [...workers.values()].map((view) => {
    const agent = agents.get(view.spec.agentId)
    const last = [...view.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null
    const progress = [...view.runs].filter((r) => r.status === 'SUCCEEDED' && r.outputs.length > 0).sort((a, b) => Date.parse(b.endedAt ?? b.startedAt) - Date.parse(a.endedAt ?? a.startedAt))[0]
    const health: OpsSnapshot['workers'][number]['health'] = view.running ? 'RUNNING' : view.stopped ? 'STOPPED' : view.consecutiveFailures >= view.spec.limits.maxConsecutiveFailures ? 'TRIPPED' : agent?.state !== 'ACTIVE' ? 'AGENT_NOT_ACTIVE' : 'IDLE'
    return { view, agentState: agent?.state ?? 'UNKNOWN', runsToday: view.runs.filter((r) => r.startedAt.slice(0, 10) === today).length, lastRun: last, lastMeaningfulProgress: progress ? (progress.endedAt ?? progress.startedAt) : ('NO EVIDENCE' as const), health }
  })
  const pending: OpsSnapshot['pendingApprovals'] = []
  for (const a of agents.values()) if (a.state === 'PROPOSED') pending.push({ kind: 'agent_proposal', ref: a.spec.id, summary: `${a.spec.name} (${a.spec.specialization}) awaits Commander approval` })
  for (const r of v.records) if (r.t === 'adaptation' && !decided.has(r.proposal.id)) pending.push({ kind: 'adaptation', ref: r.proposal.id, summary: `${r.proposal.kind}: ${r.proposal.summary}`, payload: { proposalId: r.proposal.id } })
  const approvalsFor = v.records.filter((r): r is Extract<AgentOpsRecord, { t: 'effectApproval' }> => r.t === 'effectApproval')
  for (const run of allRuns.slice(0, 50)) {
    if (run.status !== 'BLOCKED') continue
    const answered = approvalsFor.some((a) => a.workerId === run.workerId && Date.parse(a.at) >= Date.parse(run.startedAt)) || allRuns.some((r2) => r2.workerId === run.workerId && r2.status === 'SUCCEEDED' && Date.parse(r2.startedAt) > Date.parse(run.startedAt))
    if (!answered) pending.push({ kind: 'blocked_effect', ref: run.runId, summary: `${run.workerId} blocked on ${run.requestedEffects.join(', ')}`, payload: { workerId: run.workerId, effects: [...new Set(run.requestedEffects)] } })
  }
  for (const [agentId, rec] of latestRec) if (rec.action !== 'none') pending.push({ kind: 'recommendation', ref: rec.id, summary: `${agentId}: ${rec.action} (${rec.reasons.join('; ')})` })
  const usage = workerRows.map((w) => {
    const costs = w.view.runs.map((r) => r.resource.costUsd)
    return { workerId: w.view.spec.id, runs: w.view.runs.length, totalDurationMs: w.view.runs.reduce((a, r) => a + (r.resource.durationMs ?? 0), 0), costUsd: (costs.length && costs.every((c) => typeof c === 'number') ? (costs as number[]).reduce((a, b) => a + b, 0) : 'UNKNOWN') as number | 'UNKNOWN' }
  })
  const sched = deriveScheduler(log)
  const runningScheduled = workerRows.reduce((n, w) => n + w.view.runs.filter((r) => r.status === 'RUNNING').length, 0)
  const envOff = process.env.WAR_ROOM_AGENT_SCHEDULER === 'off'
  const scheduler0Enabled = !envOff && sched.global?.enabled === true
  const scheduler: OpsSnapshot['scheduler'] = {
    globalEnabled: scheduler0Enabled,
    globalReason: envOff ? 'disabled by environment (WAR_ROOM_AGENT_SCHEDULER=off)' : sched.global ? `${sched.global.enabled ? 'enabled' : 'paused'} by ${sched.global.by}: ${sched.global.reason}` : 'never enabled (default: off)',
    envOff,
    health: (() => { const h = readSchedulerHealth(path.dirname(log.file), now); return { state: h.state, detail: h.detail } })(),
    eligibleCategories: SCHEDULER_ELIGIBLE,
    maxConcurrent: SCHED_MAX_CONCURRENT,
    workers: workerRows.map((w) => {
      const sc = sched.schedules.get(w.view.spec.id)
      const ev = evaluateDue(w.view, sc, sched.lastClaim.get(w.view.spec.id)?.at, agents.get(w.view.spec.agentId)?.state, runningScheduled, now)
      const ld = sched.lastDecision.get(w.view.spec.id)
      const sk = sched.lastSkip.get(w.view.spec.id)
      return { workerId: w.view.spec.id, schedulable: schedulabilityProblem(w.view) === null, schedulableProblem: schedulabilityProblem(w.view), enabled: sc?.enabled === true, cadenceMinutes: sc ? sc.cadenceMinutes : null, nextEligibleAt: sc?.enabled ? (ev.action === 'RUN' ? ev.dueAt.toISOString() : ev.nextEligibleAt ? ev.nextEligibleAt.toISOString() : 'UNKNOWN') : 'UNKNOWN', dueSince: sc?.enabled && ev.action === 'RUN' ? ev.dueAt.toISOString() : null, willRunNext: scheduler0Enabled && ev.action === 'RUN', lastAutomaticRunAt: ([...w.view.runs].filter((r) => r.origin === 'scheduled').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]?.startedAt) ?? 'NONE', lastClaimAt: sched.lastClaim.get(w.view.spec.id)?.at ?? 'NONE', lastDecision: ld ? `${ld.decision} ${ld.reason} @ ${ld.at.slice(0, 19)}Z` : 'NONE', lastSkipReason: sk ? `${sk.reason} @ ${sk.at.slice(0, 19)}Z` : 'NONE', lastClaimId: sched.lastClaim.get(w.view.spec.id)?.claimId ?? 'NONE', dueNow: ev.action === 'RUN' }
    }),
  }
  return {
    generatedAt: now.toISOString(),
    governance: { note: 'Read model of durable agent-foundry state. Recommendations are advisory; risky actions need Commander approval; background runs happen only for Commander-scheduled read-only workers.', schedulerProcessStart: 'instrumentation hook starts the scheduler process unless WAR_ROOM_AGENT_SCHEDULER=off; no run happens unless a Commander enabled scheduling', scheduledRunsDefault: 'off', externalActionsRequireApproval: true },
    totals: { agents: agents.size, activeAgents: [...agents.values()].filter((a) => a.state === 'ACTIVE').length, workers: workers.size, runningWorkers: workerRows.filter((w) => w.health === 'RUNNING').length, stoppedWorkers: workerRows.filter((w) => w.health === 'STOPPED').length, runs: allRuns.length, blockedRuns: allRuns.filter((r) => r.status === 'BLOCKED').length, corruptLines: v.corruptLines, rejectedRecords: rejectedTransitions },
    agents: agentRows,
    needs: [...needs.values()].map((n) => ({ id: n.id, title: n.title, detectedAt: n.detectedAt, hasAgent: [...agents.values()].some((a) => a.spec.needId === n.id) })),
    workers: workerRows,
    recentRuns: allRuns.slice(0, opts.runLimit ?? 30),
    pendingApprovals: pending,
    errors: allRuns.filter((r) => r.errors.length > 0).slice(0, 20).flatMap((r) => r.errors.map((e) => ({ runId: r.runId, workerId: r.workerId, at: r.endedAt ?? r.startedAt, message: e.message, recovery: e.recovery }))),
    scheduler,
    resourceUsage: usage,
  }
}
export { AgentRegistry }
