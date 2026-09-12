/**
 * Roadmap #21 — Terra as War Room World-State Oracle (contract / evaluation only).
 * Terra is NOT a second Council. Terra does NOT authorize action.
 */
import type { TerraOracleEvidenceContract } from './types'

export const TERRA_ORACLE_DEFINITION = Object.freeze({
  title: 'WAR ROOM WORLD-STATE ORACLE',
  answers: [
    'WHAT IS HAPPENING?',
    'WHERE?',
    'WHEN?',
    'SOURCE?',
    'FRESHNESS?',
    'CONFIDENCE?',
    'PROVENANCE?',
    'WORLD CONTEXT?',
  ] as const,
  doesNotAnswer: [
    'WHAT DOES IT MEAN?', // Council
    'WHAT SHOULD WE DO?', // ASTRA / Commander
    'WHAT AM I AUTHORIZED TO DO?', // policy / agent matrix
  ] as const,
  boundaries: [
    'Terra does NOT independently authorize action.',
    'Terra does NOT silently create missions.',
    'Terra selection != Council send.',
    'Terra evidence != ASTRA mission.',
    'ASTRA mission != execution authorization.',
    'Terra is NOT a second Council.',
  ] as const,
  mayExpose: [
    'geography',
    'terrain',
    'weather',
    'earthquakes',
    'vessels',
    'aircraft',
    'roads',
    'buildings',
    'human sites',
    'infrastructure',
    'traffic — FUTURE / PARTIAL',
    'navigation/GPS — FUTURE',
    'environmental events',
    'source metadata',
    'freshness',
    'confidence',
    'provenance',
  ] as const,
  architecturePosition:
    'COMMANDER → WAR ROOM → TERRA (Oracle/world-state) → COUNCIL (meaning) → ASTRA (orchestration) → ASCENSION AGENTS (specialized execution; TARGET) → TOOLS',
  runtimeNote:
    'Actual control plane is forked under Commander session (Terra ∥ Council ∥ Tools; ASTRA beside Council), not a single linear pipe. Evaluation architecture remains the governance target.',
})

/** Required fields for the canonical Terra evidence object (Phase 4 contract). */
export const TERRA_EVIDENCE_CONTRACT_FIELDS = Object.freeze([
  'type',
  'category',
  'objectOrEventId',
  'location',
  'geometry',
  'observedAt',
  'retrievedAt',
  'source',
  'provider',
  'freshness',
  'confidence',
  'provenance',
  'truthStatus',
  'humanReadableMeaning',
  'nearbyWorldContext',
  'coverageState',
  'councilReviewState',
] as const)

/**
 * Map existing Terra live-object / event fields onto the #21 contract shape.
 * Does not redesign Terra — documents the evaluation contract vs current types.
 */
export function proposeTerraEvidenceContractExample(): TerraOracleEvidenceContract {
  return {
    type: 'vessel_position',
    category: 'maritime',
    objectOrEventId: 'digitraffic_marine:230685000',
    location: {
      latitude: 60.10786,
      longitude: 25.19068,
      region: 'Gulf of Finland',
      jurisdiction: 'FI',
      country: 'FI',
    },
    geometry: { type: 'Point', coordinates: [25.19068, 60.10786] },
    observedAt: '2026-09-10T01:23:24.734Z',
    retrievedAt: '2026-09-10T01:40:00.000Z',
    source: 'digitraffic_marine',
    provider: 'digitraffic_marine',
    freshness: 'LIVE',
    confidence: 0.9,
    provenance: {
      provider: 'digitraffic_marine',
      sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000',
      fromCache: false,
      coordinateOrigin: 'source_embedded',
      layerClass: 'observed',
    },
    truthStatus: 'observed',
    humanReadableMeaning: 'Vessel FINBO CARGO observed under way using engine.',
    nearbyWorldContext: null,
    coverageState: 'live',
    councilReviewState: 'not_submitted',
  }
}

/** Future Terra Intelligence Agent boundaries (definition only). */
export const TERRA_INTELLIGENCE_AGENT_BOUNDARY = Object.freeze({
  may: [
    'query Terra',
    'analyze world-state',
    'assemble evidence',
    'compare live/cached/stale feeds',
    'submit evidence to Council',
    'recommend investigation',
  ] as const,
  mayNotAutomatically: [
    'launch mission',
    'deploy code',
    'crawl arbitrary targets',
    'send external messages',
    'control devices',
    'spend money',
    'take destructive action',
  ] as const,
  requiresForHighImpact: 'ASTRA + policy + Commander authorization',
})
