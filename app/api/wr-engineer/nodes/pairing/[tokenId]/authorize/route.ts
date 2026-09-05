import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { authorizePairing, PairingError } from '@/lib/wr-engineer/node/pairing'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

/** Commander authorizes a PAIRING-state request. Returns the new node's plaintext device
 * credential exactly once — the caller (Commander's browser, relaying to the node operator) must
 * hand it to the node now; it is never retrievable again. */
export async function POST(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer pairing')
  if (!session.ok) return session.response

  const { tokenId } = await params
  try {
    const result = await authorizePairing(wrEngineerNodeStore, tokenId)
    await logWrEngineerAudit('node pairing authorized', { tokenId, nodeId: result.node.nodeId, nodeName: result.node.nodeName })
    return NextResponse.json({
      node: { ...result.node, credential: undefined },
      credential: result.credential,
    })
  } catch (error) {
    if (error instanceof PairingError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 })
    }
    throw error
  }
}
