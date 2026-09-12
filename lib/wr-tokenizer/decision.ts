import type { WrTokenizerRecommendation } from './identity'
import type { BenchmarkSummary } from './benchmark'

export const REPLACEMENT_THRESHOLDS = {
  englishUnknownRate: 0.01,
  corpusUnknownRate: 0.02,
  englishTokensPerByte: 0.45,
  multilingualUnknownRate: 0.1,
  roundTripFailureLimit: 0,
} as const

export type DecisionEvidence = {
  english: BenchmarkSummary
  corpus0: BenchmarkSummary
  corpus1: BenchmarkSummary
  corpusActive: BenchmarkSummary
  multilingual: BenchmarkSummary
  code: BenchmarkSummary
  json: BenchmarkSummary
  wrim0Compatible: boolean
  wrim1Compatible: 'compatible' | 'incompatible' | 'unknown'
  vocabFrozen: boolean
}

export type DecisionResult = {
  recommendation: WrTokenizerRecommendation
  reasons: string[]
  thresholds: typeof REPLACEMENT_THRESHOLDS
  triggered: string[]
}

export function decideTokenizerRecommendation(evidence: DecisionEvidence): DecisionResult {
  const reasons: string[] = []
  const triggered: string[] = []
  const engUnk = evidence.english.unknownRate
  const corpusUnk = Math.max(evidence.corpus0.unknownRate, evidence.corpus1.unknownRate, evidence.corpusActive.unknownRate)
  const engTpb = evidence.english.tokensPerByte ?? 0
  const multiUnk = evidence.multilingual.unknownRate
  const rtFail = evidence.english.roundTripFailures + evidence.code.roundTripFailures + evidence.json.roundTripFailures

  if (engUnk > REPLACEMENT_THRESHOLDS.englishUnknownRate) {
    triggered.push(`english unknownRate ${engUnk.toFixed(4)} > ${REPLACEMENT_THRESHOLDS.englishUnknownRate}`)
  }
  if (corpusUnk > REPLACEMENT_THRESHOLDS.corpusUnknownRate) {
    triggered.push(`corpus unknownRate ${corpusUnk.toFixed(4)} > ${REPLACEMENT_THRESHOLDS.corpusUnknownRate}`)
  }
  if (engTpb > REPLACEMENT_THRESHOLDS.englishTokensPerByte) {
    triggered.push(`english tokens/byte ${engTpb.toFixed(4)} > ${REPLACEMENT_THRESHOLDS.englishTokensPerByte}`)
  }
  if (rtFail > REPLACEMENT_THRESHOLDS.roundTripFailureLimit) {
    triggered.push(`round-trip failures ${rtFail}`)
  }

  const currentCorpusHealthy =
    engUnk <= REPLACEMENT_THRESHOLDS.englishUnknownRate &&
    corpusUnk <= REPLACEMENT_THRESHOLDS.corpusUnknownRate &&
    engTpb <= REPLACEMENT_THRESHOLDS.englishTokensPerByte &&
    rtFail <= REPLACEMENT_THRESHOLDS.roundTripFailureLimit &&
    evidence.wrim0Compatible &&
    evidence.vocabFrozen

  const futurePressure =
    multiUnk > REPLACEMENT_THRESHOLDS.multilingualUnknownRate ||
    (evidence.english.tokensPerByte ?? 0) > 0.25 ||
    evidence.code.fragmentationRate > 0.35 ||
    evidence.json.fragmentationRate > 0.4

  if (!currentCorpusHealthy && triggered.length) {
    reasons.push('Measured unknown/fragmentation on current English/corpus exceeds replacement thresholds.')
    reasons.push('Replacement would still be a new WR-TOKENIZER-1 artifact; WR-TOKENIZER-0 stays frozen.')
    return { recommendation: 'TRAIN_WR_TOKENIZER_1', reasons, thresholds: REPLACEMENT_THRESHOLDS, triggered }
  }

  if (currentCorpusHealthy && futurePressure) {
    reasons.push('WR-TOKENIZER-0 remains technically sound on WR-CORPUS-0/1/ACTIVE and English/code/JSON fixtures.')
    reasons.push('Historical WRIM-0 embeddings (vocab 15126) are bound to this hash; replacement would invalidate them.')
    reasons.push('WRIM-1 lineage reuses the same tokenizer hash (compatible) but collapsed WRIM-1 is not promoted.')
    reasons.push('Multilingual / live-web growth will fragment or unknown more than a larger world-model tokenizer.')
    reasons.push('Keep WR-TOKENIZER-0 canonical for near-term WRIM continuation; any later tokenizer is WR-TOKENIZER-1.')
    if (multiUnk > REPLACEMENT_THRESHOLDS.multilingualUnknownRate) {
      triggered.push(`multilingual unknownRate ${multiUnk.toFixed(4)} > ${REPLACEMENT_THRESHOLDS.multilingualUnknownRate} (extend-later, not replace-now)`)
    }
    return { recommendation: 'KEEP_AND_EXTEND_LATER', reasons, thresholds: REPLACEMENT_THRESHOLDS, triggered }
  }

  reasons.push('Current and multilingual coverage are acceptable; keep WR-TOKENIZER-0 as canonical.')
  return { recommendation: 'KEEP_WR_TOKENIZER_0', reasons, thresholds: REPLACEMENT_THRESHOLDS, triggered }
}
