export type NarrativeNodeType = 'event' | 'person' | 'organization' | 'source' | 'location' | 'narrative' | 'theme' | 'contradiction'

export type NarrativeNode = {
  id: string
  type: NarrativeNodeType
  label: string
  confidence: number
  notes: string
}

export type NarrativeEdge = {
  from: string
  to: string
  relationship: 'supports' | 'contradicts' | 'mentions' | 'located_in' | 'synchronized_with' | 'derived_from'
  weight: number
}

export type NarrativeCluster = {
  id: string
  title: string
  nodeIds: string[]
  sourceOverlap: number
  narrativeSynchronization: number
  contradictionPressure: number
}

export const NARRATIVE_NODES: NarrativeNode[] = [
  { id: 'event-runtime-integrity', type: 'event', label: 'Runtime integrity review', confidence: 0.94, notes: 'System-state evidence anchors operational claims.' },
  { id: 'source-live-environment', type: 'source', label: 'Live Environment', confidence: 0.93, notes: 'Local runtime and environment feed.' },
  { id: 'theme-approval-gates', type: 'theme', label: 'Approval gates', confidence: 0.97, notes: 'No autonomous external execution.' },
  { id: 'narrative-learning-os', type: 'narrative', label: 'War Room becomes learning OS', confidence: 0.88, notes: 'Outcome memory improves provider and workflow selection.' },
  { id: 'contradiction-stale-source', type: 'contradiction', label: 'Stale source risk', confidence: 0.72, notes: 'Some sources may lag live conditions.' },
]

export const NARRATIVE_EDGES: NarrativeEdge[] = [
  { from: 'source-live-environment', to: 'event-runtime-integrity', relationship: 'supports', weight: 0.92 },
  { from: 'event-runtime-integrity', to: 'narrative-learning-os', relationship: 'derived_from', weight: 0.84 },
  { from: 'theme-approval-gates', to: 'narrative-learning-os', relationship: 'supports', weight: 0.96 },
  { from: 'contradiction-stale-source', to: 'source-live-environment', relationship: 'contradicts', weight: 0.42 },
]

export const NARRATIVE_CLUSTERS: NarrativeCluster[] = [
  {
    id: 'cluster-operational-truth',
    title: 'Operational truth and approval safety',
    nodeIds: ['event-runtime-integrity', 'source-live-environment', 'theme-approval-gates', 'narrative-learning-os'],
    sourceOverlap: 0.82,
    narrativeSynchronization: 0.78,
    contradictionPressure: 0.16,
  },
  {
    id: 'cluster-source-freshness',
    title: 'Source freshness contradictions',
    nodeIds: ['source-live-environment', 'contradiction-stale-source'],
    sourceOverlap: 0.48,
    narrativeSynchronization: 0.35,
    contradictionPressure: 0.62,
  },
]

export function getNarrativeGraph() {
  return {
    nodes: NARRATIVE_NODES,
    edges: NARRATIVE_EDGES,
    clusters: NARRATIVE_CLUSTERS,
  }
}
