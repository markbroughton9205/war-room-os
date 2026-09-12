import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isNavigationAgentRuntimeAvailable,
  navigationAgentResultForCouncil,
  requireNavigationAgentCaller,
  runBoundedNavigationAgent,
} from '@/lib/ascension/navigation-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 12 — Commander / local-Commander NAVIGATION_AGENT invocation.
 */
export async function POST(req: Request) {
  if (!isNavigationAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'NAVIGATION_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireNavigationAgentCaller()
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const latlng = (value: unknown): { latitude: number; longitude: number } | null => {
    if (!value || typeof value !== 'object') return null
    const rec = value as Record<string, unknown>
    if (typeof rec.latitude !== 'number' || typeof rec.longitude !== 'number') return null
    return { latitude: rec.latitude, longitude: rec.longitude }
  }

  const conversationId =
    typeof body.conversation_id === 'string'
      ? body.conversation_id
      : typeof body.conversationId === 'string'
        ? body.conversationId
        : null

  const missionId =
    typeof body.mission_id === 'string' ? body.mission_id : typeof body.missionId === 'string' ? body.missionId : null

  const attemptedAction =
    typeof body.attempted_action === 'string'
      ? body.attempted_action
      : typeof body.attemptedAction === 'string'
        ? body.attemptedAction
        : null

  const sup = tryWarRoomSupabase()

  const result = await runBoundedNavigationAgent({
    taskType: typeof body.task_type === 'string' ? body.task_type : typeof body.taskType === 'string' ? body.taskType : 'PLAN_ROUTE',
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: session.surface === 'LOCAL_COMMANDER' ? 'desktop_core' : 'commander',
    origin: latlng(body.origin),
    destination: latlng(body.destination),
    currentLocation: latlng(body.current_location) ?? latlng(body.currentLocation),
    locationSource:
      body.location_source === 'session_supplied' ||
      body.location_source === 'fixture' ||
      body.location_source === 'terra' ||
      body.location_source === 'explicit_input'
        ? body.location_source
        : 'explicit_input',
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    conversationOwnerUserId: conversationId ? session.userId : null,
    attemptedAction,
    useFixtureGraph: body.use_fixture !== false,
    internetAvailable: body.internet_available !== false,
    claimLiveDeviceGps: body.claim_live_device_gps === true,
    requestReroute: body.request_reroute === true,
    autoExecuteReroute: body.auto_execute_reroute === true,
    useLocalModel: body.use_local_model === true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED' && result.status !== 'INTERNAL_ERROR',
    result,
    council_view: navigationAgentResultForCouncil(result),
    runtime_truth: {
      agent: 'NAVIGATION_AGENT',
      implemented: true,
      bounded: true,
      operational: true,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      live_traffic: 'NOT_IMPLEMENTED',
      mobile_gnss: 'NOT_SUPPORTED',
      phone_app: 'NOT_IMPLEMENTED',
      wrim: 'NOT_IMPLEMENTED',
      operational_ascension_agents: operationalAscensionAgentCount(),
      caller_surface: session.surface,
    },
  })
}
