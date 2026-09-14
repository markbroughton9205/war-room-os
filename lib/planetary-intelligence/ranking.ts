import type { RetrievedDocument } from './types'

const LOCALITY_RANK = [
  'local emergency authority',
  'direct institution/operator',
  'local reporter',
  'local TV/newspaper',
  'regional reporting',
  'state/provincial authority',
  'national original reporting',
  'international interpretation',
] as const

export type LocalFirstScore = {
  documentId: string
  score: number
  reasons: string[]
  localityRank: number
}

function localityRank(doc: RetrievedDocument): number {
  const blob = `${doc.outlet} ${doc.publisher} ${doc.sourceClass} ${doc.evidenceClass} ${doc.title}`.toLowerCase()
  if (doc.evidenceClass === 'ALERT' || /emergency|police|fire|nws|civil defence|civil defense/.test(blob)) return 0
  if (doc.evidenceClass === 'OFFICIAL_STATEMENT' || doc.sourceClass === 'GOVERNMENT' || doc.sourceClass === 'OFFICIAL_RECORD') return 1
  if (doc.evidenceClass === 'LOCAL_REPORTING' || doc.sourceClass === 'COMMUNITY_SOURCE') return 2
  if (/tv|gazette|herald|times|post/.test(blob) && doc.evidenceClass === 'REGIONAL_REPORTING') return 3
  if (doc.evidenceClass === 'REGIONAL_REPORTING') return 4
  if (doc.sourceClass === 'REGULATOR') return 5
  if (doc.evidenceClass === 'PRIMARY_EVIDENCE') return 6
  return 7
}

/**
 * For geographically specific events:
 * QUALITY → ORIGINALITY → PROXIMITY → PRIMARY EVIDENCE → RELIABILITY → RECENCY → INDEPENDENCE → RELEVANCE
 * LOCAL != AUTOMATICALLY RELIABLE.
 */
export function scoreLocalFirst(doc: RetrievedDocument, eventGeography: string | null): LocalFirstScore {
  const reasons: string[] = []
  let score = 0.35
  const rank = localityRank(doc)
  score += (7 - rank) * 0.07
  reasons.push(LOCALITY_RANK[rank] ?? 'international interpretation')
  if (doc.evidenceClass === 'PRIMARY_EVIDENCE' || doc.evidenceClass === 'OFFICIAL_STATEMENT') {
    score += 0.16
    reasons.push('primary evidence')
  }
  if (doc.independentOriginId && !doc.independentOriginId.includes('wire')) {
    score += 0.12
    reasons.push('independent origin')
  } else {
    score -= 0.08
    reasons.push('syndication/international interpretation penalty')
  }
  if (eventGeography && doc.geography && eventGeography === doc.geography) {
    score += 0.14
    reasons.push('geographic proximity')
  }
  if (doc.publishedAt) {
    score += 0.06
    reasons.push('recency present')
  }
  if (doc.promptInjectionDetected) {
    score = 0
    reasons.push('untrusted injection — excluded from ranking influence')
  }
  return { documentId: doc.documentId, score: Math.max(0, Math.min(1, score)), reasons, localityRank: rank }
}

export function rankLocalFirst(documents: RetrievedDocument[], eventGeography: string | null): RetrievedDocument[] {
  return [...documents].sort((a, b) => scoreLocalFirst(b, eventGeography).score - scoreLocalFirst(a, eventGeography).score)
}
