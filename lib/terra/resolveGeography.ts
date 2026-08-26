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

const RESOLVER_PROVIDER_ID: ResearchProviderId = 'nominatim'

// Whole-string match only, identical to normalizeLatentGeoDocument.ts's own strict pattern —
// nominatim's own normalized ResearchDocument.geography is either exactly "lat X, lon Y" or null,
// never ambiguous prose, so no looser matching is needed or wanted here.
const GEOGRAPHY_LAT_LON_PATTERN = /^lat (-?\d+(?:\.\d+)?), lon (-?\d+(?:\.\d+)?)$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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
  }
}
