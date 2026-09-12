import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isOperationsAgentRuntimeAvailable,
  runBoundedOperationsAgent,
  operationsAgentResultForCouncil,
} from '@/lib/ascension/operations-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 5 — Commander-direct OPERATIONS_AGENT invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isOperationsAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'OPERATIONS_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('OPERATIONS_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const operationsQuestion =
    typeof body.operations_question === 'string'
      ? body.operations_question
      : typeof body.question === 'string'
        ? body.question
        : ''

  const targets = Array.isArray(body.targets)
    ? body.targets.filter((t): t is string => typeof t === 'string')
    : undefined

  const allowedDiagnostics = Array.isArray(body.allowed_diagnostics)
    ? body.allowed_diagnostics.filter((t): t is string => typeof t === 'string')
    : undefined

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

  const result = await runBoundedOperationsAgent({
    operationsQuestion,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    targets,
    allowedDiagnostics,
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    attemptedAction,
    securityHandoff:
      body.security_handoff && typeof body.security_handoff === 'object'
        ? (body.security_handoff as { summary?: string })
        : null,
    researchHandoff:
      body.research_handoff && typeof body.research_handoff === 'object'
        ? (body.research_handoff as { summary?: string })
        : null,
    councilRecommendRestart: body.council_recommend_restart === true,
    astraAuthorizeRestart: body.astra_authorize_restart === true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: operationsAgentResultForCouncil(result),
    runtime_truth: {
      agent: 'OPERATIONS_AGENT',
      implemented: true,
      bounded: true,
      observation_only: true,
      auto_repair: false,
      restart_authority: 'DENIED',
      deploy_authority: 'DENIED',
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
