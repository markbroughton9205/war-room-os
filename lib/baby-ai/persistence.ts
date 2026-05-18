import 'server-only'

import { BABY_AI_AGENTS, type BabyAgent, type BabyAgentKey, type BabyGrowthLevel, type BabyLessonState } from './model'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type BabyAiPersistenceStatus = 'live_persistent' | 'persistent_store' | 'awaiting_data' | 'static_seed' | 'not_connected'

export type BabyAiTableName =
  | 'war_room_baby_agents'
  | 'war_room_baby_agent_memories'
  | 'war_room_baby_agent_training_events'
  | 'war_room_baby_agent_skill_growth'
  | 'war_room_baby_agent_outcomes'

export type BabyAiTableSummary = {
  table: BabyAiTableName
  records: number | null
  lastEventAt: string | null
  status: BabyAiPersistenceStatus
  detail: string
}

export type PersistedBabyAgent = BabyAgent & {
  persistence: BabyAiPersistenceStatus
  updatedAt: string | null
  trainingEventCount: number | null
  memoryCount: number | null
  outcomeCount: number | null
}

type CountResult = {
  records: number | null
  lastEventAt: string | null
  error?: string
}

type BabyAgentRow = {
  agent_key: string
  display_name: string
  family_identity: string
  role: string
  lifecycle_state: string
  growth_level: number
  memory_scope: string[] | null
  skill_tree: unknown
  confidence_score: number | string | null
  usefulness_score: number | string | null
  latest_lesson: string | null
  next_training_need: string | null
  updated_at: string | null
}

const TABLES: Array<{ table: BabyAiTableName; dateColumn: string }> = [
  { table: 'war_room_baby_agents', dateColumn: 'updated_at' },
  { table: 'war_room_baby_agent_memories', dateColumn: 'updated_at' },
  { table: 'war_room_baby_agent_training_events', dateColumn: 'created_at' },
  { table: 'war_room_baby_agent_skill_growth', dateColumn: 'updated_at' },
  { table: 'war_room_baby_agent_outcomes', dateColumn: 'created_at' },
]

const LEVEL_FROM_INDEX: BabyGrowthLevel[] = ['seed', 'observing', 'learning', 'useful', 'specialist', 'senior']

function score(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function fallbackAgent(key: string): BabyAgent | null {
  return BABY_AI_AGENTS.find(agent => agent.key === key) ?? null
}

function parseSkillTree(value: unknown, fallback: BabyAgent['skillTree']): BabyAgent['skillTree'] {
  if (!Array.isArray(value)) return fallback
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const key = typeof row.key === 'string' ? row.key : ''
      const label = typeof row.label === 'string' ? row.label : key
      const description = typeof row.description === 'string' ? row.description : ''
      const progress = score(row.progress, 0)
      if (!key || !label) return null
      return { key, label, description, progress }
    })
    .filter((item): item is BabyAgent['skillTree'][number] => Boolean(item))
}

async function countRows(client: WarRoomSupabase, table: BabyAiTableName, dateColumn: string): Promise<CountResult> {
  const countQuery = client.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = client.from(table).select(dateColumn).order(dateColumn, { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) return { records: null, lastEventAt: null, error: countResult.error.message }
  if (latestResult.error) return { records: countResult.count ?? 0, lastEventAt: null, error: latestResult.error.message }
  const row = latestResult.data as Record<string, unknown> | null
  return {
    records: countResult.count ?? 0,
    lastEventAt: typeof row?.[dateColumn] === 'string' ? row[dateColumn] : null,
  }
}

function tableStatus(result: CountResult | null): BabyAiTableSummary['status'] {
  if (!result || result.error) return 'not_connected'
  return (result.records ?? 0) > 0 ? 'live_persistent' : 'persistent_store'
}

function tableSummary(table: BabyAiTableName, result: CountResult | null): BabyAiTableSummary {
  const status = tableStatus(result)
  return {
    table,
    records: result?.records ?? null,
    lastEventAt: result?.lastEventAt ?? null,
    status,
    detail: result?.error
      ? result.error
      : status === 'live_persistent'
        ? `${result?.records ?? 0} persisted row(s) verified.`
        : status === 'persistent_store'
          ? 'Table is reachable and awaiting Baby AI rows.'
          : 'Persistence is not configured or migration has not been applied.',
  }
}

function rowToAgent(row: BabyAgentRow): PersistedBabyAgent {
  const fallback = fallbackAgent(row.agent_key) ?? BABY_AI_AGENTS[0]!
  const growthLevel = LEVEL_FROM_INDEX[row.growth_level] ?? fallback.growthLevel
  return {
    key: fallback.key,
    displayName: row.display_name || fallback.displayName,
    familyIdentity: row.family_identity || fallback.familyIdentity,
    cloudProvider: fallback.cloudProvider,
    role: row.role || fallback.role,
    memoryScope: row.memory_scope ?? fallback.memoryScope,
    growthLevel,
    skillTree: parseSkillTree(row.skill_tree, fallback.skillTree),
    confidenceScore: score(row.confidence_score, fallback.confidenceScore),
    usefulnessScore: score(row.usefulness_score, fallback.usefulnessScore),
    latestLesson: row.latest_lesson || fallback.latestLesson,
    nextTrainingNeed: row.next_training_need || fallback.nextTrainingNeed,
    persistence: 'live_persistent',
    updatedAt: row.updated_at,
    trainingEventCount: null,
    memoryCount: null,
    outcomeCount: null,
  }
}

async function countByAgent(
  client: WarRoomSupabase,
  table: 'war_room_baby_agent_training_events' | 'war_room_baby_agent_memories' | 'war_room_baby_agent_outcomes',
): Promise<Map<string, number>> {
  const { data, error } = await client
    .from(table)
    .select('baby_agent_id, war_room_baby_agents!inner(agent_key)')
    .limit(1000)
  if (error || !Array.isArray(data)) return new Map()

  const counts = new Map<string, number>()
  for (const item of data as Array<Record<string, unknown>>) {
    const joined = item.war_room_baby_agents as Record<string, unknown> | Record<string, unknown>[] | undefined
    const agent = Array.isArray(joined) ? joined[0] : joined
    const key = typeof agent?.agent_key === 'string' ? agent.agent_key : null
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export async function summarizeBabyAiPersistence(client: WarRoomSupabase | null): Promise<BabyAiTableSummary[]> {
  if (!client) return TABLES.map(({ table }) => tableSummary(table, null))
  const counts = await Promise.all(TABLES.map(({ table, dateColumn }) => countRows(client, table, dateColumn)))
  return TABLES.map(({ table }, index) => tableSummary(table, counts[index] ?? null))
}

export async function listPersistedBabyAgents(client: WarRoomSupabase | null): Promise<PersistedBabyAgent[]> {
  if (!client) {
    return BABY_AI_AGENTS.map(agent => ({
      ...agent,
      persistence: 'static_seed',
      updatedAt: null,
      trainingEventCount: null,
      memoryCount: null,
      outcomeCount: null,
    }))
  }

  const { data, error } = await client
    .from('war_room_baby_agents')
    .select('agent_key,display_name,family_identity,role,lifecycle_state,growth_level,memory_scope,skill_tree,confidence_score,usefulness_score,latest_lesson,next_training_need,updated_at')
    .order('display_name', { ascending: true })

  if (error || !Array.isArray(data)) {
    return BABY_AI_AGENTS.map(agent => ({
      ...agent,
      persistence: 'not_connected',
      updatedAt: null,
      trainingEventCount: null,
      memoryCount: null,
      outcomeCount: null,
    }))
  }

  const rowsByKey = new Map((data as BabyAgentRow[]).map(row => [row.agent_key, rowToAgent(row)]))
  const [trainingCounts, memoryCounts, outcomeCounts] = await Promise.all([
    countByAgent(client, 'war_room_baby_agent_training_events'),
    countByAgent(client, 'war_room_baby_agent_memories'),
    countByAgent(client, 'war_room_baby_agent_outcomes'),
  ])

  return BABY_AI_AGENTS.map(seed => {
    const row = rowsByKey.get(seed.key) ?? {
      ...seed,
      persistence: 'persistent_store' as const,
      updatedAt: null,
      trainingEventCount: null,
      memoryCount: null,
      outcomeCount: null,
    }
    return {
      ...row,
      trainingEventCount: trainingCounts.get(seed.key) ?? 0,
      memoryCount: memoryCounts.get(seed.key) ?? 0,
      outcomeCount: outcomeCounts.get(seed.key) ?? 0,
    }
  })
}

export async function listLatestBabyLessons(client: WarRoomSupabase | null, limit = 8): Promise<string[]> {
  if (!client) return BABY_AI_AGENTS.map(agent => agent.latestLesson).slice(0, limit)
  const { data, error } = await client
    .from('war_room_baby_agent_memories')
    .select('lesson, lesson_state, created_at')
    .in('lesson_state', ['commander_approved', 'validated'] satisfies BabyLessonState[])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data)) return BABY_AI_AGENTS.map(agent => agent.latestLesson).slice(0, limit)
  return data
    .map(row => typeof (row as Record<string, unknown>).lesson === 'string' ? (row as { lesson: string }).lesson : '')
    .filter(Boolean)
}

export function babyAgentKeys(): BabyAgentKey[] {
  return BABY_AI_AGENTS.map(agent => agent.key)
}
