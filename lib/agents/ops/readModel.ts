import type { AgentOpsLog } from './log'
import { AgentRegistry, deriveAgents, type AgentView } from './registry'
import { evaluateAgent, type AgentEvaluation } from './evaluation'
import { deriveWorkers, type WorkerView } from './workers'
import type { AgentOpsRecord, RunRecord } from './types'

export type OpsSnapshot = {
  generatedAt: string
  governance: { note: string; autoStartOnBoot: false; externalActionsRequireApproval: true }
  totals: { agents: number; activeAgents: number; workers: number; runningWorkers: number; stoppedWorkers: number; runs: number; blockedRuns: number; corruptLines: number; rejectedRecords: number }
  agents: { view: AgentView; evaluation: AgentEvaluation; latestRecommendation: Extract<AgentOpsRecord, { t: 'recommendation' }>['rec'] | null; workerIds: string[] }[]
  needs: { id: string; title: string; detectedAt: string; hasAgent: boolean }[]
  workers: { view: WorkerView; agentState: string; runsToday: number; lastRun: RunRecord | null; lastMeaningfulProgress: string | 'NO EVIDENCE'; health: 'RUNNING' | 'STOPPED' | 'TRIPPED' | 'AGENT_NOT_ACTIVE' | 'IDLE' }[]
  recentRuns: RunRecord[]
  pendingApprovals: { kind: 'agent_proposal' | 'adaptation' | 'blocked_effect' | 'recommendation'; ref: string; summary: string }[]
  errors: { runId: string; workerId: string; at: string; message: string; recovery: string }[]
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
  for (const r of v.records) if (r.t === 'adaptation' && !decided.has(r.proposal.id)) pending.push({ kind: 'adaptation', ref: r.proposal.id, summary: `${r.proposal.kind}: ${r.proposal.summary}` })
  for (const run of allRuns.slice(0, 50)) if (run.status === 'BLOCKED') pending.push({ kind: 'blocked_effect', ref: run.runId, summary: `${run.workerId} blocked on ${run.requestedEffects.join(', ')}` })
  for (const [agentId, rec] of latestRec) if (rec.action !== 'none') pending.push({ kind: 'recommendation', ref: rec.id, summary: `${agentId}: ${rec.action} (${rec.reasons.join('; ')})` })
  const usage = workerRows.map((w) => {
    const costs = w.view.runs.map((r) => r.resource.costUsd)
    return { workerId: w.view.spec.id, runs: w.view.runs.length, totalDurationMs: w.view.runs.reduce((a, r) => a + (r.resource.durationMs ?? 0), 0), costUsd: (costs.length && costs.every((c) => typeof c === 'number') ? (costs as number[]).reduce((a, b) => a + b, 0) : 'UNKNOWN') as number | 'UNKNOWN' }
  })
  return {
    generatedAt: now.toISOString(),
    governance: { note: 'Read model of durable agent-foundry state. Recommendations are advisory; risky actions need Commander approval; nothing runs at boot.', autoStartOnBoot: false, externalActionsRequireApproval: true },
    totals: { agents: agents.size, activeAgents: [...agents.values()].filter((a) => a.state === 'ACTIVE').length, workers: workers.size, runningWorkers: workerRows.filter((w) => w.health === 'RUNNING').length, stoppedWorkers: workerRows.filter((w) => w.health === 'STOPPED').length, runs: allRuns.length, blockedRuns: allRuns.filter((r) => r.status === 'BLOCKED').length, corruptLines: v.corruptLines, rejectedRecords: rejectedTransitions },
    agents: agentRows,
    needs: [...needs.values()].map((n) => ({ id: n.id, title: n.title, detectedAt: n.detectedAt, hasAgent: [...agents.values()].some((a) => a.spec.needId === n.id) })),
    workers: workerRows,
    recentRuns: allRuns.slice(0, opts.runLimit ?? 30),
    pendingApprovals: pending,
    errors: allRuns.filter((r) => r.errors.length > 0).slice(0, 20).flatMap((r) => r.errors.map((e) => ({ runId: r.runId, workerId: r.workerId, at: r.endedAt ?? r.startedAt, message: e.message, recovery: e.recovery }))),
    resourceUsage: usage,
  }
}
export { AgentRegistry }
