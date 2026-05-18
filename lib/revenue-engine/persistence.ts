import 'server-only'

import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  REVENUE_ENGINE_CATEGORIES,
  REVENUE_ENGINE_STATUSES,
  REVENUE_OUTCOME_TYPES,
  type RevenueEngineCategory,
  type RevenueEngineSnapshot,
  type RevenueEngineStatus,
  type RevenueExecutionPattern,
  type RevenueLeverageScore,
  type RevenueOpportunity,
  type RevenueOpportunityInput,
  type RevenueOutcome,
  type RevenueOutcomeType,
} from './model'
import {
  buildExecutionPatterns,
  buildRevenueOpportunity,
  buildStrategicAlerts,
  highestLeverageMove,
  rankRevenueOpportunities,
  seedRevenueOpportunities,
} from './pipeline'
import { listPersistedSignalSnapshot, type SignalResult } from '@/lib/signals'

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
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

function category(value: unknown): RevenueEngineCategory {
  const raw = text(value)
  return (REVENUE_ENGINE_CATEGORIES as readonly string[]).includes(raw) ? raw as RevenueEngineCategory : 'smb_automation'
}

function status(value: unknown): RevenueEngineStatus {
  const raw = text(value)
  return (REVENUE_ENGINE_STATUSES as readonly string[]).includes(raw) ? raw as RevenueEngineStatus : 'watching'
}

function outcomeType(value: unknown): RevenueOutcomeType {
  const raw = text(value)
  return (REVENUE_OUTCOME_TYPES as readonly string[]).includes(raw) ? raw as RevenueOutcomeType : 'blocked'
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function scoreFromRow(row: Row): RevenueOpportunity['score'] {
  const score = objectValue(row.score_json)
  return {
    leverageScore: Math.round(num(row.leverage_score) ?? num(score.leverageScore) ?? 0),
    confidence: Math.round(num(row.confidence_score) ?? num(score.confidence) ?? 0),
    urgency: Math.round(num(row.urgency_score) ?? num(score.urgency) ?? 0),
    startupCost: Math.round(num(row.startup_cost_score) ?? num(score.startupCost) ?? 0),
    scalability: Math.round(num(row.scalability_score) ?? num(score.scalability) ?? 0),
    automationPotential: Math.round(num(row.automation_potential_score) ?? num(score.automationPotential) ?? 0),
    repeatability: Math.round(num(row.repeatability_score) ?? num(score.repeatability) ?? 0),
    timeToProfit: Math.round(num(row.time_to_profit_score) ?? num(score.timeToProfit) ?? 0),
    strategicAlignment: Math.round(num(row.strategic_alignment_score) ?? num(score.strategicAlignment) ?? 0),
    stressLoad: Math.round(num(row.stress_load_score) ?? num(score.stressLoad) ?? 0),
    familyImpact: Math.round(num(row.family_impact_score) ?? num(score.familyImpact) ?? 0),
    longTermCompoundingValue: Math.round(num(row.long_term_compounding_score) ?? num(score.longTermCompoundingValue) ?? 0),
  }
}

function mapOpportunity(row: Row): RevenueOpportunity {
  return {
    id: text(row.id),
    title: text(row.title, 'Untitled revenue opportunity'),
    category: category(row.category),
    status: status(row.status),
    source: text(row.source, 'unknown'),
    notes: text(row.notes),
    estimatedRevenue: num(row.estimated_revenue),
    estimatedTimeHours: num(row.estimated_time_hours),
    startupCostUsd: num(row.startup_cost_usd),
    regionalSignal: nullableText(row.regional_signal),
    shipperPainPoint: nullableText(row.shipper_pain_point),
    smbPainPoint: nullableText(row.smb_pain_point),
    nextReviewAction: text(row.next_review_action, 'Review evidence before any external action.'),
    score: scoreFromRow(row),
    priorityRank: Math.round(num(row.priority_rank) ?? 0),
    familyImpactEstimate: text(row.family_impact_estimate, 'neutral') as RevenueOpportunity['familyImpactEstimate'],
    guardrails: {
      recommendationOnly: true,
      approvalRequired: true,
      externalExecutionAllowed: false,
      hiddenExecutionAllowed: false,
      incomeClaimed: false,
    },
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
    metadata: objectValue(row.metadata),
  }
}

function mapOutcome(row: Row): RevenueOutcome {
  return {
    id: text(row.id),
    opportunityId: nullableText(row.opportunity_id),
    outcomeType: outcomeType(row.outcome_type),
    summary: text(row.summary),
    estimatedRoi: num(row.estimated_roi),
    actualRevenueAmount: num(row.actual_revenue_amount),
    timeSpentHours: num(row.time_spent_hours),
    validated: bool(row.validated),
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapLeverageScore(row: Row): RevenueLeverageScore {
  return {
    id: text(row.id),
    opportunityId: nullableText(row.opportunity_id),
    category: category(row.category),
    score: scoreFromRow(row),
    rationale: text(row.rationale),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapPattern(row: Row): RevenueExecutionPattern {
  return {
    id: text(row.id),
    category: category(row.category),
    patternType: text(row.pattern_type, 'bottleneck') as RevenueExecutionPattern['patternType'],
    title: text(row.title),
    summary: text(row.summary),
    confidence: num(row.confidence) ?? 0,
    approvalRequired: true,
    canExecute: false,
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function leverageScoreFromOpportunity(opportunity: RevenueOpportunity): RevenueLeverageScore {
  return {
    id: `score-${opportunity.id}`,
    opportunityId: opportunity.id,
    category: opportunity.category,
    score: opportunity.score,
    rationale: `Estimated from confidence, urgency, startup cost, scalability, automation potential, repeatability, time-to-profit, strategic alignment, stress, family impact, and compounding value.`,
    createdAt: opportunity.createdAt,
  }
}

function revenueCategoryFromSignal(signal: SignalResult): RevenueEngineCategory {
  switch (signal.category) {
    case 'freight':
    case 'load_board':
      return 'freight'
    case 'sprinter_van':
      return 'sprinter_van_routes'
    case 'local_delivery':
      return 'local_delivery'
    case 'job':
    case 'gig':
    case 'data_annotation':
    case 'AI_evaluation':
      return 'data_annotation_evaluation'
    case 'SMB_automation':
      return 'smb_automation'
    case 'customer_operations':
      return 'scheduling_intake_systems'
    case 'call_center':
      return 'call_center_customer_operations'
    case 'AI_trends':
      return 'ai_operations'
    case 'app_factory_opportunity':
      return 'app_factory_ideas'
    case 'local_Akron':
    case 'Ohio_business':
      return 'agency_services'
    case 'economic_warning':
      return 'consulting'
  }
}

function opportunityFromSignal(signal: SignalResult): RevenueOpportunity {
  const opportunity = buildRevenueOpportunity({
    title: signal.title,
    category: revenueCategoryFromSignal(signal),
    notes: `${signal.summary} Source-backed Phase 14 signal. No outreach, spend, application, dispatch, or income claim has been performed.`,
    source: `${signal.source} (${signal.url})`,
    estimatedRevenue: null,
    estimatedTimeHours: null,
    startupCostUsd: null,
    regionalSignal: ['freight', 'sprinter_van', 'local_delivery', 'load_board', 'local_Akron', 'Ohio_business', 'economic_warning'].includes(signal.category) ? signal.summary : null,
    shipperPainPoint: ['freight', 'sprinter_van', 'local_delivery', 'load_board'].includes(signal.category) ? signal.summary : null,
    smbPainPoint: ['SMB_automation', 'customer_operations', 'call_center', 'app_factory_opportunity'].includes(signal.category) ? signal.summary : null,
    nextReviewAction: signal.recommendedNextAction,
    scores: {
      confidence: signal.scores.confidence,
      urgency: signal.scores.urgency,
      startupCost: signal.scores.startupCost,
      repeatability: signal.scores.repeatability,
      timeToProfit: signal.scores.timeToProfit,
      strategicAlignment: signal.scores.strategicAlignment,
      familyImpact: signal.scores.familyImpact,
      automationPotential: ['SMB_automation', 'customer_operations', 'call_center', 'AI_trends', 'app_factory_opportunity'].includes(signal.category) ? Math.max(signal.scores.strategicAlignment, 72) : 58,
      scalability: ['SMB_automation', 'AI_trends', 'app_factory_opportunity'].includes(signal.category) ? 76 : 58,
      longTermCompoundingValue: ['AI_trends', 'app_factory_opportunity', 'SMB_automation'].includes(signal.category) ? 80 : 62,
    },
  }, new Date(signal.capturedAt))
  return {
    ...opportunity,
    id: `signal-${signal.id}`,
    metadata: {
      ...(opportunity.metadata ?? {}),
      phase14SignalId: signal.id,
      signalUrl: signal.url,
      assignedBabyFamily: signal.assignedBabyFamily,
      sourceBacked: true,
    },
  }
}

function snapshot(input: {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  opportunities: RevenueOpportunity[]
  outcomes?: RevenueOutcome[]
  leverageScores?: RevenueLeverageScore[]
  executionPatterns?: RevenueExecutionPattern[]
}): RevenueEngineSnapshot {
  const opportunities = rankRevenueOpportunities(input.opportunities)
  const outcomes = input.outcomes ?? []
  const leverageScores = input.leverageScores?.length ? input.leverageScores : opportunities.map(leverageScoreFromOpportunity)
  const executionPatterns = input.executionPatterns?.length ? input.executionPatterns : buildExecutionPatterns(opportunities)
  const strategicAlerts = buildStrategicAlerts(opportunities, executionPatterns)
  const active = opportunities.filter(item => !['won', 'lost', 'archived'].includes(item.status))
  const estimatedPipelineRevenue = active.reduce((sum, item) => sum + (item.estimatedRevenue ?? 0), 0)

  return {
    generatedAt: input.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    categories: REVENUE_ENGINE_CATEGORIES,
    opportunities,
    outcomes,
    leverageScores,
    executionPatterns,
    highestLeverageMove: highestLeverageMove(opportunities),
    strategicAlerts,
    stats: {
      activeOpportunities: active.length,
      averageLeverageScore: active.length ? Math.round(active.reduce((sum, item) => sum + item.score.leverageScore, 0) / active.length) : 0,
      estimatedPipelineRevenue,
      repeatablePatterns: executionPatterns.filter(pattern => pattern.patternType === 'profitable_repeat').length,
      lowRoiWarnings: strategicAlerts.filter(alert => alert.kind === 'low_roi_warning' || alert.kind === 'distraction_warning').length,
      compoundingOpportunities: strategicAlerts.filter(alert => alert.kind === 'compounding_opportunity').length,
    },
    guardrails: {
      recommendationOnly: true,
      approvalRequired: true,
      hiddenExecution: false,
      autonomousDeployment: false,
      filesystemMutation: false,
      shellExecution: false,
      fakeIncomeClaims: false,
    },
  }
}

async function insertOpportunity(client: WarRoomSupabase, opportunity: RevenueOpportunity): Promise<RevenueOpportunity> {
  const { data, error } = await client
    .from('war_room_revenue_opportunities')
    .insert({
      id: opportunity.id,
      title: opportunity.title,
      category: opportunity.category,
      status: opportunity.status,
      source: opportunity.source,
      notes: opportunity.notes,
      estimated_revenue: opportunity.estimatedRevenue,
      estimated_time_hours: opportunity.estimatedTimeHours,
      startup_cost_usd: opportunity.startupCostUsd,
      regional_signal: opportunity.regionalSignal,
      shipper_pain_point: opportunity.shipperPainPoint,
      smb_pain_point: opportunity.smbPainPoint,
      next_review_action: opportunity.nextReviewAction,
      leverage_score: opportunity.score.leverageScore,
      confidence_score: opportunity.score.confidence,
      urgency_score: opportunity.score.urgency,
      startup_cost_score: opportunity.score.startupCost,
      scalability_score: opportunity.score.scalability,
      automation_potential_score: opportunity.score.automationPotential,
      repeatability_score: opportunity.score.repeatability,
      time_to_profit_score: opportunity.score.timeToProfit,
      strategic_alignment_score: opportunity.score.strategicAlignment,
      stress_load_score: opportunity.score.stressLoad,
      family_impact_score: opportunity.score.familyImpact,
      long_term_compounding_score: opportunity.score.longTermCompoundingValue,
      priority_rank: opportunity.priorityRank,
      family_impact_estimate: opportunity.familyImpactEstimate,
      score_json: opportunity.score,
      required_review_actions: [opportunity.nextReviewAction],
      recommendation_only: true,
      approval_required: true,
      external_execution_performed: false,
      hidden_execution_performed: false,
      income_claimed: false,
      metadata: opportunity.metadata ?? {},
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Revenue opportunity insert failed.')
  return mapOpportunity(data as Row)
}

async function insertLeverageScore(client: WarRoomSupabase, opportunity: RevenueOpportunity) {
  const { error } = await client
    .from('war_room_leverage_scores')
    .insert({
      opportunity_id: opportunity.id,
      category: opportunity.category,
      leverage_score: opportunity.score.leverageScore,
      confidence_score: opportunity.score.confidence,
      urgency_score: opportunity.score.urgency,
      startup_cost_score: opportunity.score.startupCost,
      scalability_score: opportunity.score.scalability,
      automation_potential_score: opportunity.score.automationPotential,
      repeatability_score: opportunity.score.repeatability,
      time_to_profit_score: opportunity.score.timeToProfit,
      strategic_alignment_score: opportunity.score.strategicAlignment,
      stress_load_score: opportunity.score.stressLoad,
      family_impact_score: opportunity.score.familyImpact,
      long_term_compounding_score: opportunity.score.longTermCompoundingValue,
      score_json: opportunity.score,
      rationale: 'Revenue Engine estimated leverage score; no income or execution claim.',
      approval_required: true,
      can_execute: false,
    })

  if (error) throw new Error(error.message)
}

export async function createRevenueOpportunity(input: RevenueOpportunityInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  opportunity: RevenueOpportunity
}> {
  const generated = buildRevenueOpportunity(input)
  const supabase = tryWarRoomSupabase()

  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; opportunity scored but not persisted: ${supabase.configError}`,
      opportunity: generated,
    }
  }

  const opportunity = await insertOpportunity(supabase.client, generated)
  await insertLeverageScore(supabase.client, opportunity)
  return {
    persistenceAvailable: true,
    persistenceNote: 'Revenue opportunity and estimated leverage score persisted with service-role access.',
    opportunity,
  }
}

export async function listRevenueEngineSnapshot(limit = 40): Promise<RevenueEngineSnapshot> {
  const generatedAt = new Date().toISOString()
  const signalSnapshot = await listPersistedSignalSnapshot(12)
  const signalOpportunities = signalSnapshot.results
    .filter(signal => signal.approvalStatus === 'pending_review')
    .slice(0, 6)
    .map(opportunityFromSignal)
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return snapshot({
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}`,
      opportunities: signalOpportunities.length ? signalOpportunities : seedRevenueOpportunities(),
    })
  }

  const [opportunities, outcomes, leverageScores, executionPatterns] = await Promise.all([
    supabase.client.from('war_room_revenue_opportunities').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_revenue_outcomes').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_leverage_scores').select('*').order('created_at', { ascending: false }).limit(limit * 2),
    supabase.client.from('war_room_execution_patterns').select('*').order('created_at', { ascending: false }).limit(limit),
  ])

  const firstError = [opportunities.error, outcomes.error, leverageScores.error, executionPatterns.error].find(Boolean)
  if (firstError) {
    return snapshot({
      generatedAt,
      persistenceAvailable: true,
      persistenceNote: `Revenue Engine tables unavailable or not migrated: ${firstError.message}`,
      opportunities: signalOpportunities.length ? signalOpportunities : seedRevenueOpportunities(),
    })
  }

  const rows = ((opportunities.data ?? []) as Row[]).map(row => {
    const mapped = mapOpportunity(row)
    const requiredActions = stringArray(row.required_review_actions)
    return requiredActions[0] ? { ...mapped, nextReviewAction: requiredActions[0] } : mapped
  })

  return snapshot({
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: signalOpportunities.length
      ? 'Revenue Engine persistence is available; Phase 14 source-backed signals are included as review-only opportunities.'
      : 'Revenue Engine persistence is available.',
    opportunities: signalOpportunities.length ? [...signalOpportunities, ...rows] : rows,
    outcomes: ((outcomes.data ?? []) as Row[]).map(mapOutcome),
    leverageScores: ((leverageScores.data ?? []) as Row[]).map(mapLeverageScore),
    executionPatterns: ((executionPatterns.data ?? []) as Row[]).map(mapPattern),
  })
}

