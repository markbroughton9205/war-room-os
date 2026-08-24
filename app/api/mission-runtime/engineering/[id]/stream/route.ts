import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import {
  encodeEngineeringStreamEnvelope,
  encodeEngineeringStreamComment,
  isTerminalMissionStatus,
  missionProgressFingerprint,
  type EngineeringStreamEnvelope,
  type EngineeringStreamTerminalState,
} from '@/lib/mission-runtime/engineeringStream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_INTERVAL_MS = 1000
const MIN_INTERVAL_MS = 250
const MAX_INTERVAL_MS = 10_000
const KEEPALIVE_EVERY_N_POLLS = 15

/**
 * Phase F — Engineering Streaming. Read-only: polls the same authoritative
 * strategy.get(id) every other route already reads, diffs a cheap fingerprint, and emits a
 * complete current-state envelope on change. Never gated — nothing here mutates anything.
 * Closes itself once the mission reaches a terminal status, or immediately if the mission does
 * not exist. Optional ?intervalMs= (bounded 250-10000, default 1000) and ?workspaceId=.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspaceId')
  const rawInterval = Number(url.searchParams.get('intervalMs'))
  const intervalMs = Number.isFinite(rawInterval)
    ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, rawInterval))
    : DEFAULT_INTERVAL_MS

  const encoder = new TextEncoder()
  let sequence = 0
  let closed = false
  let timer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (envelope: EngineeringStreamEnvelope): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeEngineeringStreamEnvelope(envelope)))
        } catch {
          closed = true
        }
      }
      const emitComment = (comment: string): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeEngineeringStreamComment(comment)))
        } catch {
          closed = true
        }
      }
      const stop = (): void => {
        if (timer) clearInterval(timer)
        timer = null
      }
      const closeWith = (terminalState: EngineeringStreamTerminalState): void => {
        if (closed) return
        emit({ version: 1, envelopeType: 'closed', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), terminalState })
        closed = true
        stop()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener('abort', () => closeWith('client_disconnected'), { once: true })

      void (async () => {
        const result = await runInResolvedWorkspace(workspaceId, async () => {
          const strategy = getMissionExecutionStrategy('engineering')
          return strategy.get(id)
        })
        if (!result.ok) {
          emit({ version: 1, envelopeType: 'error', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), error: { code: 'workspace_error', message: 'Unable to resolve workspace.' } })
          closeWith('not_found')
          return
        }
        const initial = result.value
        if (!initial) {
          emit({ version: 1, envelopeType: 'error', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), error: { code: 'mission_not_found', message: `No mission found for id ${id}.` } })
          closeWith('not_found')
          return
        }

        emit({ version: 1, envelopeType: 'opened', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), missionId: id })
        emit({ version: 1, envelopeType: 'progress', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), mission: initial })
        let lastFingerprint = missionProgressFingerprint(initial)
        if (isTerminalMissionStatus(initial.status)) {
          emit({ version: 1, envelopeType: 'final', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), mission: initial })
          closeWith('mission_terminal')
          return
        }

        let pollCount = 0
        timer = setInterval(() => {
          void (async () => {
            if (closed) return
            pollCount += 1
            const polled = await runInResolvedWorkspace(workspaceId, async () => {
              const strategy = getMissionExecutionStrategy('engineering')
              return strategy.get(id)
            })
            if (!polled.ok || !polled.value) return
            const mission = polled.value
            const fingerprint = missionProgressFingerprint(mission)
            if (fingerprint === lastFingerprint) {
              if (pollCount % KEEPALIVE_EVERY_N_POLLS === 0) emitComment('keepalive')
              return
            }
            lastFingerprint = fingerprint
            if (isTerminalMissionStatus(mission.status)) {
              emit({ version: 1, envelopeType: 'final', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), mission })
              closeWith('mission_terminal')
              return
            }
            emit({ version: 1, envelopeType: 'progress', requestId: id, sequence: sequence++, emittedAt: new Date().toISOString(), mission })
          })()
        }, intervalMs)
      })()
    },
    cancel() {
      closed = true
      if (timer) clearInterval(timer)
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
