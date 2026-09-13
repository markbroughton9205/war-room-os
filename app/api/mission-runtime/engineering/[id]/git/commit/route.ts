import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { executeApprovedGitCommit, GitGovernanceError } from '@/lib/native-builder/gitGovernance'

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
    actionKind: 'commit',
    body,
  })
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    try {
      const commit = await executeApprovedGitCommit({
        approvalGranted: true,
        message: String(body.message ?? ''),
        files: Array.isArray(body.files) ? body.files.map(String) : [],
        missionId: id,
      })
      return NextResponse.json({ commit })
    } catch (error) {
      const status = error instanceof GitGovernanceError ? 400 : 400
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status })
    }
  })
  return result.ok ? result.value : result.response
}
