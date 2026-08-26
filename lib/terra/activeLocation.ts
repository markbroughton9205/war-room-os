export type TerraLocationResolutionStatus = 'resolving' | 'resolved' | 'coordinate_only'
export type TerraLocationConfidence = 'provider_supported' | 'coordinate_only'

/** One semantic location context shared by Terra UI, typed commands, and future Council adapters. */
export type TerraActiveLocation = {
  latitude: number
  longitude: number
  height: number | null
  hasTerrainHeight: boolean
  label: string
  place: string | null
  address: string | null
  region: string | null
  source: 'coordinates' | 'nominatim'
  sourceLabel: 'Commander-selected coordinates' | 'OpenStreetMap Nominatim'
  sourceUrl: string | null
  status: TerraLocationResolutionStatus
  confidence: TerraLocationConfidence
  detail: string
  selectedAt: string
}

export type TerraReverseLocationResolution =
  | { status: 'resolved'; location: TerraActiveLocation }
  | { status: 'coordinate_only'; location: TerraActiveLocation }
