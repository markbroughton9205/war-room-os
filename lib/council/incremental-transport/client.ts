'use client'

import { postCouncilChat } from '@/lib/council/liveChatPipeline'
import {
  createCouncilStreamReconciliationState,
  reconcileCouncilStreamEnvelope,
} from './reconcile'
import { createCouncilSseParser } from './sse'
import type {
  CouncilStreamClosed,
  CouncilStreamError,
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

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.body),
    signal: options.signal,
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
  const handleParserEvent = (event: CouncilStreamParserEvent) => {
    if (!event.ok) {
      callbacks.onMalformedEnvelope?.(event)
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
      callbacks.onError?.(error)
      return
    }
    if (!reconciled.accepted) return
    if (event.envelope.envelopeType !== 'opened') executionStarted = true
    if (event.envelope.envelopeType === 'opened') callbacks.onOpened?.(event.envelope)
    if (event.envelope.envelopeType === 'progress') {
      progressCount += 1
      callbacks.onProgress?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'final') {
      finalResponse = event.envelope.finalResponse
      responseStatus = event.envelope.httpStatus
      responseOk = event.envelope.ok
      callbacks.onFinal?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'error') {
      error = event.envelope
      callbacks.onError?.(event.envelope)
    }
    if (event.envelope.envelopeType === 'closed') {
      closed = event.envelope
      callbacks.onClosed?.(event.envelope)
    }
  }
  const parser = createCouncilSseParser(handleParserEvent)

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      parser.push(decoder.decode(chunk.value, { stream: true }))
      if (error) break
    }
    parser.push(decoder.decode())
    parser.flush()
  } finally {
    parser.reset()
    reader.releaseLock()
  }

  if (!finalResponse && !error && !options.signal?.aborted) {
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
