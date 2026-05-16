import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { classifyCommunitySignal } from '@/lib/intelligence/local/communitySignalClassifier'

export type LocalContradiction = {
  kind: 'official_vs_chatter' | 'narrative_direction' | 'incident_status' | 'locality_mismatch'
  evidenceIds: string[]
  summary: string
}

const INCIDENT_ACTIVE = /\bactive|ongoing|happening\s+now|breaking|live|just\s+happened\b/i
const INCIDENT_RESOLVED = /\bcleared|resolved|no\s+threat|false\s+alarm|reopened|all\s+clear\b/i
const POSITIVE_DIRECTION = /\bimproving|down|decreasing|safer|reopened|resolved\b/i
const NEGATIVE_DIRECTION = /\bworse|surging|up|increasing|unsafe|closed|spiking\b/i

function isOfficial(item: IntelligenceEvidenceItem): boolean {
  return item.verified_level === 'verified' || /government|municipal|public\s+safety|alerts?|DOT|official/i.test(item.source_label)
}

export function scanLocalContradictions(evidence: IntelligenceEvidenceItem[]): LocalContradiction[] {
  const out: LocalContradiction[] = []

  for (let i = 0; i < evidence.length; i++) {
    const a = evidence[i]!
    const aSignal = classifyCommunitySignal(a)
    for (let j = i + 1; j < evidence.length; j++) {
      const b = evidence[j]!
      const bSignal = classifyCommunitySignal(b)
      if (aSignal.kind !== 'unknown' && bSignal.kind !== 'unknown' && aSignal.kind !== bSignal.kind) continue
      const pairTextA = `${a.title} ${a.claim}`
      const pairTextB = `${b.title} ${b.claim}`

      if (isOfficial(a) !== isOfficial(b) && (aSignal.rumorRisk || bSignal.rumorRisk)) {
        out.push({
          kind: 'official_vs_chatter',
          evidenceIds: [a.id, b.id],
          summary: 'Official/structured source and local chatter are discussing a similar topic with different confidence levels.',
        })
      }
      if (INCIDENT_ACTIVE.test(pairTextA) && INCIDENT_RESOLVED.test(pairTextB) || INCIDENT_RESOLVED.test(pairTextA) && INCIDENT_ACTIVE.test(pairTextB)) {
        out.push({
          kind: 'incident_status',
          evidenceIds: [a.id, b.id],
          summary: 'Local incident status appears unresolved across sources.',
        })
      }
      if (POSITIVE_DIRECTION.test(pairTextA) && NEGATIVE_DIRECTION.test(pairTextB) || NEGATIVE_DIRECTION.test(pairTextA) && POSITIVE_DIRECTION.test(pairTextB)) {
        out.push({
          kind: 'narrative_direction',
          evidenceIds: [a.id, b.id],
          summary: 'Local narrative direction conflicts across evidence.',
        })
      }
    }
  }

  return out.slice(0, 12)
}
