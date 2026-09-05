/**
 * Dedicated vessel normalizer — the digitraffic_marine provider's own path from ResearchDocument
 * to TerraIntelligenceEvent, mirroring lib/terra/normalizeOpenSkyAircraft.ts's exact convention: a
 * per-provider normalizer (not the generic normalizeLatentGeoDocuments boundary) so real
 * MMSI/IMO/callsign/speed/course/heading/navigation-status/destination/draught/ship-type fields
 * survive into typed properties instead of being dropped. Never synthesizes operator, flag,
 * registered owner, or any field digitraffic_marine's /locations + /vessels endpoints did not
 * themselves supply (see lib/research-engine/providers/digitraffic_marine.ts for exactly which AIS
 * sentinel values — heading 511, cog 360, sog 102.3, IMO 0, draught 0 — are already filtered to
 * `null` upstream of this function, never passed through as real values).
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeDigitrafficMarineVessels(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const mmsi = doc.identifiers.mmsi
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (!mmsi || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    const speedKnots = parseFiniteNumber(doc.identifiers.speedKnots)
    const courseDeg = parseFiniteNumber(doc.identifiers.courseDeg)
    const headingDeg = parseFiniteNumber(doc.identifiers.headingDeg)
    const draughtMeters = parseFiniteNumber(doc.identifiers.draughtMeters)
    const lastObservedIso = doc.identifiers.lastObservedIso ?? null

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'vessel_position',
      providerId: 'digitraffic_marine',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      // The real receiver-side timestampExternal is the honest "observed at" — falls back to the
      // batch's own publishedAt only when a single position report's own timestamp was itself null.
      observedAt: lastObservedIso ?? doc.publishedAt,
      publishedAt: null,
      updatedAt: null,
      // digitraffic_marine's /locations endpoint is always a current live position report — no
      // historical/scheduled vessel state exists for this endpoint.
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        mmsi,
        callSign: doc.identifiers.callSign ?? null,
        imo: doc.identifiers.imo ?? null,
        speedKnots,
        courseDeg,
        headingDeg,
        navStatCode: doc.identifiers.navStatCode ?? null,
        navStatLabel: doc.identifiers.navStatLabel ?? null,
        destination: doc.identifiers.destination ?? null,
        draughtMeters,
        shipTypeCode: doc.identifiers.shipTypeCode ?? null,
        shipTypeLabel: doc.identifiers.shipTypeLabel ?? null,
        vesselMetadataAvailable: doc.identifiers.vesselMetadataAvailable === 'true',
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
