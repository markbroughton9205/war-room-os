import { NextResponse } from 'next/server'
import { wrimRebuildDesignStatusPayload } from '@/lib/wrim-rebuild-design/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(wrimRebuildDesignStatusPayload())
}
