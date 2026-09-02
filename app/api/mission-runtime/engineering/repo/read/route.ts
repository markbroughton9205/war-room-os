import { NextResponse } from 'next/server'
import { readEngineeringFile } from '@/lib/mission-runtime/engineeringReadSurface'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { observeWarRoomApiTool } from '@/lib/modular-intelligence/warRoomToolTrajectoryObserve'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only single-file read for a thin client's editor/viewer surface (Standalone Builder Phase
 * A). Delegates to repositoryInspector.readRepoFile via the Engineering Core read boundary — all
 * containment/denylist/size-cap enforcement lives there, unchanged. Optional ?workspaceId= scopes
 * to a Phase B registered workspace. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const path = url.searchParams.get('path')
  const workspaceId = url.searchParams.get('workspaceId')
  if (!path) return NextResponse.json({ error: 'path query parameter is required.' }, { status: 400 })
  const outer = await runInResolvedWorkspace(workspaceId, async () => readEngineeringFile(path))
  if (!outer.ok) return outer.response
  const result = outer.value
  observeWarRoomApiTool({
    toolId: 'files',
    requestText: `Find the contents of ${path}`,
    arguments: { path },
    ok: result.ok,
    status: result.ok ? 'complete' : 'error',
    error: result.ok ? null : result.error,
    resultMeta: result.ok
      ? { op: 'read', path: result.relPath, sizeBytes: result.sizeBytes }
      : { op: 'read', path, failed: true },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json(result)
}
