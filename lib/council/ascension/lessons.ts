import { ASCENSION_AUTONOMY_GUARD, type ExperienceRecord, type LessonCandidate } from './types'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'

const VAGUE_LESSON = /^(be more (thoughtful|careful|wise|skeptical)|try harder|do better|be better)$/i

export function isTestableLessonCandidate(candidate: Pick<LessonCandidate, 'trigger' | 'proposedMethod' | 'expectedBenefit'>): boolean {
  if (VAGUE_LESSON.test(candidate.proposedMethod.trim())) return false
  return Boolean(candidate.trigger.trim()) && Boolean(candidate.proposedMethod.trim()) && Boolean(candidate.expectedBenefit.trim())
}

export function createLessonCandidate(params: Omit<LessonCandidate, 'promotionStatus'> & { promotionStatus?: LessonCandidate['promotionStatus'] }): LessonCandidate {
  const candidate: LessonCandidate = {
    ...params,
    promotionStatus: params.promotionStatus ?? 'candidate',
  }
  if (!isTestableLessonCandidate(candidate)) {
    return { ...candidate, promotionStatus: 'rejected' }
  }
  return candidate
}

/** Experience may accumulate automatically. It never itself changes production behavior. */
export function recordExperience(params: Omit<ExperienceRecord, 'changesProductionBehavior'>): ExperienceRecord {
  return { ...params, changesProductionBehavior: false }
}

export function experienceChangesProductionBehavior(_experience: ExperienceRecord): false {
  return false
}

export function pulsarPrimarySourceLessonFixture(): LessonCandidate {
  return createLessonCandidate({
    lessonId: 'lesson-pulsar-primary-source',
    agentId: 'pulsar' satisfies NebulaAgentId,
    type: 'evidence_discipline',
    trigger: 'When PULSAR has only secondary sources for an important claim',
    proposedMethod: 'Continue searching for a primary source or mark the claim provisional',
    sourceEpisodeIds: [],
    expectedBenefit: 'Lower unsupported-claim rate',
    knownRisks: ['More latency'],
    evaluationIds: [],
  })
}

export function autonomyBlocksDirectLessonInstall(): boolean {
  return !ASCENSION_AUTONOMY_GUARD.selfModificationEnabled && !ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled
}
