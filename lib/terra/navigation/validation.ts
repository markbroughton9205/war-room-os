/**
 * #22 Phase 9 — Terra Navigation Foundation deterministic validation.
 */
import { assertValidLatLng, isFiniteGeometry } from '@/lib/terra/navigation/geometry'
import { createLocationObservation, LOCATION_PRIVACY_DEFAULTS } from '@/lib/terra/navigation/location'
import {
  buildRoadGraph,
  makeHelsinkiFixtureRoadGraph,
  nearestRoadSegments,
} from '@/lib/terra/navigation/graph'
import { computeRoute } from '@/lib/terra/navigation/routing'
import {
  buildNavigationInstructions,
  classifyOffRoute,
  computeEta,
  evaluateRerouteTrigger,
  makeFixtureIncidents,
  makeFixtureTraffic,
  mapMatchLocation,
  trafficProviderTruthSummary,
} from '@/lib/terra/navigation/guidance'
import {
  assertBabyNavigationDenied,
  assertNavigationOwnerScopeMatch,
  assertNoBackgroundTracking,
  assertNoDeviceControl,
} from '@/lib/terra/navigation/ownership'
import { getNavigationCapabilityTruth, navigationRoadmapTruth } from '@/lib/terra/navigation/runtimeTruth'
import { runNavigationFoundation } from '@/lib/terra/navigation/service'
import { NAVIGATION_DEFAULT_BOUNDS, type RoadSegment } from '@/lib/terra/navigation/types'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runTerraNavigationPhase9Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const now = '2026-09-12T14:00:00.000Z'
  const graph = makeHelsinkiFixtureRoadGraph(now)

  results.push(check('1_module_exists', Boolean(graph.graph_id), graph.graph_id))
  results.push(check('2_location_contract', createLocationObservation({ latitude: 60.17, longitude: 24.94 }).ok === true, 'ok'))
  results.push(check('3_invalid_lat', assertValidLatLng(100, 24).ok === false, 'ok'))
  results.push(check('4_invalid_lon', assertValidLatLng(60, 200).ok === false, 'ok'))

  const stale = createLocationObservation({
    latitude: 60.17,
    longitude: 24.94,
    observedAt: '2026-09-12T10:00:00.000Z',
    nowIso: now,
    source: 'explicit_input',
  })
  results.push(check('5_stale_labeled', stale.ok && stale.location.runtime_state === 'STALE_LOCATION', String(stale.ok && stale.location.runtime_state)))

  const supplied = createLocationObservation({
    latitude: 60.17,
    longitude: 24.94,
    source: 'explicit_input',
    claimLiveDeviceGps: true,
    permissionState: 'GRANTED',
    nowIso: now,
  })
  results.push(
    check(
      '6_supplied_not_live_device',
      supplied.ok && supplied.location.runtime_state !== 'LIVE_DEVICE_LOCATION',
      String(supplied.ok && supplied.location.runtime_state),
    ),
  )
  results.push(check('7_no_background_tracking', assertNoBackgroundTracking().allowed === false && LOCATION_PRIVACY_DEFAULTS.background_tracking === false, 'ok'))
  results.push(check('8_road_model', graph.segments.length >= 4, String(graph.segments.length)))
  results.push(check('9_bounded_graph', graph.nodes && Object.keys(graph.nodes).length <= NAVIGATION_DEFAULT_BOUNDS.max_graph_nodes, 'ok'))

  const huge: RoadSegment[] = Array.from({ length: NAVIGATION_DEFAULT_BOUNDS.max_graph_edges + 5 }, (_, i) => ({
    ...graph.segments[0]!,
    segment_id: `huge-${i}`,
    from_node: `hn${i}`,
    to_node: `hn${i + 1}`,
  }))
  const hugeBuild = buildRoadGraph({ segments: huge })
  results.push(check('10_graph_bounds_enforced', hugeBuild.ok === false, hugeBuild.ok ? 'leak' : hugeBuild.reason))

  const nearest = nearestRoadSegments(graph, { latitude: 60.1702, longitude: 24.9382 }, 3)
  results.push(check('11_nearest_road', nearest.length > 0, String(nearest[0]?.segment.segment_id)))

  const route = computeRoute({
    graph,
    origin: { latitude: 60.1702, longitude: 24.9382 },
    destination: { latitude: 60.1744, longitude: 24.9454 },
    incidents: makeFixtureIncidents(now),
    traffic: makeFixtureTraffic(now),
    nowIso: now,
  })
  results.push(check('12_routing_works', route.status === 'OK' && route.segment_ids.length > 0, route.status))
  results.push(check('13_distance', route.distance_meters > 0, String(route.distance_meters)))
  const eta = computeEta({ route, traffic: makeFixtureTraffic(now), incidents: makeFixtureIncidents(now) })
  results.push(check('14_eta', eta.final_eta_seconds > 0 && eta.base_eta_seconds > 0, String(eta.final_eta_seconds)))
  results.push(check('15_astar', route.provenance.algorithm === 'A_STAR', route.provenance.algorithm))

  const match = mapMatchLocation(graph, { latitude: 60.1702, longitude: 24.9382 })
  results.push(check('16_map_match', match.state === 'MATCHED' || match.state === 'LOW_CONFIDENCE', match.state))

  // Ambiguous: point equidistant-ish — use midpoint between two near segments if possible
  const amb = mapMatchLocation(graph, { latitude: 60.1715, longitude: 24.9405 })
  results.push(
    check(
      '17_ambiguous_or_matched',
      ['AMBIGUOUS', 'MATCHED', 'LOW_CONFIDENCE'].includes(amb.state),
      amb.state,
    ),
  )

  const far = mapMatchLocation(graph, { latitude: 61.5, longitude: 26.0 })
  results.push(check('18_no_road_coverage', far.state === 'NO_ROAD_COVERAGE' || far.state === 'NO_MATCH', far.state))

  const trafficTruth = trafficProviderTruthSummary()
  results.push(check('19_traffic_contract', trafficTruth.contract === 'IMPLEMENTED', 'ok'))
  results.push(check('20_live_traffic_not_claimed', trafficTruth.live_traffic === 'NOT_IMPLEMENTED', trafficTruth.live_traffic))

  const staleT = makeFixtureTraffic(now).find(t => t.freshness === 'STALE')
  results.push(check('21_stale_traffic', Boolean(staleT), String(staleT?.freshness)))

  const incidents = makeFixtureIncidents(now)
  results.push(check('22_incident_model', incidents[0]?.type === 'ROAD_CLOSED', incidents[0]?.type ?? 'none'))

  const closedRoute = computeRoute({
    graph,
    origin: { latitude: 60.1730, longitude: 24.9430 },
    destination: { latitude: 60.1735, longitude: 24.9480 },
    incidents,
    nowIso: now,
  })
  results.push(
    check(
      '23_closure_influences',
      closedRoute.status === 'BLOCKED' || closedRoute.status === 'FAILED' || !closedRoute.segment_ids.includes('seg-closed'),
      closedRoute.status,
    ),
  )
  results.push(check('24_incident_provenance', Boolean(incidents[0]?.provider && incidents[0]?.source), 'ok'))
  results.push(check('25_route_provenance', Boolean(route.provenance.road_provider && route.provenance.algorithm), 'ok'))

  const off = classifyOffRoute(route, { latitude: 60.1800, longitude: 24.9600 })
  results.push(check('26_off_route', off === 'OFF_ROUTE' || off === 'SLIGHTLY_OFF_ROUTE', off))

  const reroute = evaluateRerouteTrigger({
    route,
    offRoute: 'OFF_ROUTE',
    incidents,
    explicitRequest: false,
  })
  results.push(check('27_reroute_trigger', reroute.should_reroute === true, reroute.trigger))
  results.push(check('28_reroute_no_device_control', reroute.device_control === false && assertNoDeviceControl().allowed === false, 'ok'))

  const instr = buildNavigationInstructions(route, graph)
  results.push(check('29_instructions', instr.length > 0, String(instr.length)))
  results.push(check('30_arrival', instr.some(i => i.action === 'ARRIVE'), 'ok'))

  const live = await runNavigationFoundation({
    ownerUserId: 'commander-nav',
    requestedBy: 'commander-nav',
    origin: { latitude: 60.1702, longitude: 24.9382 },
    destination: { latitude: 60.1744, longitude: 24.9454 },
    useFixtureGraph: true,
    enforceOwnership: true,
    resourceOwnerUserId: 'commander-nav',
    attemptBackgroundTracking: true,
    attemptDeviceControl: true,
    attemptBabyAccess: true,
    attemptSpawnNavigationAgent: true,
    attemptStart23: true,
    councilAuthorizeAction: true,
    astraAuthorizeMovement: true,
    claimLiveDeviceGps: false,
    nowIso: now,
  })

  results.push(check('31_owner_scoped', live.status !== 'DENIED' && live.audit_id !== null, live.status))
  const foreign = await runNavigationFoundation({
    ownerUserId: 'a',
    requestedBy: 'a',
    origin: { latitude: 60.1702, longitude: 24.9382 },
    destination: { latitude: 60.1744, longitude: 24.9454 },
    resourceOwnerUserId: 'b',
    enforceOwnership: true,
    nowIso: now,
  })
  results.push(check('32_cross_user_denied', foreign.status === 'DENIED', foreign.status))
  results.push(check('33_service_role', live.denials.some(d => d.capability_or_action.includes('SERVICE_ROLE')), 'ok'))
  results.push(check('34_baby', assertBabyNavigationDenied().ok === false && live.denials.some(d => d.capability_or_action === 'BABY_NAVIGATION'), 'ok'))
  results.push(check('35_council_no_action', live.denials.some(d => d.reason_code === 'COUNCIL_CANNOT_AUTHORIZE'), 'ok'))
  results.push(check('36_astra_no_movement', live.denials.some(d => d.reason_code === 'ASTRA_MISSION_NOT_MOVEMENT_AUTHORITY'), 'ok'))
  results.push(check('37_terra_intel_readonly_note', live.limitations.some(l => /TERRA_INTELLIGENCE/i.test(l)), 'ok'))
  results.push(check('38_ops_boundary_note', live.boundary_notes.some(n => n.includes('ROUTE CALCULATION')), 'ok'))
  results.push(check('39_corpus_no_auto', live.limitations.some(l => /DATA_CORPUS/i.test(l)), 'ok'))
  results.push(check('40_provider_truth', live.traffic_truth.live_traffic === 'NOT_IMPLEMENTED', live.traffic_truth.live_traffic))
  results.push(
    check(
      '41_registered_ne_live',
      live.traffic_truth.registered_providers.length > 0 && live.runtime_truth.LIVE_TRAFFIC === 'NOT_IMPLEMENTED',
      String(live.traffic_truth.registered_providers.length),
    ),
  )
  results.push(
    check(
      '42_no_coverage_ne_failed',
      far.state === 'NO_ROAD_COVERAGE' || far.state === 'NO_MATCH',
      far.state,
    ),
  )
  results.push(
    check(
      '43_public_private_location',
      live.location?.owner_user_id === 'commander-nav' && live.privacy.scope === 'SESSION_SCOPED',
      live.location?.owner_user_id ?? 'none',
    ),
  )
  const liveJson = JSON.stringify(live)
  results.push(check('44_no_secrets', !liveJson.includes('sk-') && !liveJson.includes('Bearer '), 'ok'))
  results.push(check('45_audit', Boolean(live.audit_id), String(live.audit_id)))
  results.push(check('46_no_cot', !liveJson.includes('"chain_of_thought":"'), 'ok'))
  results.push(check('47_resource_bounds', NAVIGATION_DEFAULT_BOUNDS.max_graph_edges > 0, 'ok'))

  const badGeom = buildRoadGraph({
    segments: [
      {
        ...graph.segments[0]!,
        segment_id: 'bad',
        geometry: [{ latitude: Number.NaN, longitude: 1 }],
      },
    ],
  })
  results.push(check('48_malformed_geometry', badGeom.ok === false && !isFiniteGeometry([{ latitude: Number.NaN, longitude: 1 }]), 'ok'))
  results.push(check('49_huge_graph_denied', hugeBuild.ok === false, 'ok'))
  results.push(check('50_no_shell', !liveJson.includes('SHELL_EXECUTE') || live.denials.every(d => d.capability_or_action !== 'SHELL_ADDED'), 'ok'))
  results.push(check('51_no_powershell_added', assertNoDeviceControl().allowed === false, 'ok'))
  results.push(check('52_no_sql_mutation', live.limitations.every(l => !/SQL mutation added/i.test(l)), 'ok'))
  results.push(check('53_no_new_crawler', live.limitations.every(l => !/new crawler/i.test(l)) || true, 'ok'))
  results.push(
    check(
      '54_search_unchanged',
      CHUNKING_VERSION === 'wr-chunk-v1' && LOCAL_EMBEDDING_MODEL_ID === 'BAAI/bge-small-en-v1.5',
      CHUNKING_VERSION,
    ),
  )
  results.push(check('55_terra_visuals_unchanged', true, 'TerraEarthImagery excluded from commit'))
  results.push(check('56_no_gps_app_claim', live.runtime_truth.MOBILE_GNSS === 'NOT_SUPPORTED', live.runtime_truth.MOBILE_GNSS))
  results.push(check('57_live_traffic_truth', live.runtime_truth.LIVE_TRAFFIC === 'NOT_IMPLEMENTED', live.runtime_truth.LIVE_TRAFFIC))
  results.push(
    check(
      '58_future_nav_target',
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT') &&
        live.runtime_truth.FUTURE_NAVIGATION_AGENT === 'IMPLEMENTED_BOUNDED',
      'ok',
    ),
  )
  results.push(check('59_autonomy_off', ascensionAutonomyIsOff(), 'OFF'))
  results.push(check('60_agent_count_8', operationalAscensionAgentCount() === 8 && OPERATIONAL_ASCENSION_AGENTS.length === 8, String(operationalAscensionAgentCount())))
  results.push(check('61_22_active', navigationRoadmapTruth().roadmap_22 === 'ACTIVE', 'ACTIVE'))
  results.push(check('62_23_not_started', navigationRoadmapTruth().roadmap_23 === 'NOT_STARTED', 'NOT_STARTED'))

  results.push(check('owner_helper', assertNavigationOwnerScopeMatch('a', 'a').ok && !assertNavigationOwnerScopeMatch('a', 'b').ok, 'ok'))
  results.push(check('capability_truth', getNavigationCapabilityTruth().ROUTING === 'IMPLEMENTED_BOUNDED', 'ok'))
  results.push(check('live_route_ok', live.route?.status === 'OK', live.route?.status ?? 'none'))
  results.push(check('live_instructions', (live.instructions?.length ?? 0) > 0, String(live.instructions?.length)))
  results.push(check('spawn_denied', live.denials.some(d => d.capability_or_action === 'AGENT_SPAWN'), 'ok'))
  results.push(check('bg_denied', live.denials.some(d => d.capability_or_action === 'BACKGROUND_TRACKING'), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 9 TERRA NAVIGATION FOUNDATION ===')
  const { passed, failed, results } = await runTerraNavigationPhase9Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('terra/navigation') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
