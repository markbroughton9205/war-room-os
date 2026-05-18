import type {
  GrowthCalendarEventType,
  GrowthCalendarFamily,
  GrowthCalendarRecommendation,
  GrowthCalendarRecommendationInput,
  GrowthCalendarReview,
  GrowthCalendarScore,
} from './model'

const EVENT_BASE: Record<GrowthCalendarEventType, Partial<GrowthCalendarScore> & {
  family: GrowthCalendarFamily
  duration: number
  window: string
}> = {
  income_action: { family: 'income-operations-baby', duration: 75, window: 'Today, first high-energy work block', incomePotential: 86, urgencyScore: 78, compoundingValue: 68, energyCost: 58, familyImpact: 58 },
  feature_build_session: { family: 'claude-family-baby', duration: 120, window: 'This week, protected deep work window', incomePotential: 54, urgencyScore: 58, compoundingValue: 84, energyCost: 72, familyImpact: 52 },
  opportunity_follow_up: { family: 'income-operations-baby', duration: 45, window: 'Today or next business morning', incomePotential: 78, urgencyScore: 82, compoundingValue: 62, energyCost: 46, familyImpact: 62 },
  skill_training: { family: 'analyst-baby', duration: 60, window: 'Low-distraction evening or recovery-safe window', incomePotential: 48, urgencyScore: 42, compoundingValue: 82, energyCost: 48, familyImpact: 70 },
  business_development: { family: 'chatgpt-family-baby', duration: 75, window: 'This week, before outreach or proposal work', incomePotential: 74, urgencyScore: 64, compoundingValue: 78, energyCost: 54, familyImpact: 64 },
  freight_logistics_outreach: { family: 'income-operations-baby', duration: 60, window: 'Business hours after lane evidence review', incomePotential: 82, urgencyScore: 76, compoundingValue: 62, energyCost: 64, familyImpact: 50 },
  ai_automation_research: { family: 'analyst-baby', duration: 60, window: 'This week, after income-critical blocks', incomePotential: 62, urgencyScore: 54, compoundingValue: 84, energyCost: 46, familyImpact: 66 },
  family_personal_recovery: { family: 'red-team-baby', duration: 90, window: 'Today, after high-stress or context-heavy work', incomePotential: 20, urgencyScore: 70, compoundingValue: 72, energyCost: 10, familyImpact: 94 },
  war_room_maintenance: { family: 'bridge-architect-baby', duration: 60, window: 'This week, before new build approvals', incomePotential: 44, urgencyScore: 58, compoundingValue: 76, energyCost: 42, familyImpact: 68 },
  council_review: { family: 'chatgpt-family-baby', duration: 45, window: 'Start of day or before approving new work', incomePotential: 56, urgencyScore: 68, compoundingValue: 74, energyCost: 34, familyImpact: 72 },
  outcome_review: { family: 'kimi-family-baby', duration: 45, window: 'End of day or weekly closeout', incomePotential: 52, urgencyScore: 60, compoundingValue: 80, energyCost: 32, familyImpact: 74 },
  strategic_planning: { family: 'chatgpt-family-baby', duration: 75, window: 'Weekly planning block before tactical work', incomePotential: 64, urgencyScore: 56, compoundingValue: 86, energyCost: 48, familyImpact: 72 },
  deep_work_block: { family: 'kimi-family-baby', duration: 120, window: 'Highest-energy uninterrupted window', incomePotential: 66, urgencyScore: 62, compoundingValue: 86, energyCost: 76, familyImpact: 54 },
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function compact(value: string, limit = 420): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'calendar-block'
}

export function scoreGrowthCalendarRecommendation(input: GrowthCalendarRecommendationInput): GrowthCalendarScore {
  const base = EVENT_BASE[input.eventType]
  const scores = input.scores ?? {}
  const incomePotential = clampScore(scores.incomePotential ?? base.incomePotential ?? 50)
  const urgencyScore = clampScore(scores.urgencyScore ?? base.urgencyScore ?? 50)
  const energyCost = clampScore(scores.energyCost ?? base.energyCost ?? 50)
  const familyImpact = clampScore(scores.familyImpact ?? base.familyImpact ?? 60)
  const deadlinePressure = clampScore(scores.deadlinePressure ?? (urgencyScore >= 75 ? urgencyScore - 8 : 44))
  const compoundingValue = clampScore(scores.compoundingValue ?? base.compoundingValue ?? 60)
  const leverageScore = clampScore(
    incomePotential * 0.24 +
    urgencyScore * 0.16 +
    deadlinePressure * 0.11 +
    compoundingValue * 0.2 +
    familyImpact * 0.13 -
    energyCost * 0.1 +
    (input.source === 'revenue_engine' ? 7 : 0) +
    (input.source === 'signal_radar' ? 5 : 0) +
    (input.source === 'feature_builder' ? 3 : 0),
  )

  return {
    leverageScore,
    urgencyScore,
    incomePotential,
    energyCost,
    familyImpact,
    deadlinePressure,
    compoundingValue,
  }
}

export function buildGrowthCalendarRecommendation(
  input: GrowthCalendarRecommendationInput,
  now = new Date(),
): GrowthCalendarRecommendation {
  const base = EVENT_BASE[input.eventType]
  const title = compact(input.title, 160) || 'Untitled growth block'
  const score = scoreGrowthCalendarRecommendation(input)
  return {
    id: `gcal-rec-${now.getTime()}-${slug(`${input.source}-${input.sourceId ?? title}`)}`,
    title,
    eventType: input.eventType,
    status: 'proposed',
    source: input.source,
    sourceId: input.sourceId ?? null,
    description: compact(input.description ?? 'Council-generated time recommendation for Commander review.', 1000),
    score,
    recommendedDurationMinutes: Math.max(15, Math.min(240, Math.round(input.recommendedDurationMinutes ?? base.duration))),
    recommendedTimeWindow: compact(input.recommendedTimeWindow ?? base.window, 220),
    assignedFamily: input.assignedFamily ?? base.family,
    reason: compact(input.reason ?? reasonFor(input.eventType, score), 700),
    approvalRequired: true,
    canScheduleExternally: false,
    hiddenSchedulingAllowed: false,
    createdAt: now.toISOString(),
    updatedAt: null,
    metadata: {
      estimatedOnly: true,
      approvalGate: 'commander_required',
      noExternalCalendarWrite: true,
      ...(input.metadata ?? {}),
    },
  }
}

export function rankGrowthCalendarRecommendations(
  recommendations: GrowthCalendarRecommendation[],
): GrowthCalendarRecommendation[] {
  return [...recommendations].sort((a, b) => (
    b.score.leverageScore - a.score.leverageScore ||
    b.score.urgencyScore - a.score.urgencyScore ||
    b.score.compoundingValue - a.score.compoundingValue
  ))
}

export function buildGrowthCalendarReviews(
  recommendations: GrowthCalendarRecommendation[],
  events: { id: string; recommendationId: string | null; title: string }[] = [],
  now = new Date(),
): GrowthCalendarReview[] {
  const ranked = rankGrowthCalendarRecommendations(recommendations)
  const reviews: GrowthCalendarReview[] = []
  const overload = ranked.find(item => item.score.energyCost >= 72 || (item.score.urgencyScore >= 75 && item.score.familyImpact < 55))
  const recovery = ranked.find(item => item.eventType === 'family_personal_recovery') ?? ranked.find(item => item.score.familyImpact < 55)
  const outcomePrompt = events.find(event => event.recommendationId)

  if (ranked[0]) {
    reviews.push(review('council', ranked[0], `Council recommends reviewing "${ranked[0].title}" first because estimated leverage is ${ranked[0].score.leverageScore}.`, 'chatgpt-family-baby', now))
  }
  if (overload) {
    reviews.push(review('overload', overload, `Overload watch: "${overload.title}" carries energy cost ${overload.score.energyCost} and family impact ${overload.score.familyImpact}. Narrow scope before approval.`, 'red-team-baby', now))
  }
  if (recovery) {
    reviews.push(review('family_balance', recovery, `Family/recovery balance alert: protect recovery capacity before stacking more high-energy blocks.`, 'red-team-baby', now))
  }
  if (outcomePrompt) {
    reviews.push({
      id: `gcal-review-outcome-${now.getTime()}-${slug(outcomePrompt.id)}`,
      recommendationId: outcomePrompt.recommendationId,
      eventId: outcomePrompt.id,
      reviewType: 'outcome_prompt',
      summary: `Outcome review prompt: record whether "${outcomePrompt.title}" produced useful leverage before repeating it.`,
      assignedFamily: 'kimi-family-baby',
      approvalRequired: true,
      canExecute: false,
      createdAt: now.toISOString(),
    })
  }

  return reviews
}

function review(
  reviewType: GrowthCalendarReview['reviewType'],
  recommendation: GrowthCalendarRecommendation,
  summary: string,
  assignedFamily: GrowthCalendarFamily,
  now: Date,
): GrowthCalendarReview {
  return {
    id: `gcal-review-${reviewType}-${recommendation.id}`,
    recommendationId: recommendation.id,
    eventId: null,
    reviewType,
    summary,
    assignedFamily,
    approvalRequired: true,
    canExecute: false,
    createdAt: now.toISOString(),
  }
}

function reasonFor(eventType: GrowthCalendarEventType, score: GrowthCalendarScore): string {
  if (eventType === 'income_action' || eventType === 'opportunity_follow_up' || eventType === 'freight_logistics_outreach') {
    return `Income-first recommendation: estimated income potential ${score.incomePotential}, urgency ${score.urgencyScore}, and leverage ${score.leverageScore}.`
  }
  if (eventType === 'family_personal_recovery') {
    return `Recovery is recommended to protect family impact and execution quality; no productivity claim is made.`
  }
  if (eventType === 'feature_build_session' || eventType === 'deep_work_block') {
    return `Build/deep-work recommendation: estimated compounding value ${score.compoundingValue}, but energy cost ${score.energyCost} requires Commander approval.`
  }
  return `Council recommendation based on estimated leverage ${score.leverageScore}, urgency ${score.urgencyScore}, family impact ${score.familyImpact}, and compounding value ${score.compoundingValue}.`
}
