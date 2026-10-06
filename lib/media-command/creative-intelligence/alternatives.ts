/**
 * Bounded creative alternatives (2–4). Comparison is per-criterion, not a numeric score.
 * Recommendation is advisory. Commander remains final authority.
 */
import type { HvsProductionIntent } from '../production-ai-types'
import type { HvsLessonConflict, HvsPlanningConstraint } from '../lessons/types'
import type {
  HvsCreativeIntentAnalysis,
  HvsSemanticReasoning,
} from './types'
import {
  createDeterministicCreativeProvider,
  parseCreativeAlternatives,
  type HvsCreativeAlternativesValue,
  type HvsCreativeProvider,
} from './provider'
import { fallbackIntentFromProduction } from './intent'

export async function generateCreativeAlternatives(input: {
  intent: HvsProductionIntent
  analysisIntent: HvsCreativeIntentAnalysis
  constraints: HvsPlanningConstraint[]
  conflicts?: HvsLessonConflict[]
  unavailableAssets?: string[]
  rightsBlockedAssets?: string[]
  assetNames?: string[]
  productionMode?: string | null
  themeId?: string | null
  provider?: HvsCreativeProvider
}): Promise<{ value: HvsCreativeAlternativesValue | null; semanticReasoning: HvsSemanticReasoning; reason?: string }> {
  const provider = input.provider ?? createDeterministicCreativeProvider()
  const result = await provider.generateAlternatives({
    prompt: input.intent.prompt,
    goal: input.intent.goal,
    durationSec: input.intent.durationSec,
    aspect: input.intent.aspect,
    style: input.intent.style,
    platform: input.intent.platform,
    productionMode: input.productionMode ?? input.intent.goal,
    themeId: input.themeId ?? null,
    lessonRules: input.constraints.map(row => row.rule),
    lessonIds: input.constraints.map(row => row.lessonId),
    assetNames: input.assetNames ?? [],
    constraints: input.intent.constraints,
    intent: input.analysisIntent ?? fallbackIntentFromProduction(input.intent),
    lessonConflicts: (input.conflicts ?? []).map(row => ({ lessonIds: row.lessonIds, reason: row.reason })),
    unavailableAssets: input.unavailableAssets ?? [],
    rightsBlockedAssets: input.rightsBlockedAssets ?? [],
  })
  if (!result.ok) return { value: null, semanticReasoning: result.semanticReasoning, reason: result.reason }
  const parsed = parseCreativeAlternatives(result.value)
  if (!parsed) return { value: null, semanticReasoning: 'MALFORMED', reason: 'Alternatives failed schema validation.' }
  const withLessons = {
    ...parsed,
    approaches: parsed.approaches.map(row => ({
      ...row,
      lessonIdsUsed: [...new Set([...row.lessonIdsUsed, ...input.constraints.map(item => item.lessonId)])],
    })),
  }
  return { value: withLessons, semanticReasoning: 'AVAILABLE' }
}

export function selectApproach(
  value: HvsCreativeAlternativesValue,
  commanderChoiceId?: string | null,
): HvsCreativeAlternativesValue['recommendation'] {
  if (commanderChoiceId && value.approaches.some(row => row.id === commanderChoiceId)) {
    return {
      ...value.recommendation,
      approachId: commanderChoiceId,
      whyItFits: 'Commander selected this approach. Creative intelligence remains advisory.',
      commanderFinalAuthority: true,
      objectiveTruth: false,
    }
  }
  return value.recommendation
}
