import { NextResponse } from 'next/server'
import { recordHeartbeat } from '@/lib/wr-engineer/node/identity'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { validateProtocolMessage } from '@/lib/wr-engineer/node/protocol'

export const dynamic = 'force-dynamic'

/** PUBLIC endpoint (see middleware's PUBLIC_API_PATHS) — authorized by the node's own device
 * credential (verified inside recordHeartbeat), never a Supabase session. A revoked node's
 * heartbeat is rejected and never updates last_seen (see identity.ts). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const validated = validateProtocolMessage(body)
  if (!validated.ok || validated.message.type !== 'NODE_HEARTBEAT') {
    return NextResponse.json({ error: `Invalid NODE_HEARTBEAT message: ${validated.ok ? 'wrong type' : validated.error}` }, { status: 400 })
  }

  const result = await recordHeartbeat(wrEngineerNodeStore, {
    nodeId: validated.message.nodeId,
    credential: validated.message.credential,
    agentVersion: validated.message.agentVersion,
  })
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 403
    return NextResponse.json({ error: `Heartbeat rejected: ${result.reason}` }, { status })
  }

  return NextResponse.json({ nodeId: result.node.nodeId, lastSeenAt: result.node.lastSeenAt })
}
