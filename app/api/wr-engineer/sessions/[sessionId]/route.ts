import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'

export const dynamic = 'force-dynamic'

/** Full session snapshot: session record, all messages, all tool-activity events — the client
 * polls this for now (see the Phase 2 report's realtime-transport note; no pub/sub infra exists in
 * this app yet to push deltas). Ownership-checked: a session belongs to the Commander who created
 * it, never returned to anyone else. */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer sessions')
  if (!session.ok) return session.response

  const { sessionId } = await params
  const record = await wrEngineerSessionStore.getSession(sessionId)
  if (!record) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  if (record.commanderUserId !== session.userId) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  const [messages, toolEvents] = await Promise.all([
    wrEngineerSessionStore.listMessages(sessionId),
    wrEngineerSessionStore.listToolEvents(sessionId),
  ])

  return NextResponse.json({ session: record, messages, toolEvents })
}
