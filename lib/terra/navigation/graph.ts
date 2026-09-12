/**
 * #22 Phase 9 — Bounded road graph model + fixture graph.
 * No RoadGraph2. No whole-planet load.
 */
import { haversineMeters, isFiniteGeometry, polylineLengthMeters } from './geometry'
import {
  NAVIGATION_DEFAULT_BOUNDS,
  type RoadGraph,
  type RoadSegment,
} from './types'

export type BuildGraphInput = {
  segments: RoadSegment[]
  graphId?: string
  provider?: string
  source?: string
  nowIso?: string
  bounds?: typeof NAVIGATION_DEFAULT_BOUNDS
}

export function buildRoadGraph(input: BuildGraphInput): {
  ok: true
  graph: RoadGraph
} | { ok: false; reason: string; status: 'OUT_OF_SCOPE' | 'FAILED' } {
  const bounds = { ...NAVIGATION_DEFAULT_BOUNDS, ...input.bounds }
  if (input.segments.length === 0) {
    return { ok: false, reason: 'No road segments supplied.', status: 'FAILED' }
  }
  if (input.segments.length > bounds.max_graph_edges) {
    return {
      ok: false,
      reason: `Graph edge bound exceeded (${input.segments.length} > ${bounds.max_graph_edges}).`,
      status: 'OUT_OF_SCOPE',
    }
  }

  const nodes: RoadGraph['nodes'] = {}
  const cleaned: RoadSegment[] = []
  for (const seg of input.segments) {
    if (!isFiniteGeometry(seg.geometry)) {
      return { ok: false, reason: `Malformed geometry on segment ${seg.segment_id}.`, status: 'FAILED' }
    }
    const length =
      seg.length_meters > 0 ? seg.length_meters : polylineLengthMeters(seg.geometry)
    cleaned.push({ ...seg, length_meters: length })
    const start = seg.geometry[0]!
    const end = seg.geometry[seg.geometry.length - 1]!
    nodes[seg.from_node] = { latitude: start.latitude, longitude: start.longitude }
    nodes[seg.to_node] = { latitude: end.latitude, longitude: end.longitude }
  }

  const nodeCount = Object.keys(nodes).length
  if (nodeCount > bounds.max_graph_nodes) {
    return {
      ok: false,
      reason: `Graph node bound exceeded (${nodeCount} > ${bounds.max_graph_nodes}).`,
      status: 'OUT_OF_SCOPE',
    }
  }

  const lats = Object.values(nodes).map(n => n.latitude)
  const lons = Object.values(nodes).map(n => n.longitude)
  const graph: RoadGraph = {
    graph_id: input.graphId ?? `graph_${cleaned.length}`,
    bounds: {
      south: Math.min(...lats),
      north: Math.max(...lats),
      west: Math.min(...lons),
      east: Math.max(...lons),
    },
    nodes,
    segments: cleaned,
    built_at: input.nowIso ?? new Date().toISOString(),
    provider: input.provider ?? 'fixture_road_graph',
    source: input.source ?? 'terra_navigation_fixture',
    limitations: [
      'BOUNDED graph only — no whole-planet load.',
      'DRIVING mode semantics only.',
      'Fixture/source data — not a second RoadGraph product.',
    ],
  }
  return { ok: true, graph }
}

export function pointInGraphBounds(
  graph: RoadGraph,
  point: { latitude: number; longitude: number },
  padDegrees = 0.01,
): boolean {
  return (
    point.latitude >= graph.bounds.south - padDegrees &&
    point.latitude <= graph.bounds.north + padDegrees &&
    point.longitude >= graph.bounds.west - padDegrees &&
    point.longitude <= graph.bounds.east + padDegrees
  )
}

export function nearestRoadSegments(
  graph: RoadGraph,
  point: { latitude: number; longitude: number },
  limit = 5,
): Array<{ segment: RoadSegment; distance_meters: number }> {
  const scored = graph.segments.map(segment => {
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < segment.geometry.length - 1; i++) {
      const a = segment.geometry[i]!
      const b = segment.geometry[i + 1]!
      // approximate with min distance to endpoints + mid for speed; routing mapMatch does precise
      const d = Math.min(
        haversineMeters(point, a),
        haversineMeters(point, b),
        haversineMeters(point, {
          latitude: (a.latitude + b.latitude) / 2,
          longitude: (a.longitude + b.longitude) / 2,
        }),
      )
      if (d < best) best = d
    }
    return { segment, distance_meters: best }
  })
  return scored.sort((a, b) => a.distance_meters - b.distance_meters).slice(0, limit)
}

/** Small Helsinki-area fixture graph for deterministic routing / matching proofs. */
export function makeHelsinkiFixtureRoadGraph(nowIso = new Date().toISOString()): RoadGraph {
  const mk = (
    id: string,
    from: string,
    to: string,
    geometry: Array<{ latitude: number; longitude: number }>,
    name: string,
    speed: number,
  ): RoadSegment => ({
    segment_id: id,
    geometry,
    from_node: from,
    to_node: to,
    road_class: 'tertiary',
    bidirectional: true,
    speed_limit_kph: speed,
    access_restrictions: [],
    surface: 'asphalt',
    name,
    provider: 'fixture_osm_like',
    source: 'terra_navigation_fixture',
    retrieved_at: nowIso,
    freshness: 'CACHED',
    length_meters: polylineLengthMeters(geometry),
  })

  // Compact corridor near Helsinki (fixture, not live OSM download)
  const segments: RoadSegment[] = [
    mk('seg-a', 'n1', 'n2', [
      { latitude: 60.1700, longitude: 24.9380 },
      { latitude: 60.1715, longitude: 24.9405 },
    ], 'Fixture Road A', 50),
    mk('seg-b', 'n2', 'n3', [
      { latitude: 60.1715, longitude: 24.9405 },
      { latitude: 60.1730, longitude: 24.9430 },
    ], 'Fixture Road B', 50),
    mk('seg-c', 'n3', 'n4', [
      { latitude: 60.1730, longitude: 24.9430 },
      { latitude: 60.1745, longitude: 24.9455 },
    ], 'Fixture Road C', 40),
    mk('seg-d', 'n2', 'n5', [
      { latitude: 60.1715, longitude: 24.9405 },
      { latitude: 60.1720, longitude: 24.9370 },
    ], 'Fixture Spur D', 30),
    mk('seg-e', 'n5', 'n4', [
      { latitude: 60.1720, longitude: 24.9370 },
      { latitude: 60.1745, longitude: 24.9455 },
    ], 'Fixture Bypass E', 40),
    mk('seg-closed', 'n3', 'n6', [
      { latitude: 60.1730, longitude: 24.9430 },
      { latitude: 60.1735, longitude: 24.9480 },
    ], 'Fixture Closed F', 50),
  ]

  const built = buildRoadGraph({
    segments,
    graphId: 'fixture-helsinki-nav-v1',
    provider: 'fixture_osm_like',
    source: 'terra_navigation_fixture',
    nowIso,
  })
  if (!built.ok) throw new Error(built.reason)
  return built.graph
}
