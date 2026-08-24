import { NextResponse } from 'next/server'
import { getEngineeringRepositoryContext } from '@/lib/mission-runtime/engineeringReadSurface'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Read-only Engineering Core repository status/diff (Standalone Builder Phase A). Delegates
 * entirely to lib/mission-runtime/engineeringReadSurface.ts — no filesystem or git access happens
 * in this route file. Never gated by assertAutoOrApproval: nothing here can mutate the repository,
 * same no-gate reasoning as native-builder's own read-only routes. Optional ?workspaceId= scopes
 * the call to a Phase B registered workspace instead of the process's own repo.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pathsParam = url.searchParams.get('paths')
  const paths = pathsParam ? pathsParam.split(',').map(p => p.trim()).filter(Boolean) : undefined
  const workspaceId = url.searchParams.get('workspaceId')
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const context = await getEngineeringRepositoryContext(paths)
      return NextResponse.json(context)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
