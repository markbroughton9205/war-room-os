/**
 * Dedicated traffic-event normalizer — the quebec_511_events provider's own path from
 * ResearchDocument to TerraIntelligenceEvent, mirroring normalizeDriveBcTrafficEvents.ts's exact
 * convention: parses the real inline WFS GeoJSON geometry (Point or LineString, preserved
 * verbatim as JSON text in identifiers.rawGeography by
 * lib/research-engine/providers/quebec_511_events.ts) into Terra's own TerraPointGeography /
 * TerraPathGeography — never approximated into a single point when the source supplied a real
 * line. The source's French event vocabulary (entrave/direction/duree/cause) is passed straight
 * through, never machine-translated.
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

export function normalizeQuebecTrafficEvents(documents: ResearchDocument[]): NormalizeResult {
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
      providerId: 'quebec_511_events',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.inForceSinceIso ?? doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: doc.updatedAt,
      temporalStatus: 'current',
      geography,
      geoResolution: null,
      evidence: null,
      properties: {
        eventType: doc.identifiers.eventType ?? null,
        road: doc.identifiers.road ?? null,
        direction: doc.identifiers.direction ?? null,
        municipality: doc.identifiers.municipality ?? null,
        duration: doc.identifiers.duration ?? null,
        cause: doc.identifiers.cause ?? null,
        consequence: doc.identifiers.consequence ?? null,
        detour: doc.identifiers.detour ?? null,
        regions: doc.identifiers.regions ?? null,
        inForceSince: doc.identifiers.inForceSinceIso ?? null,
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
