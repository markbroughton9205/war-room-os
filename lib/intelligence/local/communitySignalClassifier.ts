import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

export type CommunitySignalKind =
  | 'crime_incident'
  | 'infrastructure_complaint'
  | 'economic_stress'
  | 'neighborhood_development'
  | 'policing_discussion'
  | 'business_opening_closure'
  | 'local_opportunity'
  | 'public_concern'
  | 'unknown'

export type CommunitySignalClassification = {
  kind: CommunitySignalKind
  weakSignal: boolean
  rumorRisk: boolean
  manipulationRisk: 'low' | 'medium' | 'high'
  localityMentioned: boolean
  reasons: string[]
}

const KIND_PATTERNS: { kind: CommunitySignalKind; patterns: RegExp[] }[] = [
  { kind: 'crime_incident', patterns: [/\bcrime|shooting|robbery|stolen|break[-\s]?in|assault|police|sirens?\b/i] },
  { kind: 'infrastructure_complaint', patterns: [/\bpothole|road\s+closure|water\s+main|power\s+outage|trash|traffic|bridge|construction\b/i] },
  { kind: 'economic_stress', patterns: [/\brent|eviction|layoff|unemployment|prices?|inflation|food\s+bank|utility\s+bills?\b/i] },
  { kind: 'neighborhood_development', patterns: [/\bdevelopment|zoning|permit|housing|apartment|renovation|demolition\b/i] },
  { kind: 'policing_discussion', patterns: [/\bpolicing|police|sheriff|patrol|arrest|bodycam|public\s+safety\b/i] },
  { kind: 'business_opening_closure', patterns: [/\bopened|opening|closed|closure|shut\s+down|grand\s+opening|restaurant|storefront\b/i] },
  { kind: 'local_opportunity', patterns: [/\bhiring|job\s+fair|grant|vendor|market|paid|contract|small\s+business\b/i] },
  { kind: 'public_concern', patterns: [/\bconcern|complaint|meeting|hearing|petition|neighbors?|community\b/i] },
]

const RUMOR_PATTERNS = [
  /\bheard\b/i,
  /\brumou?r\b/i,
  /\bunconfirmed\b/i,
  /\bscanner\b/i,
  /\bpeople\s+are\s+saying\b/i,
  /\banyone\s+know\b/i,
]

const LOCALITY_PATTERNS = [
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Drive|Dr)\b/,
  /\b(?:downtown|north|south|east|west)\s+[A-Z][a-z]+\b/,
  /\bAkron|Cleveland|Summit\s+County|Cuyahoga|Ohio\b/i,
  /\bneighborhood|nearby|local|city|county\b/i,
]

export function classifyCommunitySignal(item: IntelligenceEvidenceItem): CommunitySignalClassification {
  const text = `${item.title} ${item.claim} ${item.content}`
  const reasons: string[] = []
  let kind: CommunitySignalKind = 'unknown'
  for (const candidate of KIND_PATTERNS) {
    if (candidate.patterns.some(pattern => pattern.test(text))) {
      kind = candidate.kind
      reasons.push(`kind:${candidate.kind}`)
      break
    }
  }

  const rumorRisk = RUMOR_PATTERNS.some(pattern => pattern.test(text)) || item.weak_signal
  if (rumorRisk) reasons.push('rumor_or_unconfirmed_language')
  const localityMentioned = LOCALITY_PATTERNS.some(pattern => pattern.test(text))
  if (localityMentioned) reasons.push('locality_mentioned')

  const manipulationRisk =
    item.source_reputation < 0.3 || /\bguaranteed|secret|cover[-\s]?up|they\s+don'?t\s+want\b/i.test(text)
      ? 'high'
      : rumorRisk
        ? 'medium'
        : 'low'

  return {
    kind,
    weakSignal: item.weak_signal || rumorRisk || item.confidence_tier === 'weak_signal',
    rumorRisk,
    manipulationRisk,
    localityMentioned,
    reasons,
  }
}
