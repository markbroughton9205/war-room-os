import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
  type CouncilFamilyExecutionRecord,
  type CouncilRequestStateRecord,
} from '@/lib/council/request-state/types'
import {
  canEnterTerminalWithOutcome,
  canTransitionCouncilFamilyLifecycle,
} from '@/lib/council/request-state/transitions'
import { containsUnsafeSecretText, validateCouncilRequestState } from '@/lib/council/request-state/invariants'
import {
  COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
  type CouncilProgressEventEnvelope,
  type CouncilProgressEventIssue,
  type CouncilProgressEventSource,
  type CouncilProgressEventType,
  type CouncilProgressEventValidationResult,
} from './types'

const VALID_SOURCES: ReadonlySet<CouncilProgressEventSource> = new Set([
  'client_orchestrator',
  'server_orchestrator',
  'provider_adapter',
  'retrieval_layer',
  'fallback_layer',
  'integrity_layer',
  'commander',
  'diagnostic_layer',
  'replay',
])

const VALID_EVENT_TYPES: ReadonlySet<CouncilProgressEventType> = new Set([
  'request_created',
  'request_selection_resolved',
  'request_started',
  'request_cancel_requested',
  'request_cancelled',
  'request_completed',
  'request_failed',
  'request_timed_out',
  'family_waiting',
  'family_queued',
  'family_dispatched',
  'family_retrieval_started',
  'family_retrieval_completed',
  'family_prior_response_delivered',
  'family_reviewing_previous',
  'family_response_started',
  'family_response_completed',
  'family_failed',
  'family_timed_out',
  'family_skipped_by_policy',
  'family_stopped_by_commander',
  'family_not_reached',
  'fallback_started',
  'fallback_completed',
  'fallback_failed',
  'audit_started',
  'audit_scope_declared',
  'audit_completed',
  'audit_failed',
  'diagnostic_recorded',
])

const FAMILY_EVENT_TYPES: ReadonlySet<CouncilProgressEventType> = new Set([
  'family_waiting',
  'family_queued',
  'family_dispatched',
  'family_retrieval_started',
  'family_retrieval_completed',
  'family_prior_response_delivered',
  'family_reviewing_previous',
  'family_response_started',
  'family_response_completed',
  'family_failed',
  'family_timed_out',
  'family_skipped_by_policy',
  'family_stopped_by_commander',
  'family_not_reached',
])

const REQUEST_ONLY_EVENT_TYPES: ReadonlySet<CouncilProgressEventType> = new Set([
  'request_created',
  'request_selection_resolved',
  'request_started',
  'request_cancel_requested',
  'request_cancelled',
  'request_completed',
  'request_failed',
  'request_timed_out',
])

const FALLBACK_EVENT_TYPES: ReadonlySet<CouncilProgressEventType> = new Set([
  'fallback_started',
  'fallback_completed',
  'fallback_failed',
])

export function progressIssue(code: string, path: string, message: string): CouncilProgressEventIssue {
  return { code, path, message }
}

// Detects true cycles (a back-edge to an object still on the current
// recursion path) without misclassifying repeated-but-non-cyclic shared
// references (a DAG with shared nodes is safe -- the same object visited
// twice as siblings is fine). `ancestors` is a WeakSet of objects currently
// "in progress" on this call stack; each object is removed once its own
// subtree has finished, so only true back-edges to a live ancestor count.
function hasCycle(value: unknown, ancestors: WeakSet<object> = new WeakSet()): boolean {
  if (!value || typeof value !== 'object') return false
  const node = value as object
  if (ancestors.has(node)) return true
  ancestors.add(node)
  const children: unknown[] = Array.isArray(node) ? node : Object.values(node)
  const cyclic = children.some(child => hasCycle(child, ancestors))
  ancestors.delete(node)
  return cyclic
}

// Recursively walks any payload/diagnostic shape -- strings, arrays, and
// nested objects (including keys) -- through the shared secret detector so
// no free-text field (known or newly added) can silently bypass the check.
// Callers must confirm the value is cycle-free first (see hasCycle) --
// this walker has no cycle guard of its own and will recurse forever (and
// throw RangeError) on cyclic input.
function containsUnsafeDiagnostic(value: unknown): boolean {
  if (typeof value === 'string') return containsUnsafeSecretText(value)
  if (Array.isArray(value)) return value.some(containsUnsafeDiagnostic)
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) => containsUnsafeSecretText(key) || containsUnsafeDiagnostic(nested))
  }
  return false
}

// Shared by validateCouncilProgressEventEnvelope and validateEventSequence
// so payload-shape rejection is one rule, not two independently-maintained
// ones. A valid payload is a plain, non-null, non-array object -- anything
// else (null, undefined, string, number, boolean, array) is rejected.
function isValidProgressEventPayloadShape(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

function isSerializable(value: unknown): boolean {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return false
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return false
  if (value instanceof Promise || value instanceof Error) return false
  if (Array.isArray(value)) return value.every(isSerializable)
  if (value && typeof value === 'object') return Object.values(value).every(isSerializable)
  return true
}

export function validateCouncilProgressEventEnvelope(
  event: CouncilProgressEventEnvelope,
): CouncilProgressEventValidationResult {
  const issues: CouncilProgressEventIssue[] = []

  if (event.schemaVersion !== COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION) {
    issues.push(progressIssue('unsupported_event_schema_version', 'schemaVersion', 'Unsupported progress-event schema version.'))
  }
  if (!event.eventId) issues.push(progressIssue('missing_event_id', 'eventId', 'Event ID is required.'))
  if (!event.requestId) issues.push(progressIssue('missing_request_id', 'requestId', 'Request ID is required.'))
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    issues.push(progressIssue('invalid_sequence', 'sequence', 'Sequence must be a positive integer.'))
  }
  if (!VALID_SOURCES.has(event.source)) {
    issues.push(progressIssue('invalid_source', 'source', 'Progress event source must be canonical.'))
  }
  if (!VALID_EVENT_TYPES.has(event.eventType)) {
    issues.push(progressIssue('invalid_event_type', 'eventType', 'Progress event type must be canonical.'))
  }
  if (FAMILY_EVENT_TYPES.has(event.eventType) && !event.family) {
    issues.push(progressIssue('family_required', 'family', 'Family-level events require family.'))
  }
  if (REQUEST_ONLY_EVENT_TYPES.has(event.eventType) && event.family) {
    issues.push(progressIssue('family_forbidden', 'family', 'Request-level events must not carry family.'))
  }
  // event.payload must be a plain, non-null, non-array object before any of
  // its properties are read. Without this guard, payload: null/undefined
  // throws on the very next property access (event.payload.fallback, etc.)
  // -- exactly the "Cannot read properties of null" crash this correction
  // fixes. string/number/boolean/array payloads don't crash on property
  // access (primitives auto-box; arrays are objects), but they are still
  // not a valid CouncilProgressEventPayload shape and must be rejected the
  // same structured way, not silently skipped.
  const payloadIsValidShape = isValidProgressEventPayloadShape(event.payload)
  if (!payloadIsValidShape) {
    issues.push(progressIssue('invalid_payload_shape', 'payload', 'Progress event payload must be a plain object.'))
  } else {
    if (FALLBACK_EVENT_TYPES.has(event.eventType) && !event.payload.fallback) {
      issues.push(progressIssue('fallback_payload_required', 'payload.fallback', 'Fallback events require fallback payload.'))
    }
    if (event.eventType === 'family_prior_response_delivered' && !event.payload.priorResponse) {
      issues.push(progressIssue('prior_response_payload_required', 'payload.priorResponse', 'Prior-response delivery requires structured lineage payload.'))
    }
    if ((event.eventType === 'audit_scope_declared' || event.eventType === 'audit_completed') && !event.payload.audit) {
      issues.push(progressIssue('audit_payload_required', 'payload.audit', 'Audit scope/completion events require audit payload.'))
    }
    if (event.eventType === 'diagnostic_recorded' && !event.payload.diagnostic) {
      issues.push(progressIssue('diagnostic_payload_required', 'payload.diagnostic', 'Diagnostic events require structured diagnostic payload.'))
    }
  }
  // A circular reference anywhere in the event makes every recursive walk
  // below (unsafe-text scan, serializability check) unsafe to run, since
  // none of them are cycle-aware on their own. Check first and fail closed
  // with a single structured issue instead of attempting -- and
  // stack-overflowing on -- those walks. hasCycle/containsUnsafeDiagnostic/
  // isSerializable are all explicitly safe to run even when payload is a
  // malformed primitive shape (null, a string, a number, etc.) -- each has
  // its own `typeof`/truthy guard and degrades to "not a cycle" / "no
  // unsafe text" / "serializable" rather than throwing -- so unlike the
  // direct property-access checks above, they do not need to be gated
  // behind payloadIsValidShape.
  if (hasCycle(event)) {
    issues.push(progressIssue('cyclic_payload_not_serializable', 'event', 'Progress event contains a circular reference and cannot be validated or serialized.'))
  } else {
    // Scans the entire payload (fallback.safeDiagnosticReason, audit.notes,
    // diagnostic.*, reason, and any other current or future free-text field)
    // rather than enumerating individual fields one at a time, so no payload
    // field -- nested in an object or array -- can bypass the check.
    if (containsUnsafeDiagnostic(event.payload)) {
      issues.push(progressIssue('unsafe_payload_text', 'payload', 'Progress event payload contains secret-bearing or unsafe fields.'))
    }
    if (event.diagnostic && containsUnsafeDiagnostic(event.diagnostic)) {
      issues.push(progressIssue('unsafe_event_diagnostic', 'diagnostic', 'Event diagnostic metadata contains secret-bearing or unsafe fields.'))
    }
    if (!isSerializable(event)) {
      issues.push(progressIssue('event_not_serializable', 'event', 'Progress event envelope must be JSON-serializable.'))
    }
  }

  return { ok: issues.length === 0, issues }
}

export function validateEventSequence(
  events: CouncilProgressEventEnvelope[],
): CouncilProgressEventValidationResult {
  const issues: CouncilProgressEventIssue[] = []
  const eventById = new Map<string, string>()
  const sequenceByNumber = new Map<number, string>()
  let expectedSequence = 1
  let previousOccurredAt: string | null = null

  events.forEach((event, index) => {
    const path = `events[${index}]`
    if (hasCycle(event)) {
      issues.push(progressIssue('cyclic_payload_not_serializable', path, 'Progress event contains a circular reference and cannot be validated or serialized.'))
      return
    }
    // Reuses the exact same shape rule as validateCouncilProgressEventEnvelope
    // (isValidProgressEventPayloadShape) rather than a second independent
    // check, so a malformed payload (null, undefined, string, number,
    // boolean, array) is rejected here the same way it already is at the
    // envelope layer. Skips duplicate/sequence/timestamp bookkeeping for
    // this event -- same early-return pattern as the cycle check above --
    // since a fundamentally malformed event shouldn't also generate
    // potentially misleading ordering commentary.
    if (!isValidProgressEventPayloadShape(event.payload)) {
      issues.push(progressIssue('invalid_payload_shape', `${path}.payload`, 'Progress event payload must be a plain object.'))
      return
    }
    const serialized = JSON.stringify(event)
    const existingEvent = eventById.get(event.eventId)
    if (existingEvent && existingEvent !== serialized) {
      issues.push(progressIssue('conflicting_duplicate_event_id', `${path}.eventId`, 'Duplicate event ID has conflicting content.'))
    } else if (!existingEvent) {
      eventById.set(event.eventId, serialized)
    }

    const existingSequenceEventId = sequenceByNumber.get(event.sequence)
    if (existingSequenceEventId && existingSequenceEventId !== event.eventId) {
      issues.push(progressIssue('duplicate_sequence', `${path}.sequence`, 'Different event IDs cannot share a request-scoped sequence.'))
    } else if (!existingSequenceEventId) {
      sequenceByNumber.set(event.sequence, event.eventId)
      if (event.sequence !== expectedSequence) {
        issues.push(progressIssue('sequence_gap_or_out_of_order', `${path}.sequence`, `Expected sequence ${expectedSequence} but observed ${event.sequence}.`))
      }
      expectedSequence += 1
    }

    if (previousOccurredAt && event.occurredAt < previousOccurredAt) {
      issues.push(progressIssue('out_of_order_timestamp', `${path}.occurredAt`, 'Event timestamp moved backward.'))
    }
    previousOccurredAt = event.occurredAt
  })

  return { ok: issues.length === 0, issues }
}

export function findFamilyExecution(
  state: CouncilRequestStateRecord,
  family: CouncilOrchestrationFamily,
): CouncilFamilyExecutionRecord | undefined {
  return state.familyExecutions.find(record => record.family === family && record.requestId === state.requestId)
}

export function validateStateTransitionForEvent(
  previous: CouncilRequestStateRecord,
  next: CouncilRequestStateRecord,
  event: CouncilProgressEventEnvelope,
): CouncilProgressEventIssue[] {
  const issues: CouncilProgressEventIssue[] = []
  if (previous.schemaVersion !== COUNCIL_REQUEST_STATE_SCHEMA_VERSION || next.schemaVersion !== COUNCIL_REQUEST_STATE_SCHEMA_VERSION) {
    issues.push(progressIssue('request_state_schema_mismatch', 'state.schemaVersion', 'Reducer must preserve request-state schema.'))
  }
  if (previous.requestId !== next.requestId || event.requestId !== next.requestId) {
    issues.push(progressIssue('request_id_mismatch', 'requestId', 'Reducer event and request state must share request ID.'))
  }
  if (event.family) {
    const before = findFamilyExecution(previous, event.family)
    const after = findFamilyExecution(next, event.family)
    if (before && after && before.lifecycle !== after.lifecycle && before.lifecycle !== 'terminal' && after.lifecycle !== 'terminal') {
      const transition = canTransitionCouncilFamilyLifecycle(before.lifecycle, after.lifecycle)
      if (!transition.ok) {
        issues.push(progressIssue('illegal_lifecycle_transition', 'familyExecutions.lifecycle', transition.reason))
      }
    }
    if (before && after && before.lifecycle !== 'terminal' && after.lifecycle === 'terminal' && after.outcome) {
      if (event.eventType === 'family_stopped_by_commander') {
        const stop = canTransitionCouncilFamilyLifecycle(before.lifecycle, 'stopped_by_commander')
        if (!stop.ok) {
          issues.push(progressIssue('illegal_lifecycle_transition', 'familyExecutions.lifecycle', stop.reason))
        }
      } else if (event.eventType === 'family_skipped_by_policy' || event.eventType === 'family_not_reached') {
        const notReached = canTransitionCouncilFamilyLifecycle(before.lifecycle, 'not_reached')
        if (!notReached.ok) {
          issues.push(progressIssue('illegal_lifecycle_transition', 'familyExecutions.lifecycle', notReached.reason))
        }
      } else {
        const terminal = canEnterTerminalWithOutcome(before.lifecycle, after.outcome)
        if (!terminal.ok) {
          issues.push(progressIssue('illegal_terminal_outcome', 'familyExecutions.outcome', terminal.reason))
        }
      }
    }
    if (before?.lifecycle === 'terminal' && after?.lifecycle !== 'terminal') {
      issues.push(progressIssue('terminal_reopened', 'familyExecutions.lifecycle', 'Terminal family execution cannot be reopened.'))
    }
  }

  const stateValidation = validateCouncilRequestState(next)
  for (const issue of stateValidation.issues) {
    issues.push(progressIssue(`request_state_${issue.code}`, issue.path, issue.message))
  }
  return issues
}
