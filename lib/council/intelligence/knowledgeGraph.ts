/**
 * War Room self-knowledge graph. Not a world ontology.
 * Seed only from verified runtime/project facts with provenance.
 */

import { KNOWLEDGE_GRAPH_SCHEMA, type KgEdge, type KgEdgeType, type KgNode, type KgNodeType, type KnowledgeGraph, type TemporalState, type TruthState } from './types'
import { applySupersession, resolveTemporalConflict, type TemporalFact } from './temporal'

let seq = 0
function nid(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(36)}`
}

export function createKnowledgeGraph(now = new Date().toISOString()): KnowledgeGraph {
  return { schema: KNOWLEDGE_GRAPH_SCHEMA, nodes: [], edges: [], seeded_at: null }
}

function isSameCurrentStateKey(a: KgNode, b: KgNode): boolean {
  if (a.node_id === b.node_id) return true
  if (a.node_type !== b.node_type || a.temporal_state !== 'CURRENT') return false
  if (a.canonical_name === b.canonical_name) return true
  if (a.node_type === 'INSTALL' && a.metadata.role === 'active_install' && b.metadata.role === 'active_install') return true
  return false
}

export function upsertNode(graph: KnowledgeGraph, node: KgNode): KnowledgeGraph {
  const existing = graph.nodes.findIndex(item => isSameCurrentStateKey(item, node))
  if (existing < 0) {
    return { ...graph, nodes: [...graph.nodes, node] }
  }
  const prev = graph.nodes[existing]
  if (prev.canonical_name === node.canonical_name && JSON.stringify(prev.metadata) === JSON.stringify(node.metadata)) {
    const nodes = [...graph.nodes]
    nodes[existing] = { ...prev, last_verified_at: node.last_verified_at ?? prev.last_verified_at, source_evidence_ids: uniqueIds([...prev.source_evidence_ids, ...node.source_evidence_ids]) }
    return { ...graph, nodes }
  }
  const resolution = resolveTemporalConflict(toFact(prev), toFact(node))
  const winner: KgNode = { ...node, node_id: node.node_id, temporal_state: 'CURRENT', superseded_by: null, superseded_at: null }
  const loser: KgNode = {
    ...prev,
    temporal_state: 'SUPERSEDED',
    superseded_at: node.observed_at ?? node.last_verified_at,
    superseded_by: winner.node_id,
  }
  const rest = graph.nodes.filter((_, index) => index !== existing)
  const supersededEdge: KgEdge = {
    edge_id: nid('e'),
    kind: 'SUPERSEDES',
    from_id: winner.node_id,
    to_id: loser.node_id,
    evidence_ids: winner.source_evidence_ids,
    observed_at: winner.observed_at ?? winner.last_verified_at ?? new Date().toISOString(),
    temporal_state: 'CURRENT',
  }
  const supersededByEdge: KgEdge = {
    edge_id: nid('e'),
    kind: 'SUPERSEDED_BY',
    from_id: loser.node_id,
    to_id: winner.node_id,
    evidence_ids: winner.source_evidence_ids,
    observed_at: winner.observed_at ?? winner.last_verified_at ?? new Date().toISOString(),
    temporal_state: 'HISTORICAL',
  }
  void resolution
  return { ...graph, nodes: [...rest, loser, winner], edges: [...graph.edges, supersededEdge, supersededByEdge] }
}

function toFact(node: KgNode): TemporalFact {
  return {
    node_id: node.node_id,
    canonical_name: node.canonical_name,
    observed_at: node.observed_at,
    confidence_state: node.confidence_state,
    source_evidence_ids: node.source_evidence_ids,
    temporal_state: node.temporal_state,
    metadata: node.metadata,
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

export function addEdge(graph: KnowledgeGraph, edge: Omit<KgEdge, 'edge_id'> & { edge_id?: string }): KnowledgeGraph {
  return {
    ...graph,
    edges: [...graph.edges, { ...edge, edge_id: edge.edge_id ?? nid('e') }],
  }
}

export function node(input: {
  type: KgNodeType
  name: string
  status: string
  evidenceIds: readonly string[]
  observedAt: string
  owner: string
  identity?: string | null
  version?: string | null
  metadata?: KgNode['metadata']
  truth?: TruthState
  temporal?: TemporalState
}): KgNode {
  return {
    node_id: nid(input.type.toLowerCase()),
    node_type: input.type,
    canonical_name: input.name,
    status: input.status,
    version: input.version ?? null,
    last_verified_at: input.observedAt,
    source_evidence_ids: [...input.evidenceIds],
    current_runtime_identity: input.identity ?? null,
    owner_system: input.owner,
    metadata: input.metadata ?? {},
    confidence_state: input.truth ?? (input.evidenceIds.length ? 'VERIFIED' : 'UNVERIFIED'),
    temporal_state: input.temporal ?? 'CURRENT',
    observed_at: input.observedAt,
    valid_from: input.observedAt,
    valid_until: null,
    superseded_at: null,
    superseded_by: null,
  }
}

export function currentNodes(graph: KnowledgeGraph, type?: KgNodeType): KgNode[] {
  return graph.nodes.filter(item => item.temporal_state === 'CURRENT' && (!type || item.node_type === type))
}

export function answerCurrentInstall(graph: KnowledgeGraph): string | null {
  const current = currentNodes(graph, 'INSTALL')
  const named = current.find(item => item.metadata.role === 'active_install') ?? current[0]
  return named?.canonical_name ?? named?.current_runtime_identity ?? null
}

export function seedWarRoomSelfKnowledge(input: {
  now?: string
  installId?: string | null
  evidenceInstall?: string
  councilState?: string | null
  evidenceCouncil?: string
  ebcActive?: boolean
  evidenceEbc?: string
  brokerState?: string | null
  evidenceBroker?: string
}): KnowledgeGraph {
  const now = input.now ?? new Date().toISOString()
  let graph = createKnowledgeGraph(now)
  const warRoom = node({
    type: 'WAR_ROOM',
    name: 'War Room OS',
    status: 'ACTIVE',
    evidenceIds: input.evidenceInstall ? [input.evidenceInstall] : ['seed-repo'],
    observedAt: now,
    owner: 'Commander',
    identity: input.installId ?? null,
    metadata: { canonical_repo: '/home/chosenone/Codex/war-room-os' },
    truth: input.evidenceInstall ? 'VERIFIED' : 'SUPPORTED',
  })
  graph = { ...graph, nodes: [...graph.nodes, warRoom], seeded_at: now }
  graph = addEdge(graph, {
    kind: 'OWNS',
    from_id: warRoom.node_id,
    to_id: warRoom.node_id,
    evidence_ids: warRoom.source_evidence_ids,
    observed_at: now,
    temporal_state: 'CURRENT',
  })

  const council = node({
    type: 'COUNCIL',
    name: 'Evidence Board Council',
    status: input.ebcActive ? 'ACTIVE' : 'UNKNOWN',
    evidenceIds: input.evidenceEbc ? [input.evidenceEbc] : [],
    observedAt: now,
    owner: 'Council',
    truth: input.ebcActive ? 'VERIFIED' : 'UNKNOWN',
    metadata: { ebc: 'truth_spine' },
  })
  graph = { ...graph, nodes: [...graph.nodes, council] }
  graph = addEdge(graph, {
    kind: 'PART_OF',
    from_id: council.node_id,
    to_id: warRoom.node_id,
    evidence_ids: council.source_evidence_ids,
    observed_at: now,
    temporal_state: 'CURRENT',
  })

  if (input.installId) {
    const install = node({
      type: 'INSTALL',
      name: input.installId,
      status: 'CURRENT',
      evidenceIds: input.evidenceInstall ? [input.evidenceInstall] : ['live-install'],
      observedAt: now,
      owner: 'Runtime',
      identity: input.installId,
      truth: 'VERIFIED',
      metadata: { role: 'active_install' },
    })
    graph = { ...graph, nodes: [...graph.nodes, install] }
    graph = addEdge(graph, {
      kind: 'INSTALLED_AS',
      from_id: warRoom.node_id,
      to_id: install.node_id,
      evidence_ids: install.source_evidence_ids,
      observed_at: now,
      temporal_state: 'CURRENT',
    })
    graph = addEdge(graph, {
      kind: 'RUNS_ON',
      from_id: council.node_id,
      to_id: install.node_id,
      evidence_ids: install.source_evidence_ids,
      observed_at: now,
      temporal_state: 'CURRENT',
    })
  }

  const research = node({
    type: 'CAPABILITY',
    name: 'DEEP_RESEARCH',
    status: 'ACTIVE',
    evidenceIds: input.evidenceEbc ? [input.evidenceEbc] : ['ebc-classifier'],
    observedAt: now,
    owner: 'Council',
    truth: 'VERIFIED',
    metadata: { routes_to: 'EVIDENCE_BOARD' },
  })
  const pulsar = node({
    type: 'CAPABILITY',
    name: 'PULSAR',
    status: 'ACTIVE',
    evidenceIds: ['ebc-assembly'],
    observedAt: now,
    owner: 'Council',
    truth: 'SUPPORTED',
    metadata: { produces: 'EVIDENCE' },
  })
  const lumen = node({
    type: 'CAPABILITY',
    name: 'LUMEN',
    status: 'ACTIVE',
    evidenceIds: ['ebc-verify'],
    observedAt: now,
    owner: 'Council',
    truth: 'SUPPORTED',
    metadata: { validates: 'CLAIMS' },
  })
  graph = { ...graph, nodes: [...graph.nodes, research, pulsar, lumen] }
  graph = addEdge(graph, { kind: 'ROUTES_TO', from_id: research.node_id, to_id: council.node_id, evidence_ids: research.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
  graph = addEdge(graph, { kind: 'PRODUCES', from_id: pulsar.node_id, to_id: council.node_id, evidence_ids: pulsar.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
  graph = addEdge(graph, { kind: 'VALIDATED_BY', from_id: council.node_id, to_id: lumen.node_id, evidence_ids: lumen.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })

  const terra = node({
    type: 'TERRA',
    name: 'Terra',
    status: 'PART_OF_WAR_ROOM',
    evidenceIds: ['seed-domain'],
    observedAt: now,
    owner: 'Terra',
    truth: 'SUPPORTED',
    metadata: { note: 'Lane status not asserted without live Terra evidence' },
  })
  const foundry = node({
    type: 'FOUNDRY',
    name: 'Foundry',
    status: 'PART_OF_WAR_ROOM',
    evidenceIds: ['seed-domain'],
    observedAt: now,
    owner: 'Foundry',
    truth: 'SUPPORTED',
  })
  const wrim = node({
    type: 'WRIM',
    name: 'WRIM',
    status: 'NOT_TRAINED_THIS_PASS',
    evidenceIds: ['seed-policy'],
    observedAt: now,
    owner: 'WRIM',
    truth: 'SUPPORTED',
    metadata: { training_touched: false },
  })
  const hvs = node({
    type: 'HIGHER_VISION',
    name: 'Higher Vision Studios',
    status: 'PART_OF_WAR_ROOM',
    evidenceIds: ['seed-domain'],
    observedAt: now,
    owner: 'HVS',
    truth: 'SUPPORTED',
  })
  graph = { ...graph, nodes: [...graph.nodes, terra, foundry, wrim, hvs] }
  for (const child of [terra, foundry, wrim, hvs]) {
    graph = addEdge(graph, { kind: 'PART_OF', from_id: child.node_id, to_id: warRoom.node_id, evidence_ids: child.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
  }
  if (input.installId) {
    const installNode = graph.nodes.find(item => item.node_type === 'INSTALL' && item.temporal_state === 'CURRENT')
    if (installNode) {
      graph = addEdge(graph, { kind: 'RUNS_ON', from_id: terra.node_id, to_id: installNode.node_id, evidence_ids: installNode.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
    }
  }
  if (input.brokerState) {
    const broker = node({
      type: 'TOOL',
      name: 'Browser Broker',
      status: input.brokerState,
      evidenceIds: input.evidenceBroker ? [input.evidenceBroker] : [],
      observedAt: now,
      owner: 'Broker',
      truth: input.evidenceBroker ? 'VERIFIED' : 'UNKNOWN',
    })
    graph = { ...graph, nodes: [...graph.nodes, broker] }
    graph = addEdge(graph, { kind: 'USES', from_id: council.node_id, to_id: broker.node_id, evidence_ids: broker.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
  }
  if (input.councilState) {
    const runtime = node({
      type: 'RUNTIME',
      name: 'Council local backend',
      status: input.councilState,
      evidenceIds: input.evidenceCouncil ? [input.evidenceCouncil] : [],
      observedAt: now,
      owner: 'Council',
      truth: input.evidenceCouncil ? 'VERIFIED' : 'UNKNOWN',
    })
    graph = { ...graph, nodes: [...graph.nodes, runtime] }
    graph = addEdge(graph, { kind: 'PROVIDED_BY', from_id: council.node_id, to_id: runtime.node_id, evidence_ids: runtime.source_evidence_ids, observed_at: now, temporal_state: 'CURRENT' })
  }
  return graph
}

export function ingestVerifiedKnowledge(graph: KnowledgeGraph, input: {
  missionId: string
  ebc: import('@/lib/council/evidence-board/types').EbcMissionResult | null
  now: string
}): KnowledgeGraph {
  if (!input.ebc) return graph
  let next = graph
  const mission = node({
    type: 'MISSION',
    name: input.missionId,
    status: input.ebc.aurora.completion_state,
    evidenceIds: input.ebc.board.evidence.filter(e => e.ok).slice(0, 4).map(e => e.evidence_id),
    observedAt: input.now,
    owner: 'Council',
    truth: input.ebc.board.evidence.some(e => e.ok) ? 'SUPPORTED' : 'UNVERIFIED',
    metadata: { class: input.ebc.classification.mission_class },
  })
  if (mission.source_evidence_ids.length) {
    next = { ...next, nodes: [...next.nodes, mission] }
    const council = next.nodes.find(n => n.node_type === 'COUNCIL')
    if (council) {
      next = addEdge(next, {
        kind: 'PRODUCES',
        from_id: council.node_id,
        to_id: mission.node_id,
        evidence_ids: mission.source_evidence_ids,
        observed_at: input.now,
        temporal_state: 'CURRENT',
      })
    }
  }
  for (const ev of input.ebc.board.evidence.filter(e => e.ok).slice(0, 6)) {
    const artifact = node({
      type: 'EVIDENCE',
      name: ev.evidence_id,
      status: 'CURRENT',
      evidenceIds: [ev.evidence_id],
      observedAt: input.now,
      owner: 'EBC',
      truth: 'VERIFIED',
      metadata: { tool: ev.tool_name, kind: ev.kind },
    })
    next = { ...next, nodes: [...next.nodes, artifact] }
  }
  return next
}

export function recordInstallChange(graph: KnowledgeGraph, input: {
  oldInstallId: string
  newInstallId: string
  oldObservedAt: string
  newObservedAt: string
  newEvidenceId: string
}): KnowledgeGraph {
  const oldNode = node({
    type: 'INSTALL',
    name: input.oldInstallId,
    status: 'CURRENT',
    evidenceIds: ['e-old-install'],
    observedAt: input.oldObservedAt,
    owner: 'Runtime',
    identity: input.oldInstallId,
    truth: 'VERIFIED',
    metadata: { role: 'active_install' },
  })
  let next = { ...graph, nodes: [...graph.nodes, oldNode] }
  const newNode = node({
    type: 'INSTALL',
    name: input.newInstallId,
    status: 'CURRENT',
    evidenceIds: [input.newEvidenceId],
    observedAt: input.newObservedAt,
    owner: 'Runtime',
    identity: input.newInstallId,
    truth: 'VERIFIED',
    metadata: { role: 'active_install' },
  })
  next = upsertNode(next, newNode)
  return next
}

export function applySupersede(graph: KnowledgeGraph, winnerId: string, loserId: string, at: string): KnowledgeGraph {
  return { ...graph, nodes: applySupersession(graph.nodes, winnerId, loserId, at) }
}

export type { KgEdgeType }
