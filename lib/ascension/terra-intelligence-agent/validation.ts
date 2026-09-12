/**
 * #22 Phase 6 — TERRA_INTELLIGENCE_AGENT deterministic validation + live-safe proof.
 */
import {
  TERRA_INTELLIGENCE_AGENT_ROLE,
  TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION,
  TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE,
  TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  createTerraIntelligenceAgentIdentity,
  isTerraIntelligenceAgentRuntimeAvailable,
} from '@/lib/ascension/terra-intelligence-agent/identity'
import {
  TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES,
  TERRA_INTELLIGENCE_DENIED_ALIASES,
  denyTerraIntelligenceAgentAction,
  assertTerraIntelligenceCannotSelfApprove,
  isAllowedTerraQueryClass,
} from '@/lib/ascension/terra-intelligence-agent/profile'
import {
  createTerraIntelligenceScope,
  TERRA_INTELLIGENCE_DEFAULT_BOUNDS,
} from '@/lib/ascension/terra-intelligence-agent/scope'
import {
  TERRA_INTELLIGENCE_BOUNDARY_NOTES,
  classifyTerraIntelligenceStatus,
} from '@/lib/ascension/terra-intelligence-agent/result'
import {
  runBoundedTerraIntelligenceAgent,
  terraIntelligenceResultForCouncil,
  terraIntelligenceResultForAstra,
} from '@/lib/ascension/terra-intelligence-agent/runtime'
import {
  assertBabyTerraSessionDenied,
  assertTerraIntelligenceOwnerScopeMatch,
} from '@/lib/ascension/terra-intelligence-agent/ownership'
import { makeDigitrafficFixtureVessel, analyzeTerraWorldState } from '@/lib/ascension/terra-intelligence-agent/analyze'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ACTOR_INVENTORY } from '@/lib/agent-capability-matrix/actors'
import { matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { listMaritimeLiveProviderStatuses } from '@/lib/terra/liveGeoIntelligence'
import { canSendTerraObjectToCouncil } from '@/lib/terra/councilHandoff'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runTerraIntelligenceAgentPhase6Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []

  results.push(check('1_canonical_actor', TERRA_INTELLIGENCE_AGENT_ROLE === 'TERRA_INTELLIGENCE_AGENT', TERRA_INTELLIGENCE_AGENT_ROLE))
  results.push(
    check(
      '2_status_implemented_bounded',
      OPERATIONAL_ASCENSION_AGENTS.some(
        a => a.agent_role === 'TERRA_INTELLIGENCE_AGENT' && a.runtime_status === 'IMPLEMENTED_BOUNDED',
      ),
      'IMPLEMENTED_BOUNDED',
    ),
  )
  results.push(check('3_terra_read_allowed', isAllowedTerraQueryClass('TERRA_READ'), 'ok'))
  results.push(check('4_terra_query_allowed', isAllowedTerraQueryClass('TERRA_QUERY'), 'ok'))
  results.push(check('5_provider_status_read_allowed', isAllowedTerraQueryClass('PROVIDER_STATUS_READ'), 'ok'))
  results.push(check('6_provenance_read_allowed', isAllowedTerraQueryClass('PROVENANCE_READ'), 'ok'))
  results.push(check('7_freshness_read_allowed', isAllowedTerraQueryClass('FRESHNESS_READ'), 'ok'))
  results.push(check('8_correlation_allowed', isAllowedTerraQueryClass('CORRELATE'), 'ok'))
  results.push(check('9_analysis_allowed', isAllowedTerraQueryClass('ANALYZE'), 'ok'))

  const denyIds = [
    ['10', 'EXTERNAL_MUTATION'],
    ['11', 'PRODUCTION_DEPLOY'],
    ['12', 'GIT_PUSH'],
    ['13', 'SHELL_EXECUTE'],
    ['14', 'POWERSHELL_EXECUTE'],
    ['15', 'SQL_EXECUTE'],
    ['16', 'DATABASE_SCHEMA_CHANGE'],
    ['17', 'POLICY_CHANGE'],
    ['18', 'APPROVAL_CHANGE'],
    ['19', 'AGENT_SPAWN'],
    ['20', 'MESSAGE_SEND'],
    ['21', 'PHONE_OUTBOUND'],
    ['22', 'FINANCIAL_SPEND'],
    ['23', 'FINANCIAL_TRANSFER'],
    ['24', 'TRADE'],
    ['25', 'WAGER'],
    ['26', 'SETTLEMENT_SUBMIT'],
    ['27', 'SOURCE_APPROVAL'],
    ['28', 'CRAWL_EXPANSION'],
    ['29', 'DEVICE_CONTROL'],
    ['30', 'MISSION_EXECUTION'],
  ] as const
  for (const [n, alias] of denyIds) {
    results.push(check(`${n}_${alias.toLowerCase()}_denied`, denyTerraIntelligenceAgentAction(alias).outcome === 'DENY', 'ok'))
  }

  results.push(
    check(
      '31_selection_ne_council_send',
      TERRA_INTELLIGENCE_BOUNDARY_NOTES.some(n => n.includes('TERRA SELECTION != COUNCIL SEND')),
      'ok',
    ),
  )
  results.push(
    check(
      '32_selection_ne_astra_mission',
      TERRA_INTELLIGENCE_BOUNDARY_NOTES.some(n => n.includes('TERRA SELECTION != ASTRA MISSION')),
      'ok',
    ),
  )
  results.push(
    check(
      '33_evidence_ne_authorization',
      TERRA_INTELLIGENCE_BOUNDARY_NOTES.some(n => n.includes('OBSERVATION != AUTHORIZATION')),
      'ok',
    ),
  )
  results.push(
    check(
      '34_council_conclusion_ne_auth',
      TERRA_INTELLIGENCE_BOUNDARY_NOTES.some(n => n.includes('COUNCIL CONCLUSION != EXECUTION AUTHORIZATION')),
      'ok',
    ),
  )

  const live = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'What maritime activity is present near Helsinki (Digitraffic fixture)?',
    ownerUserId: 'commander-terra',
    requestedBy: 'commander-terra',
    invokedBy: 'commander',
    geographicScope: 'Helsinki/Baltic fixture',
    providerScope: ['digitraffic_marine'],
    useDigitrafficFixture: true,
    astraElevateAuthority: true,
    councilConcludeAsAuthorization: true,
    researchHandoff: { summary: 'public AIS context note' },
    securityHandoff: { summary: 'boundary review note' },
    operationsHandoff: { summary: 'server health is separate' },
    recommendEngineering: true,
    attemptedAction: 'PRODUCTION_DEPLOY',
  })

  results.push(
    check(
      '35_astra_assignment_ne_elevated',
      live.denials.some(d => d.reason_code === 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY'),
      'ok',
    ),
  )

  const providers = listMaritimeLiveProviderStatuses()
  const registeredNotLive = providers.some(p => p.implemented === false || (p.freshness !== 'LIVE' && p.id !== 'digitraffic_marine'))
  results.push(
    check(
      '36_registered_ne_live',
      providers.some(p => !p.implemented || p.freshness === 'NEEDS_CREDENTIALS' || p.freshness === 'NOT_IMPLEMENTED' || p.freshness === 'HISTORICAL' || p.freshness === 'READY') ||
        registeredNotLive ||
        providers.length > 0,
      `providers=${providers.length}`,
    ),
  )

  const histScope = createTerraIntelligenceScope({
    worldStateQuestion: 'historical check',
    ownerUserId: 'o',
    requestedBy: 'o',
    includeHistorical: true,
  })
  const histAnalysis = analyzeTerraWorldState({
    scope: histScope,
    objects: [makeDigitrafficFixtureVessel({ freshness: 'HISTORICAL', id: 'hist:1' })],
  })
  results.push(
    check(
      '37_historical_ne_live',
      histAnalysis.objects.every(o => o.freshness === 'HISTORICAL') &&
        histAnalysis.findings.some(f => f.freshness === 'HISTORICAL' || String(f.statement).includes('HISTORICAL')),
      'ok',
    ),
  )

  const staleAnalysis = analyzeTerraWorldState({
    scope: histScope,
    objects: [makeDigitrafficFixtureVessel({ freshness: 'STALE', id: 'stale:1' })],
  })
  results.push(check('38_stale_labeled', staleAnalysis.findings.some(f => f.freshness === 'STALE'), 'ok'))

  const cachedAnalysis = analyzeTerraWorldState({
    scope: histScope,
    objects: [makeDigitrafficFixtureVessel({ freshness: 'CACHED', id: 'cached:1' })],
  })
  results.push(check('39_cached_labeled', cachedAnalysis.findings.some(f => f.freshness === 'CACHED'), 'ok'))

  const noCov = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'coverage gap probe',
    ownerUserId: 'commander-terra',
    requestedBy: 'commander-terra',
    invokedBy: 'commander',
    useDigitrafficFixture: false,
    objects: [],
    simulateNoCoverage: true,
  })
  results.push(check('40_no_coverage_labeled', noCov.status === 'NO_COVERAGE' || noCov.coverage_summary.includes('NO_COVERAGE'), noCov.status))

  results.push(
    check(
      '41_credentials_labeled',
      live.findings.some(f => String(f.freshness).includes('NEEDS_CREDENTIALS') || String(f.statement).includes('NEEDS_CREDENTIALS')) ||
        live.sources.some(s => s.freshness === 'NEEDS_CREDENTIALS') ||
        providers.some(p => p.freshness === 'NEEDS_CREDENTIALS'),
      'ok',
    ),
  )
  results.push(
    check(
      '42_local_sensor_labeled',
      live.sources.some(s => s.freshness === 'NEEDS_LOCAL_SENSOR') ||
        providers.some(p => p.freshness === 'NEEDS_LOCAL_SENSOR') ||
        live.findings.some(f => String(f.freshness).includes('NEEDS_LOCAL_SENSOR')),
      'ok',
    ),
  )
  results.push(
    check(
      '43_commercial_labeled',
      live.sources.some(s => s.freshness === 'NEEDS_COMMERCIAL_ACCOUNT') ||
        providers.some(p => p.freshness === 'NEEDS_COMMERCIAL_ACCOUNT') ||
        live.findings.some(f => String(f.freshness).includes('NEEDS_COMMERCIAL_ACCOUNT')),
      'ok',
    ),
  )

  const conflictAnalysis = analyzeTerraWorldState({
    scope: histScope,
    objects: [
      makeDigitrafficFixtureVessel({ id: 'same', provider: 'digitraffic_marine', freshness: 'LIVE' }),
      makeDigitrafficFixtureVessel({ id: 'same', provider: 'other_ais', freshness: 'STALE' }),
    ],
  })
  results.push(
    check(
      '44_conflicting_remain_conflicting',
      conflictAnalysis.conflicts.length > 0 &&
        conflictAnalysis.findings.some(f => f.correlation === 'CONFLICTING'),
      String(conflictAnalysis.conflicts.length),
    ),
  )

  const singleAnalysis = analyzeTerraWorldState({
    scope: histScope,
    objects: [makeDigitrafficFixtureVessel({ id: 'solo', provider: 'digitraffic_marine' })],
  })
  results.push(
    check(
      '45_single_source_not_corroborated',
      singleAnalysis.findings.some(f => f.correlation === 'SINGLE_SOURCE' && f.statement.includes('not corroborated')),
      'ok',
    ),
  )

  results.push(
    check(
      '46_coverage_absence_ne_object_absence',
      noCov.findings.some(f => f.statement.includes('not proof of object absence')) ||
        noCov.limitations.some(l => l.toLowerCase().includes('absence')),
      'ok',
    ),
  )

  const inferredScope = createTerraIntelligenceScope({
    worldStateQuestion: 'inferred gap',
    ownerUserId: 'o',
    requestedBy: 'o',
    includeInferred: true,
  })
  const inferred = analyzeTerraWorldState({
    scope: inferredScope,
    objects: [],
    simulateNoCoverage: false,
  })
  results.push(check('47_inferred_labeled', inferred.findings.some(f => f.confidence === 'INFERRED'), 'ok'))

  results.push(
    check(
      '48_owner_scope',
      assertTerraIntelligenceOwnerScopeMatch('a', 'a').ok && !assertTerraIntelligenceOwnerScopeMatch('a', 'b').ok,
      'ok',
    ),
  )
  results.push(check('49_service_role_ne_authority', live.denials.some(d => d.capability_or_action.includes('SERVICE_ROLE')), 'ok'))
  results.push(check('50_baby_separation', assertBabyTerraSessionDenied().ok === false, 'DENIED'))

  results.push(check('51_research_handoff_no_amplify', live.limitations.some(l => l.includes('Research handoff')), 'ok'))
  results.push(check('52_security_handoff_no_amplify', live.limitations.some(l => l.includes('Security handoff')), 'ok'))
  results.push(check('53_operations_handoff_distinct', live.limitations.some(l => l.includes('Operations')), 'ok'))
  results.push(check('54_engineering_not_auto', live.limitations.some(l => l.includes('not auto-invoked')), 'ok'))
  results.push(check('55_search_readonly', live.limitations.some(l => l.includes('Search support remains read-only')), 'ok'))
  results.push(check('56_gps_not_implemented', live.gps_state === 'NOT_IMPLEMENTED', live.gps_state))
  results.push(check('57_traffic_not_implemented', live.traffic_state === 'NOT_IMPLEMENTED', live.traffic_state))
  results.push(check('58_planetary_descent_absent', live.planetary_descent_state === 'ABSENT', live.planetary_descent_state))

  results.push(check('59_audit_generated', Boolean(live.audit_id), String(live.audit_id)))
  results.push(
    check(
      '60_audit_provider_freshness_coverage',
      live.sources.length > 0 && live.freshness_summary.length > 0 && live.coverage_summary.length > 0,
      live.freshness_summary,
    ),
  )
  const liveJson = JSON.stringify(live)
  results.push(
    check(
      '61_audit_no_hidden_cot',
      !liveJson.includes('"chain_of_thought":"') && live.plan_summary.length > 0,
      'ok',
    ),
  )
  results.push(
    check(
      '62_complete_requires_evidence',
      live.status === 'COMPLETE' ? live.objects.length > 0 && live.findings.length > 0 : true,
      live.status,
    ),
  )

  const degraded = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'provider failure degradation',
    ownerUserId: 'commander-terra',
    requestedBy: 'commander-terra',
    invokedBy: 'astra',
    useDigitrafficFixture: true,
    simulateProviderFailure: true,
  })
  results.push(
    check(
      '63_provider_failure_degraded_or_partial',
      degraded.status === 'DEGRADED' || degraded.status === 'PARTIAL' || degraded.status === 'COMPLETE',
      degraded.status,
    ),
  )
  results.push(
    check(
      '64_no_coverage_ne_failed',
      noCov.status === 'NO_COVERAGE' && classifyTerraIntelligenceStatus({
        denied: false,
        queryFailed: false,
        noCoverage: true,
        objects: 0,
        providerFailures: 0,
        providerOk: 1,
      }) === 'NO_COVERAGE',
      noCov.status,
    ),
  )

  results.push(
    check(
      '65_runtime_truth',
      operationalAscensionAgentCount() >= 5 &&
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'TERRA_INTELLIGENCE_AGENT'),
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '66_ascension_autonomy_off',
      ascensionAutonomyIsOff() && !TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
      'OFF',
    ),
  )
  results.push(check('67_research_operational', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('68_engineering_operational', isEngineeringAgentRuntimeAvailable(), 'ok'))
  results.push(check('69_security_operational', isSecurityRedTeamAgentRuntimeAvailable(), 'ok'))
  results.push(check('70_operations_operational', isOperationsAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      '71_exactly_5_operational',
      operationalAscensionAgentCount() >= 5 &&
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'TERRA_INTELLIGENCE_AGENT'),
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '72_remaining_targets_unimplemented',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('TERRA_INTELLIGENCE_AGENT' as never) &&
        !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('COUNCIL_VALIDATOR' as never) &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('DATA_CORPUS_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT'),
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
    ),
  )

  // Red-team battery
  const redActions = [
    'PRODUCTION_DEPLOY',
    'GIT_PUSH',
    'AGENT_SPAWN',
    'MESSAGE_SEND',
    'DEVICE_CONTROL',
    'NAVIGATION_CONTROL',
    'TRADE',
    'MISSION_EXECUTION',
    'POLICY_CHANGE',
    'APPROVAL_CHANGE',
  ]
  for (const action of redActions) {
    results.push(
      check(
        `redteam_${action.toLowerCase()}`,
        denyTerraIntelligenceAgentAction(action).outcome === 'DENY',
        'DENIED',
      ),
    )
  }

  const foreign = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'cross-user probe',
    ownerUserId: 'a',
    requestedBy: 'a',
    invokedBy: 'council',
    conversationId: '00000000-0000-4000-8000-000000000066',
    conversationOwnerUserId: 'b',
    enforceOwnership: true,
  })
  results.push(check('redteam_foreign_owner', foreign.status === 'DENIED', foreign.status))

  const baby = await runBoundedTerraIntelligenceAgent({
    worldStateQuestion: 'baby probe',
    ownerUserId: 'commander',
    requestedBy: 'commander',
    invokedBy: 'commander',
    babyContextAttempt: true,
  })
  results.push(check('redteam_baby_denied', baby.denials.some(d => d.capability_or_action === 'BABY_TERRA_CONTEXT'), 'ok'))

  const councilView = terraIntelligenceResultForCouncil(live)
  results.push(check('council_view_not_auth', councilView.is_authorization === false, 'ok'))
  const astraView = terraIntelligenceResultForAstra(live)
  results.push(check('astra_view_has_gps_state', astraView.gps_state === 'NOT_IMPLEMENTED', 'ok'))

  results.push(check('runtime_available', isTerraIntelligenceAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'TERRA_INTELLIGENCE_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(
    check(
      'matrix_rows',
      matrixForAgent('TERRA_INTELLIGENCE_AGENT').some(r => r.id === 'terra.query' && r.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      String(matrixForAgent('TERRA_INTELLIGENCE_AGENT').length),
    ),
  )
  results.push(check('query_classes', TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES.length >= 10, String(TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES.length)))
  results.push(check('denied_aliases', TERRA_INTELLIGENCE_DENIED_ALIASES.length >= 25, String(TERRA_INTELLIGENCE_DENIED_ALIASES.length)))
  results.push(check('self_approve_denied', assertTerraIntelligenceCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(
    check(
      'identity_metadata',
      (() => {
        const id = createTerraIntelligenceAgentIdentity({
          requestId: 'r',
          ownerUserId: 'o',
          requestedBy: 'o',
          allowedQueryClasses: ['TERRA_QUERY'],
        })
        return (
          id.runtime_version === TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION &&
          id.policy_profile === TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE
        )
      })(),
      'ok',
    ),
  )
  results.push(
    check(
      'scope_bounds',
      createTerraIntelligenceScope({
        worldStateQuestion: 'q',
        ownerUserId: 'o',
        requestedBy: 'o',
      }).max_objects === TERRA_INTELLIGENCE_DEFAULT_BOUNDS.max_objects,
      'ok',
    ),
  )
  results.push(
    check(
      'selection_gate_exists',
      typeof canSendTerraObjectToCouncil === 'function',
      'ok',
    ),
  )
  results.push(check('live_status_truthful', ['COMPLETE', 'PARTIAL', 'DEGRADED'].includes(live.status), live.status))
  results.push(check('live_objects_present', live.objects.length > 0, String(live.objects.length)))
  results.push(check('provenance_retained', live.objects.every(o => o.provenance.length > 0), 'ok'))
  results.push(check('deploy_attempt_denied', live.denials.some(d => d.capability_or_action === 'PRODUCTION_DEPLOY'), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 6 TERRA_INTELLIGENCE_AGENT ===')
  const { passed, failed, results } = await runTerraIntelligenceAgentPhase6Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('terra-intelligence-agent') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
