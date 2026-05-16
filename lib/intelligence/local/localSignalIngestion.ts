import type { IntelligenceEvidenceItem, IntelligenceSourceFailure } from '@/lib/intelligence/intelligencePacket'
import { classifyCommunitySignal } from '@/lib/intelligence/local/communitySignalClassifier'
import { scoreHyperlocalEvidenceSet, type HyperlocalEvidenceScore } from '@/lib/intelligence/local/hyperlocalEvidenceScoring'
import { scanLocalContradictions, type LocalContradiction } from '@/lib/intelligence/local/localContradictionScanner'
import { trackLocalNarratives, type LocalNarrative } from '@/lib/intelligence/local/localNarrativeTracker'
import { strongestLocalityDepth, weightLocalSource } from '@/lib/intelligence/local/localSourceWeighting'
import { fuseWeakLocalSignals, type FusedLocalSignal } from '@/lib/intelligence/local/weakSignalFusion'
import type { LocalityDepth } from '@/lib/intelligence/local/localSourceRegistry'

export type LocalIntelligenceClientMetadata = {
  active: boolean
  sourceDepth: 'none' | 'verified_structured' | 'emerging_hyperlocal' | 'mixed'
  localityDepth: LocalityDepth
  weakSignalCount: number
  contradictionWarnings: number
  corroborationLevel: 'none' | 'single_source' | 'multi_source' | 'contested'
  narrativeCount: number
}

export type LocalIntelligenceLayer = {
  active: boolean
  source_depth: LocalIntelligenceClientMetadata['sourceDepth']
  locality_depth: LocalityDepth
  weak_signal_count: number
  contradiction_warnings: number
  corroboration_level: LocalIntelligenceClientMetadata['corroborationLevel']
  local_signals: FusedLocalSignal[]
  narratives: LocalNarrative[]
  local_contradictions: LocalContradiction[]
  hyperlocal_scores: HyperlocalEvidenceScore[]
  gaps: string[]
}

const LOCAL_INTENT_PATTERNS = [
  /\bwhat'?s\s+(?:happening|going\s+on)\s+(?:in|near|around|nearby)\b/i,
  /\bcrime\s+(?:in|near|around|nearby|this\s+area)\b/i,
  /\bpeople\s+talking\s+about\s+locally\b/i,
  /\blocal\s+(?:chatter|discussion|signals?|news|alerts?|reporters?)\b/i,
  /\bAkron|Cleveland|Summit\s+County|neighborhood|nearby|hyperlocal\b/i,
]

function isLocalIntent(decree: string): boolean {
  return LOCAL_INTENT_PATTERNS.some(pattern => pattern.test(decree))
}

function evidenceLooksLocal(item: IntelligenceEvidenceItem): boolean {
  const signal = classifyCommunitySignal(item)
  return signal.localityMentioned || signal.kind !== 'unknown'
}

function sourceDepth(values: Array<'verified_structured' | 'emerging_hyperlocal' | 'general'>): LocalIntelligenceClientMetadata['sourceDepth'] {
  const localValues = values.filter(value => value !== 'general')
  if (!localValues.length) return 'none'
  const unique = new Set(localValues)
  return unique.size > 1 ? 'mixed' : localValues[0]!
}

function corroborationLevel(evidence: IntelligenceEvidenceItem[], contradictions: LocalContradiction[]): LocalIntelligenceClientMetadata['corroborationLevel'] {
  if (contradictions.length) return 'contested'
  const sourceCount = new Set(evidence.map(item => item.source_id)).size
  if (sourceCount >= 2 && evidence.some(item => item.corroboration_count > 0)) return 'multi_source'
  if (sourceCount === 1 || evidence.length === 1) return 'single_source'
  return 'none'
}

export function buildLocalIntelligenceLayer(args: {
  decree: string
  evidence: IntelligenceEvidenceItem[]
  sourceFailures: IntelligenceSourceFailure[]
}): LocalIntelligenceLayer {
  const relevantEvidence = args.evidence.filter(evidenceLooksLocal)
  const localIntent = isLocalIntent(args.decree)
  const active = localIntent || relevantEvidence.length > 0
  const weighted = relevantEvidence.map(weightLocalSource)
  const localityDepth = strongestLocalityDepth(weighted.map(item => item.localityDepth))
  const localContradictions = scanLocalContradictions(relevantEvidence)
  const hyperlocalScores = scoreHyperlocalEvidenceSet(relevantEvidence)
  const narratives = trackLocalNarratives(relevantEvidence, localContradictions)
  const localSignals = fuseWeakLocalSignals({ evidence: relevantEvidence, scores: hyperlocalScores, narratives })
  const weakSignalCount = localSignals.filter(signal => signal.weakSignal).length
  const gaps: string[] = []

  if (localIntent && relevantEvidence.length === 0) {
    gaps.push('Local intent detected, but no local evidence was returned by configured sources.')
  }
  if (localIntent && args.sourceFailures.length) {
    gaps.push('Some planned sources failed or are unconfigured; do not infer missing local conditions.')
  }
  if (localSignals.every(signal => signal.layer !== 'verified') && localSignals.length) {
    gaps.push('Local layer contains emerging/chatter signals without verified local corroboration.')
  }

  return {
    active,
    source_depth: sourceDepth(weighted.map(item => item.sourceDepth)),
    locality_depth: localityDepth,
    weak_signal_count: weakSignalCount,
    contradiction_warnings: localContradictions.length,
    corroboration_level: corroborationLevel(relevantEvidence, localContradictions),
    local_signals: localSignals,
    narratives,
    local_contradictions: localContradictions,
    hyperlocal_scores: hyperlocalScores,
    gaps,
  }
}

export function toLocalIntelligenceClientMetadata(layer: LocalIntelligenceLayer): LocalIntelligenceClientMetadata {
  return {
    active: layer.active,
    sourceDepth: layer.source_depth,
    localityDepth: layer.locality_depth,
    weakSignalCount: layer.weak_signal_count,
    contradictionWarnings: layer.contradiction_warnings,
    corroborationLevel: layer.corroboration_level,
    narrativeCount: layer.narratives.length,
  }
}
