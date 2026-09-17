/**
 * Provider-neutral street-object detections.
 * Visual detection is never verified infrastructure truth.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'
import type { GodsEyeProvenanceRecord } from './provenance'

export const STREET_OBJECT_CLASSES = [
  'building',
  'road',
  'lane',
  'sidewalk',
  'traffic_light',
  'traffic_sign',
  'crosswalk',
  'vehicle',
  'pedestrian',
  'bicycle',
  'bus',
  'truck',
  'street_furniture',
  'vegetation',
  'utility_pole',
  'other',
] as const
export type StreetObjectClass = (typeof STREET_OBJECT_CLASSES)[number]

export const STREET_OBJECT_TRUTH = 'OBSERVED_BY_MODEL' as const

export type StreetObjectDetection = {
  class: StreetObjectClass
  confidence: number | null
  imageSource: string
  model: string
  modelVersion: string
  timestamp: string
  latitude: number | null
  longitude: number | null
  truth: typeof STREET_OBJECT_TRUTH
  coverageState: GodsEyeLayerTruthState
  provenance: GodsEyeProvenanceRecord
}

export function isVerifiedInfrastructure(_detection: StreetObjectDetection): false {
  return false
}

export function streetObjectFromModel(input: {
  class: StreetObjectClass
  confidence?: number | null
  imageSource: string
  model: string
  modelVersion: string
  timestamp: string
  latitude?: number | null
  longitude?: number | null
  provenance: GodsEyeProvenanceRecord
}): StreetObjectDetection {
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? input.confidence : null
  return {
    class: input.class,
    confidence,
    imageSource: input.imageSource,
    model: input.model,
    modelVersion: input.modelVersion,
    timestamp: input.timestamp,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    truth: STREET_OBJECT_TRUTH,
    coverageState: 'PARTIAL',
    provenance: input.provenance,
  }
}
