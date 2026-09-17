/**
 * Area Live presentation layer — one area workspace over camera federation + Live Intel.
 * Backends stay separate. Counts are never invented.
 */
import type { NearbyPublicCamera } from './nearbyCameras'
import type { NearbyCameraLocationState, NearbyCameraProviderEnvelope } from './nearbyCameraCoverage'
import {
  AREA_LIVE_CATEGORIES,
  buildAreaLiveIntelMedia,
  isAreaLivePlayableVideo,
  type AreaLiveCameraMedia,
  type AreaLiveCategory,
  type AreaLiveIntelSource,
  type AreaLiveMediaKind,
} from './areaLiveMedia'

export type AreaLiveCount = { known: true; value: number } | { known: false }

export type AreaLiveNearbyKind = 'CAMERA' | 'MEDIA' | 'VIDEO' | 'EVENT'

export type AreaLiveNearbyRow = {
  id: string
  kind: AreaLiveNearbyKind
  title: string
  subtitle: string
  distanceLabel: string | null
  category: Exclude<AreaLiveCategory, 'ALL'>
  latitude: number | null
  longitude: number | null
  media: AreaLiveCameraMedia | null
  cameraRef: { layerId: string; id: string } | null
  intelItemId: string | null
  verificationState: string | null
  publishedAt: string | null
  locationRelevance: string | null
  sourceUrl: string | null
}

export type AreaLiveWorkspace = {
  headerLabel: string
  locationLabel: string
  coverageState: string
  coveringLabel: string | null
  officialViewerUrl: string | null
  counts: {
    cameras: AreaLiveCount
    liveVideo: AreaLiveCount
    media: AreaLiveCount
    events: AreaLiveCount
  }
  rows: AreaLiveNearbyRow[]
}

const NEARBY_ROW_CAP = 40

export function formatAreaLiveCount(count: AreaLiveCount): string {
  return count.known ? String(count.value) : 'AVAILABLE'
}

export function formatAreaLiveHeader(placeLabel: string | null | undefined): string {
  const label = placeLabel?.trim()
  if (!label) return 'AREA LIVE · NO ACTIVE LOCATION'
  return `AREA LIVE · ${label.toUpperCase()}`
}

export function areaLiveCoverageTruth(state: NearbyCameraLocationState | string | null | undefined): string {
  if (!state) return 'UNAVAILABLE'
  if (state === 'NO_COVERAGE') return 'NO_VERIFIED_PROVIDER'
  if (state === 'AUTH_REQUIRED') return 'COMMANDER_AUTH_REQUIRED'
  return state
}

function formatMiles(distanceKm: number): string {
  const miles = distanceKm * 0.621371
  if (miles < 0.1) return `${Math.round(distanceKm * 1000)} m`
  return `${miles.toFixed(1)} mi`
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

function cameraRow(camera: NearbyPublicCamera): AreaLiveNearbyRow {
  return {
    id: `camera:${camera.layerId}:${camera.id}`,
    kind: 'CAMERA',
    title: camera.road || camera.title,
    subtitle: `${camera.agency} / ${camera.provider}`,
    distanceLabel: formatMiles(camera.distanceKm),
    category: 'CAMERAS',
    latitude: camera.latitude,
    longitude: camera.longitude,
    media: null,
    cameraRef: { layerId: camera.layerId, id: camera.id },
    intelItemId: null,
    verificationState: null,
    publishedAt: null,
    locationRelevance: camera.location ?? camera.road ?? null,
    sourceUrl: null,
  }
}

function intelRow(item: AreaLiveIntelSource, origin: { latitude: number; longitude: number } | null, category: 'MEDIA' | 'VIDEO' | 'EVENTS'): AreaLiveNearbyRow {
  const media = buildAreaLiveIntelMedia(item)
  const distanceLabel = origin && item.lat != null && item.lon != null && Number.isFinite(item.lat) && Number.isFinite(item.lon)
    ? formatMiles(haversineKm(origin.latitude, origin.longitude, item.lat, item.lon))
    : null
  return {
    id: `intel:${item.id}`,
    kind: category === 'EVENTS' ? 'EVENT' : (isAreaLivePlayableVideo(media.kind) ? 'VIDEO' : 'MEDIA'),
    title: item.headline,
    subtitle: item.freshnessState === 'STALE_LAST_GOOD' && item.freshnessLabel
      ? `${item.source} · ${item.freshnessLabel}`
      : item.source,
    distanceLabel,
    category,
    latitude: item.lat,
    longitude: item.lon,
    media,
    cameraRef: null,
    intelItemId: item.id,
    verificationState: item.verificationState ?? media.verificationState,
    publishedAt: item.timestamp ?? media.publishedAt,
    locationRelevance: item.locationRelevance ?? item.location ?? media.location,
    sourceUrl: item.sourceUrl ?? media.sourceUrl,
  }
}

export function composeAreaLiveWorkspace(input: {
  originLabel: string | null
  origin: { latitude: number; longitude: number } | null
  cameras: readonly NearbyPublicCamera[]
  cameraCount: number
  cameraIndexLoaded: boolean
  locationState: NearbyCameraLocationState | string | null
  coveringLabel: string | null
  coveringProviders?: readonly NearbyCameraProviderEnvelope[]
  officialViewerUrl?: string | null
  intelPending: boolean
  mediaItems: readonly AreaLiveIntelSource[]
  eventItems: readonly AreaLiveIntelSource[]
  filter: AreaLiveCategory
}): AreaLiveWorkspace {
  const headerLabel = formatAreaLiveHeader(input.originLabel)
  const cameraKnown = input.cameraIndexLoaded || input.cameraCount > 0
  const intelKnown = !input.intelPending
  const videoItems = input.mediaItems.filter(item => {
    const kind: AreaLiveMediaKind = buildAreaLiveIntelMedia(item).kind
    return isAreaLivePlayableVideo(kind)
  })
  const liveVideoValue = videoItems.length
  const storyItems = input.mediaItems.filter(item => !videoItems.some(video => video.id === item.id))

  const cameraRows = input.cameras.map(cameraRow)
  const videoRows = videoItems.map(item => intelRow(item, input.origin, 'VIDEO'))
  const mediaRows = storyItems.map(item => intelRow(item, input.origin, 'MEDIA'))
  const eventRows = input.eventItems.map(item => intelRow(item, input.origin, 'EVENTS'))

  let rows: AreaLiveNearbyRow[]
  if (input.filter === 'CAMERAS') rows = cameraRows
  else if (input.filter === 'VIDEO') rows = videoRows
  else if (input.filter === 'MEDIA') rows = mediaRows
  else if (input.filter === 'EVENTS') rows = eventRows
  else rows = [...cameraRows, ...videoRows, ...mediaRows, ...eventRows]

  return {
    headerLabel,
    locationLabel: input.originLabel?.trim() || 'No active Terra location',
    coverageState: areaLiveCoverageTruth(input.locationState),
    coveringLabel: input.coveringLabel,
    officialViewerUrl: input.officialViewerUrl ?? null,
    counts: {
      cameras: cameraKnown ? { known: true, value: input.cameraCount } : { known: false },
      liveVideo: intelKnown ? { known: true, value: liveVideoValue } : { known: false },
      media: intelKnown ? { known: true, value: input.mediaItems.length } : { known: false },
      events: intelKnown ? { known: true, value: input.eventItems.length } : { known: false },
    },
    rows: rows.slice(0, NEARBY_ROW_CAP),
  }
}

export { AREA_LIVE_CATEGORIES }

export function isAreaLiveLocalIntelItem(item: { category?: string | null }): boolean {
  return item.category === 'LOCAL'
}

