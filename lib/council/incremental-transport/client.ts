'use client'

import { postCouncilChat } from '@/lib/council/liveChatPipeline'
import { matrixStatus } from '@/lib/ui/matrixStatusBus'
import {
  createCouncilStreamReconciliationState,
  reconcileCouncilStreamEnvelope,
} from './reconcile'
import { createCouncilSseParser } from './sse'
import type {
  CouncilStreamChunkDiagnostic,
  CouncilStreamClosed,
  CouncilStreamError,
  CouncilStreamFrameDiagnostic,
  CouncilStreamParserEvent,
  CouncilStreamResult,
  IncrementalCouncilChatOptions,
} from './types'

function isTextEventStream(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')
}

export async function postIncrementalCouncilChat(options: IncrementalCouncilChatOptions): Promise<CouncilStreamResult> {
  const state = createCouncilStreamReconciliationState()
  const callbacks = options.callbacks ?? {}
  let finalResponse: CouncilStreamResult['finalResponse'] = null
  let responseStatus: number | null = null
  let responseOk: boolean | null = null
  let closed: CouncilStreamClosed | null = null
  let error: CouncilStreamError | null = null
  let progressCount = 0
  let executionStarted = false
  let chunkIndex = 0

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body),
    signal: options.signal,
  })
  callbacks.onResponse?.({
    requestUrl: '/api/chat/stream',
    requestMethod: 'POST',
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    connection: response.headers.get('connection'),
    transportAvailable: isTextEventStream(response),
  })

  if (!isTextEventStream(response)) {
    if (options.fallback === 'final_snapshot_before_execution_only' && !executionStarted) {
      const fallback = await postCouncilChat(options.body, options.signal)
      return {
        finalResponse: fallback.data,
        responseStatus: fallback.res.status,
        responseOk: fallback.res.ok,
        closed: null,
        error: null,
        progressCount: 0,
        transportStarted: false,
      }
    }
    matrixStatus('error', 'Council stream transport unavailable')
    return {
      finalResponse: null,
      responseStatus: response.status,
      responseOk: response.ok,
      closed: null,
      error: {
        version: '48c4c.council-stream.v1',
        envelopeType: 'error',
        requestId: 'transport-unavailable',
        operationId: null,
        sequence: 0,
        emittedAt: new Date().toISOString(),
        error: {
          code: 'stream_transport_unavailable',
          message: 'Incremental Council transport was unavailable.',
          terminal: true,
          classification: 'transport',
        },
      },
      progressCount: 0,
      transportStarted: false,
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Incremental Council transport response did not include a readable body.')
  }

  const decoder = new TextDecoder()
  const recordChunk = (input: Omit<CouncilStreamChunkDiagnostic, 'abortSignalState'>) => {
    callbacks.onChunk?.({
      ...input,
      abortSignalState: options.signal ? (options.signal.aborted ? 'aborted' : 'active') : 'none',
    })
  }
  const handleParserEvent = (event: CouncilStreamParserEvent) => {
    if (!event.ok) {
      callbacks.onMalformedEnvelope?.(event)
      matrixStatus('error', 'Council stream sent a malformed envelope')
      error = {
        version: '48c4c.council-stream.v1',
        envelopeType: 'error',
        requestId: state.requestId ?? 'malformed-stream',
        operationId: state.operationId,
        sequence: state.highestSequence + 1,
        emittedAt: new Date().toISOString(),
        error: event.error,
      }
      return
    }
    const reconciled = reconcileCouncilStreamEnvelope(state, event.envelope)
    if (!reconciled.ok) {
      error = {
        version: '48c4c.council-stream.v1',
        envelopeType: 'error',
        requestId: state.requestId ?? event.envelope.requestId,
        operationId: state.operationId ?? event.envelope.operationId,
        sequence: event.envelope.sequence,
        emittedAt: new Date().toISOString(),
        error: reconciled.error,
      }
      matrixStatus('error', 'Council stream reconciliation failed')
      callbacks.onError?.(error)
      return
    }
    if (!reconciled.accepted) return
    if (event.envelope.envelopeType !== 'opened') executionStarted = true
    // Matrix runtime signals sit at this single real dispatch point for the whole SSE lifecycle
    // -- every actual Council decree submitted through the composer goes through here -- rather
    // than being duplicated at each of the several callers of postIncrementalCouncilChat.
    if (event.envelope.envelopeType === 'opened') {
      matrixStatus('inbound', 'Council stream opened')
      callbacks.onOpened?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'progress') {
      progressCount += 1
      matrixStatus('inbound', 'Council response streaming…')
      callbacks.onProgress?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'final') {
      finalResponse = event.envelope.finalResponse
      responseStatus = event.envelope.httpStatus
      responseOk = event.envelope.ok
      matrixStatus(event.envelope.ok ? 'success' : 'error', event.envelope.ok ? 'Council response complete' : 'Council response failed')
      callbacks.onFinal?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'error') {
      error = event.envelope
      matrixStatus('error', event.envelope.error?.message || 'Council stream failed')
      callbacks.onError?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'closed') {
      closed = event.envelope
      callbacks.onClosed?.(event.envelope)
    }
  }
  const parser = createCouncilSseParser(handleParserEvent, {
    onFrame: (diagnostic: CouncilStreamFrameDiagnostic) => callbacks.onFrame?.(diagnostic),
  })

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const decoded = decoder.decode(chunk.value, { stream: true })
      chunkIndex += 1
      recordChunk({
        chunkIndex,
        byteLength: chunk.value.byteLength,
        decodedLength: decoded.length,
        finalDecoderFlush: false,
      })
      parser.push(decoded)
      if (error) break
    }
    const finalDecoded = decoder.decode()
    if (finalDecoded.length > 0) {
      chunkIndex += 1
      recordChunk({
        chunkIndex,
        byteLength: 0,
        decodedLength: finalDecoded.length,
        finalDecoderFlush: true,
      })
      parser.push(finalDecoded)
    }
    parser.flush()
  } finally {
    parser.reset()
    reader.releaseLock()
  }

  if (!finalResponse && !error && !options.signal?.aborted) {
    matrixStatus('error', 'Council stream ended without a final response')
    error = {
      version: '48c4c.council-stream.v1',
      envelopeType: 'error',
      requestId: state.requestId ?? 'stream-ended-without-final',
      operationId: state.operationId,
      sequence: state.highestSequence + 1,
      emittedAt: new Date().toISOString(),
      error: {
        code: 'stream_ended_without_final',
        message: 'Council stream ended before the final response arrived; operation state is uncertain.',
        terminal: true,
        classification: 'transport',
      },
    }
  }

  return { finalResponse, responseStatus, responseOk, closed, error, progressCount, transportStarted: true }
}
