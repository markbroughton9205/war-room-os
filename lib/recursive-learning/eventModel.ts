import { randomUUID } from 'node:crypto'
import type { EvalOutcome, EvaluationEvent, EvaluationEventInput, EvalSignal, ValidationStatus } from './types'
import { TASK_CLASSES } from './types'

const OUTCOMES: EvalOutcome[] = ['SUCCESS', 'PARTIAL', 'FAILURE', 'ROLLED_BACK', 'REJECTED']

function cleanMetric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Normalizes raw input into an immutable evaluation event. Missing metrics stay absent (UNKNOWN). */
export function createEvaluationEvent(input: EvaluationEventInput, now: Date = new Date()): EvaluationEvent {
  if (!TASK_CLASSES.includes(input.taskClass)) throw new Error(`unknown task class: ${input.taskClass}`)
  if (!OUTCOMES.includes(input.outcome)) throw new Error(`unknown outcome: ${input.outcome}`)
  if (!input.subject?.id) throw new Error('subject.id required')
  if (!input.source?.ref) throw new Error('source.ref required (evidence must be traceable)')
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('occurredAt must be an ISO timestamp')

  if (Date.parse(input.occurredAt) > now.getTime() + 86_400_000) throw new Error('occurredAt is in the future')
  const validation: ValidationStatus = input.validation ?? 'UNKNOWN'
  const coercions: string[] = []
  let outcome = input.outcome
  if (validation === 'FAILED' && (outcome === 'SUCCESS' || outcome === 'PARTIAL')) {
    coercions.push(`reported ${outcome} but validation FAILED; recorded as FAILURE`)
    outcome = 'FAILURE'
  }
  const signal: EvalSignal = input.signal ?? (outcome === 'ROLLED_BACK' ? 'ROLLBACK' : 'RUN')
  const m = input.metrics ?? {}
  const metrics = Object.fromEntries(
    Object.entries({
      latencyMs: cleanMetric(m.latencyMs),
      costUsd: cleanMetric(m.costUsd),
      tokensIn: cleanMetric(m.tokensIn),
      tokensOut: cleanMetric(m.tokensOut),
      retries: cleanMetric(m.retries),
    }).filter(([, v]) => v !== undefined),
  )
  return {
    id: input.id ?? randomUUID(),
    subject: { ...input.subject },
    taskClass: input.taskClass,
    outcome,
    signal,
    validation,
    occurredAt: new Date(input.occurredAt).toISOString(),
    recordedAt: now.toISOString(),
    metrics,
    errorClass: input.errorClass,
    note: input.note,
    source: { ...input.source },
    ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
    coercions,
    reportedOutcome: input.outcome,
  }
}
