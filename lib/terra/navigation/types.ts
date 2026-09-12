/**
 * #22 Phase 9 — Terra Navigation Foundation types.
 * Foundation ≠ FUTURE_NAVIGATION_AGENT. Route calculation ≠ device control.
 */
export const NAVIGATION_LOCATION_RUNTIME_STATES = [
  'LIVE_DEVICE_LOCATION',
  'SUPPLIED_LOCATION',
  'STALE_LOCATION',
  'UNAVAILABLE',
  'PERMISSION_DENIED',
  'NOT_SUPPORTED',
  'UNKNOWN',
] as const
export type NavigationLocationRuntimeState = (typeof NAVIGATION_LOCATION_RUNTIME_STATES)[number]

export const NAVIGATION_FRESHNESS_STATES = [
  'LIVE',
  'DELAYED',
  'CACHED',
  'STALE',
  'NO_COVERAGE',
  'NOT_CONFIGURED',
  'NOT_IMPLEMENTED',
  'UNAVAILABLE',
  'EMPTY',
  'READY',
] as const
export type NavigationFreshness = (typeof NAVIGATION_FRESHNESS_STATES)[number]

export const MAP_MATCH_STATES = [
  'MATCHED',
  'LOW_CONFIDENCE',
  'AMBIGUOUS',
  'NO_MATCH',
  'NO_ROAD_COVERAGE',
] as const
export type MapMatchState = (typeof MAP_MATCH_STATES)[number]

export const OFF_ROUTE_STATES = [
  'ON_ROUTE',
  'SLIGHTLY_OFF_ROUTE',
  'OFF_ROUTE',
  'UNKNOWN',
] as const
export type OffRouteState = (typeof OFF_ROUTE_STATES)[number]

export const NAVIGATION_MODES = ['DRIVING'] as const
export type NavigationMode = (typeof NAVIGATION_MODES)[number]

export const INCIDENT_TYPES = [
  'ACCIDENT',
  'ROAD_CLOSED',
  'LANE_CLOSED',
  'CONSTRUCTION',
  'WEATHER_IMPACT',
  'HAZARD',
  'OTHER',
] as const
export type NavigationIncidentType = (typeof INCIDENT_TYPES)[number]

export const INSTRUCTION_ACTIONS = [
  'CONTINUE',
  'TURN_LEFT',
  'TURN_RIGHT',
  'KEEP_LEFT',
  'KEEP_RIGHT',
  'MERGE',
  'EXIT',
  'ARRIVE',
] as const
export type NavigationInstructionAction = (typeof INSTRUCTION_ACTIONS)[number]

export type NavigationLocationObservation = {
  latitude: number
  longitude: number
  accuracy_meters: number | null
  altitude_meters: number | null
  heading_degrees: number | null
  speed_mps: number | null
  observed_at: string
  source: 'explicit_input' | 'device_gnss' | 'session_supplied' | 'fixture'
  provider: string
  permission_state: 'GRANTED' | 'DENIED' | 'NOT_APPLICABLE' | 'UNKNOWN'
  freshness: NavigationFreshness
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
  runtime_state: NavigationLocationRuntimeState
  device_id: string | null
  session_id: string | null
  owner_user_id: string | null
}

export type RoadSegment = {
  segment_id: string
  geometry: Array<{ latitude: number; longitude: number }>
  from_node: string
  to_node: string
  road_class: string
  bidirectional: boolean
  speed_limit_kph: number | null
  access_restrictions: string[]
  surface: string | null
  name: string | null
  provider: string
  source: string
  retrieved_at: string
  freshness: NavigationFreshness
  length_meters: number
}

export type RoadGraph = {
  graph_id: string
  bounds: { south: number; north: number; west: number; east: number }
  nodes: Record<string, { latitude: number; longitude: number }>
  segments: RoadSegment[]
  built_at: string
  provider: string
  source: string
  limitations: string[]
}

export type TrafficObservation = {
  segment_id: string
  speed_observed_kph: number | null
  speed_free_flow_kph: number | null
  congestion_level: 'FREE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'UNKNOWN'
  delay_seconds: number | null
  observed_at: string | null
  provider: string
  source: string
  freshness: NavigationFreshness
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
}

export type NavigationIncident = {
  incident_id: string
  type: NavigationIncidentType
  segment_ids: string[]
  location: { latitude: number; longitude: number } | null
  start_time: string | null
  end_time: string | null
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  description: string
  closure_state: 'OPEN' | 'PARTIAL' | 'CLOSED' | 'UNKNOWN'
  provider: string
  source: string
  observed_at: string
  freshness: NavigationFreshness
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
}

export type RouteProvenance = {
  road_provider: string
  road_dataset_source: string
  graph_build_timestamp: string
  traffic_providers: string[]
  incident_providers: string[]
  location_source: string
  calculation_timestamp: string
  freshness: NavigationFreshness
  limitations: string[]
  algorithm: 'A_STAR'
}

export type NavigationRoute = {
  route_id: string
  origin: { latitude: number; longitude: number }
  destination: { latitude: number; longitude: number }
  mode: NavigationMode
  distance_meters: number
  estimated_duration_seconds: number
  segment_ids: string[]
  geometry: Array<{ latitude: number; longitude: number }>
  traffic_applied: boolean
  incidents_applied: boolean
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
  limitations: string[]
  calculated_at: string
  provenance: RouteProvenance
  status: 'OK' | 'NO_ROAD_COVERAGE' | 'OUT_OF_SCOPE' | 'BLOCKED' | 'FAILED'
}

export type EtaResult = {
  base_eta_seconds: number
  traffic_adjusted_eta_seconds: number | null
  incident_adjusted_eta_seconds: number | null
  final_eta_seconds: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
  inputs_used: string[]
  real_time_claimed: false | true
}

export type MapMatchResult = {
  state: MapMatchState
  matched_segment_id: string | null
  distance_from_segment_meters: number | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
  heading_match: boolean | null
  candidates: Array<{ segment_id: string; distance_meters: number }>
  limitations: string[]
}

export type NavigationInstruction = {
  instruction_id: string
  type: NavigationInstructionAction
  road_name: string | null
  distance_to_action_meters: number
  action: NavigationInstructionAction
  bearing_degrees: number | null
  location: { latitude: number; longitude: number } | null
  segment_id: string | null
  sequence: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'
}

export type NavigationCapabilityTruth = {
  LOCATION_INPUT: 'IMPLEMENTED'
  ROAD_GRAPH: 'IMPLEMENTED_BOUNDED'
  ROUTING: 'IMPLEMENTED_BOUNDED'
  MAP_MATCHING: 'IMPLEMENTED_BOUNDED'
  NAVIGATION_INSTRUCTIONS: 'IMPLEMENTED_BOUNDED'
  TRAFFIC_CONTRACT: 'IMPLEMENTED'
  LIVE_TRAFFIC: 'NOT_IMPLEMENTED' | 'NO_COVERAGE' | 'PARTIAL' | 'LIVE'
  INCIDENTS: 'NOT_IMPLEMENTED' | 'NO_COVERAGE' | 'PARTIAL' | 'LIVE' | 'FIXTURE_ONLY'
  MOBILE_GNSS: 'NOT_SUPPORTED' | 'IMPLEMENTED'
  BACKGROUND_TRACKING: 'DENIED'
  DEVICE_CONTROL: 'DENIED'
  FUTURE_NAVIGATION_AGENT: 'TARGET_UNIMPLEMENTED' | 'IMPLEMENTED_BOUNDED'
}

export type MobileNavigationContract = {
  session_id: string
  current_location: NavigationLocationObservation | null
  destination: { latitude: number; longitude: number } | null
  route: NavigationRoute | null
  progress: {
    distance_remaining_meters: number | null
    off_route_state: OffRouteState
    next_instruction: NavigationInstruction | null
  }
  eta: EtaResult | null
  traffic_state: NavigationFreshness
  incident_summary: string[]
  reroute_available: boolean
  runtime_truth: NavigationCapabilityTruth
  persistent_tracking: false
}

export const NAVIGATION_DEFAULT_BOUNDS = Object.freeze({
  max_geographic_radius_km: 25,
  max_graph_nodes: 200,
  max_graph_edges: 400,
  max_route_alternatives: 1,
  max_traffic_records: 100,
  max_incidents: 50,
  max_location_updates_per_request: 5,
  max_runtime_ms: 5_000,
  off_route_slight_meters: 35,
  off_route_hard_meters: 80,
  map_match_max_meters: 40,
  map_match_ambiguous_delta_meters: 8,
} as const)
