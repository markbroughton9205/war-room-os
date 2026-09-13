import { NextResponse } from 'next/server'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { resumeCodingMission } from '@/lib/native-builder/engineerLoop'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let workspaceId: string | undefined
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object' && typeof (raw as { workspaceId?: string }).workspaceId === 'string') {
      workspaceId = (raw as { workspaceId: string }).workspaceId
    }
  } catch {
    workspaceId = undefined
  }
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      await resumeCodingMission(id)
      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.get(id)
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
