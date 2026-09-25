import { NextResponse } from 'next/server'
import {
  disableCapabilityAwareRouting,
  enableCapabilityAwareRouting,
  getCapabilityAwareRoutingMode,
  loadRoutingEnablement,
  ROUTING_FAIL_SAFE_MODE,
  STORED_DEFAULT_POLICY,
} from '@/lib/native-builder/foundryWorkerRouting'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const mode = getCapabilityAwareRoutingMode()
  return NextResponse.json({
    mode,
    storedDefaultPolicy: STORED_DEFAULT_POLICY,
    failSafeMode: ROUTING_FAIL_SAFE_MODE,
    enablement: loadRoutingEnablement(),
  })
}

export async function POST(req: Request) {
  let body: { mode?: string; commanderConfirmed?: boolean } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.commanderConfirmed !== true) {
    return NextResponse.json({ error: 'Commander confirmation is required to change routing mode.' }, { status: 403 })
  }
  const requested = body.mode?.trim().toUpperCase()
  if (requested !== 'SHADOW' && requested !== 'ENABLED') {
    return NextResponse.json({ error: 'mode must be SHADOW or ENABLED.' }, { status: 400 })
  }
  const result = requested === 'SHADOW'
    ? disableCapabilityAwareRouting({ mission: 'COMMANDER_ROUTING_MODE' })
    : enableCapabilityAwareRouting({ mission: 'COMMANDER_ROUTING_MODE' })
  return NextResponse.json({
    ok: result.ok,
    mode: result.mode,
    previousMode: result.previousMode,
    storedDefaultPolicy: STORED_DEFAULT_POLICY,
    failSafeMode: ROUTING_FAIL_SAFE_MODE,
    enablement: loadRoutingEnablement(),
  })
}
