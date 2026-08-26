import 'server-only'

/**
 * Terra's controlled geo-resolution boundary (Phase 4) — the ONLY place in Terra allowed to turn
 * a place NAME into coordinates. Every other normalizer (normalizeLatentGeoDocument.ts, the
 * DIRECT_GEO normalizers) only ever uses coordinates a provider already supplied; this module is
 * reserved for ENTITY_GEO_RESOLVABLE sources whose geography is real but named, never coordinate.
 *
 *   source record -> TerraIntelligenceEvent (geography: null)
 *     -> resolvePlaceNameViaNominatim() (this file)
 *     -> TerraResolvedGeography (provenance + categorical match quality, never a fake confidence
 *        score)
 *     -> merged onto the event's geography before projection
 *
 * Cesium/UI components never call this directly — only a layer's own normalize step
 * (lib/terra/layerCatalog.ts) does, matching the mission's "do not hide resolution inside random
 * provider normalizers, do not make Cesium/UI perform resolution" requirement by keeping it in
 * exactly one, explicit, generic place.
 *
 * Resolver: reuses the EXISTING nominatim Research Engine provider through executeResearch() —
 * the same single Research Engine entry point every other caller uses. No second HTTP client, no
 * new external geocoding service: nominatim is already a live-verified, zero-auth,
 * general-purpose place-name resolver Terra promotes as its own LATENT_GEO layer this same phase
 * (lib/terra/layerCatalog.ts), and repository truth showed no more suitable existing capability
 * for free-text place-name resolution (geonames requires a username most deployments won't have
 * configured; wikidata's SPARQL surface is not a simple name lookup).
 *
 * Ambiguity handling is strict, per the Phase 4 mission's explicit requirement: 0 real
 * coordinate-bearing candidates -> 'unresolved'; exactly 1 -> 'strong'; 2 or more -> 'ambiguous',
 * never auto-selecting the resolver's "top" result. Only 'exact'/'strong' results carry
 * coordinates at all — 'ambiguous'/'unresolved' results are structurally incapable of being
 * projected onto the globe (see TerraResolvedGeography's own discriminated union in
 * lib/terra/types.ts).
 */
import { executeResearch } from '@/lib/research-engine/core/execute'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { TerraResolvedGeography } from '@/lib/terra/types'
import type { TerraActiveLocation, TerraReverseLocationResolution } from '@/lib/terra/activeLocation'
import { reverseNominatimCoordinates } from '@/lib/research-engine/providers/nominatim'

const RESOLVER_PROVIDER_ID: ResearchProviderId = 'nominatim'

// Whole-string match only, identical to normalizeLatentGeoDocument.ts's own strict pattern —
// nominatim's own normalized ResearchDocument.geography is either exactly "lat X, lon Y" or null,
// never ambiguous prose, so no looser matching is needed or wanted here.
const GEOGRAPHY_LAT_LON_PATTERN = /^lat (-?\d+(?:\.\d+)?), lon (-?\d+(?:\.\d+)?)$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Parses the four bbox_* identifier strings nominatim.ts attaches onto a search document (see
 * that file's `search()`) back into a real bounding box — undefined/malformed input honestly
 * yields `null`, never a guessed or zero-sized box. */
function bboxFromIdentifierStrings(south?: string, north?: string, west?: string, east?: string): { south: number; north: number; west: number; east: number } | null {
  if (south === undefined || north === undefined || west === undefined || east === undefined) return null
  const parsed = { south: Number(south), north: Number(north), west: Number(west), east: Number(east) }
  if (!Object.values(parsed).every(isFiniteNumber)) return null
  if (parsed.south > parsed.north || parsed.west > parsed.east) return null
  return parsed
}

export async function resolvePlaceNameViaNominatim(placeName: string, sourceEntityId: string): Promise<TerraResolvedGeography> {
  const retrievedAt = new Date().toISOString()
  const queryUsed = placeName.trim()

  if (!queryUsed) {
    return { quality: 'unresolved', resolverProviderId: RESOLVER_PROVIDER_ID, sourceEntityId, queryUsed: placeName, retrievedAt, reason: 'Empty place name — nothing to resolve.' }
  }

  const { summary } = await executeResearch({
    text: queryUsed,
    intent: null,
    providers: [RESOLVER_PROVIDER_ID],
    // A small, fixed candidate window — just enough to distinguish "one clear match" from "the
    // name is genuinely ambiguous," never a large result set implying a browse/search UI.
    maxResults: 3,
    dateFrom: null,
    dateTo: null,
    requireCurrent: false,
    requestedBy: 'terra-geo-resolution',
    requestedAt: retrievedAt,
  })

  const response = summary.providerResponses.find(r => r.provider === RESOLVER_PROVIDER_ID) ?? null
  if (!response || !response.ok) {
    return {
      quality: 'unresolved',
      resolverProviderId: RESOLVER_PROVIDER_ID,
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: response?.error?.message ?? 'Resolver did not respond.',
    }
  }

  const candidates = response.documents
    .map(doc => {
      const match = doc.geography ? GEOGRAPHY_LAT_LON_PATTERN.exec(doc.geography) : null
      if (!match) return null
      const lat = Number(match[1])
      const lon = Number(match[2])
      if (!isFiniteNumber(lat) || lat < -90 || lat > 90 || !isFiniteNumber(lon) || lon < -180 || lon > 180) return null
      return { lat, lon, doc }
    })
    .filter((candidate): candidate is { lat: number; lon: number; doc: (typeof response.documents)[number] } => candidate !== null)

  if (candidates.length === 0) {
    return {
      quality: 'unresolved',
      resolverProviderId: RESOLVER_PROVIDER_ID,
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: 'Resolver returned no candidate with real, range-valid coordinates.',
    }
  }
  if (candidates.length > 1) {
    return {
      quality: 'ambiguous',
      resolverProviderId: RESOLVER_PROVIDER_ID,
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `Resolver returned ${candidates.length} distinct coordinate-bearing candidates — never auto-selecting one.`,
    }
  }

  const only = candidates[0]
  const { class: placeClass, type: placeTypeValue, bbox_south, bbox_north, bbox_west, bbox_east } = only.doc.identifiers
  const boundingBox = bboxFromIdentifierStrings(bbox_south, bbox_north, bbox_west, bbox_east)
  return {
    quality: 'strong',
    longitude: only.lon,
    latitude: only.lat,
    altitude: null,
    resolutionMethod: 'place_name_lookup',
    resolverProviderId: RESOLVER_PROVIDER_ID,
    sourceEntityId,
    queryUsed,
    matchTitle: only.doc.title,
    sourceUrl: only.doc.canonicalUrl,
    retrievedAt,
    placeType: placeClass && placeTypeValue ? `${placeClass}/${placeTypeValue}` : null,
    boundingBox,
  }
}

export async function reverseResolveCoordinatesViaNominatim(input: {
  latitude: number
  longitude: number
  height: number | null
  hasTerrainHeight: boolean
  selectedAt?: string
}): Promise<TerraReverseLocationResolution> {
  const selectedAt = input.selectedAt ?? new Date().toISOString()
  const coordinateLabel = `${input.latitude.toFixed(4)}°, ${input.longitude.toFixed(4)}°`
  const coordinateOnly = (detail: string): TerraActiveLocation => ({
    latitude: input.latitude,
    longitude: input.longitude,
    height: input.height,
    hasTerrainHeight: input.hasTerrainHeight,
    label: coordinateLabel,
    place: null,
    address: null,
    region: null,
    source: 'coordinates',
    sourceLabel: 'Commander-selected coordinates',
    sourceUrl: null,
    status: 'coordinate_only',
    confidence: 'coordinate_only',
    detail,
    selectedAt,
  })

  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 ||
      !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    return { status: 'coordinate_only', location: coordinateOnly('Coordinates are outside valid geographic ranges; no provider lookup was attempted.') }
  }

  const resolution = await reverseNominatimCoordinates(input.latitude, input.longitude)
  if (!resolution.ok) {
    return { status: 'coordinate_only', location: coordinateOnly(`Reverse geocoding unavailable: ${resolution.reason}`) }
  }

  return {
    status: 'resolved',
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      height: input.height,
      hasTerrainHeight: input.hasTerrainHeight,
      label: resolution.label,
      place: resolution.place,
      address: resolution.address,
      region: resolution.region,
      source: 'nominatim',
      sourceLabel: 'OpenStreetMap Nominatim',
      sourceUrl: resolution.sourceUrl,
      status: 'resolved',
      confidence: 'provider_supported',
      detail: resolution.category
        ? `Provider-supported reverse match (${resolution.category}); no numeric confidence was supplied.`
        : 'Provider-supported reverse match; no numeric confidence was supplied.',
      selectedAt,
    },
  }
}
