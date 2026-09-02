/**
 * Dedicated traffic-camera normalizer — the ontario_511_cameras provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeDigitrafficRoadCameras.ts's
 * convention. Freshness is honestly 'unknown' — 511on.ca's /cameras metadata endpoint reports no
 * per-image capture timestamp or refresh-interval field (unlike Digitraffic's /stations/data),
 * so resolveTerraCameraFreshness correctly falls through to 'unknown' rather than a guessed value.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'
import { resolveTerraCameraFreshness } from './roadCameraStaleness'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeOntarioTrafficCameras(documents: ResearchDocument[]): NormalizeResult {
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
      providerId: 'ontario_511_cameras',
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
        viewId: doc.identifiers.viewId ?? null,
        feedType: 'still',
        // The raw 511on.ca view URL — a direct JPEG (verified live this build), never a viewer
        // page. app/api/terra/camera-image/route.ts proxies this on demand rather than the
        // browser hotlinking it directly, per this phase's camera-image proxy boundary.
        imageUrl: doc.identifiers.imageUrl ?? null,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        viewDescription: doc.identifiers.viewDescription ?? null,
        source: doc.identifiers.source ?? null,
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
