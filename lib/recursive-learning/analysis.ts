import type { EvaluationEvent } from './types'

export type FailureFinding = {
  signature: string
  subject: EvaluationEvent['subject']
  taskClass: EvaluationEvent['taskClass']
  errorClass: string
  count: number
  firstSeen: string
  lastSeen: string
  evidenceEventIds: string[]
  /** Successes under the same subject+task class in the window: shown so failures are never presented alone. */
  contradictingSuccessIds: string[]
  report: {
    rootCause: string
    contributingFactors: string[]
    missedSignals: string[]
    recommendedMitigation: string
  }
}

const isFailure = (e: EvaluationEvent) => e.outcome === 'FAILURE' || e.outcome === 'ROLLED_BACK' || e.validation === 'FAILED'

/** D — group recent failures by subject + task class + error class; report groups at/above the threshold. Pass ACTIVE events. */
export function detectRecurringFailures(
  events: EvaluationEvent[],
  now: Date,
  opts: { minCount?: number; windowDays?: number } = {},
): FailureFinding[] {
  const minCount = opts.minCount ?? 3
  const cutoff = now.getTime() - (opts.windowDays ?? 30) * 86_400_000
  const inWindow = events.filter((e) => Date.parse(e.occurredAt) >= cutoff)
  const groups = new Map<string, EvaluationEvent[]>()
  for (const e of inWindow.filter(isFailure)) {
    const sig = `${e.subject.kind}:${e.subject.id}|${e.taskClass}|${e.errorClass ?? 'UNCLASSIFIED'}`
    groups.set(sig, [...(groups.get(sig) ?? []), e])
  }
  const out: FailureFinding[] = []
  for (const [signature, fs] of groups) {
    if (fs.length < minCount) continue
    const sorted = [...fs].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    const first = sorted[0]
    const successes = inWindow.filter(
      (e) => e.subject.kind === first.subject.kind && e.subject.id === first.subject.id && e.taskClass === first.taskClass && !isFailure(e) && e.outcome === 'SUCCESS',
    )
    const errorClass = first.errorClass ?? 'UNCLASSIFIED'
    out.push({
      signature,
      subject: first.subject,
      taskClass: first.taskClass,
      errorClass,
      count: fs.length,
      firstSeen: sorted[0].occurredAt,
      lastSeen: sorted[sorted.length - 1].occurredAt,
      evidenceEventIds: sorted.map((e) => e.id),
      contradictingSuccessIds: successes.map((e) => e.id),
      report: {
        // Never invent a cause: an unclassified recurrence is reported as undetermined.
        rootCause: errorClass === 'UNCLASSIFIED' ? 'UNDETERMINED (failures carry no error class)' : `recurring ${errorClass}`,
        contributingFactors: fs.some((e) => e.outcome === 'ROLLED_BACK') ? ['rollbacks occurred'] : [],
        missedSignals: fs.some((e) => e.validation === 'UNKNOWN') ? ['some failing runs had no validation result'] : [],
        recommendedMitigation: `review ${first.subject.id} routing for ${first.taskClass}; investigate ${errorClass}`,
      },
    })
  }
  return out.sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
}
