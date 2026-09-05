/**
 * Dedicated aircraft normalizer — the OpenSky `opensky` provider's own path from ResearchDocument
 * to TerraIntelligenceEvent, kept separate from the generic normalizeLatentGeoDocuments boundary
 * (which 8 other LATENT_GEO providers still share unchanged) rather than teaching that shared
 * function about aircraft-specific typed fields. Reads the real state-vector fields
 * lib/research-engine/providers/opensky.ts now carries in `identifiers` (altitude, velocity,
 * heading, vertical rate, on-ground state, last contact) into typed `properties` — never
 * synthesizing registration, operator, origin, destination, aircraft model, or any military
 * classification, since OpenSky's `/states/all` endpoint this adapter calls does not supply them.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeOpenSkyAircraft(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const icao24 = doc.identifiers.icao24
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (!icao24 || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    const altitudeMeters = parseFiniteNumber(doc.identifiers.altitudeMeters)
    const headingDeg = parseFiniteNumber(doc.identifiers.headingDeg)
    const velocityMps = parseFiniteNumber(doc.identifiers.velocityMps)
    const verticalRateMps = parseFiniteNumber(doc.identifiers.verticalRateMps)
    const onGround = doc.identifiers.onGround === 'true' ? true : doc.identifiers.onGround === 'false' ? false : null
    const lastContactIso = doc.identifiers.lastContactIso ?? null

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'aircraft_state',
      providerId: 'opensky',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      // The real last-contact timestamp is the honest "observed at" — falls back to the batch's
      // own publishedAt only when a single state vector's own last_contact was itself null.
      observedAt: lastContactIso ?? doc.publishedAt,
      publishedAt: null,
      updatedAt: null,
      // OpenSky states/all is always a current live position report — no historical/scheduled
      // aircraft state exists for this endpoint.
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: altitudeMeters, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        icao24,
        callsign: doc.identifiers.callsign ?? null,
        originCountry: doc.identifiers.originCountry ?? null,
        headingDeg,
        velocityMps,
        verticalRateMps,
        onGround,
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
