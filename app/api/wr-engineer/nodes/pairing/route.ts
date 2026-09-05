import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { generatePairingCode, sweepExpiredPairingTokens } from '@/lib/wr-engineer/node/pairing'

export const dynamic = 'force-dynamic'

/** Commander requests a new pairing code — "Add Computer" entry point. The plaintext code is
 * returned exactly once in this response and never stored; only its hash persists. */
export async function POST() {
  const session = await requireCommanderSession('WR-Engineer pairing')
  if (!session.ok) return session.response

  const { code, token } = await generatePairingCode(wrEngineerNodeStore)
  return NextResponse.json({
    code,
    tokenId: token.tokenId,
    state: token.state,
    expiresAt: token.expiresAt,
  })
}

/** Lists pairing tokens (sweeping expired ones first) so the UI can render WAITING/PAIRING/
 * AUTHORIZED/EXPIRED/REJECTED state honestly. */
export async function GET() {
  const session = await requireCommanderSession('WR-Engineer pairing')
  if (!session.ok) return session.response

  await sweepExpiredPairingTokens(wrEngineerNodeStore)
  const tokens = await wrEngineerNodeStore.listPairingTokens()
  return NextResponse.json({
    tokens: tokens.map(t => ({ ...t, codeHash: undefined })), // never expose the hash either
  })
}
