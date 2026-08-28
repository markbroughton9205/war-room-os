/**
 * Dedicated traffic-event normalizer — the drivebc_events provider's own path from
 * ResearchDocument to TerraIntelligenceEvent. Parses the real inline Open511 GeoJSON geometry
 * (Point or LineString, preserved verbatim as JSON text in identifiers.rawGeography by
 * lib/research-engine/providers/drivebc_events.ts) into Terra's own TerraPointGeography /
 * TerraPathGeography — never approximated as a single point when the source supplied a real line.
 * Real event_type/severity/status vocabulary is passed straight through, matching
 * normalizeNwsAlerts.ts's CAP-preservation convention.
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult, TerraGeography } from './types'

type RawGeography = { type: 'Point' | 'LineString'; coordinates: number[] | number[][] }

function parseGeography(raw: string | undefined): TerraGeography | null {
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
    return { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' }
  }
  if (parsed.type === 'LineString') {
    const coordinates = parsed.coordinates as number[][]
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null
    return { kind: 'path', coordinates, coordinateOrigin: 'source_embedded' }
  }
  return null
}

export function normalizeDriveBcTrafficEvents(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const geography = parseGeography(doc.identifiers.rawGeography)
    if (!geography) {
      skippedCount += 1
      continue
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'other',
      kind: 'traffic_event',
      providerId: 'drivebc_events',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: doc.updatedAt,
      temporalStatus: 'current',
      geography,
      geoResolution: null,
      evidence: null,
      properties: {
        eventType: doc.identifiers.eventType ?? null,
        status: doc.identifiers.status ?? null,
        severity: doc.identifiers.severity ?? null,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        laneState: doc.identifiers.laneState ?? null,
        eventSubtypes: doc.identifiers.eventSubtypes ? doc.identifiers.eventSubtypes.split(',') : [],
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
