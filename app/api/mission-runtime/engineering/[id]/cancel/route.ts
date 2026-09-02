import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commander cancellation of a mission — including mid-execution (applying/validating). Cancelling
 * is itself the safe direction (it stops work; it never mutates files), so unlike /approve and
 * /rollback this route is deliberately NOT gated by assertAutoOrApproval — same discipline as
 * native-builder's own /repairs/[id]/cancel route. The cancellation, and exactly which process
 * trees were killed, is audit-logged by native-builder's runtime.ts persist() path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { reason?: string; workspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }

  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    if (!strategy.cancel) {
      return NextResponse.json({ error: 'This execution strategy does not support cancellation.' }, { status: 400 })
    }
    try {
      const mission = await strategy.cancel(id, body.reason)
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
