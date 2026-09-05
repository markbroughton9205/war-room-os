import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { createSession, SessionBindingError } from '@/lib/wr-engineer/session/session'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireCommanderSession('WR-Engineer sessions')
  if (!session.ok) return session.response

  const all = await wrEngineerSessionStore.listSessions()
  return NextResponse.json({ sessions: all.filter(s => s.commanderUserId === session.userId) })
}

/** Binds a new session to exactly one node + one repository — see session.ts's header: there is no
 * "switch node/repository" endpoint. A different target always means a new session. */
export async function POST(req: Request) {
  const session = await requireCommanderSession('WR-Engineer sessions')
  if (!session.ok) return session.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body.nodeId !== 'string' || typeof body.repositoryId !== 'string') {
    return NextResponse.json({ error: 'Request body must include "nodeId" and "repositoryId" strings.' }, { status: 400 })
  }

  try {
    const created = await createSession(wrEngineerNodeStore, wrEngineerSessionStore, {
      commanderUserId: session.userId,
      nodeId: body.nodeId,
      repositoryId: body.repositoryId,
      constraints: Array.isArray(body.constraints) ? body.constraints.filter((c: unknown) => typeof c === 'string') : undefined,
    })
    await logWrEngineerAudit('engineering session created', { sessionId: created.sessionId, nodeId: created.nodeId, repositoryId: created.repositoryId })
    return NextResponse.json({ session: created })
  } catch (error) {
    if (error instanceof SessionBindingError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}
