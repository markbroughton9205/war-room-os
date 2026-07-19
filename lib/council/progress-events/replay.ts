import type { CouncilRequestStateRecord } from '@/lib/council/request-state/types'
import type {
  CouncilProgressEventEnvelope,
  CouncilProgressEventId,
  CouncilProgressReplayResult,
} from './types'
import { progressIssue, validateCouncilProgressEventEnvelope } from './invariants'
import { reduceCouncilProgressEvent } from './reducer'

function sameEvent(a: CouncilProgressEventEnvelope, b: CouncilProgressEventEnvelope): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function replayCouncilProgressEvents(
  initialState: CouncilRequestStateRecord,
  events: CouncilProgressEventEnvelope[],
): CouncilProgressReplayResult {
  let state = JSON.parse(JSON.stringify(initialState)) as CouncilRequestStateRecord
  const appliedEventIds: CouncilProgressEventId[] = []
  const ignoredDuplicateEventIds: CouncilProgressEventId[] = []
  const seenById = new Map<string, CouncilProgressEventEnvelope>()
  const seenSequences = new Map<number, CouncilProgressEventEnvelope>()
  let expectedSequence = 1
  // Tracks whether an audit_completed event has already been successfully
  // applied for this request. This bookkeeping is local to a single replay
  // pass -- it is never persisted into CouncilRequestStateRecord -- and
  // enforces that prior completed-audit truth cannot be re-declared or
  // rewritten later in the same ordered event stream (Correction A: prohibit
  // ALL audit re-declaration after completion for the same audit execution).
  let auditCompletedSeen = false

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const validation = validateCouncilProgressEventEnvelope(event)
    if (!validation.ok) {
      return { ok: false, finalState: state, appliedEventIds, ignoredDuplicateEventIds, issues: validation.issues, failurePosition: index }
    }

    const previousById = seenById.get(event.eventId)
    if (previousById) {
      if (sameEvent(previousById, event)) {
        ignoredDuplicateEventIds.push(event.eventId)
        continue
      }
      return {
        ok: false,
        finalState: state,
        appliedEventIds,
        ignoredDuplicateEventIds,
        issues: [progressIssue('conflicting_duplicate_event_id', `events[${index}].eventId`, 'Duplicate event ID has conflicting content.')],
        failurePosition: index,
      }
    }

    const previousSequence = seenSequences.get(event.sequence)
    if (previousSequence && previousSequence.eventId !== event.eventId) {
      return {
        ok: false,
        finalState: state,
        appliedEventIds,
        ignoredDuplicateEventIds,
        issues: [progressIssue('duplicate_sequence', `events[${index}].sequence`, 'Different event IDs cannot share sequence.')],
        failurePosition: index,
      }
    }
    if (event.sequence !== expectedSequence) {
      return {
        ok: false,
        finalState: state,
        appliedEventIds,
        ignoredDuplicateEventIds,
        issues: [progressIssue('sequence_gap_or_out_of_order', `events[${index}].sequence`, `Expected sequence ${expectedSequence} but observed ${event.sequence}.`)],
        failurePosition: index,
      }
    }

    if (auditCompletedSeen && (event.eventType === 'audit_scope_declared' || event.eventType === 'audit_completed')) {
      return {
        ok: false,
        finalState: state,
        appliedEventIds,
        ignoredDuplicateEventIds,
        issues: [progressIssue('audit_redeclared_after_completion', `events[${index}].eventType`, 'Audit scope cannot be declared or re-completed after this request\'s audit already completed.')],
        failurePosition: index,
      }
    }

    const reduced = reduceCouncilProgressEvent(state, event)
    if (!reduced.ok) {
      return { ok: false, finalState: state, appliedEventIds, ignoredDuplicateEventIds, issues: reduced.issues, failurePosition: index }
    }

    seenById.set(event.eventId, event)
    seenSequences.set(event.sequence, event)
    appliedEventIds.push(event.eventId)
    state = reduced.state
    if (event.eventType === 'audit_completed') auditCompletedSeen = true
    expectedSequence += 1
  }

  return {
    ok: true,
    finalState: state,
    appliedEventIds,
    ignoredDuplicateEventIds,
    issues: [],
    failurePosition: null,
  }
}
