/**
 * The one reusable extraction boundary for "LATENT_GEO" Research Engine providers — ones whose
 * real response already contains real coordinates, just not in ResearchGeoFeature's structured
 * form (see docs/earth-knowledge and the Terra Phase 0 report's capability matrix). Operates
 * purely on the already-standard ResearchDocument shape, so it needs no per-provider knowledge of
 * any raw upstream response format — every provider whose adapter already normalizes into
 * ResearchDocument can be checked by this one function.
 *
 * Reconciled against current provider code for this phase (do not trust the Phase 0 report's
 * count blindly): of the 11 providers Phase 0 flagged as LATENT_GEO by a loose "contains a lat/lon
 * string somewhere" grep, only 8 actually expose coordinates in a cleanly, reliably parseable
 * field:
 *   - 6 via ResearchDocument.geography as an exact "lat X, lon Y" string: idai_gazetteer,
 *     nominatim, opensky, pleiades, ohm_overpass, osm_overpass.
 *   - 2 via ResearchDocument.identifiers.latitude/longitude: met_no, open_meteo.
 * The other 3 do NOT qualify, confirmed by reading their adapters, not assumed:
 *   - gbif: real decimalLatitude/decimalLongitude exist, but end up interpolated into the
 *     free-text `summary` sentence, never in a structured field. Extracting them would mean
 *     regex-parsing prose, not reading structured data — treated as MISSING, not attempted.
 *   - obis: real decimalLatitude/decimalLongitude are computed into a local variable and then
 *     never assigned to any ResearchDocument field at all (a real, pre-existing adapter gap,
 *     not this file's bug to paper over — see the Phase 3 report's Architectural Debt section).
 *   - whg: `geography` is the coordinate string ONLY when the record has no country codes;
 *     otherwise it holds a country-code list. This function's strict whole-string match already
 *     handles that correctly (a country-code list never matches the lat/lon pattern), so whg is
 *     usable, just with a lower real hit rate than the other 6 — not a special case to code
 *     around, a natural consequence of matching precisely.
 *
 * Deliberately does NOT geocode, infer, or guess a coordinate from a place name — a document with
 * no reliably-parseable coordinate returns no event from this function, never a fabricated one.
 */
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import type { NormalizeResult, TerraIntelligenceDomain, TerraIntelligenceEventKind } from '@/lib/terra/types'

// Whole-string match only — "lat 51.5, lon -0.1" matches; "10km SW of Somewhere" or "US, FR, DE"
// do not. Deliberately stricter than a substring/`.includes()` check so a document whose
// `geography` field happens to contain the word "lat" elsewhere in a longer sentence (e.g. a
// place name) is never misread as a coordinate.
const GEOGRAPHY_LAT_LON_PATTERN = /^lat (-?\d+(?:\.\d+)?), lon (-?\d+(?:\.\d+)?)$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function extractFromGeographyString(geography: string | null): { lon: number; lat: number } | null {
  if (!geography) return null
  const match = GEOGRAPHY_LAT_LON_PATTERN.exec(geography)
  if (!match) return null
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
  return { lat, lon }
}

function extractFromIdentifiers(identifiers: Record<string, string>): { lon: number; lat: number } | null {
  const latRaw = identifiers.latitude
  const lonRaw = identifiers.longitude
  if (latRaw === undefined || lonRaw === undefined) return null
  const lat = Number(latRaw)
  const lon = Number(lonRaw)
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
  return { lat, lon }
}

export type NormalizeLatentGeoDocumentsOptions = {
  providerId: ResearchProviderId
  kind: TerraIntelligenceEventKind
  domain: TerraIntelligenceDomain
}

export function normalizeLatentGeoDocuments(documents: ResearchDocument[], options: NormalizeLatentGeoDocumentsOptions): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const point = extractFromGeographyString(doc.geography) ?? extractFromIdentifiers(doc.identifiers)
    if (!point) {
      skippedCount += 1
      continue
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: options.domain,
      kind: options.kind,
      providerId: options.providerId,
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.publishedAt,
      publishedAt: null,
      updatedAt: doc.updatedAt,
      temporalStatus: doc.provenance.isHistorical ? 'historical' : 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      // No evidence-scoring pipeline runs on raw Research Engine documents this phase — honestly
      // null, never a fabricated confidence value.
      evidence: null,
      properties: { ...doc.identifiers, subjects: doc.subjects },
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
