import { cameraPreviewHref } from './godsEye/trafficCamera'
import { TERRA_HANDOFF_ACTION, type TerraCouncilHandoffPayload } from './councilHandoff'

export const TERRA_TRAFFIC_CAMERA_TRANSPORTS = [
  'SNAPSHOT',
  'MJPEG',
  'HLS',
  'DASH',
  'EMBED',
  'LINK_OUT',
  'UNAVAILABLE',
] as const
export type TerraTrafficCameraTransport = (typeof TERRA_TRAFFIC_CAMERA_TRANSPORTS)[number]

export const TERRA_TRAFFIC_CAMERA_FRESHNESS = [
  'LIVE',
  'RECENT',
  'STALE',
  'OFFLINE',
  'NO_VIDEO',
  'AUTH_REQUIRED',
  'LICENSE_RESTRICTED',
  'RATE_LIMITED',
  'NO_DATA',
  'NO_COVERAGE',
  'UNKNOWN',
] as const
export type TerraTrafficCameraFreshness = (typeof TERRA_TRAFFIC_CAMERA_FRESHNESS)[number]

export type TerraTrafficCameraLicensePolicy = {
  commercialUseAllowed: boolean
  directDisplayAllowed: boolean
  proxyAllowed: boolean
  cacheAllowed: boolean
  maxCacheAgeSeconds: number
  archiveAllowed: boolean
  brandingRequired: boolean
  concurrentLimit: number
  sourceLinkRequired: boolean
}

export type TerraTrafficCamera = {
  id: string
  providerId: string
  providerName: string
  operator: string
  name: string
  latitude: number
  longitude: number
  transport: TerraTrafficCameraTransport
  mediaUrl: string | null
  sourceUrl: string | null
  observedAt: string | null
  fetchedAt: string | null
  expectedRefreshSeconds: number | null
  freshness: TerraTrafficCameraFreshness
  direction: string | null
  road: string | null
  jurisdiction: string | null
  attribution: string
  licensePolicy: TerraTrafficCameraLicensePolicy
}

const RESTRICTIVE_POLICY: TerraTrafficCameraLicensePolicy = {
  commercialUseAllowed: false,
  directDisplayAllowed: false,
  proxyAllowed: false,
  cacheAllowed: false,
  maxCacheAgeSeconds: 0,
  archiveAllowed: false,
  brandingRequired: true,
  concurrentLimit: 1,
  sourceLinkRequired: true,
}

function policy(overrides: Partial<TerraTrafficCameraLicensePolicy>): TerraTrafficCameraLicensePolicy {
  return { ...RESTRICTIVE_POLICY, ...overrides }
}

/**
 * Delivery permissions are explicit and conservative. An absent provider always inherits the
 * deny-by-default policy. These flags describe Terra delivery behavior, not ownership of a feed.
 */
const PROVIDER_POLICIES: Record<string, TerraTrafficCameraLicensePolicy> = {
  digitraffic_road_cameras: policy({
    commercialUseAllowed: true,
    directDisplayAllowed: true,
    proxyAllowed: true,
    cacheAllowed: true,
    maxCacheAgeSeconds: 60,
  }),
  ohgo: policy({ proxyAllowed: true, cacheAllowed: true, maxCacheAgeSeconds: 20 }),
  ohgo_cameras: policy({ proxyAllowed: true, cacheAllowed: true, maxCacheAgeSeconds: 20 }),
  caltrans: policy({ proxyAllowed: true, cacheAllowed: true, maxCacheAgeSeconds: 20 }),
  caltrans_cctv: policy({ proxyAllowed: true, cacheAllowed: true, maxCacheAgeSeconds: 20 }),
  hong_kong_td_cameras: policy({
    directDisplayAllowed: true,
    proxyAllowed: true,
    cacheAllowed: true,
    maxCacheAgeSeconds: 20,
  }),
  // Ontario's repository record says its terms were not independently confirmed.
  ontario_511_cameras: policy({}),
  // Québec exposes an official HTML viewer, not a redistributable direct image.
  quebec_511_cameras: policy({}),
  // The catalog API requires provider credentials; Terra may only link to the official viewer.
  '511ny': policy({}),
  ny511_cameras: policy({}),
}

const PROVIDER_MEDIA_HOSTS: Record<string, readonly string[]> = {
  digitraffic_road_cameras: ['weathercam.digitraffic.fi', 'tie.digitraffic.fi', 'www.digitraffic.fi'],
  ohgo: ['itscameras.dot.state.oh.us', 'publicapi.ohgo.com', 'ohgo.com', 'www.ohgo.com'],
  ohgo_cameras: ['itscameras.dot.state.oh.us', 'publicapi.ohgo.com', 'ohgo.com', 'www.ohgo.com'],
  caltrans: ['cwwp2.dot.ca.gov', 'dot.ca.gov'],
  caltrans_cctv: ['cwwp2.dot.ca.gov', 'dot.ca.gov'],
  ontario_511_cameras: ['511on.ca', 'www.511on.ca'],
  quebec_511_cameras: ['quebec511.info', 'www.quebec511.info', 'ws.mapserver.transports.gouv.qc.ca'],
  hong_kong_td_cameras: ['tdcctv.data.one.gov.hk', 'data.gov.hk', 'www.data.gov.hk'],
  '511ny': ['511ny.org', 'www.511ny.org'],
  ny511_cameras: ['511ny.org', 'www.511ny.org'],
}

export function validatedCameraMediaUrl(providerId: string, value: string | null | undefined): string | null {
  if (!value) return null
  if (value.startsWith('/api/terra/camera-image?')) return value
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
    const allowed = PROVIDER_MEDIA_HOSTS[providerId] ?? []
    return allowed.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function restrictiveCameraLicensePolicy(): TerraTrafficCameraLicensePolicy {
  return { ...RESTRICTIVE_POLICY }
}

export function cameraLicensePolicyForProvider(providerId: string | null | undefined): TerraTrafficCameraLicensePolicy {
  const configured = providerId ? PROVIDER_POLICIES[providerId] : undefined
  return { ...(configured ?? RESTRICTIVE_POLICY) }
}

export const FUTURE_CAMERA_AGGREGATORS = [
  { id: 'trafficland_class', status: 'LICENSE_REQUIRED' as const },
  { id: 'vizzion_class', status: 'NOT_CONFIGURED' as const },
] as const

type CameraFeatureInput = {
  id: string
  title: string
  providerId?: string | null
  layerId?: string | null
  latitude: number
  longitude: number
  timestamp?: string | null
  properties: Record<string, unknown>
  provenance?: {
    provider?: string
    sourceUrl?: string | null
    retrievedAt?: string | null
  }
  rawReference?: { canonicalUrl?: string | null }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function inferTransport(properties: Record<string, unknown>, hasStill: boolean, hasViewer: boolean): TerraTrafficCameraTransport {
  const explicit = text(properties.transport)?.toUpperCase()
  if (explicit && TERRA_TRAFFIC_CAMERA_TRANSPORTS.includes(explicit as TerraTrafficCameraTransport)) {
    return explicit as TerraTrafficCameraTransport
  }
  const feed = (text(properties.feedType) ?? '').toUpperCase()
  const media = text(properties.streamUrl) ?? text(properties.hlsUrl) ?? text(properties.dashUrl) ?? text(properties.feedUrl)
  if (feed.includes('MJPEG') || media?.toLowerCase().includes('mjpeg')) return 'MJPEG'
  if (feed.includes('DASH') || media?.toLowerCase().includes('.mpd')) return 'DASH'
  if (feed.includes('HLS') || media?.toLowerCase().includes('.m3u8')) return 'HLS'
  if (feed.includes('EMBED') || text(properties.embedUrl)) return 'EMBED'
  if (hasStill) return 'SNAPSHOT'
  if (hasViewer) return 'LINK_OUT'
  return 'UNAVAILABLE'
}

function inferFreshness(properties: Record<string, unknown>, coverage: string | null): TerraTrafficCameraFreshness {
  const value = (text(properties.freshnessState) ?? text(properties.imageFreshness) ?? text(properties.freshness) ?? '').toUpperCase()
  if (value === 'LIVE' || value === 'FRESH' || value === 'STILL_IMAGE' || value === 'LIVE_VIDEO' || value === 'AVAILABLE') return 'LIVE'
  if (value === 'RECENT' || value === 'CACHED') return 'RECENT'
  if (value === 'STALE' || value === 'STALE_LAST_GOOD') return 'STALE'
  if (value === 'OFFLINE' || value === 'UNAVAILABLE') return 'OFFLINE'
  if (value === 'AUTH_REQUIRED' || value === 'AUTH_FAIL') return 'AUTH_REQUIRED'
  if (value === 'LICENSE_RESTRICTED') return 'LICENSE_RESTRICTED'
  if (value === 'RATE_LIMITED') return 'RATE_LIMITED'
  if (value === 'NO_DATA' || value === 'NOT_CONFIGURED') return 'NO_DATA'
  if (value === 'NO_VIDEO') return 'NO_VIDEO'
  if (value === 'NO_COVERAGE' || coverage === 'NO_COVERAGE') return 'NO_COVERAGE'
  return 'UNKNOWN'
}

export function normalizeTerraTrafficCamera(feature: CameraFeatureInput): TerraTrafficCamera {
  const providerId = feature.providerId ?? feature.layerId ?? text(feature.properties.provider) ?? 'unknown'
  const licensePolicy = cameraLicensePolicyForProvider(providerId)
  const preview = cameraPreviewHref({ providerId, properties: feature.properties })
  const viewerUrl = validatedCameraMediaUrl(providerId, preview.kind === 'html_viewer'
    ? preview.href
    : text(feature.properties.viewerUrl))
  const candidateStill = validatedCameraMediaUrl(providerId, preview.kind === 'still' ? preview.href : null)
  const undisplayedMedia = text(feature.properties.imageUrl)
    ?? text(feature.properties.streamUrl)
    ?? text(feature.properties.feedUrl)
  const streamUrl = validatedCameraMediaUrl(providerId, text(feature.properties.streamUrl)
    ?? text(feature.properties.hlsUrl)
    ?? text(feature.properties.dashUrl)
    ?? text(feature.properties.feedUrl)
    ?? text(feature.properties.videoUrl))
  let transport = inferTransport(feature.properties, Boolean(candidateStill), Boolean(viewerUrl))
  let mediaUrl = transport === 'SNAPSHOT'
    ? candidateStill
    : transport === 'LINK_OUT'
      ? viewerUrl
      : transport === 'EMBED'
        ? text(feature.properties.embedUrl) ?? viewerUrl
        : streamUrl
  let freshness = inferFreshness(feature.properties, text(feature.properties.coverageState))

  const displayAllowed = transport === 'LINK_OUT'
    || (transport === 'SNAPSHOT' && Boolean(mediaUrl) && (licensePolicy.directDisplayAllowed || licensePolicy.proxyAllowed))
    || (transport !== 'SNAPSHOT' && transport !== 'UNAVAILABLE' && licensePolicy.directDisplayAllowed)
  if (!displayAllowed && mediaUrl) {
    mediaUrl = viewerUrl
    transport = viewerUrl ? 'LINK_OUT' : 'UNAVAILABLE'
    freshness = viewerUrl ? 'NO_VIDEO' : 'LICENSE_RESTRICTED'
  } else if (transport === 'UNAVAILABLE' && freshness === 'UNKNOWN') {
    freshness = 'NO_VIDEO'
  } else if (transport === 'LINK_OUT' && freshness === 'UNKNOWN') {
    freshness = 'NO_VIDEO'
  }
  if (transport === 'UNAVAILABLE' && undisplayedMedia && !licensePolicy.directDisplayAllowed && !licensePolicy.proxyAllowed) {
    freshness = 'LICENSE_RESTRICTED'
  }

  const authState = text(feature.properties.authState)
  if (authState === 'PUBLIC_KEY_REQUIRED' && !mediaUrl && freshness !== 'LICENSE_RESTRICTED') freshness = 'AUTH_REQUIRED'

  return {
    id: feature.id,
    providerId,
    providerName: text(feature.properties.providerName)
      ?? text(feature.properties.provider)
      ?? feature.provenance?.provider
      ?? providerId,
    operator: text(feature.properties.operator)
      ?? text(feature.properties.agency)
      ?? feature.provenance?.provider
      ?? providerId,
    name: feature.title,
    latitude: feature.latitude,
    longitude: feature.longitude,
    transport,
    mediaUrl,
    sourceUrl: feature.rawReference?.canonicalUrl
      ?? feature.provenance?.sourceUrl
      ?? text(feature.properties.sourceUrl)
      ?? viewerUrl,
    observedAt: text(feature.properties.observedAt)
      ?? text(feature.properties.capturedAt)
      ?? text(feature.properties.lastUpdated)
      ?? text(feature.properties.measuredTimeIso)
      ?? feature.timestamp
      ?? null,
    fetchedAt: feature.provenance?.retrievedAt ?? text(feature.properties.fetchedAt) ?? text(feature.properties.retrievedAt),
    expectedRefreshSeconds: positiveNumber(feature.properties.expectedRefreshSeconds)
      ?? positiveNumber(feature.properties.collectionIntervalSec)
      ?? (transport === 'SNAPSHOT' ? 60 : null),
    freshness,
    direction: text(feature.properties.direction),
    road: text(feature.properties.road),
    jurisdiction: text(feature.properties.jurisdiction)
      ?? text(feature.properties.region)
      ?? text(feature.properties.country),
    attribution: text(feature.properties.attribution)
      ?? feature.provenance?.provider
      ?? providerId,
    licensePolicy,
  }
}

export function canRetainTrafficCameraFrame(camera: TerraTrafficCamera): boolean {
  return camera.licensePolicy.cacheAllowed
    && camera.licensePolicy.maxCacheAgeSeconds > 0
    && (camera.freshness === 'LIVE' || camera.freshness === 'RECENT' || camera.freshness === 'STALE')
}

export function lawfulCurrentFrameReference(camera: TerraTrafficCamera): string | null {
  if (camera.transport !== 'SNAPSHOT' && camera.transport !== 'MJPEG') return null
  if (camera.freshness !== 'LIVE' && camera.freshness !== 'RECENT') return null
  if (!camera.licensePolicy.directDisplayAllowed && !camera.licensePolicy.proxyAllowed) return null
  return camera.mediaUrl
}

export function radarCameraDeltaMs(radarAt: string | null | undefined, cameraAt: string | null | undefined): number | null {
  if (!radarAt || !cameraAt) return null
  const radarMs = Date.parse(radarAt)
  const cameraMs = Date.parse(cameraAt)
  return Number.isFinite(radarMs) && Number.isFinite(cameraMs) ? cameraMs - radarMs : null
}

export function buildTrafficCameraCouncilHandoff(input: {
  camera: TerraTrafficCamera
  radarAt: string | null
  radarProvider: string | null
  radarStatus?: string | null
  radarEchoState?: string | null
  commanderPrompt?: string
}): TerraCouncilHandoffPayload {
  const { camera } = input
  const handedOffAt = new Date().toISOString()
  const delta = radarCameraDeltaMs(input.radarAt, camera.observedAt)
  const frameReference = lawfulCurrentFrameReference(camera)
  const freshness = camera.freshness === 'LIVE' || camera.freshness === 'RECENT' || camera.freshness === 'STALE'
    ? camera.freshness
    : camera.freshness === 'AUTH_REQUIRED'
      ? 'AUTH_REQUIRED'
      : camera.freshness === 'NO_COVERAGE'
        ? 'NO_COVERAGE'
        : 'UNAVAILABLE'
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt: input.commanderPrompt?.trim()
      || 'Analyze this normalized Terra traffic-camera evidence. Grok and every Council member must label each conclusion OBSERVED, INFERRED, or UNKNOWN. Stale or unavailable evidence cannot establish a current traffic/event fact.',
    lineage: {
      objectId: camera.id,
      layer: 'other',
      type: 'traffic_camera',
      title: camera.name,
      provider: camera.providerId,
      evidenceId: camera.id,
      sourceUrl: camera.sourceUrl,
      latitude: camera.latitude,
      longitude: camera.longitude,
      coordinateOrigin: 'source_embedded',
      freshness,
      observedAt: camera.observedAt,
      receivedAt: camera.fetchedAt ?? handedOffAt,
      handedOffAt,
      sourceFamily: 'traffic_camera',
      country: null,
      region: camera.jurisdiction,
      jurisdiction: camera.operator,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts: [
      'LAYER: Observed Data',
      `CAMERA ID: ${camera.id}`,
      `PROVIDER: ${camera.providerId} / ${camera.providerName}`,
      `OPERATOR: ${camera.operator}`,
      `COORDINATES: ${camera.latitude.toFixed(5)}, ${camera.longitude.toFixed(5)}`,
      `ROAD / LOCATION: ${camera.road ?? camera.name}`,
      `TRANSPORT: ${camera.transport}`,
      `FRAME TIMESTAMP: ${camera.observedAt ?? 'UNKNOWN'}`,
      `FETCHED AT: ${camera.fetchedAt ?? 'UNKNOWN'}`,
      `FRESHNESS / TRUTH STATE: ${camera.freshness}`,
      `SOURCE URL: ${camera.sourceUrl ?? 'none'}`,
      `ATTRIBUTION: ${camera.attribution}`,
      `RADAR PROVIDER: ${input.radarProvider ?? 'NO_COVERAGE'}`,
      `RADAR TIMESTAMP: ${input.radarAt ?? 'NO_COVERAGE'}`,
      `RADAR STATUS: ${input.radarStatus ?? 'UNKNOWN'}`,
      `RADAR PRECIPITATION STATE: ${input.radarEchoState ?? 'UNDETERMINED'} (NO_PRECIP means measured and clear; NO_DATA means not measured)`,
      `RADAR/CAMERA DELTA MS: ${delta ?? 'UNKNOWN'}`,
      'RADAR AND CAMERA ARE SEPARATE OBSERVATIONS. They were not captured simultaneously; neither is current beyond its own timestamp.',
      `CURRENT FRAME REFERENCE: ${frameReference ?? 'none (not current or not lawful)'}`,
      'VISION ATTACHMENT LIMIT: at most this one current lawful frame; no frame history',
      'CLASSIFICATION CONTRACT: OBSERVED / INFERRED / UNKNOWN',
      'No provider secrets, cookies, authorization headers, or private request headers are included.',
    ].join('\n'),
  }
}
