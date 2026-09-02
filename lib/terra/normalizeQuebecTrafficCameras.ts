/**
 * Dedicated traffic-camera normalizer — the quebec_511_cameras provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeOntarioTrafficCameras.ts's
 * convention. Two honest distinctions from Ontario, both live-confirmed this build:
 *   - Québec's URL_FLUX_DONNEE is an HTML viewer page, NOT a direct JPEG — so imageUrl is always
 *     null here (the viewer page is preserved in provenance/canonicalUrl, never misrepresented
 *     as a proxyable image).
 *   - The WFS metadata carries no per-image capture timestamp or refresh interval — freshness is
 *     honestly 'unknown' via the standard roadCameraStaleness fallthrough.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'
import { resolveTerraCameraFreshness } from './roadCameraStaleness'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeQuebecTrafficCameras(documents: ResearchDocument[]): NormalizeResult {
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
      providerId: 'quebec_511_cameras',
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
        // Always null — see file header. Never fabricate a direct-image URL from the viewer page.
        imageUrl: null,
        viewerUrl: doc.canonicalUrl,
        road: doc.identifiers.road ?? null,
        region: doc.identifiers.region ?? null,
        descriptionFr: doc.identifiers.descriptionFr ?? null,
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
