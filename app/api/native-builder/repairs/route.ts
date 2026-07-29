import { NextResponse } from 'next/server'
import { listRepairs } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const repairs = await listRepairs()
  return NextResponse.json({ repairs })
}
