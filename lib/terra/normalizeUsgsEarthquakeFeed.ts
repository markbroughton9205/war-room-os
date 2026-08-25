/**
 * Terra's normalization boundary for usgs_earthquake_feed — the only provider wired into Terra
 * this phase. Pure, side-effect-free: takes exactly what lib/research-engine/providers/
 * usgsEarthquakeFeed.ts's run() already produced (ResearchGeoFeature[] + ResearchDocument[]) and
 * projects it into TerraGeoFeature[]. No network call, no provider-specific fetch logic here —
 * that stays inside the existing adapter, which this function never bypasses or duplicates.
 */
import type { ResearchDocument, ResearchGeoFeature } from '@/lib/research-engine/core/types'
import type { TerraGeoFeature } from '@/lib/terra/types'

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
  features: TerraGeoFeature[]
  /** geoFeatures that were present but had no legitimately projectable coordinates. */
  skippedCount: number
}

export function normalizeUsgsEarthquakeFeed(
  geoFeatures: ResearchGeoFeature[],
  documents: ResearchDocument[],
): NormalizeUsgsEarthquakeFeedResult {
  const documentsById = new Map(documents.map(doc => [doc.providerRecordId, doc]))
  const features: TerraGeoFeature[] = []
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

    const timestamp = isoOrNull(props.time) ?? doc?.publishedAt ?? null
    const place = typeof props.place === 'string' ? props.place : null
    const magnitude = typeof props.mag === 'number' ? props.mag : null
    const title = doc?.title ?? (magnitude !== null ? `M${magnitude} — ${place ?? 'Unknown location'}` : place ?? 'Unknown location')
    const canonicalUrl = typeof props.url === 'string' ? props.url : doc?.canonicalUrl ?? null

    features.push({
      id: geoFeature.id,
      providerId: PROVIDER_ID,
      kind: PROVIDER_ID,
      longitude: point.lon,
      latitude: point.lat,
      altitude,
      timestamp,
      title,
      summary: doc?.summary ?? null,
      properties: props,
      provenance: doc
        ? {
            provider: doc.provenance.provider,
            sourceUrl: doc.provenance.sourceUrl || canonicalUrl,
            retrievedAt: doc.provenance.retrievedAt,
            fromCache: doc.provenance.fromCache,
            isHistorical: doc.provenance.isHistorical,
          }
        : {
            // Defensive fallback only — every real usgs_earthquake_feed response pairs each
            // geoFeature with a document sharing the same id (see the adapter's own
            // features.map for both arrays). Never expected to execute against real data.
            provider: PROVIDER_ID,
            sourceUrl: canonicalUrl,
            retrievedAt: new Date().toISOString(),
            fromCache: false,
            isHistorical: false,
          },
      rawReference: { documentId: doc?.id ?? null, canonicalUrl },
    })
  }

  return { features, skippedCount }
}
