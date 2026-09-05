/**
 * Dedicated traffic-camera normalizer — the digitraffic_road_cameras provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring lib/terra/normalizeDigitrafficMarineVessels.ts's
 * exact convention: a per-provider normalizer so real road/direction/collection-interval/capture-
 * time fields survive into typed properties instead of being dropped. Never synthesizes a
 * direction, road, or capture time the source didn't itself supply — every optional identifier is
 * only present on the document when lib/research-engine/providers/digitraffic_road_cameras.ts
 * itself extracted it.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'
import { resolveTerraCameraFreshness } from './roadCameraStaleness'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeDigitrafficRoadCameras(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0
  // Computed once per normalize call (not per-document) — matches this codebase's other
  // "freshness relative to when the feed was fetched" convention (e.g. TerraShell's own coverage
  // resolvers), not a per-render clock.
  const nowIso = new Date().toISOString()

  for (const doc of documents) {
    const presetId = doc.identifiers.presetId
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (!presetId || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    const imageUrl = doc.identifiers.imageUrl ?? null
    const collectionIntervalSec = parseFiniteNumber(doc.identifiers.collectionIntervalSec)
    const measuredTimeIso = doc.identifiers.measuredTimeIso ?? null
    const collectionStatus = doc.identifiers.collectionStatus ?? null
    const sourceReportsUnavailable = collectionStatus !== null && collectionStatus !== 'GATHERING'

    const freshness = resolveTerraCameraFreshness({
      feedType: 'still',
      refreshIntervalSec: collectionIntervalSec,
      capturedAtIso: measuredTimeIso,
      nowIso,
      sourceReportsUnavailable,
    })

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'traffic_camera',
      providerId: 'digitraffic_road_cameras',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: measuredTimeIso ?? doc.publishedAt,
      publishedAt: null,
      updatedAt: null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        stationId: doc.identifiers.stationId ?? null,
        presetId,
        feedType: 'still',
        imageUrl,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        resolution: doc.identifiers.resolution ?? null,
        collectionIntervalSec,
        collectionStatus,
        capturedAt: measuredTimeIso,
        freshness,
        detailEnriched: doc.identifiers.detailEnriched === 'true',
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
