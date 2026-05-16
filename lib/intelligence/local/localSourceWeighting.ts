import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { LocalSourceDefinition, LocalityDepth } from '@/lib/intelligence/local/localSourceRegistry'
import { getLocalSource } from '@/lib/intelligence/local/localSourceRegistry'

const LOCALITY_WEIGHT: Record<LocalityDepth, number> = {
  none: 0,
  regional: 0.3,
  city: 0.58,
  neighborhood: 0.8,
  street_or_venue: 1,
}

export type LocalSourceWeight = {
  sourceId: string
  sourceDepth: 'verified_structured' | 'emerging_hyperlocal' | 'general'
  localityDepth: LocalityDepth
  weight: number
  configured: boolean
  source?: LocalSourceDefinition
}

function inferLocalityDepth(item: IntelligenceEvidenceItem): LocalityDepth {
  const text = `${item.title} ${item.claim} ${item.content}`
  if (/\b(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Drive|Dr)\b/.test(text)) return 'street_or_venue'
  if (/\bneighborhood|ward|district|downtown|northside|westside|eastside|southside\b/i.test(text)) return 'neighborhood'
  if (/\bAkron|Cleveland|Summit\s+County|city|county|local\b/i.test(text)) return 'city'
  if (/\bOhio|Northeast\s+Ohio|regional\b/i.test(text)) return 'regional'
  return 'none'
}

export function weightLocalSource(item: IntelligenceEvidenceItem): LocalSourceWeight {
  const local = getLocalSource(item.source_id)
  const localityDepth = local?.locality_depth ?? inferLocalityDepth(item)
  const sourceDepth = local?.category ?? (localityDepth === 'none' ? 'general' : 'emerging_hyperlocal')
  const configured = local?.configured ?? true
  const reliability = local?.reliability_score ?? item.source_reputation
  const manipulationPenalty = local?.manipulation_risk === 'high' ? 0.18 : local?.manipulation_risk === 'medium' ? 0.08 : 0
  const weight = Math.max(
    0,
    Math.min(1, reliability * 0.52 + LOCALITY_WEIGHT[localityDepth] * 0.32 + item.confidence * 0.16 - manipulationPenalty),
  )

  return {
    sourceId: item.source_id,
    sourceDepth,
    localityDepth,
    weight,
    configured,
    ...(local ? { source: local } : {}),
  }
}

export function strongestLocalityDepth(depths: LocalityDepth[]): LocalityDepth {
  const order: LocalityDepth[] = ['none', 'regional', 'city', 'neighborhood', 'street_or_venue']
  return depths.reduce((best, depth) => (order.indexOf(depth) > order.indexOf(best) ? depth : best), 'none')
}
