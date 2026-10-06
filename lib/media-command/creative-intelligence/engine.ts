/**
 * HVS creative intelligence engine.
 * Enriches the existing planner. Does not replace buildProductionPlan.
 * Never mutates .hvsproj, never emits EditOps, never publishes.
 */
import type { HvsProject } from '../types'
import type { HvsProductionIntent, HvsProductionPlan } from '../production-ai-types'
import { classifyProduction } from '../workflow-discipline'
import type { HvsLessonConflict, HvsPlanningConstraint } from '../lessons/types'
import { inspectAssetGap } from '../workflow-discipline'
import { mayPublishAutomatically } from '../policy'
import {
  HVS_CREATIVE_MAX_CALLS,
  HVS_CREATIVE_RECEIPT_SCHEMA,
  type HvsCreativeApproach,
  type HvsCreativePreCreateCheck,
  type HvsCreativeReceipt,
  type HvsCreativeSessionState,
  type HvsVisualReviewAdapter,
} from './types'
import {
  createDeterministicCreativeProvider,
  createUnavailableCreativeProvider,
  defaultCreativeProvider,
  type HvsCreativeProvider,
} from './provider'
import { analyzeCreativeIntent } from './intent'
import { generateCreativeAlternatives, selectApproach } from './alternatives'
import { candidateLessonFromCorrection, reviewCreativeDraft, refinementsDoNotMutate } from './review'
import { collectCreativeEvidence } from './evidence'
import { boundEvidenceForProvider } from './evidence'
import {
  createHvsVisualReviewAdapter,
  extractCurrentRenderFrames,
  staleVisualReview,
  visualReviewIsCurrent,
} from './visual-review'
import type { HvsCreativeProviderStatus, HvsRenderIdentity, HvsVisualReviewRecord } from './types'

export { candidateLessonFromCorrection, refinementsDoNotMutate }

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function shouldRunCreativeIntelligence(prompt: string, hints?: { multiTrack?: boolean; rightsSensitive?: boolean }): boolean {
  const gate = classifyProduction(prompt, hints)
  return gate.substantial
}

export function specialistKindsFromCreative(prompt: string): Array<'CONCEPT' | 'WRITING' | 'STORY_STRUCTURE' | 'VISUAL_RESEARCH'> {
  const kinds: Array<'CONCEPT' | 'WRITING' | 'STORY_STRUCTURE' | 'VISUAL_RESEARCH'> = ['CONCEPT']
  if (/story|script|writing|copy/i.test(prompt)) kinds.push('WRITING')
  if (/story|film|show|narrative/i.test(prompt)) kinds.push('STORY_STRUCTURE')
  if (/look|reference|mood|visual research/i.test(prompt)) kinds.push('VISUAL_RESEARCH')
  return kinds
}

export function preCreateCheck(input: {
  skipped: boolean
  selected: HvsCreativeApproach | null
  unknowns: string[]
  rightsContradicted: boolean
  requestedDurationSec: number | null
  requestedAspect: string | null
  approachAspectOk: boolean
}): HvsCreativePreCreateCheck {
  const approachPresentOrSkipped = input.skipped || Boolean(input.selected)
  const platformFit = input.approachAspectOk ? 'ADEQUATE' : 'WEAK'
  const durationFit = input.requestedDurationSec ? 'ADEQUATE' : 'UNKNOWN'
  const mayProceed = approachPresentOrSkipped && !input.rightsContradicted
  return {
    approachPresentOrSkipped,
    criticalUnknowns: input.unknowns.slice(0, 8),
    rightsContradicted: input.rightsContradicted,
    platformFit,
    durationFit,
    aspectFit: input.requestedAspect ? platformFit : 'UNKNOWN',
    mayProceed,
    blockReason: input.rightsContradicted
      ? 'Rights/provenance block execution. Creative recommendation cannot override.'
      : !approachPresentOrSkipped
        ? 'Substantial work has no selected approach and was not marked skipped.'
        : null,
  }
}

export async function runCreativeIntelligence(input: {
  project: HvsProject
  intent: HvsProductionIntent
  plan?: HvsProductionPlan | null
  constraints?: HvsPlanningConstraint[]
  conflicts?: HvsLessonConflict[]
  commanderChoiceId?: string | null
  commanderUtterance?: string | null
  includeReview?: boolean
  audioClipping?: boolean | null
  silenceSuspected?: boolean | null
  qcVerdict?: string | null
  currentRender?: { path?: string | null; hash?: string | null; jobId?: string | null; versionId?: string | null } | null
  visualAdapter?: HvsVisualReviewAdapter | null
  previousVisualReview?: HvsVisualReviewRecord | null
  previousAnalysisIds?: string[]
  provider?: HvsCreativeProvider
}): Promise<HvsCreativeSessionState> {
  const skipped = !shouldRunCreativeIntelligence(input.intent.prompt)
  if (skipped) {
    const receipt: HvsCreativeReceipt = {
      schema: HVS_CREATIVE_RECEIPT_SCHEMA,
      analysisId: 'skipped',
      reviewId: null,
      provider: 'none',
      providerKind: 'unavailable',
      createdAt: new Date().toISOString(),
      intentSummary: input.intent.prompt.slice(0, 160),
      selectedApproachId: null,
      lessonIdsConsidered: [],
      findingCounts: { observed: 0, inferred: 0, humanRequired: 0 },
      callCounts: { intent: 0, alternatives: 0, review: 0, visual: 0 },
      semanticReasoning: 'SKIPPED',
      skipped: true,
      skipReason: 'trivial edit skips creative intelligence',
      hiddenReasoningStored: false,
      fallbackUsed: false,
      schemaValid: true,
      providerStatus: 'UNAVAILABLE',
      visualFramesUsed: 0,
      visualReviewStatus: 'NOT_RUN',
    }
    return { skipped: true, skipReason: receipt.skipReason, semanticReasoning: 'SKIPPED', receipt, providerStatus: 'UNAVAILABLE', visualReview: null }
  }

  const requested = input.provider
  const liveDefault = requested ?? defaultCreativeProvider()
  let provider = liveDefault
  let fallbackUsed = false
  const callCounts = { intent: 0, alternatives: 0, review: 0, visual: 0 }
  const constraints = input.constraints ?? []
  const conflicts = input.conflicts ?? []
  const assetNames = input.project.assets.map(asset => asset.name)
  const gaps = (input.intent.sourceAssetIds.length ? input.intent.sourceAssetIds : input.project.assets.map(asset => asset.id))
    .map(id => inspectAssetGap(input.project.assets.find(asset => asset.id === id) ?? null, id))
  const unavailable = gaps.filter(row => row.status === 'MISSING').map(row => row.assetId)
  const rightsBlocked = gaps.filter(row => row.status === 'UNKNOWN' || row.status === 'RIGHTS_BLOCKED').map(row => row.assetId)

  callCounts.intent = Math.min(1, HVS_CREATIVE_MAX_CALLS.intent)
  let analyzed = await analyzeCreativeIntent({
    intent: input.intent,
    productionMode: input.project.productionMode,
    themeId: input.project.timeline.themeId,
    constraints,
    conflicts,
    assetNames,
    provider,
  })

  callCounts.alternatives = Math.min(1, HVS_CREATIVE_MAX_CALLS.alternatives)
  let alternatives = await generateCreativeAlternatives({
    intent: input.intent,
    analysisIntent: analyzed.analysis.intent,
    constraints,
    conflicts,
    unavailableAssets: unavailable,
    rightsBlockedAssets: rightsBlocked,
    assetNames,
    productionMode: input.project.productionMode,
    themeId: input.project.timeline.themeId,
    provider,
  })

  if (!requested && provider.kind === 'live' && (!alternatives.value || analyzed.semanticReasoning !== 'AVAILABLE')) {
    fallbackUsed = true
    provider = createDeterministicCreativeProvider()
    if (analyzed.semanticReasoning !== 'AVAILABLE') {
      const recovered = await analyzeCreativeIntent({
        intent: input.intent,
        productionMode: input.project.productionMode,
        themeId: input.project.timeline.themeId,
        constraints,
        conflicts,
        assetNames,
        provider,
      })
      analyzed = { analysis: { ...recovered.analysis, id: analyzed.analysis.id }, semanticReasoning: recovered.semanticReasoning }
    }
    if (!alternatives.value) {
      alternatives = await generateCreativeAlternatives({
        intent: input.intent,
        analysisIntent: analyzed.analysis.intent,
        constraints,
        conflicts,
        unavailableAssets: unavailable,
        rightsBlockedAssets: rightsBlocked,
        assetNames,
        productionMode: input.project.productionMode,
        themeId: input.project.timeline.themeId,
        provider,
      })
    }
  }

  const recommendation = alternatives.value
    ? selectApproach(alternatives.value, input.commanderChoiceId)
    : null
  const selected = alternatives.value?.approaches.find(row => row.id === recommendation?.approachId) ?? null
  const rightsContradicted = rightsBlocked.length > 0 && selected?.rightsRisk === true
  const preCreate = preCreateCheck({
    skipped: false,
    selected,
    unknowns: analyzed.analysis.unknowns,
    rightsContradicted: rightsBlocked.length > 0 && (selected?.rightsRisk === true || (selected?.requiredAssetIds ?? []).some(id => rightsBlocked.includes(id))),
    requestedDurationSec: input.intent.durationSec,
    requestedAspect: input.intent.aspect,
    approachAspectOk: true,
  })

  const identity: HvsRenderIdentity = {
    projectId: input.project.id,
    path: input.currentRender?.path ?? null,
    hash: input.currentRender?.hash ?? null,
    jobId: input.currentRender?.jobId ?? null,
    versionId: input.currentRender?.versionId ?? input.project.currentVersionId,
  }
  let visualReview: HvsVisualReviewRecord | null = input.previousVisualReview ?? null
  if (visualReview && identity && !visualReviewIsCurrent(visualReview, identity) && (identity.hash || identity.jobId || identity.versionId || identity.path)) {
    visualReview = staleVisualReview(visualReview, identity)
  }

  let review = null
  if (input.includeReview) {
    callCounts.review = Math.min(1, HVS_CREATIVE_MAX_CALLS.review)
    const extracted = await extractCurrentRenderFrames({
      renderIdentity: identity,
      maxFrames: 8,
      biometricTexts: [
        input.intent.prompt,
        ...assetNames,
        ...input.project.assets.map(asset => asset.originalPath),
      ],
    })
    visualReview = {
      status: extracted.status,
      renderIdentity: identity,
      frames: extracted.frames,
      findings: [],
      inspected: extracted.status === 'ACTIVE',
      skipReason: extracted.skipReason,
    }
    const visualAdapter = input.visualAdapter ?? createHvsVisualReviewAdapter({
      renderIdentity: identity,
      biometricTexts: [input.intent.prompt, ...assetNames],
      inspect: extracted.status === 'ACTIVE',
    })
    if (extracted.status === 'ACTIVE') callCounts.visual = Math.min(1, HVS_CREATIVE_MAX_CALLS.visual)
    const evidence = await collectCreativeEvidence({
      project: input.project,
      intent: input.intent,
      plan: input.plan,
      constraints,
      audioClipping: input.audioClipping,
      silenceSuspected: input.silenceSuspected,
      qcVerdict: input.qcVerdict,
      currentRender: input.currentRender,
      visualAdapter,
    })
    void boundEvidenceForProvider(evidence)
    review = await reviewCreativeDraft({
      intent: analyzed.analysis.intent,
      approach: selected,
      evidence,
      productionIntent: input.intent,
      constraints,
      conflicts,
      commanderUtterance: input.commanderUtterance,
      provider: provider.kind === 'live' && !fallbackUsed ? provider : undefined,
    })
    if (review.findings.length && visualReview.status === 'ACTIVE') {
      visualReview = {
        ...visualReview,
        findings: review.findings.filter(row => ['FRAMING', 'COMPOSITION', 'TYPOGRAPHY', 'VISUAL_IDENTITY', 'COLOR', 'SHOT_CONTINUITY', 'CLARITY'].includes(row.class)),
      }
    }
  }

  void mayPublishAutomatically()
  void refinementsDoNotMutate()

  const providerStatus: HvsCreativeProviderStatus = fallbackUsed
    ? 'FALLBACK'
    : provider.kind === 'live'
      ? 'CONNECTED'
      : provider.kind === 'unavailable'
        ? 'UNAVAILABLE'
        : 'FALLBACK'
  const previousAnalysisIds = [...(input.previousAnalysisIds ?? []), analyzed.analysis.id].slice(-12)
  const receipt: HvsCreativeReceipt = {
    schema: HVS_CREATIVE_RECEIPT_SCHEMA,
    analysisId: analyzed.analysis.id,
    reviewId: review?.id ?? null,
    provider: liveDefault.name,
    providerKind: fallbackUsed ? 'deterministic' : provider.kind,
    model: liveDefault.kind === 'live' ? liveDefault.name.replace(/^hvs-creative-live:/, '') : null,
    createdAt: new Date().toISOString(),
    startedAt: analyzed.analysis.id ? new Date().toISOString() : null,
    completedAt: new Date().toISOString(),
    intentSummary: analyzed.analysis.intent.objective.slice(0, 200),
    selectedApproachId: selected?.id ?? null,
    lessonIdsConsidered: analyzed.analysis.lessonIdsConsidered,
    findingCounts: {
      observed: review?.findings.filter(row => row.honesty === 'OBSERVED').length ?? 0,
      inferred: review?.findings.filter(row => row.honesty === 'INFERRED').length ?? 0,
      humanRequired: review?.findings.filter(row => row.honesty === 'HUMAN_REQUIRED').length ?? 0,
    },
    callCounts,
    semanticReasoning: alternatives.semanticReasoning === 'UNAVAILABLE' || analyzed.semanticReasoning === 'UNAVAILABLE'
      ? 'UNAVAILABLE'
      : alternatives.semanticReasoning === 'MALFORMED' || analyzed.semanticReasoning === 'MALFORMED'
        ? 'MALFORMED'
        : analyzed.semanticReasoning,
    skipped: false,
    skipReason: null,
    hiddenReasoningStored: false,
    schemaValid: Boolean(alternatives.value) && analyzed.semanticReasoning !== 'MALFORMED',
    fallbackUsed,
    visualFramesUsed: visualReview?.frames.length ?? 0,
    visualReviewStatus: visualReview?.status ?? 'NOT_RUN',
    providerStatus,
    status: fallbackUsed ? 'fallback' : analyzed.semanticReasoning === 'MALFORMED' ? 'invalid' : analyzed.semanticReasoning === 'UNAVAILABLE' ? 'unavailable' : 'ok',
    previousAnalysisIds,
  }

  return {
    skipped: false,
    analysisId: analyzed.analysis.id,
    reviewId: review?.id ?? null,
    selectedApproachId: selected?.id ?? null,
    semanticReasoning: receipt.semanticReasoning,
    receipt,
    analysis: analyzed.analysis,
    approaches: alternatives.value?.approaches ?? [],
    comparison: alternatives.value?.comparison ?? [],
    recommendation,
    review,
    preCreate,
    visualReview,
    providerStatus,
    previousAnalysisIds,
  }
}

export async function runCreativeIntelligenceOrFallback(input: Parameters<typeof runCreativeIntelligence>[0]): Promise<HvsCreativeSessionState> {
  try {
    return await runCreativeIntelligence(input)
  } catch {
    const fallback = createUnavailableCreativeProvider()
    return runCreativeIntelligence({ ...input, provider: fallback })
  }
}

export function creativeDoesNotMutateProject(): { writesHvsproj: false; emitsEditOps: false; mayPublishAutomatically: false } {
  return { writesHvsproj: false, emitsEditOps: false, mayPublishAutomatically: false }
}

export function applyCommanderApproachSelection(
  state: HvsCreativeSessionState,
  approachId: string,
): HvsCreativeSessionState {
  const approaches = state.approaches ?? []
  if (!approaches.some(row => row.id === approachId)) return state
  const recommendation = {
    approachId,
    whyItFits: 'Commander selected this approach. Creative intelligence remains advisory.',
    tradeoffs: state.recommendation?.tradeoffs ?? [],
    uncertainties: state.recommendation?.uncertainties ?? [],
    commanderFinalAuthority: true as const,
    objectiveTruth: false as const,
  }
  return {
    ...state,
    selectedApproachId: approachId,
    recommendation,
    receipt: state.receipt
      ? { ...state.receipt, selectedApproachId: approachId, hiddenReasoningStored: false }
      : state.receipt,
  }
}

export function newCreativeAnalysisId(): string {
  return nid('canalysis')
}
