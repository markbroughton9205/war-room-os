/**
 * Click → Info foundation — one compact inspect model across feature classes.
 * Immediate card first; async enrich later. Street View is never required for map picking.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'
import type { GodsEyeProvenanceRecord } from './provenance'

export const GODS_EYE_INSPECT_FEATURE_CLASSES = [
  'building',
  'road',
  'traffic_signal',
  'street_camera',
  'marker_event',
  'aircraft',
  'vessel',
  'ground',
  'street_image',
] as const
export type GodsEyeInspectFeatureClass = (typeof GODS_EYE_INSPECT_FEATURE_CLASSES)[number]

export const GODS_EYE_INSPECT_SECTIONS = [
  'IDENTITY',
  'LOCATION',
  'URBAN',
  'MOBILITY',
  'STREET',
  'LIVE_INTEL',
  'PROVENANCE',
] as const
export type GodsEyeInspectSectionId = (typeof GODS_EYE_INSPECT_SECTIONS)[number]

export type GodsEyeInspectField = {
  label: string
  value: string
  honesty?: string
}

export type GodsEyeInspectCardModel = {
  featureClass: GodsEyeInspectFeatureClass
  title: string
  identity: string
  latitude: number | null
  longitude: number | null
  source: string
  localTime: string | null
  timeZone: string | null
  coverageState: GodsEyeLayerTruthState
  pinned: boolean
  sections: Partial<Record<GodsEyeInspectSectionId, GodsEyeInspectField[]>>
  provenance: GodsEyeProvenanceRecord
  asyncEnrichPending: boolean
  enrichError: string | null
  preview?: { kind: 'still' | 'html_viewer' | 'none'; href: string | null }
}

export function inspectFeatureLabel(featureClass: GodsEyeInspectFeatureClass): string {
  const labels: Record<GodsEyeInspectFeatureClass, string> = {
    building: 'BUILDING',
    road: 'ROAD',
    traffic_signal: 'TRAFFIC SIGNAL',
    street_camera: 'TRAFFIC CAMERA',
    marker_event: 'LIVE INTEL',
    aircraft: 'AIRCRAFT',
    vessel: 'VESSEL',
    ground: 'TERRAIN',
    street_image: 'STREET IMAGE',
  }
  return labels[featureClass]
}
