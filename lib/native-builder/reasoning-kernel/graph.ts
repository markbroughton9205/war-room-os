/**
 * Typed reasoning graph. Nodes are engineering state, not a transcript.
 */
import type { FoundryReasoningEdge, FoundryReasoningGraph, FoundryReasoningNode, FrkEdgeType, FrkNodeType, FrkUncertainty } from './types'
import { clipText } from './text'

export function createReasoningGraph(): FoundryReasoningGraph {
  return { nodes: [], edges: [] }
}

export function addGraphNode(
  graph: FoundryReasoningGraph,
  node: FoundryReasoningNode,
): FoundryReasoningNode {
  graph.nodes.push({
    ...node,
    summary: clipText(node.summary),
  })
  return node
}

export function addGraphEdge(
  graph: FoundryReasoningGraph,
  edge: FoundryReasoningEdge,
): FoundryReasoningEdge {
  graph.edges.push(edge)
  return edge
}

export function graphInvariant(graph: FoundryReasoningGraph): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  const byId = new Map(graph.nodes.map(node => [node.nodeId, node]))
  for (const node of graph.nodes) {
    if (node.type !== 'DECISION') continue
    const incoming = graph.edges.filter(edge => edge.to === node.nodeId && (edge.type === 'SUPPORTS' || edge.type === 'DERIVED_FROM' || edge.type === 'VERIFIES'))
    const supporters = incoming
      .map(edge => byId.get(edge.from))
      .filter((item): item is FoundryReasoningNode => Boolean(item))
    const grounded = supporters.some(item => item.type === 'EVIDENCE' || item.type === 'ASSUMPTION')
    if (!grounded) violations.push(`${node.nodeId} decision has no evidence or explicit assumption`)
    if (node.uncertainty === 'KNOWN' && !supporters.some(item => item.type === 'EVIDENCE')) {
      violations.push(`${node.nodeId} claims known without evidence`)
    }
    if (node.assumptionUnresolved && node.uncertainty === 'KNOWN') {
      violations.push(`${node.nodeId} treats an unresolved assumption as known`)
    }
  }
  return { ok: violations.length === 0, violations }
}

export function nodeShell(
  nodeId: string,
  type: FrkNodeType,
  summary: string,
  uncertainty: FrkUncertainty,
): FoundryReasoningNode {
  return {
    nodeId,
    type,
    summary,
    uncertainty,
    assumptionUnresolved: false,
    supportRef: null,
  }
}

export function edgeShell(edgeId: string, from: string, to: string, type: FrkEdgeType): FoundryReasoningEdge {
  return { edgeId, from, to, type }
}
