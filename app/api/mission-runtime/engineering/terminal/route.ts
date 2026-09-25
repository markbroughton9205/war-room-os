import { NextResponse } from 'next/server'
import {
  clearCommanderTerminal,
  closeCommanderTerminal,
  openCommanderTerminal,
  sendCommanderTerminal,
  snapshotCommanderTerminal,
  stopCommanderTerminal,
} from '@/lib/native-builder/commanderTerminal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  const snapshot = snapshotCommanderTerminal(sessionId)
  if (!snapshot.ok) return NextResponse.json({ error: snapshot.error }, { status: 404 })
  return NextResponse.json(snapshot)
}

export async function POST(req: Request) {
  let body: {
    action?: string
    sessionId?: string
    text?: string
    projectRoot?: string
    projectId?: string
  } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const action = body.action?.trim()
  if (action === 'open') {
    const opened = await openCommanderTerminal({
      projectRoot: body.projectRoot,
      projectId: body.projectId,
    })
    if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: 409 })
    return NextResponse.json(snapshotCommanderTerminal(opened.sessionId!))
  }
  if (!body.sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  if (action === 'send') {
    const sent = await sendCommanderTerminal(body.sessionId, body.text ?? '')
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 409 })
    return NextResponse.json(snapshotCommanderTerminal(body.sessionId))
  }
  if (action === 'read') {
    const snapshot = snapshotCommanderTerminal(body.sessionId)
    if (!snapshot.ok) return NextResponse.json({ error: snapshot.error }, { status: 404 })
    return NextResponse.json(snapshot)
  }
  if (action === 'clear') {
    const cleared = clearCommanderTerminal(body.sessionId)
    if (!cleared.ok) return NextResponse.json({ error: cleared.error }, { status: 404 })
    return NextResponse.json(snapshotCommanderTerminal(body.sessionId))
  }
  if (action === 'stop') {
    const stopped = await stopCommanderTerminal(body.sessionId)
    if (!stopped.ok) return NextResponse.json({ error: stopped.error }, { status: 404 })
    return NextResponse.json(snapshotCommanderTerminal(body.sessionId))
  }
  if (action === 'close') {
    await closeCommanderTerminal(body.sessionId)
    return NextResponse.json({ ok: true, closed: true })
  }
  return NextResponse.json({ error: 'Unknown terminal action.' }, { status: 400 })
}
