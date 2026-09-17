/**
 * Nearby public traffic cameras from the already-loaded Terra layer index.
 * Does not send Commander GPS to unrelated providers. Image bytes are fetched only on inspect.
 */
import { cameraAgencyLabel } from './cameraFederation'

export type NearbyCameraIndexFeature = {
  id: string
  layerId: string
  kind: string
  title: string
  latitude: number
  longitude: number
  properties: Record<string, unknown>
  providerId?: string | null
}

export type NearbyPublicCamera = {
  id: string
  layerId: string
  title: string
  agency: string
  provider: string
  distanceKm: number
  road: string | null
  location: string | null
  direction: string | null
  freshness: string
  catalogStatus: 'LIVE' | 'CACHED'
  imageCaptureFreshness: 'AVAILABLE' | 'STALE' | 'OFFLINE' | 'UNKNOWN'
  feedState: 'AVAILABLE' | 'STALE' | 'OFFLINE' | 'UNAVAILABLE'
  latitude: number
  longitude: number
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLon * sinLon
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

function imageCaptureFreshnessFromSource(freshness: string | null | undefined): NearbyPublicCamera['imageCaptureFreshness'] {
  if (freshness === 'stale' || freshness === 'STALE') return 'STALE'
  if (freshness === 'offline' || freshness === 'OFFLINE') return 'OFFLINE'
  if (freshness === 'fresh' || freshness === 'LIVE' || freshness === 'still_image' || freshness === 'live_video' || freshness === 'AVAILABLE') return 'AVAILABLE'
  return 'UNKNOWN'
}

function feedStateFromFreshness(freshness: string | null | undefined): NearbyPublicCamera['feedState'] {
  const capture = imageCaptureFreshnessFromSource(freshness)
  if (capture === 'STALE') return 'STALE'
  if (capture === 'OFFLINE') return 'OFFLINE'
  if (capture === 'AVAILABLE') return 'AVAILABLE'
  return 'UNAVAILABLE'
}

export function nearbyPublicCameras(input: {
  latitude: number
  longitude: number
  features: readonly NearbyCameraIndexFeature[]
  maxResults?: number
  maxKm?: number
}): NearbyPublicCamera[] {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return []
  const maxResults = input.maxResults ?? 16
  const maxKm = input.maxKm ?? 40
  const ranked: NearbyPublicCamera[] = []
  for (const feature of input.features) {
    if (feature.kind !== 'traffic_camera') continue
    if (!Number.isFinite(feature.latitude) || !Number.isFinite(feature.longitude)) continue
    const distanceKm = haversineKm(input.latitude, input.longitude, feature.latitude, feature.longitude)
    if (distanceKm > maxKm) continue
    const freshness = typeof feature.properties.freshness === 'string' ? feature.properties.freshness : 'unknown'
    const agency = cameraAgencyLabel(feature.layerId) || cameraAgencyLabel(feature.providerId ?? '') || feature.layerId
    ranked.push({
      id: feature.id,
      layerId: feature.layerId,
      title: feature.title,
      agency,
      provider: typeof feature.providerId === 'string' && feature.providerId ? feature.providerId : feature.layerId,
      distanceKm,
      road: typeof feature.properties.road === 'string' ? feature.properties.road : null,
      location: typeof feature.properties.locationName === 'string' ? feature.properties.locationName : null,
      direction: typeof feature.properties.direction === 'string' ? feature.properties.direction : null,
      freshness,
      catalogStatus: 'LIVE',
      imageCaptureFreshness: imageCaptureFreshnessFromSource(freshness),
      feedState: feedStateFromFreshness(freshness),
      latitude: feature.latitude,
      longitude: feature.longitude,
    })
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm)
  const cap = Number.isFinite(maxResults) ? maxResults : ranked.length
  return ranked.slice(0, cap)
}

export function nearbyPublicCameraCount(input: {
  latitude: number
  longitude: number
  features: readonly NearbyCameraIndexFeature[]
  maxKm?: number
}): number {
  return nearbyPublicCameras({ ...input, maxResults: Number.POSITIVE_INFINITY }).length
}
