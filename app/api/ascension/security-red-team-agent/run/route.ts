import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isSecurityRedTeamAgentRuntimeAvailable,
  runBoundedSecurityRedTeamAgent,
  securityRedTeamResultForCouncil,
} from '@/lib/ascension/security-red-team-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 4 — Commander-direct SECURITY_RED_TEAM_AGENT invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isSecurityRedTeamAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'SECURITY_RED_TEAM_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('SECURITY_RED_TEAM_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const securityQuestion =
    typeof body.security_question === 'string'
      ? body.security_question
      : typeof body.question === 'string'
        ? body.question
        : ''

  const targets = Array.isArray(body.targets)
    ? body.targets.filter((t): t is string => typeof t === 'string')
    : undefined

  const allowedProbeClasses = Array.isArray(body.allowed_probe_classes)
    ? body.allowed_probe_classes.filter((t): t is string => typeof t === 'string')
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

  const result = await runBoundedSecurityRedTeamAgent({
    securityQuestion,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    targets,
    allowedProbeClasses,
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    attemptedAction,
    researchHandoff:
      body.research_handoff && typeof body.research_handoff === 'object'
        ? (body.research_handoff as { summary?: string })
        : null,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: securityRedTeamResultForCouncil(result),
    runtime_truth: {
      agent: 'SECURITY_RED_TEAM_AGENT',
      implemented: true,
      bounded: true,
      safe_probes_only: true,
      auto_remediation: false,
      external_exploitation: false,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
