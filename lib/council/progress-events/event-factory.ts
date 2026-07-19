import { defaultVisibilityState, type CouncilFamilyExecutionId, type CouncilRequestId } from '@/lib/council/request-state/types'
import {
  COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
  councilProgressEventId,
  type CouncilProgressEventEnvelope,
  type CouncilProgressEventId,
  type CouncilProgressEventPayload,
  type CouncilProgressEventSource,
  type CouncilProgressEventType,
  type CouncilProgressEventVisibility,
} from './types'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type CouncilProgressEventFactoryInput = {
  eventId: string | CouncilProgressEventId
  requestId: CouncilRequestId
  sequence: number
  eventType: CouncilProgressEventType
  occurredAt: string
  source: CouncilProgressEventSource
  emittedAt?: string | null
  executionId?: CouncilFamilyExecutionId | null
  family?: CouncilOrchestrationFamily | null
  payload?: CouncilProgressEventPayload
  visibility?: Partial<CouncilProgressEventVisibility>
}

export function createCouncilProgressEvent(input: CouncilProgressEventFactoryInput): CouncilProgressEventEnvelope {
  return {
    schemaVersion: COUNCIL_PROGRESS_EVENT_SCHEMA_VERSION,
    eventId: councilProgressEventId(String(input.eventId)),
    requestId: input.requestId,
    executionId: input.executionId ?? null,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    emittedAt: input.emittedAt ?? input.occurredAt,
    family: input.family ?? null,
    source: input.source,
    payload: input.payload ?? {},
    visibility: defaultVisibilityState(input.visibility ?? {}),
    diagnostic: input.payload?.diagnostic ?? null,
  }
}
