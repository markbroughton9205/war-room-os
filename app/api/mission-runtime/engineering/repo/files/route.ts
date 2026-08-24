import { NextResponse } from 'next/server'
import { listEngineeringFiles } from '@/lib/mission-runtime/engineeringReadSurface'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only file-tree listing for a thin client (Standalone Builder Phase A). Delegates to
 * repositoryInspector's bounded, denylist-respecting walk — never gated, nothing mutates. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pathPrefix = url.searchParams.get('pathPrefix') ?? undefined
  try {
    const files = await listEngineeringFiles(pathPrefix)
    return NextResponse.json({ files })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
