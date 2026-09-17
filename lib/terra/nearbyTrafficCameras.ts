/**
 * Local nearby-camera index. Filters an already-fetched, already-normalized camera list by
 * lat/lon + radius on the War Room side. The Commander's precise location is never sent to a
 * camera provider — providers only ever see a bounding-box query (or a whole-jurisdiction list
 * that we filter here).
 */
import type { TerraTrafficCameraRecord } from './trafficCameraRecord'

const EARTH_RADIUS_KM = 6371

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export type NearbyTrafficCameraHit = TerraTrafficCameraRecord & { distanceKm: number }

export function findNearbyTrafficCameras(
  cameras: TerraTrafficCameraRecord[],
  origin: { lat: number; lon: number },
  radiusKm: number,
): NearbyTrafficCameraHit[] {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return []
  }
  const hits: NearbyTrafficCameraHit[] = []
  for (const camera of cameras) {
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) continue
    const distanceKm = haversineDistanceKm(origin.lat, origin.lon, camera.lat, camera.lon)
    if (distanceKm <= radiusKm) hits.push({ ...camera, distanceKm })
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm)
  return hits
}

/** Bounding box that covers a radius around a point — used only to filter a local index, never
 * forwarded to a provider as a user-location leak. */
export function radiusToBoundingBox(origin: { lat: number; lon: number }, radiusKm: number): { west: number; south: number; east: number; north: number } | null {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return null
  }
  const latDelta = radiusKm / 111
  const lonDelta = radiusKm / (111 * Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180)))
  return {
    west: origin.lon - lonDelta,
    south: origin.lat - latDelta,
    east: origin.lon + lonDelta,
    north: origin.lat + latDelta,
  }
}
