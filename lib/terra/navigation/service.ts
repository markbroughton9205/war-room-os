/**
 * #22 Phase 9 — Bounded navigation foundation service (request-driven).
 */
import { randomUUID } from 'node:crypto'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { createLocationObservation, LOCATION_PRIVACY_DEFAULTS } from './location'
import { buildRoadGraph, makeHelsinkiFixtureRoadGraph, pointInGraphBounds } from './graph'
import { computeRoute } from './routing'
import {
  buildNavigationInstructions,
  classifyOffRoute,
  computeEta,
  evaluateRerouteTrigger,
  makeFixtureIncidents,
  makeFixtureTraffic,
  mapMatchLocation,
  trafficProviderTruthSummary,
} from './guidance'
import {
  assertBabyNavigationDenied,
  assertNavigationOwnerScopeMatch,
  assertNoBackgroundTracking,
  assertNoDeviceControl,
} from './ownership'
import { getNavigationCapabilityTruth, navigationRoadmapTruth } from './runtimeTruth'
import type {
  MobileNavigationContract,
  NavigationIncident,
  NavigationLocationObservation,
  NavigationRoute,
  RoadGraph,
  TrafficObservation,
} from './types'
import { NAVIGATION_DEFAULT_BOUNDS } from './types'
import { assertValidLatLng } from './geometry'

export type NavigationServiceDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type NavigationServiceResult = {
  status: 'OK' | 'PARTIAL' | 'DENIED' | 'FAILED' | 'NO_ROAD_COVERAGE' | 'OUT_OF_SCOPE' | 'LOCATION_UNAVAILABLE'
  session_id: string
  location: NavigationLocationObservation | null
  graph: RoadGraph | null
  route: NavigationRoute | null
  match: ReturnType<typeof mapMatchLocation> | null
  instructions: ReturnType<typeof buildNavigationInstructions>
  eta: ReturnType<typeof computeEta> | null
  off_route: ReturnType<typeof classifyOffRoute> | null
  reroute: ReturnType<typeof evaluateRerouteTrigger> | null
  traffic: TrafficObservation[]
  incidents: NavigationIncident[]
  traffic_truth: ReturnType<typeof trafficProviderTruthSummary>
  runtime_truth: ReturnType<typeof getNavigationCapabilityTruth>
  roadmap_truth: ReturnType<typeof navigationRoadmapTruth>
  mobile_contract: MobileNavigationContract | null
  denials: NavigationServiceDenial[]
  limitations: string[]
  audit_id: string | null
  privacy: typeof LOCATION_PRIVACY_DEFAULTS
  boundary_notes: readonly string[]
}

const BOUNDARY_NOTES = Object.freeze([
  'TERRA NAVIGATION FOUNDATION != NAVIGATION AGENT',
  'ROUTE CALCULATION != AUTONOMOUS DEVICE CONTROL',
  'TRAFFIC DATA != ACTION AUTHORITY',
  'GPS INPUT != USER SURVEILLANCE AUTHORITY',
  'ROUTE AVAILABLE != ACTION AUTHORIZED',
  'MISSION != MOVEMENT AUTHORIZATION',
  'NAVIGATION_AGENT is bounded reasoning over this foundation — not a second engine',
  '#23 WR-CORPUS ACTIVE; tokenizer/WRIM/Rael not production',
] as const)

export type RunNavigationFoundationInput = {
  ownerUserId: string
  requestedBy: string
  origin: { latitude: number; longitude: number }
  destination: { latitude: number; longitude: number }
  locationObservedAt?: string
  claimLiveDeviceGps?: boolean
  locationSource?: 'explicit_input' | 'device_gnss' | 'session_supplied' | 'fixture'
  sessionId?: string | null
  resourceOwnerUserId?: string | null
  enforceOwnership?: boolean
  useFixtureGraph?: boolean
  graph?: RoadGraph
  traffic?: TrafficObservation[]
  incidents?: NavigationIncident[]
  requestReroute?: boolean
  attemptBackgroundTracking?: boolean
  attemptDeviceControl?: boolean
  attemptBabyAccess?: boolean
  attemptContinuousHistory?: boolean
  attemptSpawnNavigationAgent?: boolean
  attemptStart23?: boolean
  councilAuthorizeAction?: boolean
  astraAuthorizeMovement?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

export async function runNavigationFoundation(
  input: RunNavigationFoundationInput,
): Promise<NavigationServiceResult> {
  const now = input.nowIso ?? new Date().toISOString()
  const session_id = input.sessionId ?? randomUUID()
  const denials: NavigationServiceDenial[] = []
  const limitations: string[] = [
    'Request/session driven — no background tracking daemon.',
    'Walking/transit/bike modes NOT_IMPLEMENTED.',
    'Live segment traffic NOT_IMPLEMENTED.',
    'Mobile app UI not built — contract only.',
  ]
  let audit_id: string | null = null

  const finish = async (
    status: NavigationServiceResult['status'],
    partial: Partial<NavigationServiceResult>,
  ): Promise<NavigationServiceResult> => {
    const runtime_truth = getNavigationCapabilityTruth()
    const roadmap_truth = navigationRoadmapTruth()
    const result: NavigationServiceResult = {
      status,
      session_id,
      location: partial.location ?? null,
      graph: partial.graph ?? null,
      route: partial.route ?? null,
      match: partial.match ?? null,
      instructions: partial.instructions ?? [],
      eta: partial.eta ?? null,
      off_route: partial.off_route ?? null,
      reroute: partial.reroute ?? null,
      traffic: partial.traffic ?? [],
      incidents: partial.incidents ?? [],
      traffic_truth: trafficProviderTruthSummary(),
      runtime_truth,
      roadmap_truth,
      mobile_contract: partial.mobile_contract ?? null,
      denials,
      limitations: [...limitations, ...(partial.limitations ?? [])],
      audit_id,
      privacy: LOCATION_PRIVACY_DEFAULTS,
      boundary_notes: BOUNDARY_NOTES,
    }

    try {
      const decision = {
        outcome: status === 'DENIED' ? ('DENY' as const) : ('ALLOW' as const),
        reasonCode: status === 'DENIED' ? ('POLICY_DENIED' as const) : ('ALLOWED_BOUNDED_READ' as const),
        reason: 'Terra navigation foundation request.',
        actionKind: 'terra_navigation_foundation',
        canonicalKind: null,
        riskTier: 'TIER_0_READ_OBSERVE' as const,
        technicalReach: 'READ_ONLY' as const,
        policyAuthority: 'READ_ALLOWED' as const,
        requiresApproval: false,
        approvalSatisfied: true,
        httpStatus: status === 'DENIED' ? 403 : 200,
      }
      const meta = buildGovernedAuditMetadata({
        decision,
        requestedBy: input.requestedBy,
        actorAgent: 'TERRA_NAVIGATION_FOUNDATION',
        tool: 'terra.navigation.runNavigationFoundation',
        target: session_id,
        ownerUserId: input.ownerUserId,
        evidenceRefs: result.route ? [result.route.route_id] : [],
        executionResult: status === 'DENIED' ? 'denied' : 'executed',
      })
      // Avoid precise lat/lon in broad audit fields
      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: 'system',
        category: 'runtime',
        message: `TERRA_NAVIGATION_FOUNDATION ${status}`,
        actionId: session_id,
        metadata: meta,
        extra: {
          status,
          session_id,
          route_status: result.route?.status ?? null,
          algorithm: 'A_STAR',
          traffic_live: result.runtime_truth.LIVE_TRAFFIC,
          device_control: 'DENIED',
          background_tracking: 'DENIED',
          future_navigation_agent: 'IMPLEMENTED_BOUNDED',
          roadmap_23: navigationRoadmapTruth().roadmap_23,
          // no precise coordinates
          origin_present: true,
          destination_present: true,
          chain_of_thought: undefined,
          secrets: undefined,
        },
      })
      audit_id = session_id
      result.audit_id = audit_id
    } catch {
      limitations.push('Audit persistence unavailable.')
    }
    return result
  }

  // Red-team / policy probes
  if (input.attemptBackgroundTracking || input.attemptContinuousHistory) {
    const t = assertNoBackgroundTracking(true)
    denials.push({ capability_or_action: 'BACKGROUND_TRACKING', reason_code: 'POLICY_DENIED', reason: t.reason })
  }
  if (input.attemptDeviceControl) {
    const t = assertNoDeviceControl(true)
    denials.push({ capability_or_action: 'DEVICE_CONTROL', reason_code: 'POLICY_DENIED', reason: t.reason })
  }
  if (input.attemptBabyAccess) {
    const t = assertBabyNavigationDenied()
    denials.push({ capability_or_action: 'BABY_NAVIGATION', reason_code: 'POLICY_DENIED', reason: t.reason })
  }
  if (input.attemptSpawnNavigationAgent) {
    denials.push({
      capability_or_action: 'AGENT_SPAWN',
      reason_code: 'POLICY_DENIED',
      reason: 'Spawning another navigation agent is denied. NAVIGATION_AGENT is the single canonical agent.',
    })
  }
  if (input.attemptStart23) {
    denials.push({
      capability_or_action: 'ROADMAP_23',
      reason_code: 'POLICY_DENIED',
      reason: '#23 WR-CORPUS is ACTIVE. Terra Navigation cannot start tokenizer/WRIM/Ra\'el or a second corpus architecture.',
    })
  }
  if (input.councilAuthorizeAction) {
    denials.push({
      capability_or_action: 'COUNCIL_ACTION',
      reason_code: 'COUNCIL_CANNOT_AUTHORIZE',
      reason: 'ROUTE AVAILABLE != ACTION AUTHORIZED.',
    })
  }
  if (input.astraAuthorizeMovement) {
    denials.push({
      capability_or_action: 'ASTRA_MOVEMENT',
      reason_code: 'ASTRA_MISSION_NOT_MOVEMENT_AUTHORITY',
      reason: 'MISSION != MOVEMENT AUTHORIZATION.',
    })
  }

  const serviceRole = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'MISSION_EXECUTION',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  denials.push({
    capability_or_action: 'SERVICE_ROLE_PROBE',
    reason_code: serviceRole.reasonCode,
    reason: 'SERVICE_ROLE_TECHNICAL_REACH != ownership permission.',
  })

  if (input.enforceOwnership) {
    const match = assertNavigationOwnerScopeMatch(
      input.ownerUserId,
      input.resourceOwnerUserId ?? input.ownerUserId,
    )
    if (!match.ok) {
      denials.push({ capability_or_action: 'OWNER_SCOPE', reason_code: 'OWNER_SCOPE_DENIED', reason: match.reason })
      return finish('DENIED', {})
    }
  }
  if (
    input.resourceOwnerUserId &&
    input.resourceOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user navigation/location access denied.',
    })
    return finish('DENIED', {})
  }

  const originOk = assertValidLatLng(input.origin.latitude, input.origin.longitude)
  const destOk = assertValidLatLng(input.destination.latitude, input.destination.longitude)
  if (!originOk.ok || !destOk.ok) {
    const reason = !originOk.ok ? originOk.reason : !destOk.ok ? destOk.reason : 'Invalid coordinates'
    return finish('LOCATION_UNAVAILABLE', {
      limitations: [reason],
    })
  }

  const loc = createLocationObservation({
    latitude: input.origin.latitude,
    longitude: input.origin.longitude,
    observedAt: input.locationObservedAt ?? now,
    source: input.locationSource ?? 'explicit_input',
    claimLiveDeviceGps: input.claimLiveDeviceGps === true,
    permissionState: input.claimLiveDeviceGps ? 'GRANTED' : 'NOT_APPLICABLE',
    sessionId: session_id,
    ownerUserId: input.ownerUserId,
    nowIso: now,
  })
  if (!loc.ok) {
    return finish('LOCATION_UNAVAILABLE', { limitations: [loc.reason] })
  }

  // Huge geographic span denied
  const approxKm =
    Math.hypot(
      (input.origin.latitude - input.destination.latitude) * 111,
      (input.origin.longitude - input.destination.longitude) * 111 * Math.cos((input.origin.latitude * Math.PI) / 180),
    )
  if (approxKm > NAVIGATION_DEFAULT_BOUNDS.max_geographic_radius_km * 2) {
    denials.push({
      capability_or_action: 'GEO_BOUNDS',
      reason_code: 'TARGET_OUT_OF_SCOPE',
      reason: 'Route request exceeds bounded geographic radius.',
    })
    return finish('OUT_OF_SCOPE', { location: loc.location })
  }

  const graph =
    input.graph ??
    (input.useFixtureGraph !== false ? makeHelsinkiFixtureRoadGraph(now) : null)
  if (!graph) {
    return finish('FAILED', { location: loc.location, limitations: ['No road graph supplied.'] })
  }

  // Enforce graph size already in build; also reject if origin outside
  if (!pointInGraphBounds(graph, input.origin) || !pointInGraphBounds(graph, input.destination)) {
    return finish('OUT_OF_SCOPE', {
      location: loc.location,
      graph,
      limitations: ['Origin/destination outside graph bounds.'],
    })
  }

  const traffic = input.traffic ?? makeFixtureTraffic(now)
  const incidents = input.incidents ?? makeFixtureIncidents(now)

  const match = mapMatchLocation(graph, input.origin, loc.location.heading_degrees)
  const route = computeRoute({
    graph,
    origin: input.origin,
    destination: input.destination,
    traffic,
    incidents,
    locationSource: loc.location.source,
    nowIso: now,
  })

  let status: NavigationServiceResult['status'] = 'OK'
  if (route.status === 'NO_ROAD_COVERAGE') status = 'NO_ROAD_COVERAGE'
  else if (route.status === 'OUT_OF_SCOPE') status = 'OUT_OF_SCOPE'
  else if (route.status === 'FAILED' || route.status === 'BLOCKED') status = 'PARTIAL'
  else if (traffic.some(t => t.freshness === 'NOT_IMPLEMENTED' || t.freshness === 'STALE')) status = 'PARTIAL'

  const instructions = buildNavigationInstructions(route, graph)
  const eta = route.status === 'OK' ? computeEta({ route, traffic, incidents }) : null
  const off_route = route.status === 'OK' ? classifyOffRoute(route, input.origin) : null
  const reroute =
    route.status === 'OK'
      ? evaluateRerouteTrigger({
          route,
          offRoute: off_route ?? 'UNKNOWN',
          incidents,
          explicitRequest: input.requestReroute === true,
        })
      : null

  const mobile_contract: MobileNavigationContract = {
    session_id,
    current_location: loc.location,
    destination: input.destination,
    route,
    progress: {
      distance_remaining_meters: route.status === 'OK' ? Math.round(route.distance_meters) : null,
      off_route_state: off_route ?? 'UNKNOWN',
      next_instruction: instructions[0] ?? null,
    },
    eta,
    traffic_state: trafficProviderTruthSummary().live_traffic === 'NOT_IMPLEMENTED' ? 'NOT_IMPLEMENTED' : 'UNAVAILABLE',
    incident_summary: incidents.map(i => `${i.type}:${i.closure_state}`),
    reroute_available: Boolean(reroute?.should_reroute),
    runtime_truth: getNavigationCapabilityTruth(),
    persistent_tracking: false,
  }

  limitations.push('DATA_CORPUS_AGENT does not auto-ingest navigation datasets in Phase 9.')
  limitations.push('TERRA_INTELLIGENCE_AGENT may consume navigation evidence read-only.')

  return finish(status, {
    location: loc.location,
    graph,
    route,
    match,
    instructions,
    eta,
    off_route,
    reroute,
    traffic,
    incidents,
    mobile_contract,
  })
}

export { buildRoadGraph, makeHelsinkiFixtureRoadGraph }
