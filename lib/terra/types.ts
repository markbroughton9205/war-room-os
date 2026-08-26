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
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
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

/** One member today. Written as a union (matching lib/mission-runtime/types.ts's
 * RUNTIME_MISSION_KINDS convention) so a second event kind is additive, not a breaking rename. */
export const TERRA_INTELLIGENCE_EVENT_KINDS = ['earthquake'] as const
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
 * A single geographic point, in decimal degrees, WGS84 — the only geometry kind implemented this
 * phase. `region` (a bounding area) and `path` (a track/route) are real, anticipated future needs
 * (per the Phase 2 mission's "future-safe region/path capability") deliberately left unimplemented
 * — adding either is a new union member, additive, not a rewrite of this type or of
 * projectTerraIntelligenceEvent.ts's point-only projection logic.
 */
export type TerraGeography = { kind: 'point'; longitude: number; latitude: number; altitude: number | null }

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
}

/**
 * A single globe click resolved to a coordinate. Deliberately transient UI state — see
 * TerraGlobe.tsx / TerraShell.tsx — never persisted; camera exploration is not a War Room event.
 */
export type TerraClickPoint =
  | { ok: false }
  | { ok: true; longitude: number; latitude: number; height: number | null; hasTerrainHeight: boolean }
