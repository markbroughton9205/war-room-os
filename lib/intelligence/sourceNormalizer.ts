import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import { detectWeakSignal } from '@/lib/intelligence/signalDetection'
import type {
  EvidenceFreshness,
  IntelligenceEvidenceItem,
} from '@/lib/intelligence/intelligencePacket'
import {
  getIntelligenceSource,
  type IntelligenceSourceDefinition,
  type IntelligenceSourceType,
  type SourceFailureBehavior,
  type SourceVerifiedLevel,
} from '@/lib/intelligence/sourceRegistry'

export type RawIntelligenceFinding = {
  title?: unknown
  url?: string
  content: unknown
  observed_at?: string
  score?: number
}

export type RawIntelligenceSourceRecord = {
  source_id: string
  ok: boolean
  queried_at: string
  findings: RawIntelligenceFinding[]
  error?: string
  failure_behavior?: SourceFailureBehavior
}

function fallbackSource(sourceId: string): IntelligenceSourceDefinition {
  return {
    source_id: sourceId,
    label: sourceId,
    category: 'emerging_weak_signal',
    source_type: 'rumor_feed',
    capabilities: ['weak_signal_detection'],
    verified_level: 'unverified',
    freshness_window: 'unknown',
    reliability_score: 0.15,
    cost_level: 'free',
    configured: false,
    allowed_use_cases: ['weak_signal_detection'],
    rate_limits: null,
    failure_behavior: 'skip',
  }
}

function freshnessFromObservedAt(observedAt: string | undefined, nowIso: string): EvidenceFreshness {
  if (!observedAt) return 'unknown'
  const observed = Date.parse(observedAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return 'unknown'
  const ageMs = Math.max(0, now - observed)
  const hour = 60 * 60 * 1000
  if (ageMs <= hour) return 'live'
  if (ageMs <= 48 * hour) return 'recent'
  if (ageMs <= 30 * 24 * hour) return 'aging'
  return 'stale'
}

function evidenceDensity(text: unknown): number {
  const clean = compactDisplayWhitespace(text)
  if (!clean) return 0
  const urlBonus = /https?:\/\//i.test(clean) ? 0.1 : 0
  const numberBonus = /\b\d+(?:\.\d+)?%?\b/.test(clean) ? 0.12 : 0
  const properNounBonus = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/.test(clean) ? 0.08 : 0
  return Math.min(1, clean.length / 900 + urlBonus + numberBonus + properNounBonus)
}

function claimFromFinding(finding: RawIntelligenceFinding): string {
  const title = toDisplayText(finding.title)
  const content = compactDisplayWhitespace(finding.content)
  if (title && content) return `${title}: ${content.slice(0, 360)}`
  if (title) return title
  return content.slice(0, 420) || 'Source returned an empty finding.'
}

export function normalizeSourceEvidence(
  rawSources: RawIntelligenceSourceRecord[],
  nowIso: string,
): IntelligenceEvidenceItem[] {
  const items: IntelligenceEvidenceItem[] = []

  for (const record of rawSources) {
    if (!record.ok) continue
    const source = getIntelligenceSource(record.source_id) ?? fallbackSource(record.source_id)
    record.findings.forEach((finding, index) => {
      const title = toDisplayText(finding.title) || source.label
      const content = compactDisplayWhitespace(finding.content)
      if (!content && !title) return
      const signal = detectWeakSignal({ source, title, content })
      const freshness = freshnessFromObservedAt(finding.observed_at ?? record.queried_at, nowIso)
      items.push({
        id: `${record.source_id}-${index + 1}`,
        source_id: source.source_id,
        source_type: source.source_type as IntelligenceSourceType,
        source_label: source.label,
        verified_level: source.verified_level as SourceVerifiedLevel,
        title,
        ...(finding.url ? { url: finding.url } : {}),
        claim: claimFromFinding(finding),
        content,
        observed_at: finding.observed_at ?? record.queried_at,
        confidence: 0,
        confidence_tier: 'unsupported',
        corroboration_count: 0,
        freshness,
        source_reputation: source.reliability_score,
        contradiction_flags: signal.reasons.filter(reason => reason.startsWith('text:')),
        evidence_density: evidenceDensity(content || title),
        related_evidence_links: [],
        weak_signal: signal.weakSignal,
      })
    })
  }

  return items
}
