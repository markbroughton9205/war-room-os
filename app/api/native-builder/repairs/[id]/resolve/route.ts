import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { commanderResolve } from '@/lib/native-builder/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_KIND = 'rollback'

/** Final Commander accept/reject — the only route that can mark an issue resolved. Rejection
 * (accepted: false) triggers an automatic rollback inside commanderResolve — the exact same
 * file-mutating rollbackRepair() call that /rollback makes, so it requires the same
 * approval_granted: true gate as /rollback. Acceptance (accepted: true) writes no files itself
 * (only marks the issue/repair record resolved), so it does not need the gate. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { accepted?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (typeof body.accepted !== 'boolean') {
    return NextResponse.json({ error: 'accepted (boolean) is required.' }, { status: 400 })
  }

  if (!body.accepted) {
    const sup = tryWarRoomSupabase()
    const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
    const gate = assertAutoOrApproval({ mode: state.mode, safetyLock: state.safetyLock, actionKind: ACTION_KIND, body })
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
  }

  try {
    const repair = await commanderResolve(id, body.accepted)
    return NextResponse.json({ repair })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
