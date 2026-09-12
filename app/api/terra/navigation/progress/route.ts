import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { runNavigationFoundation } from '@/lib/terra/navigation/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null
}

/** #22 Phase 9 — Session progress / off-route / next instruction (Commander session). */
export async function POST(req: Request) {
  const session = await requireCommanderSession('TERRA_NAVIGATION_PROGRESS')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const originObj = (body.origin && typeof body.origin === 'object' ? body.origin : body.current_location && typeof body.current_location === 'object' ? body.current_location : {}) as Record<string, unknown>
  const destObj = (body.destination && typeof body.destination === 'object' ? body.destination : {}) as Record<string, unknown>
  const oLat = num(originObj.latitude)
  const oLon = num(originObj.longitude)
  const dLat = num(destObj.latitude)
  const dLon = num(destObj.longitude)
  if (oLat === null || oLon === null || dLat === null || dLon === null) {
    return Response.json({ ok: false, error: 'current location and destination required.' }, { status: 400 })
  }

  const sup = tryWarRoomSupabase()
  const result = await runNavigationFoundation({
    ownerUserId: session.userId,
    requestedBy: session.userId,
    origin: { latitude: oLat, longitude: oLon },
    destination: { latitude: dLat, longitude: dLon },
    sessionId: typeof body.session_id === 'string' ? body.session_id : null,
    useFixtureGraph: true,
    requestReroute: body.request_reroute === true,
    enforceOwnership: true,
    resourceOwnerUserId: session.userId,
    supabase: sup.ok ? sup.client : null,
  })

  return Response.json({
    ok: result.status !== 'DENIED',
    mobile_contract: result.mobile_contract,
    off_route: result.off_route,
    reroute: result.reroute,
    next_instruction: result.instructions[0] ?? null,
    eta: result.eta,
    persistent_tracking: false,
    device_control: 'DENIED',
    audit_id: result.audit_id,
  })
}
