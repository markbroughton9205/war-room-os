import { NextResponse } from 'next/server'
import { ensureStarrdomFixture } from '@/lib/media-command/starrdom'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  const project = await ensureStarrdomFixture()
  return NextResponse.json({ project }, { status: 201 })
}

export async function GET() {
  const project = await ensureStarrdomFixture()
  return NextResponse.json({ project })
}
