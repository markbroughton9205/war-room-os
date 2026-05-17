import { NextResponse } from 'next/server'
import { authenticateBridgeRequest } from '@/lib/bridge/auth'
import { recordBridgeHeartbeat } from '@/lib/bridge/state'
import type { BridgeHeartbeatRequest } from '@/lib/bridge/types'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = authenticateBridgeRequest(request)
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status })

  let body: BridgeHeartbeatRequest
  try {
    body = await request.json() as BridgeHeartbeatRequest
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 })
  }

  const status = recordBridgeHeartbeat(body)
  return NextResponse.json({
    accepted: true,
    mode: status.mode,
    node: status.node,
    heartbeatIntervalSeconds: status.heartbeatIntervalSeconds,
    staleTimeoutSeconds: status.staleTimeoutSeconds,
  })
}
