import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { getMissionExecutionStrategy, ENGINEERING_MISSION_POLICY } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Explicit rollback outside the accept/reject flow — mirrors lib/native-builder's own
 * /repairs/[id]/rollback route and gate exactly. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sup = tryWarRoomSupabase()

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

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

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    try {
      const mission = await strategy.rollback(id)
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
