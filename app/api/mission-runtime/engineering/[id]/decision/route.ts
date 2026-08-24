import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { getMissionExecutionStrategy, ENGINEERING_MISSION_POLICY } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commander's final accept/reject — mirrors lib/native-builder's own /repairs/[id]/resolve route
 * exactly. Acceptance writes no files itself (only marks the record resolved) so it needs no
 * gate. Rejection triggers the same file-mutating rollback resolve() makes internally, so it
 * requires the same approval_granted gate as /rollback.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { accepted?: boolean; workspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (typeof body.accepted !== 'boolean') {
    return NextResponse.json({ error: 'accepted (boolean) is required.' }, { status: 400 })
  }
  const accepted: boolean = body.accepted

  if (!body.accepted) {
    const sup = tryWarRoomSupabase()
    const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
    const gate = assertAutoOrApproval({
      mode: state.mode,
      safetyLock: state.safetyLock,
      actionKind: ENGINEERING_MISSION_POLICY.rollbackActionKind,
      body,
    })
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
  }

  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    try {
      const mission = await strategy.decide(id, accepted)
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
