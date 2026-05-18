import 'server-only'

import { buildBabyDailyBriefing } from '@/lib/baby-ai/operationalIntelligence'
import { listGrowthCalendarSnapshot } from '@/lib/growth-calendar'
import { listOutcomeSnapshot } from '@/lib/outcomes'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  buildCommanderMetrics,
  buildCommanderPatterns,
  buildCommanderReview,
  buildHighestLeverageMove,
  buildLifePositioning,
  buildMomentum,
  buildRealityCorrections,
  buildTrajectoryPoint,
  type SourceSnapshots,
} from './scoring'
import {
  COMMANDER_REVIEW_PERIODS,
  type CommanderMetrics,
  type CommanderPattern,
  type CommanderProfile,
  type CommanderProfileInput,
  type CommanderReview,
  type CommanderReviewPeriod,
  type CommanderSnapshot,
  type CommanderTrajectoryPoint,
} from './model'

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function boundedScore(value: number | null | undefined, fallback = 50): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean).slice(0, 30)
    : []
}

function period(value: unknown): CommanderReviewPeriod {
  const raw = text(value)
  return (COMMANDER_REVIEW_PERIODS as readonly string[]).includes(raw) ? raw as CommanderReviewPeriod : 'weekly'
}

function direction(value: unknown): CommanderMetrics['trajectoryDirection'] {
  const raw = text(value)
  return ['unknown', 'advancing', 'holding', 'drifting', 'overloaded'].includes(raw)
    ? raw as CommanderMetrics['trajectoryDirection']
    : 'unknown'
}

function mapProfile(row: Row): CommanderProfile {
  return {
    id: text(row.id, 'commander'),
    activeGoals: stringArray(row.active_goals),
    unfinishedInitiatives: stringArray(row.unfinished_initiatives),
    recurringBottlenecks: stringArray(row.recurring_bottlenecks),
    strongestLeverageZones: stringArray(row.strongest_leverage_zones),
    distractionPatterns: stringArray(row.distraction_patterns),
    bestExecutionWindows: stringArray(row.best_execution_windows),
    bestWorkflows: stringArray(row.best_workflows),
    stressLoadScore: boundedScore(num(row.stress_load_score, 50)),
    familyImpactScore: boundedScore(num(row.family_impact_score, 70)),
    notes: text(row.notes),
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
  }
}

function mapReview(row: Row): CommanderReview {
  return {
    id: text(row.id),
    period: period(row.period),
    summary: text(row.summary),
    advancedPosition: stringArray(row.advanced_position),
    wastedTime: stringArray(row.wasted_time),
    strongestOpportunities: stringArray(row.strongest_opportunities),
    highestRoiActions: stringArray(row.highest_roi_actions),
    compoundingBehaviors: stringArray(row.compounding_behaviors),
    repeatedMistakes: stringArray(row.repeated_mistakes),
    nextStrategicFocus: text(row.next_strategic_focus),
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapTrajectory(row: Row): CommanderTrajectoryPoint {
  return {
    id: text(row.id),
    period: period(row.period),
    direction: direction(row.direction),
    leverageScore: boundedScore(num(row.leverage_score)),
    executionScore: boundedScore(num(row.execution_score)),
    momentumScore: boundedScore(num(row.momentum_score)),
    incomePerHourEstimate: row.income_per_hour_estimate == null ? null : num(row.income_per_hour_estimate),
    summary: text(row.summary),
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function profileRow(input: CommanderProfileInput) {
  return {
    id: 'commander',
    active_goals: stringArray(input.activeGoals),
    unfinished_initiatives: stringArray(input.unfinishedInitiatives),
    recurring_bottlenecks: stringArray(input.recurringBottlenecks),
    strongest_leverage_zones: stringArray(input.strongestLeverageZones),
    distraction_patterns: stringArray(input.distractionPatterns),
    best_execution_windows: stringArray(input.bestExecutionWindows),
    best_workflows: stringArray(input.bestWorkflows),
    stress_load_score: boundedScore(input.stressLoadScore, 50),
    family_impact_score: boundedScore(input.familyImpactScore, 70),
    notes: input.notes ?? '',
    approval_required: true,
    can_execute: false,
    evidence: input.evidence ?? { explicitCommanderProfile: true },
  }
}

function metricsRow(metrics: CommanderMetrics) {
  return {
    id: metrics.id,
    leverage_score: metrics.leverageScore,
    execution_score: metrics.executionScore,
    focus_stability: metrics.focusStability,
    momentum_score: metrics.momentumScore,
    compounding_score: metrics.compoundingScore,
    burnout_risk: metrics.burnoutRisk,
    strategic_alignment: metrics.strategicAlignment,
    opportunity_responsiveness: metrics.opportunityResponsiveness,
    time_to_action_hours: metrics.timeToActionHours,
    income_per_hour_estimate: metrics.incomePerHourEstimate,
    roi_trend: metrics.roiTrend,
    trajectory_direction: metrics.trajectoryDirection,
    source_summary: metrics.sourceSummary,
    evidence: metrics.evidence,
    generated_at: metrics.generatedAt,
    approval_required: true,
    can_execute: false,
  }
}

function patternRow(pattern: CommanderPattern) {
  return {
    id: pattern.id,
    kind: pattern.kind,
    title: pattern.title,
    summary: pattern.summary,
    score: pattern.score,
    severity: pattern.severity,
    source: pattern.source,
    evidence: pattern.evidence,
    generated_at: pattern.generatedAt,
    approval_required: true,
    can_execute: false,
  }
}

function reviewRow(review: CommanderReview) {
  return {
    id: review.id,
    period: review.period,
    summary: review.summary,
    advanced_position: review.advancedPosition,
    wasted_time: review.wastedTime,
    strongest_opportunities: review.strongestOpportunities,
    highest_roi_actions: review.highestRoiActions,
    compounding_behaviors: review.compoundingBehaviors,
    repeated_mistakes: review.repeatedMistakes,
    next_strategic_focus: review.nextStrategicFocus,
    approval_required: true,
    can_execute: false,
    evidence: review.evidence,
    created_at: review.createdAt,
  }
}

function trajectoryRow(point: CommanderTrajectoryPoint) {
  return {
    id: point.id,
    period: point.period,
    direction: point.direction,
    leverage_score: point.leverageScore,
    execution_score: point.executionScore,
    momentum_score: point.momentumScore,
    income_per_hour_estimate: point.incomePerHourEstimate,
    summary: point.summary,
    approval_required: true,
    can_execute: false,
    evidence: point.evidence,
    created_at: point.createdAt,
  }
}

async function loadProfile(client: WarRoomSupabase | null): Promise<CommanderProfile | null> {
  if (!client) return null
  const { data, error } = await client
    .from('war_room_commander_profile')
    .select('*')
    .eq('id', 'commander')
    .maybeSingle()
  if (error || !data) return null
  return mapProfile(data as Row)
}

async function buildSources(client: WarRoomSupabase | null, generatedAt: string): Promise<SourceSnapshots> {
  const [profile, outcomes, revenue, signals, calendar, briefing] = await Promise.all([
    loadProfile(client),
    listOutcomeSnapshot(100),
    listRevenueEngineSnapshot(40),
    listPersistedSignalSnapshot(40),
    listGrowthCalendarSnapshot(40),
    buildBabyDailyBriefing(),
  ])

  return {
    generatedAt,
    profile,
    outcomes,
    revenue,
    signals,
    calendar,
    briefing,
  }
}

function buildSnapshot(input: {
  sources: SourceSnapshots
  persistenceAvailable: boolean
  persistenceNote: string
  storedReviews?: CommanderReview[]
  storedTrajectory?: CommanderTrajectoryPoint[]
}): CommanderSnapshot {
  const metrics = buildCommanderMetrics(input.sources)
  const patterns = buildCommanderPatterns(input.sources)
  const highestLeverageMove = buildHighestLeverageMove(input.sources, metrics)
  const realityCorrectionAlerts = buildRealityCorrections(input.sources, metrics)
  const momentum = buildMomentum(input.sources, metrics)
  const lifePositioning = buildLifePositioning(input.sources, metrics)
  const generatedReview = buildCommanderReview(input.sources, metrics, highestLeverageMove, 'daily')
  const generatedTrajectory = buildTrajectoryPoint(input.sources, metrics, 'daily')

  return {
    generatedAt: input.sources.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    profile: input.sources.profile,
    metrics,
    highestLeverageMove,
    momentum,
    lifePositioning,
    patterns,
    realityCorrectionAlerts,
    reviews: [generatedReview, ...(input.storedReviews ?? [])].slice(0, 20),
    trajectory: [generatedTrajectory, ...(input.storedTrajectory ?? [])].slice(0, 30),
    integrations: {
      revenueEngine: input.sources.revenue.opportunities.slice(0, 3).map(item => `${item.title} -> ${item.nextReviewAction}`),
      signalRadar: input.sources.signals.results.slice(0, 3).map(item => `${item.title} (${item.approvalStatus})`),
      outcomeLedger: input.sources.outcomes.outcomes.slice(0, 3).map(item => `${item.title}: ${item.resultStatus}`),
      growthCalendar: input.sources.calendar.recommendations.slice(0, 3).map(item => `${item.title} -> ${item.recommendedTimeWindow}`),
      babyAi: input.sources.briefing.recommendations.slice(0, 3).map(item => `${item.agentName}: ${item.title}`),
    },
    guardrails: {
      recommendationOnly: true,
      approvalGated: true,
      noHiddenActions: true,
      noAutonomousSpending: true,
      noFakeIncomeClaims: true,
      noMedicalOrPsychologicalDiagnosis: true,
      burnoutIsOperationalLoadOnly: true,
      noExternalExecution: true,
    },
  }
}

async function persistDerivedSnapshot(client: WarRoomSupabase, snapshot: CommanderSnapshot) {
  await Promise.all([
    client.from('war_room_commander_metrics').upsert(metricsRow(snapshot.metrics), { onConflict: 'id' }),
    ...snapshot.patterns.map(pattern => client.from('war_room_commander_patterns').upsert(patternRow(pattern), { onConflict: 'id' })),
    ...snapshot.trajectory.slice(0, 1).map(point => client.from('war_room_commander_trajectory').upsert(trajectoryRow(point), { onConflict: 'id' })),
  ])
}

async function listStoredReviews(client: WarRoomSupabase, limit: number): Promise<CommanderReview[]> {
  const { data, error } = await client
    .from('war_room_commander_reviews')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return ((data ?? []) as Row[]).map(mapReview)
}

async function listStoredTrajectory(client: WarRoomSupabase, limit: number): Promise<CommanderTrajectoryPoint[]> {
  const { data, error } = await client
    .from('war_room_commander_trajectory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return ((data ?? []) as Row[]).map(mapTrajectory)
}

export async function listCommanderSnapshot(limit = 40): Promise<CommanderSnapshot> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  const client = supabase.ok ? supabase.client : null
  const sources = await buildSources(client, generatedAt)

  if (!supabase.ok) {
    return buildSnapshot({
      sources,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}. Commander OS is derived in-memory only; no fake outcomes are fabricated.`,
    })
  }

  const [storedReviews, storedTrajectory] = await Promise.all([
    listStoredReviews(supabase.client, limit),
    listStoredTrajectory(supabase.client, limit),
  ])
  const snapshot = buildSnapshot({
    sources,
    persistenceAvailable: true,
    persistenceNote: 'Commander OS persistence is available; recommendations remain approval-gated and cannot execute external actions.',
    storedReviews,
    storedTrajectory,
  })
  await persistDerivedSnapshot(supabase.client, snapshot)
  return snapshot
}

export async function upsertCommanderProfile(input: CommanderProfileInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  profile: CommanderProfile
}> {
  const now = new Date().toISOString()
  const fallback: CommanderProfile = {
    id: 'commander',
    activeGoals: stringArray(input.activeGoals),
    unfinishedInitiatives: stringArray(input.unfinishedInitiatives),
    recurringBottlenecks: stringArray(input.recurringBottlenecks),
    strongestLeverageZones: stringArray(input.strongestLeverageZones),
    distractionPatterns: stringArray(input.distractionPatterns),
    bestExecutionWindows: stringArray(input.bestExecutionWindows),
    bestWorkflows: stringArray(input.bestWorkflows),
    stressLoadScore: boundedScore(input.stressLoadScore, 50),
    familyImpactScore: boundedScore(input.familyImpactScore, 70),
    notes: input.notes ?? '',
    approvalRequired: true,
    canExecute: false,
    evidence: input.evidence ?? { explicitCommanderProfile: true },
    createdAt: now,
    updatedAt: null,
  }
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; Commander profile was validated but not persisted: ${supabase.configError}`,
      profile: fallback,
    }
  }

  const { data, error } = await supabase.client
    .from('war_room_commander_profile')
    .upsert(profileRow(input), { onConflict: 'id' })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Commander profile upsert failed.')
  return {
    persistenceAvailable: true,
    persistenceNote: 'Commander profile persisted as explicit self-logged context. It cannot execute actions.',
    profile: mapProfile(data as Row),
  }
}

export async function createCommanderReview(periodInput: CommanderReviewPeriod): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  review: CommanderReview
  trajectory: CommanderTrajectoryPoint
}> {
  const selectedPeriod = period(periodInput)
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  const client = supabase.ok ? supabase.client : null
  const sources = await buildSources(client, generatedAt)
  const metrics = buildCommanderMetrics(sources)
  const highestLeverageMove = buildHighestLeverageMove(sources, metrics)
  const review = buildCommanderReview(sources, metrics, highestLeverageMove, selectedPeriod)
  const trajectory = buildTrajectoryPoint(sources, metrics, selectedPeriod)

  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; Commander review was generated but not persisted: ${supabase.configError}`,
      review,
      trajectory,
    }
  }

  const [reviewResult, trajectoryResult] = await Promise.all([
    supabase.client.from('war_room_commander_reviews').upsert(reviewRow(review), { onConflict: 'id' }).select('*').single(),
    supabase.client.from('war_room_commander_trajectory').upsert(trajectoryRow(trajectory), { onConflict: 'id' }).select('*').single(),
  ])

  if (reviewResult.error || !reviewResult.data) throw new Error(reviewResult.error?.message || 'Commander review insert failed.')
  if (trajectoryResult.error || !trajectoryResult.data) throw new Error(trajectoryResult.error?.message || 'Commander trajectory insert failed.')

  return {
    persistenceAvailable: true,
    persistenceNote: 'Commander review and trajectory point persisted. They are advisory and approval-gated only.',
    review: mapReview(reviewResult.data as Row),
    trajectory: mapTrajectory(trajectoryResult.data as Row),
  }
}
