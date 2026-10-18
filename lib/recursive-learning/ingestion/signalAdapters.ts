import type { EvalSubject, EvaluationEventInput, EvalOutcome, TaskClass, ValidationStatus } from '../types'
import { stableEventId } from './ids'

type Common = { subject: EvalSubject; taskClass: TaskClass; occurredAt: string; sourceKind: string; sourceRef: string; sourcePath?: string; backfilled?: boolean }

function base(c: Common, adapter: string, signalKey: string): Pick<EvaluationEventInput, 'id' | 'subject' | 'taskClass' | 'occurredAt' | 'source' | 'provenance'> {
  return {
    id: stableEventId(adapter, c.sourceKind, c.sourceRef, signalKey, c.subject.kind, c.subject.id),
    subject: c.subject,
    taskClass: c.taskClass,
    occurredAt: c.occurredAt,
    source: { kind: c.sourceKind, ref: c.sourceRef },
    provenance: { adapter, backfilled: c.backfilled ?? false, sourcePath: c.sourcePath },
  }
}

export type CommanderDecisionKind = 'approve' | 'reject' | 'correct' | 'override'
/** Commander approval / rejection / correction / explicit override. Correction and override both lower evaluation. */
export function commanderDecisionEvent(c: Common & { decision: CommanderDecisionKind }): EvaluationEventInput {
  const map: Record<CommanderDecisionKind, { outcome: EvalOutcome; signal: NonNullable<EvaluationEventInput['signal']> }> = {
    approve: { outcome: 'SUCCESS', signal: 'COMMANDER_APPROVAL' },
    reject: { outcome: 'REJECTED', signal: 'COMMANDER_REJECTION' },
    correct: { outcome: 'PARTIAL', signal: 'COMMANDER_CORRECTION' },
    override: { outcome: 'PARTIAL', signal: 'COMMANDER_CORRECTION' },
  }
  return { ...base(c, 'commander-decision', c.decision), ...map[c.decision], note: `commander ${c.decision}` }
}

/** Rollback attributable to a subject (caller must supply attribution; unattributable rollbacks are not events). */
export function rollbackEvent(c: Common): EvaluationEventInput {
  return { ...base(c, 'rollback', 'rollback'), outcome: 'ROLLED_BACK', signal: 'ROLLBACK' }
}

export function installedAcceptanceEvent(c: Common & { pass: boolean }): EvaluationEventInput {
  return { ...base(c, 'installed-outcome', c.pass ? 'pass' : 'fail'), outcome: c.pass ? 'SUCCESS' : 'FAILURE', signal: 'INSTALLED_OUTCOME', validation: c.pass ? 'PASSED' : 'FAILED' }
}

export function validationResultEvent(c: Common & { pass: boolean; validationId: string }): EvaluationEventInput {
  return { ...base(c, 'validation', c.validationId), outcome: c.pass ? 'SUCCESS' : 'FAILURE', signal: 'VALIDATION', validation: (c.pass ? 'PASSED' : 'FAILED') as ValidationStatus, note: `validation ${c.validationId}` }
}

/** Reviewer finding: disagreement/failure findings only (a clean review is not extra evidence of quality). */
export function reviewFindingEvent(c: Common & { reviewer: 'independent' | 'self'; status: string }): EvaluationEventInput {
  return { ...base(c, 'review-finding', `${c.reviewer}:${c.status}`), outcome: 'PARTIAL', signal: 'REVIEWER_FINDING', note: `${c.reviewer} review status ${c.status}` }
}
