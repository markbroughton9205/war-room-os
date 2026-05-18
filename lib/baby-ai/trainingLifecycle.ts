import {
  BABY_GROWTH_LEVELS,
  type BabyAgent,
  type BabyGrowthLevel,
  type BabyLessonState,
  type BabyTrainingEvent,
} from './model'

export type BabyLifecycleEvaluation = {
  currentLevel: BabyGrowthLevel
  recommendedLevel: BabyGrowthLevel
  promotionReady: boolean
  reasons: string[]
}

export type BabyTrainingStats = {
  eventCount: number
  approvedLessonCount: number
  validatedOutcomeCount: number
  rejectedLessonCount: number
  averageConfidence: number
  averageUsefulness: number
}

const LEVEL_THRESHOLDS: Record<BabyGrowthLevel, {
  minEvents: number
  minApprovedLessons: number
  minValidatedOutcomes: number
  minConfidence: number
  minUsefulness: number
}> = {
  seed: { minEvents: 0, minApprovedLessons: 0, minValidatedOutcomes: 0, minConfidence: 0, minUsefulness: 0 },
  observing: { minEvents: 1, minApprovedLessons: 0, minValidatedOutcomes: 0, minConfidence: 0.25, minUsefulness: 0.2 },
  learning: { minEvents: 4, minApprovedLessons: 1, minValidatedOutcomes: 1, minConfidence: 0.4, minUsefulness: 0.35 },
  useful: { minEvents: 8, minApprovedLessons: 3, minValidatedOutcomes: 3, minConfidence: 0.55, minUsefulness: 0.5 },
  specialist: { minEvents: 16, minApprovedLessons: 7, minValidatedOutcomes: 8, minConfidence: 0.7, minUsefulness: 0.65 },
  senior: { minEvents: 32, minApprovedLessons: 14, minValidatedOutcomes: 18, minConfidence: 0.82, minUsefulness: 0.78 },
}

export function lessonCanBecomePermanent(input: {
  state: BabyLessonState
  commanderApproved: boolean
  validationCount: number
}): boolean {
  return input.commanderApproved || input.state === 'commander_approved' || input.validationCount >= 3
}

export function summarizeTrainingStats(events: BabyTrainingEvent[], fallback: BabyAgent): BabyTrainingStats {
  const approvedLessonCount = events.filter(event => (
    event.lessonState === 'commander_approved' || event.lessonState === 'validated'
  )).length
  const rejectedLessonCount = events.filter(event => event.lessonState === 'rejected').length
  const validatedOutcomeCount = events.filter(event => event.observedOutcome.trim().length > 0 && event.lessonState === 'validated').length
  return {
    eventCount: events.length,
    approvedLessonCount,
    rejectedLessonCount,
    validatedOutcomeCount,
    averageConfidence: fallback.confidenceScore,
    averageUsefulness: fallback.usefulnessScore,
  }
}

export function evaluateBabyLifecycle(agent: BabyAgent, stats: BabyTrainingStats): BabyLifecycleEvaluation {
  let recommendedLevel: BabyGrowthLevel = 'seed'
  const reasons: string[] = []

  for (const level of BABY_GROWTH_LEVELS) {
    const threshold = LEVEL_THRESHOLDS[level]
    const meets =
      stats.eventCount >= threshold.minEvents
      && stats.approvedLessonCount >= threshold.minApprovedLessons
      && stats.validatedOutcomeCount >= threshold.minValidatedOutcomes
      && stats.averageConfidence >= threshold.minConfidence
      && stats.averageUsefulness >= threshold.minUsefulness
    if (meets) recommendedLevel = level
  }

  const currentIndex = BABY_GROWTH_LEVELS.indexOf(agent.growthLevel)
  const recommendedIndex = BABY_GROWTH_LEVELS.indexOf(recommendedLevel)
  const promotionReady = recommendedIndex > currentIndex

  if (promotionReady) {
    reasons.push(`${agent.displayName} has enough approved/validated training to move toward ${recommendedLevel}.`)
  } else {
    const next = BABY_GROWTH_LEVELS[Math.min(currentIndex + 1, BABY_GROWTH_LEVELS.length - 1)]
    const threshold = LEVEL_THRESHOLDS[next]
    reasons.push(`Next level ${next} needs ${threshold.minEvents} events, ${threshold.minApprovedLessons} approved lessons, and ${threshold.minValidatedOutcomes} validated outcomes.`)
  }
  if (stats.rejectedLessonCount > 0) {
    reasons.push(`${stats.rejectedLessonCount} rejected lesson(s) remain useful as negative training but cannot promote memory.`)
  }
  reasons.push('Promotion is a recommendation only; Commander approval remains required for durable lessons and expanded use.')

  return {
    currentLevel: agent.growthLevel,
    recommendedLevel,
    promotionReady,
    reasons,
  }
}
