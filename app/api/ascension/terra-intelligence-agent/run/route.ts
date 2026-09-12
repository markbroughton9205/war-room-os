import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isTerraIntelligenceAgentRuntimeAvailable,
  runBoundedTerraIntelligenceAgent,
  terraIntelligenceResultForCouncil,
} from '@/lib/ascension/terra-intelligence-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 6 — Commander-direct TERRA_INTELLIGENCE_AGENT invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isTerraIntelligenceAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'TERRA_INTELLIGENCE_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('TERRA_INTELLIGENCE_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const worldStateQuestion =
    typeof body.world_state_question === 'string'
      ? body.world_state_question
      : typeof body.question === 'string'
        ? body.question
        : ''

  const geographicScope =
    typeof body.geographic_scope === 'string'
      ? body.geographic_scope
      : typeof body.geographicScope === 'string'
        ? body.geographicScope
        : null

  const timeScope =
    typeof body.time_scope === 'string'
      ? body.time_scope
      : typeof body.timeScope === 'string'
        ? body.timeScope
        : null

  const providerScope = Array.isArray(body.provider_scope)
    ? body.provider_scope.filter((t): t is string => typeof t === 'string')
    : Array.isArray(body.providerScope)
      ? body.providerScope.filter((t): t is string => typeof t === 'string')
      : null

  const conversationId =
    typeof body.conversation_id === 'string'
      ? body.conversation_id
      : typeof body.conversationId === 'string'
        ? body.conversationId
        : null

  const missionId =
    typeof body.mission_id === 'string'
      ? body.mission_id
      : typeof body.missionId === 'string'
        ? body.missionId
        : null

  const attemptedAction =
    typeof body.attempted_action === 'string'
      ? body.attempted_action
      : typeof body.attemptedAction === 'string'
        ? body.attemptedAction
        : null

  const sup = tryWarRoomSupabase()

  const result = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    geographicScope,
    timeScope,
    providerScope,
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    conversationOwnerUserId: conversationId ? session.userId : null,
    attemptedAction,
    liveOnly: body.live_only === true,
    includeCached: body.include_cached !== false,
    includeHistorical: body.include_historical === true,
    includeInferred: body.include_inferred === true,
    useDigitrafficFixture: body.use_fixture !== false,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: terraIntelligenceResultForCouncil(result),
    runtime_truth: {
      agent: 'TERRA_INTELLIGENCE_AGENT',
      implemented: true,
      bounded: true,
      world_state_analysis: true,
      action_authority: 'DENIED',
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      gps: 'NOT_IMPLEMENTED',
      traffic: 'NOT_IMPLEMENTED',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
