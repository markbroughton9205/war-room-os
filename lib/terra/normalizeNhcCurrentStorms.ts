/**
 * Terra's mapping from nhc_current_storms' raw Research Engine output to TerraIntelligenceEvent
 * (Phase 5) — the "active hurricanes" gap Terra Phase 0 identified, now closed. DIRECT_GEO: NHC's
 * own structured lat/lon is used as-is, never resolved or geocoded.
 *
 * Represents current observed position only. The real forecast track/track cone/best track exist
 * as NHC products but are only published as zip/KMZ GIS files — not parsed into a forecast track
 * geometry this phase (see lib/terra/types.ts's TerraRegionGeography doc comment). Their real URLs
 * are preserved in `properties` so a Commander can open them directly, never fabricated as an
 * inline track.
 */
import type { ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from '@/lib/terra/types'

const PROVIDER_ID = 'nhc_current_storms' as const

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

export function normalizeNhcCurrentStorms(response: ResearchProviderResponse): NormalizeResult {
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
    const name = typeof props.name === 'string' ? props.name : geoFeature.id
    const classification = typeof props.classification === 'string' ? props.classification : null

    const provenance = doc
      ? { provider: doc.provenance.provider, sourceUrl: doc.provenance.sourceUrl || doc.canonicalUrl, retrievedAt: doc.provenance.retrievedAt, fromCache: doc.provenance.fromCache, isHistorical: doc.provenance.isHistorical }
      : { provider: PROVIDER_ID, sourceUrl: null, retrievedAt: new Date().toISOString(), fromCache: false, isHistorical: false }

    events.push({
      id: geoFeature.id,
      domain: 'hazards',
      kind: 'tropical_cyclone',
      providerId: PROVIDER_ID,
      layerClass: 'observed',
      title: doc?.title ?? `${classification ?? 'Cyclone'} ${name}`,
      summary: doc?.summary ?? null,
      observedAt: typeof props.lastUpdate === 'string' ? props.lastUpdate : null,
      publishedAt: null,
      updatedAt: typeof props.lastUpdate === 'string' ? props.lastUpdate : null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude: null, coordinateOrigin: 'observed' },
      geoResolution: null,
      // No evidence-scoring pipeline runs on raw NHC data this phase — honestly null.
      evidence: null,
      properties: props,
      provenance,
      rawReference: { documentId: doc?.id ?? null, providerRecordId: geoFeature.id, canonicalUrl: doc?.canonicalUrl ?? null },
    })
  }

  return { events, skippedCount }
}
