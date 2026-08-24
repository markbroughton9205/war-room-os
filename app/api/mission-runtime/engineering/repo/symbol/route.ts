import { NextResponse } from 'next/server'
import { inspectEngineeringSymbolUsages } from '@/lib/mission-runtime/engineeringReadSurface'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only, text-search-based symbol usage lookup for a thin client (Standalone Builder Phase
 * A). Honest scope carried through from repositoryInspector.inspectSymbolUsages: approximate, not
 * AST-accurate. Optional ?workspaceId= scopes to a Phase B registered workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get('symbol')
  const pathPrefix = url.searchParams.get('pathPrefix') ?? undefined
  const workspaceId = url.searchParams.get('workspaceId')
  if (!symbol) return NextResponse.json({ error: 'symbol query parameter is required.' }, { status: 400 })
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const hits = await inspectEngineeringSymbolUsages(symbol, { pathPrefix })
      return NextResponse.json({ hits })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
