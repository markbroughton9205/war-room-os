import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isWorldLearningAgentRuntimeAvailable,
  requireWorldLearningAgentCaller,
  runBoundedWorldLearningAgent,
  worldLearningAgentResultForCouncil,
} from '@/lib/ascension/world-learning-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'
import { WR_CORPUS_STATUS } from '@/lib/wr-corpus/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 13 — Commander / local-Commander WORLD_LEARNING_AGENT invocation.
 */
export async function POST(req: Request) {
  if (!isWorldLearningAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'WORLD_LEARNING_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireWorldLearningAgentCaller()
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

  const result = await runBoundedWorldLearningAgent({
    taskType: typeof body.task_type === 'string' ? body.task_type : typeof body.taskType === 'string' ? body.taskType : 'LEARN_TOPIC',
    topic: typeof body.topic === 'string' ? body.topic : typeof body.question === 'string' ? body.question : undefined,
    question: typeof body.question === 'string' ? body.question : undefined,
    domain: typeof body.domain === 'string' ? body.domain : null,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: session.surface === 'LOCAL_COMMANDER' ? 'desktop_core' : 'commander',
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    conversationOwnerUserId: conversationId ? session.userId : null,
    attemptedAction,
    useFixtures: body.use_fixture !== false,
    internetAvailable: body.internet_available !== false,
    liveSearchAllowed: body.live_search_allowed === true,
    invokeResearchAgent: body.invoke_research_agent === true,
    useLocalModel: body.use_local_model === true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED' && result.status !== 'INTERNAL_ERROR',
    result,
    council_view: worldLearningAgentResultForCouncil(result),
    runtime_truth: {
      agent: 'WORLD_LEARNING_AGENT',
      implemented: true,
      bounded: true,
      operational: true,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      corpus_handoff: 'IMPLEMENTED',
      autonomous_corpus_persistence: false,
      model_training: 'NOT_IMPLEMENTED',
      wr_corpus: WR_CORPUS_STATUS,
      wr_tokenizer: 'NOT_STARTED',
      wrim: 'NOT_IMPLEMENTED',
      rael: 'NOT_IMPLEMENTED',
      phone_app: 'NOT_IMPLEMENTED',
      operational_ascension_agents: operationalAscensionAgentCount(),
      caller_surface: session.surface,
    },
  })
}
