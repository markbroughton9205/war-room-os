/**
 * Dedicated road-weather normalizer — the digitraffic_road_weather provider's own path from
 * ResearchDocument to TerraIntelligenceEvent. Every field is null when the source didn't report it
 * for that station reading — never synthesized, matching this codebase's other per-provider
 * normalizer conventions (normalizeDigitrafficRoadCameras.ts, normalizeDriveBcTrafficEvents.ts).
 */
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from './types'

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function normalizeDigitrafficRoadWeather(documents: ResearchDocument[]): NormalizeResult {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const doc of documents) {
    const lat = parseFiniteNumber(doc.identifiers.latitude)
    const lon = parseFiniteNumber(doc.identifiers.longitude)
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skippedCount += 1
      continue
    }

    let rawSensorCodes: Record<string, string> | null = null
    if (doc.identifiers.rawSensorCodesJson) {
      try {
        rawSensorCodes = JSON.parse(doc.identifiers.rawSensorCodesJson) as Record<string, string>
      } catch {
        rawSensorCodes = null
      }
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'weather',
      kind: 'road_weather_observation',
      providerId: 'digitraffic_road_weather',
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.identifiers.measuredTimeIso ?? doc.publishedAt,
      publishedAt: doc.publishedAt,
      updatedAt: null,
      temporalStatus: 'current',
      geography: { kind: 'point', longitude: lon, latitude: lat, altitude: null, coordinateOrigin: 'source_embedded' },
      geoResolution: null,
      evidence: null,
      properties: {
        stationId: doc.identifiers.stationId ?? null,
        collectionStatus: doc.identifiers.collectionStatus ?? null,
        sourceReportsUnavailable: doc.identifiers.sourceReportsUnavailable === 'true',
        airTemperatureC: parseFiniteNumber(doc.identifiers.airTemperatureC),
        roadSurfaceTemperatureC: parseFiniteNumber(doc.identifiers.roadSurfaceTemperatureC),
        roadSurfaceTemperatureC2: parseFiniteNumber(doc.identifiers.roadSurfaceTemperatureC2),
        groundTemperatureC: parseFiniteNumber(doc.identifiers.groundTemperatureC),
        dewPointC: parseFiniteNumber(doc.identifiers.dewPointC),
        relativeHumidityPct: parseFiniteNumber(doc.identifiers.relativeHumidityPct),
        visibilityKm: parseFiniteNumber(doc.identifiers.visibilityKm),
        windAverageMs: parseFiniteNumber(doc.identifiers.windAverageMs),
        windMaxMs: parseFiniteNumber(doc.identifiers.windMaxMs),
        windDirectionDeg: parseFiniteNumber(doc.identifiers.windDirectionDeg),
        precipitationIntensityMmH: parseFiniteNumber(doc.identifiers.precipitationIntensityMmH),
        precipitationSumMm: parseFiniteNumber(doc.identifiers.precipitationSumMm),
        // Real source sensor codes this adapter cannot decode with documented confidence (road
        // condition, ice-frequency/conductivity diagnostics, station status) — raw, never a
        // guessed label. Null when the station reported none.
        rawSensorCodes,
        // Real KITKA1 grip-sensor reading (unit "µ", the friction-coefficient symbol) — only
        // present on stations that carry that sensor; null (never fabricated) otherwise.
        frictionCoefficient: parseFiniteNumber(doc.identifiers.frictionCoefficient),
        // No integrated sensor this build decodes into a clean boolean snow/ice indicator with
        // documented confidence — see rawSensorCodes (KELI_*/JÄÄTAAJUUS_* diagnostics) instead of
        // a guessed threshold here.
        snowOrIceIndicator: null,
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
