/**
 * Creative intelligence provider boundary.
 * Reuses the HVS adapter contract. Does not create a Foundry-owned brain.
 * Does not hardcode secrets. Live calls require an injected completer.
 */
import { createHvsLiveCompleter, isHvsCreativeLiveConfigured, resolveHvsCreativeProviderSelection } from './live-completer'
import { alternativesUserPrompt, HVS_CREATIVE_SYSTEM_ROLE, intentUserPrompt, reviewUserPrompt } from './prompts'
import {
  HVS_CREATIVE_APPROACH_SCHEMA,
  HVS_CREATIVE_CRITERIA,
  HVS_CREATIVE_HONESTY,
  HVS_CREATIVE_INTENT_SCHEMA,
  HVS_CREATIVE_JUDGMENTS,
  HVS_CREATIVE_MAX_APPROACHES,
  HVS_CREATIVE_MIN_APPROACHES,
  HVS_CREATIVE_REFINEMENT_KINDS,
  HVS_CREATIVE_REVIEW_SCHEMA,
  HVS_CREATIVE_REVIEW_VERDICTS,
  HVS_CREATIVE_RISK_CLASSES,
  HVS_CREATIVE_TIMEOUT_MS,
  type HvsCreativeApproach,
  type HvsCreativeApproachComparison,
  type HvsCreativeCompleter,
  type HvsCreativeFinding,
  type HvsCreativeIntentAnalysis,
  type HvsCreativeRecommendation,
  type HvsCreativeRefinement,
  type HvsCreativeReview,
  type HvsCreativeRequestType,
  type HvsSemanticReasoning,
} from './types'

export type HvsCreativeProviderKind = 'deterministic' | 'live' | 'unavailable'

export type HvsCreativeProviderOk<T> = {
  ok: true
  value: T
  semanticReasoning: Extract<HvsSemanticReasoning, 'AVAILABLE'>
  provider: string
  providerKind: HvsCreativeProviderKind
}

export type HvsCreativeProviderFail = {
  ok: false
  semanticReasoning: Extract<HvsSemanticReasoning, 'UNAVAILABLE' | 'MALFORMED'>
  reason: string
  provider: string
  providerKind: HvsCreativeProviderKind
}

export type HvsCreativeProviderResult<T> = HvsCreativeProviderOk<T> | HvsCreativeProviderFail

export type HvsCreativeIntentRequest = {
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

export type HvsCreativeAlternativesRequest = HvsCreativeIntentRequest & {
  intent: HvsCreativeIntentAnalysis
  lessonConflicts: Array<{ lessonIds: string[]; reason: string }>
  unavailableAssets: string[]
  rightsBlockedAssets: string[]
}

export type HvsCreativeReviewRequest = {
  intent: HvsCreativeIntentAnalysis
  approach: HvsCreativeApproach | null
  evidence: Record<string, unknown>
  lessonRules: string[]
  commanderUtterance?: string | null
}

export type HvsCreativeAlternativesValue = {
  approaches: HvsCreativeApproach[]
  comparison: HvsCreativeApproachComparison[]
  recommendation: HvsCreativeRecommendation
}

export type HvsCreativeProvider = {
  name: string
  kind: HvsCreativeProviderKind
  analyzeIntent: (input: HvsCreativeIntentRequest) => Promise<HvsCreativeProviderResult<HvsCreativeIntentAnalysis>>
  generateAlternatives: (input: HvsCreativeAlternativesRequest) => Promise<HvsCreativeProviderResult<HvsCreativeAlternativesValue>>
  reviewDraft: (input: HvsCreativeReviewRequest) => Promise<HvsCreativeProviderResult<HvsCreativeReview>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is string => typeof row === 'string' && row.trim().length > 0).map(row => row.trim()).slice(0, 12)
}

export function parseCreativeIntent(value: unknown): HvsCreativeIntentAnalysis | null {
  if (!isRecord(value) || value.schema !== HVS_CREATIVE_INTENT_SCHEMA) return null
  if (typeof value.objective !== 'string' || !value.objective.trim()) return null
  return {
    schema: HVS_CREATIVE_INTENT_SCHEMA,
    objective: value.objective.trim().slice(0, 400),
    audience: typeof value.audience === 'string' ? value.audience : null,
    emotionalGoal: typeof value.emotionalGoal === 'string' ? value.emotionalGoal : null,
    narrativeGoal: typeof value.narrativeGoal === 'string' ? value.narrativeGoal : null,
    visualGoal: typeof value.visualGoal === 'string' ? value.visualGoal : null,
    pacingGoal: typeof value.pacingGoal === 'string' ? value.pacingGoal : null,
    audioGoal: typeof value.audioGoal === 'string' ? value.audioGoal : null,
    typographyGoal: typeof value.typographyGoal === 'string' ? value.typographyGoal : null,
    colorGoal: typeof value.colorGoal === 'string' ? value.colorGoal : null,
    framingGoal: typeof value.framingGoal === 'string' ? value.framingGoal : null,
    platformContext: typeof value.platformContext === 'string' ? value.platformContext : null,
    durationIntent: typeof value.durationIntent === 'string' ? value.durationIntent : null,
    aspectIntent: typeof value.aspectIntent === 'string' ? value.aspectIntent : null,
    requiredElements: asStringArray(value.requiredElements),
    avoidElements: asStringArray(value.avoidElements),
    constraints: asStringArray(value.constraints),
    uncertainties: asStringArray(value.uncertainties),
  }
}

function parseApproach(value: unknown): HvsCreativeApproach | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.concept !== 'string') return null
  return {
    schema: HVS_CREATIVE_APPROACH_SCHEMA,
    id: value.id,
    title: value.title.slice(0, 80),
    concept: value.concept.slice(0, 400),
    narrativeShape: typeof value.narrativeShape === 'string' ? value.narrativeShape : undefined,
    pacingStrategy: typeof value.pacingStrategy === 'string' ? value.pacingStrategy : undefined,
    visualLanguage: typeof value.visualLanguage === 'string' ? value.visualLanguage : undefined,
    shotStrategy: typeof value.shotStrategy === 'string' ? value.shotStrategy : undefined,
    typographyStrategy: typeof value.typographyStrategy === 'string' ? value.typographyStrategy : undefined,
    colorStrategy: typeof value.colorStrategy === 'string' ? value.colorStrategy : undefined,
    audioStrategy: typeof value.audioStrategy === 'string' ? value.audioStrategy : undefined,
    strengths: asStringArray(value.strengths),
    risks: asStringArray(value.risks),
    lessonIdsUsed: asStringArray(value.lessonIdsUsed),
    requiredAssetIds: asStringArray(value.requiredAssetIds),
    rightsRisk: value.rightsRisk === true,
  }
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const token of a) if (b.has(token)) inter += 1
  return inter / new Set([...a, ...b]).size
}

export function approachesAreDifferentiated(approaches: HvsCreativeApproach[]): boolean {
  if (approaches.length < 2) return false
  for (let i = 0; i < approaches.length; i++) {
    for (let j = i + 1; j < approaches.length; j++) {
      const left = tokenize(`${approaches[i].title} ${approaches[i].concept}`)
      const right = tokenize(`${approaches[j].title} ${approaches[j].concept}`)
      if (jaccard(left, right) > 0.82) return false
      if (approaches[i].concept.trim().toLowerCase() === approaches[j].concept.trim().toLowerCase()) return false
    }
  }
  return true
}

export function parseCreativeAlternatives(value: unknown): HvsCreativeAlternativesValue | null {
  if (!isRecord(value) || !Array.isArray(value.approaches)) return null
  const approaches = value.approaches.map(parseApproach).filter((row): row is HvsCreativeApproach => Boolean(row))
  if (approaches.length < HVS_CREATIVE_MIN_APPROACHES || approaches.length > HVS_CREATIVE_MAX_APPROACHES) return null
  if (!approachesAreDifferentiated(approaches)) return null
  if (!approaches.every(row => row.strengths.length > 0 && row.risks.length > 0)) return null
  const comparison = Array.isArray(value.comparison)
    ? value.comparison.filter(isRecord).map(row => ({
      approachId: String(row.approachId ?? ''),
      judgments: Array.isArray(row.judgments)
        ? row.judgments.filter(isRecord).map(item => ({
          criterion: HVS_CREATIVE_CRITERIA.includes(item.criterion as never) ? item.criterion as typeof HVS_CREATIVE_CRITERIA[number] : 'intentFit',
          judgment: HVS_CREATIVE_JUDGMENTS.includes(item.judgment as never) ? item.judgment as typeof HVS_CREATIVE_JUDGMENTS[number] : 'UNKNOWN',
          note: typeof item.note === 'string' ? item.note : '',
        }))
        : [],
    })).filter(row => row.approachId && row.judgments.length)
    : []
  const rawRecommendation = value.recommendation
  if (!isRecord(rawRecommendation) || typeof rawRecommendation.approachId !== 'string') return null
  const recommendedId = rawRecommendation.approachId
  if (!approaches.some(row => row.id === recommendedId)) return null
  const recommendation: HvsCreativeRecommendation = {
    approachId: recommendedId,
    whyItFits: typeof rawRecommendation.whyItFits === 'string' ? rawRecommendation.whyItFits : 'Recommended against stated intent.',
    tradeoffs: asStringArray(rawRecommendation.tradeoffs),
    uncertainties: asStringArray(rawRecommendation.uncertainties),
    commanderFinalAuthority: true,
    objectiveTruth: false,
  }
  return { approaches, comparison, recommendation }
}

function parseFinding(value: unknown): HvsCreativeFinding | null {
  if (!isRecord(value)) return null
  if (!HVS_CREATIVE_RISK_CLASSES.includes(value.class as never)) return null
  if (!HVS_CREATIVE_HONESTY.includes(value.honesty as never)) return null
  if (typeof value.observation !== 'string') return null
  return {
    class: value.class as HvsCreativeFinding['class'],
    observation: value.observation,
    intentReference: typeof value.intentReference === 'string' ? value.intentReference : '',
    evidence: typeof value.evidence === 'string' ? value.evidence : '',
    severity: value.severity === 'blocking' || value.severity === 'warn' || value.severity === 'info' ? value.severity : 'info',
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    suggestedCorrection: typeof value.suggestedCorrection === 'string' ? value.suggestedCorrection : '',
    honesty: value.honesty as HvsCreativeFinding['honesty'],
  }
}

function parseRefinement(value: unknown): HvsCreativeRefinement | null {
  if (!isRecord(value) || !HVS_CREATIVE_REFINEMENT_KINDS.includes(value.kind as never)) return null
  return {
    kind: value.kind as HvsCreativeRefinement['kind'],
    summary: typeof value.summary === 'string' ? value.summary : String(value.kind),
    mapsToPatchKind: typeof value.mapsToPatchKind === 'string' ? value.mapsToPatchKind : null,
    mapsToCommandKinds: asStringArray(value.mapsToCommandKinds),
    automaticEditOp: false,
  }
}

export function parseCreativeReview(value: unknown): HvsCreativeReview | null {
  if (!isRecord(value) || value.schema !== HVS_CREATIVE_REVIEW_SCHEMA) return null
  if (!HVS_CREATIVE_REVIEW_VERDICTS.includes(value.verdict as never)) return null
  if ('creativeScore' in value && value.creativeScore != null) return null
  if ('cinematicScore' in value && value.cinematicScore != null) return null
  if ('qualityScore' in value && value.qualityScore != null) return null
  if ('tasteScore' in value && value.tasteScore != null) return null
  const findings = Array.isArray(value.findings)
    ? value.findings.map(parseFinding).filter((row): row is HvsCreativeFinding => Boolean(row))
    : []
  return {
    schema: HVS_CREATIVE_REVIEW_SCHEMA,
    id: typeof value.id === 'string' ? value.id : 'review-unknown',
    verdict: value.verdict as HvsCreativeReview['verdict'],
    findings,
    strengths: asStringArray(value.strengths),
    weaknesses: asStringArray(value.weaknesses),
    proposedRefinements: Array.isArray(value.proposedRefinements)
      ? value.proposedRefinements.map(parseRefinement).filter((row): row is HvsCreativeRefinement => Boolean(row))
      : [],
    requiresStructuralReplan: value.requiresStructuralReplan === true || value.verdict === 'REPLAN_REQUIRED',
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    intentAlignment: HVS_CREATIVE_JUDGMENTS.includes(value.intentAlignment as never)
      ? value.intentAlignment as HvsCreativeReview['intentAlignment']
      : 'UNKNOWN',
    selfChallenge: isRecord(value.selfChallenge) && value.selfChallenge.asked === true
      ? {
        asked: true,
        moreElegant: String(value.selfChallenge.moreElegant ?? ''),
        moreCinematic: String(value.selfChallenge.moreCinematic ?? ''),
        clearer: String(value.selfChallenge.clearer ?? ''),
        moreEfficient: String(value.selfChallenge.moreEfficient ?? ''),
        overcomplicated: String(value.selfChallenge.overcomplicated ?? ''),
        tooGeneric: String(value.selfChallenge.tooGeneric ?? ''),
        servesIntent: String(value.selfChallenge.servesIntent ?? ''),
      }
      : null,
    visualAnalysisRan: value.visualAnalysisRan === true,
    semanticReasoning: 'AVAILABLE',
    creativeScore: undefined,
    cinematicScore: undefined,
    qualityScore: undefined,
    tasteScore: undefined,
  }
}

function fail(kind: HvsCreativeProviderKind, provider: string, reasoning: 'UNAVAILABLE' | 'MALFORMED', reason: string): HvsCreativeProviderFail {
  return { ok: false, semanticReasoning: reasoning, reason, provider, providerKind: kind }
}

export function createUnavailableCreativeProvider(name = 'hvs-creative-unavailable'): HvsCreativeProvider {
  const blocked = async <T>(): Promise<HvsCreativeProviderResult<T>> => fail('unavailable', name, 'UNAVAILABLE', 'Creative provider unavailable.')
  return {
    name,
    kind: 'unavailable',
    analyzeIntent: () => blocked(),
    generateAlternatives: () => blocked(),
    reviewDraft: () => blocked(),
  }
}

export function createMalformedCreativeProvider(name = 'hvs-creative-malformed'): HvsCreativeProvider {
  return {
    name,
    kind: 'deterministic',
    analyzeIntent: async () => ({ ok: true, value: { not: 'schema' } as never, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'deterministic' }),
    generateAlternatives: async () => ({ ok: true, value: { approaches: [] } as never, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'deterministic' }),
    reviewDraft: async () => ({ ok: true, value: { schema: HVS_CREATIVE_REVIEW_SCHEMA, verdict: 'WONDERFUL', creativeScore: 87 } as never, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'deterministic' }),
  }
}

function luxuryIntent(input: HvsCreativeIntentRequest): HvsCreativeIntentAnalysis {
  const prompt = input.prompt
  const luxury = /luxury/i.test(prompt)
  const cinematic = /cinematic/i.test(prompt)
  const night = /night/i.test(prompt)
  const social = /tiktok|shorts|9\s*[:x]\s*16|social/i.test(prompt) || input.aspect === '9:16'
  const narrative = /short film|film|show|story/i.test(prompt)
  const ad = /\bad\b|commercial|promo/i.test(prompt)
  return {
    schema: HVS_CREATIVE_INTENT_SCHEMA,
    objective: prompt.trim().slice(0, 400) || 'Make a short video from attached media.',
    audience: social ? 'short-form social viewers' : ad ? 'product audience' : null,
    emotionalGoal: luxury ? 'restrained confidence' : cinematic ? 'cinematic presence' : null,
    narrativeGoal: narrative ? 'opening → turn → payoff' : ad ? 'hook → product → close' : 'clear progression without forced three-act structure',
    visualGoal: night ? 'nighttime lighting with controlled highlights' : cinematic ? 'cinematic picture treatment' : null,
    pacingGoal: /slow|confident opening/i.test(prompt) ? 'slow, confident opening' : input.style === 'ENERGETIC' ? 'faster cuts' : null,
    audioGoal: /quiet|restrained/i.test(prompt) ? 'music supports picture; voice stays clear' : null,
    typographyGoal: /restrained typography|title/i.test(prompt) || luxury
      ? 'restrained type, tight hierarchy, safe margins'
      : null,
    colorGoal: luxury ? 'warm low-key luxury palette' : input.style === 'COOL' ? 'cooler grade' : null,
    framingGoal: cinematic ? 'composed, stable frames' : social ? 'vertical-safe titles and subject' : null,
    platformContext: input.platform ?? (social ? 'SOCIAL' : ad ? 'COMMERCIAL' : input.productionMode ?? null),
    durationIntent: input.durationSec ? `${input.durationSec}s` : null,
    aspectIntent: input.aspect,
    requiredElements: [
      ...(night ? ['night setting'] : []),
      ...(luxury ? ['luxury product presence'] : []),
      ...(cinematic ? ['cinematic treatment'] : []),
    ],
    avoidElements: [
      ...input.lessonRules,
      ...(luxury ? ['dense title stacks'] : []),
    ],
    constraints: [...input.constraints, ...(input.style ? [`style:${input.style}`] : [])],
    uncertainties: [
      ...(input.assetNames.length ? [] : ['No source assets named in the prompt context.']),
      'Emotional impact remains human-judged unless evidence exists.',
    ],
  }
}

function judgmentsFor(approachId: string, input: HvsCreativeAlternativesRequest, rightsRisk: boolean, assetGap: boolean): HvsCreativeApproachComparison {
  const platform = /tiktok|shorts|9:16|social/i.test(input.prompt) || input.aspect === '9:16'
  return {
    approachId,
    judgments: [
      { criterion: 'intentFit', judgment: 'STRONG', note: 'Matches stated cinematic/luxury request.' },
      { criterion: 'audienceFit', judgment: platform ? 'ADEQUATE' : 'STRONG', note: platform ? 'Social hook is shorter than this approach.' : 'Audience is product/film, not a forced viral hook.' },
      { criterion: 'productionFeasibility', judgment: 'ADEQUATE', note: 'Uses existing HVS EditOps/color/audio systems.' },
      { criterion: 'assetAvailability', judgment: assetGap ? 'WEAK' : 'ADEQUATE', note: assetGap ? 'Required location/asset is not currently available.' : 'Uses currently attached media.' },
      { criterion: 'rightsFeasibility', judgment: rightsRisk ? 'WEAK' : 'ADEQUATE', note: rightsRisk ? 'Concept leans on UNKNOWN/blocked rights media.' : 'No UNKNOWN-rights override is claimed.' },
      { criterion: 'visualCoherence', judgment: 'ADEQUATE', note: 'Look stays inside the requested style.' },
      { criterion: 'pacingFit', judgment: /slow|confident opening/i.test(input.prompt) ? 'STRONG' : 'ADEQUATE', note: 'Opening hold vs requested duration still needs review.' },
      { criterion: 'platformFit', judgment: platform && /slow/i.test(input.prompt) ? 'ADEQUATE' : 'STRONG', note: platform ? '9:16 needs safe titles; longer setup is optional.' : 'Longer setup is acceptable for film/commercial.' },
      { criterion: 'lessonCompatibility', judgment: input.lessonIds.length ? 'STRONG' : 'ADEQUATE', note: input.lessonIds.length ? 'ACTIVE/CONFIRMED lessons are in context.' : 'No reusable lessons in this cycle.' },
    ],
  }
}

export function createDeterministicCreativeProvider(name = 'hvs-creative-deterministic'): HvsCreativeProvider {
  return {
    name,
    kind: 'deterministic',
    async analyzeIntent(input) {
      return {
        ok: true,
        value: luxuryIntent(input),
        semanticReasoning: 'AVAILABLE',
        provider: name,
        providerKind: 'deterministic',
      }
    },
    async generateAlternatives(input) {
      const lessonNote = input.lessonRules[0] ?? 'Keep type inside the requested style and safe area.'
      const rightsBlocked = input.rightsBlockedAssets.length > 0
      const missing = input.unavailableAssets.length > 0
      const restrained: HvsCreativeApproach = {
        schema: HVS_CREATIVE_APPROACH_SCHEMA,
        id: 'approach-restrained-luxury',
        title: 'Restrained luxury hold',
        concept: 'Slow, confident opening on the product; sparse type; warm low-key night grade.',
        narrativeShape: /film|show|story/i.test(input.prompt) ? 'setup → turn → payoff' : 'hook → product → close',
        pacingStrategy: 'Hold the opening; avoid fragmented coverage.',
        visualLanguage: 'Night luxury, controlled highlights, cinematic contrast.',
        shotStrategy: 'Few composed shots; one establishing hold; product insert; close.',
        typographyStrategy: `Sparse hierarchy. ${lessonNote}`,
        colorStrategy: 'Warm low-key luxury palette. Do not invent a second grade.',
        audioStrategy: 'Score under picture; voice/product sound stays readable.',
        strengths: ['Matches slow confident opening', 'Respects restrained typography'],
        risks: ['Opening hold can overrun a 30s request', 'Sparse coverage needs strong product media'],
        lessonIdsUsed: input.lessonIds,
        requiredAssetIds: [],
        rightsRisk: false,
      }
      const urban: HvsCreativeApproach = {
        schema: HVS_CREATIVE_APPROACH_SCHEMA,
        id: 'approach-urban-night',
        title: 'Urban night exterior',
        concept: 'Street-level night exterior energy around the product, then settle into a luxury close.',
        narrativeShape: 'exterior energy → interior product → close',
        pacingStrategy: 'Faster first third, then a held product beat.',
        visualLanguage: 'Practical night lights, wet street, cooler edges.',
        shotStrategy: 'Wide urban establishing, walking coverage, product insert.',
        typographyStrategy: `Keep titles off the dense stack. ${lessonNote}`,
        colorStrategy: 'Cooler street, warmer product.',
        audioStrategy: 'City bed ducked under score.',
        strengths: ['Strong location atmosphere', 'Clear visual contrast'],
        risks: ['Depends on location media', 'Can miss restrained luxury if the street dominates'],
        lessonIdsUsed: input.lessonIds,
        requiredAssetIds: missing || rightsBlocked ? input.unavailableAssets.concat(input.rightsBlockedAssets) : ['urban-night-exterior'],
        rightsRisk: rightsBlocked,
      }
      const still: HvsCreativeApproach = {
        schema: HVS_CREATIVE_APPROACH_SCHEMA,
        id: 'approach-still-life',
        title: 'Still-life elegance',
        concept: 'Tabletop still-life with light moves and one type card. No street coverage.',
        narrativeShape: 'object reveal → detail → lockup',
        pacingStrategy: 'Measured; one hold per beat.',
        visualLanguage: 'Controlled studio night; speculars on product.',
        shotStrategy: 'Macro insert, pull-back, lockup.',
        typographyStrategy: `Single lockup, not a stack. ${lessonNote}`,
        colorStrategy: 'Gold/black luxury, low saturation swing.',
        audioStrategy: 'Sparse score; almost no bed.',
        strengths: ['Does not require location plates', 'Type stays sparse'],
        risks: ['Can feel generic if lighting is flat', 'Less cinematic geography'],
        lessonIdsUsed: input.lessonIds,
        requiredAssetIds: [],
        rightsRisk: false,
      }
      const approaches = missing || rightsBlocked
        ? [restrained, still, urban]
        : [restrained, urban, still]
      const comparison = approaches.map(row => judgmentsFor(row.id, input, row.rightsRisk === true, (row.requiredAssetIds ?? []).some(id => input.unavailableAssets.includes(id) || input.rightsBlockedAssets.includes(id))))
      const recommended = missing || rightsBlocked ? restrained : restrained
      return {
        ok: true,
        value: {
          approaches,
          comparison,
          recommendation: {
            approachId: recommended.id,
            whyItFits: 'Best fit for a slow, confident luxury opening without requiring unavailable location plates.',
            tradeoffs: ['Less street energy than the urban exterior', 'Opening hold must still fit the requested duration'],
            uncertainties: ['Emotional impact remains Commander-judged', ...input.lessonConflicts.map(row => row.reason)],
            commanderFinalAuthority: true,
            objectiveTruth: false,
          },
        },
        semanticReasoning: 'AVAILABLE',
        provider: name,
        providerKind: 'deterministic',
      }
    },
    async reviewDraft() {
      return fail('deterministic', name, 'UNAVAILABLE', 'Deterministic review is produced by the HVS review engine from evidence, not by a second model loop.')
    },
  }
}

export type HvsCreativeLiveCompleter = (call: {
  kind: 'intent' | 'alternatives' | 'review'
  payload: unknown
}) => Promise<unknown>

function requestTypeFor(kind: 'intent' | 'alternatives' | 'review'): HvsCreativeRequestType {
  if (kind === 'intent') return 'INTENT_ANALYSIS'
  if (kind === 'alternatives') return 'ALTERNATIVE_GENERATION'
  return 'CREATIVE_REVIEW'
}

export function liveCompleterAdapter(completer: HvsCreativeCompleter): HvsCreativeLiveCompleter {
  return async call => {
    const requestType = requestTypeFor(call.kind)
    const payload = call.payload
    const user = call.kind === 'intent'
      ? intentUserPrompt(payload as HvsCreativeIntentRequest)
      : call.kind === 'alternatives'
        ? alternativesUserPrompt(payload as HvsCreativeAlternativesRequest)
        : reviewUserPrompt(payload as HvsCreativeReviewRequest)
    const result = await completer.complete({
      requestType,
      schemaHint: call.kind === 'intent' ? HVS_CREATIVE_INTENT_SCHEMA : call.kind === 'review' ? HVS_CREATIVE_REVIEW_SCHEMA : 'hvs.creative-alternatives.v1',
      timeoutMs: call.kind === 'intent' ? HVS_CREATIVE_TIMEOUT_MS.intent : call.kind === 'alternatives' ? HVS_CREATIVE_TIMEOUT_MS.alternatives : HVS_CREATIVE_TIMEOUT_MS.review,
      system: HVS_CREATIVE_SYSTEM_ROLE,
      user,
    })
    if (result.status === 'timeout') throw new Error('timeout')
    if (!result.ok || result.value == null) throw new Error(result.error ?? 'Live completer unavailable.')
    return result.value
  }
}

export function createLiveCreativeProvider(completer: HvsCreativeLiveCompleter | null, name = 'hvs-creative-live'): HvsCreativeProvider {
  if (!completer) return createUnavailableCreativeProvider(name)
  return {
    name,
    kind: 'live',
    async analyzeIntent(input) {
      try {
        const parsed = parseCreativeIntent(await completer({ kind: 'intent', payload: input }))
        if (!parsed) return fail('live', name, 'MALFORMED', 'Live intent response failed schema validation.')
        return { ok: true, value: parsed, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'live' }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Live intent call failed.'
        return fail('live', name, /timeout/i.test(message) ? 'UNAVAILABLE' : 'UNAVAILABLE', message)
      }
    },
    async generateAlternatives(input) {
      try {
        const parsed = parseCreativeAlternatives(await completer({ kind: 'alternatives', payload: input }))
        if (!parsed) return fail('live', name, 'MALFORMED', 'Live alternatives response failed schema validation.')
        return { ok: true, value: parsed, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'live' }
      } catch (error) {
        return fail('live', name, 'UNAVAILABLE', error instanceof Error ? error.message : 'Live alternatives call failed.')
      }
    },
    async reviewDraft(input) {
      try {
        const parsed = parseCreativeReview(await completer({ kind: 'review', payload: input }))
        if (!parsed) return fail('live', name, 'MALFORMED', 'Live review response failed schema validation.')
        return { ok: true, value: parsed, semanticReasoning: 'AVAILABLE', provider: name, providerKind: 'live' }
      } catch (error) {
        return fail('live', name, 'UNAVAILABLE', error instanceof Error ? error.message : 'Live review call failed.')
      }
    },
  }
}

export function liveCreativeCompleterAvailable(): boolean {
  return isHvsCreativeLiveConfigured()
}

export function defaultCreativeProvider(): HvsCreativeProvider {
  const completer = createHvsLiveCompleter()
  if (!completer) return createDeterministicCreativeProvider()
  const selection = resolveHvsCreativeProviderSelection()
  const name = selection ? `hvs-creative-live:${selection.vendor}:${selection.model}` : 'hvs-creative-live'
  return createLiveCreativeProvider(liveCompleterAdapter(completer), name)
}

export function validateProviderPayload(kind: 'intent' | 'alternatives' | 'review', value: unknown): boolean {
  if (kind === 'intent') return Boolean(parseCreativeIntent(value))
  if (kind === 'alternatives') return Boolean(parseCreativeAlternatives(value))
  return Boolean(parseCreativeReview(value))
}
