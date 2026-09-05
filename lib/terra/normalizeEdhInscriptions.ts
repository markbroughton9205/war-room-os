/**
 * Terra's mapping from the Epigraphic Database Heidelberg (edh) provider's raw Research Engine
 * output to TerraIntelligenceEvent (Phase 4) — the proof case for the geo-resolution boundary
 * (lib/terra/resolveGeography.ts). EDH inscriptions are genuinely ENTITY_GEO_RESOLVABLE: each
 * document's `geography` field is a real modern region/country NAME (e.g. "Lazio", "Campania"),
 * never coordinates — confirmed live during this mission's reconciliation pass, distinct from the
 * LATENT_GEO_SAFE providers (idai_gazetteer, pleiades, etc.) whose `geography` is already an
 * exact "lat X, lon Y" string.
 *
 * Resolution is batched by distinct place name, not performed once per document: many
 * inscriptions in one response commonly share the same modern region, and nominatim's own 1
 * request/second usage-policy throttle (enforced in lib/research-engine/providers/nominatim.ts)
 * makes per-document resolution both wasteful and slow. Bounded to MAX_DISTINCT_RESOLUTIONS
 * distinct names per call to keep one layer request's latency predictable.
 */
import type { ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { NormalizeResult, TerraResolvedGeography } from '@/lib/terra/types'
import { resolvePlaceNameViaNominatim } from '@/lib/terra/resolveGeography'

const PROVIDER_ID = 'edh' as const
const MAX_DISTINCT_RESOLUTIONS = 8

export async function normalizeEdhInscriptions(response: ResearchProviderResponse): Promise<NormalizeResult> {
  const events: NormalizeResult['events'] = []
  let skippedCount = 0

  const distinctPlaceNames = Array.from(new Set(response.documents.map(doc => doc.geography).filter((value): value is string => !!value))).slice(0, MAX_DISTINCT_RESOLUTIONS)

  const resolutions = new Map<string, TerraResolvedGeography>()
  for (const placeName of distinctPlaceNames) {
    // Sequential, not Promise.all — nominatim's shared module-level throttle already serializes
    // these to 1/sec regardless, and sequential calls make that pacing explicit rather than
    // implicit in a shared mutable timer.
    resolutions.set(placeName, await resolvePlaceNameViaNominatim(placeName, placeName))
  }

  for (const doc of response.documents) {
    if (!doc.geography) {
      skippedCount += 1
      continue
    }
    const resolution = resolutions.get(doc.geography)
    // Only 'exact'/'strong' results carry coordinates at all (see TerraResolvedGeography's own
    // discriminated union) — an 'ambiguous' or 'unresolved' result, or a place name that fell
    // outside this call's resolution bound, is honestly counted as skipped, never projected.
    if (!resolution || !(resolution.quality === 'exact' || resolution.quality === 'strong')) {
      skippedCount += 1
      continue
    }

    events.push({
      id: doc.providerRecordId ?? doc.id,
      domain: 'research',
      kind: 'heritage_site',
      providerId: PROVIDER_ID,
      layerClass: 'observed',
      title: doc.title,
      summary: doc.summary,
      observedAt: doc.publishedAt,
      publishedAt: null,
      updatedAt: doc.updatedAt,
      temporalStatus: doc.provenance.isHistorical ? 'historical' : 'current',
      geography: { kind: 'point', longitude: resolution.longitude, latitude: resolution.latitude, altitude: resolution.altitude, coordinateOrigin: 'resolved' },
      geoResolution: resolution,
      // No evidence-scoring pipeline runs on raw Research Engine documents this phase — honestly
      // null, never a fabricated confidence value.
      evidence: null,
      properties: { ...doc.identifiers, subjects: doc.subjects, findspot: doc.contentSnippet },
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
