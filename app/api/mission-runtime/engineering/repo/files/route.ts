import { NextResponse } from 'next/server'
import { listEngineeringFiles } from '@/lib/mission-runtime/engineeringReadSurface'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only file-tree listing for a thin client (Standalone Builder Phase A). Delegates to
 * repositoryInspector's bounded, denylist-respecting walk — never gated, nothing mutates.
 * Optional ?workspaceId= scopes to a Phase B registered workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pathPrefix = url.searchParams.get('pathPrefix') ?? undefined
  const workspaceId = url.searchParams.get('workspaceId')
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const files = await listEngineeringFiles(pathPrefix)
      return NextResponse.json({ files })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
