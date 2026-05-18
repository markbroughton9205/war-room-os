import 'server-only'

import { BABY_AI_AGENTS, BABY_AI_GUARDRAILS } from './model'
import { buildBabyCouncilIntegration } from './councilIntegration'
import { babyAiGovernanceRules } from './governance'
import {
  listLatestBabyLessons,
  listPersistedBabyAgents,
  summarizeBabyAiPersistence,
  type BabyAiPersistenceStatus,
  type BabyAiTableSummary,
  type PersistedBabyAgent,
} from './persistence'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export type BabyAiAcademySnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  overallStatus: BabyAiPersistenceStatus
  guardrails: typeof BABY_AI_GUARDRAILS
  lifecycle: {
    stages: string[]
    rule: string
  }
  learningSources: {
    id: string
    label: string
    permanenceRule: string
  }[]
  tables: BabyAiTableSummary[]
  agents: PersistedBabyAgent[]
  latestLessons: string[]
  council: ReturnType<typeof buildBabyCouncilIntegration>
  cloudOnly: {
    dependency: 'required_cloud_provider'
    statusCopy: string
  }
  governanceRules: string[]
  growthProgress: {
    state: 'listening' | 'extracting_lesson' | 'awaiting_commander_approval' | 'lesson_stored' | 'skill_improved' | 'blocked_by_missing_outcome' | 'blocked_by_missing_memory_table'
    progress: number
    currentLessonCandidate: string
    needsNext: string
    readiness: {
      memory: boolean
      outcome: boolean
      signal: boolean
      provider: boolean
      futureOnline: boolean
      futureOffline: boolean
    }
  }
  counts: {
    babyAgents: number
    persistedAgents: number | null
    trainingEvents: number | null
    approvedLessons: number | null
    outcomes: number | null
  }
}

function statusRank(status: BabyAiPersistenceStatus): number {
  return {
    live_persistent: 4,
    persistent_store: 3,
    awaiting_data: 2,
    static_seed: 1,
    not_connected: 0,
  }[status]
}

function overallStatus(tables: BabyAiTableSummary[], persistenceAvailable: boolean): BabyAiPersistenceStatus {
  if (!persistenceAvailable) return 'static_seed'
  if (tables.some(table => table.status === 'live_persistent')) return 'live_persistent'
  if (tables.some(table => table.status === 'persistent_store')) return 'persistent_store'
  return [...tables].sort((a, b) => statusRank(b.status) - statusRank(a.status))[0]?.status ?? 'not_connected'
}

function countFor(tables: BabyAiTableSummary[], table: string): number | null {
  return tables.find(item => item.table === table)?.records ?? null
}

function buildGrowthProgress(input: {
  tables: BabyAiTableSummary[]
  latestLessons: string[]
  persistenceAvailable: boolean
}): BabyAiAcademySnapshot['growthProgress'] {
  const memoryCount = countFor(input.tables, 'war_room_baby_agent_memories')
  const outcomeCount = countFor(input.tables, 'war_room_baby_agent_outcomes')
  const trainingCount = countFor(input.tables, 'war_room_baby_agent_training_events')
  const memoryReady = typeof memoryCount === 'number'
  const outcomeReady = typeof outcomeCount === 'number'
  const hasLesson = input.latestLessons.length > 0
  const state: BabyAiAcademySnapshot['growthProgress']['state'] = !input.persistenceAvailable || !memoryReady
    ? 'blocked_by_missing_memory_table'
    : !outcomeReady
      ? 'blocked_by_missing_outcome'
      : hasLesson && outcomeCount > 0
        ? 'skill_improved'
        : hasLesson
          ? 'lesson_stored'
          : trainingCount && trainingCount > 0
            ? 'awaiting_commander_approval'
            : 'listening'
  const base = state === 'blocked_by_missing_memory_table' ? 10
    : state === 'blocked_by_missing_outcome' ? 25
      : state === 'listening' ? 35
        : state === 'awaiting_commander_approval' ? 55
          : state === 'lesson_stored' ? 75
            : 90

  return {
    state,
    progress: base,
    currentLessonCandidate: input.latestLessons[0] ?? 'Awaiting a Commander-approved outcome or rejected-plan correction.',
    needsNext: state === 'skill_improved'
      ? 'Validate the improved skill against a real outcome before raising autonomy.'
      : state === 'lesson_stored'
        ? 'Connect the lesson to a measured outcome.'
        : state === 'awaiting_commander_approval'
          ? 'Commander approval or rejection for the extracted lesson.'
          : state === 'blocked_by_missing_memory_table'
            ? 'Apply Baby AI memory migration before lessons can persist.'
            : state === 'blocked_by_missing_outcome'
              ? 'Create or repair the Baby AI outcome table before skill growth can complete.'
              : 'More Live Council conversation, approved outcomes, rejected plans, and Commander corrections.',
    readiness: {
      memory: memoryReady,
      outcome: outcomeReady,
      signal: false,
      provider: false,
      futureOnline: input.persistenceAvailable,
      futureOffline: false,
    },
  }
}

export async function buildBabyAiAcademySnapshot(): Promise<BabyAiAcademySnapshot> {
  const generatedAt = new Date().toISOString()
  const sup = tryWarRoomSupabase()
  const client = sup.ok ? sup.client : null
  const [tables, agents, latestLessons] = await Promise.all([
    summarizeBabyAiPersistence(client),
    listPersistedBabyAgents(client),
    listLatestBabyLessons(client),
  ])
  const status = overallStatus(tables, sup.ok)
  const growthProgress = buildGrowthProgress({ tables, latestLessons, persistenceAvailable: sup.ok })

  return {
    generatedAt,
    persistenceAvailable: sup.ok,
    overallStatus: status,
    guardrails: BABY_AI_GUARDRAILS,
    lifecycle: {
      stages: ['seed', 'observing', 'learning', 'useful', 'specialist', 'senior'],
      rule: 'Promotion reflects approved lessons and validated outcomes; it does not grant execution authority.',
    },
    learningSources: [
      { id: 'approved_council_output', label: 'Approved council outputs', permanenceRule: 'Permanent only after Commander approval or repeated validated outcomes.' },
      { id: 'completed_project', label: 'Completed projects', permanenceRule: 'Outcome must be completed and attributable.' },
      { id: 'rejected_action', label: 'Rejected actions', permanenceRule: 'Negative training; cannot become an instruction to execute.' },
      { id: 'repair_outcome', label: 'Repair outcomes', permanenceRule: 'Repair result must be verified before lesson promotion.' },
      { id: 'opportunity_result', label: 'Opportunity results', permanenceRule: 'No claimed income without persisted proof.' },
      { id: 'analyst_finding', label: 'Analyst findings', permanenceRule: 'Finding needs evidence grading and follow-up.' },
      { id: 'commander_correction', label: 'Commander corrections', permanenceRule: 'Commander correction can approve or reject the lesson directly.' },
    ],
    tables,
    agents,
    latestLessons,
    council: buildBabyCouncilIntegration(agents.length ? agents : BABY_AI_AGENTS),
    cloudOnly: {
      dependency: 'required_cloud_provider',
      statusCopy: 'Baby AI growth uses War Room persistence, approved outcomes, and cloud provider families only. No offline connector stack is used.',
    },
    governanceRules: babyAiGovernanceRules(),
    growthProgress,
    counts: {
      babyAgents: BABY_AI_AGENTS.length,
      persistedAgents: countFor(tables, 'war_room_baby_agents'),
      trainingEvents: countFor(tables, 'war_room_baby_agent_training_events'),
      approvedLessons: countFor(tables, 'war_room_baby_agent_memories'),
      outcomes: countFor(tables, 'war_room_baby_agent_outcomes'),
    },
  }
}
