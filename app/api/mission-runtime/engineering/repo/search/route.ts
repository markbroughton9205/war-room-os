import { NextResponse } from 'next/server'
import { searchEngineeringRepository } from '@/lib/mission-runtime/engineeringReadSurface'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only bounded repository text search for a thin client (Standalone Builder Phase A).
 * Optional ?workspaceId= scopes to a Phase B registered workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const pathPrefix = url.searchParams.get('pathPrefix') ?? undefined
  const workspaceId = url.searchParams.get('workspaceId')
  if (!q) return NextResponse.json({ error: 'q query parameter is required.' }, { status: 400 })
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const hits = await searchEngineeringRepository(q, { pathPrefix })
      return NextResponse.json({ hits })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
