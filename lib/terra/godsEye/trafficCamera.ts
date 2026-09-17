/**
 * Provider-neutral public traffic-camera model.
 * No private-camera integrations. No scraping of restricted feeds.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'

export const TRAFFIC_CAMERA_FEED_TYPES = ['still', 'video', 'unknown'] as const
export type TrafficCameraFeedType = (typeof TRAFFIC_CAMERA_FEED_TYPES)[number]

export type TerraTrafficCamera = {
  id: string
  location: string | null
  latitude: number
  longitude: number
  direction: string | null
  agency: string
  feedType: TrafficCameraFeedType
  feedUrl: string | null
  imageUrl: string | null
  lastUpdated: string | null
  coverageState: GodsEyeLayerTruthState
  freshnessState: GodsEyeLayerTruthState
  sourceUrl: string | null
}

export function emptyTrafficCameraCoverage(): {
  coverageState: 'PARTIAL'
  coverageScope: 'REGIONAL'
  coverageDetail: 'REGIONAL / AGENCY_DEPENDENT'
  honesty: string
} {
  return {
    coverageState: 'PARTIAL',
    coverageScope: 'REGIONAL',
    coverageDetail: 'REGIONAL / AGENCY_DEPENDENT',
    honesty: 'Public agency stills exist regionally (OHGO / Ohio, Caltrans / California, Fintraffic / Finland, Ontario 511, Hong Kong TD, Québec 511). 511NY is PROVIDER_AUTH_REQUIRED / PARTIAL until a developer key is present — that is not Commander AUTH_REQUIRED. Not global. Outside those envelopes: NO_COVERAGE. No private cameras.',
  }
}

export function cameraPreviewHref(feature: { providerId?: string | null; properties: Record<string, unknown> }): { kind: 'still' | 'html_viewer' | 'none'; href: string | null } {
  if (feature.providerId === 'ontario_511_cameras' && typeof feature.properties.viewId === 'string') {
    return { kind: 'still', href: `/api/terra/camera-image?provider=ontario_511_cameras&id=${encodeURIComponent(feature.properties.viewId)}` }
  }
  if (feature.providerId === 'hong_kong_td_cameras' && typeof feature.properties.cameraId === 'string') {
    return { kind: 'still', href: `/api/terra/camera-image?provider=hong_kong_td_cameras&id=${encodeURIComponent(feature.properties.cameraId)}` }
  }
  if (feature.providerId === 'ohgo_cameras') {
    if (typeof feature.properties.imagePath === 'string') {
      return { kind: 'still', href: `/api/terra/camera-image?provider=ohgo_cameras&id=${encodeURIComponent(feature.properties.imagePath)}` }
    }
    if (typeof feature.properties.cameraId === 'string') {
      return { kind: 'still', href: `/api/terra/camera-image?provider=ohgo_cameras&id=${encodeURIComponent(feature.properties.cameraId)}` }
    }
  }
  if (feature.providerId === 'caltrans_cctv') {
    if (typeof feature.properties.imagePath === 'string') {
      return { kind: 'still', href: `/api/terra/camera-image?provider=caltrans_cctv&id=${encodeURIComponent(feature.properties.imagePath)}` }
    }
    if (typeof feature.properties.cameraId === 'string') {
      return { kind: 'still', href: `/api/terra/camera-image?provider=caltrans_cctv&id=${encodeURIComponent(feature.properties.cameraId)}` }
    }
  }
  if (feature.providerId === 'digitraffic_road_cameras' && typeof feature.properties.imageUrl === 'string') {
    return { kind: 'still', href: feature.properties.imageUrl }
  }
  if (typeof feature.properties.viewerUrl === 'string') {
    return { kind: 'html_viewer', href: feature.properties.viewerUrl }
  }
  return { kind: 'none', href: null }
}

export function trafficCameraFromPublicAgency(input: {
  id: string
  location?: string | null
  latitude: number
  longitude: number
  direction?: string | null
  agency: string
  feedType?: TrafficCameraFeedType
  feedUrl?: string | null
  imageUrl?: string | null
  lastUpdated?: string | null
  coverageState: GodsEyeLayerTruthState
  freshnessState: GodsEyeLayerTruthState
  sourceUrl?: string | null
}): TerraTrafficCamera {
  return {
    id: input.id,
    location: input.location ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    direction: input.direction ?? null,
    agency: input.agency,
    feedType: input.feedType ?? 'still',
    feedUrl: input.feedUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    lastUpdated: input.lastUpdated ?? null,
    coverageState: input.coverageState,
    freshnessState: input.freshnessState,
    sourceUrl: input.sourceUrl ?? null,
  }
}
