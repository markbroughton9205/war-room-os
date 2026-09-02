import type { ExecuteCouncilChatRequestOptions } from '../execute'
import type { CouncilChatJson } from '@/lib/council/liveChatPipeline'
import type { CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import {
  COUNCIL_STREAM_VERSION,
  encodeCouncilStreamEnvelope,
  sanitizeCouncilStreamError,
  type CouncilStreamEnvelope,
  type CouncilStreamTerminalState,
} from '@/lib/council/incremental-transport'

export const dynamic = 'force-dynamic'

type CouncilStreamExecutor = (req: Request, options?: ExecuteCouncilChatRequestOptions) => Promise<Response>

const defaultCouncilStreamExecutor: CouncilStreamExecutor = async (req, options) => {
  const mod = await import('../execute')
  return mod.executeCouncilChatRequest(req, options)
}

function safeTransportId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `transport-${random}`
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isCouncilChatJson(value: unknown): value is CouncilChatJson {
  return Boolean(value && typeof value === 'object')
}

function readableContributionCount(data: CouncilChatJson): number {
  const seen = new Set<string>()
  const add = (family: unknown, content: unknown) => {
    if (typeof content !== 'string' || content.trim().length < 5) return
    const familyKey = typeof family === 'string' ? family.trim().toLowerCase() : 'provider'
    const contentKey = content.trim()
    seen.add(`${familyKey}|${contentKey}`)
  }
  if (typeof data.councilSingleResponse === 'string') add(data.councilSingleFamily ?? 'synthesis', data.councilSingleResponse)
  for (const result of Array.isArray(data.results) ? data.results : []) {
    if (result.status === 'OK') add(result.family, result.content)
  }
  const turns = data.familyDeliberation?.turns ?? []
  for (const turn of turns) {
    if (turn.completion_status === 'complete') add(turn.provider_family, turn.full_response)
  }
  return seen.size
}

function finalStatusFor(data: CouncilChatJson, responseOk: boolean): 'completed' | 'partial' | 'failed' {
  if (!responseOk) return 'failed'
  const count = readableContributionCount(data)
  if (count > 0) return data.councilProviderHttpStatus === 'failed' || data.councilProviderHttpStatus === 'timed_out' ? 'partial' : 'completed'
  return 'failed'
}

export function createCouncilStreamPostHandler(executeRequest: CouncilStreamExecutor = defaultCouncilStreamExecutor) {
  return async function councilStreamPost(req: Request) {
  const encoder = new TextEncoder()
  const transportId = safeTransportId()
  let sequence = 0
  let opened = false
  let closed = false
  let operationId: string | null = null
  let finalSent = false
  let finalProgress: CouncilProgressRuntimeSnapshot | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (envelope: CouncilStreamEnvelope): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeCouncilStreamEnvelope(envelope)))
        } catch {
          closed = true
        }
      }
      const emitOpened = (requestId: string): void => {
        if (opened) return
        opened = true
        operationId = requestId
        emit({
          version: COUNCIL_STREAM_VERSION,
          envelopeType: 'opened',
          requestId,
          operationId,
          sequence: sequence++,
          emittedAt: new Date().toISOString(),
          transport: 'sse',
          streamingSupported: true,
        })
      }
      const emitClosed = (requestId: string, terminalState: CouncilStreamTerminalState): void => {
        if (closed) return
        emit({
          version: COUNCIL_STREAM_VERSION,
          envelopeType: 'closed',
          requestId,
          operationId,
          sequence: sequence++,
          emittedAt: new Date().toISOString(),
          terminalState,
        })
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      const emitError = (requestId: string, error: unknown, code = 'stream_runtime_error'): void => {
        if (closed) return
        emit({
          version: COUNCIL_STREAM_VERSION,
          envelopeType: 'error',
          requestId,
          operationId,
          sequence: sequence++,
          emittedAt: new Date().toISOString(),
          error: sanitizeCouncilStreamError(error, code),
        })
      }

      req.signal.addEventListener('abort', () => {
        const requestId = operationId ?? transportId
        emitClosed(requestId, 'client_disconnected')
      }, { once: true })

      void (async () => {
        try {
          const response = await executeRequest(req, {
            progressEventObserver: ({ event, snapshot }) => {
              finalProgress = cloneJson(snapshot)
              emitOpened(String(event.requestId))
              emit({
                version: COUNCIL_STREAM_VERSION,
                envelopeType: 'progress',
                requestId: String(event.requestId),
                operationId,
                sequence: sequence++,
                emittedAt: new Date().toISOString(),
                progressEvent: cloneJson(event),
                snapshot: cloneJson(snapshot),
              })
            },
          })
          let responseBody: unknown = {}
          try {
            responseBody = await response.json()
          } catch {
            responseBody = { error: `HTTP ${response.status}` }
          }
          const data: CouncilChatJson = isCouncilChatJson(responseBody) ? responseBody : { error: 'Invalid Council response.' }
          finalProgress = data.councilProgress ?? finalProgress
          // AGI Wave 1 — fire-and-forget experience capture; never awaited on the critical path
          // and never allowed to affect the SSE envelope below.
          void import('@/lib/agi-experience/captureFromChatResponse')
            .then(mod => mod.captureExperienceFromChatJson(data as unknown as Record<string, unknown>))
            .catch(() => null)
          const requestId = finalProgress?.requestId ?? operationId ?? transportId
          if (!opened) emitOpened(requestId)
          if (!response.ok) {
            emitError(requestId, data.error ?? data.message ?? `HTTP ${response.status}`, response.status === 400 ? 'validation_failed_before_execution' : 'chat_route_error')
            emitClosed(requestId, response.status === 400 ? 'validation_failed_before_execution' : 'transport_error')
            return
          }
          if (!finalSent) {
            finalSent = true
            emit({
              version: COUNCIL_STREAM_VERSION,
              envelopeType: 'final',
              requestId,
              operationId,
              sequence: sequence++,
              emittedAt: new Date().toISOString(),
              httpStatus: response.status,
              ok: response.ok,
              status: finalStatusFor(data, response.ok),
              finalResponse: cloneJson(data),
              finalProgress: finalProgress ? cloneJson(finalProgress) : null,
              readableContributionCount: readableContributionCount(data),
              runtimeEventCount: finalProgress?.events.length ?? 0,
              completedAt: new Date().toISOString(),
            })
          }
          emitClosed(requestId, 'execution_completed')
        } catch (error) {
          const requestId = operationId ?? transportId
          if (!opened) emitOpened(requestId)
          emitError(requestId, error)
          emitClosed(requestId, 'operation_state_uncertain')
        }
      })()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
  }
}

export const POST = createCouncilStreamPostHandler()
