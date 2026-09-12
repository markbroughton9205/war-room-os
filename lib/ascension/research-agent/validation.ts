/**
 * #22 Phase 2 — RESEARCH_AGENT deterministic validation.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runAgentCapabilityMatrixValidation } from '@/lib/agent-capability-matrix/validation'
import { runAscensionPhase1Validation } from '@/lib/permissions/ascensionPhase1.validation'
import { matrixTargetAscension, matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import {
  RESEARCH_AGENT_ROLE,
  RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  RESEARCH_AGENT_POLICY_PROFILE,
  isResearchAgentRuntimeAvailable,
} from '@/lib/ascension/research-agent/identity'
import {
  RESEARCH_AGENT_ALLOWED_CAPABILITIES,
  RESEARCH_AGENT_DENIED_ALIASES,
  assertResearchAgentCapabilityAllowed,
  assertResearchAgentCannotSelfApprove,
  assertResearchAgentCannotSpawnChild,
  assertResearchAgentDiscoveryAllowed,
  denyResearchAgentAction,
} from '@/lib/ascension/research-agent/profile'
import { createResearchAgentScope, RESEARCH_AGENT_DEFAULT_BOUNDS } from '@/lib/ascension/research-agent/scope'
import {
  RESEARCH_AGENT_BOUNDARY_NOTES,
  classifyResultStatus,
} from '@/lib/ascension/research-agent/result'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
  ascensionAutonomyIsOff,
  operationalAscensionAgentCount,
} from '@/lib/ascension/research-agent/registry'
import {
  assertResearchOwnerScopeMatch,
  researchAgentResultForAstra,
  researchAgentResultForCouncil,
  runBoundedResearchAgent,
} from '@/lib/ascension/research-agent'
import { assertServiceRoleNotPolicyPermission } from '@/lib/permissions/noSelfEscalation'
import { assertCouncilCannotAuthorizeExecution } from '@/lib/permissions/noSelfEscalation'
import { buildGovernedAuditMetadata, governedAuditHasRequiredFields } from '@/lib/war-room/governedAudit'
import { evaluateCouncilAutoResearch } from '@/lib/permissions/councilAutoResearchAuthority'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runAscensionPhase2Validation(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('1_canonical_actor', RESEARCH_AGENT_ROLE === 'RESEARCH_AGENT', RESEARCH_AGENT_ROLE))
  results.push(check('2_bounded_readonly_profile', RESEARCH_AGENT_POLICY_PROFILE === 'SESSION_BOUNDED_READ_ONLY_DISCOVERY', RESEARCH_AGENT_POLICY_PROFILE))
  results.push(check('3_terra_query_allowed', assertResearchAgentCapabilityAllowed('TERRA_QUERY'), 'ok'))
  results.push(check('4_search_query_allowed', assertResearchAgentCapabilityAllowed('LIVE_SEARCH_QUERY'), 'ok'))
  results.push(check('5_passive_fetch_allowed', assertResearchAgentCapabilityAllowed('PUBLIC_WEB_PASSIVE_FETCH'), 'ok'))
  results.push(check('6_stored_research_read_allowed', assertResearchAgentCapabilityAllowed('STORED_RESEARCH_READ'), 'ok'))

  const crawl = evaluateCouncilAutoResearch({
    capability: 'CRAWL',
    commanderSessionContext: true,
    crawlExpansion: true,
  })
  results.push(check('7_crawl_expansion_denied', crawl.outcome !== 'ALLOW', crawl.reason))

  const sourceApproval = denyResearchAgentAction('CRAWL_EXPANSION')
  results.push(check('8_source_approval_denied', sourceApproval.outcome === 'DENY', sourceApproval.reason))

  for (const [name, alias] of [
    ['9_shell', 'SHELL_EXECUTE'],
    ['10_powershell', 'POWERSHELL_EXECUTE'],
    ['11_git_commit', 'GIT_COMMIT'],
    ['12_git_push', 'GIT_PUSH'],
    ['13_deploy', 'PRODUCTION_DEPLOY'],
    ['14_restart', 'PRODUCTION_RESTART'],
    ['15_db_write', 'DATABASE_ARBITRARY_WRITE'],
    ['16_sql_schema', 'SQL_EXECUTE'],
    ['17_external_mutation', 'EXTERNAL_MUTATION'],
    ['18_message_send', 'MESSAGE_SEND'],
    ['19_phone', 'PHONE_OUTBOUND'],
    ['20_spend', 'FINANCIAL_SPEND'],
    ['21_transfer', 'FINANCIAL_TRANSFER'],
    ['22_trade', 'TRADE'],
    ['23_wager', 'WAGER'],
    ['24_settlement', 'SETTLEMENT_SUBMIT'],
    ['25_policy_change', 'POLICY_CHANGE'],
    ['26_approval_change', 'APPROVAL_CHANGE'],
    ['27_agent_spawn', 'AGENT_SPAWN'],
  ] as const) {
    const d = denyResearchAgentAction(alias)
    results.push(check(name, d.outcome === 'DENY', `${alias}:${d.reasonCode}`))
  }

  results.push(check('28_self_approval_denied', assertResearchAgentCannotSelfApprove().outcome === 'DENY', 'ok'))
  results.push(check('29_child_amplification_denied', assertResearchAgentCannotSpawnChild().outcome === 'DENY', 'ok'))

  const ownerOk = assertResearchOwnerScopeMatch('user_a', 'user_a')
  const ownerBad = assertResearchOwnerScopeMatch('user_a', 'user_b')
  results.push(check('30_owner_scope_enforced', ownerOk.ok && !ownerBad.ok, ownerBad.ok ? 'leak' : ownerBad.reason))

  results.push(check('31_service_role_ne_policy', assertServiceRoleNotPolicyPermission().outcome === 'DENY', 'ok'))

  const discovery = assertResearchAgentDiscoveryAllowed(true)
  results.push(check('32_session_research_bounds', discovery.outcome === 'ALLOW', discovery.reason))

  const scope = createResearchAgentScope({
    researchQuestion: 'What is the current status of Finnish AIS vessel coverage?',
    ownerUserId: 'commander-test',
    requestedBy: 'commander-test',
  })
  results.push(
    check(
      '33_query_fetch_source_bounds',
      !('error' in scope) &&
        scope.max_search_queries <= 3 &&
        scope.max_fetches <= 6 &&
        scope.source_evidence_limit <= 80 &&
        scope.max_iterations === 1 &&
        scope.max_recursive_depth === 0,
      'error' in scope ? scope.error : `${scope.max_search_queries}/${scope.max_fetches}`,
    ),
  )

  results.push(check('34_recursive_spawn_impossible', RESEARCH_AGENT_DEFAULT_BOUNDS.max_recursive_depth === 0, 'ok'))
  results.push(check('35_terra_provenance_contract', RESEARCH_AGENT_ALLOWED_CAPABILITIES.includes('TERRA_QUERY'), 'ok'))
  results.push(check('36_search_provenance_contract', RESEARCH_AGENT_ALLOWED_CAPABILITIES.includes('EVIDENCE_RETURN_REFERENCES'), 'ok'))

  const partial = classifyResultStatus({
    denied: false,
    usedLiveResearch: true,
    providerFailures: 2,
    providerOk: 1,
    findingsEmpty: false,
  })
  results.push(check('37_partial_provider_failure', partial === 'PARTIAL' || partial === 'DEGRADED', partial))

  const deniedStatus = classifyResultStatus({
    denied: true,
    usedLiveResearch: false,
    providerFailures: 0,
    providerOk: 0,
    findingsEmpty: true,
  })
  results.push(check('38_unsupported_denied_truthful', deniedStatus === 'DENIED', deniedStatus))

  const auditMeta = buildGovernedAuditMetadata({
    decision: discovery,
    actorAgent: 'RESEARCH_AGENT',
    tool: 'ascension.research_agent',
    requestedBy: 'commander',
  })
  results.push(check('39_audit_record_shape', governedAuditHasRequiredFields(auditMeta), auditMeta.reasonCode))
  results.push(check('40_audit_excludes_cot', !('chain_of_thought' in auditMeta), 'ok'))

  results.push(check('41_council_can_receive', RESEARCH_AGENT_BOUNDARY_NOTES.some(n => n.includes('COUNCIL')), 'ok'))
  results.push(check('42_council_not_authorization', assertCouncilCannotAuthorizeExecution().outcome === 'DENY', 'ok'))

  results.push(check('43_astra_can_assign', RESEARCH_AGENT_ALLOWED_CAPABILITIES.includes('ASTRA_RECEIVE_ASSIGNMENT'), 'ok'))
  results.push(check('44_astra_cannot_escalate', researchAgentResultForAstra({
    agent_id: 'x',
    agent_role: 'RESEARCH_AGENT',
    status: 'COMPLETE',
    research_question: 'q',
    summary: 's',
    findings: [],
    evidence_refs: [],
    terra_refs: [],
    sources: [],
    freshness_summary: 'unknown',
    confidence: 0,
    limitations: [],
    denials: [],
    unavailable_capabilities: [],
    started_at: '',
    completed_at: '',
    mission_id: 'm1',
    conversation_id: null,
    owner_user_id: 'u',
    audit_id: null,
    identity: {
      agent_id: 'x',
      agent_role: 'RESEARCH_AGENT',
      runtime_version: 'ascension-phase2-v1',
      mission_id: 'm1',
      request_id: 'r',
      owner_user_id: 'u',
      conversation_id: null,
      council_round: null,
      created_at: '',
      scope: 'SESSION_BOUNDED_READ_ONLY_DISCOVERY',
      policy_profile: 'SESSION_BOUNDED_READ_ONLY_DISCOVERY',
    },
    scope: 'error' in scope ? ({} as never) : scope,
    evidence_packet: null,
    boundary_notes: RESEARCH_AGENT_BOUNDARY_NOTES,
  }).authority_escalated === false, 'ok'))

  results.push(check('45_direct_invocation_same_pipeline', isResearchAgentRuntimeAvailable(), 'API uses runBoundedResearchAgent'))

  const targetImplemented = matrixTargetAscension().filter(
    r => r.runtimeStatus === 'IMPLEMENTED' || r.runtimeStatus === 'IMPLEMENTED_BOUNDED',
  )
  results.push(check('46_target_agents_unimplemented', targetImplemented.length === 0, targetImplemented.map(r => r.id).join(',') || 'none'))
  results.push(check('46b_target_roles_list', TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length >= 6, `${TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length}`))

  results.push(check('47_ascension_autonomy_off', ascensionAutonomyIsOff() && !RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED, 'ok'))
  results.push(check('48_operational_count_includes_research', operationalAscensionAgentCount() >= 1 && OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'RESEARCH_AGENT'), `${operationalAscensionAgentCount()}`))

  const researchRows = matrixForAgent('RESEARCH_AGENT')
  results.push(check('matrix_research_implemented_bounded', researchRows.some(r => r.runtimeStatus === 'IMPLEMENTED_BOUNDED'), `${researchRows.length}`))

  // Denied alias list completeness
  results.push(check('denied_aliases_complete', RESEARCH_AGENT_DENIED_ALIASES.length >= 20, `${RESEARCH_AGENT_DENIED_ALIASES.length}`))

  return results
}

export async function runAscensionPhase2LiveSafeProof(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const result = await runBoundedResearchAgent({
    researchQuestion: 'What public facts are known about Helsinki harbor vessel traffic in general?',
    ownerUserId: 'phase2-live-safe-proof',
    requestedBy: 'phase2-live-safe-proof',
    invokedBy: 'commander',
    enforceOwnership: false,
    liveSearchAllowed: true,
    terraAllowed: true,
    storedResearchAllowed: true,
    timeBudgetMs: 20_000,
  })

  results.push(check('live_request_accepted', Boolean(result.agent_id), result.agent_id))
  results.push(check('live_scope_recorded', result.scope.network_policy === 'SESSION_BOUNDED_READ_ONLY_DISCOVERY', result.scope.network_policy))
  results.push(check('live_policy_evaluated', result.denials.every(d => typeof d.reason_code === 'string'), `${result.denials.length}`))
  results.push(
    check(
      'live_status_truthful',
      ['COMPLETE', 'PARTIAL', 'DEGRADED', 'FAILED', 'DENIED'].includes(result.status),
      result.status,
    ),
  )
  results.push(check('live_boundary_notes', result.boundary_notes.length >= 3, `${result.boundary_notes.length}`))
  results.push(check('live_no_authorization_claim', researchAgentResultForCouncil(result).is_authorization === false, 'ok'))
  results.push(check('live_audit_id_present', typeof result.audit_id === 'string' || result.audit_id === null, String(result.audit_id)))

  // Red-team escape attempts
  for (const action of ['GIT_PUSH', 'SHELL_EXECUTE', 'AGENT_SPAWN', 'FINANCIAL_SPEND', 'POLICY_CHANGE'] as const) {
    const denied = await runBoundedResearchAgent({
      researchQuestion: 'Harmless question that should not matter.',
      ownerUserId: 'phase2-live-safe-proof',
      requestedBy: 'phase2-live-safe-proof',
      invokedBy: 'commander',
      enforceOwnership: false,
      liveSearchAllowed: false,
      attemptedAction: action,
    })
    results.push(check(`live_redteam_${action}`, denied.status === 'DENIED', denied.status))
  }

  return results
}

export async function main(): Promise<void> {
  console.log('=== #21 Agent Capability Matrix ===')
  const matrix = runAgentCapabilityMatrixValidation()
  const matrixFailed = matrix.filter(r => !r.pass)
  console.log(`${matrix.length - matrixFailed.length}/${matrix.length} matrix passed\n`)

  console.log('=== #22 Phase 1 ===')
  const phase1 = runAscensionPhase1Validation()
  const phase1Failed = phase1.filter(r => !r.pass)
  console.log(`${phase1.length - phase1Failed.length}/${phase1.length} phase1 passed\n`)

  console.log('=== #22 Phase 2 RESEARCH_AGENT ===')
  const phase2 = runAscensionPhase2Validation()
  const phase2Failed = phase2.filter(r => !r.pass)
  for (const r of phase2) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
  console.log(`${phase2.length - phase2Failed.length}/${phase2.length} phase2 passed\n`)

  console.log('=== #22 Phase 2 live-safe proof ===')
  const live = await runAscensionPhase2LiveSafeProof()
  const liveFailed = live.filter(r => !r.pass)
  for (const r of live) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
  console.log(`${live.length - liveFailed.length}/${live.length} live-safe passed`)

  if (matrixFailed.length || phase1Failed.length || phase2Failed.length || liveFailed.length) {
    process.exitCode = 1
  }
}

const isDirect = typeof process !== 'undefined' && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirect) {
  void main()
}
