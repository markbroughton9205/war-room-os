import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { isActiveStatus, rankSearchCandidates } from './rank'
import type { ScorableCandidate, SearchCategory, SearchInput, SearchResultItem } from './types'

function textMatchStrength(text: string, query: string): number {
  return text.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 0.6
}

const IMPORTANCE_TIER_WEIGHT: Record<string, number> = { trivial: 0.2, operational: 0.5, strategic: 0.8, critical: 1.0 }

/**
 * Project-scoping contract (Wave 2 closeout — fixes a prior no-op stub). Every category declares
 * exactly how it relates to a project, using the real relational path in this schema rather than
 * a fabricated one:
 *  - 'direct': the table has its own project_id column (memory, open_loop, prompt_artifact, claim).
 *  - 'direct_or_global': same, but scope='global' rows are intentionally also included — matches
 *    lib/context-assembler/supabaseStore.ts's getActiveWorldKnowledge semantics exactly (world
 *    knowledge is deliberately shared across projects when scope='global', that is not a leak).
 *  - 'self': the row IS a project (only that exact project can match itself).
 *  - 'via_conversation': war_room_messages has no project_id — it belongs to a conversation, which
 *    has active_project_id. Scoped via a PostgREST inner-join embed on the one unambiguous FK.
 *  - 'via_learning_session': war_room_source_records has NO project column at all — sources are
 *    shared research artifacts, not project-owned. Scoped via the project's learning sessions'
 *    source_ids array (an indirect, non-exclusive relationship: a source can legitimately be
 *    referenced by sessions in more than one project — that is not a leak, it is what the schema
 *    actually models). Never fabricates a project_id that doesn't exist on this table.
 */
type ProjectScoping =
  | { kind: 'direct'; column: string }
  | { kind: 'direct_or_global'; column: string }
  | { kind: 'self' }
  | { kind: 'via_conversation' }
  | { kind: 'via_learning_session' }

type CategoryRow = Record<string, unknown>
type CategoryConfig = {
  table: string
  columns: string
  statusField: string | null
  activeStatuses?: string[]
  projectScoping: ProjectScoping
  toCandidate: (row: CategoryRow, query: string) => ScorableCandidate & { title: string; snippet: string; sourceRefs: { type: string; id: string }[] }
}

const CATEGORY_CONFIG: Record<SearchCategory, CategoryConfig> = {
  conversation: {
    table: 'war_room_messages',
    columns: 'id,role,content,conversation_id,created_at',
    statusField: null,
    projectScoping: { kind: 'via_conversation' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: 'active',
      createdAt: row.created_at as string,
      importanceWeight: 0.4,
      projectId: null,
      textMatchStrength: textMatchStrength(row.content as string, query),
      title: `${row.role}: ${(row.content as string).slice(0, 60)}`,
      snippet: (row.content as string).slice(0, 240),
      sourceRefs: [{ type: 'message', id: row.id as string }, { type: 'conversation', id: row.conversation_id as string }],
    }),
  },
  memory: {
    table: 'war_room_memory_records',
    columns: 'id,content,memory_type,status,project_id,importance_tier,created_at',
    statusField: 'status',
    activeStatuses: ['active'],
    projectScoping: { kind: 'direct', column: 'project_id' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: IMPORTANCE_TIER_WEIGHT[row.importance_tier as string] ?? 0.5,
      projectId: (row.project_id as string) ?? null,
      textMatchStrength: textMatchStrength(row.content as string, query),
      title: `[${row.memory_type}] ${(row.content as string).slice(0, 60)}`,
      snippet: (row.content as string).slice(0, 240),
      sourceRefs: [{ type: 'memory_record', id: row.id as string }],
    }),
  },
  project: {
    table: 'war_room_projects',
    columns: 'id,name,description,current_objective,status,created_at',
    statusField: 'status',
    activeStatuses: ['active', 'paused'],
    projectScoping: { kind: 'self' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: 0.6,
      projectId: row.id as string,
      textMatchStrength: textMatchStrength(`${row.name} ${row.description ?? ''} ${row.current_objective ?? ''}`, query),
      title: row.name as string,
      snippet: (row.current_objective as string) ?? (row.description as string) ?? '',
      sourceRefs: [{ type: 'project', id: row.id as string }],
    }),
  },
  open_loop: {
    table: 'war_room_open_loops',
    columns: 'id,title,description,status,priority,project_id,created_at',
    statusField: 'status',
    activeStatuses: ['open', 'blocked', 'in_progress'],
    projectScoping: { kind: 'direct', column: 'project_id' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: Math.min(1, Math.max(0, (row.priority as number) / 10)),
      projectId: (row.project_id as string) ?? null,
      textMatchStrength: textMatchStrength(`${row.title} ${row.description ?? ''}`, query),
      title: row.title as string,
      snippet: (row.description as string) ?? '',
      sourceRefs: [{ type: 'open_loop', id: row.id as string }],
    }),
  },
  prompt_artifact: {
    table: 'war_room_prompt_artifacts',
    columns: 'id,intent,target_agent_id,prompt_text,status,project_id,created_at',
    statusField: 'status',
    activeStatuses: ['draft', 'delivered'],
    projectScoping: { kind: 'direct', column: 'project_id' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: 0.5,
      projectId: (row.project_id as string) ?? null,
      textMatchStrength: textMatchStrength(row.prompt_text as string, query),
      title: `[${row.intent}] to ${row.target_agent_id}`,
      snippet: (row.prompt_text as string).slice(0, 240),
      sourceRefs: [{ type: 'artifact', id: row.id as string }],
    }),
  },
  world_knowledge: {
    table: 'war_room_world_knowledge_records',
    columns: 'id,content,status,confidence,project_id,created_at',
    statusField: 'status',
    activeStatuses: ['active'],
    // Matches getActiveWorldKnowledge's own semantics exactly: scope='global' records are
    // intentionally visible regardless of which project is being searched — not a leak.
    projectScoping: { kind: 'direct_or_global', column: 'project_id' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: row.confidence as number,
      projectId: (row.project_id as string) ?? null,
      textMatchStrength: textMatchStrength(row.content as string, query),
      title: (row.content as string).slice(0, 60),
      snippet: (row.content as string).slice(0, 240),
      sourceRefs: [{ type: 'world_knowledge', id: row.id as string }],
    }),
  },
  source: {
    table: 'war_room_source_records',
    columns: 'id,title,canonical_uri,status,created_at',
    statusField: 'status',
    activeStatuses: ['active', 'stale'],
    // war_room_source_records has no project_id column — sources are shared research artifacts,
    // not project-owned. Scoped indirectly via which learning sessions (which DO have a
    // project_id) reference a given source id. See searchOneCategory's pre-query below.
    projectScoping: { kind: 'via_learning_session' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: 0.5,
      projectId: null,
      textMatchStrength: textMatchStrength((row.title as string) ?? '', query),
      title: (row.title as string) ?? (row.canonical_uri as string) ?? row.id as string,
      snippet: (row.canonical_uri as string) ?? '',
      sourceRefs: [{ type: 'source', id: row.id as string }],
    }),
  },
  claim: {
    table: 'war_room_claim_records',
    columns: 'id,normalized_claim_text,status,confidence,project_id,created_at',
    statusField: 'status',
    activeStatuses: ['observed', 'candidate', 'supported', 'contested', 'verified'],
    projectScoping: { kind: 'direct', column: 'project_id' },
    toCandidate: (row, query) => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: row.created_at as string,
      importanceWeight: row.confidence as number,
      projectId: (row.project_id as string) ?? null,
      textMatchStrength: textMatchStrength(row.normalized_claim_text as string, query),
      title: (row.normalized_claim_text as string).slice(0, 60),
      snippet: (row.normalized_claim_text as string).slice(0, 240),
      sourceRefs: [{ type: 'claim', id: row.id as string }],
    }),
  },
}

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as SearchCategory[]

async function searchOneCategory(category: SearchCategory, input: SearchInput): Promise<SearchResultItem[]> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  const config = CATEGORY_CONFIG[category]
  const projectId = input.scope?.projectId ?? null

  // war_room_source_records has no project column at all — resolve the set of source ids
  // reachable from this project's learning sessions first, as a separate query, rather than
  // fabricating a project_id filter that doesn't exist on the table.
  let learningSessionSourceIds: string[] | null = null
  if (projectId && config.projectScoping.kind === 'via_learning_session') {
    const { data: sessions } = await sup.client
      .from('war_room_learning_sessions')
      .select('source_ids')
      .eq('project_id', projectId)
    learningSessionSourceIds = Array.from(
      new Set((sessions ?? []).flatMap(s => (s.source_ids as string[] | null) ?? [])),
    )
    if (learningSessionSourceIds.length === 0) return []
  }

  const needsConversationEmbed = Boolean(projectId) && config.projectScoping.kind === 'via_conversation'
  const selectColumns = needsConversationEmbed
    ? `${config.columns}, war_room_conversations!inner(active_project_id)`
    : config.columns

  let query = sup.client
    .from(config.table)
    .select(selectColumns)
    .textSearch('fts', input.query, { type: 'websearch', config: 'english' })
    .limit(50)

  if (input.scope?.conversationId && category === 'conversation') {
    query = query.eq('conversation_id', input.scope.conversationId)
  }

  if (projectId) {
    switch (config.projectScoping.kind) {
      case 'direct':
        query = query.eq(config.projectScoping.column, projectId)
        break
      case 'direct_or_global':
        query = query.or(`scope.eq.global,${config.projectScoping.column}.eq.${projectId}`)
        break
      case 'self':
        query = query.eq('id', projectId)
        break
      case 'via_conversation':
        query = query.eq('war_room_conversations.active_project_id', projectId)
        break
      case 'via_learning_session':
        query = query.in('id', learningSessionSourceIds ?? [])
        break
    }
  }

  if (!input.includeInactive && config.statusField && config.activeStatuses) {
    query = query.in(config.statusField, config.activeStatuses)
  }

  const { data } = await query
  const rows = (data as CategoryRow[] | null) ?? []
  const candidates = rows.map(row => config.toCandidate(row, input.query))
  const ranked = rankSearchCandidates(candidates, { queryProjectId: input.scope?.projectId ?? null })

  return ranked
    .filter(c => input.includeInactive || isActiveStatus(c.status))
    .slice(0, input.limit ?? 20)
    .map(c => ({
      category,
      id: c.id,
      title: c.title,
      snippet: c.snippet,
      score: c.score,
      createdAt: c.createdAt,
      sourceRefs: c.sourceRefs,
    }))
}

export async function searchAcrossCategories(input: SearchInput): Promise<Record<SearchCategory, SearchResultItem[]>> {
  const categories = input.categories?.length ? input.categories : ALL_CATEGORIES
  const results = await Promise.all(categories.map(category => searchOneCategory(category, input)))
  const out = {} as Record<SearchCategory, SearchResultItem[]>
  categories.forEach((category, i) => {
    out[category] = results[i]
  })
  return out
}
