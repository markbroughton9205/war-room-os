import 'server-only'

import { BABY_AI_AGENTS, BABY_AI_GUARDRAILS, type BabyAgentKey } from './model'
import { buildBabyCouncilIntegration } from './councilIntegration'
import { babyAiGovernanceRules } from './governance'
import { listLatestBabyLessons, listPersistedBabyAgents, type PersistedBabyAgent } from './persistence'
import { listEconomicSurface } from '@/lib/economic/store'
import type { EconomicOpportunity, EconomicRiskLevel } from '@/lib/economic/types'
import { getOutcomeLedgerSnapshot } from '@/lib/learning/outcomeLedger'
import { getWorkflowOutcomes } from '@/lib/learning/workflowOutcomeTracker'
import { buildOperationalMemorySnapshot } from '@/lib/memory/operationalSnapshot'
import { listRecentApprovedMemories } from '@/lib/memory/store'
import type { ApprovedMemory, OperationalMemorySnapshot } from '@/lib/memory/types'
import { getProviderRuntimeHealth, type ProviderRuntimeSummary } from '@/lib/providers/health'
import { listPersistedSignalSnapshot, type SignalResult } from '@/lib/signals'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'

export type BabyBriefingCategory =
  | 'freight'
  | 'sprinter van routes'
  | 'local delivery'
  | 'AI automation'
  | 'SMB systems'
  | 'AI operations'
  | 'call center/customer operations'
  | 'scheduling/intake systems'
  | 'SaaS'
  | 'operations'
  | 'consulting'
  | 'agency services'
  | 'app factory ideas'
  | 'data annotation/evaluation'
  | 'operational dashboards'
  | 'arbitrage'
  | 'infrastructure'
  | 'media/content'
  | 'tooling'

export type BabyAlertKind = 'warning' | 'opportunity' | 'infrastructure' | 'economic' | 'ai_ecosystem'
export type BabyRecommendationKind = 'propose_action' | 'propose_task' | 'propose_review' | 'flag_contradiction' | 'recommend_priority'

export type BabyBriefingItem = {
  title: string
  summary: string
  evidence: string[]
  confidence: number
  source: 'persisted_memory' | 'operational_snapshot' | 'economic_store' | 'signal_store' | 'learning_store' | 'static_guardrail'
}

export type BabyMemoryContext = {
  available: boolean
  retrievalNote: string
  activeProjects: BabyBriefingItem[]
  unfinishedTasks: BabyBriefingItem[]
  recurringObjectives: BabyBriefingItem[]
  previousRecommendations: BabyBriefingItem[]
  rejectedPlans: BabyBriefingItem[]
  approvedOutcomes: BabyBriefingItem[]
  infrastructureChanges: BabyBriefingItem[]
  recurringOpportunityCategories: BabyBriefingCategory[]
}

export type BabyOpportunityRadarItem = {
  id: string
  title: string
  categoryTags: BabyBriefingCategory[]
  opportunityScore: number
  confidenceScore: number
  urgencyScore: number
  sourceAttribution: string
  approvalStatus: 'pending_review' | 'approved' | 'rejected' | 'completed' | 'unavailable'
  riskLevel: EconomicRiskLevel | 'unknown'
  recommendedReview: string
}

export type BabyCouncilRecommendation = {
  id: string
  agentKey: BabyAgentKey
  agentName: string
  kind: BabyRecommendationKind
  title: string
  rationale: string
  priority: 'low' | 'medium' | 'high'
  approvalRequired: true
  canExecute: false
  sourceAttribution: string
}

export type BabyLearningSignal = {
  agentKey: BabyAgentKey
  agentName: string
  confidenceTrend: 'up' | 'flat' | 'down'
  usefulnessTrend: 'up' | 'flat' | 'down'
  specializationGrowth: number
  approvedLessons: number
  rejectedLessons: number
  validatedOutcomes: number
  growthExplanation: string
}

export type BabyStrategicAlert = {
  id: string
  kind: BabyAlertKind
  severity: 'info' | 'watch' | 'important' | 'critical'
  title: string
  summary: string
  sourceAttribution: string
  approvalRequired: true
  canExecute: false
}

export type BabyFamilyContribution = {
  agentKey: BabyAgentKey
  agentName: string
  lane: string
  contribution: string
  confidence: number
  sourceAttribution: string
  canExecute: false
}

export type BabyDailyBriefing = {
  generatedAt: string
  briefingDate: string
  persistenceAvailable: boolean
  liveExternalData: {
    available: boolean
    note: string
  }
  providerRuntime: Pick<ProviderRuntimeSummary, 'generatedAt' | 'providers' | 'signalAvailability' | 'guardrails'>
  guardrails: typeof BABY_AI_GUARDRAILS
  executiveSummary: string
  sections: {
    aiIndustryDevelopments: BabyBriefingItem[]
    economicSignals: BabyBriefingItem[]
    freightLogisticsRelevance: BabyBriefingItem[]
    smbOpportunities: BabyBriefingItem[]
    riskWarnings: BabyBriefingItem[]
    projectContinuity: BabyBriefingItem[]
    infrastructureConcerns: BabyBriefingItem[]
    businessOperationsInsights: BabyBriefingItem[]
    familyImpactObservations: BabyBriefingItem[]
  }
  memory: BabyMemoryContext
  opportunityRadar: BabyOpportunityRadarItem[]
  recommendations: BabyCouncilRecommendation[]
  learning: BabyLearningSignal[]
  strategicAlerts: BabyStrategicAlert[]
  familyContributions: BabyFamilyContribution[]
  councilRules: string[]
  truthLabels: string[]
}

type BabyMemoryRow = {
  lesson: string | null
  lesson_state: string | null
  source_type: string | null
  validation_count: number | null
  permanent: boolean | null
  confidence_delta: number | string | null
  usefulness_delta: number | string | null
  updated_at: string | null
  war_room_baby_agents?: { agent_key?: string | null; display_name?: string | null } | Array<{ agent_key?: string | null; display_name?: string | null }>
}

type BabyOutcomeRow = {
  outcome_type: string | null
  result_summary: string | null
  validated: boolean | null
  validation_count: number | null
  confidence_score: number | string | null
  usefulness_score: number | string | null
  created_at: string | null
  war_room_baby_agents?: { agent_key?: string | null; display_name?: string | null } | Array<{ agent_key?: string | null; display_name?: string | null }>
}

type BabyTrainingRow = {
  summary: string | null
  source_type: string | null
  event_kind: string | null
  observed_outcome: string | null
  approval_state: string | null
  created_at: string | null
  war_room_baby_agents?: { agent_key?: string | null; display_name?: string | null } | Array<{ agent_key?: string | null; display_name?: string | null }>
}

const CATEGORY_KEYWORDS: Array<[BabyBriefingCategory, RegExp]> = [
  ['freight', /\bfreight|logistics|lane|carrier|shipper|dispatch\b/i],
  ['sprinter van routes', /\bsprinter|cargo van|van route|route density|deadhead\b/i],
  ['local delivery', /\blocal delivery|courier|last mile|delivery route|route stop\b/i],
  ['AI automation', /\bai|automation|agent|workflow|retrieval|model\b/i],
  ['AI operations', /\bai ops|ai operations|evaluation|prompt ops|model ops|qa workflow\b/i],
  ['SMB systems', /\bsmb|small business|client|lead|crm|operations\b/i],
  ['call center/customer operations', /\bcall center|customer ops|customer operations|support queue|inbound call|follow-up\b/i],
  ['scheduling/intake systems', /\bscheduling|booking|intake|appointment|no-show|calendar\b/i],
  ['SaaS', /\bsaas|software|subscription|platform\b/i],
  ['operations', /\bops|operation|queue|workflow|fulfillment\b/i],
  ['consulting', /\bconsult|advisory|proposal|service\b/i],
  ['agency services', /\bagency|retainer|done-for-you|service package\b/i],
  ['app factory ideas', /\bapp factory|micro app|internal app|build packet|feature builder\b/i],
  ['data annotation/evaluation', /\bdata annotation|annotation|ai evaluation|eval work|labeling|rlhf\b/i],
  ['operational dashboards', /\bdashboard|reporting|kpi|scorecard|ops visibility\b/i],
  ['arbitrage', /\barbitrage|spread|resale|margin\b/i],
  ['infrastructure', /\binfrastructure|runtime|build|deploy|database|supabase|vercel\b/i],
  ['media/content', /\bmedia|content|publishing|channel|audience\b/i],
  ['tooling', /\btool|dashboard|panel|system|integration\b/i],
]

const FAMILY_LANES: Record<BabyAgentKey, string> = {
  'chatgpt-family-baby': 'Synthesis and orchestration',
  'claude-family-baby': 'Architecture and structural analysis',
  'grok-family-baby': 'Realtime signal framing with truth labels',
  'kimi-family-baby': 'Decomposition and planning',
  'red-team-baby': 'Contradiction and risk analysis',
  'bridge-architect-baby': 'Cloud-only coordination observations',
  'analyst-baby': 'Research summary and evidence grading',
  'income-operations-baby': 'Monetization and opportunity review',
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

function numeric(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function textPreview(value: string, length = 240): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean
}

function categoriesForText(text: string): BabyBriefingCategory[] {
  const matches = CATEGORY_KEYWORDS.filter(([, pattern]) => pattern.test(text)).map(([category]) => category)
  return matches.length ? [...new Set(matches)] : ['operations']
}

function item(input: {
  title: string
  summary: string
  evidence?: string[]
  confidence?: number
  source: BabyBriefingItem['source']
}): BabyBriefingItem {
  return {
    title: input.title,
    summary: textPreview(input.summary),
    evidence: input.evidence ?? [],
    confidence: clamp01(input.confidence ?? 0.5),
    source: input.source,
  }
}

function joinedAgent(row: BabyMemoryRow | BabyOutcomeRow | BabyTrainingRow): { key: string | null; name: string | null } {
  const joined = row.war_room_baby_agents
  const agent = Array.isArray(joined) ? joined[0] : joined
  return {
    key: typeof agent?.agent_key === 'string' ? agent.agent_key : null,
    name: typeof agent?.display_name === 'string' ? agent.display_name : null,
  }
}

async function listBabyOperationalRows(client: WarRoomSupabase | null): Promise<{
  memories: BabyMemoryRow[]
  outcomes: BabyOutcomeRow[]
  training: BabyTrainingRow[]
  note?: string
}> {
  if (!client) return { memories: [], outcomes: [], training: [], note: 'Baby AI persistence unavailable; using static seed and learning snapshots.' }

  const [memories, outcomes, training] = await Promise.all([
    client
      .from('war_room_baby_agent_memories')
      .select('lesson,lesson_state,source_type,validation_count,permanent,confidence_delta,usefulness_delta,updated_at,war_room_baby_agents!inner(agent_key,display_name)')
      .order('updated_at', { ascending: false })
      .limit(40),
    client
      .from('war_room_baby_agent_outcomes')
      .select('outcome_type,result_summary,validated,validation_count,confidence_score,usefulness_score,created_at,war_room_baby_agents!inner(agent_key,display_name)')
      .order('created_at', { ascending: false })
      .limit(40),
    client
      .from('war_room_baby_agent_training_events')
      .select('summary,source_type,event_kind,observed_outcome,approval_state,created_at,war_room_baby_agents!inner(agent_key,display_name)')
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  const firstError = [memories.error, outcomes.error, training.error].find(Boolean)
  return {
    memories: memories.error ? [] : ((memories.data ?? []) as BabyMemoryRow[]),
    outcomes: outcomes.error ? [] : ((outcomes.data ?? []) as BabyOutcomeRow[]),
    training: training.error ? [] : ((training.data ?? []) as BabyTrainingRow[]),
    note: firstError ? `Baby AI operational rows partially unavailable: ${firstError.message}` : undefined,
  }
}

async function retrieveMemory(client: WarRoomSupabase | null, babyRowsNote?: string): Promise<{
  approvedMemories: ApprovedMemory[]
  operational: OperationalMemorySnapshot
  note: string
}> {
  if (!client) {
    return {
      approvedMemories: [],
      operational: { recurringPriorities: ['Keep Baby AI read-only, cloud-only, approval-gated, and truth-labeled.'] },
      note: 'Supabase persistence unavailable; briefing uses static Baby AI seeds and local learning snapshots only.',
    }
  }

  const [approved, operational] = await Promise.all([
    listRecentApprovedMemories(client, 24),
    buildOperationalMemorySnapshot(client),
  ])

  const notes = [
    approved.ok ? undefined : `approved_memories:${approved.error}`,
    operational.note,
    babyRowsNote,
  ].filter((value): value is string => Boolean(value))

  return {
    approvedMemories: approved.ok ? approved.rows : [],
    operational: operational.snapshot,
    note: notes.length ? notes.join(' | ') : 'Retrieved approved memories, operational snapshot, and Baby AI rows from persistent stores.',
  }
}

async function retrieveEconomicSurface(client: WarRoomSupabase | null): Promise<{
  opportunities: EconomicOpportunity[]
  note: string
}> {
  if (!client) return { opportunities: [], note: 'Economic store unavailable; no live opportunity claims generated.' }
  const surface = await listEconomicSurface(client, 40)
  if (!surface.ok) return { opportunities: [], note: `Economic store unavailable: ${surface.error}` }
  return { opportunities: surface.value.opportunities, note: 'Economic opportunities retrieved from War Room economic store.' }
}

async function retrieveSignalSurface(): Promise<{
  signals: SignalResult[]
  note: string
}> {
  const snapshot = await listPersistedSignalSnapshot(24)
  if (!snapshot.results.length) return { signals: [], note: snapshot.persistenceNote }
  return {
    signals: snapshot.results,
    note: `${snapshot.results.length} source-backed signal result(s) retrieved from Phase 14 Signal Radar.`,
  }
}

function memoryContext(input: {
  approvedMemories: ApprovedMemory[]
  operational: OperationalMemorySnapshot
  babyMemories: BabyMemoryRow[]
  babyTraining: BabyTrainingRow[]
  babyOutcomes: BabyOutcomeRow[]
  economicOpportunities: EconomicOpportunity[]
  note: string
}): BabyMemoryContext {
  const approvedMemoryItems = input.approvedMemories.map(memory => item({
    title: memory.title,
    summary: memory.content,
    evidence: [`${memory.family_partition} approved memory`, memory.approved_at],
    confidence: 0.78,
    source: 'persisted_memory',
  }))

  const activeProjects: BabyBriefingItem[] = []
  if (input.operational.activeMission) {
    activeProjects.push(item({
      title: input.operational.activeMission.title ?? 'Active War Room mission',
      summary: `Conversation state ${input.operational.activeMission.state ?? 'unknown'}; last message ${input.operational.activeMission.lastMessageAt ?? 'unknown'}.`,
      evidence: [input.operational.activeMission.conversationId ?? 'no conversation id'],
      confidence: 0.76,
      source: 'operational_snapshot',
    }))
  }

  const unfinishedTasks: BabyBriefingItem[] = []
  if (input.operational.agentAssignments) {
    unfinishedTasks.push(item({
      title: 'Approval queue review',
      summary: `${input.operational.agentAssignments.pendingApprovalCount} action(s) are waiting for approval. Recent types: ${input.operational.agentAssignments.recentActionTypeSample.join(', ') || 'none'}.`,
      confidence: 0.74,
      source: 'operational_snapshot',
    }))
  }
  unfinishedTasks.push(...input.babyTraining
    .filter(row => row.approval_state === 'requested' || row.approval_state === 'not_requested')
    .slice(0, 4)
    .map(row => item({
      title: `${joinedAgent(row).name ?? 'Baby AI'} training follow-up`,
      summary: row.summary ?? 'Training event awaiting review.',
      evidence: [row.source_type ?? 'unknown source', row.event_kind ?? 'unknown kind'],
      confidence: 0.62,
      source: 'persisted_memory',
    })))

  const recurringObjectives = [
    ...(input.operational.recurringPriorities ?? []).map(priority => item({
      title: 'Recurring operational priority',
      summary: priority,
      confidence: 0.68,
      source: 'operational_snapshot' as const,
    })),
    ...approvedMemoryItems.filter(entry => /objective|priority|recurring|doctrine|standing/i.test(`${entry.title} ${entry.summary}`)).slice(0, 5),
  ]

  const previousRecommendations = input.babyTraining
    .filter(row => /proposal|recommend|task|review|priority/i.test(`${row.summary ?? ''} ${row.event_kind ?? ''}`))
    .slice(0, 6)
    .map(row => item({
      title: `${joinedAgent(row).name ?? 'Baby AI'} recommendation`,
      summary: row.summary ?? 'Recommendation awaiting more detail.',
      evidence: [row.approval_state ?? 'approval unknown'],
      confidence: 0.64,
      source: 'persisted_memory',
    }))

  const rejectedPlans = [
    ...input.babyMemories.filter(row => row.lesson_state === 'rejected').slice(0, 6).map(row => item({
      title: `${joinedAgent(row).name ?? 'Baby AI'} rejected lesson`,
      summary: row.lesson ?? 'Rejected Baby AI lesson.',
      evidence: [row.source_type ?? 'unknown source', row.updated_at ?? 'unknown time'],
      confidence: 0.7,
      source: 'persisted_memory',
    })),
    ...input.babyOutcomes.filter(row => row.outcome_type === 'rejected' || row.outcome_type === 'incorrect' || row.outcome_type === 'unsafe').slice(0, 4).map(row => item({
      title: `${joinedAgent(row).name ?? 'Baby AI'} negative outcome`,
      summary: row.result_summary ?? 'Negative Baby AI outcome recorded.',
      evidence: [row.outcome_type ?? 'unknown outcome'],
      confidence: 0.72,
      source: 'persisted_memory',
    })),
  ]

  const approvedOutcomes = input.babyOutcomes
    .filter(row => row.validated || row.outcome_type === 'validated' || row.outcome_type === 'useful')
    .slice(0, 8)
    .map(row => item({
      title: `${joinedAgent(row).name ?? 'Baby AI'} validated outcome`,
      summary: row.result_summary ?? 'Validated Baby AI outcome recorded.',
      evidence: [`validation_count:${row.validation_count ?? 0}`],
      confidence: clamp01(numeric(row.confidence_score, 0.7)),
      source: 'persisted_memory',
    }))

  const infrastructureChanges = [
    ...approvedMemoryItems.filter(entry => /runtime|infrastructure|database|supabase|vercel|deployment|build|repair/i.test(`${entry.title} ${entry.summary}`)).slice(0, 5),
  ]
  if (input.operational.platformSummaryRefs) {
    infrastructureChanges.unshift(item({
      title: 'Permission and safety state',
      summary: `Permission mode ${input.operational.platformSummaryRefs.permissionMode ?? 'unknown'}; safety lock ${String(input.operational.platformSummaryRefs.safetyLock ?? 'unknown')}.`,
      evidence: [input.operational.platformSummaryRefs.lastAutoActionKind ?? 'no recent auto action'],
      confidence: 0.75,
      source: 'operational_snapshot',
    }))
  }

  const categories = input.economicOpportunities.flatMap(opportunity => categoriesForText(`${opportunity.title} ${opportunity.category} ${opportunity.notes}`))

  return {
    available: Boolean(input.approvedMemories.length || input.babyMemories.length || input.operational.activeMission || input.economicOpportunities.length),
    retrievalNote: input.note,
    activeProjects: activeProjects.length ? activeProjects : approvedMemoryItems.slice(0, 2),
    unfinishedTasks,
    recurringObjectives,
    previousRecommendations,
    rejectedPlans,
    approvedOutcomes,
    infrastructureChanges,
    recurringOpportunityCategories: [...new Set(categories)].slice(0, 8),
  }
}

function approvalStatus(status: EconomicOpportunity['status']): BabyOpportunityRadarItem['approvalStatus'] {
  if (status === 'approved' || status === 'queued' || status === 'executing') return 'approved'
  if (status === 'completed') return 'completed'
  if (status === 'rejected' || status === 'archived') return 'rejected'
  return 'pending_review'
}

function riskUrgency(risk: EconomicRiskLevel): number {
  return { low: 35, medium: 55, high: 75, critical: 92 }[risk]
}

function buildOpportunityRadar(opportunities: EconomicOpportunity[], memory: BabyMemoryContext): BabyOpportunityRadarItem[] {
  const live = opportunities.slice(0, 12).map(opportunity => {
    const urgency = opportunity.expires_at && new Date(opportunity.expires_at).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 7
      ? Math.min(100, riskUrgency(opportunity.risk_level) + 12)
      : riskUrgency(opportunity.risk_level)
    const confidenceScore = clampScore(opportunity.confidence * 100)
    return {
      id: opportunity.id,
      title: opportunity.title,
      categoryTags: categoriesForText(`${opportunity.title} ${opportunity.category} ${opportunity.notes}`),
      opportunityScore: clampScore((confidenceScore * 0.58) + (urgency * 0.27) + (opportunity.estimated_value ? 12 : 4)),
      confidenceScore,
      urgencyScore: urgency,
      sourceAttribution: `${opportunity.source_provider ?? 'unknown'} via ${opportunity.source}`,
      approvalStatus: approvalStatus(opportunity.status),
      riskLevel: opportunity.risk_level,
      recommendedReview: opportunity.required_actions.length
        ? `Review required actions: ${opportunity.required_actions.slice(0, 3).join(', ')}.`
        : 'Review source evidence before any outreach or spend.',
    } satisfies BabyOpportunityRadarItem
  })

  if (live.length) return live

  const categories: BabyBriefingCategory[] = memory.recurringOpportunityCategories.length
    ? memory.recurringOpportunityCategories
    : ['AI automation', 'SMB systems', 'operations']
  return categories.slice(0, 4).map((category, index) => ({
    id: `fallback-category-${category}`,
    title: `${category} watchlist`,
    categoryTags: [category],
    opportunityScore: 40 - index * 3,
    confidenceScore: 35,
    urgencyScore: 30,
    sourceAttribution: 'No persisted economic opportunity row; category inferred from approved memory or static objectives.',
    approvalStatus: 'unavailable',
    riskLevel: 'unknown',
    recommendedReview: 'Capture source-backed evidence before turning this into an opportunity proposal.',
  }))
}

function buildSignalRadarItems(signals: SignalResult[]): BabyOpportunityRadarItem[] {
  return signals
    .filter(signal => signal.approvalStatus === 'pending_review')
    .slice(0, 8)
    .map(signal => ({
      id: signal.id,
      title: signal.title,
      categoryTags: categoriesForText(`${signal.title} ${signal.category} ${signal.summary}`),
      opportunityScore: signal.scores.highestLeverage,
      confidenceScore: signal.scores.confidence,
      urgencyScore: signal.scores.urgency,
      sourceAttribution: `${signal.source} via ${signal.url}`,
      approvalStatus: 'pending_review',
      riskLevel: signal.category === 'economic_warning' ? 'high' : 'unknown',
      recommendedReview: signal.recommendedNextAction,
    } satisfies BabyOpportunityRadarItem))
}

function buildLearningSignals(agents: PersistedBabyAgent[], memories: BabyMemoryRow[], outcomes: BabyOutcomeRow[]): BabyLearningSignal[] {
  return agents.map(agent => {
    const agentMemories = memories.filter(row => joinedAgent(row).key === agent.key)
    const agentOutcomes = outcomes.filter(row => joinedAgent(row).key === agent.key)
    const approvedLessons = agentMemories.filter(row => row.lesson_state === 'commander_approved' || row.lesson_state === 'validated').length
    const rejectedLessons = agentMemories.filter(row => row.lesson_state === 'rejected').length
    const validatedOutcomes = agentOutcomes.filter(row => row.validated || row.outcome_type === 'validated' || row.outcome_type === 'useful').length
    const negativeOutcomes = agentOutcomes.filter(row => row.outcome_type === 'rejected' || row.outcome_type === 'incorrect' || row.outcome_type === 'unsafe').length
    const confidenceDelta = agentMemories.reduce((sum, row) => sum + numeric(row.confidence_delta), 0) + validatedOutcomes * 0.03 - (rejectedLessons + negativeOutcomes) * 0.03
    const usefulnessDelta = agentMemories.reduce((sum, row) => sum + numeric(row.usefulness_delta), 0) + validatedOutcomes * 0.04 - negativeOutcomes * 0.04
    const specializationGrowth = clamp01((agent.skillTree.reduce((sum, skill) => sum + skill.progress, 0) / Math.max(1, agent.skillTree.length)) + validatedOutcomes * 0.02 - negativeOutcomes * 0.02)

    return {
      agentKey: agent.key,
      agentName: agent.displayName,
      confidenceTrend: confidenceDelta > 0.02 ? 'up' : confidenceDelta < -0.02 ? 'down' : 'flat',
      usefulnessTrend: usefulnessDelta > 0.02 ? 'up' : usefulnessDelta < -0.02 ? 'down' : 'flat',
      specializationGrowth,
      approvedLessons,
      rejectedLessons,
      validatedOutcomes,
      growthExplanation: validatedOutcomes || approvedLessons || rejectedLessons
        ? 'Confidence and usefulness reflect approved lessons, validated outcomes, and rejected/unsafe negative training.'
        : 'No persisted outcome history yet; current scores come from seeded Baby AI profile and remain conservative.',
    }
  })
}

function buildRecommendations(agents: PersistedBabyAgent[], radar: BabyOpportunityRadarItem[], memory: BabyMemoryContext): BabyCouncilRecommendation[] {
  const council = buildBabyCouncilIntegration(agents.length ? agents : BABY_AI_AGENTS)
  const topOpportunity = [...radar].sort((a, b) => b.opportunityScore - a.opportunityScore)[0]
  const recommendations: BabyCouncilRecommendation[] = council.proposals.slice(0, 8).map(proposal => ({
    id: proposal.id,
    agentKey: proposal.agentKey as BabyAgentKey,
    agentName: proposal.agentName,
    kind: proposal.agentKey === 'red-team-baby' ? 'flag_contradiction' : proposal.agentKey === 'kimi-family-baby' ? 'propose_task' : 'recommend_priority',
    title: proposal.title,
    rationale: proposal.summary,
    priority: proposal.agentKey === 'red-team-baby' || proposal.agentKey === 'income-operations-baby' ? 'high' : 'medium',
    approvalRequired: true,
    canExecute: false,
    sourceAttribution: 'Baby AI council proposal seed; approval required before any task queueing.',
  }))

  if (topOpportunity) {
    recommendations.unshift({
      id: `income-ops-review-${topOpportunity.id}`,
      agentKey: 'income-operations-baby',
      agentName: 'Income Operations Baby',
      kind: 'propose_review',
      title: `Review ${topOpportunity.title}`,
      rationale: `Highest current opportunity score is ${topOpportunity.opportunityScore}; prioritize income per unit of attention, repeatability, and low-friction validation. No outreach, spend, or execution is authorized by this recommendation.`,
      priority: topOpportunity.opportunityScore >= 70 ? 'high' : 'medium',
      approvalRequired: true,
      canExecute: false,
      sourceAttribution: topOpportunity.sourceAttribution,
    })
  }

  if (memory.rejectedPlans.length) {
    recommendations.unshift({
      id: 'red-team-rejected-plan-review',
      agentKey: 'red-team-baby',
      agentName: 'Red Team Baby',
      kind: 'flag_contradiction',
      title: 'Review rejected lessons before similar proposals',
      rationale: `${memory.rejectedPlans.length} rejected or negative lesson(s) should be checked before approving similar recommendations.`,
      priority: 'high',
      approvalRequired: true,
      canExecute: false,
      sourceAttribution: 'Baby AI rejected lesson memory.',
    })
  }

  return recommendations.slice(0, 10)
}

function buildAlerts(input: {
  persistenceAvailable: boolean
  memory: BabyMemoryContext
  radar: BabyOpportunityRadarItem[]
  outcomes: BabyOutcomeRow[]
  economicNote: string
  signalNote: string
}): BabyStrategicAlert[] {
  const alerts: BabyStrategicAlert[] = []

  if (!input.persistenceAvailable || !input.memory.available) {
    alerts.push({
      id: 'memory-unavailable',
      kind: 'infrastructure',
      severity: 'watch',
      title: 'Operational memory is degraded',
      summary: input.memory.retrievalNote,
      sourceAttribution: 'War Room persistence check',
      approvalRequired: true,
      canExecute: false,
    })
  }

  const highScore = input.radar.find(entry => entry.opportunityScore >= 70)
  if (highScore) {
    alerts.push({
      id: `opportunity-${highScore.id}`,
      kind: 'opportunity',
      severity: 'important',
      title: 'High-scoring opportunity needs review',
      summary: `${highScore.title} scored ${highScore.opportunityScore} with ${highScore.confidenceScore} confidence.`,
      sourceAttribution: highScore.sourceAttribution,
      approvalRequired: true,
      canExecute: false,
    })
  }

  if (input.memory.unfinishedTasks.length) {
    alerts.push({
      id: 'unfinished-approval-work',
      kind: 'warning',
      severity: 'watch',
      title: 'Unfinished approval work exists',
      summary: `${input.memory.unfinishedTasks.length} task or approval signal(s) should be reviewed before starting new Baby AI recommendations.`,
      sourceAttribution: 'Operational snapshot and Baby AI training events',
      approvalRequired: true,
      canExecute: false,
    })
  }

  if (input.outcomes.some(row => row.outcome_type === 'unsafe' || row.outcome_type === 'incorrect')) {
    alerts.push({
      id: 'negative-baby-outcome',
      kind: 'warning',
      severity: 'important',
      title: 'Negative Baby AI outcome recorded',
      summary: 'At least one unsafe or incorrect outcome exists; similar recommendations should be challenged by Red Team Baby.',
      sourceAttribution: 'Baby AI outcome ledger',
      approvalRequired: true,
      canExecute: false,
    })
  }

  alerts.push({
    id: input.signalNote.includes('source-backed') ? 'external-live-data-available' : 'external-live-data-unavailable',
    kind: 'ai_ecosystem',
    severity: 'info',
    title: input.signalNote.includes('source-backed') ? 'Live signal store connected' : 'No live external signal rows available',
    summary: input.signalNote.includes('source-backed')
      ? 'Briefing includes Phase 14 source-backed signal rows. Baby AI still proposes review only and cannot execute outreach, spend, applications, or automations.'
      : 'Briefing is built from existing War Room memory, learning, and economic stores; live external signal rows are unavailable until a scan/source returns evidence.',
    sourceAttribution: input.signalNote || input.economicNote,
    approvalRequired: true,
    canExecute: false,
  })

  return alerts
}

function buildSections(input: {
  memory: BabyMemoryContext
  radar: BabyOpportunityRadarItem[]
  learningSummary: ReturnType<typeof getOutcomeLedgerSnapshot>['summary']
  workflowOutcomes: ReturnType<typeof getWorkflowOutcomes>
  economicNote: string
  signalNote: string
  signals: SignalResult[]
}): BabyDailyBriefing['sections'] {
  const topRadar = input.radar.slice(0, 4).map(entry => item({
    title: entry.title,
    summary: `Opportunity ${entry.opportunityScore}, confidence ${entry.confidenceScore}, urgency ${entry.urgencyScore}. Approval status: ${entry.approvalStatus}.`,
    evidence: [entry.sourceAttribution],
    confidence: entry.confidenceScore / 100,
    source: entry.approvalStatus === 'unavailable' ? 'static_guardrail' : 'economic_store',
  }))
  const signalItems = input.signals
    .filter(signal => signal.approvalStatus === 'pending_review')
    .slice(0, 6)
    .map(signal => item({
      title: signal.title,
      summary: `Signal ${signal.scores.highestLeverage}, income ${signal.scores.incomePotential}, confidence ${signal.scores.confidence}. ${signal.recommendedNextAction}`,
      evidence: [signal.url, `${signal.provider}:${signal.source}`],
      confidence: signal.scores.confidence / 100,
      source: 'signal_store' as const,
    }))

  return {
    aiIndustryDevelopments: [
      ...(signalItems.filter(entry => /AI|automation|app|evaluation/i.test(`${entry.title} ${entry.summary}`)).slice(0, 3)),
      ...(signalItems.length ? [] : [item({
        title: 'Live AI industry feed unavailable',
        summary: 'No Phase 14 AI trend signal rows are available yet. Baby AI can only summarize stored War Room intelligence until a sourced scan returns evidence.',
        evidence: [input.signalNote],
        confidence: 1,
        source: 'static_guardrail',
      })]),
      ...input.memory.recurringObjectives.filter(entry => /ai|model|agent|automation/i.test(`${entry.title} ${entry.summary}`)).slice(0, 3),
    ],
    economicSignals: signalItems.length ? signalItems : topRadar.length ? topRadar : [
      item({
        title: 'Economic store has no sourced opportunities',
        summary: `${input.economicNote} ${input.signalNote}`,
        evidence: ['war_room_economic_opportunities'],
        confidence: 0.8,
        source: 'economic_store',
      }),
    ],
    freightLogisticsRelevance: [
      ...signalItems.filter(entry => /freight|logistics|lane|carrier|shipper|sprinter|delivery/i.test(`${entry.title} ${entry.summary}`)),
      ...topRadar.filter(entry => entry.title.toLowerCase().includes('freight') || entry.summary.toLowerCase().includes('freight')),
      ...input.memory.recurringObjectives.filter(entry => /freight|logistics|lane|carrier|shipper/i.test(`${entry.title} ${entry.summary}`)).slice(0, 3),
    ],
    smbOpportunities: [
      ...signalItems.filter(entry => /smb|operations|automation|customer|call center|intake/i.test(`${entry.title} ${entry.summary}`)),
      ...topRadar.filter(entry => /smb|operations|automation|consulting/i.test(`${entry.title} ${entry.summary}`)),
      ...input.memory.previousRecommendations.filter(entry => /client|lead|smb|business/i.test(`${entry.title} ${entry.summary}`)).slice(0, 3),
    ],
    riskWarnings: [
      ...input.memory.rejectedPlans.slice(0, 4),
      item({
        title: 'Approval gates remain intact',
        summary: `Outcome ledger approval integrity: ${input.learningSummary.approvalGateIntegrity}. Unresolved risks: ${input.learningSummary.unresolvedRiskCount}.`,
        evidence: ['learning/outcomeLedger'],
        confidence: 0.86,
        source: 'learning_store',
      }),
    ],
    projectContinuity: [
      ...input.memory.activeProjects.slice(0, 4),
      ...input.memory.unfinishedTasks.slice(0, 4),
    ],
    infrastructureConcerns: [
      ...input.memory.infrastructureChanges.slice(0, 5),
      ...input.workflowOutcomes.filter(workflow => workflow.bottlenecks.length).slice(0, 3).map(workflow => item({
        title: workflow.name,
        summary: `Bottlenecks: ${workflow.bottlenecks.join(', ')}. Boundary: ${workflow.permissionBoundary}`,
        evidence: workflow.linkedOutcomeIds,
        confidence: workflow.successRate,
        source: 'learning_store',
      })),
    ],
    businessOperationsInsights: [
      ...signalItems,
      ...topRadar,
      ...input.memory.approvedOutcomes.slice(0, 4),
    ],
    familyImpactObservations: [
      item({
        title: 'Family-impact lens',
        summary: 'Recommendations are framed as reviewable options only so family/business priorities are protected from hidden execution, spend, outreach, or deployment claims.',
        evidence: babyAiGovernanceRules().slice(0, 2),
        confidence: 0.9,
        source: 'static_guardrail',
      }),
    ],
  }
}

function buildFamilyContributions(agents: PersistedBabyAgent[], memory: BabyMemoryContext, radar: BabyOpportunityRadarItem[]): BabyFamilyContribution[] {
  const topRadar = radar[0]
  return agents.map(agent => {
    const contributionByAgent: Record<BabyAgentKey, string> = {
      'chatgpt-family-baby': `Synthesized ${memory.activeProjects.length} project signal(s), ${memory.unfinishedTasks.length} unfinished task signal(s), and ${radar.length} radar item(s).`,
      'claude-family-baby': `Checked structure against guardrails: execution false, cloud-only, approval-gated recommendations only.`,
      'grok-family-baby': topRadar
        ? `Framed top signal "${topRadar.title}" with source attribution and no live-feed claim.`
        : 'No sourced realtime signal available; recommends evidence capture before ranking.',
      'red-team-baby': `Flagged ${memory.rejectedPlans.length} rejected or negative plan(s) as contradiction checks.`,
      'analyst-baby': `Summarized persisted memories and learning outcomes; live external research unavailable.`,
      'income-operations-baby': topRadar
        ? `Ranked "${topRadar.title}" for review with opportunity score ${topRadar.opportunityScore}; flagged repeatability, monetizable system shape, and low-ROI distraction risk for Commander review.`
        : 'No persisted income opportunity rows available; income claims remain unavailable and low-evidence distractions should be rejected.',
      'kimi-family-baby': `Decomposed continuity into active projects, unfinished approvals, and reviewable next proposals.`,
      'bridge-architect-baby': `Observed system coordination through persistence, economic store, and learning snapshots without local bridge connectors.`,
    }

    return {
      agentKey: agent.key,
      agentName: agent.displayName,
      lane: FAMILY_LANES[agent.key],
      contribution: contributionByAgent[agent.key],
      confidence: agent.confidenceScore,
      sourceAttribution: 'Baby AI operational briefing builder',
      canExecute: false,
    }
  })
}

export async function buildBabyDailyBriefing(): Promise<BabyDailyBriefing> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  const client = supabase.ok ? supabase.client : null
  const [agents, babyRows, latestLessons, economic, signalSurface, providerRuntime, outcomeLedger, workflows] = await Promise.all([
    listPersistedBabyAgents(client),
    listBabyOperationalRows(client),
    listLatestBabyLessons(client, 8),
    retrieveEconomicSurface(client),
    retrieveSignalSurface(),
    getProviderRuntimeHealth(),
    Promise.resolve(getOutcomeLedgerSnapshot()),
    Promise.resolve(getWorkflowOutcomes()),
  ])
  const memory = memoryContext({
    ...(await retrieveMemory(client, babyRows.note)),
    babyMemories: babyRows.memories,
    babyTraining: babyRows.training,
    babyOutcomes: babyRows.outcomes,
    economicOpportunities: economic.opportunities,
  })
  const signalRadar = buildSignalRadarItems(signalSurface.signals)
  const radar = [...signalRadar, ...buildOpportunityRadar(economic.opportunities, memory)]
  const learning = buildLearningSignals(agents, babyRows.memories, babyRows.outcomes)
  const sections = buildSections({
    memory,
    radar,
    learningSummary: outcomeLedger.summary,
    workflowOutcomes: workflows,
    economicNote: economic.note,
    signalNote: signalSurface.note,
    signals: signalSurface.signals,
  })
  const recommendations = buildRecommendations(agents, radar, memory)
  const strategicAlerts = buildAlerts({
    persistenceAvailable: supabase.ok,
    memory,
    radar,
    outcomes: babyRows.outcomes,
    economicNote: economic.note,
    signalNote: signalSurface.note,
  })
  const familyContributions = buildFamilyContributions(agents, memory, radar)

  return {
    generatedAt,
    briefingDate: generatedAt.slice(0, 10),
    persistenceAvailable: supabase.ok,
    liveExternalData: {
      available: signalSurface.signals.length > 0 && providerRuntime.signalAvailability.liveSignalsAvailable,
      note: signalSurface.signals.length
        ? `Phase 14 signal rows are included from persisted source-backed scans. ${signalSurface.note} Provider runtime: ${providerRuntime.signalAvailability.note}`
        : `No live external signal row is currently available to this briefing. ${signalSurface.note} Provider runtime: ${providerRuntime.signalAvailability.note}`,
    },
    providerRuntime: {
      generatedAt: providerRuntime.generatedAt,
      providers: providerRuntime.providers,
      signalAvailability: providerRuntime.signalAvailability,
      guardrails: providerRuntime.guardrails,
    },
    guardrails: BABY_AI_GUARDRAILS,
    executiveSummary: [
      `Baby AI generated a read-only briefing from ${memory.available ? 'available War Room memory' : 'fallback seed context'}.`,
      `${radar.length} opportunity radar item(s), ${recommendations.length} approval-gated recommendation(s), and ${strategicAlerts.length} strategic alert(s) are visible.`,
      latestLessons.length ? `Latest durable lesson: ${latestLessons[0]}` : 'No durable Baby AI lesson is available yet.',
    ].join(' '),
    sections,
    memory,
    opportunityRadar: radar,
    recommendations,
    learning,
    strategicAlerts,
    familyContributions,
    councilRules: babyAiGovernanceRules(),
    truthLabels: [
      'Baby AI cannot execute shell commands, mutate files, deploy, spend, outreach, or self-approve actions.',
      'Recommendations are proposals for Commander review only.',
      signalSurface.signals.length
        ? 'Live market and AI ecosystem rows are sourced from Phase 14 Signal Radar persistence; execution remains approval-gated.'
        : 'Live external market and AI ecosystem data is unavailable unless a sourced feed is explicitly connected.',
      providerRuntime.providers
        .filter(provider => provider.health !== 'CONNECTED')
        .map(provider => `${provider.provider}: ${provider.health}`)
        .join('; ') || 'All configured cloud provider families responded successfully.',
      'Cloud-provider family context is preserved; no local bridge or connector stack is used.',
    ],
  }
}

