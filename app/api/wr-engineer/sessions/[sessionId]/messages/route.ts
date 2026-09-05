import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { SessionBindingError } from '@/lib/wr-engineer/session/session'
import { sendInspectingEngineeringChatMessage as sendEngineeringChatMessage } from '@/lib/wr-engineer/engineeringChat'
import { createWrEngineerChatAdapter } from '@/lib/wr-engineer/modelRouter'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer chat')
  if (!session.ok) return session.response

  const { sessionId } = await params
  const existing = await wrEngineerSessionStore.getSession(sessionId)
  if (!existing || existing.commanderUserId !== session.userId) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'Request body must include non-empty "content".' }, { status: 400 })
  }

  try {
    const adapter = await createWrEngineerChatAdapter()
    const result = await sendEngineeringChatMessage(wrEngineerSessionStore, wrEngineerNodeStore, adapter, sessionId, body.content)
    await logWrEngineerAudit('engineering chat message exchanged', { sessionId, adapterId: adapter.id, proposalOutcome: result.proposalOutcome.kind })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SessionBindingError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}
