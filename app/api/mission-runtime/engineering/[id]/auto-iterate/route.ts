import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Phase G — bounded auto-replan-on-failure. Never gated: this call can only regenerate a
 * proposal (the same no-mutation operation the manual /replan route already performs without a
 * gate) — it never calls approveAndApply, so nothing here writes to the filesystem. A fresh
 * approval is still required at /approve before any regenerated proposal can be applied, exactly
 * as before Phase G existed. Body: { maxAttempts?: number, paused?: boolean, workspaceId?: string }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { maxAttempts?: number; paused?: boolean; workspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }

  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    try {
      if (!strategy.autoIterate) {
        return NextResponse.json({ error: 'Auto-iteration is not supported by this mission strategy.' }, { status: 400 })
      }
      const mission = await strategy.autoIterate(id, { maxAttempts: body.maxAttempts, paused: body.paused })
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
