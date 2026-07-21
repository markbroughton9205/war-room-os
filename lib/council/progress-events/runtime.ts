import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilFlowMode } from '@/lib/council/councilMode'
import {
  COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
  councilFamilyExecutionId,
  councilRequestId,
  defaultVisibilityState,
  type CouncilExecutionStrategy,
  type CouncilFamilyExecutionRecord,
  type CouncilFamilyOutcome,
  type CouncilProviderReadiness,
  type CouncilRequestId,
  type CouncilRequestStateRecord,
  type CouncilSelectionAuthority,
} from '@/lib/council/request-state/types'
import { deriveCouncilRequestCompletionSummary } from '@/lib/council/request-state/invariants'
import { createCouncilProgressEvent } from './event-factory'
import { replayCouncilProgressEvents } from './replay'
import type {
  CouncilAuditPayload,
  CouncilDiagnosticMetadata,
  CouncilProgressEventEnvelope,
  CouncilProgressEventPayload,
  CouncilProgressEventSource,
  CouncilProgressEventType,
  CouncilProgressReplayResult,
} from './types'

export type CouncilProgressRuntimeRecordInput = {
  eventType: CouncilProgressEventType
  source: CouncilProgressEventSource
  family?: CouncilOrchestrationFamily | null
  payload?: CouncilProgressEventPayload
  occurredAt?: string
}

export type CouncilProgressRuntimeDiagnostic = {
  code: string
  eventType: CouncilProgressEventType
  message: string
  issueCodes: string[]
  occurredAt: string
}

export type CouncilProgressRuntimeRecordResult =
  | { ok: true; event: CouncilProgressEventEnvelope; ignoredDuplicate: boolean }
  | { ok: false; event: CouncilProgressEventEnvelope | null; diagnostic: CouncilProgressRuntimeDiagnostic }

export type CouncilProgressRuntimeSnapshot = {
  schemaVersion: '47c3.council-progress-runtime.v1'
  requestId: string
  logicalRequestId: string | null
  logicalTurnIndex: number | null
  logicalTurnTotal: number | null
  logicalExpectedFamilies: CouncilOrchestrationFamily[]
  status: 'recording' | 'closed' | 'degraded'
  eventCount: number
  appliedEventCount: number
  ignoredDuplicateCount: number
  rejectedEventCount: number
  events: CouncilProgressEventEnvelope[]
  state: CouncilRequestStateRecord
  diagnostics: CouncilProgressRuntimeDiagnostic[]
}

export type CouncilProgressRuntimeTracker = {
  readonly requestId: CouncilRequestId
  readonly selectedFamilies: CouncilOrchestrationFamily[]
  record(input: CouncilProgressRuntimeRecordInput): CouncilProgressRuntimeRecordResult
  recordRaw(event: CouncilProgressEventEnvelope): CouncilProgressRuntimeRecordResult
  recordDiagnostic(code: string, safeMessage: string): CouncilProgressRuntimeRecordResult
  closeIfTerminal(): CouncilProgressRuntimeRecordResult | null
  snapshot(): CouncilProgressRuntimeSnapshot
}

export type CouncilProgressEventObserver = (input: {
  event: CouncilProgressEventEnvelope
  snapshot: CouncilProgressRuntimeSnapshot
}) => void

export type CouncilProgressRuntimeTrackerInput = {
  requestIdSeed: string
  commanderTurnRef: string
  flowMode: CouncilFlowMode
  executionStrategy: CouncilExecutionStrategy
  expectedFamilies: CouncilOrchestrationFamily[]
  selectedFamilies: CouncilOrchestrationFamily[]
  selectionAuthority: CouncilSelectionAuthority
  createdAt?: string
  logicalRequestId?: string | null
  logicalTurnIndex?: number | null
  logicalTurnTotal?: number | null
  logicalExpectedFamilies?: CouncilOrchestrationFamily[]
  eventObserver?: CouncilProgressEventObserver | null
}

function cloneState(state: CouncilRequestStateRecord): CouncilRequestStateRecord {
  return JSON.parse(JSON.stringify(state)) as CouncilRequestStateRecord
}

function cloneEvents(events: CouncilProgressEventEnvelope[]): CouncilProgressEventEnvelope[] {
  return JSON.parse(JSON.stringify(events)) as CouncilProgressEventEnvelope[]
}

function safeRuntimeId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

function safeCorrelationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(trimmed)) return null
  return trimmed
}

function safeTurnNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) return null
  return value
}

function executionRecordFor(input: {
  requestId: CouncilRequestId
  family: CouncilOrchestrationFamily
  selectionAuthority: CouncilSelectionAuthority
  createdAt: string
}): CouncilFamilyExecutionRecord {
  return {
    schemaVersion: COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
    executionId: councilFamilyExecutionId(`${input.requestId}-${input.family}`),
    requestId: input.requestId,
    family: input.family,
    selectionAuthority: input.selectionAuthority,
    readinessSnapshot: {
      readiness: 'unknown',
      source: 'canonical_runtime',
      checkedAt: null,
      providerLabel: input.family,
    },
    lifecycle: 'waiting',
    outcome: null,
    createdAt: input.createdAt,
    queuedAt: null,
    dispatchedAt: null,
    completedAt: null,
    timeout: null,
    priorResponseLineage: [],
    respondingToFamilyExecutionIds: [],
    fallbackLineage: null,
    visibility: defaultVisibilityState(),
    auditRelevance: 'auditable',
    safeDiagnosticCode: null,
    safeDiagnosticMessage: null,
  }
}

function initialState(input: CouncilProgressRuntimeTrackerInput): CouncilRequestStateRecord {
  const createdAt = input.createdAt ?? new Date().toISOString()
  const requestId = councilRequestId(`runtime-${input.requestIdSeed}`)
  const familyExecutions = input.selectedFamilies.map(family =>
    executionRecordFor({
      requestId,
      family,
      selectionAuthority: input.selectionAuthority,
      createdAt,
    }),
  )
  return {
    schemaVersion: COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
    requestId,
    parentRequestId: null,
    createdAt,
    commanderTurnRef: input.commanderTurnRef,
    flowMode: input.flowMode,
    executionStrategy: input.executionStrategy,
    expectedFamilies: [...input.expectedFamilies],
    selectedFamilies: [...input.selectedFamilies],
    familyExecutions,
    completionSummary: deriveCouncilRequestCompletionSummary(input.expectedFamilies, input.selectedFamilies, familyExecutions),
    cancellation: { cancelled: false },
    redTeamAudit: {
      scope: 'not_audited',
      reviewType: 'not_audited',
      expectedFamilies: [...input.expectedFamilies],
      receivedFamilies: [],
      missingFamilies: [...input.expectedFamilies],
      currentTurnPriorResponsesReceived: false,
    },
  }
}

function replayCandidate(
  state: CouncilRequestStateRecord,
  events: CouncilProgressEventEnvelope[],
): CouncilProgressReplayResult {
  return replayCouncilProgressEvents(state, events)
}

function eventIdentity(event: CouncilProgressEventEnvelope): string {
  return JSON.stringify(event)
}

export function createCouncilProgressRuntimeTracker(input: CouncilProgressRuntimeTrackerInput): CouncilProgressRuntimeTracker {
  const startingState = initialState(input)
  const logicalRequestId = safeCorrelationId(input.logicalRequestId)
  const logicalTurnIndex = safeTurnNumber(input.logicalTurnIndex)
  const logicalTurnTotal = safeTurnNumber(input.logicalTurnTotal)
  const logicalExpectedFamilies = input.logicalExpectedFamilies
    ? [...input.logicalExpectedFamilies]
    : [...input.expectedFamilies]
  let currentState = cloneState(startingState)
  let nextSequence = 1
  let status: CouncilProgressRuntimeSnapshot['status'] = 'recording'
  const events: CouncilProgressEventEnvelope[] = []
  const eventIdentities = new Map<string, string>()
  const diagnostics: CouncilProgressRuntimeDiagnostic[] = []
  let ignoredDuplicateCount = 0

  function snapshot(): CouncilProgressRuntimeSnapshot {
    return {
      schemaVersion: '47c3.council-progress-runtime.v1',
      requestId: startingState.requestId,
      logicalRequestId,
      logicalTurnIndex,
      logicalTurnTotal,
      logicalExpectedFamilies,
      status,
      eventCount: events.length,
      appliedEventCount: events.length,
      ignoredDuplicateCount,
      rejectedEventCount: diagnostics.length,
      events: cloneEvents(events),
      state: cloneState(currentState),
      diagnostics: JSON.parse(JSON.stringify(diagnostics)) as CouncilProgressRuntimeDiagnostic[],
    }
  }

  function notifyObserver(event: CouncilProgressEventEnvelope): void {
    if (!input.eventObserver) return
    try {
      input.eventObserver({
        event: JSON.parse(JSON.stringify(event)) as CouncilProgressEventEnvelope,
        snapshot: snapshot(),
      })
    } catch {
      // Transport observers are isolated from authoritative progress recording.
    }
  }

  function rejected(
    code: string,
    eventType: CouncilProgressEventType,
    message: string,
    issueCodes: string[],
    event: CouncilProgressEventEnvelope | null,
  ): CouncilProgressRuntimeRecordResult {
    const diagnostic = {
      code,
      eventType,
      message,
      issueCodes,
      occurredAt: new Date().toISOString(),
    }
    diagnostics.push(diagnostic)
    status = 'degraded'
    return { ok: false, event, diagnostic }
  }

  function record(inputRecord: CouncilProgressRuntimeRecordInput): CouncilProgressRuntimeRecordResult {
    try {
      if (status === 'closed') {
        return rejected('runtime_progress_closed', inputRecord.eventType, 'Progress tracker is already closed.', [], null)
      }
      const occurredAt = inputRecord.occurredAt ?? new Date().toISOString()
      const event = createCouncilProgressEvent({
        eventId: safeRuntimeId(`cpe-${inputRecord.eventType}`),
        requestId: startingState.requestId,
        sequence: nextSequence,
        eventType: inputRecord.eventType,
        occurredAt,
        source: inputRecord.source,
        family: inputRecord.family ?? null,
        executionId: inputRecord.family ? councilFamilyExecutionId(`${startingState.requestId}-${inputRecord.family}`) : null,
        payload: inputRecord.payload ?? {},
        visibility: defaultVisibilityState({ diagnosticOnly: inputRecord.eventType === 'diagnostic_recorded' }),
      })
      const priorIdentity = eventIdentities.get(event.eventId)
      if (priorIdentity) {
        if (priorIdentity === eventIdentity(event)) {
          ignoredDuplicateCount += 1
          return { ok: true, event, ignoredDuplicate: true }
        }
        return rejected('runtime_conflicting_duplicate_event', event.eventType, 'Conflicting duplicate event rejected before state mutation.', ['conflicting_duplicate_event_id'], event)
      }

      const candidateEvents = [...events, event]
      const replay = replayCandidate(startingState, candidateEvents)
      if (!replay.ok) {
        return rejected(
          'runtime_progress_replay_rejected',
          event.eventType,
          'Candidate progress event was rejected by replay before state mutation.',
          replay.issues.map(issue => issue.code),
          event,
        )
      }

      events.push(event)
      eventIdentities.set(event.eventId, eventIdentity(event))
      currentState = replay.finalState
      nextSequence += 1
      notifyObserver(event)
      return { ok: true, event, ignoredDuplicate: false }
    } catch (error) {
      return rejected(
        'runtime_progress_exception',
        inputRecord.eventType,
        error instanceof Error ? error.message : 'Progress runtime failed without throwing into Council response path.',
        [],
        null,
      )
    }
  }

  function recordRaw(event: CouncilProgressEventEnvelope): CouncilProgressRuntimeRecordResult {
    try {
      if (status === 'closed') {
        return rejected('runtime_progress_closed', event.eventType, 'Progress tracker is already closed.', [], null)
      }
      const priorIdentity = eventIdentities.get(event.eventId)
      if (priorIdentity) {
        if (priorIdentity === eventIdentity(event)) {
          ignoredDuplicateCount += 1
          return { ok: true, event, ignoredDuplicate: true }
        }
        return rejected('runtime_conflicting_duplicate_event', event.eventType, 'Conflicting duplicate event rejected before state mutation.', ['conflicting_duplicate_event_id'], event)
      }

      const candidateEvents = [...events, event]
      const replay = replayCandidate(startingState, candidateEvents)
      if (!replay.ok) {
        return rejected(
          'runtime_progress_replay_rejected',
          event.eventType,
          'Candidate progress event was rejected by replay before state mutation.',
          replay.issues.map(issue => issue.code),
          event,
        )
      }

      events.push(event)
      eventIdentities.set(event.eventId, eventIdentity(event))
      currentState = replay.finalState
      nextSequence = Math.max(nextSequence, event.sequence + 1)
      notifyObserver(event)
      return { ok: true, event, ignoredDuplicate: false }
    } catch (error) {
      return rejected(
        'runtime_progress_exception',
        event.eventType,
        error instanceof Error ? error.message : 'Progress runtime failed without throwing into Council response path.',
        [],
        null,
      )
    }
  }

  return {
    requestId: startingState.requestId,
    selectedFamilies: [...input.selectedFamilies],
    record,
    recordRaw,
    recordDiagnostic(code, safeMessage) {
      const diagnostic: CouncilDiagnosticMetadata = {
        category: 'validation',
        code,
        safeMessage,
      }
      return record({
        eventType: 'diagnostic_recorded',
        source: 'diagnostic_layer',
        payload: { diagnostic },
      })
    },
    closeIfTerminal() {
      if (currentState.completionSummary.missingTerminalFamilies.length > 0) return null
      const summary = currentState.completionSummary
      const eventType =
        summary.completeCount > 0 || summary.fallbackUsedCount > 0
          ? 'request_completed'
          : summary.failedCount > 0 || summary.notReachedCount > 0
          ? 'request_failed'
          : summary.timedOutCount > 0
            ? 'request_timed_out'
            : 'request_completed'
      const result = record({ eventType, source: 'server_orchestrator' })
      if (result.ok) status = 'closed'
      return result
    },
    snapshot,
  }
}

export function attachCouncilProgress<T extends Record<string, unknown>>(
  payload: T,
  tracker: CouncilProgressRuntimeTracker | null,
): T & { councilProgress?: CouncilProgressRuntimeSnapshot } {
  try {
    if (!tracker) return payload
    return { ...payload, councilProgress: tracker.snapshot() }
  } catch {
    return payload
  }
}

export function providerStatusToProgressOutcome(status: string): CouncilFamilyOutcome {
  if (status === 'OK') return 'complete'
  if (status === 'TIMED_OUT') return 'timed_out'
  if (status === 'UNAVAILABLE') return 'not_reached'
  return 'failed'
}

export function providerStatusToReadiness(status: string): CouncilProviderReadiness {
  if (status === 'OK') return 'connected'
  if (status === 'UNAVAILABLE') return 'unavailable'
  if (status === 'TIMED_OUT' || status === 'FAILED') return 'configured'
  return 'unknown'
}

export function buildSyntheticIntegrityAuditPayload(input: {
  expectedFamilies: CouncilOrchestrationFamily[]
  providerResults: { family: string; status: string }[]
}): CouncilAuditPayload {
  const receivedFamilies = input.expectedFamilies.filter(family => {
    const label = familyDisplayName(family)
    return input.providerResults.some(result => result.family === label && result.status === 'OK')
  })
  const missingFamilies = input.expectedFamilies.filter(family => !receivedFamilies.includes(family))
  return {
    scope: missingFamilies.length > 0 ? 'partial_record' : 'complete_record',
    reviewType: 'synthetic_integrity',
    expectedFamilies: [...input.expectedFamilies],
    receivedFamilies,
    missingFamilies,
    currentTurnPriorResponsesReceived: false,
    notes: 'Synthetic integrity accounting only; Red Team was not invoked as an external provider.',
  }
}

function familyDisplayName(family: CouncilOrchestrationFamily): string {
  if (family === 'chatgpt') return 'ChatGPT'
  if (family === 'claude') return 'Claude'
  if (family === 'grok') return 'Grok'
  if (family === 'gemini') return 'Gemini'
  if (family === 'kimi') return 'Kimi'
  if (family === 'red_team') return 'RED TEAM'
  if (family === 'baby') return 'Baby AI'
  if (family === 'bridge_architect') return 'Bridge Architect'
  return family
}
