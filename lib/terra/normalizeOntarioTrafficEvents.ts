/**
 * Dedicated traffic-event normalizer — the ontario_511_events provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeDriveBcTrafficEvents.ts's
 * convention. Every Ontario 511 event this build is a point (no LineString geometry observed in
 * the real live response) — never approximated into a corridor.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeOntarioTrafficEvents(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'traffic_event',
      providerId: 'ontario_511_events',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.reportedAtIso ?? doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: doc.updatedAt,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        eventType: doc.identifiers.eventType ?? null,
        severity: doc.identifiers.severity ?? null,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        laneState: doc.identifiers.laneState ?? null,
        eventSubtypes: doc.identifiers.eventSubtypes ? [doc.identifiers.eventSubtypes] : [],
        isFullClosure: doc.identifiers.isFullClosure === 'true' ? true : doc.identifiers.isFullClosure === 'false' ? false : null,
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
