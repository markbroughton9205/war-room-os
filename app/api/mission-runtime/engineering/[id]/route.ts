import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Optional ?workspaceId= scopes the lookup to a Phase B registered workspace. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    const mission = await strategy.get(id)
    if (!mission) return NextResponse.json({ error: 'Mission not found.' }, { status: 404 })
    return NextResponse.json({ mission })
  })
  return result.ok ? result.value : result.response
}
