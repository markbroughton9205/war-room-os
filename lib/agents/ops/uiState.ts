import type { AgentState } from './types'
import type { OpsSnapshot } from './readModel'

/** Pure view-model for the Agent Foundry operator surface. Unknown stays UNKNOWN; every control maps to a Commander-gated API action. */
export type OpsEnvelope = { generatedAt: string; totals: OpsSnapshot['totals']; governance: OpsSnapshot['governance']; data: OpsSnapshot }
export type LoadState<T> = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: T }

export type Control = { label: string; action: string; payload: Record<string, unknown>; confirm?: boolean }
export const pct = (v: number | 'UNKNOWN') => (v === 'UNKNOWN' ? 'UNKNOWN' : `${(v * 100).toFixed(0)}%`)
const ms = (v: number | 'UNKNOWN') => (v === 'UNKNOWN' ? 'UNKNOWN' : `${Math.round(v)}ms`)
const usd = (v: number | 'UNKNOWN') => (v === 'UNKNOWN' ? 'UNKNOWN' : `$${v.toFixed(4)}`)

const AGENT_CONTROLS: Record<AgentState, { to: AgentState; label: string; confirm?: boolean }[]> = {
  PROPOSED: [{ to: 'APPROVED', label: 'Approve' }, { to: 'REJECTED', label: 'Reject', confirm: true }],
  APPROVED: [{ to: 'ACTIVE', label: 'Activate' }, { to: 'RETIRED', label: 'Retire', confirm: true }],
  ACTIVE: [{ to: 'PAUSED', label: 'Pause' }, { to: 'UNDER_REVIEW', label: 'Mark under review' }, { to: 'RETIRED', label: 'Retire', confirm: true }],
  PAUSED: [{ to: 'ACTIVE', label: 'Resume' }, { to: 'RETIRED', label: 'Retire', confirm: true }],
  UNDER_REVIEW: [{ to: 'ACTIVE', label: 'Return to active' }, { to: 'PAUSED', label: 'Pause' }, { to: 'RETIRED', label: 'Retire', confirm: true }],
  RETIRED: [],
  REJECTED: [],
}

export type AgentRow = { id: string; title: string; detail: string; evaluation: string; recommendation: string; flags: string[]; controls: Control[] }
export type WorkerRow = { id: string; title: string; detail: string; limits: string; flags: string[]; controls: Control[] }

export function buildOpsViewModel(env: OpsEnvelope) {
  const s = env.data
  const agents: AgentRow[] = s.agents.map((a) => {
    const d = a.evaluation.dimensions
    return {
      id: a.view.spec.id,
      title: `${a.view.spec.name} · ${a.view.spec.specialization}`,
      detail: `${a.view.state} · v${a.view.spec.version} · risk ceiling ${a.view.spec.riskCeiling} · scope ${a.view.spec.permissionScope.join(', ')} · memory ${a.view.spec.memoryScope.join(', ')}`,
      evaluation: `${a.evaluation.runs.total} run(s): success ${pct(d.taskSuccessRate)}, failure ${pct(d.failureRate)}, Commander correction ${pct(d.commanderCorrectionRate)}, latency ${ms(d.meanLatencyMs)}, cost ${usd(d.meanCostUsd)}, audit completeness ${pct(d.auditCompleteness)}, memory quality ${d.memoryQuality}, workload reduction ${d.operatorWorkloadReduction}`,
      recommendation: a.latestRecommendation ? `${a.latestRecommendation.action} (advisory, not applied): ${a.latestRecommendation.reasons.join('; ')}` : 'no recommendation recorded',
      flags: [...(a.view.state === 'UNDER_REVIEW' ? ['under review: not accepting work'] : []), ...(a.evaluation.runs.terminal < 10 ? ['thin evidence'] : [])],
      controls: AGENT_CONTROLS[a.view.state].map((c) => ({ label: c.label, action: 'transitionAgent', payload: { agentId: a.view.spec.id, to: c.to, reason: `Commander: ${c.label}` }, confirm: c.confirm })),
    }
  })
  const workers: WorkerRow[] = s.workers.map((w) => ({
    id: w.view.spec.id,
    title: `${w.view.spec.id} · ${w.view.spec.category} · v${w.view.spec.version}`,
    detail: `${w.health} · agent ${w.agentState} · last progress ${w.lastMeaningfulProgress} · runs today ${w.runsToday}/${w.view.spec.limits.maxRunsPerDay} · consecutive failures ${w.view.consecutiveFailures}/${w.view.spec.limits.maxConsecutiveFailures} · mission: ${w.view.spec.mission}`,
    limits: `max runtime ${w.view.spec.limits.maxRuntimeMs}ms · scope ${w.view.spec.permissionScope.join(', ')} · memory ${w.view.spec.memoryScope.join(', ')} · pre-approved effects ${w.view.spec.preApprovedEffects.join(', ') || 'none'}`,
    flags: [...(w.health === 'STOPPED' ? [`stopped: ${w.view.stopReason ?? ''}`] : []), ...(w.health === 'TRIPPED' ? ['tripped after repeated failures: Commander resume required'] : [])],
    controls: [
      ...(w.health === 'IDLE' ? [{ label: 'Run now', action: 'runWorker', payload: { workerId: w.view.spec.id } }] : []),
      ...(w.health !== 'STOPPED' ? [{ label: 'Stop', action: 'stopWorker', payload: { workerId: w.view.spec.id, reason: 'Commander stop' } }] : [{ label: 'Resume', action: 'resumeWorker', payload: { workerId: w.view.spec.id, reason: 'Commander resume' } }]),
    ],
  }))
  return {
    header: `${s.totals.agents} agent(s) (${s.totals.activeAgents} active) · ${s.totals.workers} worker(s) (${s.totals.runningWorkers} running, ${s.totals.stoppedWorkers} stopped) · ${s.totals.runs} run(s) · ${s.totals.blockedRuns} blocked`,
    banner: s.governance.note,
    sections: {
      agents: { title: 'Agents', empty: 'No agents yet. An agent is proposed only when all seven roadmap criteria of a recorded need are evidenced.', rows: agents },
      workers: { title: 'Long-lived workers', empty: 'No workers registered. Nothing runs in the background; workers run only when a Commander triggers them.', rows: workers },
      approvals: { title: 'Pending approvals', empty: 'Nothing awaits Commander approval.', rows: s.pendingApprovals.map((p) => ({ id: `${p.kind}:${p.ref}`, title: p.kind.replace('_', ' '), detail: p.summary })) },
      runs: { title: 'Recent actions', empty: 'No worker runs recorded.', rows: s.recentRuns.map((r) => ({ id: r.runId, title: `${r.workerId} · ${r.status} · ${r.startedAt.slice(0, 19)}Z`, detail: `tools ${r.toolsUsed.join(', ') || 'none'} · outputs ${r.outputs.length} · escalations ${r.escalations.length} · errors ${r.errors.length} · executor ${r.executor === 'UNKNOWN' ? 'UNKNOWN' : `${r.executor.provider}/${r.executor.model}`} · duration ${ms(r.resource.durationMs ?? 'UNKNOWN')} · cost ${usd(typeof r.resource.costUsd === 'number' ? r.resource.costUsd : 'UNKNOWN')}`, outputs: r.outputs.map((o) => `${o.kind}: ${o.summary}`) })) },
      errors: { title: 'Errors and recovery', empty: 'No errors recorded.', rows: s.errors.map((e) => ({ id: `${e.runId}:${e.message}`, title: `${e.workerId} @ ${e.at.slice(0, 19)}Z`, detail: `${e.message} — recovery: ${e.recovery}` })) },
      usage: { title: 'Resource usage', empty: 'No usage recorded.', rows: s.resourceUsage.map((u) => ({ id: u.workerId, title: u.workerId, detail: `${u.runs} run(s) · ${u.totalDurationMs}ms total · cost ${usd(u.costUsd)}` })) },
    },
  }
}
