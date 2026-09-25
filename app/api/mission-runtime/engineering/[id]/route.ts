import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { readRepairDetailed } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Optional ?workspaceId= scopes the lookup to a Phase B registered workspace. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    // Distinguish "not there" from "there but unreadable". A torn record from the old writer is recovered inside this read.
    const read = await readRepairDetailed(id)
    if (read.status === 'corrupt') {
      return NextResponse.json({ error: 'The mission record could not be read or recovered.', code: 'MISSION_RECORD_CORRUPT', detail: read.detail }, { status: 500 })
    }
    const strategy = getMissionExecutionStrategy('engineering')
    const mission = await strategy.get(id)
    if (!mission) return NextResponse.json({ error: 'Mission not found.', code: 'MISSION_ABSENT' }, { status: 404 })
    return NextResponse.json({ mission, recovered: read.status === 'recovered' })
  })
  return result.ok ? result.value : result.response
}
