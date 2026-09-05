/**
 * Terra's mapping from nasa_eonet's raw Research Engine output to TerraIntelligenceEvent (Phase
 * 5). One normalizer serves three real Terra layers (wildfire_incident, volcano_event,
 * flood_event) — parameterized by kind/domain, matching the same "one shared function, several
 * catalog entries" pattern normalizeUsgsEarthquakeGeoFeatures.ts already established for
 * usgs_earthquake/usgs_earthquake_feed. DIRECT_GEO: EONET's own structured lat/lon (the most
 * recent real observation in the event's geometry history) is used as-is.
 */
import type { ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { NormalizeResult, TerraIntelligenceDomain, TerraIntelligenceEventKind } from '@/lib/terra/types'

const PROVIDER_ID = 'nasa_eonet' as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function extractLonLat(coordinates: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [lon, lat] = coordinates
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
  return { lon, lat }
}

export type NormalizeNasaEonetOptions = { kind: TerraIntelligenceEventKind; domain: TerraIntelligenceDomain }

export function normalizeNasaEonet(response: ResearchProviderResponse, options: NormalizeNasaEonetOptions): NormalizeResult {
  const documentsById = new Map(response.documents.map(doc => [doc.providerRecordId, doc]))
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const geoFeature of response.geoFeatures) {
    const point = extractLonLat(geoFeature.coordinates)
    if (!point) {
      skippedCount += 1
      continue
    }
    const props = geoFeature.properties ?? {}
    const doc = documentsById.get(geoFeature.id) ?? null

    const provenance = doc
      ? { provider: doc.provenance.provider, sourceUrl: doc.provenance.sourceUrl || doc.canonicalUrl, retrievedAt: doc.provenance.retrievedAt, fromCache: doc.provenance.fromCache, isHistorical: doc.provenance.isHistorical }
      : { provider: PROVIDER_ID, sourceUrl: null, retrievedAt: new Date().toISOString(), fromCache: false, isHistorical: false }

    events.push({
      id: geoFeature.id,
      domain: options.domain,
      kind: options.kind,
      providerId: PROVIDER_ID,
      layerClass: 'observed',
      title: doc?.title ?? (typeof props.title === 'string' ? props.title : geoFeature.id),
      summary: doc?.summary ?? null,
      observedAt: typeof props.date === 'string' ? props.date : null,
      publishedAt: null,
      updatedAt: typeof props.date === 'string' ? props.date : null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude: null, coordinateOrigin: 'observed' },
      geoResolution: null,
      // No evidence-scoring pipeline runs on raw EONET data this phase — honestly null.
      evidence: null,
      properties: props,
      provenance,
      rawReference: { documentId: doc?.id ?? null, providerRecordId: geoFeature.id, canonicalUrl: doc?.canonicalUrl ?? null },
    })
  }

  return { events, skippedCount }
}
