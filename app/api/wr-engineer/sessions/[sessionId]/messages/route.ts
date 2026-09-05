import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { SessionBindingError } from '@/lib/wr-engineer/session/session'
import { sendInspectingEngineeringChatMessage as sendEngineeringChatMessage } from '@/lib/wr-engineer/engineeringChat'
import { CouncilProviderModelAdapter } from '@/lib/wr-engineer/modelAdapter'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

/**
 * Phase 2 development wiring only (per mission brief: "acceptable to connect an existing
 * available model/provider through the abstraction for development/testing"). Swapping this for a
 * local model, a War Room fine-tuned model, or the eventual native WR-Engineer model is a one-line
 * change here — no caller of ModelAdapter anywhere else needs to change (see modelAdapter.ts).
 */
const devModelAdapter = new CouncilProviderModelAdapter('claude')

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
    const result = await sendEngineeringChatMessage(wrEngineerSessionStore, wrEngineerNodeStore, devModelAdapter, sessionId, body.content)
    await logWrEngineerAudit('engineering chat message exchanged', { sessionId, adapterId: devModelAdapter.id, proposalOutcome: result.proposalOutcome.kind })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SessionBindingError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}
