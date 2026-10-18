import type { EvaluationEventInput, EvalOutcome } from '@/lib/recursive-learning/types'
import { stableEventId } from '@/lib/recursive-learning/ingestion/ids'
import type { LearningLog } from '@/lib/recursive-learning/store'
import type { BenchmarkRecord } from './types'

/**
 * Phase 9 wiring: a real engineering run (a Forge BenchmarkRecord) becomes attributable Phase 9 evaluation events, one for the MODEL and one for the
 * WORKFLOW. Phase 9's event type has no free-form fields, so the attribution (fixture, engine, executor, score, intervention, escalation) travels in
 * `source.ref` and `note`. Cost and tokens are never invented: absent stays UNKNOWN. Scripted-double runs are refused (not evidence).
 */
export const ENGINEERING_WORKFLOW_ID = 'foundry:complete-feature-workflow'
export const ENGINEERING_ADAPTER = 'foundry-engineering-run'

export function failureClassOf(rootCause: string | undefined): string | undefined {
  if (!rootCause) return undefined
  if (/incompatible rewrite|rejections?/i.test(rootCause)) return 'edit_rejected_repeatedly'
  if (/unusable/i.test(rootCause)) return 'unusable_reply'
  if (/UNDETERMINED/.test(rootCause)) return 'repair_unresolved'
  if (/budget|exhausted/i.test(rootCause)) return 'budget_exhausted'
  if (/model call failed|timeout/i.test(rootCause)) return 'model_call_failed'
  return 'other'
}

export function outcomeOf(b: BenchmarkRecord): { outcome: EvalOutcome; validation: 'PASSED' | 'FAILED' | 'UNKNOWN' } {
  if (b.verifierScore === 'UNKNOWN') return { outcome: b.completion === 'COMPLETED' ? 'PARTIAL' : 'FAILURE', validation: 'UNKNOWN' }
  const full = b.verifierScore.pass === b.verifierScore.total
  if (b.completion === 'COMPLETED' && full) return { outcome: 'SUCCESS', validation: 'PASSED' }
  return { outcome: b.verifierScore.pass > 0 && b.completion !== 'BLOCKED' ? 'PARTIAL' : 'FAILURE', validation: 'FAILED' }
}

export function engineeringRunToEvents(b: BenchmarkRecord, opts: { trial?: string; backfilled?: boolean; escalatedFrom?: string } = {}): { events: EvaluationEventInput[]; skipped?: string } {
  if (/test-double|scripted/i.test(b.executor)) return { events: [], skipped: 'scripted executor is not engineering evidence' }
  const when = Number.isNaN(Date.parse(b.at)) ? new Date().toISOString() : new Date(Math.min(Date.parse(b.at), Date.now())).toISOString()
  const ref = `engineering:${b.fixture.split(' ')[0]}:${b.modelRef}:${b.engineSha ?? 'UNKNOWN'}:${opts.trial ?? b.at}`
  const { outcome, validation } = outcomeOf(b)
  const score = b.verifierScore === 'UNKNOWN' ? 'UNKNOWN' : `${b.verifierScore.pass}/${b.verifierScore.total}`
  const note = [`fixture=${b.fixture.split(' ')[0]}`, `workflow=${ENGINEERING_WORKFLOW_ID}`, `executor=${b.executor}`, `engine=${b.engineSha ?? 'UNKNOWN'}`, `verifier=${score}`, `completion=${b.completion}`, `modelCalls=${b.modelCalls}`, `repairs=${b.repairs}`, `intervention=${b.manualIntervention ? 'MANUAL' : 'none'}`, `regressions=${b.regressions}`, `escalation=${opts.escalatedFrom ? `from ${opts.escalatedFrom}` : 'none'}`, `baseline=${b.historicalBaseline ? 'yes' : 'no'}`].join(' ')
  const fc = outcome === 'SUCCESS' ? undefined : failureClassOf(b.rootCause)
  const mk = (kind: 'model' | 'workflow', id: string): EvaluationEventInput => ({
    id: stableEventId(ENGINEERING_ADAPTER, 'engineering-run', ref, kind, id),
    subject: { kind, id },
    taskClass: 'code_modification',
    outcome, signal: 'RUN', validation, occurredAt: when,
    metrics: { latencyMs: b.elapsedMs, retries: b.repairs },
    ...(fc ? { errorClass: fc } : {}),
    note,
    source: { kind: 'engineering-run', ref },
    provenance: { adapter: ENGINEERING_ADAPTER, backfilled: opts.backfilled ?? false, sourcePath: b.evidencePath },
  })
  return { events: [mk('model', b.modelRef), mk('workflow', ENGINEERING_WORKFLOW_ID)] }
}

export function emitEngineeringRun(log: LearningLog, b: BenchmarkRecord, opts?: Parameters<typeof engineeringRunToEvents>[1]) {
  const { events, skipped } = engineeringRunToEvents(b, opts)
  if (!events.length) return { inserted: 0, duplicates: 0, rejected: [{ index: 0, reason: skipped ?? 'no events' }] }
  const r = log.recordEvents(events)
  return { inserted: r.inserted.length, duplicates: r.duplicates, rejected: r.rejected }
}
