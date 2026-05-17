import { NARRATIVE_EDGES, NARRATIVE_NODES, type NarrativeEdge, type NarrativeNode } from './narrativeGraph'

export type EventRelationshipMap = {
  eventId: string
  directNodes: NarrativeNode[]
  relationships: NarrativeEdge[]
  sourceOverlapScore: number
  contradictionClusterIds: string[]
  emergingThemes: string[]
}

export function mapEventRelationships(eventId: string): EventRelationshipMap {
  const relationships = NARRATIVE_EDGES.filter(edge => edge.from === eventId || edge.to === eventId)
  const nodeIds = new Set(relationships.flatMap(edge => [edge.from, edge.to]))
  const directNodes = NARRATIVE_NODES.filter(node => nodeIds.has(node.id))
  const contradictionClusterIds = directNodes
    .filter(node => node.type === 'contradiction')
    .map(node => node.id)
  const sourceEdges = relationships.filter(edge => directNodes.some(node => node.type === 'source' && (node.id === edge.from || node.id === edge.to)))

  return {
    eventId,
    directNodes,
    relationships,
    sourceOverlapScore: sourceEdges.length ? sourceEdges.reduce((sum, edge) => sum + edge.weight, 0) / sourceEdges.length : 0,
    contradictionClusterIds,
    emergingThemes: directNodes.filter(node => node.type === 'theme' || node.type === 'narrative').map(node => node.label),
  }
}

export function getRelationshipMaps(): EventRelationshipMap[] {
  return NARRATIVE_NODES
    .filter(node => node.type === 'event')
    .map(node => mapEventRelationships(node.id))
}
