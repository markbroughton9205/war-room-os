/**
 * Terra's mapping from usgs_earthquake_feed's raw Research Engine output to the canonical
 * TerraIntelligenceEvent (Phase 2). Pure, side-effect-free: takes exactly what
 * lib/research-engine/providers/usgsEarthquakeFeed.ts's run() already produced
 * (ResearchGeoFeature[] + ResearchDocument[]) and maps it — no network call, no provider-specific
 * fetch logic here, that stays inside the existing adapter, which this function never bypasses or
 * duplicates.
 *
 * This is the one earthquake-specific mapping function in Terra. Everything downstream of its
 * output (spatial projection, Cesium rendering) is generic — see
 * lib/terra/projectTerraIntelligenceEvent.ts, which knows nothing about earthquakes.
 */
import type { ResearchDocument, ResearchGeoFeature } from '@/lib/research-engine/core/types'
import type { TerraIntelligenceEvent } from '@/lib/terra/types'

const PROVIDER_ID = 'usgs_earthquake_feed' as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GeoJSON [lon, lat, depthKm?] re-validated at this boundary — ResearchGeoFeature.coordinates is
 * typed `unknown` upstream, so this function does not trust it just because the adapter already
 * validated it once. */
function extractLonLatDepth(coordinates: unknown): { lon: number; lat: number; depthKm: number | null } | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [lon, lat, depthKm] = coordinates
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
  if (depthKm !== undefined && depthKm !== null && !isFiniteNumber(depthKm)) return null
  return { lon, lat, depthKm: isFiniteNumber(depthKm) ? depthKm : null }
}

function isoOrNull(epochMs: unknown): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null
  const iso = new Date(epochMs).toISOString()
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

export type NormalizeUsgsEarthquakeFeedResult = {
  events: TerraIntelligenceEvent[]
  /** geoFeatures that were present but had no legitimately projectable coordinates — never
   * silently dropped without being counted. */
  skippedCount: number
}

export function normalizeUsgsEarthquakeFeed(
  geoFeatures: ResearchGeoFeature[],
  documents: ResearchDocument[],
): NormalizeUsgsEarthquakeFeedResult {
  const documentsById = new Map(documents.map(doc => [doc.providerRecordId, doc]))
  const events: TerraIntelligenceEvent[] = []
  let skippedCount = 0

  for (const geoFeature of geoFeatures) {
    const point = extractLonLatDepth(geoFeature.coordinates)
    if (!point) {
      skippedCount += 1
      continue
    }

    const props = geoFeature.properties ?? {}
    const doc = documentsById.get(geoFeature.id) ?? null

    // USGS reports depth in kilometers BELOW the surface; Cesium altitude is meters above the
    // WGS84 ellipsoid — a real, intentional unit conversion (km below -> negative meters), not a
    // guess. A missing depth stays null; it is never defaulted to 0 (0 would falsely claim a
    // surface-level event).
    const altitude = point.depthKm !== null ? -(point.depthKm * 1000) : null

    // USGS's feed gives exactly two distinct timestamps: when the quake happened
    // (properties.time) and when USGS last revised the record (properties.updated). There is no
    // third, separately-meaningful "published" timestamp in this source — publishedAt is left
    // null rather than duplicating observedAt into it just to populate the field.
    const observedAt = isoOrNull(props.time) ?? doc?.publishedAt ?? null
    const updatedAt = isoOrNull(props.updated) ?? doc?.updatedAt ?? null
    const place = typeof props.place === 'string' ? props.place : null
    const magnitude = typeof props.mag === 'number' ? props.mag : null
    const title = doc?.title ?? (magnitude !== null ? `M${magnitude} — ${place ?? 'Unknown location'}` : place ?? 'Unknown location')
    const canonicalUrl = typeof props.url === 'string' ? props.url : doc?.canonicalUrl ?? null

    const provenance = doc
      ? {
          provider: doc.provenance.provider,
          sourceUrl: doc.provenance.sourceUrl || canonicalUrl,
          retrievedAt: doc.provenance.retrievedAt,
          fromCache: doc.provenance.fromCache,
          isHistorical: doc.provenance.isHistorical,
        }
      : {
          // Defensive fallback only — every real usgs_earthquake_feed response pairs each
          // geoFeature with a document sharing the same id (see the adapter's own features.map
          // for both arrays). Never expected to execute against real data.
          provider: PROVIDER_ID,
          sourceUrl: canonicalUrl,
          retrievedAt: new Date().toISOString(),
          fromCache: false,
          isHistorical: false,
        }

    events.push({
      id: geoFeature.id,
      domain: 'hazards',
      kind: 'earthquake',
      providerId: PROVIDER_ID,
      // Raw Research Engine output through the Research Engine's own provider gate, unedited —
      // this is the only layer class Phase 2 produces. See TerraLayerClass's doc comment for why
      // the other three are reserved, not defaulted-to.
      layerClass: 'observed',
      title,
      summary: doc?.summary ?? null,
      observedAt,
      publishedAt: null,
      updatedAt,
      temporalStatus: provenance.isHistorical ? 'historical' : 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude },
      // No evidence-scoring pipeline runs on raw USGS feed data this phase — honestly null, never
      // a fabricated confidence value. See TerraEvidenceClassification's doc comment.
      evidence: null,
      properties: props,
      provenance,
      rawReference: { documentId: doc?.id ?? null, providerRecordId: geoFeature.id, canonicalUrl },
    })
  }

  return { events, skippedCount }
}
