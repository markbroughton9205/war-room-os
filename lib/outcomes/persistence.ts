import 'server-only'

import { BABY_AI_AGENTS, type BabyAgentKey } from '@/lib/baby-ai/model'
import { buildBabyDailyBriefing } from '@/lib/baby-ai/operationalIntelligence'
import { listFeatureBuilderSnapshot } from '@/lib/feature-builder/persistence'
import { listGrowthCalendarSnapshot } from '@/lib/growth-calendar'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  buildExecutionResult,
  buildRealityCorrectionAlerts,
  buildRoiReview,
  buildRoiTrends,
  detectCompoundingPatterns,
  detectFailurePatterns,
  detectTimeWastePatterns,
  highestLeverageCategories,
} from './learning'
import {
  OUTCOME_APPROVAL_STATUSES,
  OUTCOME_CATEGORIES,
  OUTCOME_RECOMMENDATIONS,
  OUTCOME_RESULT_STATUSES,
  type CompoundingPattern,
  type ExecutionResult,
  type FailurePattern,
  type OutcomeApprovalStatus,
  type OutcomeCategory,
  type OutcomeEntry,
  type OutcomeEntryInput,
  type OutcomeRecommendation,
  type OutcomeResultStatus,
  type OutcomeSnapshot,
  type RealityCorrectionAlert,
  type RoiReview,
  type RoiReviewInput,
  type TimeWastePattern,
} from './model'

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function bool(value: unknown): boolean {
  return value === true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function boundedScore(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function category(value: unknown): OutcomeCategory {
  const raw = text(value)
  return (OUTCOME_CATEGORIES as readonly string[]).includes(raw) ? raw as OutcomeCategory : 'learning'
}

function resultStatus(value: unknown): OutcomeResultStatus {
  const raw = text(value)
  return (OUTCOME_RESULT_STATUSES as readonly string[]).includes(raw) ? raw as OutcomeResultStatus : 'needs_review'
}

function recommendation(value: unknown): OutcomeRecommendation {
  const raw = text(value)
  return (OUTCOME_RECOMMENDATIONS as readonly string[]).includes(raw) ? raw as OutcomeRecommendation : 'monitor'
}

function approvalStatus(value: unknown): OutcomeApprovalStatus {
  const raw = text(value)
  return (OUTCOME_APPROVAL_STATUSES as readonly string[]).includes(raw) ? raw as OutcomeApprovalStatus : 'not_required'
}

function family(value: unknown): BabyAgentKey | null {
  const raw = text(value)
  return BABY_AI_AGENTS.some(agent => agent.key === raw) ? raw as BabyAgentKey : null
}

function reviewer(value: unknown): RoiReview['reviewer'] {
  const raw = text(value)
  if (raw === 'commander' || raw === 'system') return raw
  return family(raw) ?? 'system'
}

function priorityChange(value: unknown): RoiReview['recommendedPriorityChange'] {
  const raw = text(value)
  return ['increase', 'hold', 'decrease', 'deprioritize'].includes(raw)
    ? raw as RoiReview['recommendedPriorityChange']
    : 'hold'
}

function mapOutcome(row: Row): OutcomeEntry {
  return {
    id: text(row.id),
    title: text(row.title, 'Untitled outcome'),
    category: category(row.category),
    relatedOpportunity: nullableText(row.related_opportunity),
    estimatedRevenue: num(row.estimated_revenue),
    actualRevenue: num(row.actual_revenue),
    timeInvestedHours: num(row.time_invested_hours),
    stressLoad: boundedScore(num(row.stress_load)),
    leverageScore: boundedScore(num(row.leverage_score)),
    repeatabilityScore: boundedScore(num(row.repeatability_score)),
    scalabilityScore: boundedScore(num(row.scalability_score)),
    familyImpact: boundedScore(num(row.family_impact_score)),
    executionDifficulty: boundedScore(num(row.execution_difficulty_score)),
    resultStatus: resultStatus(row.result_status),
    whatWorked: text(row.what_worked),
    whatFailed: text(row.what_failed),
    lessonsLearned: text(row.lessons_learned),
    recommendedRepeatAvoid: recommendation(row.recommended_repeat_avoid),
    linkedFeatureProject: nullableText(row.linked_feature_project),
    linkedBabyAiFamily: family(row.linked_baby_ai_family),
    approvalStatus: approvalStatus(row.approval_status),
    sourceUri: nullableText(row.source_uri),
    explicitCommanderLog: true,
    sourceBacked: bool(row.source_backed),
    externalActionPerformedByWarRoom: false,
    autonomousSpendPerformed: false,
    hiddenActionPerformed: false,
    fakeRevenueClaimed: false,
    evidence: objectValue(row.evidence),
    metadata: objectValue(row.metadata),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
  }
}

function mapReview(row: Row): RoiReview {
  return {
    id: text(row.id),
    outcomeId: text(row.outcome_id),
    reviewer: reviewer(row.reviewer),
    reviewSummary: text(row.review_summary),
    confidenceBefore: num(row.confidence_before),
    actualResultScore: num(row.actual_result_score),
    estimateAccuracy: num(row.estimate_accuracy),
    timeValueScore: num(row.time_value_score),
    distractionScore: num(row.distraction_score),
    leverageAdjustment: Math.round(num(row.leverage_adjustment) ?? 0),
    recommendedPriorityChange: priorityChange(row.recommended_priority_change),
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapExecutionResult(row: Row): ExecutionResult {
  return {
    id: text(row.id),
    outcomeId: text(row.outcome_id),
    category: category(row.category),
    shipped: bool(row.shipped),
    madeMoney: bool(row.made_money),
    wastedTime: bool(row.wasted_time),
    createdLeverage: bool(row.created_leverage),
    compounded: bool(row.compounded),
    shouldRepeat: bool(row.should_repeat),
    shouldAvoid: bool(row.should_avoid),
    timeToMoneyHours: num(row.time_to_money_hours),
    valuePerHour: num(row.value_per_hour),
    stressAdjustedRoi: num(row.stress_adjusted_roi),
    sourceBacked: bool(row.source_backed),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapCompounding(row: Row): CompoundingPattern {
  return {
    id: text(row.id),
    category: category(row.category),
    title: text(row.title),
    summary: text(row.summary),
    recurrenceCount: Math.round(num(row.recurrence_count) ?? 0),
    averageActualRevenue: num(row.average_actual_revenue) ?? 0,
    averageValuePerHour: num(row.average_value_per_hour),
    averageStressLoad: num(row.average_stress_load) ?? 0,
    confidence: num(row.confidence) ?? 0,
    recommendation: text(row.recommendation, 'study_more') as CompoundingPattern['recommendation'],
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
  }
}

function mapFailure(row: Row): FailurePattern {
  return {
    id: text(row.id),
    category: category(row.category),
    title: text(row.title),
    summary: text(row.summary),
    recurrenceCount: Math.round(num(row.recurrence_count) ?? 0),
    estimatedRevenueMiss: num(row.estimated_revenue_miss) ?? 0,
    timeLostHours: num(row.time_lost_hours) ?? 0,
    confidence: num(row.confidence) ?? 0,
    recommendedAvoidance: text(row.recommended_avoidance),
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
  }
}

function mapTimeWaste(row: Row): TimeWastePattern {
  return {
    id: text(row.id),
    category: category(row.category),
    title: text(row.title),
    summary: text(row.summary),
    recurrenceCount: Math.round(num(row.recurrence_count) ?? 0),
    timeLostHours: num(row.time_lost_hours) ?? 0,
    distractionScore: num(row.distraction_score) ?? 0,
    priorityDecay: num(row.priority_decay) ?? 0,
    approvalRequired: true,
    canExecute: false,
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
  }
}

function rowForExecution(result: ExecutionResult) {
  return {
    id: result.id,
    outcome_id: result.outcomeId,
    category: result.category,
    shipped: result.shipped,
    made_money: result.madeMoney,
    wasted_time: result.wastedTime,
    created_leverage: result.createdLeverage,
    compounded: result.compounded,
    should_repeat: result.shouldRepeat,
    should_avoid: result.shouldAvoid,
    time_to_money_hours: result.timeToMoneyHours,
    value_per_hour: result.valuePerHour,
    stress_adjusted_roi: result.stressAdjustedRoi,
    source_backed: result.sourceBacked,
  }
}

function rowForReview(review: RoiReview) {
  return {
    id: review.id,
    outcome_id: review.outcomeId,
    reviewer: review.reviewer,
    review_summary: review.reviewSummary,
    confidence_before: review.confidenceBefore,
    actual_result_score: review.actualResultScore,
    estimate_accuracy: review.estimateAccuracy,
    time_value_score: review.timeValueScore,
    distraction_score: review.distractionScore,
    leverage_adjustment: review.leverageAdjustment,
    recommended_priority_change: review.recommendedPriorityChange,
    approval_required: true,
    can_execute: false,
    evidence: review.evidence,
  }
}

function buildSnapshot(input: {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  outcomes: OutcomeEntry[]
  reviews?: RoiReview[]
  executionResults?: ExecutionResult[]
  compoundingPatterns?: CompoundingPattern[]
  failurePatterns?: FailurePattern[]
  timeWastePatterns?: TimeWastePattern[]
  integrations: OutcomeSnapshot['integrations']
}): OutcomeSnapshot {
  const executionResults = input.executionResults?.length
    ? input.executionResults
    : input.outcomes.map(buildExecutionResult)
  const compoundingPatterns = input.compoundingPatterns?.length
    ? input.compoundingPatterns
    : detectCompoundingPatterns(input.outcomes)
  const failurePatterns = input.failurePatterns?.length
    ? input.failurePatterns
    : detectFailurePatterns(input.outcomes)
  const timeWastePatterns = input.timeWastePatterns?.length
    ? input.timeWastePatterns
    : detectTimeWastePatterns(input.outcomes)
  const realityCorrectionAlerts = buildRealityCorrectionAlerts({
    outcomes: input.outcomes,
    compoundingPatterns,
    failurePatterns,
    timeWastePatterns,
  })

  return {
    generatedAt: input.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    categories: OUTCOME_CATEGORIES,
    outcomes: input.outcomes,
    reviews: input.reviews ?? [],
    executionResults,
    compoundingPatterns,
    failurePatterns,
    timeWastePatterns,
    realityCorrectionAlerts,
    roiTrends: buildRoiTrends(input.outcomes),
    highestLeverageCategories: highestLeverageCategories(input.outcomes),
    integrations: input.integrations,
    guardrails: {
      explicitLoggingOnly: true,
      noFakeRevenueClaims: true,
      noFabricatedOutcomes: true,
      noAutonomousSpending: true,
      noHiddenActions: true,
      noFakeAiSuccess: true,
      sourceBackedOrCommanderLogged: true,
      approvalRequiredForExternalAction: true,
    },
  }
}

async function buildIntegrations(): Promise<OutcomeSnapshot['integrations']> {
  const [revenue, signals, featureBuilder, growthCalendar, briefing] = await Promise.all([
    listRevenueEngineSnapshot(12),
    listPersistedSignalSnapshot(12),
    listFeatureBuilderSnapshot(8),
    listGrowthCalendarSnapshot(12),
    buildBabyDailyBriefing(),
  ])

  return {
    revenueEngine: revenue.outcomes.length
      ? revenue.outcomes.slice(0, 3).map(item => `${item.outcomeType}: ${item.summary}`)
      : ['Revenue Engine estimates are available; no real revenue is claimed without Outcome Ledger entries.'],
    signalRadar: signals.results.slice(0, 3).map(item => `${item.title} (${item.approvalStatus})`),
    featureBuilder: featureBuilder.packets.slice(0, 3).map(item => `${item.title} (${item.approvalStatus})`),
    babyAiLearning: briefing.learning.slice(0, 3).map(item => `${item.agentName}: ${item.growthExplanation}`),
    growthCalendar: growthCalendar.recommendations.slice(0, 3).map(item => `${item.title} -> ${item.reason}`),
    dailyBriefing: briefing.strategicAlerts.slice(0, 3).map(item => `${item.severity}: ${item.title}`),
    priorityEngine: ['Reality corrections are exposed for downstream priority decay; no automatic reprioritization is executed here.'],
  }
}

async function insertOutcome(client: WarRoomSupabase, input: OutcomeEntryInput): Promise<OutcomeEntry> {
  const sourceBacked = Boolean(input.sourceUri || Object.keys(input.evidence ?? {}).length > 0)
  const { data, error } = await client
    .from('war_room_outcomes')
    .insert({
      title: input.title,
      category: input.category,
      related_opportunity: input.relatedOpportunity ?? null,
      estimated_revenue: input.estimatedRevenue ?? null,
      actual_revenue: input.actualRevenue ?? null,
      time_invested_hours: input.timeInvestedHours ?? null,
      stress_load: boundedScore(input.stressLoad, 50),
      leverage_score: boundedScore(input.leverageScore, 50),
      repeatability_score: boundedScore(input.repeatabilityScore, 50),
      scalability_score: boundedScore(input.scalabilityScore, 50),
      family_impact_score: boundedScore(input.familyImpact, 50),
      execution_difficulty_score: boundedScore(input.executionDifficulty, 50),
      result_status: input.resultStatus,
      what_worked: input.whatWorked ?? '',
      what_failed: input.whatFailed ?? '',
      lessons_learned: input.lessonsLearned ?? '',
      recommended_repeat_avoid: input.recommendedRepeatAvoid,
      linked_feature_project: input.linkedFeatureProject ?? null,
      linked_baby_ai_family: input.linkedBabyAiFamily ?? null,
      approval_status: input.approvalStatus ?? 'not_required',
      source_uri: input.sourceUri ?? null,
      explicit_commander_log: true,
      source_backed: sourceBacked,
      external_action_performed_by_war_room: false,
      autonomous_spend_performed: false,
      hidden_action_performed: false,
      fake_revenue_claimed: false,
      evidence: input.evidence ?? {},
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Outcome insert failed.')
  return mapOutcome(data as Row)
}

async function upsertReview(client: WarRoomSupabase, review: RoiReview): Promise<RoiReview> {
  const { data, error } = await client
    .from('war_room_roi_reviews')
    .upsert(rowForReview(review), { onConflict: 'id' })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'ROI review insert failed.')
  return mapReview(data as Row)
}

async function upsertExecutionResult(client: WarRoomSupabase, result: ExecutionResult): Promise<ExecutionResult> {
  const { data, error } = await client
    .from('war_room_execution_results')
    .upsert(rowForExecution(result), { onConflict: 'id' })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Execution result insert failed.')
  return mapExecutionResult(data as Row)
}

async function syncPatterns(client: WarRoomSupabase, outcomes: OutcomeEntry[]) {
  const compounding = detectCompoundingPatterns(outcomes)
  const failures = detectFailurePatterns(outcomes)
  const waste = detectTimeWastePatterns(outcomes)

  await Promise.all([
    ...compounding.map(pattern => client.from('war_room_compounding_patterns').upsert({
      id: pattern.id,
      category: pattern.category,
      title: pattern.title,
      summary: pattern.summary,
      recurrence_count: pattern.recurrenceCount,
      average_actual_revenue: pattern.averageActualRevenue,
      average_value_per_hour: pattern.averageValuePerHour,
      average_stress_load: pattern.averageStressLoad,
      confidence: pattern.confidence,
      recommendation: pattern.recommendation,
      approval_required: true,
      can_execute: false,
      evidence: pattern.evidence,
    }, { onConflict: 'id' })),
    ...failures.map(pattern => client.from('war_room_failure_patterns').upsert({
      id: pattern.id,
      category: pattern.category,
      title: pattern.title,
      summary: pattern.summary,
      recurrence_count: pattern.recurrenceCount,
      estimated_revenue_miss: pattern.estimatedRevenueMiss,
      time_lost_hours: pattern.timeLostHours,
      confidence: pattern.confidence,
      recommended_avoidance: pattern.recommendedAvoidance,
      approval_required: true,
      can_execute: false,
      evidence: pattern.evidence,
    }, { onConflict: 'id' })),
    ...waste.map(pattern => client.from('war_room_time_waste_patterns').upsert({
      id: pattern.id,
      category: pattern.category,
      title: pattern.title,
      summary: pattern.summary,
      recurrence_count: pattern.recurrenceCount,
      time_lost_hours: pattern.timeLostHours,
      distraction_score: pattern.distractionScore,
      priority_decay: pattern.priorityDecay,
      approval_required: true,
      can_execute: false,
      evidence: pattern.evidence,
    }, { onConflict: 'id' })),
  ])
}

export async function createOutcomeEntry(input: OutcomeEntryInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  outcome: OutcomeEntry
  review: RoiReview | null
  executionResult: ExecutionResult | null
}> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    const now = new Date().toISOString()
    const outcome: OutcomeEntry = {
      id: `outcome-${Date.now()}`,
      title: input.title,
      category: input.category,
      relatedOpportunity: input.relatedOpportunity ?? null,
      estimatedRevenue: input.estimatedRevenue ?? null,
      actualRevenue: input.actualRevenue ?? null,
      timeInvestedHours: input.timeInvestedHours ?? null,
      stressLoad: boundedScore(input.stressLoad, 50),
      leverageScore: boundedScore(input.leverageScore, 50),
      repeatabilityScore: boundedScore(input.repeatabilityScore, 50),
      scalabilityScore: boundedScore(input.scalabilityScore, 50),
      familyImpact: boundedScore(input.familyImpact, 50),
      executionDifficulty: boundedScore(input.executionDifficulty, 50),
      resultStatus: input.resultStatus,
      whatWorked: input.whatWorked ?? '',
      whatFailed: input.whatFailed ?? '',
      lessonsLearned: input.lessonsLearned ?? '',
      recommendedRepeatAvoid: input.recommendedRepeatAvoid,
      linkedFeatureProject: input.linkedFeatureProject ?? null,
      linkedBabyAiFamily: input.linkedBabyAiFamily ?? null,
      approvalStatus: input.approvalStatus ?? 'not_required',
      sourceUri: input.sourceUri ?? null,
      explicitCommanderLog: true,
      sourceBacked: Boolean(input.sourceUri || Object.keys(input.evidence ?? {}).length > 0),
      externalActionPerformedByWarRoom: false,
      autonomousSpendPerformed: false,
      hiddenActionPerformed: false,
      fakeRevenueClaimed: false,
      evidence: input.evidence ?? {},
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: null,
    }
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; explicit outcome was validated but not persisted: ${supabase.configError}`,
      outcome,
      review: buildRoiReview(outcome),
      executionResult: buildExecutionResult(outcome),
    }
  }

  const outcome = await insertOutcome(supabase.client, input)
  const review = await upsertReview(supabase.client, buildRoiReview(outcome))
  const executionResult = await upsertExecutionResult(supabase.client, buildExecutionResult(outcome))
  const { data } = await supabase.client.from('war_room_outcomes').select('*').order('created_at', { ascending: false }).limit(200)
  await syncPatterns(supabase.client, ((data ?? []) as Row[]).map(mapOutcome))

  return {
    persistenceAvailable: true,
    persistenceNote: 'Explicit outcome, ROI review, and execution result persisted with service-role access.',
    outcome,
    review,
    executionResult,
  }
}

export async function createRoiReview(input: RoiReviewInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  review: RoiReview
}> {
  const review: RoiReview = {
    id: `roi-manual-${Date.now()}-${input.outcomeId}`,
    outcomeId: input.outcomeId,
    reviewer: input.reviewer === 'commander' || input.reviewer === 'system' ? input.reviewer : input.reviewer ?? 'commander',
    reviewSummary: input.reviewSummary,
    confidenceBefore: input.confidenceBefore ?? null,
    actualResultScore: input.actualResultScore ?? null,
    estimateAccuracy: input.estimateAccuracy ?? null,
    timeValueScore: input.timeValueScore ?? null,
    distractionScore: input.distractionScore ?? null,
    leverageAdjustment: Math.round(input.leverageAdjustment ?? 0),
    recommendedPriorityChange: input.recommendedPriorityChange ?? 'hold',
    approvalRequired: true,
    canExecute: false,
    evidence: input.evidence ?? { explicitReview: true },
    createdAt: new Date().toISOString(),
  }

  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; ROI review was validated but not persisted: ${supabase.configError}`,
      review,
    }
  }

  return {
    persistenceAvailable: true,
    persistenceNote: 'Explicit ROI review persisted. It can recommend priority changes but cannot execute them.',
    review: await upsertReview(supabase.client, review),
  }
}

export async function listOutcomeSnapshot(limit = 80): Promise<OutcomeSnapshot> {
  const generatedAt = new Date().toISOString()
  const integrations = await buildIntegrations()
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return buildSnapshot({
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}. No fallback outcomes are fabricated.`,
      outcomes: [],
      integrations,
    })
  }

  const [outcomes, reviews, executionResults, compounding, failures, waste] = await Promise.all([
    supabase.client.from('war_room_outcomes').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_roi_reviews').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_execution_results').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_compounding_patterns').select('*').order('updated_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_failure_patterns').select('*').order('updated_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_time_waste_patterns').select('*').order('updated_at', { ascending: false }).limit(limit),
  ])

  const firstError = [outcomes.error, reviews.error, executionResults.error, compounding.error, failures.error, waste.error].find(Boolean)
  if (firstError) {
    return buildSnapshot({
      generatedAt,
      persistenceAvailable: true,
      persistenceNote: `Outcome Ledger tables unavailable or not migrated: ${firstError.message}. No fallback outcomes are fabricated.`,
      outcomes: [],
      integrations,
    })
  }

  return buildSnapshot({
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: 'Outcome Ledger persistence is available; learning is based only on explicit or source-backed outcomes.',
    outcomes: ((outcomes.data ?? []) as Row[]).map(mapOutcome),
    reviews: ((reviews.data ?? []) as Row[]).map(mapReview),
    executionResults: ((executionResults.data ?? []) as Row[]).map(mapExecutionResult),
    compoundingPatterns: ((compounding.data ?? []) as Row[]).map(mapCompounding),
    failurePatterns: ((failures.data ?? []) as Row[]).map(mapFailure),
    timeWastePatterns: ((waste.data ?? []) as Row[]).map(mapTimeWaste),
    integrations,
  })
}

export type { RealityCorrectionAlert }
