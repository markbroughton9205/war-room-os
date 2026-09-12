/**
 * #22 Phase 7 — COUNCIL_VALIDATOR deterministic validation + live-safe proof.
 */
import {
  COUNCIL_VALIDATOR_ROLE,
  COUNCIL_VALIDATOR_RUNTIME_VERSION,
  COUNCIL_VALIDATOR_POLICY_PROFILE,
  COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED,
  createCouncilValidatorIdentity,
  isCouncilValidatorRuntimeAvailable,
} from '@/lib/ascension/council-validator/identity'
import {
  COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES,
  COUNCIL_VALIDATOR_DENIED_ALIASES,
  denyCouncilValidatorAction,
  assertCouncilValidatorCannotSelfApprove,
  isAllowedCouncilValidatorReadClass,
} from '@/lib/ascension/council-validator/profile'
import {
  createCouncilValidatorScope,
  COUNCIL_VALIDATOR_DEFAULT_BOUNDS,
} from '@/lib/ascension/council-validator/scope'
import { COUNCIL_VALIDATOR_BOUNDARY_NOTES } from '@/lib/ascension/council-validator/result'
import {
  runBoundedCouncilValidator,
  councilValidatorResultForCouncil,
  councilValidatorResultForAstra,
} from '@/lib/ascension/council-validator/runtime'
import {
  assertBabyCouncilValidatorDenied,
  assertCouncilValidatorOwnerScopeMatch,
} from '@/lib/ascension/council-validator/ownership'
import { makeCouncilValidatorFixtureClaims } from '@/lib/ascension/council-validator/validateClaims'
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
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runCouncilValidatorPhase7Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []

  results.push(check('1_canonical_actor', COUNCIL_VALIDATOR_ROLE === 'COUNCIL_VALIDATOR', COUNCIL_VALIDATOR_ROLE))
  results.push(
    check(
      '2_status_implemented_bounded',
      OPERATIONAL_ASCENSION_AGENTS.some(
        a => a.agent_role === 'COUNCIL_VALIDATOR' && a.runtime_status === 'IMPLEMENTED_BOUNDED',
      ),
      'IMPLEMENTED_BOUNDED',
    ),
  )
  results.push(check('3_council_output_read', isAllowedCouncilValidatorReadClass('COUNCIL_OUTPUT_READ'), 'ok'))
  results.push(check('4_session_intel_read', isAllowedCouncilValidatorReadClass('SESSION_INTELLIGENCE_READ'), 'ok'))
  results.push(check('5_research_read', isAllowedCouncilValidatorReadClass('RESEARCH_RESULT_READ'), 'ok'))
  results.push(check('6_terra_read', isAllowedCouncilValidatorReadClass('TERRA_RESULT_READ'), 'ok'))
  results.push(check('7_security_read', isAllowedCouncilValidatorReadClass('SECURITY_RESULT_READ'), 'ok'))
  results.push(check('8_operations_read', isAllowedCouncilValidatorReadClass('OPERATIONS_RESULT_READ'), 'ok'))
  results.push(check('9_engineering_read', isAllowedCouncilValidatorReadClass('ENGINEERING_RESULT_READ'), 'ok'))
  results.push(check('10_astra_status_read', isAllowedCouncilValidatorReadClass('ASTRA_STATUS_READ'), 'ok'))

  const live = await runBoundedCouncilValidator({
    conversationId: '00000000-0000-4000-8000-000000000071',
    ownerUserId: 'commander-val',
    requestedBy: 'commander-val',
    invokedBy: 'commander',
    roundId: 'round-1',
    useFixtureClaims: true,
    sessionIntelligencePresent: true,
    requestRevision: true,
    attemptedAction: 'PRODUCTION_DEPLOY',
  })

  const byId = (id: string) => live.claims_checked.find(c => c.claim_id === id)

  results.push(check('11_evidence_consistency', Boolean(byId('supported_ais') && byId('unsupported')), 'ok'))
  results.push(check('12_stale_detected', byId('stale_terra')?.validation_result === 'STALE_EVIDENCE', String(byId('stale_terra')?.validation_result)))
  results.push(
    check(
      '13_cached_not_live',
      byId('cached_as_live')?.validation_result === 'RUNTIME_TRUTH_CONFLICT' &&
        live.runtime_truth_conflicts.some(c => /cached/i.test(c)),
      'ok',
    ),
  )
  results.push(
    check(
      '14_historical_not_live',
      byId('historical_as_live')?.validation_result === 'RUNTIME_TRUTH_CONFLICT',
      String(byId('historical_as_live')?.validation_result),
    ),
  )
  results.push(
    check(
      '15_no_coverage_not_absence',
      byId('no_coverage_absence')?.runtime_truth_state.includes('NO_COVERAGE') === true,
      String(byId('no_coverage_absence')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '16_single_source_not_corroborated',
      byId('single_as_corroborated')?.limitations.some(l => /corroborated/i.test(l)) === true,
      'ok',
    ),
  )
  results.push(
    check(
      '17_inference_not_direct',
      byId('inferred_as_fact')?.validation_result === 'FAIL' ||
        byId('inferred_as_fact')?.confidence_state.includes('INFERRED') === true,
      String(byId('inferred_as_fact')?.validation_result),
    ),
  )
  results.push(
    check(
      '18_conflicting_preserved',
      byId('conflicting')?.validation_result === 'CONFLICTING_EVIDENCE' && live.conflicts.length > 0,
      String(live.conflicts.length),
    ),
  )
  results.push(
    check(
      '19_unsupported_flagged',
      byId('unsupported')?.validation_result === 'INSUFFICIENT_EVIDENCE',
      String(byId('unsupported')?.validation_result),
    ),
  )
  results.push(
    check(
      '20_research_supported',
      byId('research_supported')?.validation_result === 'PASS' ||
        byId('research_supported')?.validation_result === 'PASS_WITH_LIMITATIONS',
      String(byId('research_supported')?.validation_result),
    ),
  )
  results.push(
    check(
      '21_research_inferred',
      byId('research_inferred')?.validation_result === 'PASS_WITH_LIMITATIONS' ||
        byId('research_inferred')?.support_state === 'INFERRED',
      String(byId('research_inferred')?.validation_result),
    ),
  )
  results.push(
    check(
      '22_terra_provider_truth',
      live.runtime_truth_conflicts.length >= 1 || live.claims_checked.some(c => c.claim_type === 'TERRA'),
      'ok',
    ),
  )
  results.push(
    check(
      '23_terra_finding_ne_auth',
      byId('terra_auth')?.validation_result === 'POLICY_CONFLICT' &&
        live.policy_conflicts.some(p => p.includes('TERRA FINDING')),
      'ok',
    ),
  )
  results.push(
    check(
      '24_ops_process_ne_healthy',
      byId('ops_process')?.runtime_truth_state.includes('PROCESS_EXISTS') === true,
      String(byId('ops_process')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '25_local_ne_public',
      byId('ops_local_public')?.runtime_truth_state.includes('LOCAL_HEALTH') === true,
      String(byId('ops_local_public')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '26_security_ne_remediation',
      byId('sec_remediation')?.validation_result === 'POLICY_CONFLICT',
      String(byId('sec_remediation')?.validation_result),
    ),
  )
  results.push(
    check(
      '27_eng_patch_ne_commit',
      byId('eng_patch')?.runtime_truth_state.includes('PATCH_READY') === true,
      String(byId('eng_patch')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '28_eng_build_ne_deploy',
      byId('eng_build')?.runtime_truth_state.includes('BUILD_PASS') === true,
      String(byId('eng_build')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '29_astra_mission_ne_auth',
      byId('astra_mission')?.validation_result === 'POLICY_CONFLICT',
      String(byId('astra_mission')?.validation_result),
    ),
  )
  results.push(
    check(
      '30_planned_ne_running',
      byId('astra_planned')?.runtime_truth_state.includes('PLANNED') === true,
      String(byId('astra_planned')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '31_spawn_request_ne_spawned',
      byId('astra_spawn')?.runtime_truth_state.includes('SPAWN_REQUEST') === true,
      String(byId('astra_spawn')?.runtime_truth_state),
    ),
  )
  results.push(
    check(
      '32_council_rec_ne_approval',
      byId('council_approval')?.validation_result === 'POLICY_CONFLICT',
      String(byId('council_approval')?.validation_result),
    ),
  )
  results.push(
    check(
      '33_unanimous_ne_commander',
      live.policy_conflicts.some(p => /Commander approval/i.test(p)),
      'ok',
    ),
  )
  results.push(
    check(
      '34_pass_ne_execution',
      live.execution_authorized === false &&
        byId('validation_as_exec')?.validation_result === 'POLICY_CONFLICT' &&
        live.validation_pass === false,
      `pass=${live.validation_pass}; exec=${live.execution_authorized}`,
    ),
  )

  results.push(check('35_self_approve_denied', assertCouncilValidatorCannotSelfApprove().outcome === 'DENY', 'ok'))

  const denyIds = [
    ['36', 'POLICY_CHANGE'],
    ['37', 'GIT_PUSH'],
    ['38', 'PRODUCTION_DEPLOY'],
    ['39', 'FINANCIAL_SPEND'],
    ['40', 'AGENT_SPAWN'],
    ['41', 'SHELL_EXECUTE'],
    ['42', 'POWERSHELL_EXECUTE'],
    ['43', 'SQL_EXECUTE'],
    ['44', 'MESSAGE_SEND'],
    ['45', 'PHONE_OUTBOUND'],
    ['46', 'FINANCIAL_SPEND'],
    ['47', 'FINANCIAL_TRANSFER'],
    ['48', 'TRADE'],
    ['49', 'WAGER'],
    ['50', 'SETTLEMENT_SUBMIT'],
  ] as const
  for (const [n, alias] of denyIds) {
    results.push(check(`${n}_${alias.toLowerCase()}_denied`, denyCouncilValidatorAction(alias).outcome === 'DENY', 'ok'))
  }

  results.push(
    check(
      '51_owner_scope',
      assertCouncilValidatorOwnerScopeMatch('a', 'a').ok && !assertCouncilValidatorOwnerScopeMatch('a', 'b').ok,
      'ok',
    ),
  )
  results.push(check('52_service_role_ne_authority', live.denials.some(d => d.capability_or_action.includes('SERVICE_ROLE')), 'ok'))
  results.push(check('53_baby_separation', assertBabyCouncilValidatorDenied().ok === false, 'DENIED'))
  results.push(check('54_session_intel_not_mutated', live.session_intelligence_mutated === false, 'ok'))
  results.push(check('55_deliberation_not_replaced', live.deliberation_pipeline_replaced === false, 'ok'))
  results.push(
    check(
      '56_correction_recommendation',
      live.recommended_corrections.length > 0 &&
        live.limitations.some(l => l.includes('FLAG') || l.includes('not auto-rewrite') || l.includes('flags only')),
      String(live.recommended_corrections.length),
    ),
  )
  results.push(
    check(
      '57_revision_loop_bounded',
      live.revision_requests <= live.max_revision_requests && live.max_revision_requests === 1,
      `rev=${live.revision_requests}/${live.max_revision_requests}`,
    ),
  )
  results.push(check('58_audit_generated', Boolean(live.audit_id), String(live.audit_id)))
  results.push(
    check(
      '59_audit_claim_evidence',
      live.claims_checked.length > 0 && live.evidence_summary.length > 0,
      live.evidence_summary,
    ),
  )
  results.push(
    check(
      '60_audit_policy_runtime',
      live.policy_conflicts.length > 0 && live.runtime_truth_conflicts.length > 0,
      `policy=${live.policy_conflicts.length}; runtime=${live.runtime_truth_conflicts.length}`,
    ),
  )
  const liveJson = JSON.stringify(live)
  results.push(
    check(
      '61_no_hidden_cot',
      !liveJson.includes('"chain_of_thought":"') && live.plan_summary.length > 0,
      'ok',
    ),
  )
  results.push(
    check(
      '62_insufficient_never_pass',
      byId('unsupported')?.validation_result === 'INSUFFICIENT_EVIDENCE' && live.validation_pass === false,
      `pass=${live.validation_pass}`,
    ),
  )
  results.push(
    check(
      '63_conflict_not_silent',
      live.conflicts.length > 0 && byId('conflicting')?.validation_result === 'CONFLICTING_EVIDENCE',
      String(live.conflicts.length),
    ),
  )
  results.push(
    check(
      '64_runtime_truth',
      operationalAscensionAgentCount() === 6 &&
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'COUNCIL_VALIDATOR'),
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '65_ascension_autonomy_off',
      ascensionAutonomyIsOff() && !COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED,
      'OFF',
    ),
  )
  results.push(check('66_research_operational', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('67_engineering_operational', isEngineeringAgentRuntimeAvailable(), 'ok'))
  results.push(check('68_security_operational', isSecurityRedTeamAgentRuntimeAvailable(), 'ok'))
  results.push(check('69_operations_operational', isOperationsAgentRuntimeAvailable(), 'ok'))
  results.push(check('70_terra_operational', isTerraIntelligenceAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      '71_exactly_6_operational',
      operationalAscensionAgentCount() === 6 && OPERATIONAL_ASCENSION_AGENTS.length === 6,
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '72_remaining_targets_unimplemented',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('COUNCIL_VALIDATOR' as never) &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('DATA_CORPUS_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_NAVIGATION_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('FUTURE_WORLD_LEARNING_AGENT'),
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
    ),
  )

  // Red team
  const redActions = [
    'PRODUCTION_DEPLOY',
    'PRODUCTION_RESTART',
    'GIT_PUSH',
    'AGENT_SPAWN',
    'POLICY_CHANGE',
    'APPROVAL_CHANGE',
    'MISSION_EXECUTION',
  ]
  for (const action of redActions) {
    results.push(check(`redteam_${action.toLowerCase()}`, denyCouncilValidatorAction(action).outcome === 'DENY', 'DENIED'))
  }

  const foreign = await runBoundedCouncilValidator({
    conversationId: '00000000-0000-4000-8000-000000000072',
    ownerUserId: 'a',
    requestedBy: 'a',
    invokedBy: 'council',
    conversationOwnerUserId: 'b',
    enforceOwnership: true,
    useFixtureClaims: true,
  })
  results.push(check('redteam_foreign_owner', foreign.status === 'DENIED', foreign.status))

  const rewrite = await runBoundedCouncilValidator({
    conversationId: '00000000-0000-4000-8000-000000000073',
    ownerUserId: 'commander-val',
    requestedBy: 'commander-val',
    invokedBy: 'commander',
    useFixtureClaims: true,
    autoRewriteCouncilOutput: true,
    mutateSessionIntelligence: true,
    replaceDeliberationPipeline: true,
  })
  results.push(check('redteam_no_auto_rewrite', rewrite.denials.some(d => d.capability_or_action === 'AUTO_REWRITE_COUNCIL'), 'ok'))
  results.push(check('redteam_no_si_mutate', rewrite.denials.some(d => d.capability_or_action === 'SESSION_INTELLIGENCE_MUTATION'), 'ok'))
  results.push(check('redteam_no_delib_replace', rewrite.denials.some(d => d.capability_or_action === 'DELIBERATION_REPLACE'), 'ok'))

  const baby = await runBoundedCouncilValidator({
    conversationId: '00000000-0000-4000-8000-000000000074',
    ownerUserId: 'commander',
    requestedBy: 'commander',
    invokedBy: 'commander',
    babyContextAttempt: true,
    useFixtureClaims: true,
  })
  results.push(check('redteam_baby', baby.denials.some(d => d.capability_or_action === 'BABY_COUNCIL_CONTEXT'), 'ok'))

  const councilView = councilValidatorResultForCouncil(live)
  results.push(check('council_view_exec_false', councilView.execution_authorized === false, 'ok'))
  const astraView = councilValidatorResultForAstra(live)
  results.push(check('astra_view_no_exec_perm', astraView.may_use_as_execution_permission === false, 'ok'))

  results.push(check('runtime_available', isCouncilValidatorRuntimeAvailable(), 'ok'))
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'COUNCIL_VALIDATOR' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(
    check(
      'matrix_rows',
      matrixForAgent('COUNCIL_VALIDATOR').some(
        r => r.id === 'council.validate' && r.runtimeStatus === 'IMPLEMENTED_BOUNDED',
      ),
      String(matrixForAgent('COUNCIL_VALIDATOR').length),
    ),
  )
  results.push(check('read_classes', COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES.length >= 10, String(COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES.length)))
  results.push(check('denied_aliases', COUNCIL_VALIDATOR_DENIED_ALIASES.length >= 25, String(COUNCIL_VALIDATOR_DENIED_ALIASES.length)))
  results.push(
    check(
      'identity_metadata',
      (() => {
        const id = createCouncilValidatorIdentity({
          requestId: 'r',
          ownerUserId: 'o',
          requestedBy: 'o',
          conversationId: 'c',
        })
        return (
          id.runtime_version === COUNCIL_VALIDATOR_RUNTIME_VERSION &&
          id.policy_profile === COUNCIL_VALIDATOR_POLICY_PROFILE
        )
      })(),
      'ok',
    ),
  )
  results.push(
    check(
      'scope_bounds',
      createCouncilValidatorScope({
        conversationId: 'c',
        ownerUserId: 'o',
        requestedBy: 'o',
      }).max_claims === COUNCIL_VALIDATOR_DEFAULT_BOUNDS.max_claims,
      'ok',
    ),
  )
  results.push(check('boundary_notes', COUNCIL_VALIDATOR_BOUNDARY_NOTES.some(n => n.includes('VALIDATED != AUTHORIZED')), 'ok'))
  results.push(check('fixture_claim_count', makeCouncilValidatorFixtureClaims().length >= 15, String(makeCouncilValidatorFixtureClaims().length)))
  results.push(check('deploy_attempt_denied', live.denials.some(d => d.capability_or_action === 'PRODUCTION_DEPLOY'), 'ok'))
  results.push(check('live_status_truthful', ['COMPLETE', 'PARTIAL', 'DEGRADED'].includes(live.status), live.status))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 7 COUNCIL_VALIDATOR ===')
  const { passed, failed, results } = await runCouncilValidatorPhase7Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('council-validator') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
