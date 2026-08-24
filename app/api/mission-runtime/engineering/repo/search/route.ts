import { NextResponse } from 'next/server'
import { searchEngineeringRepository } from '@/lib/mission-runtime/engineeringReadSurface'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only bounded repository text search for a thin client (Standalone Builder Phase A). */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const pathPrefix = url.searchParams.get('pathPrefix') ?? undefined
  if (!q) return NextResponse.json({ error: 'q query parameter is required.' }, { status: 400 })
  try {
    const hits = await searchEngineeringRepository(q, { pathPrefix })
    return NextResponse.json({ hits })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
