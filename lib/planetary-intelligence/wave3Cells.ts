import type { CoverageCell, EvidenceClass, PlanetaryGeography, PlanetaryTopic, SourceClass } from './types'
import { WAVE3_ACADEMIC_WINDOW_HOURS, WAVE3_DEFAULT_WINDOW_HOURS } from './registryTypes'

export type Wave3PriorityCell = {
  gapKey: string
  geography: PlanetaryGeography
  topic: PlanetaryTopic
  language: string
  sourceType: SourceClass
  evidenceQuality: EvidenceClass
  windowHours: number
}

export const WAVE3_PRIORITY_CELLS: Wave3PriorityCell[] = [
  { gapKey: 'ja-infra', geography: 'EAST_ASIA', topic: 'INFRASTRUCTURE', language: 'ja', sourceType: 'OFFICIAL_RECORD', evidenceQuality: 'PRIMARY_EVIDENCE', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'sw-health', geography: 'EAST_AFRICA', topic: 'HEALTH', language: 'sw', sourceType: 'COMMUNITY_SOURCE', evidenceQuality: 'LOCAL_REPORTING', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'id-infra', geography: 'SOUTHEAST_ASIA', topic: 'INFRASTRUCTURE', language: 'id', sourceType: 'JOURNALISM', evidenceQuality: 'LOCAL_REPORTING', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'ar-safety', geography: 'MIDDLE_EAST', topic: 'PUBLIC_SAFETY', language: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', evidenceQuality: 'ALERT', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'de-energy', geography: 'EUROPE', topic: 'ENERGY', language: 'de', sourceType: 'TRADE_SOURCE', evidenceQuality: 'TECHNICAL_DOCUMENT', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'es-science', geography: 'LATIN_AMERICA', topic: 'SCIENCE', language: 'es', sourceType: 'SCIENTIFIC_SOURCE', evidenceQuality: 'RESEARCH_PAPER', windowHours: WAVE3_ACADEMIC_WINDOW_HOURS },
  { gapKey: 'hi-econ', geography: 'SOUTH_ASIA', topic: 'ECONOMICS', language: 'hi', sourceType: 'JOURNALISM', evidenceQuality: 'REGIONAL_REPORTING', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
  { gapKey: 'oceania-weather', geography: 'OCEANIA', topic: 'WEATHER', language: 'en', sourceType: 'ALERT_FEED', evidenceQuality: 'ALERT', windowHours: WAVE3_DEFAULT_WINDOW_HOURS },
]

export function cellLabel(cell: Pick<Wave3PriorityCell, 'geography' | 'topic' | 'language' | 'sourceType'>): string {
  return `${cell.geography} × ${cell.topic} × ${cell.language} × ${cell.sourceType}`
}

export function toCoverageFacet(cell: Wave3PriorityCell): Pick<CoverageCell, 'geography' | 'topic' | 'language' | 'sourceType'> {
  return { geography: cell.geography, topic: cell.topic, language: cell.language, sourceType: cell.sourceType }
}
