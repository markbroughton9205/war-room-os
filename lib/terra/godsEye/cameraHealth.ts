/**
 * Public traffic-camera provider health.
 * Regional only. Never global. No private cameras. No restricted-feed scraping.
 *
 * Four labeled dimensions — configuration is not catalog, catalog is not capture freshness:
 *   configured         YES / NO / CREDENTIAL_REQUIRED
 *   catalogStatus      LIVE | CACHED | LIVE_EMPTY | UNPROBED | PROVIDER_AUTH_REQUIRED
 *   captureFreshness   LIVE | STALE | OFFLINE | UNKNOWN | UNPROBED | NONE
 *   health             summary that must not collapse catalog LIVE into UNAVAILABLE
 *
 * configurationState ENABLED is not LIVE. LIVE capture requires a sourced timestamp.
 */
import { canonicalCameraProviderId } from '../cameraProviderIdentity'
import { ROAD_TRAFFIC_SOURCE_REGISTRY } from '../roadTrafficSourceRegistry'
import { cameraInspectFreshness } from './cameraInspectFreshness'

export const TRAFFIC_CAMERA_HEALTH_STATES = [
  'LIVE',
  'STALE',
  'OFFLINE',
  'LIVE_EMPTY',
  'CATALOG_LIVE',
  'PROVIDER_AUTH_REQUIRED',
  'AUTH_REQUIRED',
  'NO_COVERAGE',
  'NONE_WITHIN_RADIUS',
  'UNAVAILABLE',
  'ERROR_UPSTREAM',
] as const
export type TrafficCameraHealthState = (typeof TRAFFIC_CAMERA_HEALTH_STATES)[number]

export const TRAFFIC_CAMERA_CATALOG_STATES = [
  'LIVE',
  'CACHED',
  'LIVE_EMPTY',
  'UNPROBED',
  'PROVIDER_AUTH_REQUIRED',
] as const
export type TrafficCameraCatalogStatus = (typeof TRAFFIC_CAMERA_CATALOG_STATES)[number]

export const TRAFFIC_CAMERA_CAPTURE_STATES = [
  'LIVE',
  'STALE',
  'OFFLINE',
  'UNKNOWN',
  'UNPROBED',
  'NONE',
] as const
export type TrafficCameraCaptureFreshness = (typeof TRAFFIC_CAMERA_CAPTURE_STATES)[number]

const CAMERA_SOURCE_URLS: Record<string, string> = {
  digitraffic_road_cameras: 'https://www.digitraffic.fi/',
  ontario_511_cameras: 'https://511on.ca/',
  alberta_511: 'https://511.alberta.ca/',
  south_carolina_511: 'https://www.511sc.org/',
  montana_511: 'https://www.511mt.net/',
  south_dakota_511: 'https://www.sd511.org/',
  quebec_511_cameras: 'https://www.donneesquebec.ca/',
  hong_kong_td_cameras: 'https://data.gov.hk/',
  fl511_arcgis_cameras: 'https://fl511.com/',
  ohgo_cameras: 'https://publicapi.ohgo.com/docs/v1/cameras',
  ny511_cameras: 'https://511ny.org/',
  caltrans_cctv: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
}

export type TrafficCameraRuntimeEvidence = {
  providerId: string
  featureCount: number
  fromCache?: boolean
  captureFreshness?: TrafficCameraCaptureFreshness
}

export type TrafficCameraProviderHealth = {
  id: string
  agency: string
  region: string
  endpointClass: 'wired' | 'registered_only' | 'credential_gate'
  feedType: 'still' | 'stream' | 'html_viewer' | 'unknown'
  configured: boolean
  catalogStatus: TrafficCameraCatalogStatus
  captureFreshness: TrafficCameraCaptureFreshness
  health: TrafficCameraHealthState
  coverage: 'REGIONAL' | 'NO_COVERAGE'
  sourceUrl: string | null
  license: string
  privateCamera: false
  runtimeEvidence: boolean
}

function captureFromInspect(imageFreshness: string): TrafficCameraCaptureFreshness {
  if (imageFreshness === 'LIVE') return 'LIVE'
  if (imageFreshness === 'STALE') return 'STALE'
  if (imageFreshness === 'UNAVAILABLE') return 'OFFLINE'
  return 'UNKNOWN'
}

export function trafficCameraRuntimeEvidenceFromFeatures(
  features: readonly {
    kind?: string
    layerId?: string
    providerId?: string | null
    fromCache?: boolean
    timestamp?: string | null
    properties?: Record<string, unknown>
    provenance?: { fromCache?: boolean; isHistorical?: boolean; retrievedAt?: string | null }
  }[],
): TrafficCameraRuntimeEvidence[] {
  const byId = new Map<string, { count: number; cached: boolean; captures: TrafficCameraCaptureFreshness[] }>()
  for (const feature of features) {
    if (feature.kind !== 'traffic_camera') continue
    const id = canonicalCameraProviderId(String(feature.providerId || feature.layerId || ''))
    if (!id) continue
    const current = byId.get(id) ?? { count: 0, cached: false, captures: [] }
    current.count += 1
    const fromCache = Boolean(feature.fromCache ?? feature.provenance?.fromCache)
    current.cached = current.cached || fromCache
    const inspect = cameraInspectFreshness({
      timestamp: feature.timestamp,
      provenance: feature.provenance ?? { fromCache },
      properties: feature.properties,
    })
    current.captures.push(captureFromInspect(inspect.imageFreshness))
    byId.set(id, current)
  }
  return [...byId.entries()].map(([providerId, row]) => {
    const captureFreshness = row.captures.includes('LIVE')
      ? 'LIVE'
      : row.captures.includes('STALE')
        ? 'STALE'
        : row.captures.includes('OFFLINE')
          ? 'OFFLINE'
          : 'UNKNOWN'
    return {
      providerId,
      featureCount: row.count,
      fromCache: row.cached,
      captureFreshness,
    }
  })
}

function mergeRuntime(evidence: readonly TrafficCameraRuntimeEvidence[] | undefined, id: string): TrafficCameraRuntimeEvidence | null {
  if (!evidence?.length) return null
  return evidence.find(row => canonicalCameraProviderId(row.providerId) === id) ?? null
}

export function trafficCameraProviderHealth(
  runtime?: readonly TrafficCameraRuntimeEvidence[],
): TrafficCameraProviderHealth[] {
  const seen = new Set<string>()
  const rows: TrafficCameraProviderHealth[] = []
  for (const source of ROAD_TRAFFIC_SOURCE_REGISTRY) {
    if (!source.capabilities.includes('camera')) continue
    const id = canonicalCameraProviderId(source.id)
    if (seen.has(id)) continue
    seen.add(id)
    const missingCredentials = source.configurationState === 'CREDENTIAL_REQUIRED'
    const wired = source.researchProviderId !== null && source.configurationState === 'ENABLED'
    const configured = !missingCredentials && (wired || source.configurationState === 'ENABLED')
    const probe = mergeRuntime(runtime, id)
    const runtimeEvidence = Boolean(probe && probe.featureCount > 0)
    const catalogStatus: TrafficCameraCatalogStatus = missingCredentials
      ? 'PROVIDER_AUTH_REQUIRED'
      : runtimeEvidence
        ? (probe?.fromCache ? 'CACHED' : 'LIVE')
        : probe && probe.featureCount === 0
          ? 'LIVE_EMPTY'
          : 'UNPROBED'
    const captureFreshness: TrafficCameraCaptureFreshness = missingCredentials
      ? 'NONE'
      : runtimeEvidence
        ? (probe?.captureFreshness ?? 'UNKNOWN')
        : probe && probe.featureCount === 0
          ? 'NONE'
          : 'UNPROBED'
    const health: TrafficCameraHealthState = missingCredentials
      ? 'PROVIDER_AUTH_REQUIRED'
      : runtimeEvidence
        ? (captureFreshness === 'LIVE'
          ? 'LIVE'
          : captureFreshness === 'STALE'
            ? 'STALE'
            : captureFreshness === 'OFFLINE'
              ? 'OFFLINE'
              : 'CATALOG_LIVE')
        : wired
          ? 'UNAVAILABLE'
          : 'NO_COVERAGE'
    rows.push({
      id,
      agency: source.displayName,
      region: source.jurisdiction,
      endpointClass: missingCredentials ? 'credential_gate' : wired ? 'wired' : 'registered_only',
      feedType: id.includes('quebec') ? 'html_viewer' : 'still',
      configured,
      catalogStatus,
      captureFreshness,
      health,
      coverage: missingCredentials || wired ? 'REGIONAL' : 'NO_COVERAGE',
      sourceUrl: CAMERA_SOURCE_URLS[id] ?? CAMERA_SOURCE_URLS[source.id] ?? null,
      license: source.rightsState,
      privateCamera: false as const,
      runtimeEvidence,
    })
  }
  return rows
}

export function globalTrafficCameraCoverage(): 'REGIONAL' {
  return 'REGIONAL'
}

export function trafficCameraHasPrivateFeeds(rows: TrafficCameraProviderHealth[]): boolean {
  return rows.some(row => row.privateCamera)
}
