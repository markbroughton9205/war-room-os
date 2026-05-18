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
    counts: {
      babyAgents: BABY_AI_AGENTS.length,
      persistedAgents: countFor(tables, 'war_room_baby_agents'),
      trainingEvents: countFor(tables, 'war_room_baby_agent_training_events'),
      approvedLessons: countFor(tables, 'war_room_baby_agent_memories'),
      outcomes: countFor(tables, 'war_room_baby_agent_outcomes'),
    },
  }
}
