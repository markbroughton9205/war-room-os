/**
 * #22 Phase 9 — Deterministic A* routing on bounded road graph.
 */
import { randomUUID } from 'node:crypto'
import { haversineMeters } from './geometry'
import { nearestRoadSegments, pointInGraphBounds } from './graph'
import type {
  NavigationIncident,
  NavigationRoute,
  RoadGraph,
  RoadSegment,
  TrafficObservation,
} from './types'

export type RouteRequest = {
  graph: RoadGraph
  origin: { latitude: number; longitude: number }
  destination: { latitude: number; longitude: number }
  mode?: 'DRIVING'
  traffic?: TrafficObservation[]
  incidents?: NavigationIncident[]
  locationSource?: string
  nowIso?: string
}

type Edge = {
  segment: RoadSegment
  from: string
  to: string
  costSeconds: number
  blocked: boolean
}

function buildAdjacency(
  graph: RoadGraph,
  traffic: TrafficObservation[],
  incidents: NavigationIncident[],
): Map<string, Edge[]> {
  const closed = new Set(
    incidents.filter(i => i.closure_state === 'CLOSED').flatMap(i => i.segment_ids),
  )
  const trafficBySeg = new Map(traffic.map(t => [t.segment_id, t]))
  const adj = new Map<string, Edge[]>()

  const push = (from: string, to: string, segment: RoadSegment) => {
    const list = adj.get(from) ?? []
    const t = trafficBySeg.get(segment.segment_id)
    const usableTraffic =
      t && (t.freshness === 'LIVE' || t.freshness === 'CACHED' || t.freshness === 'DELAYED')
        ? t
        : null
    const speed = usableTraffic?.speed_observed_kph ?? usableTraffic?.speed_free_flow_kph ?? segment.speed_limit_kph
    const kph = speed && speed > 0 ? speed : 40
    const costSeconds = (segment.length_meters / 1000) * (3600 / kph)
    list.push({
      segment,
      from,
      to,
      costSeconds,
      blocked: closed.has(segment.segment_id),
    })
    adj.set(from, list)
  }

  for (const seg of graph.segments) {
    push(seg.from_node, seg.to_node, seg)
    if (seg.bidirectional) push(seg.to_node, seg.from_node, seg)
  }
  return adj
}

function nearestNode(graph: RoadGraph, point: { latitude: number; longitude: number }): string | null {
  const near = nearestRoadSegments(graph, point, 1)[0]
  if (!near) return null
  const start = near.segment.geometry[0]!
  const end = near.segment.geometry[near.segment.geometry.length - 1]!
  return haversineMeters(point, start) <= haversineMeters(point, end)
    ? near.segment.from_node
    : near.segment.to_node
}

function canReach(start: string, goal: string, adj: Map<string, Edge[]>, allowBlocked: boolean): boolean {
  const seen = new Set<string>()
  const q = [start]
  while (q.length) {
    const n = q.pop()!
    if (n === goal) return true
    if (seen.has(n)) continue
    seen.add(n)
    for (const e of adj.get(n) ?? []) {
      if (!allowBlocked && e.blocked) continue
      q.push(e.to)
    }
  }
  return false
}

/** A* shortest-time path. Deterministic tie-break by node id / segment id. */
export function computeRoute(input: RouteRequest): NavigationRoute {
  const now = input.nowIso ?? new Date().toISOString()
  const traffic = input.traffic ?? []
  const incidents = input.incidents ?? []
  const limitations: string[] = []

  if (!pointInGraphBounds(input.graph, input.origin) || !pointInGraphBounds(input.graph, input.destination)) {
    return failRoute(input, now, 'OUT_OF_SCOPE', 'Origin or destination outside bounded graph scope.', traffic, incidents)
  }
  if (input.graph.segments.length === 0) {
    return failRoute(input, now, 'NO_ROAD_COVERAGE', 'No road coverage in graph.', traffic, incidents)
  }

  const start = nearestNode(input.graph, input.origin)
  const goal = nearestNode(input.graph, input.destination)
  if (!start || !goal) {
    return failRoute(input, now, 'NO_ROAD_COVERAGE', 'Could not snap origin/destination to road network.', traffic, incidents)
  }

  const adj = buildAdjacency(input.graph, traffic, incidents)
  const liveTrafficUsed = traffic.some(t => t.freshness === 'LIVE')
  if (!liveTrafficUsed) limitations.push('TRAFFIC_UNAVAILABLE or non-live — base speeds used.')
  if (incidents.length === 0) limitations.push('INCIDENT_DATA may be unavailable — no incidents applied.')

  type St = { g: number; parent: string | null; via: Edge | null }
  const best = new Map<string, St>()
  const open = new Set<string>([start])
  best.set(start, { g: 0, parent: null, via: null })

  const h = (nodeId: string) => {
    const n = input.graph.nodes[nodeId]
    const g = input.graph.nodes[goal]
    if (!n || !g) return 0
    return (haversineMeters(n, g) / 1000) * (3600 / 120)
  }

  while (open.size > 0) {
    let current: string | null = null
    let bestF = Number.POSITIVE_INFINITY
    for (const id of [...open].sort((a, b) => a.localeCompare(b))) {
      const st = best.get(id)!
      const f = st.g + h(id)
      if (f < bestF - 1e-12 || (Math.abs(f - bestF) < 1e-12 && (current === null || id < current))) {
        bestF = f
        current = id
      }
    }
    if (!current) break
    open.delete(current)
    if (current === goal) {
      return materializePath(input, start, goal, best, now, traffic, incidents, limitations)
    }
    const edges = (adj.get(current) ?? [])
      .filter(e => !e.blocked)
      .sort((a, b) => a.segment.segment_id.localeCompare(b.segment.segment_id))
    for (const edge of edges) {
      const ng = best.get(current)!.g + edge.costSeconds
      const prev = best.get(edge.to)
      if (!prev || ng < prev.g - 1e-12) {
        best.set(edge.to, { g: ng, parent: current, via: edge })
        open.add(edge.to)
      }
    }
  }

  if (canReach(start, goal, buildAdjacency(input.graph, traffic, []), true)) {
    return failRoute(input, now, 'BLOCKED', 'Route blocked by closure/incident.', traffic, incidents)
  }
  return failRoute(input, now, 'FAILED', 'No path found in bounded graph.', traffic, incidents)
}

function materializePath(
  input: RouteRequest,
  start: string,
  goal: string,
  best: Map<string, { g: number; parent: string | null; via: Edge | null }>,
  now: string,
  traffic: TrafficObservation[],
  incidents: NavigationIncident[],
  limitations: string[],
): NavigationRoute {
  const edges: Edge[] = []
  let cur: string | null = goal
  while (cur && cur !== start) {
    const st = best.get(cur)
    if (!st?.via || !st.parent) break
    edges.push(st.via)
    cur = st.parent
  }
  edges.reverse()
  const segment_ids = edges.map(e => e.segment.segment_id)
  const geometry = edges.flatMap((e, i) => (i === 0 ? e.segment.geometry : e.segment.geometry.slice(1)))
  const distance_meters = edges.reduce((s, e) => s + e.segment.length_meters, 0)
  const estimated_duration_seconds = Math.round(best.get(goal)?.g ?? 0)
  const trafficApplied = traffic.some(
    t =>
      segment_ids.includes(t.segment_id) &&
      (t.freshness === 'LIVE' || t.freshness === 'CACHED' || t.freshness === 'DELAYED'),
  )
  const incidentsApplied = incidents.some(i => i.segment_ids.some(id => segment_ids.includes(id)))

  return {
    route_id: `route_${randomUUID().slice(0, 8)}`,
    origin: input.origin,
    destination: input.destination,
    mode: 'DRIVING',
    distance_meters,
    estimated_duration_seconds,
    segment_ids,
    geometry,
    traffic_applied: trafficApplied,
    incidents_applied: incidentsApplied,
    confidence: 'MEDIUM',
    limitations,
    calculated_at: now,
    provenance: {
      road_provider: input.graph.provider,
      road_dataset_source: input.graph.source,
      graph_build_timestamp: input.graph.built_at,
      traffic_providers: [...new Set(traffic.map(t => t.provider))],
      incident_providers: [...new Set(incidents.map(i => i.provider))],
      location_source: input.locationSource ?? 'explicit_input',
      calculation_timestamp: now,
      freshness: trafficApplied ? 'CACHED' : 'NOT_IMPLEMENTED',
      limitations,
      algorithm: 'A_STAR',
    },
    status: 'OK',
  }
}

function failRoute(
  input: RouteRequest,
  now: string,
  status: NavigationRoute['status'],
  reason: string,
  traffic: TrafficObservation[],
  incidents: NavigationIncident[],
): NavigationRoute {
  return {
    route_id: `route_fail_${status.toLowerCase()}`,
    origin: input.origin,
    destination: input.destination,
    mode: 'DRIVING',
    distance_meters: 0,
    estimated_duration_seconds: 0,
    segment_ids: [],
    geometry: [],
    traffic_applied: false,
    incidents_applied: false,
    confidence: 'UNVERIFIED',
    limitations: [reason],
    calculated_at: now,
    provenance: {
      road_provider: input.graph.provider,
      road_dataset_source: input.graph.source,
      graph_build_timestamp: input.graph.built_at,
      traffic_providers: [...new Set(traffic.map(t => t.provider))],
      incident_providers: [...new Set(incidents.map(i => i.provider))],
      location_source: input.locationSource ?? 'explicit_input',
      calculation_timestamp: now,
      freshness: status === 'NO_ROAD_COVERAGE' ? 'NO_COVERAGE' : 'UNAVAILABLE',
      limitations: [reason],
      algorithm: 'A_STAR',
    },
    status,
  }
}
