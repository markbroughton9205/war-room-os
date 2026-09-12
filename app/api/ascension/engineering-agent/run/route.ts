import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isEngineeringAgentRuntimeAvailable,
  runBoundedEngineeringAgent,
  engineeringAgentResultForCouncil,
} from '@/lib/ascension/engineering-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 3 — Commander-direct ENGINEERING_AGENT invocation.
 * Same runtime + policy pipeline as Council/ASTRA wrappers.
 */
export async function POST(req: Request) {
  if (!isEngineeringAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'ENGINEERING_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('ENGINEERING_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const taskDescription =
    typeof body.task_description === 'string'
      ? body.task_description
      : typeof body.task === 'string'
        ? body.task
        : ''

  const approvedWorktree =
    typeof body.approved_worktree === 'string'
      ? body.approved_worktree
      : typeof body.worktree === 'string'
        ? body.worktree
        : ''

  const allowedPaths = Array.isArray(body.allowed_paths)
    ? body.allowed_paths.filter((p): p is string => typeof p === 'string')
    : Array.isArray(body.allowedPaths)
      ? body.allowedPaths.filter((p): p is string => typeof p === 'string')
      : []

  const allowedValidationCommands = Array.isArray(body.allowed_validation_commands)
    ? body.allowed_validation_commands.filter((p): p is string => typeof p === 'string')
    : undefined

  const mutations = Array.isArray(body.mutations)
    ? body.mutations
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
        .map(m => ({
          relativePath: String(m.relative_path ?? m.relativePath ?? ''),
          content: String(m.content ?? ''),
          restoreAfter: m.restore_after === true || m.restoreAfter === true,
        }))
        .filter(m => m.relativePath)
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

  const result = await runBoundedEngineeringAgent({
    taskDescription,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    approvedWorktree,
    allowedPaths,
    allowedValidationCommands,
    mutations,
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    allowCreateEmptyWorktree: body.allow_create_empty_worktree === true,
    attemptedAction,
    researchHandoff:
      body.research_handoff && typeof body.research_handoff === 'object'
        ? (body.research_handoff as { summary?: string })
        : null,
    terraContextProvided: body.terra_context_provided === true,
    councilGrantPushOrDeploy: body.council_grant_push_or_deploy === true,
    attemptedScopeExpansion: body.attempted_scope_expansion === true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: engineeringAgentResultForCouncil(result),
    runtime_truth: {
      agent: 'ENGINEERING_AGENT',
      implemented: true,
      bounded: true,
      isolated_worktree_required: true,
      commit_authority: 'DENIED',
      push_authority: 'DENIED',
      deploy_authority: 'DENIED',
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
