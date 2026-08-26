/**
 * War Room Terra — the shared intelligence event model (Phase 2) and the Cesium-facing
 * geospatial projection (Phase 1) it now feeds.
 *
 * Layering, per the Phase 2 mission's explicit architecture rule:
 *
 *   source record (ResearchDocument/ResearchGeoFeature today; other War Room record shapes later)
 *     -> TerraIntelligenceEvent   (this file's canonical, provider-agnostic intelligence record)
 *     -> TerraGeoFeature           (an optional Cesium rendering projection of one event)
 *
 * TerraIntelligenceEvent is authoritative. TerraGeoFeature is a derived, disposable view — it
 * exists only because Cesium needs a flat lon/lat/altitude shape to build an Entity from, not
 * because it holds any information TerraIntelligenceEvent doesn't already have. Nothing should
 * ever construct a TerraGeoFeature by hand from a raw provider response again; every event flows
 * through TerraIntelligenceEvent first (see lib/terra/projectTerraIntelligenceEvent.ts).
 */
import type { ResearchProviderId, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import type { EvidenceConfidenceTier } from '@/lib/intelligence/intelligencePacket'

// ---------------------------------------------------------------------------
// Domain / kind — deliberately separate concepts. `domain` is Terra's own coarse grouping (for
// layer legends/filters); `kind` is the specific semantic type of thing; `providerId` (below) is
// the exact War Room adapter that produced it. A provider is scoped to one domain+kind today, but
// nothing here assumes that stays true — a future second seismic-network provider would share
// kind 'earthquake' with a different providerId.
// ---------------------------------------------------------------------------

/** Coarse groupings for Terra's own layer legend — not a replacement for
 * ResearchProviderCategory (which is far more granular and describes the Research Engine's own
 * provider taxonomy, not Terra's). Extend by adding a member; each is additive. */
export const TERRA_INTELLIGENCE_DOMAINS = ['hazards', 'research', 'opportunity', 'threat', 'science', 'weather', 'government', 'other'] as const
export type TerraIntelligenceDomain = (typeof TERRA_INTELLIGENCE_DOMAINS)[number]

/** Written as a union (matching lib/mission-runtime/types.ts's RUNTIME_MISSION_KINDS convention)
 * so a new event kind is additive, not a breaking rename. Each member here corresponds to a real
 * provider actually integrated into Terra (see lib/terra/layerCatalog.ts) — never added
 * speculatively ahead of a real integration:
 *   - 'earthquake': usgs_earthquake, usgs_earthquake_feed (Phase 1-3)
 *   - 'water_gauge_reading': usgs_water — one event per monitoring station, not per reading; the
 *     station's recent daily values live in `properties`, not as separate events (Phase 3)
 *   - 'aircraft_state': opensky — a live position report, proving the LATENT_GEO extraction
 *     boundary (lib/terra/normalizeLatentGeoDocument.ts) against a real provider (Phase 3)
 *   - 'heritage_site': idai_gazetteer, pleiades, whg — archaeological/historical gazetteer places
 *     (Phase 4)
 *   - 'place': nominatim — a general geocoded place-name search result (Phase 4)
 *   - 'geographic_feature': osm_overpass, ohm_overpass — named OSM/OpenHistoricalMap map features
 *     resolved near a given point (Phase 4)
 *   - 'weather_observation': met_no, open_meteo (Phase 4)
 *   - 'biodiversity_observation': obis, gbif (Phase 4)
 */
export const TERRA_INTELLIGENCE_EVENT_KINDS = [
  'earthquake',
  'water_gauge_reading',
  'aircraft_state',
  'heritage_site',
  'place',
  'geographic_feature',
  'weather_observation',
  'biodiversity_observation',
] as const
export type TerraIntelligenceEventKind = (typeof TERRA_INTELLIGENCE_EVENT_KINDS)[number]

/**
 * 'scheduled' exists for future-safety (a not-yet-occurred, dated event — e.g. a planned launch)
 * and is not produced by any Phase 2 source; nothing here fabricates it.
 */
export type TerraTemporalStatus = 'current' | 'historical' | 'scheduled'

/**
 * The four-layer provenance model: what KIND of truth this event represents, never blended.
 * Phase 2 only ever produces 'observed' (raw provider data through the Research Engine, unedited).
 * 'curated_knowledge' (Earth Knowledge Registry-backed), 'ai_analysis' (Council output), and
 * 'commander_annotation' (Commander-authored) are real, reserved states for later phases — not
 * implemented here, listed so the type is correct now rather than widened later.
 */
export type TerraLayerClass = 'observed' | 'curated_knowledge' | 'ai_analysis' | 'commander_annotation'

/**
 * How a TerraGeography's coordinates were obtained — a distinct dimension from TerraLayerClass
 * (which is about what KIND of truth the event is, observed/curated/AI/Commander) and from
 * TerraEvidenceClassification (which is about corroboration strength). Phase 4's explicit
 * provenance requirement: these three must never look identical to a Commander inspecting an
 * event.
 *   - 'observed': the provider's own structured geoFeature (DIRECT_GEO — e.g. usgs_earthquake's
 *     GeoJSON coordinates).
 *   - 'source_embedded': coordinates were already present in the provider's normalized
 *     ResearchDocument (e.g. a `geography` field), extracted deterministically by
 *     normalizeLatentGeoDocument.ts — never geocoded or inferred.
 *   - 'resolved': War Room looked up a place/entity name through another provider (the
 *     lib/terra/resolveGeography.ts boundary) — see TerraIntelligenceEvent.geoResolution for the
 *     full resolver provenance this implies.
 */
export const TERRA_COORDINATE_ORIGINS = ['observed', 'source_embedded', 'resolved'] as const
export type TerraCoordinateOrigin = (typeof TERRA_COORDINATE_ORIGINS)[number]

/**
 * A single geographic point, in decimal degrees, WGS84 — the only geometry kind implemented this
 * phase. `region` (a bounding area) and `path` (a track/route) are real, anticipated future needs
 * (per the Phase 2 mission's "future-safe region/path capability") deliberately left unimplemented
 * — adding either is a new union member, additive, not a rewrite of this type or of
 * projectTerraIntelligenceEvent.ts's point-only projection logic.
 */
export type TerraGeography = { kind: 'point'; longitude: number; latitude: number; altitude: number | null; coordinateOrigin: TerraCoordinateOrigin }

/**
 * The result of one lib/terra/resolveGeography.ts lookup (Phase 4) — the ONLY sanctioned way an
 * ENTITY_GEO_RESOLVABLE source (a real place/entity name, no coordinates of its own) gets a
 * point on the globe. Ambiguity is a first-class, honest outcome, not an error to paper over:
 * 'ambiguous' and 'unresolved' results carry no coordinates at all and must never be projected.
 * No numeric confidence score is invented — categorical match quality only, since neither
 * nominatim nor any other resolver this codebase uses supplies a real calibrated confidence
 * number.
 */
export const TERRA_GEO_RESOLUTION_METHODS = ['place_name_lookup'] as const
export type TerraGeoResolutionMethod = (typeof TERRA_GEO_RESOLUTION_METHODS)[number]

export const TERRA_GEO_MATCH_QUALITY = ['exact', 'strong', 'ambiguous', 'unresolved'] as const
export type TerraGeoMatchQuality = (typeof TERRA_GEO_MATCH_QUALITY)[number]

export type TerraResolvedGeography =
  | {
      quality: 'exact' | 'strong'
      longitude: number
      latitude: number
      altitude: number | null
      resolutionMethod: TerraGeoResolutionMethod
      resolverProviderId: ResearchProviderId
      /** id of the record whose geography this resolution was performed for — the source
       * document's own provider-scoped id, not a Terra-invented one. */
      sourceEntityId: string
      /** The exact place-name text sent to the resolver. */
      queryUsed: string
      /** The resolver's own matched-place title, for a Commander to sanity-check the match. */
      matchTitle: string
      sourceUrl: string | null
      retrievedAt: string
    }
  | {
      quality: 'ambiguous' | 'unresolved'
      resolverProviderId: ResearchProviderId
      sourceEntityId: string
      queryUsed: string
      retrievedAt: string
      /** Honest, human-readable reason — never fabricated, always traceable to what the resolver
       * actually returned (or didn't). */
      reason: string
    }

/**
 * Reuses War Room's existing evidence vocabulary rather than inventing a Terra-specific
 * confidence scale:
 *   - 'earth_knowledge_registry': the Earth Knowledge Registry's own evidenceClass tag
 *     (lib/earth-knowledge/completionRegistry.generated.ts) — for Curated Knowledge events.
 *   - 'intelligence_confidence_tier': lib/intelligence/confidenceClassifier.ts's
 *     EvidenceConfidenceTier — for events that actually went through that scoring pipeline
 *     (multi-source corroboration, contradiction detection, etc.), a later-phase concern.
 * `null` is not a placeholder — it is the honest answer for Phase 2's usgs_earthquake_feed
 * events, which are single-source raw provider data that never ran through either pipeline. This
 * type must never be populated by inventing a confidence value a source didn't supply.
 */
export type TerraEvidenceClassification =
  | { source: 'earth_knowledge_registry'; evidenceClass: string }
  | { source: 'intelligence_confidence_tier'; tier: EvidenceConfidenceTier }
  | null

/** Layer 1 of Terra's four-layer provenance model (Observed Data). Every TerraIntelligenceEvent
 * carries exactly one; distinct from Curated Knowledge, Council Analysis, and Commander
 * Annotation provenance, which are separate, later-phase concepts, never merged with this one. */
export type TerraProvenance = {
  provider: ResearchProviderId
  sourceUrl: string | null
  retrievedAt: string
  fromCache: boolean
  isHistorical: boolean
}

/**
 * The canonical Terra intelligence record. Every War Room domain Terra ever visualizes —
 * earthquakes today, weather/opportunity/threat/science/government events later — normalizes into
 * this one shape before anything geospatial or Cesium-specific happens to it.
 */
export type TerraIntelligenceEvent = {
  id: string
  domain: TerraIntelligenceDomain
  kind: TerraIntelligenceEventKind
  providerId: ResearchProviderId
  layerClass: TerraLayerClass
  title: string
  summary: string | null
  /** When the real-world thing happened, per the source. Null when the source draws no
   * occurred/observed timestamp distinct from published/updated. */
  observedAt: string | null
  /** When the source published/reported it, if genuinely distinct from `observedAt` — never a
   * duplicate of it just to fill the field. */
  publishedAt: string | null
  /** When the source last revised this record. */
  updatedAt: string | null
  temporalStatus: TerraTemporalStatus
  /** Null when this event has no (yet) projectable location — a legitimate state, not an error. */
  geography: TerraGeography | null
  /** Full resolver provenance when geography.coordinateOrigin === 'resolved' — null in every
   * other case, including when geography itself is null (never resolved) or came from
   * 'observed'/'source_embedded' origins. Kept as a distinct field rather than folded into
   * `provenance` so the four-layer TerraProvenance (Observed Data / Curated Knowledge / AI
   * Analysis / Commander Annotation) is never conflated with "how the coordinate was obtained." */
  geoResolution: TerraResolvedGeography | null
  evidence: TerraEvidenceClassification
  /** Bounded, kind-specific observed values read directly from the source — magnitude, depth,
   * review status, etc. for 'earthquake' — never reinterpreted or scored by Terra itself. Same
   * escape-hatch convention ResearchGeoFeature.properties already uses. */
  properties: Record<string, unknown>
  provenance: TerraProvenance
  rawReference: { documentId: string | null; providerRecordId: string | null; canonicalUrl: string | null }
}

/**
 * A Cesium-ready projection of one TerraIntelligenceEvent with a point geography — see
 * lib/terra/projectTerraIntelligenceEvent.ts. Deliberately narrower than the event it was
 * derived from (no domain/evidence/temporalStatus — the globe doesn't need them to draw a point);
 * anything the UI needs beyond position/title/properties should be read from the source event via
 * `eventId`, not added here as a second copy of event fields.
 */
export type TerraGeoFeature = {
  id: string
  eventId: string
  providerId: ResearchProviderId
  kind: TerraIntelligenceEventKind
  longitude: number
  latitude: number
  altitude: number | null
  timestamp: string | null
  title: string
  summary: string | null
  properties: Record<string, unknown>
  provenance: TerraProvenance
  rawReference: TerraIntelligenceEvent['rawReference']
  /** Mirrors the source event's geography.coordinateOrigin — carried onto the projection so the
   * UI can show "observed / extracted / resolved" without a second lookup back into the event. */
  coordinateOrigin: TerraCoordinateOrigin
  /** Mirrors the source event's geoResolution — present only when coordinateOrigin === 'resolved'. */
  geoResolution: TerraResolvedGeography | null
}

/**
 * A single globe click resolved to a coordinate. Deliberately transient UI state — see
 * TerraGlobe.tsx / TerraShell.tsx — never persisted; camera exploration is not a War Room event.
 */
export type TerraClickPoint =
  | { ok: false }
  | { ok: true; longitude: number; latitude: number; height: number | null; hasTerrainHeight: boolean }

export type NormalizeResult = { events: TerraIntelligenceEvent[]; skippedCount: number }

/**
 * One entry in lib/terra/layerCatalog.ts — a genuinely renderable Terra layer, declared, not
 * inferred. Adding a new layer means adding one entry that references an existing
 * ResearchProviderId and an existing normalize function; it never means writing a second Research
 * Engine call path, a second provider client, or per-layer branching inside a React component —
 * the generic route (app/api/terra/layers/[layerId]/route.ts) and the generic Cesium renderer
 * (components/war-room/terra/TerraFeatureLayer.tsx) are the same code for every entry here.
 */
export type TerraLayerDefinition = {
  /** Stable key used in the URL (/api/terra/layers/{id}) and as the Cesium DataSource name. */
  id: string
  providerId: ResearchProviderId
  kind: TerraIntelligenceEventKind
  domain: TerraIntelligenceDomain
  label: string
  description: string
  /** The query text sent to executeResearch when the Commander has not overridden it — the same
   * "fixed, documented default" convention usgs_earthquake_feed's own adapter already uses for
   * its magnitude/period selection, not a new pattern invented here. */
  defaultQueryText: string
  /** Maps this provider's raw ResearchProviderResponse to TerraIntelligenceEvent[] — the one
   * provider-specific step in the whole pipeline. Everything downstream (projection, rendering)
   * is generic. */
  /** Synchronous for every DIRECT_GEO/LATENT_GEO layer (the common case — no network call beyond
   * the Research Engine response already in hand). May return a Promise for a layer whose
   * normalize step needs an explicit geo-resolution lookup (lib/terra/resolveGeography.ts) —
   * `await`ing an already-resolved synchronous value is a no-op, so every existing normalizer
   * needed no change for this to become additive rather than a breaking signature change. */
  normalize: (response: ResearchProviderResponse) => NormalizeResult | Promise<NormalizeResult>
}
