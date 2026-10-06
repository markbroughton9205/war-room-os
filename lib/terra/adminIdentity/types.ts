import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import type { LayerMode } from '@/lib/terra/layerGovernor/types'
import type { TerraActiveLocation } from '@/lib/terra/activeLocation'

export const ADMIN_HIERARCHY_LEVELS = ['COUNTRY', 'STATE', 'COUNTY', 'CITY'] as const
export type AdminHierarchyLevel = (typeof ADMIN_HIERARCHY_LEVELS)[number]

export const ADMIN_FEATURE_KINDS = ['country', 'state', 'county', 'place'] as const
export type AdminFeatureKind = (typeof ADMIN_FEATURE_KINDS)[number]

export const ADMIN_SUBLAYER_IDS = ['countryBorders', 'stateBorders', 'placeNames', 'identityFlag'] as const
export type AdminSublayerId = (typeof ADMIN_SUBLAYER_IDS)[number]

export const ADMIN_IDENTITY_STORAGE_KEY = 'terra.adminIdentity.v1'

export type AdminFlagOfficialStatus = 'official' | 'unofficial' | 'unknown'

export type AdminSourceProvenance = {
  id: string
  name: string
  license: string
  licenseUrl: string
  homepage: string
  version: string
  notes: string
}

export type AdminFlagAsset = {
  territoryId: string
  territoryName: string
  kind: 'country' | 'state'
  isoCode: string
  fileName: string
  publicPath: string
  source: string
  sourceUrl: string
  license: string
  version: string
  officialStatus: AdminFlagOfficialStatus
}

export type AdminHierarchy = {
  country: string | null
  countryCode: string | null
  state: string | null
  stateCode: string | null
  county: string | null
  city: string | null
  emphasized: AdminHierarchyLevel | null
  source: 'active_location' | 'browse_camera' | 'none'
  browseMode: boolean
}

export type AdminSublayerModes = Record<AdminSublayerId, LayerMode>

export type AdminIdentityPrefs = {
  subModes: AdminSublayerModes
  flagOpacityOverride: number | null
}

export type AdminIdentityPresentation = {
  viewBand: TerraViewBand
  layerEffective: 'ACTIVE' | 'DIMMED' | 'HIDDEN'
  countryBorderOpacity: number
  stateBorderOpacity: number
  countyBorderOpacity: number
  countryLabelOpacity: number
  stateLabelOpacity: number
  cityLabelOpacity: number
  countryFlagOpacity: number
  stateFlagOpacity: number
  countryBorderWidth: number
  stateBorderWidth: number
  countyBorderWidth: number
  countryLabelCap: number
  stateLabelCap: number
  cityLabelCap: number
  countryLod: 'major' | 'all' | 'active' | 'none'
  stateLod: 'begin' | 'primary' | 'active' | 'none'
  countyLod: 'active' | 'none'
  flagTarget: { kind: 'country' | 'state'; isoCode: string; name: string } | null
  transitionMs: number
  reason: string
  hierarchy: AdminHierarchy
}

export type AdminCompactFeature = {
  id: string
  name: string
  kind: AdminFeatureKind
  iso2: string | null
  iso3: string | null
  iso3166_2: string | null
  adm0: string | null
  labelRank: number | null
  disputed: boolean
  disputeNote: string | null
  lon: number
  lat: number
  bbox: [number, number, number, number]
  rings: number[][][]
}

export type AdminCompactCollection = {
  name: string
  provenanceId: string
  version: string
  license: string
  featureCount: number
  features: AdminCompactFeature[]
}

export type AdminViewport = {
  west: number
  south: number
  east: number
  north: number
}

export type AdminIdentityInput = {
  viewBand: TerraViewBand
  heightMeters: number
  activeLocation: Pick<
    TerraActiveLocation,
    'country' | 'countryCode' | 'state' | 'county' | 'city' | 'place' | 'label' | 'contextType' | 'latitude' | 'longitude'
  > | null
  selectedLocation?: Pick<TerraActiveLocation, 'country' | 'countryCode' | 'state' | 'county' | 'city' | 'place' | 'label'> | null
  currentTask: string
  masterHidden: boolean
  subModes: AdminSublayerModes
  flagOpacityOverride: number | null
  browseMode?: boolean
}
