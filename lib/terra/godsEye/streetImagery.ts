/**
 * Street Intelligence — MapillaryJS viewport synchronized with Terra.
 *
 * Conceptual providers:
 *   A. MAPILLARY_HOSTED — provider terms apply; client token required (STREAM_ONLY)
 *   B. PANORAMAX — open/self-host instance (SELF_HOSTABLE, LOCAL/REGIONAL)
 *   C. WAR_ROOM_OWN — sovereign imagery path; no Mapillary account required
 *
 * Architecture works without hosted imagery. Do not scrape Google Street View.
 */
import { MAPILLARYJS_STATUS } from './openStack'
import type { GodsEyeLayerTruthState } from './coverageStates'
import { panoramaxProviderState } from './panoramax'

export const STREET_IMAGERY_PROVIDERS = ['MAPILLARY_HOSTED', 'PANORAMAX', 'WAR_ROOM_OWN'] as const
export type StreetImageryProviderId = (typeof STREET_IMAGERY_PROVIDERS)[number]

export const MAPILLARYJS_LICENSE = 'MIT'
export const MAPILLARY_HOSTED_IMAGERY_LICENSE = 'CC-BY-SA-4.0 (Mapillary contributor terms apply)'
export const MAPILLARYJS_SOURCE_URL = 'https://github.com/mapillary/mapillary-js'
export const MAPILLARY_DEVELOPER_URL = 'https://www.mapillary.com/dashboard/developers'

export type StreetImagePose = {
  latitude: number
  longitude: number
  bearingDeg: number | null
  capturedAt: string | null
  imageId: string | null
  imageUrl: string | null
  provider: StreetImageryProviderId
  coverageState: GodsEyeLayerTruthState
  sourceUrl: string | null
  attribution: string
}

export type StreetImageryProviderState = {
  id: StreetImageryProviderId
  label: string
  coverageState: GodsEyeLayerTruthState
  requiresToken: boolean
  tokenEnvName: string | null
  honesty: string
}

export type StreetWorldLink = {
  terraLatitude: number | null
  terraLongitude: number | null
  selectedPlace: string | null
  streetImage: StreetImagePose | null
  viewBearingDeg: number | null
  localTime: string | null
  nearbyIdentity: string | null
  buildingIdentityResolved: false
  honesty: string
}

export function mapillaryHostedConfigured(token: string | null | undefined): boolean {
  return Boolean(token && token.trim())
}

export function streetImageryProviderStates(
  token: string | null | undefined,
  panoramaxInstanceUrl?: string | null,
): StreetImageryProviderState[] {
  const hostedConfigured = mapillaryHostedConfigured(token)
  const panoramax = panoramaxProviderState(panoramaxInstanceUrl)
  return [
    {
      id: 'MAPILLARY_HOSTED',
      label: 'Mapillary hosted',
      coverageState: hostedConfigured ? 'PARTIAL' : 'AUTH_REQUIRED',
      requiresToken: true,
      tokenEnvName: 'NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN',
      honesty: hostedConfigured
        ? 'Mapillary hosted imagery may be requested inside the Street Intelligence panel. Provider terms apply. Coverage is wherever Mapillary contributors photographed — never claimed global. STREAM_ONLY.'
        : 'MapillaryJS is installed. Hosted imagery stays AUTH_REQUIRED until NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN is set. Viewer MIT ≠ hosted imagery terms. No Google Street View.',
    },
    {
      id: 'PANORAMAX',
      label: 'Panoramax',
      coverageState: panoramax.coverageState,
      requiresToken: false,
      tokenEnvName: 'NEXT_PUBLIC_PANORAMAX_INSTANCE_URL',
      honesty: panoramax.honesty,
    },
    {
      id: 'WAR_ROOM_OWN',
      label: 'War Room / own imagery',
      coverageState: 'NO_COVERAGE',
      requiresToken: false,
      tokenEnvName: null,
      honesty: 'Sovereign street-imagery path exists in the architecture. No own panoramic dataset is ingested this pass. NO_COVERAGE, not a fake panorama. OWNED when Commander captures are ingested.',
    },
  ]
}

export function streetWorldLinkFromPose(input: {
  terraLatitude: number | null
  terraLongitude: number | null
  selectedPlace: string | null
  pose: StreetImagePose | null
  localTime: string | null
  nearbyIdentity: string | null
}): StreetWorldLink {
  return {
    terraLatitude: input.terraLatitude,
    terraLongitude: input.terraLongitude,
    selectedPlace: input.selectedPlace,
    streetImage: input.pose,
    viewBearingDeg: input.pose?.bearingDeg ?? null,
    localTime: input.localTime,
    nearbyIdentity: input.nearbyIdentity,
    buildingIdentityResolved: false,
    honesty:
      'Street image selection maps back to Terra lat/lon, bearing, local time, and nearby sourced identity when those fields exist. Pixel-perfect building identity is not claimed unless actually resolved.',
  }
}

export function streetImageryStatus() {
  return {
    mapillaryJs: MAPILLARYJS_STATUS,
    hosted: 'AUTH_REQUIRED' as const,
    panoramax: 'EVALUATION_ACTIVE' as const,
    own: 'NO_COVERAGE' as const,
    replacesCesium: false,
  }
}
