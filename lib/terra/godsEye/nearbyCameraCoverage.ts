/**
 * Per-location traffic-camera coverage from wired regional envelopes.
 * Global camera coverage stays REGIONAL / AGENCY_DEPENDENT.
 * An empty nearby list is not NO_COVERAGE when a provider actually covers the point.
 */
import type { TerraDegreeRectangle } from '../aircraftBoundingBox'
import { coverageProvidersForPoint } from '../coverageFederation'
import { nearbyCameraEnvelopesFromRegistry } from './cameraFederation'

export const NEARBY_CAMERA_LOCATION_STATES = [
  'COVERED',
  'NONE_WITHIN_RADIUS',
  'PARTIAL',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'PROVIDER_AUTH_REQUIRED',
  'UNAVAILABLE',
] as const
export type NearbyCameraLocationState = (typeof NEARBY_CAMERA_LOCATION_STATES)[number]

export type NearbyCameraProviderEnvelope = {
  id: string
  agency: string
  bbox: TerraDegreeRectangle
  endpointType?: 'API' | 'OFFICIAL_VIEWER'
  viewerUrl?: string
}

export const WIRED_NEARBY_CAMERA_ENVELOPES: readonly NearbyCameraProviderEnvelope[] = nearbyCameraEnvelopesFromRegistry()

function pointInEnvelope(latitude: number, longitude: number, bbox: TerraDegreeRectangle): boolean {
  return longitude >= bbox.west && longitude <= bbox.east && latitude >= bbox.south && latitude <= bbox.north
}

export function nearbyCameraProvidersCoveringPoint(latitude: number, longitude: number): NearbyCameraProviderEnvelope[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  const federated = coverageProvidersForPoint(latitude, longitude, 'cameras')
  if (!federated.length) return []
  const byId = new Map(WIRED_NEARBY_CAMERA_ENVELOPES.map(entry => [entry.id, entry]))
  const out: NearbyCameraProviderEnvelope[] = []
  const seen = new Set<string>()
  for (const row of federated) {
    const envelopeIds = [row.id, ...row.layerIds]
    for (const id of envelopeIds) {
      const envelope = byId.get(id)
      if (!envelope || seen.has(envelope.id)) continue
      if (!pointInEnvelope(latitude, longitude, envelope.bbox) && envelope.endpointType !== 'OFFICIAL_VIEWER') continue
      seen.add(envelope.id)
      out.push(envelope)
    }
  }
  return out
}

export function nearbyCameraCoverageForPoint(input: {
  latitude: number
  longitude: number
  nearbyCount: number
  indexLoaded?: boolean
  commanderAuthRequired?: boolean
  authRequired?: boolean
  retrievalFailed?: boolean
  radiusKm?: number
}): {
  locationState: NearbyCameraLocationState
  coveringProviders: NearbyCameraProviderEnvelope[]
  reason: string
} {
  const coveringProviders = nearbyCameraProvidersCoveringPoint(input.latitude, input.longitude)
  const federated = coverageProvidersForPoint(input.latitude, input.longitude, 'cameras')
  const radiusKm = input.radiusKm ?? 40
  const commanderPrivate = federated.filter(row => row.authModel === 'COMMANDER_PRIVATE')
  const publicApi = federated.filter(row => row.endpointType === 'API' && row.authModel === 'PUBLIC')
  const providerAuthApi = federated.filter(row => row.endpointType === 'API' && row.authModel === 'PROVIDER_AUTH')
  const queryableApi = [...publicApi, ...providerAuthApi]
  const providerAuthViewer = federated.filter(row => row.authModel === 'PROVIDER_AUTH' && row.endpointType === 'OFFICIAL_VIEWER')
  const commanderSessionMissing = Boolean(input.commanderAuthRequired ?? input.authRequired)

  if (!coveringProviders.length) {
    return {
      locationState: 'NO_COVERAGE',
      coveringProviders,
      reason: 'NO_COVERAGE — no wired public camera provider envelope contains this point. Global camera coverage remains REGIONAL / AGENCY_DEPENDENT.',
    }
  }
  // Commander session is not a global camera classifier. PUBLIC and PROVIDER_AUTH API paths
  // must not become AUTH_REQUIRED merely because the Commander is signed out.
  if (commanderSessionMissing && commanderPrivate.length > 0 && queryableApi.length === 0 && input.nearbyCount === 0) {
    return {
      locationState: 'AUTH_REQUIRED',
      coveringProviders,
      reason: `AUTH_REQUIRED — ${commanderPrivate.map(row => row.region).join(', ')} camera sources are Commander-private. This is not provider-key absence, not PUBLIC retrieval, and not NO_COVERAGE.`,
    }
  }
  if (queryableApi.length === 0 && providerAuthViewer.length > 0 && input.nearbyCount === 0) {
    return {
      locationState: 'PROVIDER_AUTH_REQUIRED',
      coveringProviders,
      reason: `PROVIDER_AUTH_REQUIRED / PARTIAL — ${providerAuthViewer.map(row => row.region).join(', ')} API credential is not configured on the server. Official live view is available. This is not Commander AUTH_REQUIRED.`,
    }
  }
  if (input.retrievalFailed && input.nearbyCount === 0) {
    return {
      locationState: 'UNAVAILABLE',
      coveringProviders,
      reason: `UNAVAILABLE — ${coveringProviders.map(row => row.agency).join(', ')} cover this region but the provider request failed. This is not AUTH_REQUIRED.`,
    }
  }
  if (input.nearbyCount === 0 && input.indexLoaded === false) {
    const agencies = coveringProviders.map(row => row.agency).join(', ')
    return {
      locationState: 'COVERED',
      coveringProviders,
      reason: `COVERED — ${agencies} cover this active Terra location. Camera catalog follows the location, not the current zoom. Markers may hide at global LOD. This is not AUTH_REQUIRED.`,
    }
  }
  if (input.nearbyCount === 0) {
    const apiProviders = coveringProviders.filter(row => row.endpointType !== 'OFFICIAL_VIEWER')
    if (!apiProviders.length) {
      return {
        locationState: 'PARTIAL',
        coveringProviders,
        reason: `PARTIAL — no redistributable camera API for this point. Official viewer: ${coveringProviders.map(row => row.agency).join(', ')}.`,
      }
    }
    return {
      locationState: 'NONE_WITHIN_RADIUS',
      coveringProviders,
      reason: `NONE WITHIN ${radiusKm} KM — ${apiProviders.map(row => row.agency).join(', ')} cover this region, but none are inside the search radius. This is not NO_COVERAGE.`,
    }
  }
  return {
    locationState: 'COVERED',
    coveringProviders,
    reason: `COVERED — ${input.nearbyCount} public still camera${input.nearbyCount === 1 ? '' : 's'} within ${radiusKm} km.`,
  }
}
