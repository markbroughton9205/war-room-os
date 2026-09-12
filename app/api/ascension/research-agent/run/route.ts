import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { isTerraHandoffBody } from '@/lib/terra/councilHandoff'
import {
  isResearchAgentRuntimeAvailable,
  runBoundedResearchAgent,
  researchAgentResultForCouncil,
} from '@/lib/ascension/research-agent'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 2 — Commander-direct RESEARCH_AGENT invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isResearchAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'RESEARCH_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('RESEARCH_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const researchQuestion =
    typeof body.research_question === 'string'
      ? body.research_question
      : typeof body.question === 'string'
        ? body.question
        : ''

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

  const terraHandoff = isTerraHandoffBody(body.terra_handoff)
    ? body.terra_handoff
    : isTerraHandoffBody(body.terraHandoff)
      ? body.terraHandoff
      : null

  const attemptedAction =
    typeof body.attempted_action === 'string'
      ? body.attempted_action
      : typeof body.attemptedAction === 'string'
        ? body.attemptedAction
        : null

  const sup = tryWarRoomSupabase()

  const result = await runBoundedResearchAgent({
    researchQuestion,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    missionId,
    conversationId,
    terraHandoff,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    liveSearchAllowed: body.live_search_allowed !== false,
    terraAllowed: body.terra_allowed !== false,
    storedResearchAllowed: body.stored_research_allowed !== false,
    attemptedAction,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: researchAgentResultForCouncil(result),
    runtime_truth: {
      agent: 'RESEARCH_AGENT',
      implemented: true,
      bounded: true,
      read_only_discovery: true,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: 1,
    },
  })
}
