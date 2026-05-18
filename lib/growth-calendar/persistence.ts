import 'server-only'

import { BABY_AI_AGENTS, type BabyAgentKey } from '@/lib/baby-ai/model'
import { buildBabyDailyBriefing } from '@/lib/baby-ai/operationalIntelligence'
import { listFeatureBuilderSnapshot } from '@/lib/feature-builder/persistence'
import { getOutcomeLedgerSnapshot } from '@/lib/learning/outcomeLedger'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  buildGrowthCalendarRecommendation,
  buildGrowthCalendarReviews,
  rankGrowthCalendarRecommendations,
} from './scoring'
import {
  GROWTH_CALENDAR_EVENT_TYPES,
  GROWTH_CALENDAR_RECOMMENDATION_STATUSES,
  type GrowthCalendarEvent,
  type GrowthCalendarEventInput,
  type GrowthCalendarEventStatus,
  type GrowthCalendarEventType,
  type GrowthCalendarOutcome,
  type GrowthCalendarRecommendation,
  type GrowthCalendarRecommendationInput,
  type GrowthCalendarRecommendationStatus,
  type GrowthCalendarReview,
  type GrowthCalendarSnapshot,
  type GrowthCalendarSource,
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
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function eventType(value: unknown): GrowthCalendarEventType {
  const raw = text(value)
  return (GROWTH_CALENDAR_EVENT_TYPES as readonly string[]).includes(raw) ? raw as GrowthCalendarEventType : 'strategic_planning'
}

function recommendationStatus(value: unknown): GrowthCalendarRecommendationStatus {
  const raw = text(value)
  return (GROWTH_CALENDAR_RECOMMENDATION_STATUSES as readonly string[]).includes(raw)
    ? raw as GrowthCalendarRecommendationStatus
    : 'proposed'
}

function source(value: unknown): GrowthCalendarSource {
  const raw = text(value)
  if (['revenue_engine', 'signal_radar', 'baby_daily_briefing', 'feature_builder', 'approval_queue', 'outcome_ledger', 'calendar_seed'].includes(raw)) {
    return raw as GrowthCalendarSource
  }
  return 'calendar_seed'
}

function family(value: unknown): BabyAgentKey {
  const raw = text(value)
  return BABY_AI_AGENTS.some(agent => agent.key === raw) ? raw as BabyAgentKey : 'chatgpt-family-baby'
}

function mapRecommendation(row: Row): GrowthCalendarRecommendation {
  const scoreJson = objectValue(row.score_json)
  return {
    id: text(row.id),
    title: text(row.title, 'Untitled growth block'),
    eventType: eventType(row.event_type),
    status: recommendationStatus(row.status),
    source: source(row.source),
    sourceId: nullableText(row.source_id),
    description: text(row.description),
    score: {
      leverageScore: num(row.leverage_score, num(scoreJson.leverageScore)),
      urgencyScore: num(row.urgency_score, num(scoreJson.urgencyScore)),
      incomePotential: num(row.income_potential_score, num(scoreJson.incomePotential)),
      energyCost: num(row.energy_cost_score, num(scoreJson.energyCost)),
      familyImpact: num(row.family_impact_score, num(scoreJson.familyImpact)),
      deadlinePressure: num(row.deadline_pressure_score, num(scoreJson.deadlinePressure)),
      compoundingValue: num(row.compounding_value_score, num(scoreJson.compoundingValue)),
    },
    recommendedDurationMinutes: num(row.recommended_duration_minutes, 60),
    recommendedTimeWindow: text(row.recommended_time_window, 'Commander-selected window'),
    assignedFamily: family(row.assigned_family),
    reason: text(row.reason),
    approvalRequired: true,
    canScheduleExternally: false,
    hiddenSchedulingAllowed: false,
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
    metadata: objectValue(row.metadata),
  }
}

function mapEvent(row: Row): GrowthCalendarEvent {
  return {
    id: text(row.id),
    recommendationId: nullableText(row.recommendation_id),
    title: text(row.title, 'Untitled growth calendar event'),
    eventType: eventType(row.event_type),
    status: text(row.status, 'planned') as GrowthCalendarEventStatus,
    plannedStart: nullableText(row.planned_start),
    plannedEnd: nullableText(row.planned_end),
    durationMinutes: num(row.duration_minutes, 60),
    approvedByCommander: bool(row.approved_by_commander),
    externalCalendarWrite: false,
    hiddenSchedulingPerformed: false,
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: nullableText(row.updated_at),
    metadata: objectValue(row.metadata),
  }
}

function mapReview(row: Row): GrowthCalendarReview {
  return {
    id: text(row.id),
    recommendationId: nullableText(row.recommendation_id),
    eventId: nullableText(row.event_id),
    reviewType: text(row.review_type, 'council') as GrowthCalendarReview['reviewType'],
    summary: text(row.summary),
    assignedFamily: family(row.assigned_family),
    approvalRequired: true,
    canExecute: false,
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapOutcome(row: Row): GrowthCalendarOutcome {
  return {
    id: text(row.id),
    eventId: nullableText(row.event_id),
    recommendationId: nullableText(row.recommendation_id),
    outcomeType: text(row.outcome_type, 'useful') as GrowthCalendarOutcome['outcomeType'],
    summary: text(row.summary),
    validated: bool(row.validated),
    evidence: objectValue(row.evidence),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function buildSnapshot(input: {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  recommendations: GrowthCalendarRecommendation[]
  events?: GrowthCalendarEvent[]
  reviews?: GrowthCalendarReview[]
  outcomes?: GrowthCalendarOutcome[]
  integrations: GrowthCalendarSnapshot['integrations']
}): GrowthCalendarSnapshot {
  const events = input.events ?? []
  const recommendations = rankGrowthCalendarRecommendations(input.recommendations)
  const generatedReviews = buildGrowthCalendarReviews(recommendations, events)
  const reviews = [...generatedReviews, ...(input.reviews ?? [])]
  const alerts = reviews.filter(review => review.reviewType !== 'council')
  const activeRecommendations = recommendations.filter(item => item.status === 'proposed')

  return {
    generatedAt: input.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    todayHighestLeverageBlock: activeRecommendations[0] ?? recommendations[0] ?? null,
    weekPlan: activeRecommendations.slice(0, 7),
    recommendations,
    events,
    reviews,
    outcomes: input.outcomes ?? [],
    alerts,
    stats: {
      proposedRecommendations: recommendations.filter(item => item.status === 'proposed').length,
      approvedEvents: events.filter(item => item.status === 'planned' && item.approvedByCommander).length,
      incomeFirstSuggestions: recommendations.filter(item => ['income_action', 'opportunity_follow_up', 'freight_logistics_outreach', 'business_development'].includes(item.eventType)).length,
      buildSessions: recommendations.filter(item => ['feature_build_session', 'war_room_maintenance', 'deep_work_block'].includes(item.eventType)).length,
      overloadWarnings: reviews.filter(item => item.reviewType === 'overload').length,
      recoveryAlerts: reviews.filter(item => item.reviewType === 'family_balance').length,
    },
    integrations: input.integrations,
    guardrails: {
      recommendationOnlyUntilApproval: true,
      commanderApprovalRequired: true,
      noExternalCalendarMutation: true,
      noHiddenScheduling: true,
      noFakeAutomation: true,
      noBackgroundActions: true,
    },
  }
}

async function buildIntegratedRecommendations(generatedAt: string): Promise<{
  recommendations: GrowthCalendarRecommendation[]
  integrations: GrowthCalendarSnapshot['integrations']
}> {
  const now = new Date(generatedAt)
  const [revenue, signals, featureBuilder, briefing] = await Promise.all([
    listRevenueEngineSnapshot(12),
    listPersistedSignalSnapshot(12),
    listFeatureBuilderSnapshot(8),
    buildBabyDailyBriefing(),
  ])
  const outcomeLedger = getOutcomeLedgerSnapshot()
  const recommendations: GrowthCalendarRecommendation[] = []

  revenue.opportunities.slice(0, 4).forEach((opportunity, index) => {
    recommendations.push(buildGrowthCalendarRecommendation({
      title: opportunity.title,
      eventType: opportunity.category === 'freight' || opportunity.category === 'sprinter_van_routes' || opportunity.category === 'local_delivery' ? 'freight_logistics_outreach' : 'income_action',
      source: 'revenue_engine',
      sourceId: opportunity.id,
      description: opportunity.notes,
      assignedFamily: 'income-operations-baby',
      reason: `Revenue Engine ranked this as opportunity #${opportunity.priorityRank || index + 1}; schedule only after Commander approval.`,
      recommendedDurationMinutes: opportunity.estimatedTimeHours && opportunity.estimatedTimeHours <= 2 ? 45 : 75,
      recommendedTimeWindow: opportunity.score.timeToProfit >= 70 ? 'Today, first income-capable block' : 'This week, after higher-urgency income checks',
      scores: {
        incomePotential: opportunity.score.timeToProfit >= 70 ? 82 : 70,
        urgencyScore: opportunity.score.urgency,
        familyImpact: opportunity.score.familyImpact,
        energyCost: opportunity.score.stressLoad,
        compoundingValue: opportunity.score.longTermCompoundingValue,
        deadlinePressure: opportunity.score.timeToProfit,
      },
      metadata: { revenueCategory: opportunity.category, sourceRank: opportunity.priorityRank },
    }, now))
  })

  signals.results.filter(signal => signal.approvalStatus === 'pending_review').slice(0, 3).forEach(signal => {
    recommendations.push(buildGrowthCalendarRecommendation({
      title: signal.title,
      eventType: signal.category === 'AI_trends' ? 'ai_automation_research' : signal.category === 'app_factory_opportunity' ? 'feature_build_session' : 'opportunity_follow_up',
      source: 'signal_radar',
      sourceId: signal.id,
      description: signal.summary,
      assignedFamily: signal.assignedBabyFamily === 'Grok Family Baby' ? 'grok-family-baby' : signal.assignedBabyFamily === 'Feature Builder' ? 'claude-family-baby' : 'analyst-baby',
      reason: `Signal Radar surfaced this as source-backed and pending review; no outreach or external action has occurred.`,
      recommendedDurationMinutes: 45,
      recommendedTimeWindow: signal.scores.urgency >= 75 ? 'Today, before the signal cools' : 'This week, research review window',
      scores: {
        incomePotential: signal.scores.incomePotential,
        urgencyScore: signal.scores.urgency,
        familyImpact: signal.scores.familyImpact,
        energyCost: Math.max(25, 100 - signal.scores.startupCost),
        deadlinePressure: signal.scores.timeToProfit,
        compoundingValue: signal.scores.repeatability,
      },
      metadata: { signalUrl: signal.url, provider: signal.provider },
    }, now))
  })

  featureBuilder.packets.slice(0, 3).forEach(packet => {
    recommendations.push(buildGrowthCalendarRecommendation({
      title: packet.title,
      eventType: packet.status === 'approved' ? 'feature_build_session' : 'war_room_maintenance',
      source: 'feature_builder',
      sourceId: packet.id,
      description: packet.objective,
      assignedFamily: 'claude-family-baby',
      reason: `Feature Builder packet exists with approval status ${packet.approvalStatus}; schedule only Commander-approved planning/build review.`,
      recommendedDurationMinutes: 120,
      recommendedTimeWindow: packet.approvalStatus === 'approved' ? 'This week, protected build session' : 'This week, council review before engineering',
      scores: {
        incomePotential: packet.monetizationAngle ? 62 : 46,
        urgencyScore: packet.approvalStatus === 'approved' ? 72 : 54,
        energyCost: 74,
        familyImpact: 56,
        compoundingValue: 86,
      },
      metadata: { packetStatus: packet.status, approvalStatus: packet.approvalStatus },
    }, now))
  })

  briefing.recommendations.slice(0, 3).forEach(item => {
    recommendations.push(buildGrowthCalendarRecommendation({
      title: item.title,
      eventType: 'council_review',
      source: 'baby_daily_briefing',
      sourceId: item.id,
      description: item.rationale,
      assignedFamily: item.agentKey,
      reason: `Baby AI Daily Briefing proposed this as approval-gated council work.`,
      recommendedDurationMinutes: 45,
      recommendedTimeWindow: 'Today, before approving new execution',
      scores: {
        urgencyScore: item.priority === 'high' ? 78 : item.priority === 'medium' ? 58 : 38,
        incomePotential: /income|revenue|opportunit|business/i.test(`${item.title} ${item.rationale}`) ? 70 : 45,
        energyCost: 34,
        familyImpact: 72,
        compoundingValue: 72,
      },
      metadata: { briefingPriority: item.priority, briefingKind: item.kind, agentName: item.agentName },
    }, now))
  })

  recommendations.push(
    buildGrowthCalendarRecommendation({
      title: 'Outcome ledger review and calendar learning loop',
      eventType: 'outcome_review',
      source: 'outcome_ledger',
      sourceId: 'learning-outcome-ledger',
      description: outcomeLedger.guardrail,
      assignedFamily: 'kimi-family-baby',
      reason: `${outcomeLedger.summary.totalEntries} learning entries exist; review outcomes before repeating or expanding time blocks.`,
      recommendedDurationMinutes: 45,
      recommendedTimeWindow: 'Weekly closeout or after completed planned events',
      scores: {
        urgencyScore: outcomeLedger.summary.unresolvedRiskCount > 0 ? 74 : 54,
        incomePotential: 44,
        energyCost: 30,
        familyImpact: 78,
        compoundingValue: 84,
        deadlinePressure: outcomeLedger.summary.unresolvedRiskCount > 0 ? 76 : 42,
      },
    }, now),
    buildGrowthCalendarRecommendation({
      title: 'Recovery and family balance protection block',
      eventType: 'family_personal_recovery',
      source: 'calendar_seed',
      sourceId: 'recovery-balance',
      description: 'Protect recovery capacity so income, build, and council work do not stack into brittle overload.',
      assignedFamily: 'red-team-baby',
      reason: 'Red Team Baby keeps overload visible when high-energy build or income work is proposed.',
      recommendedDurationMinutes: 90,
      recommendedTimeWindow: 'Today after the highest-load task, or before any second deep-work block',
    }, now),
    buildGrowthCalendarRecommendation({
      title: 'Weekly strategic growth plan',
      eventType: 'strategic_planning',
      source: 'calendar_seed',
      sourceId: 'weekly-growth-plan',
      description: 'Rank the week by income leverage, system evolution, learning needs, and family balance.',
      assignedFamily: 'chatgpt-family-baby',
      reason: 'ChatGPT Baby synthesizes priorities into a Commander-reviewed plan before time is committed.',
      recommendedDurationMinutes: 75,
      recommendedTimeWindow: 'Start of week or first planning window',
    }, now),
  )

  return {
    recommendations,
    integrations: {
      revenueEngine: revenue.opportunities.slice(0, 3).map(item => `${item.title} -> ${item.nextReviewAction}`),
      signalRadar: signals.results.slice(0, 3).map(item => `${item.title} (${item.approvalStatus})`),
      babyDailyBriefing: briefing.recommendations.slice(0, 3).map(item => item.title),
      featureBuilder: featureBuilder.packets.slice(0, 3).map(item => `${item.title} (${item.approvalStatus})`),
      approvalQueue: ['Calendar events remain proposed until Commander approval creates a planned internal event.'],
      outcomeLedger: [`${outcomeLedger.summary.totalEntries} outcome ledger entries available for review prompts.`],
    },
  }
}

async function insertRecommendation(client: WarRoomSupabase, recommendation: GrowthCalendarRecommendation) {
  const { data, error } = await client
    .from('war_room_growth_calendar_recommendations')
    .upsert({
      id: recommendation.id,
      title: recommendation.title,
      event_type: recommendation.eventType,
      status: recommendation.status,
      source: recommendation.source,
      source_id: recommendation.sourceId,
      description: recommendation.description,
      leverage_score: recommendation.score.leverageScore,
      urgency_score: recommendation.score.urgencyScore,
      income_potential_score: recommendation.score.incomePotential,
      energy_cost_score: recommendation.score.energyCost,
      family_impact_score: recommendation.score.familyImpact,
      deadline_pressure_score: recommendation.score.deadlinePressure,
      compounding_value_score: recommendation.score.compoundingValue,
      score_json: recommendation.score,
      recommended_duration_minutes: recommendation.recommendedDurationMinutes,
      recommended_time_window: recommendation.recommendedTimeWindow,
      assigned_family: recommendation.assignedFamily,
      reason: recommendation.reason,
      approval_required: true,
      can_schedule_externally: false,
      hidden_scheduling_allowed: false,
      metadata: recommendation.metadata,
    }, { onConflict: 'id' })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Growth calendar recommendation insert failed.')
  return mapRecommendation(data as Row)
}

export async function createGrowthCalendarRecommendation(input: GrowthCalendarRecommendationInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  recommendation: GrowthCalendarRecommendation
}> {
  const recommendation = buildGrowthCalendarRecommendation(input)
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; recommendation scored but not persisted: ${supabase.configError}`,
      recommendation,
    }
  }

  return {
    persistenceAvailable: true,
    persistenceNote: 'Growth calendar recommendation persisted as proposal-only with service-role access.',
    recommendation: await insertRecommendation(supabase.client, recommendation),
  }
}

export async function createGrowthCalendarEvent(input: GrowthCalendarEventInput & {
  recommendation?: GrowthCalendarRecommendation | null
}): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  event: GrowthCalendarEvent
  recommendation: GrowthCalendarRecommendation | null
}> {
  if (!input.commanderApproved) {
    throw new Error('Commander approval is required before a recommendation becomes a planned event.')
  }

  const now = new Date()
  const fallbackRecommendation = input.recommendation ?? null
  const duration = Math.max(15, Math.min(240, Math.round(input.durationMinutes ?? fallbackRecommendation?.recommendedDurationMinutes ?? 60)))
  const generatedEvent: GrowthCalendarEvent = {
    id: `gcal-event-${now.getTime()}-${input.recommendationId ?? input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
    recommendationId: input.recommendationId ?? fallbackRecommendation?.id ?? null,
    title: input.title,
    eventType: input.eventType,
    status: 'planned',
    plannedStart: input.plannedStart ?? null,
    plannedEnd: input.plannedEnd ?? null,
    durationMinutes: duration,
    approvedByCommander: true,
    externalCalendarWrite: false,
    hiddenSchedulingPerformed: false,
    createdAt: now.toISOString(),
    updatedAt: null,
    metadata: {
      approvalNote: input.approvalNote ?? 'Commander approved internal planned event.',
      noExternalCalendarWrite: true,
      noHiddenScheduling: true,
    },
  }

  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; planned event generated but not persisted: ${supabase.configError}`,
      event: generatedEvent,
      recommendation: fallbackRecommendation,
    }
  }

  let recommendation = fallbackRecommendation
  if (recommendation) {
    recommendation = await insertRecommendation(supabase.client, { ...recommendation, status: 'approved' })
  }

  const { data, error } = await supabase.client
    .from('war_room_growth_calendar_events')
    .insert({
      id: generatedEvent.id,
      recommendation_id: generatedEvent.recommendationId,
      title: generatedEvent.title,
      event_type: generatedEvent.eventType,
      status: 'planned',
      planned_start: generatedEvent.plannedStart,
      planned_end: generatedEvent.plannedEnd,
      duration_minutes: generatedEvent.durationMinutes,
      approved_by_commander: true,
      external_calendar_write: false,
      hidden_scheduling_performed: false,
      metadata: generatedEvent.metadata,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Growth calendar event insert failed.')

  if (generatedEvent.recommendationId) {
    await supabase.client
      .from('war_room_growth_calendar_recommendations')
      .update({ status: 'converted_to_event' })
      .eq('id', generatedEvent.recommendationId)
  }

  return {
    persistenceAvailable: true,
    persistenceNote: 'Commander-approved internal event persisted. No external calendar write was performed.',
    event: mapEvent(data as Row),
    recommendation,
  }
}

export async function listGrowthCalendarSnapshot(limit = 40): Promise<GrowthCalendarSnapshot> {
  const generatedAt = new Date().toISOString()
  const integrated = await buildIntegratedRecommendations(generatedAt)
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return buildSnapshot({
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}`,
      recommendations: integrated.recommendations,
      integrations: integrated.integrations,
    })
  }

  const [recommendations, events, reviews, outcomes] = await Promise.all([
    supabase.client.from('war_room_growth_calendar_recommendations').select('*').order('leverage_score', { ascending: false }).limit(limit),
    supabase.client.from('war_room_growth_calendar_events').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_growth_calendar_reviews').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_growth_calendar_outcomes').select('*').order('created_at', { ascending: false }).limit(limit),
  ])

  const firstError = [recommendations.error, events.error, reviews.error, outcomes.error].find(Boolean)
  if (firstError) {
    return buildSnapshot({
      generatedAt,
      persistenceAvailable: true,
      persistenceNote: `Growth calendar tables unavailable or not migrated: ${firstError.message}`,
      recommendations: integrated.recommendations,
      integrations: integrated.integrations,
    })
  }

  return buildSnapshot({
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: 'Growth calendar persistence is available; generated council proposals remain approval-gated.',
    recommendations: [
      ...((recommendations.data ?? []) as Row[]).map(mapRecommendation),
      ...integrated.recommendations,
    ],
    events: ((events.data ?? []) as Row[]).map(mapEvent),
    reviews: ((reviews.data ?? []) as Row[]).map(mapReview),
    outcomes: ((outcomes.data ?? []) as Row[]).map(mapOutcome),
    integrations: integrated.integrations,
  })
}
