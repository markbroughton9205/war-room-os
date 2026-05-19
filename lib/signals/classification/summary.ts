import { compactDisplayWhitespace, formatDisplayText, toDisplayText } from '@/lib/council/toDisplayText'
import type { IntelligenceCategory, IntelligenceOperationalClass, IntelligenceSeverity } from './types'

function compact(value: unknown, limit = 320): string {
  return compactDisplayWhitespace(value, limit)
}

export function buildCanonicalSummary(input: {
  intelligenceCategory: IntelligenceCategory
  operationalClass: IntelligenceOperationalClass
  intelligenceSeverity: IntelligenceSeverity
  sourceLabel: string
  provider: string
  rawHeadline: string
  evidenceSummary: string
  classificationConfidence: number
  sourceCredibilityScore: number
  truthLabel: string
  contradictionPeerCount: number
}): string {
  const categoryLabel = formatDisplayText(input.intelligenceCategory, category => category.replace(/_/g, ' '))
  const classNote = input.operationalClass === 'CONFLICTED'
    ? `Conflicting source narratives detected (${input.contradictionPeerCount} peer signal(s)); do not treat as settled fact.`
    : input.operationalClass === 'ACTIONABLE'
      ? 'Meets bounded freshness and credibility thresholds for operator review (not autonomous action).'
      : input.operationalClass === 'WATCHLIST'
        ? 'Monitor only; evidence is thin, unverified, or awaiting corroboration.'
        : 'Archival context only; not suitable for operator action surfaces.'

  return compact([
    `[${categoryLabel.toUpperCase()} · ${input.intelligenceSeverity} · ${input.operationalClass}]`,
    `Source: ${input.sourceLabel} (${input.provider}, truth=${input.truthLabel}).`,
    `Headline evidence: "${toDisplayText(input.rawHeadline)}".`,
    toDisplayText(input.evidenceSummary),
    classNote,
    `Classification confidence ${input.classificationConfidence}% (credibility ${input.sourceCredibilityScore}%).`,
    'Council should use this summary, not the raw headline alone, and retain approval gating before any external action.',
  ].join(' '))
}
