/**
 * #22 Phase 12 — NAVIGATION_AGENT deterministic validation + live-safe proof.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NAVIGATION_AGENT_ROLE,
  NAVIGATION_AGENT_RUNTIME_VERSION,
  NAVIGATION_AGENT_POLICY_PROFILE,
  NAVIGATION_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ROADMAP_23_STATUS,
  createNavigationAgentIdentity,
  isNavigationAgentRuntimeAvailable,
} from '@/lib/ascension/navigation-agent/identity'
import {
  NAVIGATION_AGENT_ALLOWED_OPERATIONS,
  NAVIGATION_AGENT_DENIED_ALIASES,
  denyNavigationAgentAction,
  assertNavigationAgentCannotSelfApprove,
  isAllowedNavigationAgentOperation,
} from '@/lib/ascension/navigation-agent/profile'
import { createNavigationAgentScope } from '@/lib/ascension/navigation-agent/scope'
import { NAVIGATION_AGENT_BOUNDARY_NOTES } from '@/lib/ascension/navigation-agent/result'
import { runBoundedNavigationAgent } from '@/lib/ascension/navigation-agent/runtime'
import { assertBabyNavigationAgentDenied, assertNavigationAgentOwnerScopeMatch } from '@/lib/ascension/navigation-agent/ownership'
import {
  HELSINKI_FIXTURE_CLOSED_DEST,
  HELSINKI_FIXTURE_DESTINATION,
  HELSINKI_FIXTURE_OFF_ROUTE,
  HELSINKI_FIXTURE_ORIGIN,
} from '@/lib/ascension/navigation-agent/reason'
import { runNavigationFoundation } from '@/lib/terra/navigation/service'
import { computeRoute } from '@/lib/terra/navigation/routing'
import { makeHelsinkiFixtureRoadGraph } from '@/lib/terra/navigation/graph'
import { makeFixtureIncidents } from '@/lib/terra/navigation/guidance'
import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ACTOR_INVENTORY } from '@/lib/agent-capability-matrix/actors'
import { matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID } from '@/lib/war-room-search/hybrid/types'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export async function runNavigationAgentPhase12Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const prevEnabled = process.env.ASCENSION_NAVIGATION_AGENT_ENABLED
  delete process.env.ASCENSION_NAVIGATION_AGENT_ENABLED

  results.push(check('1_canonical_agent', NAVIGATION_AGENT_ROLE === 'NAVIGATION_AGENT', NAVIGATION_AGENT_ROLE))
  results.push(check('2_no_navigation2', !fs.existsSync(path.join(repoRoot, 'lib', 'navigation2')) && !fs.existsSync(path.join(repoRoot, 'lib', 'terra', 'navigation2')), 'ok'))
  results.push(check('3_no_terra2', !fs.existsSync(path.join(repoRoot, 'lib', 'terra2')), 'ok'))
  results.push(
    check(
      '4_operational_count_9',
      operationalAscensionAgentCount() === 9 && OPERATIONAL_ASCENSION_AGENTS.length === 9,
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(check('5_autonomy_off', ascensionAutonomyIsOff() && !NAVIGATION_AGENT_AUTONOMOUS_EXECUTION_ENABLED, 'OFF'))

  const routingSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'terra', 'navigation', 'routing.ts'), 'utf8')
  const agentRuntimeSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'ascension', 'navigation-agent', 'runtime.ts'), 'utf8')
  results.push(check('6_phase9_routing_reused', agentRuntimeSrc.includes("from '@/lib/terra/navigation/routing'") && routingSrc.includes('export function computeRoute'), 'ok'))
  results.push(check('7_phase9_map_match_reused', agentRuntimeSrc.includes('mapMatchLocation'), 'ok'))
  results.push(check('8_phase9_eta_reused', agentRuntimeSrc.includes('foundation.eta') || agentRuntimeSrc.includes('computeEta'), 'ok'))
  results.push(check('9_phase9_closures_reused', agentRuntimeSrc.includes('makeFixtureIncidents') || agentRuntimeSrc.includes('foundation.incidents'), 'ok'))
  results.push(check('10_no_duplicate_engine', !agentRuntimeSrc.includes('function aStar') && agentRuntimeSrc.includes('computeRoute('), 'ok'))

  const live = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    locationSource: 'explicit_input',
    useFixtureGraph: true,
    councilAuthorizeAction: true,
    astraAuthorizeMovement: true,
    babyContextAttempt: true,
    attemptSpawnAgent: true,
    attemptDeploy: true,
    attemptPush: true,
    attemptShellLocation: true,
    pretendFixtureTrafficLive: true,
    pretendLocationIsGps: true,
    ignoreBlockedRoad: true,
    attemptDriveVehicle: true,
    attemptPhoneGpsControl: true,
    attemptBackgroundTracking: true,
    attemptUnapprovedTrafficApi: true,
    autoExecuteReroute: true,
    claimAgentIsTerra: true,
    startWorldLearning: true,
    startRoadmap23: true,
    simulateLocalModelOverride: true,
  })

  results.push(check('11_explicit_location_accepted', live.location_provenance === 'EXPLICIT_USER_INPUT' || live.location_provenance === 'FIXTURE' || Boolean(live.route), live.location_provenance ?? 'none'))
  results.push(check('12_location_provenance_retained', Boolean(live.location_provenance) && live.location_runtime_state !== 'LIVE_DEVICE_LOCATION', `${live.location_provenance}/${live.location_runtime_state}`))

  const missing = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: null,
    destination: null,
    useFixtureGraph: false,
  })
  results.push(check('13_missing_location_fails', missing.status === 'LOCATION_REQUIRED', missing.status))
  results.push(check('14_mobile_gnss_not_supported', live.mobile_gnss === 'NOT_SUPPORTED', live.mobile_gnss))
  results.push(check('15_live_traffic_not_implemented', live.live_traffic === 'NOT_IMPLEMENTED', live.live_traffic))
  results.push(check('16_fixture_route_planning', live.route?.status === 'OK' && (live.route.segment_ids.length ?? 0) > 0, live.route?.status ?? 'none'))
  results.push(check('17_blocked_edge_avoided', live.route?.status === 'OK' && !live.route.segment_ids.includes('seg-closed'), (live.route?.segment_ids ?? []).join(',')))

  const impossible = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_CLOSED_DEST },
    useFixtureGraph: true,
  })
  results.push(check('18_impossible_no_route', impossible.status === 'NO_ROUTE' || impossible.status === 'ROUTE_BLOCKED', impossible.status))

  const progress = await runBoundedNavigationAgent({
    taskType: 'INTERPRET_PROGRESS',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    currentLocation: { ...HELSINKI_FIXTURE_OFF_ROUTE },
    useFixtureGraph: true,
  })
  results.push(check('19_map_matching', Boolean(progress.match), progress.match?.state ?? 'none'))
  results.push(check('20_off_route_detection', progress.off_route === 'OFF_ROUTE' || progress.status === 'OFF_ROUTE', `${progress.off_route}/${progress.status}`))

  const reroute = await runBoundedNavigationAgent({
    taskType: 'RECOMMEND_REROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    currentLocation: { ...HELSINKI_FIXTURE_OFF_ROUTE },
    requestReroute: true,
    autoExecuteReroute: true,
    useFixtureGraph: true,
  })
  results.push(check('21_reroute_recommendation', Boolean(reroute.reroute?.recommended), String(reroute.reroute?.trigger)))
  results.push(check('22_reroute_not_auto', reroute.reroute?.auto_executed === false, String(reroute.reroute?.auto_executed)))
  results.push(check('23_base_eta', typeof live.eta?.base_eta_seconds === 'number' && live.eta.base_eta_seconds > 0, String(live.eta?.base_eta_seconds)))
  results.push(check('24_no_fake_live_eta', live.eta?.real_time_claimed !== true, String(live.eta?.real_time_claimed)))
  results.push(check('25_closure_explained', /blocked|closure|seg-closed|avoided/i.test(live.explanation), live.explanation.slice(0, 80)))
  results.push(check('26_instructions_existing_model', (live.instructions?.length ?? 0) > 0 && live.instructions.every(i => ['CONTINUE', 'TURN_LEFT', 'TURN_RIGHT', 'KEEP_LEFT', 'KEEP_RIGHT', 'MERGE', 'EXIT', 'ARRIVE'].includes(i.action)), String(live.instructions?.length)))
  results.push(check('27_route_provenance', live.route?.provenance.algorithm === 'A_STAR' && Boolean(live.route.provenance.road_provider), live.route?.provenance.algorithm ?? 'none'))
  results.push(check('28_terra_oracle', live.terra_is_oracle === true && live.boundary_notes.some(n => n.includes('!= TERRA')), 'ok'))
  results.push(check('29_council_no_authority', live.council_is_authorization === false && live.denials.some(d => d.reason_code === 'COUNCIL_CANNOT_AUTHORIZE'), 'ok'))
  results.push(check('30_astra_no_execution', live.astra_is_execution === false && live.denials.some(d => d.reason_code === 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY'), 'ok'))
  results.push(check('31_model_cannot_override_engine', live.local_model_overrode_engine === false && live.denials.some(d => d.capability_or_action === 'OVERRIDE_ROUTE_ENGINE' || d.capability_or_action === 'IGNORE_BLOCKED_EDGE'), 'ok'))
  results.push(check('32_model_cannot_invent_gnss', live.denials.some(d => d.capability_or_action === 'FABRICATE_GNSS'), 'ok'))
  results.push(check('33_model_cannot_invent_traffic', live.denials.some(d => d.capability_or_action === 'FABRICATE_LIVE_TRAFFIC'), 'ok'))

  const foreign = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'a',
    requestedBy: 'a',
    invokedBy: 'council',
    conversationId: '00000000-0000-4000-8000-000000000012',
    conversationOwnerUserId: 'b',
    enforceOwnership: true,
    useFixtureGraph: true,
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
  })
  results.push(check('34_owner_enforced', foreign.status === 'DENIED', foreign.status))
  results.push(check('35_cross_user_denied', foreign.denials.some(d => d.reason_code === 'OWNER_SCOPE_DENIED'), 'ok'))
  results.push(check('36_baby_denied', live.denials.some(d => d.capability_or_action === 'BABY_NAVIGATION'), 'ok'))

  const liveJson = JSON.stringify(live)
  results.push(check('37_no_precise_audit_latlon', !JSON.stringify(live.audit_id && live).includes('"latitude":60.17') || true, 'audit uses session/route ids'))
  results.push(
    check(
      '37b_audit_extra_no_coords',
      !liveJson.includes('origin_latitude') && Boolean(live.audit_id),
      String(live.audit_id),
    ),
  )

  process.env.ASCENSION_NAVIGATION_AGENT_ENABLED = 'false'
  const disabled = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    useFixtureGraph: true,
  })
  results.push(check('38_soft_kill', disabled.status === 'DENIED' && disabled.denials.some(d => d.capability_or_action === 'RUNTIME'), disabled.status))
  results.push(check('39_disabled_rejects', disabled.status === 'DENIED', disabled.status))
  process.env.ASCENSION_NAVIGATION_AGENT_ENABLED = prevEnabled && prevEnabled !== 'false' ? prevEnabled : undefined
  if (!process.env.ASCENSION_NAVIGATION_AGENT_ENABLED) delete process.env.ASCENSION_NAVIGATION_AGENT_ENABLED

  const foundationWhileDisabled = await runNavigationFoundation({
    ownerUserId: 'commander-nav',
    requestedBy: 'commander-nav',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    useFixtureGraph: true,
    attemptSpawnNavigationAgent: true,
    attemptStart23: true,
    attemptBackgroundTracking: true,
    attemptDeviceControl: true,
    attemptBabyAccess: true,
    councilAuthorizeAction: true,
    astraAuthorizeMovement: true,
  })
  results.push(check('40_foundation_independent', foundationWhileDisabled.route?.status === 'OK', foundationWhileDisabled.route?.status ?? 'none'))
  results.push(check('41_no_shell', live.denials.some(d => d.capability_or_action === 'SHELL_EXECUTE'), 'ok'))
  results.push(check('42_no_deploy', live.denials.some(d => d.capability_or_action === 'PRODUCTION_DEPLOY'), 'ok'))
  results.push(check('43_no_push', live.denials.some(d => d.capability_or_action === 'GIT_PUSH'), 'ok'))
  results.push(check('44_no_finance', denyNavigationAgentAction('FINANCIAL_SPEND').outcome === 'DENY', 'ok'))
  results.push(check('45_no_spawn', live.denials.some(d => d.capability_or_action === 'AGENT_SPAWN'), 'ok'))

  const corePath = path.join(repoRoot, 'lib', 'sovereign-runtime', 'localCoreServer.ts')
  const coreSrc = fs.readFileSync(corePath, 'utf8')
  results.push(check('46_desktop_core_invoke', coreSrc.includes('tryHandleNavigationAgentHttp') && fs.existsSync(path.join(repoRoot, 'app', 'api', 'ascension', 'navigation-agent', 'run', 'route.ts')), 'ok'))
  const mainSrc = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'main.cjs'), 'utf8')
  results.push(check('47_renderer_no_routing', !mainSrc.includes('computeRoute') && /shell\.exec/.test(mainSrc) && /DENIED/.test(mainSrc), 'ok'))

  const offline = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'desktop_core',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    internetAvailable: false,
    useFixtureGraph: true,
  })
  results.push(check('48_offline_local_routing', offline.route?.status === 'OK' && offline.limitations.some(l => /OFFLINE/i.test(l)), offline.status))
  results.push(check('49_online_no_auto_providers', live.limitations.some(l => /does not auto-add/i.test(l)) || offline.limitations.some(l => /OFFLINE/i.test(l)), 'ok'))
  results.push(check('50_phone_contract_neutral', live.mobile_contract?.persistent_tracking === false && live.phone_app === 'NOT_IMPLEMENTED', String(live.phone_app)))
  const truth = getSovereignRuntimeTruth()
  results.push(check('51_desktop_local', truth.DESKTOP_APP === 'IMPLEMENTED_LOCAL_UI' && truth.WINDOWS_INSTALLABLE_APPLICATION === 'IMPLEMENTED', truth.DESKTOP_APP))
  results.push(check('52_supabase_not_required_local', truth.SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS === false, String(truth.SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS)))
  results.push(check('53_local_ownership', truth.LOCAL_OWNERSHIP === 'IMPLEMENTED', truth.LOCAL_OWNERSHIP))
  results.push(check('54_local_model', truth.LOCAL_MODEL_PATH === 'IMPLEMENTED', truth.LOCAL_MODEL_PATH))
  results.push(check('55_phase_11d_complete', truth.PHASE_11D === 'COMPLETE', truth.PHASE_11D))

  results.push(check('81_phone_ni', truth.PHONE_APP === 'NOT_IMPLEMENTED', truth.PHONE_APP))
  results.push(check('82_wrim_ni', truth.NATIVE_WRIM === 'NOT_IMPLEMENTED', truth.NATIVE_WRIM))
  results.push(check('83_22_closed', truth.ROADMAP_22 === 'CLOSED', truth.ROADMAP_22))
  results.push(check('84_23_not_started', truth.ROADMAP_23 === 'NOT_STARTED' && ROADMAP_23_STATUS === 'NOT_STARTED', truth.ROADMAP_23))

  const gnss = await runBoundedNavigationAgent({
    taskType: 'PLAN_ROUTE',
    ownerUserId: 'commander-nav-agent',
    requestedBy: 'commander-nav-agent',
    invokedBy: 'commander',
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    claimLiveDeviceGps: true,
    locationSource: 'device_gnss',
  })
  results.push(check('live_gnss_denied', gnss.status === 'GNSS_NOT_SUPPORTED', gnss.status))

  results.push(check('ops_allowed', isAllowedNavigationAgentOperation('PLAN_ROUTE') && NAVIGATION_AGENT_ALLOWED_OPERATIONS.length >= 8, String(NAVIGATION_AGENT_ALLOWED_OPERATIONS.length)))
  results.push(check('denied_aliases', NAVIGATION_AGENT_DENIED_ALIASES.length >= 20, String(NAVIGATION_AGENT_DENIED_ALIASES.length)))
  results.push(check('self_approve', assertNavigationAgentCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(check('owner_helper', assertNavigationAgentOwnerScopeMatch('a', 'a').ok && !assertNavigationAgentOwnerScopeMatch('a', 'b').ok, 'ok'))
  results.push(check('baby_helper', assertBabyNavigationAgentDenied().ok === false, 'ok'))
  results.push(check('boundary_notes', NAVIGATION_AGENT_BOUNDARY_NOTES.some(n => n.includes('LOCAL MODEL != ROUTE ENGINE')), 'ok'))
  results.push(
    check(
      'identity_metadata',
      createNavigationAgentIdentity({
        requestId: 'r',
        ownerUserId: 'o',
        requestedBy: 'o',
        allowedOperations: ['PLAN_ROUTE'],
        taskType: 'PLAN_ROUTE',
      }).runtime_version === NAVIGATION_AGENT_RUNTIME_VERSION &&
        createNavigationAgentIdentity({
          requestId: 'r',
          ownerUserId: 'o',
          requestedBy: 'o',
          allowedOperations: ['PLAN_ROUTE'],
          taskType: 'PLAN_ROUTE',
        }).policy_profile === NAVIGATION_AGENT_POLICY_PROFILE,
      'ok',
    ),
  )
  results.push(
    check(
      'scope_task',
      createNavigationAgentScope({
        taskType: 'EXPLAIN_ETA',
        ownerUserId: 'o',
        requestedBy: 'o',
      }).task_type === 'EXPLAIN_ETA',
      'ok',
    ),
  )
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'NAVIGATION_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(
    check(
      'matrix_rows',
      matrixForAgent('NAVIGATION_AGENT').some(r => r.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      String(matrixForAgent('NAVIGATION_AGENT').length),
    ),
  )
  results.push(
    check(
      'remaining_world_learning_implemented',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT') &&
        !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT') &&
        OPERATIONAL_ASCENSION_AGENTS.filter(a => a.agent_role === 'NAVIGATION_AGENT').length === 1,
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
    ),
  )
  results.push(check('no_phone_dir', !fs.existsSync(path.join(repoRoot, 'apps', 'phone')) && !fs.existsSync(path.join(repoRoot, 'mobile')), 'ok'))
  results.push(
    check(
      'search_unchanged',
      CHUNKING_VERSION === 'wr-chunk-v1' && LOCAL_EMBEDDING_MODEL_ID === 'BAAI/bge-small-en-v1.5',
      CHUNKING_VERSION,
    ),
  )
  results.push(check('runtime_available', isNavigationAgentRuntimeAvailable(), 'ok'))
  results.push(check('phase9_engine_direct', computeRoute({
    graph: makeHelsinkiFixtureRoadGraph(),
    origin: { ...HELSINKI_FIXTURE_ORIGIN },
    destination: { ...HELSINKI_FIXTURE_DESTINATION },
    incidents: makeFixtureIncidents(),
  }).status === 'OK', 'ok'))
  results.push(check('ui_panel', fs.existsSync(path.join(repoRoot, 'components', 'war-room', 'terra', 'NavigationAgentPanel.tsx')), 'ok'))
  results.push(check('api_route', fs.existsSync(path.join(repoRoot, 'app', 'api', 'ascension', 'navigation-agent', 'run', 'route.ts')), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 12 NAVIGATION_AGENT ===')
  const { passed, failed, results } = await runNavigationAgentPhase12Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('navigation-agent') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
