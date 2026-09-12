/**
 * #22 Phase 12 — NAVIGATION_AGENT result contracts. No hidden CoT.
 */
import type { NavigationAgentIdentity } from './identity'
import type { NavigationAgentScope } from './scope'
import type { NavigationAgentTaskType } from './profile'
import type {
  EtaResult,
  MapMatchResult,
  MobileNavigationContract,
  NavigationInstruction,
  NavigationRoute,
  OffRouteState,
} from '@/lib/terra/navigation/types'
import type { RerouteTrigger } from '@/lib/terra/navigation/guidance'

export const NAVIGATION_AGENT_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DENIED',
  'FAILED',
  'NO_ROUTE',
  'INVALID_LOCATION',
  'UNSUPPORTED_MODE',
  'GNSS_NOT_SUPPORTED',
  'LIVE_TRAFFIC_NOT_IMPLEMENTED',
  'LOCATION_REQUIRED',
  'GRAPH_UNAVAILABLE',
  'TERRA_UNAVAILABLE',
  'OFF_ROUTE',
  'ROUTE_BLOCKED',
  'INTERNAL_ERROR',
] as const
export type NavigationAgentStatus = (typeof NAVIGATION_AGENT_STATUSES)[number]

export const LOCATION_PROVENANCE_CLASSES = [
  'EXPLICIT_USER_INPUT',
  'SESSION_LOCATION',
  'SUPPORTED_TERRA_SOURCE',
  'FIXTURE',
  'UNSUPPORTED_DEVICE_GNSS',
] as const
export type LocationProvenanceClass = (typeof LOCATION_PROVENANCE_CLASSES)[number]

export type NavigationAgentDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type NavigationAgentRerouteRecommendation = {
  recommended: boolean
  trigger: RerouteTrigger
  auto_executed: false
  recommended_route: NavigationRoute | null
  device_control: false
}

export type NavigationAgentResult = {
  agent_id: string
  agent_role: 'NAVIGATION_AGENT'
  status: NavigationAgentStatus
  task_type: NavigationAgentTaskType
  scope: NavigationAgentScope
  summary: string
  explanation: string
  location_provenance: LocationProvenanceClass | null
  location_runtime_state: string | null
  route: NavigationRoute | null
  comparison_routes: NavigationRoute[]
  match: MapMatchResult | null
  off_route: OffRouteState | null
  instructions: NavigationInstruction[]
  eta: EtaResult | null
  reroute: NavigationAgentRerouteRecommendation | null
  mobile_contract: MobileNavigationContract | null
  terra_is_oracle: true
  council_is_authorization: false
  astra_is_execution: false
  local_model_used: boolean
  local_model_overrode_engine: false
  live_traffic: 'NOT_IMPLEMENTED'
  mobile_gnss: 'NOT_SUPPORTED'
  phone_app: 'NOT_IMPLEMENTED'
  autonomous_driving: 'NOT_IMPLEMENTED'
  device_control: 'NOT_IMPLEMENTED'
  denials: NavigationAgentDenial[]
  limitations: string[]
  unavailable_capabilities: string[]
  audit_id: string | null
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  identity: NavigationAgentIdentity
  boundary_notes: readonly string[]
  plan_summary: string
  foundation_session_id: string | null
  roadmap_23_status: 'NOT_STARTED'
}

export const NAVIGATION_AGENT_BOUNDARY_NOTES = Object.freeze([
  'NAVIGATION_AGENT != TERRA',
  'NAVIGATION_AGENT != TERRA2',
  'NAVIGATION_AGENT != NAVIGATION2',
  'FOUNDATION != AGENT',
  'ROUTE CALCULATION != AUTONOMOUS DEVICE CONTROL',
  'RECOMMENDATION != AUTO-EXECUTE',
  'COUNCIL RECOMMENDATION != AUTHORIZATION',
  'ASTRA INTENT != DISPATCH',
  'LOCAL MODEL != ROUTE ENGINE',
  'FIXTURE != LIVE GNSS',
  'FIXTURE TRAFFIC != LIVE TRAFFIC',
  'MOBILE_GNSS = NOT_SUPPORTED',
  'LIVE_TRAFFIC = NOT_IMPLEMENTED',
  'PHONE_APP = NOT_IMPLEMENTED',
  'ASCENSION AUTONOMY OFF',
  '#23 NOT STARTED',
] as const)
