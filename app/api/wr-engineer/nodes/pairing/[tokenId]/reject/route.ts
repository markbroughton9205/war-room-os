import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { PairingError, rejectPairing } from '@/lib/wr-engineer/node/pairing'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer pairing')
  if (!session.ok) return session.response

  const { tokenId } = await params
  try {
    const token = await rejectPairing(wrEngineerNodeStore, tokenId)
    await logWrEngineerAudit('node pairing rejected', { tokenId })
    return NextResponse.json({ token: { ...token, codeHash: undefined } })
  } catch (error) {
    if (error instanceof PairingError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 })
    }
    throw error
  }
}
