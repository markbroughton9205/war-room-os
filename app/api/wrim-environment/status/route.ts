import { NextResponse } from 'next/server'
import { wrimEnvironmentStatusPayload } from '@/lib/wrim-environment/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(wrimEnvironmentStatusPayload())
}
