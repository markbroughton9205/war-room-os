import { NextResponse } from 'next/server'
import { getBridgeServiceStatus } from '@/lib/bridge/state'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getBridgeServiceStatus())
}
