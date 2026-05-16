import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { IntelligenceSourceDefinition } from '@/lib/intelligence/sourceRegistry'

const WEAK_SIGNAL_TERMS = [
  /\brumou?r\b/i,
  /\bunconfirmed\b/i,
  /\bpeople\s+are\s+saying\b/i,
  /\bchatter\b/i,
  /\btrend(?:ing)?\b/i,
  /\bearly\s+signal\b/i,
  /\bthread\b/i,
  /\bsubreddit\b/i,
  /\bviral\b/i,
]

export type WeakSignalAssessment = {
  weakSignal: boolean
  reasons: string[]
}

export function detectWeakSignal(input: {
  source: IntelligenceSourceDefinition
  title?: string
  content?: string
}): WeakSignalAssessment {
  const text = `${input.title ?? ''} ${input.content ?? ''}`
  const reasons: string[] = []
  if (input.source.category === 'emerging_weak_signal') reasons.push('emerging_source_category')
  if (input.source.verified_level === 'unverified') reasons.push('source_unverified')
  for (const pattern of WEAK_SIGNAL_TERMS) {
    if (pattern.test(text)) {
      reasons.push(`text:${pattern.source.slice(0, 28)}`)
      break
    }
  }
  return { weakSignal: reasons.length > 0, reasons }
}

export function summarizeWeakSignals(evidence: IntelligenceEvidenceItem[]): string[] {
  return evidence
    .filter(item => item.weak_signal)
    .map(item => `${item.source_id}: ${item.claim}`)
    .slice(0, 8)
}
