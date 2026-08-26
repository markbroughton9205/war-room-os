/**
 * Terra's mapping from usgs_water's raw Research Engine output to TerraIntelligenceEvent (Phase
 * 3). Structurally different from the earthquake mapping on purpose: usgs_water's adapter
 * (lib/research-engine/providers/usgsWater.ts) models one monitoring STATION reporting a
 * ResearchTimeSeries of daily readings, not one discrete event per reading — its own geoFeatures
 * array is already deduped to one fixed point per station (see that adapter's own dedupe filter).
 * This function follows that shape rather than forcing water data into the earthquake
 * one-event-per-point pattern: one TerraIntelligenceEvent per monitoring station, carrying the
 * station's most recent reading as its observedAt/value and the full bounded point series in
 * `properties` (Terra has no first-class time-series field yet — that is the Phase 5 4D concern,
 * not invented early here).
 *
 * Pure, side-effect-free: no network call, no provider-specific fetch logic here — that stays
 * inside lib/research-engine/providers/usgsWater.ts, which this function never bypasses.
 */
import type { ResearchProviderResponse, ResearchTimeSeries } from '@/lib/research-engine/core/types'
import type { NormalizeResult } from '@/lib/terra/types'

const PROVIDER_ID = 'usgs_water' as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GeoJSON [lon, lat] — no depth dimension for a fixed monitoring-station point. Re-validated at
 * this boundary — ResearchGeoFeature.coordinates is typed `unknown` upstream. */
function extractLonLat(coordinates: unknown): { lon: number; lat: number } | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [lon, lat] = coordinates
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return null
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null
  return { lon, lat }
}

/** The chronologically most recent point with a real (non-null) value, if any — never assumes the
 * series arrives pre-sorted. Returns null (not a fabricated reading) when every point's value is
 * missing. */
function mostRecentValuedPoint(series: ResearchTimeSeries | undefined): { date: string; value: number } | null {
  if (!series) return null
  let best: { date: string; value: number } | null = null
  for (const point of series.points) {
    if (point.value === null) continue
    if (!best || point.date > best.date) best = { date: point.date, value: point.value }
  }
  return best
}

export function normalizeUsgsWaterStations(response: ResearchProviderResponse): NormalizeResult {
  const doc = response.documents[0] ?? null
  const series = response.timeSeries[0]
  const latest = mostRecentValuedPoint(series)
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  for (const geoFeature of response.geoFeatures) {
    const point = extractLonLat(geoFeature.coordinates)
    if (!point) {
      skippedCount += 1
      continue
    }

    const provenance = doc
      ? {
          provider: doc.provenance.provider,
          sourceUrl: doc.provenance.sourceUrl,
          retrievedAt: doc.provenance.retrievedAt,
          fromCache: doc.provenance.fromCache,
          isHistorical: doc.provenance.isHistorical,
        }
      : {
          // Defensive fallback only — a real usgs_water response always carries exactly one
          // document alongside its geoFeatures (see the adapter's own `documents = [makeDocument(...)]`).
          // Never expected to execute against real data.
          provider: PROVIDER_ID,
          sourceUrl: null,
          retrievedAt: new Date().toISOString(),
          fromCache: false,
          isHistorical: false,
        }

    events.push({
      id: geoFeature.id,
      domain: 'hazards',
      kind: 'water_gauge_reading',
      providerId: PROVIDER_ID,
      layerClass: 'observed',
      title: doc?.title ?? `USGS monitoring station ${geoFeature.id}`,
      summary: doc?.summary ?? null,
      // The station's most recent reading time, when at least one real value exists — never the
      // query's own start/end window, which would misrepresent when the water was actually
      // measured.
      observedAt: latest?.date ?? null,
      publishedAt: null,
      updatedAt: doc?.updatedAt ?? null,
      temporalStatus: provenance.isHistorical ? 'historical' : 'current',
      geography: { kind: 'point', longitude: point.lon, latitude: point.lat, altitude: null, coordinateOrigin: 'observed' },
      geoResolution: null,
      // No evidence-scoring pipeline runs on raw USGS data this phase — honestly null.
      evidence: null,
      // Bounded escape hatch: the latest reading plus the full (already-capped) point series and
      // series metadata — never reinterpreted, never scored, just passed through.
      properties: {
        latestValue: latest?.value ?? null,
        latestValueDate: latest?.date ?? null,
        unit: series?.unit ?? null,
        seriesId: series?.seriesId ?? null,
        pointCount: series?.points.length ?? 0,
        points: series?.points ?? [],
      },
      provenance,
      rawReference: { documentId: doc?.id ?? null, providerRecordId: geoFeature.id, canonicalUrl: doc?.canonicalUrl ?? null },
    })
  }

  return { events, skippedCount }
}
