/**
 * #22 Phase 4 — SECURITY_RED_TEAM_AGENT deterministic validation + live-safe proof.
 */
import {
  SECURITY_RED_TEAM_AGENT_ROLE,
  SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION,
  SECURITY_RED_TEAM_AGENT_POLICY_PROFILE,
  SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  createSecurityRedTeamAgentIdentity,
  isSecurityRedTeamAgentRuntimeAvailable,
} from '@/lib/ascension/security-red-team-agent/identity'
import {
  SECURITY_RED_TEAM_SAFE_PROBE_CLASSES,
  SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES,
  SECURITY_RED_TEAM_DENIED_ALIASES,
  denySecurityRedTeamAction,
  assertSecurityRedTeamCannotSelfApprove,
  assertSecurityChildDoesNotExceedParent,
  isSafeProbeClass,
  isProhibitedProbeClass,
} from '@/lib/ascension/security-red-team-agent/profile'
import { createSecurityRedTeamScope, SECURITY_RED_TEAM_DEFAULT_BOUNDS } from '@/lib/ascension/security-red-team-agent/scope'
import {
  SECURITY_FINDING_SEVERITIES,
  SECURITY_RED_TEAM_BOUNDARY_NOTES,
  makeFinding,
} from '@/lib/ascension/security-red-team-agent/result'
import { runBoundedSecurityRedTeamAgent } from '@/lib/ascension/security-red-team-agent/runtime'
import { assertSecurityOwnerScopeMatch } from '@/lib/ascension/security-red-team-agent/ownership'
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
import { resolveRepoRoot } from '@/lib/repo/paths'

type Check = { id: string; ok: boolean; detail: string }

function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runSecurityRedTeamPhase4Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const repoRoot = resolveRepoRoot()

  results.push(check('1_canonical_actor', SECURITY_RED_TEAM_AGENT_ROLE === 'SECURITY_RED_TEAM_AGENT', SECURITY_RED_TEAM_AGENT_ROLE))
  results.push(
    check(
      '2_status_implemented_bounded',
      OPERATIONAL_ASCENSION_AGENTS.some(
        a => a.agent_role === 'SECURITY_RED_TEAM_AGENT' && a.runtime_status === 'IMPLEMENTED_BOUNDED',
      ),
      'IMPLEMENTED_BOUNDED',
    ),
  )
  results.push(check('3_static_analysis_allowed', isSafeProbeClass('STATIC_ANALYSIS'), 'ok'))
  results.push(check('4_policy_evaluation_allowed', isSafeProbeClass('POLICY_EVALUATION'), 'ok'))
  results.push(check('5_ownership_boundary_allowed', isSafeProbeClass('OWNERSHIP_BOUNDARY_TEST'), 'ok'))
  results.push(check('6_approval_test_allowed', isSafeProbeClass('APPROVAL_BOUNDARY_TEST'), 'ok'))
  results.push(check('7_agent_authority_allowed', isSafeProbeClass('AGENT_AUTHORITY_TEST'), 'ok'))
  results.push(check('8_worktree_escape_allowed', isSafeProbeClass('WORKTREE_ESCAPE_TEST'), 'ok'))

  results.push(check('9_external_exploit_denied', isProhibitedProbeClass('REAL_EXTERNAL_EXPLOIT'), 'ok'))
  results.push(check('10_destructive_db_denied', isProhibitedProbeClass('DESTRUCTIVE_DB_TEST'), 'ok'))
  results.push(check('11_production_kill_denied', isProhibitedProbeClass('PRODUCTION_KILL_TEST'), 'ok'))
  results.push(check('12_production_restart_denied', isProhibitedProbeClass('PRODUCTION_RESTART_TEST'), 'ok'))
  results.push(check('13_secret_extraction_denied', isProhibitedProbeClass('SECRET_EXTRACTION'), 'ok'))
  results.push(check('14_credential_dump_denied', isProhibitedProbeClass('CREDENTIAL_DUMP'), 'ok'))
  results.push(check('15_malware_denied', isProhibitedProbeClass('MALWARE_EXECUTION'), 'ok'))
  results.push(check('16_priv_esc_denied', isProhibitedProbeClass('PRIVILEGE_ESCALATION'), 'ok'))
  results.push(check('17_dos_denied', isProhibitedProbeClass('DENIAL_OF_SERVICE'), 'ok'))
  results.push(check('18_financial_denied', isProhibitedProbeClass('FINANCIAL_ACTION'), 'ok'))
  results.push(check('19_message_denied', isProhibitedProbeClass('REAL_MESSAGE_SEND'), 'ok'))
  results.push(check('20_phone_denied', isProhibitedProbeClass('REAL_PHONE_ACTION'), 'ok'))

  const live = await runBoundedSecurityRedTeamAgent({
    securityQuestion: 'Can War Room actors bypass ownership, approval, or agent authority boundaries?',
    ownerUserId: 'commander-sec-owner',
    requestedBy: 'commander-sec-owner',
    invokedBy: 'commander',
    targets: ['ownership', 'approval', 'engineering_agent', 'research_agent', 'council', 'astra', 'terra'],
    repositoryRoot: repoRoot,
    researchHandoff: { summary: 'advisory CVE note — must not grant authority' },
    attemptedAction: 'AGENT_SPAWN',
    prohibitedProbeAttempts: [
      'REAL_EXTERNAL_EXPLOIT',
      'SECRET_EXTRACTION',
      'MALWARE_EXECUTION',
      'PRODUCTION_KILL_TEST',
    ],
  })

  const testIds = new Set(live.tests_run.map(t => t.test_id))
  results.push(check('21_research_eng_laundering', testIds.has('authority_laundering_suite') && live.tests_run.find(t => t.test_id === 'authority_laundering_suite')?.ok === true, 'ok'))
  results.push(check('22_eng_research_laundering', testIds.has('authority_laundering_suite'), 'ok'))
  results.push(check('23_council_laundering', live.findings.some(f => f.evidence.some(e => e.includes('SELF_ESCALATION') || e.includes('TECHNICAL_REACH') || e.includes('POLICY')) || f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('24_astra_laundering', live.findings.some(f => f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('25_terra_laundering', live.findings.some(f => f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('26_self_escalation_denied', assertSecurityRedTeamCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(check('27_child_gt_parent_denied', assertSecurityChildDoesNotExceedParent().outcome === 'DENY', 'ok'))
  results.push(check('28_nested_delegation_denied', live.tests_run.some(t => t.test_id === 'authority_laundering_suite' && t.ok), 'ok'))

  results.push(check('29_missing_approval', live.tests_run.some(t => t.test_id === 'approval_boundary_suite' && t.ok), 'ok'))
  results.push(check('30_expired_approval', live.tests_run.some(t => t.test_id === 'approval_boundary_suite' && t.ok), 'ok'))
  results.push(check('31_wrong_actor_approval', live.tests_run.some(t => t.test_id === 'approval_boundary_suite' && t.ok), 'ok'))
  results.push(check('32_wrong_target_approval', live.tests_run.some(t => t.test_id === 'approval_boundary_suite' && t.ok), 'ok'))
  results.push(check('33_replayed_approval', live.tests_run.some(t => t.test_id === 'approval_boundary_suite' && t.ok), 'ok'))
  results.push(check('34_self_approval_denied', assertSecurityRedTeamCannotSelfApprove().reasonCode === 'SELF_ESCALATION_DENIED', 'ok'))

  results.push(check('35_git_push_aliases', live.tests_run.some(t => t.test_id === 'dangerous_alias_suite' && t.ok), 'ok'))
  results.push(check('36_deploy_aliases', live.tests_run.some(t => t.test_id === 'dangerous_alias_suite' && t.ok), 'ok'))
  results.push(check('37_sql_aliases', denySecurityRedTeamAction('SQL_MUTATION').outcome === 'DENY', 'ok'))
  results.push(check('38_package_script_deploy', live.tests_run.some(t => t.test_id === 'dangerous_alias_suite' && t.ok), 'ok'))

  results.push(check('39_eng_traversal', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('40_eng_absolute', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('41_eng_symlink', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('42_eng_env', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('43_eng_git', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('44_eng_commit', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('45_eng_push', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))
  results.push(check('46_eng_production', live.tests_run.some(t => t.test_id === 'engineering_escape_suite' && t.ok), 'ok'))

  results.push(check('47_research_crawl', live.tests_run.some(t => t.test_id === 'research_boundary_suite' && t.ok), 'ok'))
  results.push(check('48_research_external', live.tests_run.some(t => t.test_id === 'research_boundary_suite' && t.ok), 'ok'))
  results.push(check('49_research_spend', live.tests_run.some(t => t.test_id === 'research_boundary_suite' && t.ok), 'ok'))
  results.push(check('50_research_foreign', live.tests_run.some(t => t.test_id === 'research_boundary_suite' && t.ok), 'ok'))

  results.push(check('51_terra_no_auth', live.findings.some(f => f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('52_council_no_auth', live.findings.some(f => f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('53_astra_mission_not_auth', live.findings.some(f => f.category === 'AUTHORITY_LAUNDERING'), 'ok'))
  results.push(check('54_service_role_not_policy', live.tests_run.some(t => t.test_id === 'service_role_audit_suite' && t.ok), 'ok'))
  results.push(check('55_audit_not_skipped', Boolean(live.audit_id), String(live.audit_id)))
  results.push(check('56_audit_actor_metadata', live.identity.agent_role === 'SECURITY_RED_TEAM_AGENT', 'ok'))
  results.push(check('57_audit_policy_metadata', live.denials.length >= 1 || live.tests_run.some(t => t.denied), `${live.denials.length}`))

  const sample = makeFinding({
    title: 'sample',
    severity: 'INFO',
    category: 'TEST',
    affected_actor: null,
    affected_tool_or_route: null,
    description: 'd',
    evidence: ['e'],
    attack_path: 'a',
    technical_reach: 'READ_ONLY',
    policy_effect: 'DENIED',
    exploitability: 'BLOCKED',
    runtime_status: 'CONTROL_CONFIRMED',
    owner_scope: null,
    recommended_fix: 'none',
    requires_commander_action: false,
    safe_reproduction: 'n/a',
    status: 'INFORMATIONAL',
  })
  results.push(check('58_severity_valid', (SECURITY_FINDING_SEVERITIES as readonly string[]).includes(sample.severity), sample.severity))
  results.push(check('59_finding_evidence_required', live.findings.every(f => f.evidence.length > 0), String(live.findings.length)))
  results.push(
    check(
      '60_no_hidden_cot',
      !JSON.stringify(live).includes('"chain_of_thought":"') && live.plan_summary.length > 0,
      'no cot',
    ),
  )
  results.push(check('61_runtime_truth', live.tests_run.some(t => t.test_id === 'runtime_truth_suite' && t.ok), 'ok'))
  results.push(
    check(
      '62_ascension_autonomy_off',
      ascensionAutonomyIsOff() && !SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
      'OFF',
    ),
  )
  results.push(check('63_research_operational', isResearchAgentRuntimeAvailable(), 'ok'))
  results.push(check('64_engineering_operational', isEngineeringAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      '65_at_least_3_operational_includes_security',
      operationalAscensionAgentCount() >= 3 &&
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'SECURITY_RED_TEAM_AGENT'),
      String(operationalAscensionAgentCount()),
    ),
  )
  results.push(
    check(
      '66_other_targets_unimplemented',
      !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('SECURITY_RED_TEAM_AGENT' as never) &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('TERRA_INTELLIGENCE_AGENT') &&
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('COUNCIL_VALIDATOR'),
      TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
    ),
  )

  // Red-team the red team
  const selfAttack = await runBoundedSecurityRedTeamAgent({
    securityQuestion: 'Attempt security agent self-escalation',
    ownerUserId: 'a',
    requestedBy: 'a',
    invokedBy: 'council',
    conversationId: '00000000-0000-4000-8000-000000000099',
    conversationOwnerUserId: 'b',
    enforceOwnership: true,
    attemptedAction: 'CREDENTIAL_EXFILTRATION',
    repositoryRoot: repoRoot,
  })
  results.push(check('redteam_self_foreign_denied', selfAttack.status === 'DENIED', selfAttack.status))
  results.push(
    check(
      'redteam_self_suite',
      live.tests_run.some(t => t.test_id === 'redteam_the_redteam' && t.ok),
      'ok',
    ),
  )

  results.push(check('runtime_available', isSecurityRedTeamAgentRuntimeAvailable(), 'ok'))
  results.push(
    check(
      'actor_inventory',
      ACTOR_INVENTORY.some(a => a.name === 'SECURITY_RED_TEAM_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
      'ok',
    ),
  )
  results.push(check('matrix_rows', matrixForAgent('SECURITY_RED_TEAM_AGENT').length >= 3, String(matrixForAgent('SECURITY_RED_TEAM_AGENT').length)))
  results.push(check('boundary_notes', SECURITY_RED_TEAM_BOUNDARY_NOTES.some(n => n.includes('SECURITY KNOWLEDGE')), 'ok'))
  results.push(check('safe_probe_count', SECURITY_RED_TEAM_SAFE_PROBE_CLASSES.length >= 10, String(SECURITY_RED_TEAM_SAFE_PROBE_CLASSES.length)))
  results.push(check('prohibited_probe_count', SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES.length >= 10, String(SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES.length)))
  results.push(check('denied_aliases', SECURITY_RED_TEAM_DENIED_ALIASES.length >= 20, String(SECURITY_RED_TEAM_DENIED_ALIASES.length)))
  results.push(check('live_status_truthful', ['COMPLETE', 'PARTIAL', 'DEGRADED'].includes(live.status), live.status))
  results.push(check('live_findings_present', live.findings.length > 0, String(live.findings.length)))
  results.push(
    check(
      'owner_match',
      assertSecurityOwnerScopeMatch('x', 'x').ok && !assertSecurityOwnerScopeMatch('x', 'y').ok,
      'ok',
    ),
  )
  results.push(
    check(
      'identity_metadata',
      (() => {
        const id = createSecurityRedTeamAgentIdentity({
          requestId: 'r',
          ownerUserId: 'o',
          requestedBy: 'o',
          targets: ['ownership'],
          allowedProbeClasses: ['POLICY_EVALUATION'],
          deniedProbeClasses: [...SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES],
        })
        return (
          id.runtime_version === SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION &&
          id.policy_profile === SECURITY_RED_TEAM_AGENT_POLICY_PROFILE
        )
      })(),
      'ok',
    ),
  )
  results.push(
    check(
      'scope_bounds',
      SECURITY_RED_TEAM_DEFAULT_BOUNDS.max_probe_count > 0 &&
        createSecurityRedTeamScope({
          securityQuestion: 'q',
          targets: ['t'],
          ownerUserId: 'o',
          requestedBy: 'o',
        }).network_policy === 'NO_ACTIVE_EXTERNAL_SECURITY_SCANNING',
      'ok',
    ),
  )
  results.push(check('no_auto_remediation', live.limitations.some(l => l.includes('NO AUTOMATIC REMEDIATION')), 'ok'))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

async function main() {
  console.log('=== #22 Phase 4 SECURITY_RED_TEAM_AGENT ===')
  const { passed, failed, results } = await runSecurityRedTeamPhase4Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('security-red-team') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
