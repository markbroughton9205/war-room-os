import type { TerraGeoFeature } from '@/lib/terra/types'

const FEDERATED_STILL_PROVIDERS = new Set(['ohgo_cameras', 'ny511_cameras', 'caltrans_cwwp2_cameras'])

/** Resolve the still-image preview URL for a traffic camera. Viewer / video URLs are never
 * returned here — those stay Commander link-outs. */
export function resolveTerraTrafficCameraStillUrl(feature: TerraGeoFeature): string | null {
  if (feature.providerId === 'ontario_511_cameras' && typeof feature.properties.viewId === 'string') {
    return `/api/terra/camera-image?provider=ontario_511_cameras&id=${encodeURIComponent(feature.properties.viewId)}`
  }
  if (feature.providerId === 'hong_kong_td_cameras' && typeof feature.properties.cameraId === 'string') {
    return `/api/terra/camera-image?provider=hong_kong_td_cameras&id=${encodeURIComponent(feature.properties.cameraId)}`
  }
  if (FEDERATED_STILL_PROVIDERS.has(feature.providerId) && typeof feature.properties.cameraId === 'string') {
    return `/api/terra/camera-image?provider=${encodeURIComponent(feature.providerId)}&id=${encodeURIComponent(feature.properties.cameraId)}`
  }
  if (feature.providerId === 'digitraffic_road_cameras' && typeof feature.properties.imageUrl === 'string') {
    return feature.properties.imageUrl
  }
  return null
}

export function isHtmlViewerOnlyCamera(feature: TerraGeoFeature): boolean {
  return feature.properties.feedType === 'HTML_VIEWER' || feature.providerId === 'quebec_511_cameras'
}

export function viewerLinkLabel(feature: TerraGeoFeature): string {
  if (isHtmlViewerOnlyCamera(feature)) return 'View at source (HTML viewer)'
  if (feature.providerId === 'ny511_cameras') return 'Open video at source (link-out — not embedded)'
  if (feature.providerId === 'caltrans_cwwp2_cameras') return 'Open stream at source (link-out — not embedded)'
  return 'Open at source (link-out)'
}
