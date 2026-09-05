/**
 * Shared traffic-event normalizer for the three WZDx providers (wzdx_wsdot, wzdx_iowa_dot,
 * wzdx_kytc) — one normalizer parameterized by providerId, mirroring the shared-adapter design
 * in lib/research-engine/providers/wzdx_shared.ts. Parses the real inline WZDx GeoJSON geometry
 * (Point, MultiPoint, or LineString — all observed in real feeds this build) into Terra's own
 * point/path geography; a MultiPoint is rendered as its first point with the full geometry
 * preserved in rawReference-adjacent properties, never silently discarded. Real WZDx fields
 * (road names, direction, vehicle_impact, start/end dates, feed update time, spec version) are
 * passed straight through.
 */
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import type { NormalizeResult, TerraGeography } from './types'

type RawGeography = { type: 'Point' | 'MultiPoint' | 'LineString'; coordinates: number[] | number[][] }

function parseGeography(raw: string | undefined): { geography: TerraGeography; geometryType: string } | null {
  if (!raw) return null
  let parsed: RawGeography
  try {
    parsed = JSON.parse(raw) as RawGeography
  } catch {
    return null
  }
  if (parsed.type === 'Point') {
    const [lon, lat] = parsed.coordinates as number[]
    if (typeof lon !== 'number' || typeof lat !== 'number') return null
    return { geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' }, geometryType: 'Point' }
  }
  if (parsed.type === 'MultiPoint') {
    const points = parsed.coordinates as number[][]
    const first = Array.isArray(points) ? points[0] : null
    if (!Array.isArray(first) || first.length < 2 || typeof first[0] !== 'number' || typeof first[1] !== 'number') return null
    return { geography: { kind: 'point', longitude: first[0], latitude: first[1], altitude: null, coordinateOrigin: 'source_embedded' }, geometryType: 'MultiPoint' }
  }
  if (parsed.type === 'LineString') {
    const coordinates = parsed.coordinates as number[][]
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null
    return { geography: { kind: 'path', coordinates, coordinateOrigin: 'source_embedded' }, geometryType: 'LineString' }
  }
  return null
}

export function normalizeWzdxWorkZones(documents: ResearchDocument[], providerId: ResearchProviderId): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const parsed = parseGeography(doc.identifiers.rawGeography)
    if (!parsed) {
      skippedCount += 1
      continue
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'traffic_event',
      providerId,
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.startDateIso ?? doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: doc.updatedAt,
      temporalStatus: 'current',
      geography: parsed.geography,
      geoResolution: null,
      evidence: null,
      properties: {
        eventType: doc.identifiers.eventType ?? 'work_zone',
        wzdxVersion: doc.identifiers.wzdxVersion ?? null,
        geometryType: parsed.geometryType,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        vehicleImpact: doc.identifiers.vehicleImpact ?? null,
        startDate: doc.identifiers.startDateIso ?? null,
        endDate: doc.identifiers.endDateIso ?? null,
        feedUpdatedAt: doc.identifiers.feedUpdatedAtIso ?? null,
      },
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
