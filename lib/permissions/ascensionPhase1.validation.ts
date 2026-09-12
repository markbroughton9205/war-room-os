/**
 * #22 Phase 1 — deterministic governance hardening validation.
 * Preserves #21 matrix invariants; does not enable Ascension autonomy.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { ASCENSION_AUTONOMY_GUARD } from '@/lib/council/ascension/types'
import { runAgentCapabilityMatrixValidation } from '@/lib/agent-capability-matrix/validation'
import { matrixTargetAscension } from '@/lib/agent-capability-matrix/matrix'
import {
  ALL_CANONICAL_DANGEROUS_KINDS,
  DANGEROUS_ACTION_RULES,
  everyDangerousKindHasRule,
  everyTier4RequiresCommander,
  getEffectiveDangerousPolicy,
  resolveCanonicalDangerousKind,
} from '@/lib/permissions/dangerousActionRegistry'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import {
  assertHttpMutationGoverned,
  assertShellArgvGoverned,
  classifyShellArgv,
} from '@/lib/permissions/equivalentActionGuard'
import {
  assertAstraMissionNotExecutionAuthority,
  assertChildDoesNotExceedParent,
  assertCouncilCannotAuthorizeExecution,
  assertNoSelfApproval,
  assertServiceRoleNotPolicyPermission,
  assertTerraCannotAuthorizeAction,
  noSelfEscalationInvariantsPresent,
} from '@/lib/permissions/noSelfEscalation'
import {
  COUNCIL_AUTO_RESEARCH_AUTHORITY_LABEL,
  evaluateCouncilAutoResearch,
} from '@/lib/permissions/councilAutoResearchAuthority'
import {
  markApprovalEnvelopeConsumed,
  verifyApprovalEnvelope,
  type ApprovalEnvelope,
} from '@/lib/permissions/approvalEnvelope'
import {
  buildGovernedAuditMetadata,
  governedAuditHasRequiredFields,
} from '@/lib/war-room/governedAudit'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function repoFile(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

export function runAscensionPhase1Validation(): CaseResult[] {
  const results: CaseResult[] = []

  // 1–3 classification + authority rules
  results.push(check('dangerous_kinds_classified', ALL_CANONICAL_DANGEROUS_KINDS.length >= 12, `${ALL_CANONICAL_DANGEROUS_KINDS.length}`))
  results.push(check('every_dangerous_kind_has_rule', everyDangerousKindHasRule(), 'ok'))
  results.push(check('every_tier4_requires_commander', everyTier4RequiresCommander(), 'ok'))

  // 4–9 never auto-allow
  for (const kind of ['push', 'deploy', 'financial', 'trade', 'wager', 'settlement_submit'] as const) {
    const policy = getEffectiveDangerousPolicy('commander', kind)
    results.push(check(`${kind}_never_auto_allow`, policy.autoAllowed === false && policy.requiresApproval === true, policy.reason))
  }

  // 10 self-approve
  results.push(check('agent_cannot_self_approve', assertNoSelfApproval('research_agent', 'research_agent')?.outcome === 'DENY', 'ok'))

  // 11 child ceiling
  const childExceed = assertChildDoesNotExceedParent({
    parentReach: 'READ_ONLY',
    childReach: 'FULL_TECHNICAL_REACH',
    parentAuthority: 'READ_ALLOWED',
    childAuthority: 'COMMANDER_ONLY',
  })
  results.push(check('child_cannot_exceed_parent', childExceed?.outcome === 'DENY', childExceed?.reason ?? 'missing'))

  // 12 shell bypass
  const shellPush = assertShellArgvGoverned({
    cmd: 'git',
    args: ['push', 'origin', 'main'],
    mode: 'commander',
    safetyLock: false,
    body: { approval_granted: true },
    commanderSessionOk: true,
  })
  results.push(check('shell_cannot_bypass_git_push', shellPush.outcome === 'DENY', shellPush.reason))
  results.push(check('shell_classifies_git_push', classifyShellArgv('git', ['push', 'origin', 'HEAD']) === 'push', 'ok'))

  // 13 HTTP bypass
  const httpMut = assertHttpMutationGoverned({
    method: 'POST',
    url: 'https://api.stripe.com/v1/charges',
    mode: 'commander',
    safetyLock: false,
    body: { approval_granted: true },
    commanderSessionOk: true,
  })
  results.push(check('http_cannot_bypass_external_mutation', httpMut.outcome === 'DENY', httpMut.reason))

  // 14 service role
  results.push(check('service_role_ne_policy', assertServiceRoleNotPolicyPermission().reasonCode === 'SERVICE_ROLE_NOT_POLICY_PERMISSION', 'ok'))

  // 15–17 boundaries
  results.push(check('terra_cannot_authorize', assertTerraCannotAuthorizeAction().outcome === 'DENY', 'ok'))
  results.push(check('council_cannot_authorize', assertCouncilCannotAuthorizeExecution().outcome === 'DENY', 'ok'))
  results.push(check('astra_mission_ne_execution', assertAstraMissionNotExecutionAuthority().outcome === 'DENY', 'ok'))

  // 18 unknown high-risk fail closed
  const unknown = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: false,
    actionKind: 'mystery_mutation',
    body: {},
    unclassifiedHighImpact: true,
  })
  results.push(check('unknown_high_risk_fail_closed', unknown.outcome === 'DENY' && unknown.reasonCode === 'ACTION_KIND_UNCLASSIFIED', unknown.reason))

  // 19–22 approval envelope
  const baseApproval: ApprovalEnvelope = {
    approvalId: 'appr_1',
    actorId: 'engineering_agent',
    actionKind: 'file_modification',
    target: 'lib/foo.ts',
    missionId: 'm1',
    ownerUserId: 'user_a',
    expiresAt: '2099-01-01T00:00:00.000Z',
    singleUse: true,
    consumedAt: null,
    approvedBy: 'commander',
  }
  const expired = verifyApprovalEnvelope(
    { ...baseApproval, expiresAt: '2000-01-01T00:00:00.000Z' },
    { actorId: 'engineering_agent', actionKind: 'file_modification', target: 'lib/foo.ts', nowIso: '2026-09-12T00:00:00.000Z' },
  )
  results.push(check('expired_approval_fails', expired.reasonCode === 'APPROVAL_EXPIRED', expired.reason))

  const wrongTarget = verifyApprovalEnvelope(baseApproval, {
    actorId: 'engineering_agent',
    actionKind: 'file_modification',
    target: 'lib/other.ts',
    nowIso: '2026-09-12T00:00:00.000Z',
  })
  results.push(check('wrong_target_approval_fails', wrongTarget.reasonCode === 'APPROVAL_SCOPE_MISMATCH', wrongTarget.reason))

  const wrongActor = verifyApprovalEnvelope(baseApproval, {
    actorId: 'other_agent',
    actionKind: 'file_modification',
    target: 'lib/foo.ts',
    nowIso: '2026-09-12T00:00:00.000Z',
  })
  results.push(check('wrong_actor_approval_fails', wrongActor.reasonCode === 'APPROVAL_ACTOR_MISMATCH', wrongActor.reason))

  const consumed = markApprovalEnvelopeConsumed(baseApproval, '2026-09-12T00:00:00.000Z')
  const replay = verifyApprovalEnvelope(consumed, {
    actorId: 'engineering_agent',
    actionKind: 'file_modification',
    target: 'lib/foo.ts',
    nowIso: '2026-09-12T00:01:00.000Z',
  })
  results.push(check('replayed_single_use_fails', replay.reasonCode === 'APPROVAL_REPLAY', replay.reason))

  // 23–24 Council auto-research
  const readOk = evaluateCouncilAutoResearch({
    capability: 'SEARCH',
    commanderSessionContext: true,
  })
  results.push(check('council_auto_research_readonly_usable', readOk.outcome === 'ALLOW', readOk.reason))
  results.push(check('council_auto_research_label', COUNCIL_AUTO_RESEARCH_AUTHORITY_LABEL === 'SESSION_BOUNDED_READ_ONLY_DISCOVERY', COUNCIL_AUTO_RESEARCH_AUTHORITY_LABEL))

  const mutDeny = evaluateCouncilAutoResearch({
    capability: 'SEARCH',
    commanderSessionContext: true,
    externalMutation: true,
  })
  results.push(check('council_auto_research_no_external_mutation', mutDeny.outcome === 'DENY', mutDeny.reason))

  const crawlDeny = evaluateCouncilAutoResearch({
    capability: 'CRAWL',
    commanderSessionContext: true,
    crawlExpansion: true,
  })
  results.push(check('council_auto_research_no_crawl_expansion', crawlDeny.outcome !== 'ALLOW', crawlDeny.reason))

  // 25 audit metadata
  const meta = buildGovernedAuditMetadata({
    decision: readOk,
    requestedBy: 'commander',
    actorAgent: 'council',
    tool: 'runLiveResearchRouter',
    target: 'search',
  })
  results.push(check('audit_metadata_required_fields', governedAuditHasRequiredFields(meta), meta.reasonCode))

  // 26 CURRENT vs TARGET intact
  results.push(check('target_rows_not_implemented', matrixTargetAscension().every(r => r.runtimeStatus !== 'IMPLEMENTED'), 'ok'))

  // Ascension remains off + no new agents
  results.push(check('ascension_autonomy_off', ASCENSION_AUTONOMY_GUARD.selfModificationEnabled === false, 'selfModificationEnabled'))
  results.push(check('ascension_production_edit_off', ASCENSION_AUTONOMY_GUARD.productionEditEnabled === false, 'productionEditEnabled'))
  results.push(check('no_self_escalation_invariants', noSelfEscalationInvariantsPresent(), 'ok'))

  // Wiring evidence in repo
  const permissionsUpdate = repoFile('app/api/permissions/update/route.ts')
  results.push(check('permissions_update_commander_gated', permissionsUpdate.includes('requireCommanderSession') && permissionsUpdate.includes('policy_change'), 'ok'))
  const incomeScout = repoFile('app/api/income/scout/route.ts')
  results.push(check('income_scout_policy_wired', incomeScout.includes('assertAutoOrApproval') && incomeScout.includes('internet_research'), 'ok'))
  const economic = repoFile('app/api/economic/command/route.ts')
  results.push(check('economic_command_policy_wired', economic.includes('assertAutoOrApproval'), 'ok'))
  const researchRouter = repoFile('lib/research/researchRouter.ts')
  results.push(check('research_router_gate_b', researchRouter.includes('evaluateCouncilAutoResearch'), 'ok'))
  const validationRunner = repoFile('lib/native-builder/validationRunner.ts')
  results.push(check('validation_runner_shell_guard', validationRunner.includes('assertResolvedArgvNotDangerousEquivalent'), 'ok'))

  // Alias resolution
  results.push(check('alias_git_push', resolveCanonicalDangerousKind('GIT_PUSH') === 'push', 'ok'))
  results.push(check('alias_trade', resolveCanonicalDangerousKind('TRADE') === 'trade', 'ok'))

  // push/deploy deny even with approval (structural)
  const pushDeny = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: false,
    actionKind: 'push',
    body: { approval_granted: true },
    commanderSessionOk: true,
  })
  results.push(check('push_structurally_unreachable', pushDeny.outcome === 'DENY', pushDeny.reason))

  const deployDeny = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: false,
    actionKind: 'deploy',
    body: { approval_granted: true },
    commanderSessionOk: true,
  })
  results.push(check('deploy_structurally_unreachable', deployDeny.outcome === 'DENY', deployDeny.reason))

  // Rules cover all kinds
  results.push(check('rules_count_matches_kinds', Object.keys(DANGEROUS_ACTION_RULES).length === ALL_CANONICAL_DANGEROUS_KINDS.length, `${Object.keys(DANGEROUS_ACTION_RULES).length}`))

  return results
}

export function main(): void {
  console.log('=== #21 Agent Capability Matrix (preserved) ===')
  const matrix = runAgentCapabilityMatrixValidation()
  const matrixFailed = matrix.filter(r => !r.pass)
  for (const r of matrix) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
  console.log(`${matrix.length - matrixFailed.length}/${matrix.length} matrix passed\n`)

  console.log('=== #22 Phase 1 Governance Hardening ===')
  const phase1 = runAscensionPhase1Validation()
  const failed = phase1.filter(r => !r.pass)
  for (const r of phase1) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
  console.log(`\n${phase1.length - failed.length}/${phase1.length} phase1 passed`)

  if (matrixFailed.length > 0 || failed.length > 0) process.exitCode = 1
}

const isDirect = typeof process !== 'undefined' && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirect) {
  main()
}
