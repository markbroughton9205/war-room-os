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
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import type { TerraResolvedGeography, TerraResolvedGeographyMatch } from '@/lib/terra/types'
import type { TerraActiveLocation, TerraReverseLocationResolution } from '@/lib/terra/activeLocation'
import { reverseNominatimCoordinates } from '@/lib/research-engine/providers/nominatim'
import { isNominatimPostalType, looksLikePostalCode } from '@/lib/terra/locationCommand'
import {
  encodeNominatimStructuredSearch,
  parseUsStyleAddress,
  structuredSearchFromParsedAddress,
  type ParsedUsAddress,
} from '@/lib/terra/addressParse'
import { classifyAddressMatchQuality } from '@/lib/terra/geocodeMatchQuality'
import { selectGeocodeCandidates, type GeocodeCandidateLike } from '@/lib/terra/geocodeCandidateSelect'

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
type NominatimSearchCandidate = { lat: number; lon: number; doc: ResearchDocument } & GeocodeCandidateLike

export function selectNominatimSearchCandidate(
  queryUsed: string,
  candidates: NominatimSearchCandidate[],
): { quality: 'strong'; candidate: NominatimSearchCandidate; reason: string } | { quality: 'ambiguous'; reason: string } {
  if (candidates.length === 1) {
    return { quality: 'strong', candidate: candidates[0], reason: 'Exactly one coordinate-bearing candidate.' }
  }
  if (looksLikePostalCode(queryUsed)) {
    const postcodes = candidates.filter(candidate => isNominatimPostalType(candidate.doc.identifiers.class, candidate.doc.identifiers.type))
    if (postcodes.length === 1) {
      return { quality: 'strong', candidate: postcodes[0], reason: 'Unique Nominatim postcode match among mixed nearby features.' }
    }
    if (postcodes.length > 1) {
      return { quality: 'ambiguous', reason: `Resolver returned ${postcodes.length} distinct postcode candidates — never auto-selecting one.` }
    }
  }
  return {
    quality: 'ambiguous',
    reason: `Resolver returned ${candidates.length} distinct coordinate-bearing candidates — never auto-selecting one.`,
  }
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

function nominatimCandidateMatch(candidate: NominatimSearchCandidate): TerraResolvedGeographyMatch {
  const { class: placeClass, type: placeTypeValue, bbox_south, bbox_north, bbox_west, bbox_east } = candidate.doc.identifiers
  const houseNumber = candidate.doc.identifiers.house_number ?? candidate.houseNumber ?? null
  const road = candidate.doc.identifiers.road ?? candidate.road ?? null
  const placeType = placeClass && placeTypeValue ? `${placeClass}/${placeTypeValue}` : null
  return {
    latitude: candidate.lat,
    longitude: candidate.lon,
    label: candidate.doc.title,
    placeType,
    boundingBox: bboxFromIdentifierStrings(bbox_south, bbox_north, bbox_west, bbox_east),
    nativeName: candidate.doc.identifiers.name_native ?? null,
    englishName: candidate.doc.identifiers.name_en ?? null,
    sourceUrl: candidate.doc.canonicalUrl,
    houseNumber,
    road,
    city: candidate.doc.identifiers.city ?? candidate.city ?? null,
    state: candidate.doc.identifiers.state ?? candidate.state ?? null,
    postcode: candidate.doc.identifiers.postcode ?? candidate.postcode ?? null,
    addressMatchQuality: classifyAddressMatchQuality({
      placeClass,
      placeType: placeTypeValue,
      osmType: candidate.doc.identifiers.osm_type ?? candidate.osmType,
      houseNumber,
      road,
      requestedHouseNumber: null,
    }),
    streetMismatch: false,
  }
}

function hydrateCandidate(candidate: { lat: number; lon: number; doc: ResearchDocument }): NominatimSearchCandidate {
  const ids = candidate.doc.identifiers
  const classAndType = ids.class && ids.type ? `${ids.class}/${ids.type}` : null
  return {
    ...candidate,
    label: candidate.doc.title,
    placeClass: ids.class ?? null,
    placeType: ids.type ?? classAndType,
    osmType: ids.osm_type ?? null,
    houseNumber: ids.house_number ?? null,
    road: ids.road ?? null,
    city: ids.city ?? null,
    state: ids.state ?? null,
    postcode: ids.postcode ?? null,
  }
}

async function nominatimSearchDocuments(queryUsed: string, maxResults: number, retrievedAt: string) {
  const { summary } = await executeResearch({
    text: queryUsed,
    intent: null,
    providers: [RESOLVER_PROVIDER_ID],
    maxResults,
    dateFrom: null,
    dateTo: null,
    requireCurrent: false,
    requestedBy: 'terra-geo-resolution',
    requestedAt: retrievedAt,
  })
  return summary.providerResponses.find(r => r.provider === RESOLVER_PROVIDER_ID) ?? null
}

function candidatesFromResponse(response: { documents: ResearchDocument[] }): NominatimSearchCandidate[] {
  return response.documents
    .map(doc => {
      const match = doc.geography ? GEOGRAPHY_LAT_LON_PATTERN.exec(doc.geography) : null
      if (!match) return null
      const lat = Number(match[1])
      const lon = Number(match[2])
      if (!isFiniteNumber(lat) || lat < -90 || lat > 90 || !isFiniteNumber(lon) || lon < -180 || lon > 180) return null
      return hydrateCandidate({ lat, lon, doc })
    })
    .filter((candidate): candidate is NominatimSearchCandidate => candidate !== null)
}

function finishResolved(input: {
  sourceEntityId: string
  queryUsed: string
  retrievedAt: string
  match: TerraResolvedGeographyMatch
  requestedHouseNumber?: string | null
  structuredQuery?: boolean
}): TerraResolvedGeography {
  const addressMatchQuality = classifyAddressMatchQuality({
    placeClass: input.match.placeType?.split('/')[0],
    placeType: input.match.placeType?.split('/')[1],
    osmType: null,
    houseNumber: input.match.houseNumber,
    road: input.match.road,
    requestedHouseNumber: input.requestedHouseNumber,
    streetConflict: input.match.streetMismatch,
    candidateCount: 1,
  })
  return {
    quality: 'strong',
    longitude: input.match.longitude,
    latitude: input.match.latitude,
    altitude: null,
    resolutionMethod: 'place_name_lookup',
    resolverProviderId: RESOLVER_PROVIDER_ID,
    sourceEntityId: input.sourceEntityId,
    queryUsed: input.queryUsed,
    matchTitle: input.match.label,
    sourceUrl: input.match.sourceUrl,
    retrievedAt: input.retrievedAt,
    placeType: input.match.placeType,
    boundingBox: input.match.boundingBox,
    nativeName: input.match.nativeName,
    englishName: input.match.englishName,
    addressMatchQuality: input.match.addressMatchQuality ?? addressMatchQuality,
    houseNumber: input.match.houseNumber ?? null,
    road: input.match.road ?? null,
    city: input.match.city ?? null,
    state: input.match.state ?? null,
    postcode: input.match.postcode ?? null,
    streetMismatch: false,
    structuredQuery: input.structuredQuery ?? false,
  }
}

export async function resolvePlaceNameViaNominatim(placeName: string, sourceEntityId: string): Promise<TerraResolvedGeography> {
  const retrievedAt = new Date().toISOString()
  const queryUsed = placeName.trim()

  if (!queryUsed) {
    return { quality: 'unresolved', resolverProviderId: RESOLVER_PROVIDER_ID, sourceEntityId, queryUsed: placeName, retrievedAt, reason: 'Empty place name — nothing to resolve.' }
  }

  const parsed: ParsedUsAddress | null = parseUsStyleAddress(queryUsed)
  const structured = parsed ? structuredSearchFromParsedAddress(parsed) : null
  const postalQuery = looksLikePostalCode(queryUsed)
  const maxResults = postalQuery || parsed?.street ? 8 : 3

  const encodedStructured = structured ? encodeNominatimStructuredSearch(structured) : null
  const encodedUnstructured = parsed?.countrycodes
    ? encodeNominatimStructuredSearch({ q: queryUsed, countrycodes: parsed.countrycodes })
    : queryUsed

  let response = await nominatimSearchDocuments(encodedStructured ?? encodedUnstructured, maxResults, retrievedAt)
  if (encodedStructured && response?.ok) {
    const structuredHits = candidatesFromResponse(response)
    if (structuredHits.length === 0) {
      response = await nominatimSearchDocuments(encodedUnstructured, maxResults, retrievedAt)
    }
  }

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

  const candidates = candidatesFromResponse(response)

  if (candidates.length === 0) {
    return {
      quality: 'unresolved',
      resolverProviderId: RESOLVER_PROVIDER_ID,
      sourceEntityId,
      queryUsed,
      retrievedAt,
      structuredQuery: Boolean(encodedStructured),
      reason: 'Resolver returned no candidate with real, range-valid coordinates.',
    }
  }

  if (parsed?.street || parsed?.houseNumber) {
    const selected = selectGeocodeCandidates({
      requestedStreet: parsed.street,
      requestedHouseNumber: parsed.houseNumber,
      candidates,
      uniquePostalFallback: postalQuery
        ? rows => {
          const postcodes = rows.filter(row => isNominatimPostalType(row.doc.identifiers.class, row.doc.identifiers.type))
          return postcodes.length === 1 ? postcodes[0] : null
        }
        : undefined,
    })
    if (selected.quality === 'ambiguous') {
      return {
        quality: 'ambiguous',
        resolverProviderId: RESOLVER_PROVIDER_ID,
        sourceEntityId,
        queryUsed,
        retrievedAt,
        reason: selected.reason,
        structuredQuery: Boolean(encodedStructured),
        matches: selected.candidates.map(row => ({
          ...nominatimCandidateMatch(row),
          addressMatchQuality: 'AMBIGUOUS' as const,
          streetMismatch: /conflicts|Street ≠ Drive/.test(selected.reason),
        })),
      }
    }
    const match = nominatimCandidateMatch(selected.candidate)
    match.addressMatchQuality = selected.addressMatchQuality
    match.streetMismatch = false
    if (parsed.houseNumber && selected.addressMatchQuality !== 'ROOFTOP' && selected.addressMatchQuality !== 'INTERPOLATED') {
      match.addressMatchQuality = classifyAddressMatchQuality({
        placeClass: selected.candidate.placeClass,
        placeType: selected.candidate.placeType,
        osmType: selected.candidate.osmType,
        houseNumber: selected.candidate.houseNumber,
        road: selected.candidate.road,
        requestedHouseNumber: parsed.houseNumber,
      })
    }
    return finishResolved({
      sourceEntityId,
      queryUsed,
      retrievedAt,
      match,
      requestedHouseNumber: parsed.houseNumber,
      structuredQuery: Boolean(encodedStructured),
    })
  }

  const selected = selectNominatimSearchCandidate(queryUsed, candidates)
  if (selected.quality === 'ambiguous') {
    const listed = looksLikePostalCode(queryUsed)
      ? candidates.filter(candidate => isNominatimPostalType(candidate.doc.identifiers.class, candidate.doc.identifiers.type))
      : candidates
    return {
      quality: 'ambiguous',
      resolverProviderId: RESOLVER_PROVIDER_ID,
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: selected.reason,
      structuredQuery: Boolean(encodedStructured),
      matches: listed.map(row => nominatimCandidateMatch(row)),
    }
  }

  return finishResolved({
    sourceEntityId,
    queryUsed,
    retrievedAt,
    match: nominatimCandidateMatch(selected.candidate),
    structuredQuery: Boolean(encodedStructured),
  })
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
    nativePlaceName: null,
    englishPlaceName: null,
    status: 'coordinate_only',
    confidence: 'coordinate_only',
    detail,
    selectedAt,
    city: null,
    county: null,
    state: null,
    country: null,
    countryCode: null,
    locality: null,
    reverseNeighborhood: null,
    reverseGeocodeStatus: 'unavailable',
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
      nativePlaceName: resolution.nativeName,
      englishPlaceName: resolution.englishName,
      status: 'resolved',
      confidence: 'provider_supported',
      detail: resolution.category
        ? `Provider-supported reverse match (${resolution.category}); no numeric confidence was supplied.`
        : 'Provider-supported reverse match; no numeric confidence was supplied.',
      selectedAt,
      city: resolution.city,
      county: resolution.county,
      state: resolution.state,
      country: resolution.country,
      countryCode: resolution.countryCode,
      locality: resolution.locality,
      reverseNeighborhood: resolution.neighbourhood,
      reverseGeocodeStatus: 'ok',
    },
  }
}
