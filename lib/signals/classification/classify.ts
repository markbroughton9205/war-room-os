import { scoreSourceCredibility } from '../credibility'
import {
  articlePublishedAtFromMetadata,
  isActiveFreshnessStatus,
  isActiveOperationalStatus,
} from '../freshness'
import type { SignalResult } from '../model'
import { classifyIntelligenceCategory } from './categories'
import { buildCanonicalSummary } from './summary'
import type {
  ClassificationInput,
  IntelligenceOperationalClass,
  IntelligenceSeverity,
  IntelligenceTruthLabel,
  SignalClassification,
} from './types'

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveSeverity(
  categoryConfidence: number,
  classificationConfidence: number,
  intelligenceCategory: string,
  freshnessStatus: unknown,
): IntelligenceSeverity {
  const freshnessBoost = freshnessStatus === 'LIVE' ? 8 : freshnessStatus === 'RECENT' ? 4 : 0
  const emergencyBoost = intelligenceCategory === 'emergency' ? 18 : intelligenceCategory === 'operational_risk' ? 10 : 0
  const score = categoryConfidence * 0.45 + classificationConfidence * 0.55 + freshnessBoost + emergencyBoost
  if (score >= 82) return 'critical'
  if (score >= 68) return 'elevated'
  if (score >= 50) return 'moderate'
  return 'low'
}

function resolveTruthLabel(
  operatorSourceVerified: boolean,
  provider: string,
  classificationConfidence: number,
): IntelligenceTruthLabel {
  if (provider === 'rss') return 'PROPOSED'
  if (!operatorSourceVerified) return classificationConfidence >= 70 ? 'APPROVAL_REQUIRED' : 'PROPOSED'
  return classificationConfidence >= 72 ? 'SOURCE_BACKED' : 'APPROVAL_REQUIRED'
}

function resolveOperationalClass(input: {
  metadata: Record<string, unknown>
  classificationConfidence: number
  sourceCredibilityScore: number
  truthLabel: IntelligenceTruthLabel
  operatorSourceVerified: boolean
  inContradiction: boolean
  isCollapsedDuplicate: boolean
  approvalStatus: string
}): IntelligenceOperationalClass {
  if (input.inContradiction) return 'CONFLICTED'
  if (input.isCollapsedDuplicate) return 'ARCHIVAL'

  const freshnessStatus = input.metadata.freshnessStatus
  const operationalStatus = input.metadata.operationalStatus

  if (
    freshnessStatus === 'STALE'
    || freshnessStatus === 'ARCHIVAL'
    || freshnessStatus === 'UNKNOWN_DATE'
    || operationalStatus === 'EXCLUDED'
  ) {
    return 'ARCHIVAL'
  }

  const actionableFresh = isActiveFreshnessStatus(freshnessStatus)
    && isActiveOperationalStatus(operationalStatus)
  const credibleEnough = input.sourceCredibilityScore >= 55
  const confidentEnough = input.classificationConfidence >= 58
  const truthAllowsAction = input.truthLabel === 'SOURCE_BACKED'
    || (input.truthLabel === 'APPROVAL_REQUIRED' && input.operatorSourceVerified)

  if (
    actionableFresh
    && credibleEnough
    && confidentEnough
    && truthAllowsAction
    && input.approvalStatus !== 'rejected'
    && input.approvalStatus !== 'low_confidence'
  ) {
    return 'ACTIONABLE'
  }

  if (actionableFresh && (input.truthLabel === 'PROPOSED' || !input.operatorSourceVerified)) {
    return 'WATCHLIST'
  }

  if (freshnessStatus === 'LIVE' || freshnessStatus === 'RECENT') return 'WATCHLIST'
  return 'ARCHIVAL'
}

export function classifySignal(
  input: ClassificationInput,
  context?: {
    narrativeGroupId?: string | null
    contradictionGroupId?: string | null
    contradictionPeerIds?: string[]
    collapsedDuplicateCount?: number
    isCollapsedDuplicate?: boolean
    reliabilityScore?: number
  },
): SignalClassification {
  const diagnostics: string[] = []
  let classificationFailed = false

  try {
    const text = `${input.title} ${input.summary}`
    const { category, confidence: categoryConfidence } = classifyIntelligenceCategory(text, input.category)
    const credibility = scoreSourceCredibility({
      provider: input.provider,
      sourceLabel: input.source,
      url: input.url,
      reliabilityScore: context?.reliabilityScore,
    })
    diagnostics.push(...credibility.rationale)

    const freshnessPenalty = typeof input.metadata.recencyPenalty === 'number'
      ? Math.min(30, Math.max(0, input.metadata.recencyPenalty))
      : 0
    const scoreBlend = (
      input.scores.confidence * 0.35
      + input.scores.relevance * 0.2
      + credibility.score * 0.35
      + categoryConfidence * 0.1
    )
    const classificationConfidence = clamp(scoreBlend - freshnessPenalty * 0.35)

    const truthLabel = resolveTruthLabel(
      credibility.operatorSourceVerified,
      input.provider,
      classificationConfidence,
    )

    const inContradiction = Boolean(context?.contradictionGroupId)
    const isCollapsedDuplicate = Boolean(context?.isCollapsedDuplicate)
    const operationalClass = resolveOperationalClass({
      metadata: input.metadata,
      classificationConfidence,
      sourceCredibilityScore: credibility.score,
      truthLabel,
      operatorSourceVerified: credibility.operatorSourceVerified,
      inContradiction,
      isCollapsedDuplicate,
      approvalStatus: input.approvalStatus,
    })

    const intelligenceSeverity = resolveSeverity(
      categoryConfidence,
      classificationConfidence,
      category,
      input.metadata.freshnessStatus,
    )

    const articlePublishedAt = articlePublishedAtFromMetadata(input.metadata)
    if (!articlePublishedAt && input.provider === 'rss') {
      diagnostics.push('rss_missing_publication_time_downgraded')
    }

    const canonicalSummary = buildCanonicalSummary({
      intelligenceCategory: category,
      operationalClass,
      intelligenceSeverity,
      sourceLabel: input.source,
      provider: input.provider,
      rawHeadline: input.title,
      evidenceSummary: input.summary,
      classificationConfidence,
      sourceCredibilityScore: credibility.score,
      truthLabel,
      contradictionPeerCount: context?.contradictionPeerIds?.length ?? 0,
    })

    return {
      intelligenceCategory: category,
      categoryConfidence,
      classificationConfidence,
      sourceCredibilityScore: credibility.score,
      operationalClass,
      intelligenceSeverity,
      truthLabel,
      operatorSourceVerified: credibility.operatorSourceVerified,
      canonicalSummary,
      rawHeadline: input.title,
      narrativeGroupId: context?.narrativeGroupId ?? null,
      contradictionGroupId: context?.contradictionGroupId ?? null,
      collapsedDuplicateCount: context?.collapsedDuplicateCount ?? 0,
      contradictionPeerIds: context?.contradictionPeerIds ?? [],
      classificationDiagnostics: diagnostics,
      classificationFailed: false,
    }
  } catch (error) {
    classificationFailed = true
    const message = error instanceof Error ? error.message : String(error)
    diagnostics.push(`classification_error:${message}`)
    return {
      intelligenceCategory: 'operational_risk',
      categoryConfidence: 30,
      classificationConfidence: 25,
      sourceCredibilityScore: 30,
      operationalClass: 'WATCHLIST',
      intelligenceSeverity: 'low',
      truthLabel: 'PROPOSED',
      operatorSourceVerified: false,
      canonicalSummary: buildCanonicalSummary({
        intelligenceCategory: 'operational_risk',
        operationalClass: 'WATCHLIST',
        intelligenceSeverity: 'low',
        sourceLabel: input.source,
        provider: input.provider,
        rawHeadline: input.title,
        evidenceSummary: 'Classification failed; retain raw RSS evidence and manual review.',
        classificationConfidence: 25,
        sourceCredibilityScore: 30,
        truthLabel: 'PROPOSED',
        contradictionPeerCount: 0,
      }),
      rawHeadline: input.title,
      narrativeGroupId: null,
      contradictionGroupId: null,
      collapsedDuplicateCount: 0,
      contradictionPeerIds: [],
      classificationDiagnostics: diagnostics,
      classificationFailed,
    }
  }
}

export function withClassificationMetadata(
  result: SignalResult,
  classification: SignalClassification,
): SignalResult {
  return {
    ...result,
    summary: classification.canonicalSummary,
    metadata: {
      ...result.metadata,
      intelligenceCategory: classification.intelligenceCategory,
      categoryConfidence: classification.categoryConfidence,
      classificationConfidence: classification.classificationConfidence,
      sourceCredibilityScore: classification.sourceCredibilityScore,
      operationalClass: classification.operationalClass,
      intelligenceSeverity: classification.intelligenceSeverity,
      intelligenceTruthLabel: classification.truthLabel,
      operatorSourceVerified: classification.operatorSourceVerified,
      canonicalSummary: classification.canonicalSummary,
      rawHeadline: classification.rawHeadline,
      narrativeGroupId: classification.narrativeGroupId,
      contradictionGroupId: classification.contradictionGroupId,
      collapsedDuplicateCount: classification.collapsedDuplicateCount,
      contradictionPeerIds: classification.contradictionPeerIds,
      classificationDiagnostics: classification.classificationDiagnostics,
      classificationFailed: classification.classificationFailed,
      rawSummary: result.summary,
    },
  }
}
