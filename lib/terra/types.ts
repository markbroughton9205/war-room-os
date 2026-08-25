/**
 * War Room Terra — the minimum reusable normalization boundary between Research Engine
 * provider output and Cesium.
 *
 * Deliberately small (Phase 1 scope): this is NOT the Phase 2 Terra Intelligence Event Model.
 * It exists only so Terra's globe/UI code never has to know a provider-specific response shape
 * (ResearchGeoFeature + ResearchDocument for usgs_earthquake_feed today, some other adapter's
 * shape for a later layer) — every Terra layer consumes TerraGeoFeature[] and nothing else.
 *
 * `kind` intentionally has one member. It is a union (not a bare string literal) for the same
 * reason lib/mission-runtime/types.ts's RUNTIME_MISSION_KINDS is: a second Terra layer later
 * is additive, not a breaking rename.
 */
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

export const TERRA_LAYER_KINDS = ['usgs_earthquake_feed'] as const
export type TerraLayerKind = (typeof TERRA_LAYER_KINDS)[number]

/**
 * Layer 1 of Terra's four-layer provenance model (see docs/terra — Observed Data). Every
 * TerraGeoFeature carries exactly one of these; it is never merged with Curated Earth Knowledge,
 * Council Analysis, or Commander Annotation provenance, which are distinct, later-phase concepts.
 */
export type TerraProvenance = {
  provider: ResearchProviderId
  sourceUrl: string | null
  retrievedAt: string
  fromCache: boolean
  isHistorical: boolean
}

/**
 * A single geographically-projectable observed event, normalized from one Research Engine
 * provider's output. `properties` is a deliberate, bounded escape hatch for kind-specific
 * observed values (e.g. earthquake magnitude/depth/alert) — the same pattern
 * ResearchGeoFeature.properties already uses — rather than inventing named fields per kind on
 * this shared type, which would force every future layer to carry every other layer's fields.
 */
export type TerraGeoFeature = {
  id: string
  providerId: ResearchProviderId
  kind: TerraLayerKind
  longitude: number
  latitude: number
  /** Meters above the WGS84 ellipsoid where the source data legitimately provides it (e.g. USGS depth, reported as a negative altitude). Null when the source has no altitude/depth value — never fabricated. */
  altitude: number | null
  /** ISO 8601. Null when the source has no event timestamp. */
  timestamp: string | null
  title: string
  summary: string | null
  /** Bounded, kind-specific observed values read directly from the provider response — never reinterpreted or scored by Terra itself. */
  properties: Record<string, unknown>
  provenance: TerraProvenance
  /** Traces back to the originating ResearchDocument, when the provider produced one, for a source URL/reference the UI can surface. */
  rawReference: { documentId: string | null; canonicalUrl: string | null }
}

/**
 * A single globe click resolved to a coordinate. Deliberately transient UI state — see
 * TerraGlobe.tsx / TerraShell.tsx — never persisted; camera exploration is not a War Room event.
 */
export type TerraClickPoint =
  | { ok: false }
  | { ok: true; longitude: number; latitude: number; height: number | null; hasTerrainHeight: boolean }
