import { WAVE3_PRIORITY_CELLS, cellLabel, toCoverageFacet, type Wave3PriorityCell } from './wave3Cells'

export type Wave4PriorityCell = Wave3PriorityCell
export type GapKind =
  | 'DISCOVERY_GAP'
  | 'PARSER_GAP'
  | 'CLASSIFIER_GAP'
  | 'SOURCE_CLASS_GAP'
  | 'LANGUAGE_GAP'
  | 'GEOGRAPHY_GAP'
  | 'TOPIC_GAP'
  | 'FRESHNESS_GAP'

export const WAVE4_PRIORITY_CELLS: Wave4PriorityCell[] = WAVE3_PRIORITY_CELLS
export const WAVE4_CLOSURE_CELLS: Wave4PriorityCell[] = WAVE3_PRIORITY_CELLS.filter(cell => cell.gapKey !== 'hi-econ')

export { cellLabel, toCoverageFacet }

export function diagnoseGapKinds(input: {
  liveEndpoints: number
  observedDocuments: number
  qualifying: number
  languageMatched: number
  geographyMatched: number
  topicMatched: number
  sourceClassMatched: number
  freshnessFailedNear: boolean
}): GapKind[] {
  const kinds = new Set<GapKind>()
  if (input.qualifying > 0) return []
  if (input.liveEndpoints === 0 && input.observedDocuments === 0) kinds.add('DISCOVERY_GAP')
  if (input.liveEndpoints > 0 && input.observedDocuments === 0) kinds.add('PARSER_GAP')
  if (input.observedDocuments > 0 && input.sourceClassMatched === 0) kinds.add('SOURCE_CLASS_GAP')
  if (input.observedDocuments > 0 && input.languageMatched === 0) kinds.add('LANGUAGE_GAP')
  if (input.observedDocuments > 0 && input.geographyMatched === 0) kinds.add('GEOGRAPHY_GAP')
  if (input.observedDocuments > 0 && input.topicMatched === 0) kinds.add('TOPIC_GAP')
  if (input.freshnessFailedNear) kinds.add('FRESHNESS_GAP')
  if (input.liveEndpoints > 0 && input.observedDocuments > 0 && (input.languageMatched > 0 || input.topicMatched === 0 || input.sourceClassMatched === 0)) {
    kinds.add('CLASSIFIER_GAP')
  }
  if (kinds.size === 0) kinds.add('DISCOVERY_GAP')
  return [...kinds]
}
