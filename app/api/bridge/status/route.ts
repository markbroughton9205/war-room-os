import { NextResponse } from 'next/server'
import { getBridgeStatus, listBridgeResults } from '@/lib/bridge/state'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ...getBridgeStatus(),
    recentResults: listBridgeResults(),
  })
}
