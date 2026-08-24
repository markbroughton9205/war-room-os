import { NextResponse } from 'next/server'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { getMissionExecutionStrategy, ENGINEERING_MISSION_POLICY } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The only Mission Runtime route that writes to the repository — reuses the identical gate
 * lib/native-builder's own /repairs/[id]/approve route already uses (assertAutoOrApproval with
 * 'file_modification', a DANGEROUS_ACTION_KINDS entry that is never auto-allowed regardless of
 * standing mode). This is the same one gate, not a second approval engine.
 */
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
    actionKind: ENGINEERING_MISSION_POLICY.applyActionKind,
    body,
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const strategy = getMissionExecutionStrategy('engineering')
  try {
    const mission = await strategy.approve(id, true)
    return NextResponse.json({ mission })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
