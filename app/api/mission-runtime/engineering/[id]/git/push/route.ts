import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { executeApprovedGitPush, GitGovernanceError } from '@/lib/native-builder/gitGovernance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sup = tryWarRoomSupabase()
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }
  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: 'push',
    body,
  })
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const push = await executeApprovedGitPush({ approvalGranted: true, missionId: id })
      return NextResponse.json({ push })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof GitGovernanceError ? 400 : 400 })
    }
  })
  return result.ok ? result.value : result.response
}
