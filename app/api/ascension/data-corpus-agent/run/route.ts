import { requireCommanderSession } from '@/lib/security/commanderSession'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  isDataCorpusAgentRuntimeAvailable,
  runBoundedDataCorpusAgent,
  dataCorpusResultForCouncil,
} from '@/lib/ascension/data-corpus-agent'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'
import { ROADMAP_23_STATUS } from '@/lib/wr-corpus/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 8 — Commander-direct DATA_CORPUS_AGENT invocation.
 */
export async function POST(req: Request) {
  if (!isDataCorpusAgentRuntimeAvailable()) {
    return Response.json(
      { ok: false, error: 'DATA_CORPUS_AGENT runtime disabled.', status: 'DENIED' },
      { status: 403 },
    )
  }

  const session = await requireCommanderSession('DATA_CORPUS_AGENT')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const corpusQuestion =
    typeof body.corpus_question === 'string'
      ? body.corpus_question
      : typeof body.question === 'string'
        ? body.question
        : ''

  const datasetScope =
    typeof body.dataset_scope === 'string'
      ? body.dataset_scope
      : typeof body.datasetScope === 'string'
        ? body.datasetScope
        : 'fixture_bounded'

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

  const sourceScope = Array.isArray(body.source_scope)
    ? body.source_scope.filter((t): t is string => typeof t === 'string')
    : Array.isArray(body.sourceScope)
      ? body.sourceScope.filter((t): t is string => typeof t === 'string')
      : null

  const documentIds = Array.isArray(body.document_ids)
    ? body.document_ids.filter((t): t is string => typeof t === 'string')
    : Array.isArray(body.documentIds)
      ? body.documentIds.filter((t): t is string => typeof t === 'string')
      : null

  const sup = tryWarRoomSupabase()

  const result = await runBoundedDataCorpusAgent({
    corpusQuestion,
    ownerUserId: session.userId,
    requestedBy: session.userId,
    invokedBy: 'commander',
    datasetScope,
    sourceScope,
    documentIds,
    missionId,
    conversationId,
    supabase: sup.ok ? sup.client : null,
    enforceOwnership: Boolean(conversationId),
    conversationOwnerUserId: conversationId ? session.userId : null,
    attemptedAction,
    useFixtures: body.use_fixture !== false,
    allowMetadataWrite: body.allow_metadata_write === true,
    allowIndexSupportWrite: body.allow_index_support_write === true,
  })

  return Response.json({
    ok: result.status !== 'DENIED' && result.status !== 'FAILED',
    result,
    council_view: dataCorpusResultForCouncil(result),
    runtime_truth: {
      agent: 'DATA_CORPUS_AGENT',
      implemented: true,
      bounded: true,
      corpus_curation: true,
      crawl_authority: 'DENIED',
      training_authority: 'DENIED',
      roadmap_23: ROADMAP_23_STATUS,
      invocation_driven: true,
      ascension_autonomy: 'OFF',
      operational_ascension_agents: operationalAscensionAgentCount(),
    },
  })
}
