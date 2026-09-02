/**
 * Dedicated traffic-flow normalizer — the webtris provider's own path from ResearchDocument to
 * TerraIntelligenceEvent. temporalStatus is always 'historical' and provenance.isHistorical is
 * always true, matching lib/research-engine/providers/webtris.ts's confirmed live finding: this
 * source's own most recent available data lags real time by roughly two months. Never forced to
 * 'current' for display consistency with Terra's other, genuinely live layers — see this repo's
 * God's Eye Phase 2 report for the full discrepancy record.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeWebtrisTrafficFlow(documents: ResearchDocument[]): NormalizeResult {
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
      kind: 'traffic_flow_observation',
      providerId: 'webtris',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.observedAtIso ?? doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: null,
      // Always 'historical' — see file header. This is the one honest, source-forced exception to
      // the "current" default every other Phase 1-5 observed layer uses.
      temporalStatus: 'historical',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        siteId: doc.identifiers.siteId ?? null,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        speedMph: parseFiniteNumber(doc.identifiers.speedMph),
        vehicleFlowCount: parseFiniteNumber(doc.identifiers.vehicleFlowCount),
        // Never supplied by WebTRIS — never invented here. A consumer must never compute a
        // congestion percentage without a real baseline to compare against.
        freeFlowSpeedMph: null,
        reportDate: doc.identifiers.reportDate ?? null,
        isHistoricalBatchReport: true,
      },
      provenance: {
        provider: doc.provenance.provider,
        sourceUrl: doc.provenance.sourceUrl || doc.canonicalUrl,
        retrievedAt: doc.provenance.retrievedAt,
        fromCache: doc.provenance.fromCache,
        isHistorical: true,
      },
      rawReference: { documentId: doc.id, providerRecordId: doc.providerRecordId, canonicalUrl: doc.canonicalUrl },
    })
  }

  return { events, skippedCount }
}
