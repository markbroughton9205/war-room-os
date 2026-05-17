import { NextResponse } from 'next/server'
import { listBridgeNodes } from '@/lib/bridge/state'
import { BRIDGE_NODE_PRESETS, BRIDGE_TRUST_BOUNDARIES } from '@/lib/bridge/catalog'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ...listBridgeNodes(),
    presets: BRIDGE_NODE_PRESETS,
    trustBoundaries: BRIDGE_TRUST_BOUNDARIES,
  })
}
