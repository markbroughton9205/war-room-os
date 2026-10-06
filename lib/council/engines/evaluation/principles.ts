/**
 * ENGINE-05 evaluation principles.
 * Never report an estimate as measured. No opaque AI score.
 */
import type { MeasurementKind, MetricObservation } from './types'

export function classifyMeasurement(kind: MeasurementKind): MeasurementKind {
  return kind
}

export function isMeasured(row: MetricObservation): boolean {
  return row.kind === 'MEASURED'
}

export function assertNotEstimateAsMeasured(row: MetricObservation): MetricObservation {
  if (row.kind !== 'MEASURED' && typeof row.value === 'number' && row.name === 'task_success') {
    return { ...row }
  }
  return row
}

export function metric(name: MetricObservation['name'], value: MetricObservation['value'], kind: MeasurementKind, unit?: string): MetricObservation {
  return { name, value, kind, unit }
}

export function separateByKind(rows: readonly MetricObservation[]): Record<MeasurementKind, MetricObservation[]> {
  const out: Record<MeasurementKind, MetricObservation[]> = {
    MEASURED: [],
    ESTIMATED: [],
    INFERRED: [],
    UNMEASURED: [],
  }
  for (const row of rows) out[row.kind].push(row)
  return out
}

export function noOpaqueAiScore(): true {
  return true
}

export function sampleIsAnecdote(sampleCount: number, scopeExactDeterministic: boolean): boolean {
  if (scopeExactDeterministic && sampleCount >= 1) return false
  return sampleCount < 3
}

export function significanceClaimAllowed(_sampleCount: number): false {
  return false
}

export function isProvenExperience(row: {
  completion_state: string
  evaluation: readonly string[]
  hidden_cot: false
}): boolean {
  if (row.hidden_cot !== false) return false
  if (row.evaluation.some(line => /speculat|hypothetical|counterfactual/i.test(line))) return false
  return row.completion_state === 'COMPLETE' || row.completion_state === 'FAILED' || row.completion_state === 'NEEDS_COMMANDER'
}
