import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerSessionStore } from '@/lib/wr-engineer/session/store'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { getNodeConnectionStatus } from '@/lib/wr-engineer/node/identity'
import { deriveProposalState } from '@/lib/wr-engineer/session/proposalState'
import { getRepair } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'

/** Full session snapshot: session record, all messages, all tool-activity events, derived
 * proposal/repair state, and node connection status. This is the explicit-refresh / reconnect
 * fallback the client falls back to if the SSE stream (./stream/route.ts) is unavailable — kept
 * unchanged in shape-of-purpose from Phase 2, extended with the same derived fields the stream's
 * `session.snapshot` envelope carries so the two paths never disagree about what "current state"
 * means. Ownership-checked: a session belongs to the Commander who created it, never returned to
 * anyone else. */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer sessions')
  if (!session.ok) return session.response

  const { sessionId } = await params
  const record = await wrEngineerSessionStore.getSession(sessionId)
  if (!record) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  if (record.commanderUserId !== session.userId) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  const [messages, toolEvents, node, repair] = await Promise.all([
    wrEngineerSessionStore.listMessages(sessionId),
    wrEngineerSessionStore.listToolEvents(sessionId),
    wrEngineerNodeStore.getNode(record.nodeId),
    record.nativeBuilderRepairId ? getRepair(record.nativeBuilderRepairId) : Promise.resolve(null),
  ])

  return NextResponse.json({
    session: record,
    messages,
    toolEvents,
    proposalState: deriveProposalState(record, repair?.state ?? null),
    repairState: repair?.state ?? null,
    nodeStatus: node ? getNodeConnectionStatus(node) : null,
  })
}
