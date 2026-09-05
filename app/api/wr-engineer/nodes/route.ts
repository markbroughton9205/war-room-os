import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { getNodeConnectionStatus } from '@/lib/wr-engineer/node/identity'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireCommanderSession('WR-Engineer nodes')
  if (!session.ok) return session.response

  const nodes = await wrEngineerNodeStore.listNodes()
  const now = new Date()
  return NextResponse.json({
    nodes: nodes.map(node => ({
      ...node,
      credential: undefined, // never expose credential metadata (even the hash) to the client
      connectionStatus: node.revokedAt ? 'OFFLINE' : getNodeConnectionStatus(node, now),
    })),
  })
}
