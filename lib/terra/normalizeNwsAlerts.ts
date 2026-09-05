/**
 * Terra's mapping from nws_weather's alerts-mode raw Research Engine output to
 * TerraIntelligenceEvent (Phase 5) — the first real TerraRegionGeography (polygon) producer.
 *
 * A CAP alert with `geometry: null` (zone-only — areaDesc is a real but compound, multi-county
 * text string, e.g. "Hamilton; Kearny; Stanton...") is honestly skipped, never geo-resolved: a
 * compound county list is exactly the kind of ambiguous input the geo-resolution boundary
 * (lib/terra/resolveGeography.ts) is deliberately strict against, and a fabricated
 * single-point/bounding-box guess would misrepresent a real multi-area warning. Similarly, a
 * MultiPolygon alert already has no geoFeature by the time this function sees it (filtered
 * upstream in lib/research-engine/providers/nwsWeather.ts) and is skipped the same honest way.
 *
 * Expired alerts are marked temporalStatus: 'historical', never presented as currently active —
 * the real NWS `expires` timestamp decides this, not an inferred War Room judgment.
 */
import type { ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from '@/lib/terra/types'

const PROVIDER_ID = 'nws_weather' as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GeoJSON Polygon.coordinates re-validated at this boundary — ResearchGeoFeature.coordinates is
 * typed `unknown` upstream. Rejects anything that isn't a real array-of-rings-of-[lon,lat]. */
function extractPolygonRings(coordinates: unknown): number[][][] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null
  const rings: number[][][] = []
  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < 3) return null
    const validatedRing: number[][] = []
    for (const vertex of ring) {
      if (!Array.isArray(vertex) || vertex.length < 2) return null
      const [lon, lat] = vertex
      if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
      if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
      validatedRing.push([lon, lat])
    }
    rings.push(validatedRing)
  }
  return rings
}

export function normalizeNwsAlerts(response: ResearchProviderResponse): NormalizeResult {
  const geoFeaturesById = new Map(response.geoFeatures.map(feature => [feature.id, feature]))
  const events: NormalizeResult['events'] = []
  let skippedCount = 0
  const now = new Date().toISOString()

  for (const doc of response.documents) {
    const geoFeature = doc.providerRecordId ? geoFeaturesById.get(doc.providerRecordId) : undefined
    if (!geoFeature) {
      // Zone-only alert (no real polygon) — honestly skipped, never resolved from areaDesc.
      skippedCount += 1
      continue
    }
    const rings = extractPolygonRings(geoFeature.coordinates)
    if (!rings) {
      skippedCount += 1
      continue
    }

    const expires = doc.identifiers.expires ?? null
    const isExpired = expires !== null && expires < now

    events.push({
      id: doc.providerRecordId as string,
      domain: 'hazards',
      kind: 'severe_weather_alert',
      providerId: PROVIDER_ID,
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.publishedAt,
      publishedAt: null,
      updatedAt: doc.updatedAt,
      temporalStatus: isExpired ? 'historical' : 'current',
      geography: { kind: 'region', rings, coordinateOrigin: 'observed' },
      geoResolution: null,
      // NWS supplies its own real severity/urgency/certainty (preserved verbatim in
      // identifiers/properties below) — not War Room's evidence-corroboration pipeline, so
      // honestly null here rather than conflating the two scales.
      evidence: null,
      properties: { ...doc.identifiers, geoFeatureProperties: geoFeature.properties },
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
