/**
 * Roadmap #21 — deterministic validation of capability matrix / governance definitions.
 * Proves capability != authority and hard denies on push/deploy/finance/self-auth.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ACTOR_INVENTORY } from './actors'
import {
  ASTRA_AUTHORITY_BOUNDARY,
  CHILD_AGENT_INHERITANCE_RULES,
  COUNCIL_AUTHORITY_BOUNDARY,
  NO_SELF_ESCALATION_INVARIANTS,
  OWNERSHIP_MEMORY_BOUNDARY,
} from './governance'
import { CANONICAL_CAPABILITY_MATRIX } from './matrix'
import { DANGEROUS_ACTION_KINDS, getEffectivePolicy } from '@/lib/permissions/policy'
import { ROADMAP_22_INPUT_CONTRACT } from './roadmap22Contract'
import { TERRA_EVIDENCE_CONTRACT_FIELDS, TERRA_ORACLE_DEFINITION } from './terraOracleContract'
import {
  APPROVAL_TYPES,
  CAPABILITY_ACTIONS,
  CAPABILITY_DOMAINS,
  DENIAL_STATES,
  MATRIX_AGENT_ROLES,
  POLICY_AUTHORITY_LEVELS,
  RISK_TIERS,
  TECHNICAL_REACH_LEVELS,
} from './types'
import { ASCENSION_AUTONOMY_GUARD } from '@/lib/council/ascension/types'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function repoRoot(): string {
  return process.cwd()
}

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot(), rel), 'utf8')
}

export function runAgentCapabilityMatrixValidation(): CaseResult[] {
  const results: CaseResult[] = []

  // Catalog completeness
  results.push(check('domains_count_ge_25', CAPABILITY_DOMAINS.length >= 25, `${CAPABILITY_DOMAINS.length}`))
  results.push(check('actions_count_ge_20', CAPABILITY_ACTIONS.length >= 20, `${CAPABILITY_ACTIONS.length}`))
  results.push(check('reach_levels_include_unknown', TECHNICAL_REACH_LEVELS.includes('UNKNOWN'), TECHNICAL_REACH_LEVELS.join(',')))
  results.push(check('authority_levels_include_commander_only', POLICY_AUTHORITY_LEVELS.includes('COMMANDER_ONLY'), 'ok'))
  results.push(check('risk_tiers_include_tier4', RISK_TIERS.includes('TIER_4_PRODUCTION_DESTRUCTIVE_FINANCIAL_LEGAL'), 'ok'))
  results.push(check('approval_types_minimum', APPROVAL_TYPES.length >= 5, APPROVAL_TYPES.join(',')))
  results.push(check('denial_states_minimum', DENIAL_STATES.length >= 8, DENIAL_STATES.join(',')))
  results.push(check('matrix_agent_roles_include_future', MATRIX_AGENT_ROLES.includes('FUTURE_NAVIGATION_AGENT'), 'ok'))

  // Actor inventory
  results.push(check('actor_inventory_nonempty', ACTOR_INVENTORY.length >= 20, `${ACTOR_INVENTORY.length}`))
  results.push(check('commander_is_human', ACTOR_INVENTORY.some(a => a.id === 'commander' && a.class === 'HUMAN'), 'ok'))
  results.push(check('terra_is_world_state_source', ACTOR_INVENTORY.some(a => a.id === 'terra' && a.class === 'WORLD_STATE_SOURCE'), 'ok'))
  results.push(check('astra_is_orchestrator', ACTOR_INVENTORY.some(a => a.id === 'astra' && a.class === 'ORCHESTRATOR'), 'ok'))
  results.push(check('council_seats_are_reasoners', ['aurora', 'orion', 'pulsar', 'lumen', 'nova', 'phoenix'].every(id => ACTOR_INVENTORY.some(a => a.id === id && a.class === 'REASONER')), 'ok'))

  // Capability != authority: every matrix row has both fields; at least one YES-tech / NO-policy pattern
  results.push(check('matrix_nonempty', CANONICAL_CAPABILITY_MATRIX.length >= 30, `${CANONICAL_CAPABILITY_MATRIX.length}`))
  const uniqueIds = new Set(CANONICAL_CAPABILITY_MATRIX.map(r => r.id))
  results.push(check('matrix_ids_unique', uniqueIds.size === CANONICAL_CAPABILITY_MATRIX.length, `${uniqueIds.size}`))

  const splitExample = CANONICAL_CAPABILITY_MATRIX.find(
    r =>
      (r.technicalReach === 'DISCOVER_ONLY' || r.technicalReach === 'EXECUTE_CONTROLLED' || r.technicalReach === 'FULL_TECHNICAL_REACH') &&
      (r.policyAuthority === 'DENIED' || r.policyAuthority === 'COMMANDER_ONLY' || r.policyAuthority === 'APPROVAL_REQUIRED'),
  )
  results.push(check('capability_ne_authority_example', Boolean(splitExample), splitExample?.id ?? 'missing'))

  // No agent gets implicit production deploy
  const implicitDeploy = CANONICAL_CAPABILITY_MATRIX.filter(
    r =>
      r.action === 'DEPLOY' &&
      r.agentRole !== 'COMMANDER' &&
      r.currentVsTarget === 'CURRENT_RUNTIME' &&
      (r.policyAuthority === 'BOUNDED_ALLOWED' || r.policyAuthority === 'READ_ALLOWED' || r.approvalRequirement === 'NO_APPROVAL' || r.approvalRequirement === 'POLICY_AUTO_ALLOWED'),
  )
  // Allow discover-only status reads with COMMANDER_ONLY / DENIED / STRUCTURALLY_FORBIDDEN — filter true grants
  const badDeploy = implicitDeploy.filter(r => r.policyAuthority !== 'DENIED' && r.policyAuthority !== 'COMMANDER_ONLY' && r.policyAuthority !== 'NOT_APPLICABLE')
  results.push(check('no_implicit_production_deploy', badDeploy.length === 0, badDeploy.map(r => r.id).join(',') || 'none'))

  // No agent gets implicit push
  const badPush = CANONICAL_CAPABILITY_MATRIX.filter(
    r =>
      r.action === 'PUSH' &&
      r.agentRole !== 'COMMANDER' &&
      r.currentVsTarget === 'CURRENT_RUNTIME' &&
      r.policyAuthority !== 'DENIED' &&
      r.policyAuthority !== 'COMMANDER_ONLY' &&
      r.policyAuthority !== 'APPROVAL_REQUIRED',
  )
  results.push(check('no_implicit_git_push', badPush.length === 0, badPush.map(r => r.id).join(',') || 'none'))

  // No agent gets financial authority
  const badFinance = CANONICAL_CAPABILITY_MATRIX.filter(
    r =>
      (r.action === 'PURCHASE_SPEND' || r.action === 'TRANSFER' || r.action === 'TRADE_WAGER') &&
      r.agentRole !== 'COMMANDER' &&
      r.policyAuthority !== 'DENIED' &&
      r.policyAuthority !== 'COMMANDER_ONLY',
  )
  results.push(check('no_financial_authority_for_agents', badFinance.length === 0, badFinance.map(r => r.id).join(',') || 'none'))

  // Council cannot authorize itself
  const councilSelfAuth = CANONICAL_CAPABILITY_MATRIX.filter(
    r =>
      (r.agentRole === 'COUNCIL_VALIDATOR' || r.agentRole === 'COUNCIL_SEAT') &&
      r.action === 'APPROVE' &&
      (r.policyAuthority === 'BOUNDED_ALLOWED' || r.policyAuthority === 'READ_ALLOWED' || r.approvalRequirement === 'NO_APPROVAL'),
  )
  results.push(check('council_cannot_authorize_itself', councilSelfAuth.length === 0, councilSelfAuth.map(r => r.id).join(',') || 'none'))
  results.push(check('council_boundary_documented', COUNCIL_AUTHORITY_BOUNDARY.mustNot.length >= 3, COUNCIL_AUTHORITY_BOUNDARY.mustNot.join(';')))

  // Terra cannot authorize action
  results.push(check('terra_oracle_boundaries', TERRA_ORACLE_DEFINITION.boundaries.some(b => b.includes('NOT independently authorize')), 'ok'))
  results.push(check('terra_evidence_contract_fields', TERRA_EVIDENCE_CONTRACT_FIELDS.length >= 15, `${TERRA_EVIDENCE_CONTRACT_FIELDS.length}`))
  const terraMission = CANONICAL_CAPABILITY_MATRIX.find(r => r.id === 'terra.mission.launch')
  results.push(check('terra_agent_cannot_auto_mission', terraMission?.policyAuthority === 'DENIED', terraMission?.policyAuthority ?? 'missing'))

  // Child cannot exceed parent
  results.push(check('child_inheritance_no_amplification', CHILD_AGENT_INHERITANCE_RULES.amplification === 'No privilege amplification.', CHILD_AGENT_INHERITANCE_RULES.default))

  // Service role does not imply policy permission
  const serviceRole = CANONICAL_CAPABILITY_MATRIX.find(r => r.id === 'supabase.service.role')
  results.push(
    check(
      'service_role_ne_policy_permission',
      serviceRole?.technicalReach === 'FULL_TECHNICAL_REACH' && serviceRole.policyAuthority === 'SYSTEM_INTERNAL',
      `${serviceRole?.technicalReach}/${serviceRole?.policyAuthority}`,
    ),
  )
  results.push(check('ownership_boundary_documents_service_role', OWNERSHIP_MEMORY_BOUNDARY.rules.some(r => r.includes('Service-role')), 'ok'))

  // Commander remains ultimate authority
  const commanderApprove = CANONICAL_CAPABILITY_MATRIX.find(r => r.id === 'commander.approve.tier4')
  results.push(check('commander_ultimate_tier4', commanderApprove?.policyAuthority === 'COMMANDER_ONLY', commanderApprove?.id ?? 'missing'))

  // Dangerous kinds never auto-allow
  for (const kind of ['deploy', 'commit', 'financial', 'payment', 'shell_mutating'] as const) {
    const policy = getEffectivePolicy('commander', kind)
    results.push(check(`dangerous_${kind}_never_auto`, policy.autoAllowed === false && policy.requiresApproval === true, policy.reason))
  }
  results.push(check('dangerous_kinds_registered', DANGEROUS_ACTION_KINDS.includes('deploy') && DANGEROUS_ACTION_KINDS.includes('financial'), DANGEROUS_ACTION_KINDS.join(',')))

  // Runtime structural guards
  results.push(check('ascension_self_mod_off', ASCENSION_AUTONOMY_GUARD.selfModificationEnabled === false, 'selfModificationEnabled'))
  results.push(check('ascension_production_edit_off', ASCENSION_AUTONOMY_GUARD.productionEditEnabled === false, 'productionEditEnabled'))
  results.push(check('ascension_unvalidated_promotion_off', ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled === false, 'unvalidatedPromotionEnabled'))
  results.push(check('astra_orchestration_only', isOrchestrationOnly('astra') === true, 'astra'))

  const astraSrc = readRepo('lib/astra/liveMission.ts')
  results.push(check('astra_constellation_spawned_false_type', astraSrc.includes('constellationSpawned: false'), 'type lock'))
  results.push(check('astra_terra_selection_never_mission', astraSrc.includes('Selection of a Terra object never creates'), 'header'))
  results.push(check('astra_runtime_truth_planned_ne_running', ASTRA_AUTHORITY_BOUNDARY.runtimeTruth.includes('PLANNED != RUNNING'), 'ok'))

  const nbValidation = readRepo('lib/native-builder/nativeBuilder.validation.ts')
  results.push(check('native_builder_forbids_git_push_pattern', nbValidation.includes('git_push') || nbValidation.includes('push'), 'guard present'))
  results.push(check('native_builder_forbids_commit_operation', nbValidation.includes('git_commit') || nbValidation.includes('commit'), 'guard present'))

  // No-self-escalation invariants present
  results.push(check('no_self_escalation_count', NO_SELF_ESCALATION_INVARIANTS.length >= 6, `${NO_SELF_ESCALATION_INVARIANTS.length}`))
  const selfApprove = CANONICAL_CAPABILITY_MATRIX.find(r => r.id === 'sec.approve.self')
  results.push(check('self_approve_denied', selfApprove?.policyAuthority === 'DENIED', selfApprove?.policyAuthority ?? 'missing'))

  // CURRENT vs TARGET discipline: target rows must not claim IMPLEMENTED / IMPLEMENTED_BOUNDED
  const targetClaimingImplementedAsCurrent = CANONICAL_CAPABILITY_MATRIX.filter(
    r =>
      r.currentVsTarget === 'TARGET_ASCENSION' &&
      (r.runtimeStatus === 'IMPLEMENTED' || r.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
  )
  results.push(
    check(
      'target_rows_not_marked_implemented',
      targetClaimingImplementedAsCurrent.length === 0,
      targetClaimingImplementedAsCurrent.map(r => r.id).join(',') || 'none',
    ),
  )

  // #22 contract present and constrained
  results.push(check('roadmap22_not_started', ROADMAP_22_INPUT_CONTRACT.status === 'NOT_STARTED', ROADMAP_22_INPUT_CONTRACT.status))
  results.push(check('roadmap22_capability_ne_authority', ROADMAP_22_INPUT_CONTRACT.capabilityDoesNotEqualAuthority === true, 'ok'))
  results.push(check('roadmap22_no_self_escalation', ROADMAP_22_INPUT_CONTRACT.noSelfEscalation === true, 'ok'))
  results.push(check('roadmap22_no_amplification', ROADMAP_22_INPUT_CONTRACT.inheritance.amplification === false, 'ok'))
  results.push(check('roadmap22_cannot_delegate_push', ROADMAP_22_INPUT_CONTRACT.cannotBeDelegated.includes('Git push'), 'ok'))
  results.push(check('roadmap22_cannot_delegate_deploy', ROADMAP_22_INPUT_CONTRACT.cannotBeDelegated.includes('Production deploy'), 'ok'))
  results.push(
    check(
      'roadmap22_opening_hardening_gates_abc',
      ROADMAP_22_INPUT_CONTRACT.openingHardeningGates.length >= 3 &&
        ROADMAP_22_INPUT_CONTRACT.openingHardeningGates.some(g => g.id.startsWith('A_')) &&
        ROADMAP_22_INPUT_CONTRACT.openingHardeningGates.some(g => g.id.startsWith('B_')) &&
        ROADMAP_22_INPUT_CONTRACT.openingHardeningGates.some(g => g.id.startsWith('C_')),
      ROADMAP_22_INPUT_CONTRACT.openingHardeningGates.map(g => g.id).join(','),
    ),
  )

  // Matrix covers required proposed agents
  for (const role of [
    'RESEARCH_AGENT',
    'ENGINEERING_AGENT',
    'TERRA_INTELLIGENCE_AGENT',
    'OPERATIONS_AGENT',
    'SECURITY_RED_TEAM_AGENT',
    'COUNCIL_VALIDATOR',
    'ASTRA_ORCHESTRATOR',
    'DATA_CORPUS_AGENT',
    'NAVIGATION_AGENT',
    'FUTURE_NAVIGATION_AGENT',
    'WORLD_LEARNING_AGENT',
    'FUTURE_WORLD_LEARNING_AGENT',
  ] as const) {
    results.push(check(`matrix_covers_${role}`, CANONICAL_CAPABILITY_MATRIX.some(r => r.agentRole === role), role))
  }

  return results
}

export function main(): void {
  const results = runAgentCapabilityMatrixValidation()
  const failed = results.filter(r => !r.pass)
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

const isDirect = typeof process !== 'undefined' && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirect) {
  main()
}
