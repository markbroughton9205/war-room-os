import type { CouncilProgressEventEnvelope } from '@/lib/council/progress-events/types'
import type { CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import type { CouncilChatJson, CouncilChatRequestBody } from '@/lib/council/liveChatPipeline'

export const COUNCIL_STREAM_VERSION = '48c4c.council-stream.v1' as const

export type CouncilStreamEnvelopeType = 'opened' | 'progress' | 'final' | 'error' | 'closed'

export type CouncilStreamTerminalState =
  | 'execution_completed'
  | 'transport_closed'
  | 'transport_error'
  | 'client_disconnected'
  | 'operation_state_uncertain'
  | 'validation_failed_before_execution'

export type CouncilStreamSanitizedError = {
  code: string
  message: string
  terminal: boolean
  classification: 'validation' | 'auth' | 'provider' | 'transport' | 'runtime' | 'unknown'
}

export type CouncilStreamChunkDiagnostic = {
  chunkIndex: number
  byteLength: number
  decodedLength: number
  finalDecoderFlush: boolean
  abortSignalState: 'aborted' | 'active' | 'none'
}

export type CouncilStreamResponseDiagnostic = {
  requestUrl: '/api/chat/stream'
  requestMethod: 'POST'
  status: number
  ok: boolean
  contentType: string | null
  cacheControl: string | null
  connection: string | null
  transportAvailable: boolean
}

export type CouncilStreamFrameDiagnostic = {
  frameIndex: number
  eventName: string | null
  id: string | null
  retry: number | null
  dataLineCount: number
  dataCharLength: number
  envelopeType: CouncilStreamEnvelopeType | null
  parseStatus: 'ignored_comment' | 'parsed' | 'malformed_json' | 'malformed_envelope' | 'event_name_mismatch'
}

export type CouncilStreamEnvelopeBase = {
  version: typeof COUNCIL_STREAM_VERSION
  envelopeType: CouncilStreamEnvelopeType
  requestId: string
  operationId: string | null
  sequence: number
  emittedAt: string
}

export type CouncilStreamOpened = CouncilStreamEnvelopeBase & {
  envelopeType: 'opened'
  transport: 'sse'
  streamingSupported: true
}

export type CouncilStreamProgress = CouncilStreamEnvelopeBase & {
  envelopeType: 'progress'
  progressEvent: CouncilProgressEventEnvelope
  snapshot: CouncilProgressRuntimeSnapshot
}

export type CouncilStreamFinal = CouncilStreamEnvelopeBase & {
  envelopeType: 'final'
  httpStatus: number
  ok: boolean
  status: 'completed' | 'partial' | 'failed'
  finalResponse: CouncilChatJson
  finalProgress: CouncilProgressRuntimeSnapshot | null
  readableContributionCount: number
  runtimeEventCount: number
  completedAt: string
}

export type CouncilStreamError = CouncilStreamEnvelopeBase & {
  envelopeType: 'error'
  error: CouncilStreamSanitizedError
}

export type CouncilStreamClosed = CouncilStreamEnvelopeBase & {
  envelopeType: 'closed'
  terminalState: CouncilStreamTerminalState
}

export type CouncilStreamEnvelope =
  | CouncilStreamOpened
  | CouncilStreamProgress
  | CouncilStreamFinal
  | CouncilStreamError
  | CouncilStreamClosed

export type CouncilStreamParserEvent =
  | { ok: true; envelope: CouncilStreamEnvelope; eventName: string | null; id: string | null; retry: number | null }
  | { ok: false; error: CouncilStreamSanitizedError; rawFrame: string; eventName: string | null; id: string | null; retry: number | null }

export type CouncilStreamCallbacks = {
  onOpened?: (envelope: CouncilStreamOpened) => void
  onProgress?: (envelope: CouncilStreamProgress) => void
  onFinal?: (envelope: CouncilStreamFinal) => void
  onError?: (envelope: CouncilStreamError) => void
  onClosed?: (envelope: CouncilStreamClosed) => void
  onMalformedEnvelope?: (event: Extract<CouncilStreamParserEvent, { ok: false }>) => void
  onResponse?: (diagnostic: CouncilStreamResponseDiagnostic) => void
  onChunk?: (diagnostic: CouncilStreamChunkDiagnostic) => void
  onFrame?: (diagnostic: CouncilStreamFrameDiagnostic) => void
}

export type CouncilStreamResult = {
  finalResponse: CouncilChatJson | null
  responseStatus: number | null
  responseOk: boolean | null
  closed: CouncilStreamClosed | null
  error: CouncilStreamError | null
  progressCount: number
  transportStarted: boolean
}

export type IncrementalCouncilChatOptions = {
  body: CouncilChatRequestBody
  signal?: AbortSignal
  callbacks?: CouncilStreamCallbacks
  fallback?: 'disabled' | 'final_snapshot_before_execution_only'
}

export type CouncilStreamReconciliationState = {
  requestId: string | null
  operationId: string | null
  highestSequence: number
  seenSequences: Set<number>
  progressEventIds: Set<string>
  finalDelivered: boolean
  closed: boolean
  stale: boolean
}
