import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { getNodeConnectionStatus } from '@/lib/wr-engineer/node/identity'
import { deriveProposalState } from '@/lib/wr-engineer/session/proposalState'
import { getRepair } from '@/lib/native-builder/storage'
import {
  computeStreamDeltas,
  encodeWrEngineerStreamComment,
  encodeWrEngineerStreamEnvelope,
  snapshotToBaseline,
  type StreamBaseline,
  type WrEngineerSessionSnapshot,
  type StreamEnvelopePayload,
  type WrEngineerStreamEnvelope,
} from '@/lib/wr-engineer/sessionStream'
import type { EngineeringSession } from '@/lib/wr-engineer/session/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_INTERVAL_MS = 1500
const MIN_INTERVAL_MS = 500
const MAX_INTERVAL_MS = 10_000
const KEEPALIVE_EVERY_N_POLLS = 10
const MAX_CONNECTION_MS = 30 * 60 * 1000

async function buildSnapshot(sessionId: string): Promise<{ session: EngineeringSession; snapshot: WrEngineerSessionSnapshot } | null> {
  const session = await wrEngineerSessionStore.getSession(sessionId)
  if (!session) return null

  const [messages, toolEvents, node, repair] = await Promise.all([
    wrEngineerSessionStore.listMessages(sessionId),
    wrEngineerSessionStore.listToolEvents(sessionId),
    wrEngineerNodeStore.getNode(session.nodeId),
    session.nativeBuilderRepairId ? getRepair(session.nativeBuilderRepairId) : Promise.resolve(null),
  ])

  return {
    session,
    snapshot: {
      session,
      proposalState: deriveProposalState(session, repair?.state ?? null),
      repairState: repair?.state ?? null,
      messages,
      toolEvents,
      nodeStatus: node ? getNodeConnectionStatus(node) : null,
    },
  }
}

/**
 * Push-based replacement for the Phase 2 4-second poll — same ReadableStream + setInterval shape as
 * app/api/mission-runtime/engineering/[id]/stream/route.ts (see that route's own header). The
 * delta/diff logic itself lives in lib/wr-engineer/sessionStream.ts's computeStreamDeltas() (pure,
 * unit-tested independent of this transport plumbing) — this route only wires that function to a
 * ReadableStream and a poll interval. Read-only: nothing here mutates a session, node, or repair.
 * The plain-JSON snapshot route (app/api/wr-engineer/sessions/[sessionId]/route.ts) is UNCHANGED and
 * stays the client's explicit-refresh/reconnect-fallback path, per the mission brief.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const commanderSession = await requireCommanderSession('WR-Engineer session stream')
  if (!commanderSession.ok) return commanderSession.response

  const { sessionId } = await params
  const url = new URL(req.url)
  const rawInterval = Number(url.searchParams.get('intervalMs'))
  const intervalMs = Number.isFinite(rawInterval)
    ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, rawInterval))
    : DEFAULT_INTERVAL_MS

  const initial = await buildSnapshot(sessionId)
  if (!initial || initial.session.commanderUserId !== commanderSession.userId) {
    return new Response(null, { status: 404 })
  }

  const encoder = new TextEncoder()
  let sequence = 0
  let closed = false
  let timer: ReturnType<typeof setInterval> | null = null
  let idleTimeout: ReturnType<typeof setTimeout> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (partial: StreamEnvelopePayload): void => {
        if (closed) return
        const envelope = { version: 1 as const, sessionId, sequence: sequence++, emittedAt: new Date().toISOString(), ...partial } as WrEngineerStreamEnvelope
        try {
          controller.enqueue(encoder.encode(encodeWrEngineerStreamEnvelope(envelope)))
        } catch {
          closed = true
        }
      }
      const emitComment = (comment: string): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeWrEngineerStreamComment(comment)))
        } catch {
          closed = true
        }
      }
      const stop = (): void => {
        if (timer) clearInterval(timer)
        timer = null
        if (idleTimeout) clearTimeout(idleTimeout)
        idleTimeout = null
      }
      const closeWith = (reason: string): void => {
        if (closed) return
        emit({ envelopeType: 'closed', reason })
        closed = true
        stop()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener('abort', () => closeWith('client_disconnected'), { once: true })
      idleTimeout = setTimeout(() => closeWith('idle_timeout'), MAX_CONNECTION_MS)

      emit({ envelopeType: 'opened' })
      emit({ envelopeType: 'session.snapshot', snapshot: initial.snapshot })
      let baseline: StreamBaseline = snapshotToBaseline(initial.snapshot)

      let pollCount = 0
      timer = setInterval(() => {
        void (async () => {
          if (closed) return
          pollCount += 1
          const current = await buildSnapshot(sessionId)
          if (!current) {
            emit({ envelopeType: 'error', error: { code: 'session_not_found', message: `Session ${sessionId} no longer exists.` } })
            closeWith('session_not_found')
            return
          }

          const { envelopes, changed, newBaseline } = computeStreamDeltas(baseline, current.snapshot)
          for (const envelope of envelopes) emit(envelope)
          if (changed) {
            emit({ envelopeType: 'session.snapshot', snapshot: current.snapshot })
            baseline = newBaseline
          } else if (pollCount % KEEPALIVE_EVERY_N_POLLS === 0) {
            emitComment('keepalive')
          }
        })()
      }, intervalMs)
    },
    cancel() {
      closed = true
      if (timer) clearInterval(timer)
      if (idleTimeout) clearTimeout(idleTimeout)
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
