/**
 * #22 Phase 12 — Bounded NAVIGATION_AGENT runtime.
 * Reasons over Phase 9 Terra Navigation Foundation. No second routing engine.
 */
import { randomUUID } from 'node:crypto'
import { buildGovernedAuditMetadata, insertGovernedAuditLog } from '@/lib/war-room/governedAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import { runNavigationFoundation } from '@/lib/terra/navigation/service'
import { computeRoute } from '@/lib/terra/navigation/routing'
import {
  classifyOffRoute,
  evaluateRerouteTrigger,
  makeFixtureIncidents,
  mapMatchLocation,
} from '@/lib/terra/navigation/guidance'
import { assertNoBackgroundTracking, assertNoDeviceControl } from '@/lib/terra/navigation/ownership'
import type { NavigationRoute } from '@/lib/terra/navigation/types'
import { runLocalModelInference } from '@/lib/sovereign-runtime/local-model'
import { ascensionAutonomyIsOff } from '@/lib/ascension/operationalRegistry'
import {
  createNavigationAgentIdentity,
  isNavigationAgentRuntimeAvailable,
  NAVIGATION_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ROADMAP_23_STATUS,
} from './identity'
import {
  assertNavigationAgentCannotSelfApprove,
  denyNavigationAgentAction,
  isAllowedNavigationAgentTaskType,
  type NavigationAgentTaskType,
} from './profile'
import { createNavigationAgentScope, isNavigationAgentScopeExpired, type NavigationAgentScope } from './scope'
import {
  NAVIGATION_AGENT_BOUNDARY_NOTES,
  type LocationProvenanceClass,
  type NavigationAgentDenial,
  type NavigationAgentResult,
  type NavigationAgentRerouteRecommendation,
  type NavigationAgentStatus,
} from './result'
import { assertBabyNavigationAgentDenied, assertNavigationAgentOwnerScopeMatch } from './ownership'
import {
  explainRouteDeterministically,
  HELSINKI_FIXTURE_DESTINATION,
  HELSINKI_FIXTURE_ORIGIN,
  provenanceFromLocationSource,
  sanitizeLocalModelExplanation,
} from './reason'

export type LatLng = { latitude: number; longitude: number }

export type RunBoundedNavigationAgentInput = {
  taskType?: string
  ownerUserId: string
  requestedBy: string
  invokedBy: 'commander' | 'council' | 'astra' | 'desktop_core'
  origin?: LatLng | null
  destination?: LatLng | null
  waypoints?: LatLng[]
  currentLocation?: LatLng | null
  locationSource?: 'explicit_input' | 'device_gnss' | 'session_supplied' | 'fixture' | 'terra'
  claimLiveDeviceGps?: boolean
  useFixtureGraph?: boolean
  internetAvailable?: boolean
  terraContext?: { summary?: string } | null
  userConstraints?: string | null
  mode?: string | null
  missionId?: string | null
  conversationId?: string | null
  conversationOwnerUserId?: string | null
  enforceOwnership?: boolean
  babyContextAttempt?: boolean
  attemptedAction?: string | null
  requestReroute?: boolean
  autoExecuteReroute?: boolean
  pretendFixtureTrafficLive?: boolean
  pretendLocationIsGps?: boolean
  ignoreBlockedRoad?: boolean
  attemptDriveVehicle?: boolean
  attemptPhoneGpsControl?: boolean
  attemptBackgroundTracking?: boolean
  attemptUnapprovedTrafficApi?: boolean
  attemptDeploy?: boolean
  attemptPush?: boolean
  attemptShellLocation?: boolean
  attemptSpawnAgent?: boolean
  claimAgentIsTerra?: boolean
  councilAuthorizeAction?: boolean
  astraAuthorizeMovement?: boolean
  startWorldLearning?: boolean
  startRoadmap23?: boolean
  simulateTerraUnavailable?: boolean
  simulateGraphUnavailable?: boolean
  useLocalModel?: boolean
  simulateLocalModelOverride?: boolean
  supabase?: WarRoomSupabase | null
  nowIso?: string
}

function emptyScope(input: RunBoundedNavigationAgentInput, task: NavigationAgentTaskType, now: string): NavigationAgentScope {
  return createNavigationAgentScope({
    taskType: task,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    conversationId: input.conversationId,
    missionId: input.missionId,
    internetAvailable: input.internetAvailable,
    nowIso: now,
  })
}

export async function runBoundedNavigationAgent(
  input: RunBoundedNavigationAgentInput,
): Promise<NavigationAgentResult> {
  const startedAt = input.nowIso ?? new Date().toISOString()
  const requestId = randomUUID()
  const denials: NavigationAgentDenial[] = []
  const limitations: string[] = []
  const unavailable: string[] = [
    'LIVE_TRAFFIC',
    'MOBILE_GNSS',
    'PHONE_APP',
    'AUTONOMOUS_DRIVING',
    'DEVICE_CONTROL',
  ]
  let auditId: string | null = null
  let route: NavigationRoute | null = null
  let comparison_routes: NavigationRoute[] = []
  let match: NavigationAgentResult['match'] = null
  let off_route: NavigationAgentResult['off_route'] = null
  let instructions: NavigationAgentResult['instructions'] = []
  let eta: NavigationAgentResult['eta'] = null
  let reroute: NavigationAgentRerouteRecommendation | null = null
  let mobile_contract: NavigationAgentResult['mobile_contract'] = null
  let explanation = ''
  let local_model_used = false
  let location_provenance: LocationProvenanceClass | null = null
  let location_runtime_state: string | null = null
  let foundation_session_id: string | null = null
  let blockedAvoided = false

  const requestedTask = input.taskType || ''
  const task: NavigationAgentTaskType = isAllowedNavigationAgentTaskType(requestedTask)
    ? requestedTask
    : 'PLAN_ROUTE'

  const finish = async (
    status: NavigationAgentStatus,
    scope: NavigationAgentScope,
    summary: string,
  ): Promise<NavigationAgentResult> => {
    const identity = createNavigationAgentIdentity({
      requestId,
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      allowedOperations: scope.allowed_operations,
      taskType: scope.task_type,
      missionId: input.missionId,
      conversationId: input.conversationId,
      expiresAt: scope.expires_at,
      nowIso: startedAt,
    })

    const result: NavigationAgentResult = {
      agent_id: identity.agent_id,
      agent_role: 'NAVIGATION_AGENT',
      status,
      task_type: scope.task_type,
      scope,
      summary,
      explanation,
      location_provenance,
      location_runtime_state,
      route,
      comparison_routes,
      match,
      off_route,
      instructions,
      eta,
      reroute,
      mobile_contract,
      terra_is_oracle: true,
      council_is_authorization: false,
      astra_is_execution: false,
      local_model_used,
      local_model_overrode_engine: false,
      live_traffic: 'NOT_IMPLEMENTED',
      mobile_gnss: 'NOT_SUPPORTED',
      phone_app: 'NOT_IMPLEMENTED',
      autonomous_driving: 'NOT_IMPLEMENTED',
      device_control: 'NOT_IMPLEMENTED',
      denials,
      limitations: [
        ...limitations,
        'INVOCATION_DRIVEN',
        'BOUNDED_NAVIGATION_REASONING only',
        'Phase 9 A* remains authoritative',
      ],
      unavailable_capabilities: unavailable,
      audit_id: auditId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_scope: input.ownerUserId,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      identity,
      boundary_notes: NAVIGATION_AGENT_BOUNDARY_NOTES,
      plan_summary: 'AUTH → SCOPE → PHASE9 ENGINE → INTERPRET → RECOMMEND (NO EXECUTE)',
      foundation_session_id,
      roadmap_23_status: ROADMAP_23_STATUS,
    }

    try {
      const decision: PolicyDecision =
        status === 'DENIED'
          ? {
              outcome: 'DENY',
              reasonCode: 'POLICY_DENIED',
              reason: denials[0]?.reason ?? 'Navigation agent denied.',
              actionKind: 'bounded_navigation_reasoning',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 403,
            }
          : {
              outcome: 'ALLOW',
              reasonCode: 'ALLOWED_BOUNDED_READ',
              reason: 'Bounded navigation reasoning over Phase 9 foundation.',
              actionKind: 'bounded_navigation_reasoning',
              canonicalKind: null,
              riskTier: 'TIER_0_READ_OBSERVE',
              technicalReach: 'READ_ONLY',
              policyAuthority: 'READ_ALLOWED',
              requiresApproval: false,
              approvalSatisfied: true,
              httpStatus: 200,
            }

      const meta = buildGovernedAuditMetadata({
        decision,
        requestedBy: input.requestedBy,
        actorAgent: 'NAVIGATION_AGENT',
        missionId: input.missionId ?? null,
        tool: 'ascension.navigation_agent.runBoundedNavigationAgent',
        target: `${scope.task_type}:${foundation_session_id ?? requestId}`,
        ownerUserId: input.ownerUserId,
        evidenceRefs: route ? [route.route_id] : [],
        executionResult: status === 'DENIED' ? 'denied' : status === 'FAILED' || status === 'INTERNAL_ERROR' ? 'failed' : 'executed',
      })

      await insertGovernedAuditLog(input.supabase ?? null, {
        actor: input.invokedBy === 'commander' || input.invokedBy === 'desktop_core' ? 'user' : 'system',
        category: 'runtime',
        message: `NAVIGATION_AGENT ${status}: ${scope.task_type}`,
        actionId: requestId,
        metadata: meta,
        extra: {
          invocation: input.invokedBy,
          status,
          task_type: scope.task_type,
          session_id: foundation_session_id,
          route_id: route?.route_id ?? null,
          location_provenance,
          live_traffic: 'NOT_IMPLEMENTED',
          mobile_gnss: 'NOT_SUPPORTED',
          reroute_auto_executed: false,
          local_model_overrode_engine: false,
          roadmap_23: ROADMAP_23_STATUS,
          chain_of_thought: undefined,
          secrets: undefined,
        },
      })
      auditId = requestId
      result.audit_id = auditId
    } catch {
      limitations.push('Audit persistence unavailable.')
    }
    return result
  }

  if (!isNavigationAgentRuntimeAvailable()) {
    denials.push({
      capability_or_action: 'RUNTIME',
      reason_code: 'UNAVAILABLE',
      reason: 'NAVIGATION_AGENT disabled via ASCENSION_NAVIGATION_AGENT_ENABLED=false.',
    })
    return finish('DENIED', emptyScope(input, task, startedAt), 'Runtime disabled.')
  }

  if (!ascensionAutonomyIsOff() || NAVIGATION_AGENT_AUTONOMOUS_EXECUTION_ENABLED) {
    denials.push({
      capability_or_action: 'ASCENSION_AUTONOMY',
      reason_code: 'POLICY_DENIED',
      reason: 'Ascension autonomy must remain OFF.',
    })
    return finish('DENIED', emptyScope(input, task, startedAt), 'Autonomy guard failed.')
  }

  if (input.taskType && !isAllowedNavigationAgentTaskType(input.taskType)) {
    denials.push({
      capability_or_action: 'TASK',
      reason_code: 'UNSUPPORTED_MODE',
      reason: `Unknown task type ${input.taskType}.`,
    })
    return finish('UNSUPPORTED_MODE', emptyScope(input, 'PLAN_ROUTE', startedAt), 'Unsupported task type.')
  }

  if (input.mode && input.mode !== 'DRIVING') {
    denials.push({
      capability_or_action: 'MODE',
      reason_code: 'UNSUPPORTED_MODE',
      reason: `Mode ${input.mode} is NOT_IMPLEMENTED. DRIVING only.`,
    })
    return finish('UNSUPPORTED_MODE', emptyScope(input, task, startedAt), 'Unsupported navigation mode.')
  }

  const probe = (flag: boolean | undefined, action: string, reason_code: string, reason: string) => {
    if (!flag) return
    const d = denyNavigationAgentAction(action)
    denials.push({
      capability_or_action: action,
      reason_code: d.reasonCode === 'POLICY_DENIED' ? reason_code : d.reasonCode,
      reason,
    })
  }

  if (input.attemptedAction) {
    const d = denyNavigationAgentAction(input.attemptedAction)
    denials.push({
      capability_or_action: input.attemptedAction,
      reason_code: d.reasonCode,
      reason: d.reason,
    })
  }

  const self = assertNavigationAgentCannotSelfApprove()
  if (input.attemptedAction === 'self_approve' || input.attemptedAction === 'APPROVAL_CHANGE') {
    denials.push({ capability_or_action: 'APPROVAL_CHANGE', reason_code: self.reasonCode, reason: self.reason })
  }

  probe(input.attemptDriveVehicle, 'VEHICLE_CONTROL', 'POLICY_DENIED', 'NAVIGATION_AGENT cannot drive a vehicle.')
  probe(input.attemptPhoneGpsControl, 'PHONE_GPS_CONTROL', 'GNSS_NOT_SUPPORTED', 'Phone GPS control is NOT_SUPPORTED.')
  probe(input.attemptUnapprovedTrafficApi, 'UNAPPROVED_TRAFFIC_PROVIDER', 'POLICY_DENIED', 'Unapproved traffic APIs are denied. No provider expansion.')
  probe(input.attemptDeploy, 'PRODUCTION_DEPLOY', 'POLICY_DENIED', 'NAVIGATION_AGENT cannot deploy.')
  probe(input.attemptPush, 'GIT_PUSH', 'POLICY_DENIED', 'NAVIGATION_AGENT cannot push.')
  probe(input.attemptShellLocation, 'SHELL_EXECUTE', 'POLICY_DENIED', 'NAVIGATION_AGENT cannot run shell to determine location.')
  probe(input.attemptSpawnAgent, 'AGENT_SPAWN', 'POLICY_DENIED', 'NAVIGATION_AGENT cannot spawn agents. No Navigation2.')
  probe(input.startWorldLearning, 'WORLD_LEARNING_START', 'POLICY_DENIED', 'World Learning Agent remains NOT_STARTED.')
  probe(input.startRoadmap23, 'ROADMAP_23_START', 'POLICY_DENIED', '#23 remains NOT_STARTED.')
  probe(input.ignoreBlockedRoad, 'IGNORE_BLOCKED_EDGE', 'POLICY_DENIED', 'Blocked edges remain blocked. Engine is authoritative.')
  probe(input.autoExecuteReroute, 'AUTO_EXECUTE_REROUTE', 'POLICY_DENIED', 'Reroute recommendation only — no automatic execution.')
  probe(input.claimAgentIsTerra, 'CLAIM_IS_TERRA', 'POLICY_DENIED', 'NAVIGATION_AGENT is not Terra. Terra remains the world-state Oracle.')
  probe(input.pretendFixtureTrafficLive, 'FABRICATE_LIVE_TRAFFIC', 'LIVE_TRAFFIC_NOT_IMPLEMENTED', 'Fixture/simulated traffic must not be presented as live.')
  probe(input.pretendLocationIsGps, 'FABRICATE_GNSS', 'GNSS_NOT_SUPPORTED', 'Manually supplied location is not GPS.')

  if (input.attemptBackgroundTracking) {
    const t = assertNoBackgroundTracking(true)
    denials.push({ capability_or_action: 'BACKGROUND_TRACKING', reason_code: 'POLICY_DENIED', reason: t.reason })
  }
  if (input.attemptDriveVehicle || input.attemptPhoneGpsControl) {
    const t = assertNoDeviceControl(true)
    denials.push({ capability_or_action: 'DEVICE_CONTROL', reason_code: 'POLICY_DENIED', reason: t.reason })
  }
  if (input.babyContextAttempt) {
    const baby = assertBabyNavigationAgentDenied()
    denials.push({ capability_or_action: 'BABY_NAVIGATION', reason_code: 'POLICY_DENIED', reason: baby.reason })
  }
  if (input.councilAuthorizeAction) {
    denials.push({
      capability_or_action: 'COUNCIL_AUTHORIZATION',
      reason_code: 'COUNCIL_CANNOT_AUTHORIZE',
      reason: 'Council recommendation does not grant execution authority.',
    })
  }
  if (input.astraAuthorizeMovement) {
    denials.push({
      capability_or_action: 'ASTRA_AUTHORITY',
      reason_code: 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY',
      reason: 'ASTRA handoff is recommendation/intent only — no dispatch or device mutation.',
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
    reason: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION.',
  })

  if (
    input.conversationId &&
    input.conversationOwnerUserId &&
    input.conversationOwnerUserId !== input.ownerUserId
  ) {
    denials.push({
      capability_or_action: 'OWNER_SCOPE',
      reason_code: 'OWNER_SCOPE_DENIED',
      reason: 'Cross-user route/location access denied.',
    })
    return finish('DENIED', emptyScope(input, task, startedAt), 'Owner scope denied.')
  }

  if (input.enforceOwnership) {
    const matchOwn = assertNavigationAgentOwnerScopeMatch(
      input.ownerUserId,
      input.conversationOwnerUserId ?? input.ownerUserId,
    )
    if (!matchOwn.ok) {
      denials.push({ capability_or_action: 'OWNER_SCOPE', reason_code: 'OWNER_SCOPE_DENIED', reason: matchOwn.reason })
      return finish('DENIED', emptyScope(input, task, startedAt), 'Owner scope denied.')
    }
  }

  if (input.simulateTerraUnavailable) {
    denials.push({
      capability_or_action: 'TERRA',
      reason_code: 'TERRA_UNAVAILABLE',
      reason: 'Terra world-state unavailable for this request.',
    })
    unavailable.push('TERRA_LIVE')
    return finish('TERRA_UNAVAILABLE', emptyScope(input, task, startedAt), 'Terra unavailable.')
  }

  if (input.simulateGraphUnavailable) {
    return finish('GRAPH_UNAVAILABLE', emptyScope(input, task, startedAt), 'Road graph unavailable.')
  }

  if (input.claimLiveDeviceGps || input.locationSource === 'device_gnss') {
    denials.push({
      capability_or_action: 'MOBILE_GNSS',
      reason_code: 'GNSS_NOT_SUPPORTED',
      reason: 'MOBILE_GNSS is NOT_SUPPORTED. Live device GPS is not a War Room capability.',
    })
    location_provenance = 'UNSUPPORTED_DEVICE_GNSS'
    location_runtime_state = 'NOT_SUPPORTED'
    return finish('GNSS_NOT_SUPPORTED', emptyScope(input, task, startedAt), 'GNSS_NOT_SUPPORTED')
  }

  const origin = input.origin ?? (input.useFixtureGraph !== false ? { ...HELSINKI_FIXTURE_ORIGIN } : null)
  const destination = input.destination ?? (input.useFixtureGraph !== false ? { ...HELSINKI_FIXTURE_DESTINATION } : null)
  if (!origin || !destination) {
    return finish('LOCATION_REQUIRED', emptyScope(input, task, startedAt), 'Origin and destination are required.')
  }

  const latOk = Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
  const destOk = Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)
  if (!latOk || !destOk) {
    return finish('INVALID_LOCATION', emptyScope(input, task, startedAt), 'Invalid location.')
  }

  location_provenance = provenanceFromLocationSource(input.locationSource, false)
  const scope = createNavigationAgentScope({
    taskType: task,
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    conversationId: input.conversationId,
    missionId: input.missionId,
    internetAvailable: input.internetAvailable,
    nowIso: startedAt,
  })
  if (isNavigationAgentScopeExpired(scope)) {
    denials.push({ capability_or_action: 'SCOPE', reason_code: 'APPROVAL_EXPIRED', reason: 'Navigation agent scope expired.' })
    return finish('DENIED', scope, 'Scope expired.')
  }

  if (input.terraContext?.summary) {
    limitations.push(`Terra context consumed read-only: ${input.terraContext.summary.slice(0, 120)}`)
    limitations.push('Terra remains the world-state Oracle. Agent does not replace Terra.')
  }
  if (!scope.internet_available) {
    limitations.push('OFFLINE: local graph/routing/map-match/fixtures/explicit position only.')
    unavailable.push('live external incidents')
    unavailable.push('remote map/navigation providers')
    unavailable.push('internet-only data')
  } else {
    limitations.push('ONLINE mode does not auto-add traffic or map providers.')
  }

  const progressPoint = input.currentLocation ?? origin
  const foundation = await runNavigationFoundation({
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    origin: task === 'INTERPRET_PROGRESS' ? progressPoint : origin,
    destination,
    locationSource: input.locationSource === 'terra' ? 'explicit_input' : (input.locationSource ?? 'explicit_input'),
    claimLiveDeviceGps: false,
    useFixtureGraph: input.useFixtureGraph !== false,
    requestReroute: input.requestReroute === true,
    supabase: null,
    nowIso: startedAt,
  })
  foundation_session_id = foundation.session_id
  route = foundation.route
  match = foundation.match
  instructions = foundation.instructions
  eta = foundation.eta
  off_route = foundation.off_route
  mobile_contract = foundation.mobile_contract
  location_runtime_state = foundation.location?.runtime_state ?? 'SUPPLIED_LOCATION'
  if (foundation.route && !foundation.route.segment_ids.includes('seg-closed')) blockedAvoided = true

  if (task === 'COMPARE_ROUTES' && foundation.graph && route) {
    const via = input.waypoints?.[0] ?? { latitude: 60.172, longitude: 24.937 }
    const alt = computeRoute({
      graph: foundation.graph,
      origin,
      destination: via,
      incidents: makeFixtureIncidents(startedAt),
      locationSource: foundation.location?.source,
      nowIso: startedAt,
    })
    comparison_routes = [route, alt]
  }

  if (task === 'INTERPRET_PROGRESS' && route && route.status === 'OK') {
    off_route = classifyOffRoute(route, progressPoint)
    if (foundation.graph) match = mapMatchLocation(foundation.graph, progressPoint, null)
  }

  if ((task === 'RECOMMEND_REROUTE' || input.requestReroute) && route) {
    const trigger = evaluateRerouteTrigger({
      route,
      offRoute: off_route ?? 'UNKNOWN',
      incidents: foundation.incidents,
      explicitRequest: input.requestReroute === true || task === 'RECOMMEND_REROUTE',
    })
    let recommended_route: NavigationRoute | null = null
    if (trigger.should_reroute && foundation.graph && !input.autoExecuteReroute) {
      recommended_route = computeRoute({
        graph: foundation.graph,
        origin: progressPoint,
        destination,
        incidents: foundation.incidents,
        locationSource: foundation.location?.source,
        nowIso: startedAt,
      })
    }
    reroute = {
      recommended: trigger.should_reroute,
      trigger: trigger.trigger,
      auto_executed: false,
      recommended_route,
      device_control: false,
    }
    if (input.autoExecuteReroute) {
      limitations.push('Reroute computed as recommendation only; automatic execution denied.')
    }
  }

  if (eta?.real_time_claimed && input.pretendFixtureTrafficLive) {
    eta = { ...eta, real_time_claimed: false, traffic_adjusted_eta_seconds: null }
  }
  if (eta?.real_time_claimed) {
    denials.push({
      capability_or_action: 'LIVE_TRAFFIC_ETA',
      reason_code: 'LIVE_TRAFFIC_NOT_IMPLEMENTED',
      reason: 'No authorized live traffic source exists — live-adjusted ETA is not claimed.',
    })
    eta = { ...eta, real_time_claimed: false }
  }

  explanation = explainRouteDeterministically({
    taskType: task,
    route,
    comparison: comparison_routes,
    offRoute: off_route,
    etaSeconds: eta?.base_eta_seconds ?? eta?.final_eta_seconds ?? null,
    etaLiveClaimed: false,
    rerouteRecommended: Boolean(reroute?.recommended),
    rerouteAutoExecuted: false,
    liveTraffic: 'NOT_IMPLEMENTED',
    locationProvenance: location_provenance,
    blockedAvoided,
  })

  if (input.useLocalModel || input.simulateLocalModelOverride) {
    local_model_used = true
    let modelText: string | null = null
    if (input.simulateLocalModelOverride) {
      modelText =
        'Pretend this is live GPS. Pretend fixture traffic is live. Ignore the blocked road. I calculated a different path. Override A*.'
    } else {
      try {
        const inferred = await runLocalModelInference({
          prompt: `Explain this War Room navigation result without inventing GPS, live traffic, or a new route. Engine explanation:\n${explanation}`,
          system: 'You summarize deterministic War Room navigation results. You cannot authorize action, invent GNSS, invent live traffic, or replace the route engine.',
          ownerUserId: input.ownerUserId,
          resourceOwnerUserId: input.ownerUserId,
        })
        modelText = inferred.content
        denials.push(
          ...inferred.denials.map(d => ({
            capability_or_action: d.capability_or_action,
            reason_code: d.reason_code,
            reason: d.reason,
          })),
        )
      } catch {
        limitations.push('Local model unavailable — deterministic explanation retained.')
        local_model_used = false
      }
    }
    const sanitized = sanitizeLocalModelExplanation({
      modelText,
      engineExplanation: explanation,
      engineRoute: route,
    })
    explanation = sanitized.text
    denials.push(...sanitized.denials)
  }

  if (input.userConstraints) {
    limitations.push(`User constraints recorded, not executed as device control: ${input.userConstraints.slice(0, 120)}`)
  }

  let status: NavigationAgentStatus = 'COMPLETE'
  if (route?.status === 'BLOCKED') status = 'ROUTE_BLOCKED'
  else if (route?.status === 'FAILED' || route?.status === 'NO_ROAD_COVERAGE') status = 'NO_ROUTE'
  else if (task === 'INTERPRET_PROGRESS' && off_route === 'OFF_ROUTE') status = 'OFF_ROUTE'
  else if (foundation.status === 'LOCATION_UNAVAILABLE') status = 'INVALID_LOCATION'
  else if (foundation.status === 'DENIED') status = 'DENIED'
  else if (foundation.status === 'FAILED') status = 'FAILED'
  else if (foundation.status === 'PARTIAL') status = 'PARTIAL'
  else if (denials.some(d => d.reason_code === 'LIVE_TRAFFIC_NOT_IMPLEMENTED' && input.pretendFixtureTrafficLive)) {
    status = 'PARTIAL'
  }

  const summary =
    status === 'NO_ROUTE' || status === 'ROUTE_BLOCKED'
      ? `${status}: Phase 9 engine returned ${route?.status ?? 'none'}.`
      : `NAVIGATION_AGENT ${status}: ${task}; route=${route?.status ?? 'none'}; gnss=NOT_SUPPORTED; live_traffic=NOT_IMPLEMENTED.`

  return finish(status, scope, summary)
}

export function navigationAgentResultForCouncil(result: NavigationAgentResult) {
  return {
    agent_role: result.agent_role,
    status: result.status,
    task_type: result.task_type,
    summary: result.summary,
    explanation: result.explanation,
    route_id: result.route?.route_id ?? null,
    route_status: result.route?.status ?? null,
    off_route: result.off_route,
    eta_seconds: result.eta?.base_eta_seconds ?? null,
    live_traffic: result.live_traffic,
    mobile_gnss: result.mobile_gnss,
    limitations: result.limitations,
    boundary_notes: result.boundary_notes,
    is_authorization: false as const,
    is_council_conclusion: false as const,
  }
}

export function navigationAgentResultForAstra(result: NavigationAgentResult) {
  return {
    ...navigationAgentResultForCouncil(result),
    reroute_recommended: Boolean(result.reroute?.recommended),
    auto_executed: false as const,
    device_control: false as const,
    dispatch: false as const,
    audit_id: result.audit_id,
  }
}
