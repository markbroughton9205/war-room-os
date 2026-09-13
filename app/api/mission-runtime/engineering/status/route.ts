import { NextResponse } from 'next/server'
import { getEngineerStatus } from '@/lib/native-builder/engineerStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const status = await getEngineerStatus()
  return NextResponse.json({ status })
}
