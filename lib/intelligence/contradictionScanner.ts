import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

const CONTRADICTION_PAIRS: [RegExp, RegExp, string][] = [
  [/\bincreasing|rising|surging|up\b/i, /\bdecreasing|falling|dropping|down\b/i, 'directional_conflict'],
  [/\bsafe|stable|secure|sufficient\b/i, /\bunsafe|unstable|insecure|shortage|running\s+out\b/i, 'safety_or_supply_conflict'],
  [/\bconfirmed|official|verified\b/i, /\bunconfirmed|rumou?r|alleged|unsupported\b/i, 'verification_status_conflict'],
  [/\bopen|available|accepting|hiring\b/i, /\bclosed|unavailable|not\s+hiring|paused\b/i, 'availability_conflict'],
]

function normalizedSubject(item: IntelligenceEvidenceItem): string {
  return item.claim
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 4)
    .slice(0, 10)
    .join(' ')
}

function overlaps(a: string, b: string): boolean {
  const aa = new Set(a.split(/\s+/).filter(Boolean))
  const bb = b.split(/\s+/).filter(Boolean)
  return bb.filter(word => aa.has(word)).length >= 2
}

export function scanContradictions(evidence: IntelligenceEvidenceItem[]): IntelligenceEvidenceItem[] {
  return evidence.map(item => ({ ...item, contradiction_flags: [...item.contradiction_flags] })).map((item, index, all) => {
    const subject = normalizedSubject(item)
    for (let j = 0; j < all.length; j++) {
      if (j === index) continue
      const other = all[j]!
      if (item.source_id === other.source_id) continue
      if (!overlaps(subject, normalizedSubject(other))) continue
      for (const [positive, negative, label] of CONTRADICTION_PAIRS) {
        const a = item.claim
        const b = other.claim
        const conflict = positive.test(a) && negative.test(b) || negative.test(a) && positive.test(b)
        if (conflict && !item.contradiction_flags.includes(label)) {
          item.contradiction_flags.push(label)
          if (!item.related_evidence_links.includes(other.id)) item.related_evidence_links.push(other.id)
        }
      }
    }
    return item
  })
}
