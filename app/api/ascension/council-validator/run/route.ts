import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isCouncilValidatorRuntimeAvailable,
  runBoundedCouncilValidator,
  councilValidatorResultForCouncil,
  councilValidatorResultForAstra,
} from '@/lib/ascension/council-validator'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 7 — Commander-direct COUNCIL_VALIDATOR invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isCouncilValidatorRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'COUNCIL_VALIDATOR runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('COUNCIL_VALIDATOR')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const conversationId =
    typeof body.conversation_id === 'string'
      ? body.conversation_id
      : typeof body.conversationId === 'string'
        ? body.conversationId
        : ''

  const roundId =
    typeof body.round_id === 'string'
      ? body.round_id
      : typeof body.roundId === 'string'
        ? body.roundId
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

  const evidenceRefs = Array.isArray(body.evidence_refs)
    ? body.evidence_refs.filter((t): t is string => typeof t === 'string')
    : Array.isArray(body.evidenceRefs)
      ? body.evidenceRefs.filter((t): t is string => typeof t === 'string')
      : undefined

  const agentResultRefs = Array.isArray(body.agent_result_refs)
    ? body.agent_result_refs.filter((t): t is string => typeof t === 'string')
    : Array.isArray(body.agentResultRefs)
      ? body.agentResultRefs.filter((t): t is string => typeof t === 'string')
      : undefined

  const sup = tryWarRoomSupabase()

  const result = await runBoundedCouncilValidator({
    conversationId,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    roundId,
    missionId,
    evidenceRefs,
    agentResultRefs,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    conversationOwnerUserId: conversationId ? session.userId : null,
    attemptedAction,
    useFixtureClaims: body.use_fixture !== false,
    requestRevision: body.request_revision === true,
    sessionIntelligencePresent: true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: councilValidatorResultForCouncil(result),
    astra_view: councilValidatorResultForAstra(result),
    runtime_truth: {
      agent: 'COUNCIL_VALIDATOR',
      implemented: true,
      bounded: true,
      validation_only: true,
      action_authority: 'DENIED',
      validation_pass: result.validation_pass,
      execution_authorized: false,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
