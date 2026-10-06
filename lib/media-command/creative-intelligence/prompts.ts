/**
 * Bounded HVS creative prompts. Never dump project JSON, secrets, chat history, or hidden CoT.
 */
import { HVS_CREATIVE_MAX_PROMPT_CHARS, type HvsCreativeIntentAnalysis, type HvsCreativeApproach } from './types'

export const HVS_CREATIVE_SYSTEM_ROLE = [
  'You are the Higher Vision Studios creative reasoning engine.',
  'Responsibilities: interpret intent, generate differentiated concepts, identify tradeoffs, respect production constraints, analyze review evidence, and propose refinements.',
  'You do not claim objective beauty, perfect taste, or final authority.',
  'Commander remains the authority for direction, approval, and delivery.',
  'Return JSON only. No markdown fences. No hidden chain-of-thought. No numeric creative/cinematic/quality/taste scores.',
  'Do not emit EditOps, timeline mutations, publish actions, or lesson status changes.',
].join(' ')

function clip(text: string, max = HVS_CREATIVE_MAX_PROMPT_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 24)}\n[truncated]`
}

function lessonRulesOnly(rules: string[]): string[] {
  return rules.filter(rule => rule.trim().length > 0).slice(0, 12)
}

type IntentPromptInput = {
  prompt: string
  goal: string
  durationSec: number | null
  aspect: string | null
  style: string | null
  platform: string | null
  productionMode?: string | null
  themeId?: string | null
  lessonRules: string[]
  lessonIds: string[]
  assetNames: string[]
  constraints: string[]
}

type AlternativesPromptInput = IntentPromptInput & {
  intent: HvsCreativeIntentAnalysis
  lessonConflicts: Array<{ lessonIds: string[]; reason: string }>
  unavailableAssets: string[]
  rightsBlockedAssets: string[]
}

type ReviewPromptInput = {
  intent: HvsCreativeIntentAnalysis
  approach: HvsCreativeApproach | null
  evidence: Record<string, unknown>
  lessonRules: string[]
  commanderUtterance?: string | null
}

export function intentUserPrompt(input: IntentPromptInput): string {
  return clip(JSON.stringify({
    requestType: 'INTENT_ANALYSIS',
    schema: 'hvs.creative-intent.v1',
    commanderRequest: input.prompt.slice(0, 1200),
    production: {
      goal: input.goal,
      durationSec: input.durationSec,
      aspect: input.aspect,
      style: input.style,
      platform: input.platform,
      productionMode: input.productionMode ?? null,
      themeId: input.themeId ?? null,
    },
    selectedAssets: input.assetNames.slice(0, 16),
    activeConfirmedLessonRules: lessonRulesOnly(input.lessonRules),
    lessonIds: input.lessonIds.slice(0, 12),
    constraints: input.constraints.slice(0, 12),
    requiredFields: [
      'schema', 'objective', 'audience', 'emotionalGoal', 'narrativeGoal', 'visualGoal',
      'pacingGoal', 'audioGoal', 'typographyGoal', 'colorGoal', 'framingGoal',
      'platformContext', 'requiredElements', 'avoidElements', 'constraints', 'uncertainties',
    ],
    forbidden: ['sourceUtterance', 'entire project', 'secrets', 'chain-of-thought', 'creativeScore'],
  }))
}

export function alternativesUserPrompt(input: AlternativesPromptInput): string {
  return clip(JSON.stringify({
    requestType: 'ALTERNATIVE_GENERATION',
    schema: 'hvs.creative-approach.v1',
    commanderRequest: input.prompt.slice(0, 1200),
    intent: input.intent,
    production: {
      goal: input.goal,
      durationSec: input.durationSec,
      aspect: input.aspect,
      style: input.style,
      platform: input.platform,
      productionMode: input.productionMode ?? null,
      themeId: input.themeId ?? null,
    },
    selectedAssets: input.assetNames.slice(0, 16),
    unavailableAssets: input.unavailableAssets.slice(0, 12),
    rightsBlockedAssets: input.rightsBlockedAssets.slice(0, 12),
    activeConfirmedLessonRules: lessonRulesOnly(input.lessonRules),
    lessonIds: input.lessonIds.slice(0, 12),
    lessonConflicts: input.lessonConflicts.slice(0, 6),
    rules: {
      approachCount: 'exactly 2-4',
      differentiation: 'each concept must differ meaningfully; adjective-only variants are invalid',
      comparisonCriteria: [
        'intentFit', 'audienceFit', 'productionFeasibility', 'assetAvailability',
        'rightsFeasibility', 'visualCoherence', 'pacingFit', 'platformFit', 'lessonCompatibility',
      ],
      judgments: ['STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN'],
      recommendation: 'advisory only; commanderFinalAuthority true; objectiveTruth false',
      missingAssets: 'mark requiredAssetIds; do not invent assets',
      rights: 'rightsBlocked media may be recommended only with rightsRisk true',
    },
  }))
}

export function reviewUserPrompt(input: ReviewPromptInput): string {
  return clip(JSON.stringify({
    requestType: 'CREATIVE_REVIEW',
    schema: 'hvs.creative-review.v1',
    intent: input.intent,
    approach: input.approach
      ? {
        id: input.approach.id,
        title: input.approach.title,
        concept: input.approach.concept,
        requiredAssetIds: input.approach.requiredAssetIds ?? [],
        rightsRisk: input.approach.rightsRisk === true,
      }
      : null,
    evidence: input.evidence,
    activeConfirmedLessonRules: lessonRulesOnly(input.lessonRules),
    commanderUtterance: input.commanderUtterance?.slice(0, 400) ?? null,
    honesty: {
      OBSERVED: 'only when supplied evidence supports the fact',
      INFERRED: 'judgment from evidence that is not a direct measurement',
      HUMAN_REQUIRED: 'without frame/audio/evidence support',
    },
    forbidden: ['creativeScore', 'cinematicScore', 'qualityScore', 'tasteScore', 'lesson promotion'],
    verdicts: ['ACCEPT_FOR_QC', 'REFINE_REQUIRED', 'REPLAN_REQUIRED', 'NEEDS_HUMAN'],
  }))
}
