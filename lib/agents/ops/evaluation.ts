import { randomUUID } from 'node:crypto'
import type { AgentOpsLog } from './log'
import { isCommander } from './lifecycle'
import { deriveAgents, AgentRegistry } from './registry'
import { auditCompleteness, deriveWorkers } from './workers'
import type { Actor, Recommendation, RunRecord, Unknown } from './types'

export class FeedbackError extends Error { constructor(msg: string) { super(msg) } }

export function recordFeedback(log: AgentOpsLog, runId: string, verdict: 'accepted' | 'corrected' | 'rejected', by: Actor, note: string, opts: { usefulEscalation?: boolean } = {}, now: Date = new Date()) {
  if (!isCommander(by)) throw new FeedbackError('feedback requires a Commander')
  if (!['accepted', 'corrected', 'rejected'].includes(verdict)) throw new FeedbackError('unknown verdict')
  const run = [...deriveWorkers(log).workers.values()].flatMap((w) => w.runs).find((r) => r.runId === runId)
  if (!run) throw new FeedbackError(`unknown run: ${runId}`)
  if (run.status === 'RUNNING') throw new FeedbackError('run has not finished')
  return log.append({ t: 'feedback', runId, verdict, usefulEscalation: opts.usefulEscalation, by, at: now.toISOString(), note: note.slice(0, 300) })
}

export const MIN_TERMINAL_RUNS = 10
export const MIN_REVIEWED_RUNS = 5

export type Dim<T = number> = T | Unknown
export type AgentEvaluation = {
  agentId: string
  generatedAt: string
  runs: { total: number; terminal: number; succeeded: number; failed: number; blocked: number; stopped: number; interrupted: number }
  reviewedRuns: number
  dimensions: {
    taskSuccessRate: Dim
    accuracy: Dim
    commanderCorrectionRate: Dim
    usefulEscalationRate: Dim
    meanLatencyMs: Dim
    meanCostUsd: Dim
    failureRate: Dim
    auditCompleteness: Dim
    approvalDoctrineCompliance: Dim
    memoryQuality: Unknown
    operatorWorkloadReduction: Unknown
  }
  notes: string[]
  blockedEffectAttempts: number
  evidenceRunIds: string[]
}

const ratio = (num: number, den: number, min = 1): number | Unknown => (den >= min ? num / den : 'UNKNOWN')
const mean = (xs: number[]): number | Unknown => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 'UNKNOWN')

/** Outcome-based evaluation on the roadmap's dimensions. Anything without an evidence source is UNKNOWN, never zero. */
export function evaluateAgent(log: AgentOpsLog, agentId: string, now: Date = new Date()): AgentEvaluation {
  const view = log.view()
  const runs: RunRecord[] = [...deriveWorkers(log).workers.values()].flatMap((w) => w.runs).filter((r) => r.agentId === agentId)
  const latestFeedback = new Map<string, Extract<(typeof view.records)[number], { t: 'feedback' }>>()
  for (const r of view.records) if (r.t === 'feedback' && isCommander(r.by)) latestFeedback.set(r.runId, r)
  const fb = runs.map((r) => latestFeedback.get(r.runId)).filter((x): x is NonNullable<typeof x> => !!x)
  const by = (s: RunRecord['status']) => runs.filter((r) => r.status === s).length
  const succeeded = by('SUCCEEDED')
  const failed = by('FAILED') + by('TIMED_OUT')
  const terminal = succeeded + failed
  const finished = runs.filter((r) => r.status !== 'RUNNING')
  const escalated = runs.filter((r) => r.escalations.length > 0)
  const judgedEsc = escalated.map((r) => latestFeedback.get(r.runId)?.usefulEscalation).filter((x): x is boolean => typeof x === 'boolean')
  const violations = runs.filter((r) => r.status === 'SUCCEEDED' && r.requestedEffects.length > 0 && !r.approvalRef).length // unapproved effect that still "succeeded"
  const notes: string[] = []
  if (terminal < MIN_TERMINAL_RUNS) notes.push(`only ${terminal} terminal run(s); rates need at least ${MIN_TERMINAL_RUNS} for recommendations`)
  notes.push('memoryQuality and operatorWorkloadReduction have no evidence source yet')
  return {
    agentId,
    generatedAt: now.toISOString(),
    runs: { total: runs.length, terminal, succeeded, failed, blocked: by('BLOCKED'), stopped: by('STOPPED'), interrupted: by('INTERRUPTED') },
    reviewedRuns: fb.length,
    dimensions: {
      taskSuccessRate: ratio(succeeded, terminal),
      accuracy: ratio(fb.filter((f) => f.verdict === 'accepted').length, fb.length),
      commanderCorrectionRate: ratio(fb.filter((f) => f.verdict === 'corrected').length, fb.length),
      usefulEscalationRate: ratio(judgedEsc.filter(Boolean).length, judgedEsc.length),
      meanLatencyMs: mean(finished.map((r) => r.resource.durationMs).filter((x): x is number => typeof x === 'number')),
      meanCostUsd: mean(finished.map((r) => r.resource.costUsd).filter((x): x is number => typeof x === 'number')),
      failureRate: ratio(failed, terminal),
      auditCompleteness: ratio(finished.filter((r) => auditCompleteness(r).complete).length, finished.length),
      approvalDoctrineCompliance: finished.length ? 1 - violations / finished.length : 'UNKNOWN',
      memoryQuality: 'UNKNOWN',
      operatorWorkloadReduction: 'UNKNOWN',
    },
    notes,
    blockedEffectAttempts: runs.filter((r) => r.status === 'BLOCKED').length,
    evidenceRunIds: runs.map((r) => r.runId),
  }
}

/** Underperformers are narrowed, retrained (prompt/workflow review), merged or retired. Recommendation only: nothing is applied. */
export function recommendForAgent(log: AgentOpsLog, agentId: string, now: Date = new Date(), opts: { persist?: boolean; flagForReview?: boolean } = {}): Recommendation {
  const ev = evaluateAgent(log, agentId, now)
  const reasons: string[] = []
  let action: Recommendation['action'] = 'none'
  const d = ev.dimensions
  if (typeof d.approvalDoctrineCompliance === 'number' && d.approvalDoctrineCompliance < 1) { action = 'retire'; reasons.push('approval-doctrine violations recorded') }
  else if (ev.runs.terminal < MIN_TERMINAL_RUNS) reasons.push(`INSUFFICIENT_EVIDENCE: ${ev.runs.terminal}/${MIN_TERMINAL_RUNS} terminal runs`)
  else {
    if (typeof d.failureRate === 'number' && d.failureRate > 0.7) { action = 'retire'; reasons.push(`failure rate ${(d.failureRate * 100).toFixed(0)}% over ${ev.runs.terminal} runs`) }
    else if (typeof d.failureRate === 'number' && d.failureRate > 0.4) { action = 'retrain'; reasons.push(`failure rate ${(d.failureRate * 100).toFixed(0)}%: review prompts/workflow`) }
    if (action === 'none' && ev.reviewedRuns >= MIN_REVIEWED_RUNS && typeof d.commanderCorrectionRate === 'number' && d.commanderCorrectionRate > 0.3) { action = 'narrow'; reasons.push(`Commander correction rate ${(d.commanderCorrectionRate * 100).toFixed(0)}% over ${ev.reviewedRuns} reviewed runs`) }
    if (action === 'none' && typeof d.auditCompleteness === 'number' && d.auditCompleteness < 0.9) { action = 'retrain'; reasons.push(`audit completeness ${(d.auditCompleteness * 100).toFixed(0)}%`) }
    if (action === 'none') reasons.push('no underperformance detected')
  }
  // merge candidate: very low usage while a same-specialization ACTIVE agent carries materially more work (usage itself is the evidence)
  if (action === 'none' || action === 'narrow') {
    const agents = deriveAgents(log).agents
    const me = agents.get(agentId)
    const bigger = [...agents.values()].find((o) => o.spec.id !== agentId && o.state === 'ACTIVE' && me && o.spec.specialization === me.spec.specialization && evaluateAgent(log, o.spec.id, now).runs.total >= Math.max(10, ev.runs.total * 5))
    if (bigger && ev.runs.total <= 3) { action = 'merge'; reasons.push(`overlaps ${bigger.spec.id} (same specialization); only ${ev.runs.total} run(s) on record`) }
  }
  const rec: Recommendation = { id: `rec-${randomUUID()}`, agentId, action, reasons, evidenceRunIds: ev.evidenceRunIds, createdAt: now.toISOString(), applied: false }
  if (opts.persist) log.append({ t: 'recommendation', rec })
  if (opts.flagForReview && action !== 'none') {
    try { new AgentRegistry(log).transition(agentId, 'UNDER_REVIEW', 'system:evaluator', `evaluation recommends ${action}: ${reasons.join('; ')}`, now) } catch { /* not ACTIVE/PAUSED */ }
  }
  return rec
}

/** Phase 9 evidence about the models an agent's runs actually used. Informational; never changes recommendations or routing. */
export function executorEvidence(log: AgentOpsLog, agentId: string, phase9Cards: { subject: { kind: string; id: string }; taskClass: string; score: number | Unknown; confidence: number; rawSamples: number }[]) {
  const runs = [...deriveWorkers(log).workers.values()].flatMap((w) => w.runs).filter((r) => r.agentId === agentId)
  const executors = new Map<string, number>()
  for (const r of runs) if (r.executor !== 'UNKNOWN') executors.set(`${r.executor.provider}/${r.executor.model}`, (executors.get(`${r.executor.provider}/${r.executor.model}`) ?? 0) + 1)
  return [...executors.entries()].map(([executor, runCount]) => ({
    executor, runCount,
    phase9: phase9Cards.filter((c) => (c.subject.kind === 'model' && c.subject.id === executor) || (c.subject.kind === 'provider' && c.subject.id === executor.split('/')[0])).map((c) => ({ kind: c.subject.kind, taskClass: c.taskClass, score: c.score, confidence: c.confidence, samples: c.rawSamples })),
  }))
}
