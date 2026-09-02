/**
 * Dedicated traffic-camera normalizer — the hong_kong_td_cameras provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeOntarioTrafficCameras.ts's
 * convention. Freshness is honestly 'unknown' — the data.gov.hk camera-locations CSV reports no
 * per-image capture timestamp or refresh-interval field, so resolveTerraCameraFreshness correctly
 * falls through to 'unknown' rather than a guessed value. The image URL is the source's own
 * documented direct-JPEG pattern (tdcctv.data.one.gov.hk/{key}.JPG), live-verified this build.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'
import { resolveTerraCameraFreshness } from './roadCameraStaleness'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeHongKongTrafficCameras(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0
  const nowIso = new Date().toISOString()

  for (const doc of documents) {
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    const freshness = resolveTerraCameraFreshness({
      feedType: 'still',
      refreshIntervalSec: null,
      capturedAtIso: null,
      nowIso,
      sourceReportsUnavailable: false,
    })

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'traffic_camera',
      providerId: 'hong_kong_td_cameras',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: null,
      publishedAt: null,
      updatedAt: null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        cameraId: doc.identifiers.cameraId ?? null,
        feedType: 'still',
        // The source-documented direct-JPEG URL — a real image, live-verified this build.
        imageUrl: doc.identifiers.imageUrl ?? null,
        region: doc.identifiers.region ?? null,
        district: doc.identifiers.district ?? null,
        capturedAt: null,
        freshness,
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
