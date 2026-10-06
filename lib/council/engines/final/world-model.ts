/**
 * ENGINE-06 World model as a structured view over EBC + KG + temporal state.
 * Not a second truth store. Correlation is not causation.
 */
import type { KnowledgeGraph, KgNode } from '@/lib/council/intelligence/types'
import { ENGINE_06_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { saveFinalJson } from './store'
import type {
  CausalClaim,
  EntityResolution,
  EntityType,
  WorldEntity,
  WorldEvent,
  WorldRelation,
  WorldRelationKind,
  WorldStateSnapshot,
} from './types'

function nodeTypeToEntity(t: string): EntityType {
  if (t === 'INSTALL' || t === 'RUNTIME' || t === 'CAPABILITY') return 'SYSTEM'
  if (t === 'MISSION') return 'MISSION'
  if (t === 'ARTIFACT' || t === 'DOCUMENT') return 'DOCUMENT'
  return 'OTHER'
}

export function entityFromKg(node: KgNode): WorldEntity {
  return {
    entity_id: node.node_id,
    canonical_name: node.canonical_name,
    entity_type: nodeTypeToEntity(node.node_type),
    aliases: typeof node.metadata.alias === 'string' ? [String(node.metadata.alias)] : [],
    identifiers: {
      node_type: node.node_type,
      ...(node.current_runtime_identity ? { runtime: node.current_runtime_identity } : {}),
      ...(node.metadata.provider_id ? { provider_id: String(node.metadata.provider_id) } : {}),
      ...(node.metadata.domain ? { domain: String(node.metadata.domain) } : {}),
    },
    source_refs: [...node.source_evidence_ids],
    first_seen: node.observed_at ?? node.last_verified_at ?? new Date().toISOString(),
    last_seen: node.last_verified_at ?? node.observed_at ?? new Date().toISOString(),
    current_state: node.status,
    temporal_state: node.temporal_state === 'UNKNOWN' ? 'TIME_UNKNOWN' : node.temporal_state,
  }
}

export function resolveEntities(a: WorldEntity, b: WorldEntity): EntityResolution {
  const idKeys = ['provider_id', 'runtime', 'domain', 'install_id']
  const shared = idKeys.filter(k => a.identifiers[k] && a.identifiers[k] === b.identifiers[k])
  if (shared.length) return 'SAME_ENTITY'
  if (a.canonical_name === b.canonical_name && a.entity_type !== b.entity_type) return 'DISTINCT_ENTITY'
  if (a.canonical_name === b.canonical_name) {
    const aIds = Object.values(a.identifiers).join('|')
    const bIds = Object.values(b.identifiers).join('|')
    if (aIds && bIds && aIds !== bIds) return 'DISTINCT_ENTITY'
    return 'POSSIBLE_MATCH'
  }
  if (a.aliases.includes(b.canonical_name) || b.aliases.includes(a.canonical_name)) return 'POSSIBLE_MATCH'
  return 'UNRESOLVED'
}

export function relationFromKg(kind: string, from_id: string, to_id: string, evidence: string[]): WorldRelation | null {
  const allowed: WorldRelationKind[] = ['OWNS', 'DEPENDS_ON', 'USES', 'SUPPORTS', 'CONTRADICTS', 'SUPERSEDES', 'DERIVED_FROM', 'CAUSES', 'CORRELATES_WITH', 'PRECEDES', 'FOLLOWS', 'PRODUCED_BY', 'MEMBER_OF', 'GOVERNS', 'AFFECTS', 'OPERATES', 'LOCATED_AT']
  const mapped = kind === 'PROVIDED_BY' ? 'PRODUCED_BY' : kind === 'PART_OF' ? 'MEMBER_OF' : kind
  if (!allowed.includes(mapped as WorldRelationKind)) return null
  if (!evidence.length) return null
  return {
    relation_id: `rel-${from_id}-${to_id}-${mapped}`,
    kind: mapped as WorldRelationKind,
    from_id,
    to_id,
    provenance: evidence,
    temporal_state: 'CURRENT',
  }
}

export function inferCausalClaim(input: {
  cause: string
  effect: string
  correlated: boolean
  temporal_order: boolean
  mechanism: string | null
  evidence_refs: string[]
  alternatives: string[]
  confounders: string[]
}): CausalClaim {
  let causal_state: CausalClaim['causal_state'] = 'INSUFFICIENT'
  if (input.correlated && !input.temporal_order) causal_state = 'OBSERVED_ASSOCIATION'
  else if (input.correlated && input.temporal_order && !input.mechanism) causal_state = 'OBSERVED_ASSOCIATION'
  else if (input.correlated && input.temporal_order && input.mechanism && input.evidence_refs.length && input.alternatives.length) causal_state = 'PLAUSIBLE_CAUSAL'
  else if (input.evidence_refs.length >= 2 && input.temporal_order && input.mechanism && input.alternatives.length === 0) causal_state = 'SUPPORTED_CAUSAL'
  if (input.alternatives.length > 1 && causal_state === 'SUPPORTED_CAUSAL') causal_state = 'CONTESTED'
  return {
    cause: input.cause,
    effect: input.effect,
    mechanism: input.mechanism,
    evidence_refs: input.evidence_refs,
    alternative_causes: input.alternatives,
    confounders: input.confounders,
    temporal_order: input.temporal_order,
    causal_state,
    historical_fact: false,
  }
}

export function snapshotWorld(input: {
  graph?: KnowledgeGraph | null
  verified_facts?: string[]
  historical_facts?: string[]
  conflicts?: string[]
  unknowns?: string[]
  hypotheses?: string[]
  events?: WorldEvent[]
}): WorldStateSnapshot {
  const entities = (input.graph?.nodes ?? []).map(entityFromKg)
  const relations = (input.graph?.edges ?? [])
    .map(e => relationFromKg(e.kind, e.from_id, e.to_id, e.evidence_ids))
    .filter((r): r is WorldRelation => Boolean(r))
  return {
    snapshot_id: `ws-${Date.now()}`,
    at: new Date().toISOString(),
    entities,
    relations,
    events: input.events ?? [],
    current_verified_facts: input.verified_facts ?? [],
    historical_facts: input.historical_facts ?? [],
    open_conflicts: input.conflicts ?? [],
    unknowns: input.unknowns ?? [],
    active_hypotheses: input.hypotheses ?? [],
    ebc_canonical: true,
  }
}

export function describeEntityChange(before: WorldEntity, after: WorldEntity): string {
  return `Entity state changed from ${before.current_state} to ${after.current_state}. Evidence: ${before.canonical_name} valid until ${before.last_seen}; ${after.canonical_name} valid from ${after.first_seen}`
}

export function runWorldModel(input: Parameters<typeof snapshotWorld>[0] & { mission_id: string }) {
  const started = Date.now()
  const snapshot = snapshotWorld(input)
  const receipt = createEngineReceipt({
    engine: 'world-model',
    mission_id: input.mission_id,
    started_at: started,
    decision_count: snapshot.entities.length,
    decision: `entities=${snapshot.entities.length} ebc_canonical version=${ENGINE_06_VERSION}`,
  })
  void saveFinalJson('world', snapshot.snapshot_id, snapshot)
  return { snapshot, receipt, grants_authority: false as const, ebc_canonical: true as const }
}
