/**
 * Area Live camera media — one viewer model for selected visual intelligence.
 * Catalog LIVE is never camera-image LIVE. Official-viewer-only providers never invent a still.
 */
import {
  TERRA_HANDOFF_ACTION,
  type TerraCouncilHandoffPayload,
} from '../councilHandoff'
import { TERRA_OFFICIAL_VIEWERS } from '../terraPublicIdentity'
import type { NearbyCameraLocationState, NearbyCameraProviderEnvelope } from './nearbyCameraCoverage'
import {
  cameraAgencyLabel,
  cameraProviderContractForId,
  cameraStillPolicyForProvider,
  type CameraStillPolicy,
} from './cameraFederation'
import { cameraInspectFreshness } from './cameraInspectFreshness'
import { cameraPreviewHref } from './trafficCamera'
import {
  resolveMediaPreview,
  validateYoutubeVideoId,
  youtubeMuteEmbedUrl,
  youtubeUnmuteEmbedUrl,
  type TerraLiveIntelMediaPreview,
} from '../liveIntelMedia'

export const AREA_LIVE_CATEGORIES = ['ALL', 'CAMERAS', 'VIDEO', 'MEDIA', 'EVENTS'] as const
export type AreaLiveCategory = (typeof AREA_LIVE_CATEGORIES)[number]

export const AREA_LIVE_CATEGORY_STATUS = {
  ALL: 'ACTIVE',
  CAMERAS: 'ACTIVE',
  MEDIA: 'ACTIVE',
  VIDEO: 'ACTIVE',
  EVENTS: 'ACTIVE',
} as const

export type AreaLiveCategoryStatus = (typeof AREA_LIVE_CATEGORY_STATUS)[AreaLiveCategory]

export const AREA_LIVE_MEDIA_KINDS = [
  'CAMERA_STILL',
  'CAMERA_STREAM',
  'YOUTUBE',
  'HLS',
  'OFFICIAL_EMBED',
  'POSTER_ONLY',
  'OFFICIAL_VIEWER',
  'UNAVAILABLE',
] as const
export type AreaLiveMediaKind = (typeof AREA_LIVE_MEDIA_KINDS)[number]

export type AreaLiveCameraFeature = {
  id: string
  title: string
  kind: string
  layerId?: string | null
  providerId?: string | null
  latitude: number
  longitude: number
  timestamp?: string | null
  properties: Record<string, unknown>
  provenance?: {
    sourceUrl?: string | null
    retrievedAt?: string | null
    fromCache?: boolean
    isHistorical?: boolean
  }
  rawReference?: { canonicalUrl?: string | null }
}

export type AreaLiveCameraMedia = {
  kind: AreaLiveMediaKind
  cameraId: string | null
  intelItemId: string | null
  name: string
  headline: string | null
  provider: string
  providerId: string | null
  agency: string
  road: string | null
  location: string | null
  latitude: number | null
  longitude: number | null
  catalogStatus: string
  catalogNote: string
  captureFreshness: string
  captureNote: string
  captureTimestamp: string | null
  retrievedAt: string | null
  sourceUrl: string | null
  stillHref: string | null
  streamHref: string | null
  youtubeVideoId: string | null
  hlsUrl: string | null
  embedUrl: string | null
  posterUrl: string | null
  officialViewerUrl: string | null
  stillPolicy: CameraStillPolicy
  imageUrlLawful: boolean
  originalLanguage: string | null
  englishHeadline: string | null
  verificationState: string | null
  publishedAt: string | null
}

export type AreaLiveMedia = AreaLiveCameraMedia

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function applyStillNonce(href: string, nonce: number | undefined): string {
  if (!nonce) return href
  const joiner = href.includes('?') ? '&' : '?'
  return `${href}${joiner}_=${nonce}`
}

function lawfulHttpsUrl(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? text : null
  } catch {
    return null
  }
}

function cameraStreamHref(feature: AreaLiveCameraFeature): string | null {
  const feedType = asString(feature.properties.feedType)?.toLowerCase()
  const explicit = lawfulHttpsUrl(asString(feature.properties.streamUrl))
    ?? lawfulHttpsUrl(asString(feature.properties.hlsUrl))
  if (explicit) return explicit
  if (feedType !== 'video' && feedType !== 'live_video' && feedType !== 'mjpeg' && feedType !== 'hls') return null
  return lawfulHttpsUrl(asString(feature.properties.feedUrl))
    ?? lawfulHttpsUrl(asString(feature.properties.videoUrl))
}

function emptyIntelFields(): Pick<AreaLiveCameraMedia, 'intelItemId' | 'headline' | 'streamHref' | 'youtubeVideoId' | 'hlsUrl' | 'embedUrl' | 'posterUrl' | 'originalLanguage' | 'englishHeadline' | 'verificationState' | 'publishedAt'> {
  return {
    intelItemId: null,
    headline: null,
    streamHref: null,
    youtubeVideoId: null,
    hlsUrl: null,
    embedUrl: null,
    posterUrl: null,
    originalLanguage: null,
    englishHeadline: null,
    verificationState: null,
    publishedAt: null,
  }
}

export function areaLiveCategoryStatus(category: AreaLiveCategory): AreaLiveCategoryStatus {
  return AREA_LIVE_CATEGORY_STATUS[category]
}

export function buildAreaLiveOfficialViewerMedia(input: {
  locationState?: NearbyCameraLocationState | null
  coveringProviders?: readonly NearbyCameraProviderEnvelope[]
  origin?: { latitude: number; longitude: number; label?: string } | null
}): AreaLiveCameraMedia | null {
  const covering = input.coveringProviders ?? []
  const official = covering.find(row => row.endpointType === 'OFFICIAL_VIEWER' && row.viewerUrl)
  const locationState = input.locationState ?? null
  if (!official && locationState !== 'PROVIDER_AUTH_REQUIRED' && locationState !== 'PARTIAL') return null
  const providerId = official?.id ?? covering[0]?.id ?? '511ny'
  const contract = cameraProviderContractForId(providerId)
  const viewerUrl = official?.viewerUrl ?? contract?.viewerUrl ?? (providerId === '511ny' || providerId === 'ny511_cameras' ? TERRA_OFFICIAL_VIEWERS.ny511 : null)
  if (!viewerUrl) return null
  return {
    kind: 'OFFICIAL_VIEWER',
    cameraId: null,
    name: contract?.displayName ?? official?.agency ?? 'Official camera viewer',
    provider: contract?.displayName ?? official?.agency ?? providerId,
    providerId,
    agency: contract?.agency ?? official?.agency ?? providerId,
    road: null,
    location: input.origin?.label ?? null,
    latitude: input.origin?.latitude ?? null,
    longitude: input.origin?.longitude ?? null,
    catalogStatus: locationState === 'PROVIDER_AUTH_REQUIRED' ? 'PROVIDER_AUTH_REQUIRED / PARTIAL' : (contract?.catalogLabel ?? 'PARTIAL'),
    catalogNote: 'No redistributable still. Official viewer only.',
    captureFreshness: 'UNKNOWN',
    captureNote: 'No camera still is available without inventing a feed.',
    captureTimestamp: null,
    retrievedAt: null,
    sourceUrl: viewerUrl,
    stillHref: null,
    officialViewerUrl: viewerUrl,
    stillPolicy: contract?.stillPolicy ?? 'official_viewer_only',
    imageUrlLawful: false,
    ...emptyIntelFields(),
  }
}

export function buildAreaLiveCameraMedia(input: {
  feature?: AreaLiveCameraFeature | null
  stillNonce?: number
  locationState?: NearbyCameraLocationState | null
  coveringProviders?: readonly NearbyCameraProviderEnvelope[]
  origin?: { latitude: number; longitude: number; label?: string } | null
}): AreaLiveCameraMedia | null {
  const feature = input.feature
  if (!feature || feature.kind !== 'traffic_camera') {
    return buildAreaLiveOfficialViewerMedia(input)
  }

  const providerId = feature.providerId ?? asString(feature.properties.providerId)
  const layerId = feature.layerId ?? asString(feature.properties.layerId)
  const fromProvider = cameraStillPolicyForProvider(providerId)
  const fromLayer = cameraStillPolicyForProvider(layerId)
  const policy = fromProvider !== 'jpeg' ? fromProvider : fromLayer
  const contract = cameraProviderContractForId(providerId) ?? cameraProviderContractForId(layerId)
  const inspect = cameraInspectFreshness(feature)
  const captureTimestamp = asString(feature.properties.capturedAt)
    ?? asString(feature.properties.lastModified)
    ?? asString(feature.properties.measuredTimeIso)
  const sourceUrl = feature.rawReference?.canonicalUrl
    ?? feature.provenance?.sourceUrl
    ?? asString(feature.properties.sourceUrl)
    ?? asString(feature.properties.viewerUrl)
    ?? contract?.sourceUrl
    ?? null
  const preview = cameraPreviewHref({ providerId, properties: feature.properties })
  const viewerOnly = policy === 'official_viewer_only' || policy === 'html_viewer' || preview.kind === 'html_viewer'
  const stillHref = !viewerOnly && preview.kind === 'still' && preview.href
    ? applyStillNonce(preview.href, input.stillNonce)
    : null
  const officialViewerUrl = viewerOnly
    ? (preview.kind === 'html_viewer' ? preview.href : null) ?? asString(feature.properties.viewerUrl) ?? contract?.viewerUrl ?? sourceUrl
    : asString(feature.properties.viewerUrl) ?? contract?.viewerUrl
  const streamHref = viewerOnly ? null : cameraStreamHref(feature)
  const kind: AreaLiveMediaKind = streamHref
    ? 'CAMERA_STREAM'
    : stillHref
      ? 'CAMERA_STILL'
      : officialViewerUrl
        ? 'OFFICIAL_VIEWER'
        : 'UNAVAILABLE'

  return {
    kind,
    cameraId: feature.id,
    name: feature.title,
    provider: contract?.displayName ?? cameraAgencyLabel(providerId ?? '') ?? providerId ?? 'unknown',
    providerId: providerId ?? null,
    agency: contract?.agency ?? cameraAgencyLabel(providerId ?? '') ?? providerId ?? 'unknown',
    road: asString(feature.properties.road),
    location: asString(feature.properties.locationName) ?? asString(feature.properties.location),
    latitude: feature.latitude,
    longitude: feature.longitude,
    catalogStatus: inspect.catalogStatus,
    catalogNote: inspect.catalogNote,
    captureFreshness: inspect.imageFreshness,
    captureNote: inspect.imageNote,
    captureTimestamp,
    retrievedAt: feature.provenance?.retrievedAt ?? asString(feature.properties.retrievedAt),
    sourceUrl,
    stillHref,
    officialViewerUrl: officialViewerUrl ?? null,
    stillPolicy: policy,
    imageUrlLawful: Boolean(stillHref) && !viewerOnly,
    ...emptyIntelFields(),
    streamHref,
  }
}

export function areaLiveObservedFacts(media: AreaLiveCameraMedia): string {
  return [
    'LAYER: Observed Data',
    `MEDIA TYPE: ${media.kind}`,
    `CAMERA ID: ${media.cameraId ?? 'none'}`,
    media.intelItemId ? `INTEL ITEM ID: ${media.intelItemId}` : null,
    `PROVIDER: ${media.provider}`,
    `AGENCY: ${media.agency}`,
    `LOCATION: ${media.location ?? media.road ?? media.name}`,
    `ROAD: ${media.road ?? 'not reported'}`,
    `COORDINATES: ${media.latitude != null && media.longitude != null ? `${media.latitude.toFixed(5)}, ${media.longitude.toFixed(5)}` : 'not reported'}`,
    `SOURCE: ${media.sourceUrl ?? media.officialViewerUrl ?? 'none'}`,
    `IMAGE URL: ${media.imageUrlLawful && media.stillHref ? media.stillHref : 'none'}`,
    media.streamHref ? `STREAM URL: ${media.streamHref}` : null,
    media.youtubeVideoId ? `YOUTUBE VIDEO ID: ${media.youtubeVideoId}` : null,
    media.hlsUrl ? `HLS URL: ${media.hlsUrl}` : null,
    media.embedUrl ? `EMBED URL: ${media.embedUrl}` : null,
    media.verificationState ? `VERIFICATION: ${media.verificationState}` : null,
    `CATALOG STATUS: ${media.catalogStatus}`,
    `CAPTURE FRESHNESS: ${media.captureFreshness}`,
    `CAPTURE TIME: ${media.captureTimestamp ?? 'UNKNOWN'}`,
    `RETRIEVAL TIME: ${media.retrievedAt ?? 'UNKNOWN'}`,
    `STILL POLICY: ${media.stillPolicy}`,
    'COUNCIL ANALYSIS: not included — Observed Data only',
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function canSendAreaLiveToCouncil(media: AreaLiveCameraMedia | null | undefined): boolean {
  if (!media) return false
  if (media.latitude != null && media.longitude != null) return true
  if (media.sourceUrl || media.officialViewerUrl || media.youtubeVideoId || media.embedUrl) return true
  return false
}

export type AreaLiveIntelSource = {
  id: string
  headline: string
  originalHeadline?: string
  englishHeadline?: string | null
  source: string
  provider: string
  sourceUrl: string | null
  location: string | null
  lat: number | null
  lon: number | null
  originalLanguage: string | null
  verificationState: string | null
  timestamp: string | null
  retrievedAt: string
  category?: string | null
  locationRelevance?: string | null
  freshnessState?: string | null
  freshnessLabel?: string | null
  mediaPreview?: TerraLiveIntelMediaPreview | null
}

export function buildAreaLiveIntelMedia(item: AreaLiveIntelSource): AreaLiveCameraMedia {
  const preview = resolveMediaPreview(item.mediaPreview)
  const youtubeVideoId = preview.type === 'YT_MUTE_EMBED' ? validateYoutubeVideoId(preview.youtubeVideoId) : null
  const hlsUrl = preview.type === 'HLS_MUTE' ? lawfulHttpsUrl(preview.previewUrl) : null
  const embedUrl = preview.type === 'OFFICIAL_EMBED' ? lawfulHttpsUrl(preview.previewUrl) : null
  const posterUrl = lawfulHttpsUrl(preview.posterUrl) ?? (youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg` : null)
  const kind: AreaLiveMediaKind = youtubeVideoId
    ? 'YOUTUBE'
    : hlsUrl
      ? 'HLS'
      : embedUrl
        ? 'OFFICIAL_EMBED'
        : posterUrl
          ? 'POSTER_ONLY'
          : 'POSTER_ONLY'
  return {
    kind,
    cameraId: null,
    intelItemId: item.id,
    name: item.originalHeadline || item.headline,
    headline: item.headline,
    provider: item.provider || item.source,
    providerId: item.provider || null,
    agency: item.source,
    road: null,
    location: item.location,
    latitude: item.lat,
    longitude: item.lon,
    catalogStatus: item.verificationState ?? 'VERIFIED_FEED',
    catalogNote: 'Live Intel / local media. Camera federation is a separate backend.',
    captureFreshness: 'UNKNOWN',
    captureNote: youtubeVideoId || hlsUrl || embedUrl
      ? 'Playable media comes from verified provider/feed evidence only.'
      : 'No verified playable video. Poster or headline only — no stream is invented.',
    captureTimestamp: item.timestamp,
    retrievedAt: item.retrievedAt,
    sourceUrl: item.sourceUrl,
    stillHref: null,
    streamHref: null,
    youtubeVideoId,
    hlsUrl,
    embedUrl: youtubeVideoId ? youtubeMuteEmbedUrl(youtubeVideoId) : embedUrl,
    posterUrl,
    officialViewerUrl: null,
    stillPolicy: 'official_viewer_only',
    imageUrlLawful: false,
    originalLanguage: item.originalLanguage,
    englishHeadline: item.englishHeadline ?? null,
    verificationState: item.verificationState,
    publishedAt: item.timestamp,
  }
}

export function isAreaLivePlayableVideo(kind: AreaLiveMediaKind): boolean {
  return kind === 'CAMERA_STREAM' || kind === 'YOUTUBE' || kind === 'HLS' || kind === 'OFFICIAL_EMBED'
}

/** Expand/hover/view never make Area Live audible. Only Commander Play. */
export function areaLiveCommanderAudible(commanderPlay: boolean): boolean {
  return commanderPlay === true
}

export function areaLiveYoutubeIframeSrc(videoId: string, commanderPlay: boolean): string {
  return areaLiveCommanderAudible(commanderPlay) ? youtubeUnmuteEmbedUrl(videoId) : youtubeMuteEmbedUrl(videoId)
}

export function areaLiveNativeVideoMuted(commanderPlay: boolean): boolean {
  return !areaLiveCommanderAudible(commanderPlay)
}

export function buildAreaLiveCouncilHandoff(media: AreaLiveCameraMedia, commanderPrompt?: string): TerraCouncilHandoffPayload | null {
  if (!canSendAreaLiveToCouncil(media)) return null
  const handedOffAt = new Date().toISOString()
  const isIntel = Boolean(media.intelItemId)
  const prompt = commanderPrompt?.trim()
    || (isIntel
      ? 'Preserve this Terra Area Live media item as Observed Data only. Do not invent a video, camera, or unobserved fact.'
      : 'Preserve this Terra Area Live camera as Observed Data only. Do not invent a still, stream, capture time, or unobserved fact.')
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt: prompt,
    lineage: {
      objectId: media.cameraId ?? media.intelItemId ?? `area-live-${media.providerId ?? 'source'}`,
      layer: 'other',
      type: isIntel ? 'news' : 'traffic_camera',
      title: media.name,
      provider: media.providerId ?? media.provider,
      evidenceId: media.cameraId ?? media.intelItemId,
      sourceUrl: media.sourceUrl ?? media.officialViewerUrl ?? (media.youtubeVideoId ? `https://www.youtube.com/watch?v=${media.youtubeVideoId}` : null),
      latitude: media.latitude,
      longitude: media.longitude,
      coordinateOrigin: 'observed',
      freshness: media.catalogStatus === 'LIVE'
        ? 'LIVE'
        : media.catalogStatus.includes('PROVIDER_AUTH')
          ? 'AUTH_REQUIRED'
          : media.catalogStatus === 'PARTIAL'
            ? 'PARTIAL'
            : 'UNAVAILABLE',
      observedAt: media.captureTimestamp,
      receivedAt: media.retrievedAt ?? handedOffAt,
      handedOffAt,
      sourceFamily: isIntel ? 'news' : 'traffic_camera',
      country: null,
      region: null,
      jurisdiction: media.agency,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts: areaLiveObservedFacts(media),
  }
}
