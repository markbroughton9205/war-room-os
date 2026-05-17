import { NextResponse } from 'next/server'
import { getBridgeRuntime } from '@/lib/bridge/state'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getBridgeRuntime())
}
