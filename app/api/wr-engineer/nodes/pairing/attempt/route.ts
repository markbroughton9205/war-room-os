import { NextResponse } from 'next/server'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { PairingError, requestPairing } from '@/lib/wr-engineer/node/pairing'
import { validateProtocolMessage } from '@/lib/wr-engineer/node/protocol'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC endpoint (see lib/supabase/middleware.ts's PUBLIC_API_PATHS) — the caller is the node
 * itself, presenting a NODE_HELLO payload plus the pairing code a Commander generated out-of-band.
 * Authorization is the code's own unguessability + short TTL + one-time-use (see
 * lib/wr-engineer/node/pairing.ts), not a Supabase session. No node identity exists yet at this
 * point, so there is nothing else to authenticate against.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).code !== 'string') {
    return NextResponse.json({ error: 'Request body must include a string "code".' }, { status: 400 })
  }

  const hello = { type: 'NODE_HELLO', ...((body as Record<string, unknown>).hello as Record<string, unknown> ?? {}) }
  const validated = validateProtocolMessage(hello)
  if (!validated.ok || validated.message.type !== 'NODE_HELLO') {
    return NextResponse.json({ error: `Invalid NODE_HELLO payload: ${validated.ok ? 'wrong type' : validated.error}` }, { status: 400 })
  }
  const helloMessage = validated.message

  try {
    const token = await requestPairing(wrEngineerNodeStore, (body as Record<string, unknown>).code as string, {
      nodeName: helloMessage.nodeName,
      platform: helloMessage.platform,
      architecture: helloMessage.architecture,
      hostname: helloMessage.hostname,
      osVersion: helloMessage.osVersion,
      agentVersion: helloMessage.agentVersion,
      capabilities: helloMessage.capabilities,
    })
    await logWrEngineerAudit('pairing attempt received, awaiting Commander authorization', {
      tokenId: token.tokenId, nodeName: helloMessage.nodeName, platform: helloMessage.platform,
    })
    return NextResponse.json({ tokenId: token.tokenId, state: token.state })
  } catch (error) {
    if (error instanceof PairingError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 })
    }
    throw error
  }
}
