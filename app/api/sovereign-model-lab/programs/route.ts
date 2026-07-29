import { NextResponse } from 'next/server'
import { listPrograms } from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const programs = await listPrograms()
  return NextResponse.json({ programs })
}
