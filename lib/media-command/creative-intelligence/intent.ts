/**
 * Structured creative intent. Enriches HvsProductionIntent; does not replace it.
 * Does not infer unavailable rights or assets.
 */
import type { HvsProductionIntent } from '../production-ai-types'
import type { HvsPlanningConstraint, HvsLessonConflict } from '../lessons/types'
import {
  HVS_CREATIVE_ANALYSIS_SCHEMA,
  type HvsCreativeAnalysis,
  type HvsCreativeIntentAnalysis,
  type HvsSemanticReasoning,
} from './types'
import type { HvsCreativeProvider } from './provider'
import { createDeterministicCreativeProvider, parseCreativeIntent } from './provider'

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function fallbackIntentFromProduction(intent: HvsProductionIntent): HvsCreativeIntentAnalysis {
  return {
    schema: 'hvs.creative-intent.v1',
    objective: intent.prompt.trim() || 'Make a short video from attached media.',
    audience: intent.platform ? `${intent.platform} viewers` : null,
    emotionalGoal: intent.tone,
    narrativeGoal: intent.goal === 'TRAILER' ? 'trailer beats' : intent.goal === 'PROMO' ? 'product promo' : null,
    visualGoal: intent.style ? `${intent.style.toLowerCase()} look` : null,
    pacingGoal: intent.durationSec ? `about ${intent.durationSec}s` : null,
    audioGoal: intent.music === 'louder' ? 'music louder' : intent.voice === 'clearer' ? 'voice clearer' : null,
    typographyGoal: intent.captions ? 'captions if speech exists' : null,
    colorGoal: intent.style ? `${intent.style.toLowerCase()} color direction` : null,
    framingGoal: intent.aspect === '9:16' ? 'vertical-safe framing' : null,
    platformContext: intent.platform,
    durationIntent: intent.durationSec ? `${intent.durationSec}s` : null,
    aspectIntent: intent.aspect,
    requiredElements: [],
    avoidElements: [],
    constraints: intent.constraints,
    uncertainties: ['Semantic provider unavailable. Intent is parsed from stated production fields only.'],
  }
}

export async function analyzeCreativeIntent(input: {
  intent: HvsProductionIntent
  productionMode?: string | null
  themeId?: string | null
  constraints: HvsPlanningConstraint[]
  conflicts?: HvsLessonConflict[]
  assetNames: string[]
  provider?: HvsCreativeProvider
}): Promise<{ analysis: HvsCreativeAnalysis; semanticReasoning: HvsSemanticReasoning }> {
  const provider = input.provider ?? createDeterministicCreativeProvider()
  const request = {
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
    assetNames: input.assetNames,
    constraints: input.intent.constraints,
  }
  const result = await provider.analyzeIntent(request)
  const parsed = result.ok ? parseCreativeIntent(result.value) : null
  const semanticReasoning: HvsSemanticReasoning = !result.ok
    ? result.semanticReasoning
    : parsed
      ? 'AVAILABLE'
      : 'MALFORMED'
  const intent = parsed ?? fallbackIntentFromProduction(input.intent)
  if (input.constraints.length) {
    for (const rule of input.constraints.map(row => row.rule)) {
      if (!intent.avoidElements.includes(rule) && !intent.constraints.includes(rule)) {
        intent.constraints.push(`lesson: ${rule}`)
      }
    }
  }
  const risks = [
    ...((input.conflicts ?? []).map(row => ({
      class: 'CLARITY' as const,
      note: row.reason,
      honesty: 'OBSERVED' as const,
    }))),
    ...(intent.uncertainties.map(note => ({
      class: 'CLARITY' as const,
      note,
      honesty: 'HUMAN_REQUIRED' as const,
    }))),
  ]
  return {
    semanticReasoning,
    analysis: {
      schema: HVS_CREATIVE_ANALYSIS_SCHEMA,
      id: nid('canalysis'),
      intent,
      strengthsToPreserve: [
        ...(intent.pacingGoal ? [intent.pacingGoal] : []),
        ...(intent.typographyGoal ? [intent.typographyGoal] : []),
        ...(intent.visualGoal ? [intent.visualGoal] : []),
      ],
      risks,
      opportunities: intent.requiredElements,
      unknowns: intent.uncertainties,
      lessonIdsConsidered: input.constraints.map(row => row.lessonId),
      lessonConflicts: (input.conflicts ?? []).map(row => ({ lessonIds: row.lessonIds, reason: row.reason })),
      semanticReasoning,
    },
  }
}
