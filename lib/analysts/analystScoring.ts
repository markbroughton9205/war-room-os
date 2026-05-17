export type AnalystScoreBand = 'low' | 'medium' | 'high' | 'critical'

export type AnalystScore = {
  label: string
  value: number
  band: AnalystScoreBand
  rationale: string
}

export type AnalystScoringSummary = {
  confidence: AnalystScore
  opportunity: AnalystScore
  operationalImpact: AnalystScore
  volatilityRisk: AnalystScore
  sourceReliability: AnalystScore
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function scoreBand(value: number): AnalystScoreBand {
  if (value >= 80) return 'high'
  if (value >= 55) return 'medium'
  if (value >= 30) return 'low'
  return 'critical'
}

export function riskBand(value: number): AnalystScoreBand {
  if (value >= 75) return 'critical'
  if (value >= 55) return 'high'
  if (value >= 30) return 'medium'
  return 'low'
}

function score(label: string, value: number, rationale: string, risk = false): AnalystScore {
  const normalized = clampScore(value)
  return {
    label,
    value: normalized,
    band: risk ? riskBand(normalized) : scoreBand(normalized),
    rationale,
  }
}

function keywordScore(text: string, patterns: RegExp[], weight: number): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? weight : 0), 0)
}

export function buildConfidenceScore(text: string, dataGapCount: number): AnalystScore {
  const t = text.toLowerCase()
  const evidenceSignal = keywordScore(t, [/\bdata\b/, /\bmetric/, /\bkpi\b/, /\bcompare\b/, /\bhistorical\b/, /\boutcome\b/], 6)
  const uncertaintyPenalty = Math.min(28, dataGapCount * 7)
  return score(
    'Confidence',
    58 + evidenceSignal - uncertaintyPenalty,
    dataGapCount
      ? 'Confidence is moderated by unresolved data gaps and unknown source freshness.'
      : 'Confidence reflects explicit analysis language and available operational context.',
  )
}

export function buildOpportunityScore(text: string): AnalystScore {
  const t = text.toLowerCase()
  const upside = keywordScore(t, [/\bopportunit/, /\brevenue\b/, /\bmarket\b/, /\bgrowth\b/, /\bsales\b/], 8)
  const execution = keywordScore(t, [/\bworkflow\b/, /\bimprove\b/, /\boptimi[sz]e\b/, /\bperformance\b/], 5)
  const drag = keywordScore(t, [/\brisk\b/, /\bblocked?\b/, /\bfail/, /\banomal/], 5)
  return score(
    'Opportunity',
    46 + upside + execution - drag,
    'Opportunity score estimates upside after considering execution friction and known risk terms.',
  )
}

export function buildOperationalImpactScore(text: string): AnalystScore {
  const t = text.toLowerCase()
  const impact = keywordScore(t, [/\boperations?\b/, /\bbottleneck/, /\blatency\b/, /\bprovider\b/, /\brepair\b/, /\bretrieval\b/, /\bapproval\b/], 7)
  return score(
    'Operational Impact',
    50 + impact,
    'Operational impact emphasizes throughput, reliability, provider behavior, approval flow, and repair pressure.',
  )
}

export function buildVolatilityRiskScore(text: string, anomalyCount: number): AnalystScore {
  const t = text.toLowerCase()
  const riskSignals = keywordScore(t, [/\brisk\b/, /\bvolatile\b/, /\bfail/, /\bunknown\b/, /\banomal/, /\bmarket\b/, /\bnews\b/], 7)
  return score(
    'Volatility/Risk',
    24 + riskSignals + anomalyCount * 8,
    'Risk score rises with anomaly, failure, volatility, market, and unknown signals.',
    true,
  )
}

export function buildSourceReliabilityScore(text: string, dataGapCount: number): AnalystScore {
  const t = text.toLowerCase()
  const sourceSignals = keywordScore(t, [/\bsource/, /\bevidence\b/, /\bretrieval\b/, /\bverified\b/, /\bruntime truth\b/], 8)
  return score(
    'Source Reliability',
    52 + sourceSignals - dataGapCount * 6,
    'Source reliability is a readiness score; live claims still require retrieval before evidence-backed synthesis.',
  )
}

export function buildAnalystScoringSummary(input: {
  text: string
  dataGapCount: number
  anomalyCount: number
}): AnalystScoringSummary {
  return {
    confidence: buildConfidenceScore(input.text, input.dataGapCount),
    opportunity: buildOpportunityScore(input.text),
    operationalImpact: buildOperationalImpactScore(input.text),
    volatilityRisk: buildVolatilityRiskScore(input.text, input.anomalyCount),
    sourceReliability: buildSourceReliabilityScore(input.text, input.dataGapCount),
  }
}

export function heatIndicator(scoreValue: number): 'cool' | 'watch' | 'hot' {
  if (scoreValue >= 75) return 'hot'
  if (scoreValue >= 45) return 'watch'
  return 'cool'
}
