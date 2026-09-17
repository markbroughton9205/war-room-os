/**
 * God's Eye camera federation — one registry-derived view of every wired camera provider.
 *
 * Not a second coverage registry. Coverage, auth, and envelopes stay on TERRA_COVERAGE_REGISTRY.
 * Catalog identity stays on TERRA_LAYER_SUMMARIES (kind traffic_camera).
 * Nearby, discovery, directory, inspect, and CAMERAS mode all read this module.
 *
 * Future provider inclusion requires:
 *   1. provider identity (coverage row + canonical id / alias)
 *   2. coverage envelope
 *   3. auth model
 *   4. adapter (layer catalog + TerraTrafficLayer bbox/query)
 *   5. normalized TerraTrafficCameraRecord
 *   6. still / viewer policy
 * Then this module discovers the provider automatically. No God's Eye UI rewrite per provider.
 */
import type { TerraDegreeRectangle } from '../aircraftBoundingBox'
import {
  TERRA_COVERAGE_REGISTRY,
  type TerraAuthModel,
  type TerraCoverageProviderRecord,
  type TerraEndpointType,
} from '../coverageFederation'
import { TERRA_LAYER_SUMMARIES } from '../layerCatalogSummary'
import type { TerraTrafficCameraRecord } from '../trafficCameraRecord'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  trafficCameraRecordFromProperties,
} from '../trafficCameraRecord'
import { cameraInspectFreshness, type CameraCatalogStatus, type CameraImageFreshness } from './cameraInspectFreshness'

export const GODS_EYE_VIEW_MODES = ['EARTH', 'CAMERAS', 'AREA_LIVE', 'HAZARDS', 'INTEL'] as const
export type GodsEyeViewMode = (typeof GODS_EYE_VIEW_MODES)[number]

export const GODS_EYE_CAMERA_LODS = ['PLANET', 'COUNTRY', 'REGION', 'CITY', 'STREET'] as const
export type GodsEyeCameraLod = (typeof GODS_EYE_CAMERA_LODS)[number]

export const CAMERA_PIN_STATES = ['AVAILABLE', 'STALE', 'OFFLINE', 'UNKNOWN'] as const
export type CameraPinState = (typeof CAMERA_PIN_STATES)[number]

export const CAMERA_FEDERATION_CATALOG_LABELS = [
  'LIVE CATALOG',
  'LIVE',
  'CATALOG / VIEWER ONLY',
  'PROVIDER AUTH REQUIRED / PARTIAL',
  'AVAILABLE',
] as const
export type CameraFederationCatalogLabel = (typeof CAMERA_FEDERATION_CATALOG_LABELS)[number]

export const CAMERA_STILL_POLICIES = ['jpeg', 'html_viewer', 'official_viewer_only'] as const
export type CameraStillPolicy = (typeof CAMERA_STILL_POLICIES)[number]

export const CAMERA_DIRECTORY_STATUS_FILTERS = ['ALL', 'AVAILABLE', 'STALE', 'OFFLINE', 'UNKNOWN'] as const
export type CameraDirectoryStatusFilter = (typeof CAMERA_DIRECTORY_STATUS_FILTERS)[number]

export const CAMERA_DIRECTORY_DISTANCE_FILTERS = ['NEAREST', 'REGIONAL'] as const
export type CameraDirectoryDistanceFilter = (typeof CAMERA_DIRECTORY_DISTANCE_FILTERS)[number]

/** Adapter contract future providers must satisfy. Runtime fetch stays on /api/terra/layers/{id}. */
export type CameraProviderAdapter = {
  id: string
  authModel: TerraAuthModel
  coverage: TerraDegreeRectangle | 'GLOBAL'
  fetchCatalog: (bounds: TerraDegreeRectangle) => Promise<TerraTrafficCameraRecord[]>
  normalize: (record: unknown) => TerraTrafficCameraRecord | null
  resolveStill: (camera: TerraTrafficCameraRecord) => string | null
  resolveViewer: (camera: TerraTrafficCameraRecord) => string | null
}

export type CameraProviderAdapterContract = {
  id: string
  canonicalId: string
  displayName: string
  agency: string
  country: string
  region: string
  authModel: TerraAuthModel
  authState: 'PUBLIC' | 'PROVIDER_AUTH' | 'COMMANDER_PRIVATE' | 'PROVIDER_AUTH_REQUIRED'
  coverage: TerraDegreeRectangle | 'GLOBAL'
  endpointType: TerraEndpointType
  layerIds: readonly string[]
  fetchableLayerIds: readonly string[]
  stillPolicy: CameraStillPolicy
  catalogLabel: CameraFederationCatalogLabel
  viewerUrl: string | null
  sourceUrl: string | null
  license: string
  /** Existing Terra layer route — not a parallel fetch stack. */
  catalogRoute: string | null
}

export type GodsEyeFederatedCamera = TerraTrafficCameraRecord & {
  catalogStatus: CameraCatalogStatus
  imageFreshness: CameraImageFreshness
  pinState: CameraPinState
  layerId: string
}

export type GodsEyeCameraLodPolicy = {
  lod: GodsEyeCameraLod
  fetchCatalog: boolean
  showCoverageEnvelopes: boolean
  clusterPins: boolean
  showIndividualPins: boolean
}

export type NearbyCameraEnvelope = {
  id: string
  agency: string
  bbox: TerraDegreeRectangle
  endpointType: 'API' | 'OFFICIAL_VIEWER'
  viewerUrl?: string
}

type TerraScaleLevelLike = 'global' | 'regional' | 'city' | 'local' | 'building'

const CAMERA_LAYER_KIND = 'traffic_camera'

/** Display sugar only. Missing keys fall back so a new coverage row still appears. */
const CAMERA_FEDERATION_DISPLAY: Record<string, { displayName: string; agency: string; catalogLabel: CameraFederationCatalogLabel; stillPolicy?: CameraStillPolicy }> = {
  ohgo: { displayName: 'OHGO / ODOT', agency: 'OHGO / ODOT', catalogLabel: 'LIVE CATALOG', stillPolicy: 'jpeg' },
  caltrans_cctv: { displayName: 'Caltrans', agency: 'Caltrans CWWP2', catalogLabel: 'LIVE CATALOG', stillPolicy: 'jpeg' },
  ontario_511_cameras: { displayName: 'Ontario 511', agency: 'Ontario 511', catalogLabel: 'LIVE', stillPolicy: 'jpeg' },
  quebec_511_cameras: { displayName: 'Québec 511', agency: 'Québec 511 / MTMD', catalogLabel: 'CATALOG / VIEWER ONLY', stillPolicy: 'html_viewer' },
  hong_kong_td_cameras: { displayName: 'Hong Kong TD', agency: 'Hong Kong Transport Department', catalogLabel: 'LIVE', stillPolicy: 'jpeg' },
  digitraffic_road_cameras: { displayName: 'Fintraffic', agency: 'Fintraffic / Digitraffic', catalogLabel: 'LIVE', stillPolicy: 'jpeg' },
  '511ny': { displayName: '511NY', agency: '511NY', catalogLabel: 'PROVIDER AUTH REQUIRED / PARTIAL', stillPolicy: 'official_viewer_only' },
}

function isCameraLayerId(id: string): boolean {
  return TERRA_LAYER_SUMMARIES.some(row => row.id === id && row.kind === CAMERA_LAYER_KIND)
}

function cameraLayerIdsFromCoverage(row: TerraCoverageProviderRecord): string[] {
  return row.layerIds.filter(id => isCameraLayerId(id) && !id.includes('events') && !id.includes('weather'))
}

export function godsEyeCameraCoverageRows(): TerraCoverageProviderRecord[] {
  return TERRA_COVERAGE_REGISTRY.filter(row => row.category === 'cameras')
}

export function fetchableCameraLayerIds(): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of godsEyeCameraCoverageRows()) {
    if (row.endpointType !== 'API') continue
    for (const id of cameraLayerIdsFromCoverage(row)) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

function stillPolicyFor(row: TerraCoverageProviderRecord): CameraStillPolicy {
  const known = CAMERA_FEDERATION_DISPLAY[row.id]?.stillPolicy
  if (known) return known
  if (row.endpointType === 'OFFICIAL_VIEWER') return 'official_viewer_only'
  return 'jpeg'
}

function catalogLabelFor(row: TerraCoverageProviderRecord): CameraFederationCatalogLabel {
  const known = CAMERA_FEDERATION_DISPLAY[row.id]?.catalogLabel
  if (known) return known
  if (row.endpointType === 'OFFICIAL_VIEWER' && row.authModel === 'PROVIDER_AUTH') return 'PROVIDER AUTH REQUIRED / PARTIAL'
  if (row.endpointType === 'OFFICIAL_VIEWER') return 'CATALOG / VIEWER ONLY'
  if (stillPolicyFor(row) === 'html_viewer') return 'CATALOG / VIEWER ONLY'
  return 'AVAILABLE'
}

function authStateFor(row: TerraCoverageProviderRecord): CameraProviderAdapterContract['authState'] {
  if (row.endpointType === 'OFFICIAL_VIEWER' && row.authModel === 'PROVIDER_AUTH') return 'PROVIDER_AUTH_REQUIRED'
  return row.authModel
}

function canonicalIdFor(row: TerraCoverageProviderRecord): string {
  const layers = cameraLayerIdsFromCoverage(row)
  if (layers[0]) return layers[0]
  if (row.id === '511ny') return 'ny511_cameras'
  return row.id
}

export function cameraProviderAdapterContracts(): CameraProviderAdapterContract[] {
  return godsEyeCameraCoverageRows().map(row => {
    const fetchableLayerIds = row.endpointType === 'API' ? cameraLayerIdsFromCoverage(row) : []
    const display = CAMERA_FEDERATION_DISPLAY[row.id]
    return {
      id: row.id,
      canonicalId: canonicalIdFor(row),
      displayName: display?.displayName ?? row.region,
      agency: display?.agency ?? row.region,
      country: row.country,
      region: row.region,
      authModel: row.authModel,
      authState: authStateFor(row),
      coverage: row.coverage,
      endpointType: row.endpointType,
      layerIds: row.layerIds,
      fetchableLayerIds,
      stillPolicy: stillPolicyFor(row),
      catalogLabel: catalogLabelFor(row),
      viewerUrl: row.viewerUrl,
      sourceUrl: row.apiUrl ?? row.viewerUrl,
      license: row.license,
      catalogRoute: fetchableLayerIds[0] ? `/api/terra/layers/${fetchableLayerIds[0]}` : null,
    }
  })
}

export function cameraAgencyLabel(layerOrProviderId: string): string {
  const contracts = cameraProviderAdapterContracts()
  const match = contracts.find(row =>
    row.id === layerOrProviderId
    || row.canonicalId === layerOrProviderId
    || row.fetchableLayerIds.includes(layerOrProviderId)
    || row.layerIds.includes(layerOrProviderId),
  )
  return match?.agency ?? layerOrProviderId
}

export function cameraStillPolicyForProvider(layerOrProviderId: string | null | undefined): CameraStillPolicy {
  if (!layerOrProviderId) return 'jpeg'
  const contracts = cameraProviderAdapterContracts()
  const match = contracts.find(row =>
    row.id === layerOrProviderId
    || row.canonicalId === layerOrProviderId
    || row.fetchableLayerIds.includes(layerOrProviderId)
    || row.layerIds.includes(layerOrProviderId),
  )
  return match?.stillPolicy ?? 'jpeg'
}

export function cameraProviderContractForId(layerOrProviderId: string | null | undefined): CameraProviderAdapterContract | null {
  if (!layerOrProviderId) return null
  return cameraProviderAdapterContracts().find(row =>
    row.id === layerOrProviderId
    || row.canonicalId === layerOrProviderId
    || row.fetchableLayerIds.includes(layerOrProviderId)
    || row.layerIds.includes(layerOrProviderId),
  ) ?? null
}

export function nearbyCameraEnvelopesFromRegistry(): NearbyCameraEnvelope[] {
  const out: NearbyCameraEnvelope[] = []
  for (const row of cameraProviderAdapterContracts()) {
    if (row.coverage === 'GLOBAL') continue
    const envelopeId = row.endpointType === 'OFFICIAL_VIEWER' ? row.id : (row.fetchableLayerIds[0] ?? row.canonicalId)
    out.push({
      id: envelopeId,
      agency: row.agency,
      bbox: row.coverage,
      endpointType: row.endpointType === 'OFFICIAL_VIEWER' ? 'OFFICIAL_VIEWER' : 'API',
      viewerUrl: row.viewerUrl ?? undefined,
    })
  }
  return out
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

export function cameraProvidersForViewExtent(rectangle: TerraDegreeRectangle | null): CameraProviderAdapterContract[] {
  const all = cameraProviderAdapterContracts()
  if (!rectangle) return all
  return all.filter(row => row.coverage === 'GLOBAL' || rectanglesIntersect(rectangle, row.coverage))
}

export function godsEyeCameraLod(scale: TerraScaleLevelLike, rectangle: TerraDegreeRectangle | null): GodsEyeCameraLod {
  if (scale === 'global') return 'PLANET'
  if (scale === 'regional') {
    if (!rectangle) return 'COUNTRY'
    const span = Math.max(rectangle.east - rectangle.west, rectangle.north - rectangle.south)
    return span > 12 ? 'COUNTRY' : 'REGION'
  }
  if (scale === 'city') return 'CITY'
  return 'STREET'
}

export function godsEyeCameraLodPolicy(lod: GodsEyeCameraLod): GodsEyeCameraLodPolicy {
  if (lod === 'PLANET') {
    return { lod, fetchCatalog: false, showCoverageEnvelopes: true, clusterPins: false, showIndividualPins: false }
  }
  if (lod === 'COUNTRY') {
    return { lod, fetchCatalog: true, showCoverageEnvelopes: true, clusterPins: true, showIndividualPins: false }
  }
  if (lod === 'REGION') {
    return { lod, fetchCatalog: true, showCoverageEnvelopes: false, clusterPins: true, showIndividualPins: false }
  }
  if (lod === 'CITY') {
    return { lod, fetchCatalog: true, showCoverageEnvelopes: false, clusterPins: true, showIndividualPins: true }
  }
  return { lod, fetchCatalog: true, showCoverageEnvelopes: false, clusterPins: false, showIndividualPins: true }
}

export function cameraPinStateFromImageFreshness(imageFreshness: CameraImageFreshness | string | null | undefined): CameraPinState {
  if (imageFreshness === 'LIVE' || imageFreshness === 'AVAILABLE') return 'AVAILABLE'
  if (imageFreshness === 'STALE') return 'STALE'
  if (imageFreshness === 'OFFLINE' || imageFreshness === 'UNAVAILABLE') return 'OFFLINE'
  return 'UNKNOWN'
}

export function cameraPinColor(state: CameraPinState): string {
  if (state === 'AVAILABLE') return '#22D3EE'
  if (state === 'STALE') return '#FBBF24'
  if (state === 'OFFLINE') return '#64748B'
  return '#7DD3FC'
}

export function federatedCameraFromFeature(feature: {
  id: string
  layerId?: string
  providerId?: string | null
  title?: string
  latitude: number
  longitude: number
  timestamp?: string | null
  provenance?: { provider?: string; fromCache?: boolean; isHistorical?: boolean; retrievedAt?: string | null; sourceUrl?: string | null }
  properties?: Record<string, unknown>
}): GodsEyeFederatedCamera | null {
  if (!isValidWgs84Point(feature.latitude, feature.longitude)) return null
  const properties = feature.properties ?? {}
  const partial = trafficCameraRecordFromProperties(properties)
  const inspect = cameraInspectFreshness(feature)
  const direction = typeof properties.direction === 'string' ? properties.direction : partial.direction ?? null
  const pinState = cameraPinStateFromImageFreshness(inspect.imageFreshness)
  const layerId = feature.layerId ?? String(properties.provider ?? '')
  return {
    id: partial.id ?? feature.id,
    provider: partial.provider ?? feature.providerId ?? layerId,
    agency: partial.agency ?? cameraAgencyLabel(layerId),
    country: partial.country ?? '',
    region: partial.region ?? '',
    road: partial.road ?? (typeof properties.road === 'string' ? properties.road : null),
    locationName: partial.locationName ?? feature.title ?? feature.id,
    lat: feature.latitude,
    lon: feature.longitude,
    direction,
    bearing: partial.bearing ?? bearingFromCameraDirection(direction),
    feedType: partial.feedType ?? 'STILL',
    imageUrl: partial.imageUrl ?? null,
    streamUrl: partial.streamUrl ?? null,
    viewerUrl: partial.viewerUrl ?? null,
    lastUpdated: partial.lastUpdated ?? feature.timestamp ?? null,
    freshnessState: partial.freshnessState ?? (pinState === 'AVAILABLE' ? 'LIVE' : pinState === 'STALE' ? 'STALE' : pinState === 'OFFLINE' ? 'OFFLINE' : 'UNAVAILABLE'),
    coverageState: partial.coverageState ?? 'UNAVAILABLE',
    authState: partial.authState ?? 'PUBLIC_NO_AUTH',
    license: partial.license ?? null,
    attribution: partial.attribution ?? feature.provenance?.provider ?? layerId,
    sourceUrl: partial.sourceUrl ?? feature.provenance?.sourceUrl ?? null,
    catalogStatus: inspect.catalogStatus,
    imageFreshness: inspect.imageFreshness,
    pinState,
    layerId,
  }
}

export type CameraDirectoryRow = {
  id: string
  layerId: string
  title: string
  agency: string
  provider: string
  road: string | null
  distanceKm: number | null
  pinState: CameraPinState
  catalogStatus: CameraCatalogStatus
  viewerOnly: boolean
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

export function cameraDirectoryRows(input: {
  features: readonly {
    id: string
    layerId: string
    kind: string
    title: string
    latitude: number
    longitude: number
    providerId?: string | null
    timestamp?: string | null
    provenance?: { provider?: string; fromCache?: boolean; isHistorical?: boolean; retrievedAt?: string | null; sourceUrl?: string | null }
    properties?: Record<string, unknown>
  }[]
  origin: { latitude: number; longitude: number } | null
  query: string
  providerFilter: string
  statusFilter: CameraDirectoryStatusFilter
  distanceFilter: CameraDirectoryDistanceFilter
  maxKm?: number
}): CameraDirectoryRow[] {
  const query = input.query.trim().toLowerCase()
  const maxKm = input.distanceFilter === 'NEAREST' ? (input.maxKm ?? 80) : Number.POSITIVE_INFINITY
  const rows: CameraDirectoryRow[] = []
  for (const feature of input.features) {
    if (feature.kind !== 'traffic_camera') continue
    const federated = federatedCameraFromFeature(feature)
    if (!federated) continue
    if (input.providerFilter !== 'ALL' && federated.layerId !== input.providerFilter && federated.provider !== input.providerFilter) continue
    if (input.statusFilter !== 'ALL' && federated.pinState !== input.statusFilter) continue
    const distanceKm = input.origin
      ? haversineKm(input.origin.latitude, input.origin.longitude, federated.lat, federated.lon)
      : null
    if (distanceKm !== null && distanceKm > maxKm) continue
    const haystack = `${federated.locationName} ${federated.road ?? ''} ${federated.agency} ${federated.provider}`.toLowerCase()
    if (query && !haystack.includes(query)) continue
    rows.push({
      id: federated.id,
      layerId: federated.layerId,
      title: federated.locationName,
      agency: federated.agency,
      provider: federated.provider,
      road: federated.road,
      distanceKm,
      pinState: federated.pinState,
      catalogStatus: federated.catalogStatus,
      viewerOnly: federated.feedType === 'HTML_VIEWER' || (!federated.imageUrl && Boolean(federated.viewerUrl)),
    })
  }
  rows.sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY))
  return rows
}

export type CameraFederationIssue = {
  id: string
  detail: string
}

export function cameraFederationIssues(input?: {
  trafficCameraLayerIds?: readonly string[]
}): CameraFederationIssue[] {
  const issues: CameraFederationIssue[] = []
  const contracts = cameraProviderAdapterContracts()
  const fetchable = new Set(fetchableCameraLayerIds())
  const trafficIds = new Set(input?.trafficCameraLayerIds ?? [])

  for (const row of contracts) {
    if (!row.canonicalId) issues.push({ id: row.id, detail: 'missing canonical identity' })
    if (row.coverage === 'GLOBAL') issues.push({ id: row.id, detail: 'camera coverage must be a regional envelope, not GLOBAL' })
    if (!row.authModel) issues.push({ id: row.id, detail: 'missing auth model' })
    if (row.endpointType === 'API' && row.fetchableLayerIds.length === 0) {
      issues.push({ id: row.id, detail: 'API camera provider has no catalog layer mapping to traffic_camera schema' })
    }
    for (const layerId of row.fetchableLayerIds) {
      if (!fetchable.has(layerId)) issues.push({ id: layerId, detail: 'fetchable camera layer missing from federation set' })
      if (trafficIds.size > 0 && !trafficIds.has(layerId)) {
        issues.push({ id: layerId, detail: 'fetchable camera layer missing TerraTrafficLayer adapter' })
      }
    }
  }

  for (const layerId of fetchable) {
    const appears = contracts.some(row => row.fetchableLayerIds.includes(layerId))
    if (!appears) issues.push({ id: layerId, detail: 'fetchable camera layer missing from God\'s Eye camera federation contracts' })
  }

  return issues
}

export function cameraCoverageEmptyCopy(): { title: string; body: string } {
  return {
    title: 'CAMERA COVERAGE',
    body: 'NO VERIFIED PROVIDER',
  }
}
