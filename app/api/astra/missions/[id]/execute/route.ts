import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import {
  astraMissionPublicView,
  buildAstraCouncilChatBody,
  extractAstraCouncilOutcome,
  markAstraMissionCompleted,
  markAstraMissionFailed,
  withAstraConversationId,
} from '@/lib/astra/liveMission'
import { claimAstraMissionRunning, createAstraCouncilConversation, saveAstraLiveMission } from '@/lib/astra/liveMission.store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

function conflictMessage(code: 'already_running' | 'already_completed' | 'already_failed'): string {
  if (code === 'already_running') return 'ASTRA mission is already running.'
  if (code === 'already_completed') return 'ASTRA mission already completed and cannot re-enter running.'
  return 'ASTRA mission already failed. A later re-run is not part of this slice.'
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const commander = await requireCommanderSession('ASTRA mission execute')
  if (!commander.ok) return commander.response
  const { id } = await context.params

  let body: Record<string, unknown> = {}
  try {
    const text = await request.clone().text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }

  const claimed = await claimAstraMissionRunning({
    id,
    commanderUserId: commander.userId,
  })
  if (!claimed.ok) {
    if (claimed.code === 'not_found') {
      return NextResponse.json({ error: 'ASTRA mission not found.' }, { status: 404 })
    }
    return NextResponse.json({
      error: conflictMessage(claimed.code),
      status: claimed.code,
      mission: astraMissionPublicView(claimed.mission),
    }, { status: 409 })
  }

  let running = claimed.mission

  if (body.controlledFailure === true) {
    running = await saveAstraLiveMission(markAstraMissionFailed(running, 'Controlled Council execution failure'))
    return NextResponse.json({
      tool: 'astra-missions',
      status: 'failed',
      mission: astraMissionPublicView(running),
    })
  }

  const startedMs = Date.now()
  try {
    const conversationId = running.councilConversationId
      ?? await createAstraCouncilConversation(running)
    if (conversationId) {
      running = await saveAstraLiveMission(withAstraConversationId(running, conversationId))
    }
    const headers = new Headers({ 'content-type': 'application/json' })
    const cookie = request.headers.get('cookie')
    if (cookie) headers.set('cookie', cookie)
    const authorization = request.headers.get('authorization')
    if (authorization) headers.set('authorization', authorization)

    const councilRequest = new Request('http://war-room.local/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(buildAstraCouncilChatBody(running, conversationId)),
    })
    const councilResponse = await executeCouncilChatRequest(councilRequest)
    const payload = await councilResponse.json().catch(() => ({})) as Record<string, unknown>
    const outcome = extractAstraCouncilOutcome(payload)
    outcome.meta.durationMs = Date.now() - startedMs
    const failed = !councilResponse.ok || typeof payload.error === 'string' || !outcome.text
    if (failed) {
      const error = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : !outcome.text
            ? `Council execution returned no synthesis (${councilResponse.status})`
            : `Council execution failed (${councilResponse.status})`
      running = await saveAstraLiveMission(markAstraMissionFailed(running, error))
      return NextResponse.json({
        tool: 'astra-missions',
        status: 'failed',
        mission: astraMissionPublicView(running),
      })
    }
    const persistedConversationId = outcome.conversationId ?? conversationId
    running = await saveAstraLiveMission(markAstraMissionCompleted(running, {
      councilConversationId: persistedConversationId,
      outcomeSummary: outcome.text.slice(0, 800),
      councilExecution: outcome.meta,
    }))
    return NextResponse.json({
      tool: 'astra-missions',
      status: 'completed',
      mission: astraMissionPublicView(running),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Council execution failed'
    running = await saveAstraLiveMission(markAstraMissionFailed(running, message))
    return NextResponse.json({
      tool: 'astra-missions',
      status: 'failed',
      mission: astraMissionPublicView(running),
    })
  }
}
