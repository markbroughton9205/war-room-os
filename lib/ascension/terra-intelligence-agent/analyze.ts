/**
 * #22 Phase 6 — Pure Terra evidence analysis helpers.
 * Reuses liveGeoIntelligence + maritimeProviderStatus. No second Oracle.
 */
import {
  listMaritimeLiveProviderStatuses,
  type TerraLiveFreshness,
  type TerraLiveGeoObject,
  TERRA_LIVE_FRESHNESS_STATES,
} from '@/lib/terra/liveGeoIntelligence'
import { canSendTerraObjectToCouncil, type TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraIntelligenceScope } from './scope'
import {
  makeFinding,
  type TerraConfidenceKind,
  type TerraCorrelationState,
  type TerraWorldStateFinding,
  type TerraWorldStateObject,
} from './result'

export type AnalyzeTerraInput = {
  scope: TerraIntelligenceScope
  objects?: TerraLiveGeoObject[]
  handoff?: TerraCouncilHandoffPayload | null
  /** Simulated provider failure for DEGRADED/PARTIAL tests. */
  simulateProviderFailure?: boolean
  /** Force empty coverage region. */
  simulateNoCoverage?: boolean
}

function freshnessLabel(f: TerraLiveFreshness | string): string {
  return String(f)
}

function confidenceForFreshness(f: TerraLiveFreshness | string): TerraConfidenceKind {
  if (f === 'LIVE') return 'DIRECT_OBSERVATION_FROM_FEED'
  if (f === 'CACHED' || f === 'DELAYED') return 'NORMALIZED'
  if (f === 'STALE' || f === 'HISTORICAL') return 'SOURCE_REPORTED'
  if (f === 'NO_COVERAGE' || f === 'EMPTY') return 'UNVERIFIED'
  return 'UNVERIFIED'
}

function includeObject(scope: TerraIntelligenceScope, freshness: TerraLiveFreshness | string): boolean {
  if (scope.live_only && freshness !== 'LIVE') return false
  if (!scope.include_cached && freshness === 'CACHED') return false
  if (!scope.include_historical && freshness === 'HISTORICAL') return false
  return true
}

export function objectFromHandoff(handoff: TerraCouncilHandoffPayload): TerraLiveGeoObject {
  const lineage = handoff.lineage
  return {
    id: lineage.objectId,
    layer: lineage.layer,
    type: lineage.type,
    category: lineage.layer,
    title: lineage.title,
    summary: handoff.observedFacts.slice(0, 240),
    latitude: lineage.latitude ?? Number.NaN,
    longitude: lineage.longitude ?? Number.NaN,
    observedAt: lineage.observedAt,
    receivedAt: lineage.receivedAt,
    provider: lineage.provider,
    publisherFamily: null,
    sourceFamily: lineage.sourceFamily,
    evidenceId: lineage.evidenceId,
    discoveryProvenance: {
      discoveredVia: lineage.provider,
      alsoDiscoveredVia: [],
      upstreamEngines: [],
      storageOrigin: null,
    },
    country: lineage.country,
    region: lineage.region,
    jurisdiction: lineage.jurisdiction,
    freshness: lineage.freshness,
    confidence: null,
    sourceUrl: lineage.sourceUrl,
    coordinateOrigin: lineage.coordinateOrigin,
    identityKey: null,
  }
}

/** Fixture vessel for deterministic live-safe / unit proofs (Digitraffic-shaped). */
export function makeDigitrafficFixtureVessel(overrides?: Partial<TerraLiveGeoObject>): TerraLiveGeoObject {
  return {
    id: 'digitraffic_marine:230685000',
    layer: 'vessels',
    type: 'vessel_position',
    category: 'maritime',
    title: 'FINBO CARGO',
    summary: 'AIS vessel position (fixture)',
    latitude: 60.10786,
    longitude: 25.19068,
    observedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    provider: 'digitraffic_marine',
    publisherFamily: 'digitraffic',
    sourceFamily: 'ais',
    evidenceId: 'digitraffic_marine:230685000',
    discoveryProvenance: {
      discoveredVia: 'digitraffic_marine',
      alsoDiscoveredVia: [],
      upstreamEngines: [],
      storageOrigin: null,
    },
    country: 'FI',
    region: 'Baltic',
    jurisdiction: null,
    freshness: 'LIVE',
    confidence: 0.9,
    sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000',
    coordinateOrigin: 'ais',
    identityKey: '230685000',
    ...overrides,
  }
}


export function analyzeTerraWorldState(input: AnalyzeTerraInput): {
  findings: TerraWorldStateFinding[]
  objects: TerraWorldStateObject[]
  events: Array<Record<string, unknown>>
  evidence_refs: string[]
  provider_refs: string[]
  sources: Array<{ provider: string; freshness: string; implemented: boolean; reason?: string }>
  freshness_summary: string
  coverage_summary: string
  confidence: TerraConfidenceKind
  conflicts: string[]
  limitations: string[]
  unavailable: string[]
  no_coverage: boolean
  provider_ok: number
  provider_failures: number
  selection_is_not_council_send: true
  selection_is_not_astra_mission: true
} {
  const findings: TerraWorldStateFinding[] = []
  const limitations: string[] = [
    'GPS remains NOT_IMPLEMENTED in Phase 6.',
    'Traffic/routing remains NOT_IMPLEMENTED in Phase 6.',
    'Planetary descent / imagery ladder work ABSENT.',
    'Terra finding does not authorize action.',
  ]
  const unavailable: string[] = []
  const conflicts: string[] = []

  const providers = listMaritimeLiveProviderStatuses().slice(0, input.scope.max_providers)
  const sources = providers.map(p => ({
    provider: p.id,
    freshness: p.freshness,
    implemented: Boolean(p.implemented),
    reason: p.reason,
  }))

  const providerOk = providers.filter(p => p.freshness === 'LIVE' || p.freshness === 'CACHED' || p.freshness === 'READY').length
  let providerFailures = providers.filter(p => p.freshness === 'UNAVAILABLE' || p.freshness === 'AUTH_FAILED').length

  if (input.simulateProviderFailure) {
    providerFailures += 1
    unavailable.push('SIMULATED_PROVIDER')
  }

  // Registered != live; historical != live; credential labels preserved
  for (const p of providers) {
    if (p.freshness === 'NEEDS_CREDENTIALS') {
      findings.push(
        makeFinding({
          title: `${p.id} needs credentials`,
          statement: `Provider ${p.id} is ${p.freshness} — not LIVE.`,
          confidence: 'SOURCE_REPORTED',
          freshness: p.freshness,
          correlation: 'SINGLE_SOURCE',
          evidence_refs: [`provider:${p.id}`],
          provider_refs: [p.id],
          coverage_note: p.reason ?? null,
        }),
      )
    }
    if (p.freshness === 'HISTORICAL') {
      findings.push(
        makeFinding({
          title: `${p.id} is historical-only`,
          statement: `Provider ${p.id} is HISTORICAL — must not be labeled LIVE.`,
          confidence: 'SOURCE_REPORTED',
          freshness: 'HISTORICAL',
          correlation: 'SINGLE_SOURCE',
          evidence_refs: [`provider:${p.id}`],
          provider_refs: [p.id],
          coverage_note: 'historical_archive',
        }),
      )
    }
    if (p.freshness === 'NEEDS_LOCAL_SENSOR' || p.freshness === 'NEEDS_COMMERCIAL_ACCOUNT' || p.freshness === 'NOT_IMPLEMENTED') {
      findings.push(
        makeFinding({
          title: `${p.id} blocked: ${p.freshness}`,
          statement: `Provider ${p.id} runtime truth is ${p.freshness}. Registered capability is not live execution.`,
          confidence: 'SOURCE_REPORTED',
          freshness: p.freshness,
          correlation: 'SINGLE_SOURCE',
          evidence_refs: [`provider:${p.id}`],
          provider_refs: [p.id],
          coverage_note: p.reason ?? null,
        }),
      )
    }
  }

  const rawObjects: TerraLiveGeoObject[] = [...(input.objects ?? [])]
  if (input.handoff) rawObjects.push(objectFromHandoff(input.handoff))

  const filtered = rawObjects
    .filter(o => includeObject(input.scope, o.freshness))
    .slice(0, input.scope.max_objects)

  if (input.simulateNoCoverage && filtered.length === 0) {
    findings.push(
      makeFinding({
        title: 'No coverage for requested scope',
        statement: 'Coverage absence is not proof of object absence.',
        confidence: 'UNVERIFIED',
        freshness: 'NO_COVERAGE',
        correlation: 'INSUFFICIENT_EVIDENCE',
        evidence_refs: [],
        provider_refs: providers.map(p => p.id).slice(0, 5),
        coverage_note: 'NO_COVERAGE',
      }),
    )
  }

  const worldObjects: TerraWorldStateObject[] = filtered.map(o => {
    const conf = confidenceForFreshness(o.freshness)
    if (o.freshness === 'STALE') {
      findings.push(
        makeFinding({
          title: `Stale observation: ${o.title}`,
          statement: `Object ${o.id} freshness is STALE — do not claim currently live.`,
          confidence: conf,
          freshness: 'STALE',
          correlation: 'SINGLE_SOURCE',
          evidence_refs: [o.evidenceId ?? o.id],
          provider_refs: [o.provider],
          coverage_note: null,
        }),
      )
    }
    if (o.freshness === 'CACHED') {
      findings.push(
        makeFinding({
          title: `Cached observation: ${o.title}`,
          statement: `Object ${o.id} is CACHED — not a fresh live fetch.`,
          confidence: conf,
          freshness: 'CACHED',
          correlation: 'SINGLE_SOURCE',
          evidence_refs: [o.evidenceId ?? o.id],
          provider_refs: [o.provider],
          coverage_note: null,
        }),
      )
    }
    return {
      object_id: o.id,
      type: o.type,
      category: o.category,
      title: o.title,
      location: Number.isFinite(o.latitude) && Number.isFinite(o.longitude) ? { latitude: o.latitude, longitude: o.longitude } : null,
      observed_at: o.observedAt,
      retrieved_at: o.receivedAt,
      provider: o.provider,
      freshness: o.freshness,
      confidence: conf,
      provenance: [o.provider, o.evidenceId, o.sourceUrl].filter(Boolean).join('|'),
      truth_status: freshnessLabel(o.freshness),
      coverage_status: o.freshness === 'NO_COVERAGE' ? 'NO_COVERAGE' : 'OBSERVED',
    }
  })

  // Correlation: same id across providers = corroborated; else single-source
  const byId = new Map<string, TerraWorldStateObject[]>()
  for (const o of worldObjects) {
    const list = byId.get(o.object_id) ?? []
    list.push(o)
    byId.set(o.object_id, list)
  }
  for (const [id, list] of byId) {
    const providersUnique = new Set(list.map(o => o.provider))
    let correlation: TerraCorrelationState = 'SINGLE_SOURCE'
    if (providersUnique.size >= 2) {
      const freshSet = new Set(list.map(o => o.freshness))
      correlation = freshSet.size > 1 ? 'CONFLICTING' : 'CORROBORATED'
      if (correlation === 'CONFLICTING') {
        conflicts.push(`Object ${id} has conflicting freshness across providers.`)
      }
    }
    findings.push(
      makeFinding({
        title: `Correlation for ${id}`,
        statement:
          correlation === 'CORROBORATED'
            ? `Object ${id} corroborated by ${providersUnique.size} providers.`
            : correlation === 'CONFLICTING'
              ? `Object ${id} has conflicting provider reports.`
              : `Object ${id} is single-source evidence — not corroborated.`,
        confidence: correlation === 'CONFLICTING' ? 'CONFLICTING' : list[0]?.confidence ?? 'UNVERIFIED',
        freshness: list[0]?.freshness ?? 'UNKNOWN',
        correlation,
        evidence_refs: list.map(o => o.object_id),
        provider_refs: [...providersUnique],
        coverage_note: null,
      }),
    )
  }

  if (worldObjects.length > 0) {
    findings.push(
      makeFinding({
        title: 'World-state summary',
        statement: `Analyzed ${worldObjects.length} Terra object(s) for: ${input.scope.world_state_question.slice(0, 120)}`,
        confidence: worldObjects.some(o => o.freshness === 'LIVE') ? 'DIRECT_OBSERVATION_FROM_FEED' : 'NORMALIZED',
        freshness: worldObjects[0]?.freshness ?? 'UNKNOWN',
        correlation: worldObjects.length > 1 ? 'INSUFFICIENT_EVIDENCE' : 'SINGLE_SOURCE',
        evidence_refs: worldObjects.map(o => o.object_id).slice(0, input.scope.max_evidence_refs),
        provider_refs: [...new Set(worldObjects.map(o => o.provider))],
        coverage_note: null,
      }),
    )
  }

  // Inferred evidence must be labeled if include_inferred and no direct objects
  if (input.scope.include_inferred && worldObjects.length === 0 && !input.simulateNoCoverage) {
    findings.push(
      makeFinding({
        title: 'Inferred gap analysis',
        statement: 'No direct Terra objects in scope — any absence claims would be INFERRED, not observed.',
        confidence: 'INFERRED',
        freshness: 'EMPTY',
        correlation: 'INSUFFICIENT_EVIDENCE',
        evidence_refs: [],
        provider_refs: sources.slice(0, 3).map(s => s.provider),
        coverage_note: 'inferred_only',
      }),
    )
  }

  const evidence_refs = worldObjects
    .map(o => o.object_id)
    .concat(findings.flatMap(f => f.evidence_refs))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, input.scope.max_evidence_refs)

  const freshness_summary = [
    `objects=${worldObjects.length}`,
    `live=${worldObjects.filter(o => o.freshness === 'LIVE').length}`,
    `cached=${worldObjects.filter(o => o.freshness === 'CACHED').length}`,
    `stale=${worldObjects.filter(o => o.freshness === 'STALE').length}`,
    `providers=${sources.length}`,
  ].join('; ')

  const coverage_summary = input.simulateNoCoverage
    ? 'NO_COVERAGE for requested geographic/provider scope'
    : worldObjects.length === 0
      ? 'PARTIAL_COVERAGE or EMPTY — absence of objects is not proof of absence'
      : 'OBSERVED objects present within bounded scope'

  // Selection boundary invariants (documented in result)
  void canSendTerraObjectToCouncil
  void TERRA_LIVE_FRESHNESS_STATES

  return {
    findings: findings.slice(0, 30),
    objects: worldObjects,
    events: worldObjects.map(o => ({
      event_id: o.object_id,
      type: o.type,
      provider: o.provider,
      freshness: o.freshness,
      observed_at: o.observed_at,
    })),
    evidence_refs,
    provider_refs: sources.map(s => s.provider),
    sources,
    freshness_summary,
    coverage_summary,
    confidence:
      worldObjects.some(o => o.freshness === 'LIVE')
        ? 'DIRECT_OBSERVATION_FROM_FEED'
        : worldObjects.length > 0
          ? 'NORMALIZED'
          : 'UNVERIFIED',
    conflicts,
    limitations,
    unavailable,
    no_coverage: Boolean(input.simulateNoCoverage && worldObjects.length === 0),
    provider_ok: providerOk,
    provider_failures: providerFailures,
    selection_is_not_council_send: true,
    selection_is_not_astra_mission: true,
  }
}
