import { NextResponse } from 'next/server'
import { assertLiveResearchApproved, runGlobalIntelligenceMission } from '@/lib/native-builder/intelligenceMission'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Commander-gated (hardening decision, see docs/architecture/NATIVE_BUILDER_ARCHITECTURE_AND_
 * GOVERNANCE.md): assertLiveResearchApproved() runs BEFORE runGlobalIntelligenceMission is ever
 * called, so a blocked result here guarantees zero Tavily/fetch calls were attempted. */
export async function POST(req: Request) {
  let body: { decreeText?: string; conversationId?: string; liveResearchApproval?: unknown } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (!body.decreeText?.trim()) {
    return NextResponse.json({ error: 'decreeText is required.' }, { status: 400 })
  }

  const sup = tryWarRoomSupabase()
  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)

  // middleware.ts's updateSession() already blocks any unauthenticated request from ever reaching
  // this handler — hasSession is true here by construction of the request having arrived at all.
  // The gate function itself still declares hasSession as an explicit, independently-unit-tested
  // parameter rather than silently assuming truthiness (see intelligenceMission.ts's own tests).
  const gate = assertLiveResearchApproved({
    hasSession: true,
    safetyLock: state.safetyLock,
    decreeText: body.decreeText,
    approval: body.liveResearchApproval,
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason, blocked: true }, { status: gate.status })
  }

  const result = await runGlobalIntelligenceMission({
    decreeText: body.decreeText,
    supabase: sup.ok ? sup.client : null,
    conversationId: body.conversationId,
  })
  return NextResponse.json(result)
}
