import {
  councilFamilyExecutionId,
  councilRequestId,
  defaultVisibilityState,
  type CouncilFamilyExecutionId,
  type CouncilRequestId,
  type CouncilRequestStateRecord,
} from '@/lib/council/request-state/types'
import { makeExecution, makeRequest, terminalExecution } from '@/lib/council/request-state/fixtures'
import { createCouncilProgressEvent } from './event-factory'
import type {
  CouncilProgressEventEnvelope,
  CouncilProgressEventSource,
  CouncilProgressEventType,
  CouncilProgressFixtureIds,
} from './types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const PROGRESS_FIXTURE_TIME = '2026-07-19T00:00:00.000Z'

export const PROGRESS_FIXTURE_IDS: CouncilProgressFixtureIds = {
  requestId: councilRequestId('request-47c2-fixture'),
  chatgptExecutionId: councilFamilyExecutionId('exec-47c2-chatgpt'),
  claudeExecutionId: councilFamilyExecutionId('exec-47c2-claude'),
  grokExecutionId: councilFamilyExecutionId('exec-47c2-grok'),
}

export function makeProgressRequestState(
  overrides: Partial<CouncilRequestStateRecord> = {},
): CouncilRequestStateRecord {
  const requestId = overrides.requestId ?? PROGRESS_FIXTURE_IDS.requestId
  const chatgpt = makeExecution({
    family: 'chatgpt',
    requestId,
    executionId: PROGRESS_FIXTURE_IDS.chatgptExecutionId,
    lifecycle: 'waiting',
    outcome: null,
    queuedAt: null,
    dispatchedAt: null,
    completedAt: null,
  })
  const claude = makeExecution({
    family: 'claude',
    requestId,
    executionId: PROGRESS_FIXTURE_IDS.claudeExecutionId,
    lifecycle: 'waiting',
    outcome: null,
    queuedAt: null,
    dispatchedAt: null,
    completedAt: null,
  })
  return makeRequest({
    requestId,
    expectedFamilies: ['chatgpt', 'claude'],
    selectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [chatgpt, claude],
    ...overrides,
  })
}

export function makeTerminalProgressState(): CouncilRequestStateRecord {
  return makeRequest({
    requestId: PROGRESS_FIXTURE_IDS.requestId,
    expectedFamilies: ['chatgpt', 'claude'],
    selectedFamilies: ['chatgpt', 'claude'],
    familyExecutions: [
      {
        ...terminalExecution('chatgpt', 'complete'),
        requestId: PROGRESS_FIXTURE_IDS.requestId,
        executionId: PROGRESS_FIXTURE_IDS.chatgptExecutionId,
      },
      {
        ...terminalExecution('claude', 'complete'),
        requestId: PROGRESS_FIXTURE_IDS.requestId,
        executionId: PROGRESS_FIXTURE_IDS.claudeExecutionId,
      },
    ],
  })
}

export function eventFor(
  sequence: number,
  eventType: CouncilProgressEventType,
  family?: CouncilOrchestrationFamily,
  overrides: Partial<CouncilProgressEventEnvelope> = {},
): CouncilProgressEventEnvelope {
  const executionId: CouncilFamilyExecutionId | null = family === 'chatgpt'
    ? PROGRESS_FIXTURE_IDS.chatgptExecutionId
    : family === 'claude'
      ? PROGRESS_FIXTURE_IDS.claudeExecutionId
      : family === 'grok'
        ? PROGRESS_FIXTURE_IDS.grokExecutionId
        : null
  const source: CouncilProgressEventSource = eventType.startsWith('request_')
    ? 'server_orchestrator'
    : eventType.startsWith('audit_')
      ? 'integrity_layer'
      : eventType.startsWith('fallback_')
        ? 'fallback_layer'
        : eventType === 'diagnostic_recorded'
          ? 'diagnostic_layer'
          : 'provider_adapter'
  return {
    ...createCouncilProgressEvent({
      eventId: `event-47c2-${sequence}-${eventType}-${family ?? 'request'}`,
      requestId: PROGRESS_FIXTURE_IDS.requestId,
      sequence,
      eventType,
      occurredAt: `2026-07-19T00:00:${String(sequence).padStart(2, '0')}.000Z`,
      source,
      executionId,
      family: family ?? null,
      visibility: defaultVisibilityState({ diagnosticOnly: eventType === 'diagnostic_recorded' }),
    }),
    ...overrides,
  }
}

export function rawMalformedEvent(overrides: Record<string, unknown>): CouncilProgressEventEnvelope {
  return ({
    schemaVersion: 'malformed',
    eventId: 'malformed',
    requestId: PROGRESS_FIXTURE_IDS.requestId,
    sequence: 1,
    eventType: 'request_created',
    occurredAt: PROGRESS_FIXTURE_TIME,
    emittedAt: PROGRESS_FIXTURE_TIME,
    family: null,
    source: 'server_orchestrator',
    payload: {},
    visibility: defaultVisibilityState(),
    ...overrides,
  } as unknown) as CouncilProgressEventEnvelope
}

export function requestId(value: string): CouncilRequestId {
  return councilRequestId(value)
}
