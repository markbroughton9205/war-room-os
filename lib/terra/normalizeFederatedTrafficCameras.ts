/**
 * Shared ResearchDocument → TerraIntelligenceEvent path for federated US still-camera adapters
 * (OHGO, New York State, Caltrans CWWP2). Same shape as normalizeOntarioTrafficCameras, plus the
 * locked federation schema on properties.
 */
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'
import {
  bearingFromCameraDirection,
  isValidWgs84Point,
  trafficCameraRecordToProperties,
  type TerraTrafficCameraAuthState,
  type TerraTrafficCameraHealthState,
  type TerraTrafficCameraRecord,
} from './trafficCameraRecord'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const HEALTH: readonly TerraTrafficCameraHealthState[] = ['LIVE', 'STALE', 'OFFLINE', 'NO_COVERAGE', 'AUTH_REQUIRED', 'RATE_LIMITED', 'UNAVAILABLE']
const AUTH: readonly TerraTrafficCameraAuthState[] = ['PUBLIC_KEY_REQUIRED', 'PUBLIC_NO_AUTH', 'SESSION_REQUIRED']

function asHealth(raw: string | undefined, fallback: TerraTrafficCameraHealthState): TerraTrafficCameraHealthState {
  return raw && HEALTH.includes(raw as TerraTrafficCameraHealthState) ? (raw as TerraTrafficCameraHealthState) : fallback
}

function asAuth(raw: string | undefined, fallback: TerraTrafficCameraAuthState): TerraTrafficCameraAuthState {
  return raw && AUTH.includes(raw as TerraTrafficCameraAuthState) ? (raw as TerraTrafficCameraAuthState) : fallback
}

export function documentToFederatedTrafficCamera(doc: ResearchDocument, defaults: {
  provider: string
  agency: string
  country: string
  region: string
  authState: TerraTrafficCameraAuthState
  attribution: string
}): TerraTrafficCameraRecord | null {
  const lat = parseFiniteNumber(doc.identifiers.latitude)
  const lon = parseFiniteNumber(doc.identifiers.longitude)
  if (lat === null || lon === null || !isValidWgs84Point(lat, lon)) return null

  const direction = doc.identifiers.direction ?? null
  const bearingRaw = parseFiniteNumber(doc.identifiers.bearing)
  return {
    id: doc.providerRecordId ?? doc.id,
    provider: doc.identifiers.provider ?? defaults.provider,
    agency: doc.identifiers.agency ?? defaults.agency,
    country: doc.identifiers.country ?? defaults.country,
    region: doc.identifiers.region ?? defaults.region,
    road: doc.identifiers.road ?? null,
    locationName: doc.identifiers.locationName ?? doc.title,
    lat,
    lon,
    direction,
    bearing: bearingRaw ?? bearingFromCameraDirection(direction),
    feedType: doc.identifiers.feedType === 'REFRESHED_IMAGE' ? 'REFRESHED_IMAGE' : 'STILL',
    imageUrl: doc.identifiers.imageUrl ?? null,
    streamUrl: null,
    viewerUrl: doc.identifiers.viewerUrl ?? null,
    lastUpdated: doc.identifiers.lastUpdated ?? null,
    freshnessState: asHealth(doc.identifiers.freshnessState, 'UNAVAILABLE'),
    coverageState: asHealth(doc.identifiers.coverageState, asHealth(doc.identifiers.freshnessState, 'UNAVAILABLE')),
    authState: asAuth(doc.identifiers.authState, defaults.authState),
    license: doc.license,
    attribution: doc.identifiers.attribution ?? defaults.attribution,
    sourceUrl: doc.provenance.sourceUrl || doc.canonicalUrl,
  }
}

export function normalizeFederatedTrafficCameras(
  documents: ResearchDocument[],
  providerId: ResearchProviderId,
  defaults: {
    provider: string
    agency: string
    country: string
    region: string
    authState: TerraTrafficCameraAuthState
    attribution: string
  },
): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const record = documentToFederatedTrafficCamera(doc, defaults)
    if (!record) {
      skippedCount += 1
      continue
    }

    events.push({
      id: record.id,
      domain: 'other',
      kind: 'traffic_camera',
      providerId,
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: record.lastUpdated,
      publishedAt: null,
      updatedAt: record.lastUpdated,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: record.lon, latitude: record.lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        ...trafficCameraRecordToProperties(record),
        cameraId: record.id,
        viewId: doc.identifiers.viewIndex ?? doc.identifiers.siteId ?? record.id,
        ...(doc.identifiers.collectionIntervalSec
          ? { collectionIntervalSec: Number(doc.identifiers.collectionIntervalSec) }
          : {}),
      },
      provenance: {
        provider: doc.provenance.provider,
        sourceUrl: doc.provenance.sourceUrl || doc.canonicalUrl,
        retrievedAt: doc.provenance.retrievedAt,
        fromCache: doc.provenance.fromCache,
        isHistorical: doc.provenance.isHistorical,
      },
      rawReference: { documentId: doc.id, providerRecordId: doc.providerRecordId, canonicalUrl: doc.canonicalUrl },
    })
  }

  return { events, skippedCount }
}

export function normalizeOhgoTrafficCameras(documents: ResearchDocument[]): NormalizeResult {
  return normalizeFederatedTrafficCameras(documents, 'ohgo_cameras', {
    provider: 'ohgo',
    agency: 'ODOT',
    country: 'US',
    region: 'OH',
    authState: 'PUBLIC_KEY_REQUIRED',
    attribution: 'ODOT / OHGO',
  })
}

export function normalizeNy511TrafficCameras(documents: ResearchDocument[]): NormalizeResult {
  return normalizeFederatedTrafficCameras(documents, 'ny511_cameras', {
    provider: '511ny',
    agency: 'New York State',
    country: 'US',
    region: 'NY',
    authState: 'PUBLIC_KEY_REQUIRED',
    attribution: 'powered by 511NY',
  })
}

export function normalizeCaltransTrafficCameras(documents: ResearchDocument[]): NormalizeResult {
  return normalizeFederatedTrafficCameras(documents, 'caltrans_cwwp2_cameras', {
    provider: 'caltrans',
    agency: 'Caltrans',
    country: 'US',
    region: 'CA',
    authState: 'PUBLIC_NO_AUTH',
    attribution: 'Caltrans CWWP2',
  })
}
