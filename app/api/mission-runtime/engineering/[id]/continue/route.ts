import { NextResponse } from 'next/server'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { runCodingMission } from '@/lib/native-builder/engineerLoop'
import { continueBlockedCampaign } from '@/lib/native-builder/foundryEngineeringRuntime'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commander decision "Keep trying" on a paused campaign. Continues the SAME mission and campaign (nothing learned is erased),
 * records the decision as an event, grants a bounded window, and hands execution to the single mission owner.
 */
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
      const outcome = await continueBlockedCampaign(id)
      // Execution is owned by runCodingMission (one executor per mission); the request returns without waiting for the run.
      if (outcome.granted) void runCodingMission(id).catch(() => undefined)
      const mission = await getMissionExecutionStrategy('engineering').get(id)
      return NextResponse.json({ granted: outcome.granted, message: outcome.message, mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
