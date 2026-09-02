/**
 * Dedicated traffic-flow normalizer — the jartic_traffic_volumes provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeWebtrisTrafficFlow.ts's
 * convention with one honest distinction: unlike WebTRIS's ~2-month-lagged batch reports, JARTIC
 * observations are genuinely recent (hourly buckets, ~2h publication lag, empirically bracketed
 * live this build) — so temporalStatus is 'current', matching reality. Raw JST timecode and
 * up/down vehicle counts are preserved verbatim; no speed, baseline, or congestion label exists
 * in this source, so none is ever invented.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeJarticTrafficFlow(documents: ResearchDocument[]): NormalizeResult {
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
      id: doc.id,
      domain: 'other',
      kind: 'traffic_flow_observation',
      providerId: 'jartic_traffic_volumes',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.observedAtIso || null,
      publishedAt: null,
      updatedAt: null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        siteId: doc.identifiers.siteId ?? null,
        // Vehicle counts only — this source publishes volume, never speed; a speed figure would
        // be fabricated, so it is never produced.
        vehicleFlowCountUp: parseFiniteNumber(doc.identifiers.vehicleFlowCountUp),
        vehicleFlowCountDown: parseFiniteNumber(doc.identifiers.vehicleFlowCountDown),
        timeCodeJst: doc.identifiers.timeCodeJst ?? null,
        roadClassCode: doc.identifiers.roadClassCode ?? null,
        observationDateJst: doc.identifiers.observationDateJst ?? null,
        observationHourBandJst: doc.identifiers.observationHourBandJst ?? null,
        rawFaultFlagsJson: doc.identifiers.rawFaultFlagsJson ?? null,
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
