/**
 * Terra's mapping from either USGS earthquake provider's raw Research Engine output to the
 * canonical TerraIntelligenceEvent (Phase 3). Both usgs_earthquake (lib/research-engine/providers/
 * usgsEarthquake.ts, a flexible custom-range catalog search) and usgs_earthquake_feed
 * (usgsEarthquakeFeed.ts, a fixed recent-significant-events feed) return the exact same GeoJSON
 * shape — id/geometry/properties{mag,place,time,updated,url,tsunami,alert,type,status} — so one
 * mapping function serves both, parameterized only by which providerId called it. This replaces
 * Phase 1/2's usgs_earthquake_feed-only normalizeUsgsEarthquakeFeed.ts; nothing about how
 * usgs_earthquake_feed itself is queried or cached changed, only that this mapping step is now
 * shared rather than duplicated when usgs_earthquake was promoted alongside it.
 *
 * Pure, side-effect-free: no network call, no provider-specific fetch logic here — that stays
 * inside the existing adapters, which this function never bypasses or duplicates.
 */
import type { ResearchProviderId, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from '@/lib/terra/types'

export const EARTHQUAKE_PROVIDER_IDS = ['usgs_earthquake', 'usgs_earthquake_feed'] as const
export type UsgsEarthquakeProviderId = (typeof EARTHQUAKE_PROVIDER_IDS)[number]

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

export function normalizeUsgsEarthquakeGeoFeatures(providerId: UsgsEarthquakeProviderId, response: ResearchProviderResponse): NormalizeResult {
  const documentsById = new Map(response.documents.map(doc => [doc.providerRecordId, doc]))
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const geoFeature of response.geoFeatures) {
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

    // Both USGS earthquake sources give exactly two distinct timestamps: when the quake happened
    // (properties.time) and when USGS last revised the record (properties.updated). Neither
    // exposes a third, separately-meaningful "published" timestamp — publishedAt is left null
    // rather than duplicating observedAt into it just to populate the field.
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
          // Defensive fallback only — every real response from either provider pairs each
          // geoFeature with a document sharing the same id (see each adapter's own features.map
          // for both arrays). Never expected to execute against real data.
          provider: providerId as ResearchProviderId,
          sourceUrl: canonicalUrl,
          retrievedAt: new Date().toISOString(),
          fromCache: false,
          isHistorical: false,
        }

    events.push({
      id: geoFeature.id,
      domain: 'hazards',
      kind: 'earthquake',
      providerId,
      layerClass: 'observed',
      title,
      summary: doc?.summary ?? null,
      observedAt,
      publishedAt: null,
      updatedAt,
      temporalStatus: provenance.isHistorical ? 'historical' : 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude },
      // No evidence-scoring pipeline runs on raw USGS feed data this phase — honestly null, never
      // a fabricated confidence value.
      evidence: null,
      properties: props,
      provenance,
      rawReference: { documentId: doc?.id ?? null, providerRecordId: geoFeature.id, canonicalUrl },
    })
  }

  return { events, skippedCount }
}
