import { requireCommanderSession } from '@/lib/security/commanderSession'
import { makeHelsinkiFixtureRoadGraph } from '@/lib/terra/navigation/graph'
import { createLocationObservation } from '@/lib/terra/navigation/location'
import { mapMatchLocation } from '@/lib/terra/navigation/guidance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null
}

/** #22 Phase 9 — Map match (Commander session). */
export async function POST(req: Request) {
  const session = await requireCommanderSession('TERRA_NAVIGATION_MATCH')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const lat = num(body.latitude)
  const lon = num(body.longitude)
  if (lat === null || lon === null) {
    return Response.json({ ok: false, error: 'latitude/longitude required.' }, { status: 400 })
  }

  const loc = createLocationObservation({
    latitude: lat,
    longitude: lon,
    source: body.claim_live_device_gps === true ? 'device_gnss' : 'explicit_input',
    claimLiveDeviceGps: body.claim_live_device_gps === true,
    permissionState: body.claim_live_device_gps === true ? 'GRANTED' : 'NOT_APPLICABLE',
    ownerUserId: session.userId,
  })
  if (!loc.ok) return Response.json({ ok: false, error: loc.reason, status: 'LOCATION_UNAVAILABLE' }, { status: 400 })

  const graph = makeHelsinkiFixtureRoadGraph()
  const match = mapMatchLocation(graph, { latitude: lat, longitude: lon }, typeof body.heading_degrees === 'number' ? body.heading_degrees : null)

  return Response.json({
    ok: true,
    location_runtime_state: loc.location.runtime_state,
    supplied_not_live_device:
      loc.location.source !== 'device_gnss' || loc.location.runtime_state !== 'LIVE_DEVICE_LOCATION',
    match,
  })
}
