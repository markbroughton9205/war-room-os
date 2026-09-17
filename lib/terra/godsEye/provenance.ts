/**
 * God's Eye provenance layers — never blend these kinds of truth.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'

export const GODS_EYE_PROVENANCE_LAYERS = [
  'SOURCE_DATA',
  'MODEL_OBSERVATION',
  'INFERENCE',
  'COMMANDER_NOTES',
  'COUNCIL_ANALYSIS',
] as const
export type GodsEyeProvenanceLayer = (typeof GODS_EYE_PROVENANCE_LAYERS)[number]

export type GodsEyeProvenanceRecord = {
  layer: GodsEyeProvenanceLayer
  source: string
  provider: string
  retrievedAt: string | null
  coverageState: GodsEyeLayerTruthState
  freshnessState: GodsEyeLayerTruthState
  sourceUrl: string | null
  license: string | null
}

export function sourceDataProvenance(input: {
  source: string
  provider: string
  retrievedAt?: string | null
  coverageState: GodsEyeLayerTruthState
  freshnessState?: GodsEyeLayerTruthState
  sourceUrl?: string | null
  license?: string | null
}): GodsEyeProvenanceRecord {
  return {
    layer: 'SOURCE_DATA',
    source: input.source,
    provider: input.provider,
    retrievedAt: input.retrievedAt ?? null,
    coverageState: input.coverageState,
    freshnessState: input.freshnessState ?? input.coverageState,
    sourceUrl: input.sourceUrl ?? null,
    license: input.license ?? null,
  }
}

export function modelObservationProvenance(input: {
  source: string
  provider: string
  retrievedAt?: string | null
  sourceUrl?: string | null
  license?: string | null
}): GodsEyeProvenanceRecord {
  return {
    layer: 'MODEL_OBSERVATION',
    source: input.source,
    provider: input.provider,
    retrievedAt: input.retrievedAt ?? null,
    coverageState: 'PARTIAL',
    freshnessState: 'PARTIAL',
    sourceUrl: input.sourceUrl ?? null,
    license: input.license ?? null,
  }
}
