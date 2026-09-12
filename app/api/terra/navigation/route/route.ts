import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { runNavigationFoundation } from '@/lib/terra/navigation/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null
}

/** #22 Phase 9 — Bounded route calculation (Commander session). */
export async function POST(req: Request) {
  const session = await requireCommanderSession('TERRA_NAVIGATION_ROUTE')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const originObj = (body.origin && typeof body.origin === 'object' ? body.origin : {}) as Record<string, unknown>
  const destObj = (body.destination && typeof body.destination === 'object' ? body.destination : {}) as Record<string, unknown>
  const oLat = num(originObj.latitude ?? body.origin_lat)
  const oLon = num(originObj.longitude ?? body.origin_lon)
  const dLat = num(destObj.latitude ?? body.destination_lat)
  const dLon = num(destObj.longitude ?? body.destination_lon)
  if (oLat === null || oLon === null || dLat === null || dLon === null) {
    return Response.json({ ok: false, error: 'origin and destination lat/lon required.' }, { status: 400 })
  }

  const sup = tryWarRoomSupabase()
  const result = await runNavigationFoundation({
    ownerUserId: session.userId,
    requestedBy: session.userId,
    origin: { latitude: oLat, longitude: oLon },
    destination: { latitude: dLat, longitude: dLon },
    claimLiveDeviceGps: body.claim_live_device_gps === true,
    locationSource: body.claim_live_device_gps === true ? 'device_gnss' : 'explicit_input',
    useFixtureGraph: body.use_fixture !== false,
    requestReroute: body.request_reroute === true,
    enforceOwnership: true,
    resourceOwnerUserId: session.userId,
    supabase: sup.ok ? sup.client : null,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result: {
      status: result.status,
      route: result.route,
      eta: result.eta,
      instructions: result.instructions,
      provenance: result.route?.provenance ?? null,
      runtime_truth: result.runtime_truth,
      traffic_truth: result.traffic_truth,
      denials: result.denials,
      limitations: result.limitations,
      audit_id: result.audit_id,
      device_control: 'DENIED',
      future_navigation_agent: 'TARGET_UNIMPLEMENTED',
    },
  })
}
