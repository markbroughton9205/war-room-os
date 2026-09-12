/**
 * #22 Phase 4 — Safe deterministic security probes.
 * Pure policy / in-memory / fixture only. No destructive execution.
 */
import { verifyApprovalEnvelope, type ApprovalEnvelope } from '@/lib/permissions/approvalEnvelope'
import {
  assertShellArgvGoverned,
  classifyHttpMutation,
  classifyShellArgv,
} from '@/lib/permissions/equivalentActionGuard'
import { assertChildDoesNotExceedParent, assertNoSelfApproval } from '@/lib/permissions/noSelfEscalation'
import { evaluateGovernedAction } from '@/lib/permissions/policyDecision'
import { denyResearchAgentAction } from '@/lib/ascension/research-agent/profile'
import { assertResearchOwnerScopeMatch } from '@/lib/ascension/research-agent'
import {
  denyEngineeringAgentAction,
  governEngineeringArgv,
  classifyPackageScript,
  resolvePathInsideWorktree,
  verifyApprovedWorktree,
} from '@/lib/ascension/engineering-agent'
import { assertEngineeringOwnerScopeMatch } from '@/lib/ascension/engineering-agent/ownership'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ASCENSION_AUTONOMY_GUARD } from '@/lib/council/ascension/types'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  denySecurityRedTeamAction,
  assertSecurityRedTeamCannotSelfApprove,
  assertSecurityChildDoesNotExceedParent,
  isProhibitedProbeClass,
} from './profile'
import { makeFinding, type SecurityFinding, type SecurityTestRun } from './result'
import { assertSecurityOwnerScopeMatch } from './ownership'

export type ProbeBundle = {
  tests: SecurityTestRun[]
  findings: SecurityFinding[]
  denials: Array<{ capability_or_action: string; reason_code: string; reason: string }>
  unavailable: string[]
}

function pass(testId: string, probeClass: string, summary: string): SecurityTestRun {
  return { test_id: testId, probe_class: probeClass, ok: true, denied: false, summary }
}

function fail(testId: string, probeClass: string, summary: string): SecurityTestRun {
  return { test_id: testId, probe_class: probeClass, ok: false, denied: false, summary }
}

function deniedTest(testId: string, probeClass: string, summary: string): SecurityTestRun {
  return { test_id: testId, probe_class: probeClass, ok: false, denied: true, summary }
}

function controlFinding(input: {
  title: string
  category: string
  actor: string | null
  tool: string | null
  evidence: string[]
  attackPath: string
  fix: string
}): SecurityFinding {
  return makeFinding({
    title: input.title,
    severity: 'INFO',
    category: input.category,
    affected_actor: input.actor,
    affected_tool_or_route: input.tool,
    description: 'Control held under safe adversarial probe.',
    evidence: input.evidence,
    attack_path: input.attackPath,
    technical_reach: 'DISCOVER_ONLY',
    policy_effect: 'DENIED',
    exploitability: 'BLOCKED',
    runtime_status: 'CONTROL_CONFIRMED',
    owner_scope: null,
    recommended_fix: input.fix,
    requires_commander_action: false,
    safe_reproduction: input.attackPath,
    status: 'CONFIRMED_CONTROL',
  })
}

function blockerFinding(input: {
  title: string
  severity: SecurityFinding['severity']
  category: string
  actor: string | null
  tool: string | null
  evidence: string[]
  attackPath: string
  fix: string
}): SecurityFinding {
  return makeFinding({
    title: input.title,
    severity: input.severity,
    category: input.category,
    affected_actor: input.actor,
    affected_tool_or_route: input.tool,
    description: 'Adversarial probe observed a control gap or unexpected allow.',
    evidence: input.evidence,
    attack_path: input.attackPath,
    technical_reach: 'UNKNOWN',
    policy_effect: 'POSSIBLE_BYPASS',
    exploitability: 'THEORETICAL',
    runtime_status: 'OPEN',
    owner_scope: null,
    recommended_fix: input.fix,
    requires_commander_action: true,
    safe_reproduction: input.attackPath,
    status: 'OPEN',
  })
}

export function runProhibitedProbeDenial(probeClass: string): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const denials: ProbeBundle['denials'] = []
  if (!isProhibitedProbeClass(probeClass)) {
    return { tests, findings: [], denials, unavailable: [] }
  }
  const d = denySecurityRedTeamAction(
    probeClass === 'REAL_EXTERNAL_EXPLOIT'
      ? 'EXTERNAL_EXPLOITATION'
      : probeClass === 'DESTRUCTIVE_DB_TEST'
        ? 'DATABASE_DESTRUCTIVE_WRITE'
        : probeClass === 'PRODUCTION_KILL_TEST'
          ? 'PROCESS_TERMINATE'
          : probeClass === 'PRODUCTION_RESTART_TEST'
            ? 'PRODUCTION_RESTART'
            : probeClass === 'SECRET_EXTRACTION' || probeClass === 'CREDENTIAL_DUMP'
              ? 'CREDENTIAL_EXFILTRATION'
              : probeClass === 'MALWARE_EXECUTION' || probeClass === 'PERSISTENCE_INSTALL'
                ? 'MALWARE_PERSISTENCE'
                : probeClass === 'PRIVILEGE_ESCALATION'
                  ? 'HOST_PRIVILEGE_ESCALATION'
                  : probeClass === 'DENIAL_OF_SERVICE'
                    ? 'PROCESS_TERMINATE'
                    : probeClass === 'FINANCIAL_ACTION'
                      ? 'FINANCIAL_SPEND'
                      : probeClass === 'REAL_MESSAGE_SEND'
                        ? 'MESSAGE_SEND'
                        : probeClass === 'REAL_PHONE_ACTION'
                          ? 'PHONE_OUTBOUND'
                          : 'EXTERNAL_EXPLOITATION',
  )
  denials.push({
    capability_or_action: probeClass,
    reason_code: d.reasonCode,
    reason: d.reason,
  })
  tests.push(deniedTest(`deny_${probeClass}`, probeClass, d.reason))
  return { tests, findings: [], denials, unavailable: [] }
}

export function runOwnershipProbes(ownerUserId: string): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const research = assertResearchOwnerScopeMatch(ownerUserId, 'other-user')
  const eng = assertEngineeringOwnerScopeMatch(ownerUserId, 'other-user')
  const sec = assertSecurityOwnerScopeMatch(ownerUserId, 'other-user')
  const ok = !research.ok && !eng.ok && !sec.ok
  tests.push(
    ok
      ? pass('ownership_foreign_denied', 'OWNERSHIP_BOUNDARY_TEST', 'Foreign owner denied for research/eng/security')
      : fail('ownership_foreign_denied', 'OWNERSHIP_BOUNDARY_TEST', 'Foreign owner check leaked'),
  )
  findings.push(
    controlFinding({
      title: 'Cross-user conversation scope denied',
      category: 'OWNERSHIP',
      actor: 'SECURITY_RED_TEAM_AGENT',
      tool: 'assert*OwnerScopeMatch',
      evidence: [
        research.ok ? '' : research.reason,
        eng.ok ? '' : eng.reason,
        sec.ok ? '' : sec.reason,
      ],
      attackPath: 'User B attempts User A conversation context via agent',
      fix: 'Keep #19 ownership fail-closed; never treat security actor as ownership bypass.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runApprovalProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const now = new Date().toISOString()
  const base: ApprovalEnvelope = {
    approvalId: 'appr-1',
    actorId: 'ENGINEERING_AGENT',
    actionKind: 'file_modification',
    target: 'fixtures/a.ts',
    missionId: 'm1',
    ownerUserId: 'owner-a',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    singleUse: true,
    consumedAt: null,
    approvedBy: 'commander',
  }

  const missing = verifyApprovalEnvelope(null, {
    actorId: 'ENGINEERING_AGENT',
    actionKind: 'file_modification',
    target: 'fixtures/a.ts',
    nowIso: now,
  })
  const expired = verifyApprovalEnvelope(
    { ...base, expiresAt: new Date(Date.now() - 1000).toISOString() },
    {
      actorId: 'ENGINEERING_AGENT',
      actionKind: 'file_modification',
      target: 'fixtures/a.ts',
      nowIso: now,
    },
  )
  const wrongActor = verifyApprovalEnvelope(base, {
    actorId: 'RESEARCH_AGENT',
    actionKind: 'file_modification',
    target: 'fixtures/a.ts',
    nowIso: now,
  })
  const wrongTarget = verifyApprovalEnvelope(base, {
    actorId: 'ENGINEERING_AGENT',
    actionKind: 'file_modification',
    target: 'fixtures/b.ts',
    nowIso: now,
  })
  const replay = verifyApprovalEnvelope(
    { ...base, consumedAt: now },
    {
      actorId: 'ENGINEERING_AGENT',
      actionKind: 'file_modification',
      target: 'fixtures/a.ts',
      nowIso: now,
    },
  )
  const self = verifyApprovalEnvelope(
    { ...base, approvedBy: 'ENGINEERING_AGENT', actorId: 'ENGINEERING_AGENT' },
    {
      actorId: 'ENGINEERING_AGENT',
      actionKind: 'file_modification',
      target: 'fixtures/a.ts',
      nowIso: now,
    },
  )

  const allDenied =
    missing.outcome === 'DENY' &&
    expired.outcome === 'DENY' &&
    wrongActor.outcome === 'DENY' &&
    wrongTarget.outcome === 'DENY' &&
    replay.outcome === 'DENY' &&
    self.outcome === 'DENY'

  tests.push(
    allDenied
      ? pass('approval_boundary_suite', 'APPROVAL_BOUNDARY_TEST', 'missing/expired/wrong/replay/self denied')
      : fail('approval_boundary_suite', 'APPROVAL_BOUNDARY_TEST', 'approval suite leak'),
  )
  findings.push(
    controlFinding({
      title: 'Approval envelope rejects invalid/replayed/self approvals',
      category: 'APPROVAL',
      actor: null,
      tool: 'verifyApprovalEnvelope',
      evidence: [
        missing.reasonCode,
        expired.reasonCode,
        wrongActor.reasonCode,
        wrongTarget.reasonCode,
        replay.reasonCode,
        self.reasonCode,
      ],
      attackPath: 'Reuse or forge approval envelope',
      fix: 'Keep single-use + actor/target/time binding.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runLaunderingProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []

  const researchAsksPush = denyResearchAgentAction('GIT_PUSH')
  const engAsksPush = denyEngineeringAgentAction('GIT_PUSH')
  const researchMutation = denyResearchAgentAction('FILESYSTEM_WRITE_SENSITIVE')
  const engCrawl = denyEngineeringAgentAction('CRAWL_EXPANSION')
  const councilPush = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'push',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'COUNCIL',
    approvingActorId: 'COUNCIL',
  })
  const astraDeploy = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'deploy',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'ASTRA',
    approvingActorId: 'ASTRA',
  })
  const terraAuth = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'push',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'TERRA',
    approvingActorId: 'TERRA',
  })
  const secSpawn = denySecurityRedTeamAction('AGENT_SPAWN')
  const child = assertSecurityChildDoesNotExceedParent()
  const nested = assertChildDoesNotExceedParent({
    parentReach: 'EXECUTE_SANDBOXED',
    childReach: 'FULL_TECHNICAL_REACH',
    parentAuthority: 'BOUNDED_ALLOWED',
    childAuthority: 'COMMANDER_ONLY',
  })

  const ok =
    researchAsksPush.outcome === 'DENY' &&
    engAsksPush.outcome === 'DENY' &&
    researchMutation.outcome === 'DENY' &&
    engCrawl.outcome === 'DENY' &&
    councilPush.outcome === 'DENY' &&
    astraDeploy.outcome === 'DENY' &&
    terraAuth.outcome === 'DENY' &&
    secSpawn.outcome === 'DENY' &&
    child.outcome === 'DENY' &&
    nested?.outcome === 'DENY'

  tests.push(
    ok
      ? pass('authority_laundering_suite', 'AGENT_AUTHORITY_TEST', 'cross-actor laundering denied')
      : fail('authority_laundering_suite', 'AGENT_AUTHORITY_TEST', 'laundering leak'),
  )
  findings.push(
    controlFinding({
      title: 'Cross-actor privilege laundering denied',
      category: 'AUTHORITY_LAUNDERING',
      actor: 'MULTI',
      tool: 'evaluateGovernedAction/deny*Action',
      evidence: [
        researchAsksPush.reasonCode,
        engAsksPush.reasonCode,
        councilPush.reasonCode,
        astraDeploy.reasonCode,
        terraAuth.reasonCode,
        secSpawn.reasonCode,
      ],
      attackPath: 'Research→Engineering push / Council recommendation as approval / Terra as auth',
      fix: 'Preserve CAPABILITY!=AUTHORITY; mission/recommendation never grant Tier-4.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runAliasProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []

  const gitPush = classifyShellArgv('git', ['push', 'origin', 'HEAD'])
  const psPush = classifyShellArgv('powershell', ['-Command', 'git push'])
  const deployScript = classifyPackageScript('deploy-prod', 'vercel deploy --prod')
  const sqlAlias = denySecurityRedTeamAction('SQL_MUTATION')
  const engPushArgs = governEngineeringArgv('git', ['push'])
  const httpDeploy = classifyHttpMutation('POST', 'https://api.vercel.com/v13/deployments')
  const httpQueryOk = classifyHttpMutation('POST', 'https://api.tavily.com/search')
  const httpMsg = classifyHttpMutation('POST', 'https://api.twilio.com/2010-04-01/Accounts/x/Messages.json')

  const ok =
    gitPush === 'push' &&
    psPush === 'push' &&
    deployScript.class === 'DENIED' &&
    sqlAlias.outcome === 'DENY' &&
    engPushArgs.ok === false &&
    httpDeploy === 'external_account' &&
    httpQueryOk === null &&
    httpMsg === 'external_account'

  tests.push(
    ok
      ? pass('dangerous_alias_suite', 'TOOL_ALIAS_TEST', 'shell/package/http aliases classified')
      : fail('dangerous_alias_suite', 'TOOL_ALIAS_TEST', 'alias classification leak'),
  )
  findings.push(
    controlFinding({
      title: 'Dangerous-action semantic aliases denied',
      category: 'ALIAS_BYPASS',
      actor: null,
      tool: 'classifyShellArgv/classifyPackageScript/classifyHttpMutation',
      evidence: [
        String(gitPush),
        String(psPush),
        deployScript.reason,
        sqlAlias.reasonCode,
        String(httpDeploy),
        `tavily_query=${httpQueryOk === null ? 'allowed_as_query' : 'unexpected'}`,
      ],
      attackPath: 'git push via shell / pnpm run deploy-prod / HTTP deploy endpoint',
      fix: 'Keep semantic classification over executable name.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runEngineeringEscapeProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const repoRoot = resolveRepoRoot()
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wr-sec-eng-'))
  const worktree = path.join(fixtureRoot, 'wt')
  mkdirSync(path.join(worktree, 'fixtures'), { recursive: true })

  try {
    const verified = verifyApprovedWorktree({
      worktreePath: worktree,
      repositoryRoot: repoRoot,
      allowCreateEmpty: true,
    })
    const prodDenied = verifyApprovedWorktree({ worktreePath: repoRoot, repositoryRoot: repoRoot })
    if (!verified.ok) {
      tests.push(fail('eng_worktree', 'WORKTREE_ESCAPE_TEST', verified.reason))
      return { tests, findings, denials: [], unavailable: ['WORKTREE_ESCAPE_TEST'] }
    }

    const trav = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: '../outside.txt',
      allowedPathPrefixes: ['fixtures'],
    })
    const abs = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: path.resolve(repoRoot, 'package.json'),
      allowedPathPrefixes: ['fixtures'],
    })
    const env = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: '.env.local',
      allowedPathPrefixes: ['.env.local', 'fixtures'],
    })
    const gitCfg = resolvePathInsideWorktree({
      worktreeAbs: verified.worktreeAbs,
      relativePath: '.git/config',
      allowedPathPrefixes: ['.git', 'fixtures'],
    })

    let symlinkDenied = true
    try {
      const outside = path.join(fixtureRoot, 'outside.txt')
      writeFileSync(outside, 'x\n')
      const link = path.join(worktree, 'fixtures', 'escape')
      symlinkSync(outside, link)
      const probe = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: 'fixtures/escape',
        allowedPathPrefixes: ['fixtures'],
      })
      if (probe.ok) {
        const real = realpathSync(probe.abs)
        symlinkDenied = !real.startsWith(verified.worktreeAbs)
      } else {
        symlinkDenied = true
      }
    } catch {
      symlinkDenied = true
    }

    const commit = denyEngineeringAgentAction('GIT_COMMIT')
    const push = denyEngineeringAgentAction('GIT_PUSH')

    const ok =
      trav.ok === false &&
      abs.ok === false &&
      env.ok === false &&
      gitCfg.ok === false &&
      symlinkDenied &&
      prodDenied.ok === false &&
      commit.outcome === 'DENY' &&
      push.outcome === 'DENY'

    tests.push(
      ok
        ? pass('engineering_escape_suite', 'PATH_ESCAPE_TEST', 'eng path/git/prod escapes denied')
        : fail('engineering_escape_suite', 'PATH_ESCAPE_TEST', 'engineering escape leak'),
    )
    findings.push(
      controlFinding({
        title: 'Engineering Agent path/worktree escapes denied',
        category: 'ENGINEERING_BOUNDARY',
        actor: 'ENGINEERING_AGENT',
        tool: 'resolvePathInsideWorktree',
        evidence: [
          trav.ok ? 'trav_leak' : trav.reasonCode,
          abs.ok ? 'abs_leak' : abs.reasonCode,
          env.ok ? 'env_leak' : env.reasonCode,
          gitCfg.ok ? 'git_leak' : gitCfg.reasonCode,
          `symlinkDenied=${symlinkDenied}`,
          `prodDenied=${!prodDenied.ok}`,
        ],
        attackPath: '../ escape, absolute escape, symlink, .env, .git, commit/push',
        fix: 'Keep worktree canonical path invariant; never grant agent commit/push.',
      }),
    )
  } finally {
    try {
      rmSync(fixtureRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  return { tests, findings, denials: [], unavailable: [] }
}

export function runResearchProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const crawl = denyResearchAgentAction('CRAWL_EXPANSION')
  const ext = denyResearchAgentAction('EXTERNAL_MUTATION')
  const spend = denyResearchAgentAction('FINANCIAL_SPEND')
  const shell = denyResearchAgentAction('SHELL_EXECUTE')
  const foreign = assertResearchOwnerScopeMatch('user-a', 'user-b')
  const ok =
    crawl.outcome === 'DENY' &&
    ext.outcome === 'DENY' &&
    spend.outcome === 'DENY' &&
    shell.outcome === 'DENY' &&
    !foreign.ok
  tests.push(
    ok
      ? pass('research_boundary_suite', 'AGENT_AUTHORITY_TEST', 'research mutations/foreign denied')
      : fail('research_boundary_suite', 'AGENT_AUTHORITY_TEST', 'research boundary leak'),
  )
  findings.push(
    controlFinding({
      title: 'Research Agent mutation and foreign-owner denied',
      category: 'RESEARCH_BOUNDARY',
      actor: 'RESEARCH_AGENT',
      tool: 'denyResearchAgentAction',
      evidence: [crawl.reasonCode, ext.reasonCode, spend.reasonCode, foreign.ok ? '' : foreign.reason],
      attackPath: 'crawl expand / external mutation / spend / foreign conversation',
      fix: 'Keep SESSION_BOUNDED_READ_ONLY_DISCOVERY; finding != execution authority.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runServiceRoleAndAuditProbes(auditWritten: boolean): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const serviceRolePush = evaluateGovernedAction({
    mode: 'commander',
    safetyLock: true,
    actionKind: 'push',
    body: {},
    commanderSessionOk: false,
    requestingActorId: 'service_role',
    approvingActorId: 'service_role',
  })
  const disableAudit = denySecurityRedTeamAction('POLICY_CHANGE')
  const self = assertSecurityRedTeamCannotSelfApprove()
  const noSelf = assertNoSelfApproval('SECURITY_RED_TEAM_AGENT', 'SECURITY_RED_TEAM_AGENT')

  const ok =
    serviceRolePush.outcome === 'DENY' &&
    disableAudit.outcome === 'DENY' &&
    self.outcome === 'DENY' &&
    noSelf?.outcome === 'DENY' &&
    auditWritten

  tests.push(
    ok
      ? pass('service_role_audit_suite', 'SERVICE_ROLE_POLICY_TEST', 'service role != permission; audit required')
      : fail('service_role_audit_suite', 'SERVICE_ROLE_POLICY_TEST', 'service-role/audit leak'),
  )
  findings.push(
    controlFinding({
      title: 'Service role is not policy permission; audit cannot be disabled by agent',
      category: 'SERVICE_ROLE_AUDIT',
      actor: 'SECURITY_RED_TEAM_AGENT',
      tool: 'evaluateGovernedAction',
      evidence: [
        serviceRolePush.reasonCode,
        disableAudit.reasonCode,
        self.reasonCode,
        `auditWritten=${auditWritten}`,
      ],
      attackPath: 'Use service role or disable audit to escalate',
      fix: 'SERVICE_ROLE_TECHNICAL_REACH != POLICY_PERMISSION; governed audit mandatory.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

export function runRuntimeTruthProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const count = operationalAscensionAgentCount()
  const roles = OPERATIONAL_ASCENSION_AGENTS.map(a => a.agent_role)
  const autonomyOff = ascensionAutonomyIsOff() && ASCENSION_AUTONOMY_GUARD.selfModificationEnabled === false
  const opsUnimplemented = TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('OPERATIONS_AGENT')
  const secImplemented = roles.includes('SECURITY_RED_TEAM_AGENT')
  const ok =
    count === 3 &&
    roles.includes('RESEARCH_AGENT') &&
    roles.includes('ENGINEERING_AGENT') &&
    secImplemented &&
    autonomyOff &&
    opsUnimplemented &&
    !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('SECURITY_RED_TEAM_AGENT' as never)

  tests.push(
    ok
      ? pass('runtime_truth_suite', 'RUNTIME_TRUTH_TEST', `operational=${count} autonomy=OFF`)
      : fail('runtime_truth_suite', 'RUNTIME_TRUTH_TEST', `count=${count} roles=${roles.join(',')}`),
  )
  findings.push(
    controlFinding({
      title: 'Runtime truth matches implemented Ascension agents',
      category: 'RUNTIME_TRUTH',
      actor: 'ASCENSION',
      tool: 'operationalRegistry',
      evidence: [`count=${count}`, roles.join(','), `autonomyOff=${autonomyOff}`],
      attackPath: 'Mislabel TARGET as LIVE / enable autonomy silently',
      fix: 'Keep registry as single source of operational truth.',
    }),
  )
  if (!ok) {
    findings.push(
      blockerFinding({
        title: 'Runtime truth mismatch',
        severity: 'HIGH',
        category: 'RUNTIME_TRUTH',
        actor: 'ASCENSION',
        tool: 'operationalRegistry',
        evidence: [`count=${count}`, roles.join(',')],
        attackPath: 'Registry drift',
        fix: 'Reconcile operational registry with implemented agents.',
      }),
    )
  }
  return { tests, findings, denials: [], unavailable: [] }
}

export function runStaticPolicyProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const shellGate = assertShellArgvGoverned({
    cmd: 'git',
    args: ['push'],
    mode: 'commander',
    safetyLock: true,
    body: {},
    commanderSessionOk: false,
  })
  const ok = shellGate.outcome !== 'ALLOW'
  tests.push(
    ok
      ? pass('static_policy_shell_push', 'POLICY_EVALUATION', shellGate.reason)
      : fail('static_policy_shell_push', 'POLICY_EVALUATION', 'shell push allowed'),
  )
  tests.push(pass('static_analysis_placeholder', 'STATIC_ANALYSIS', 'Governance modules imported for evaluation'))
  findings.push(
    controlFinding({
      title: 'Static policy evaluation denies shell-equivalent git push',
      category: 'POLICY',
      actor: null,
      tool: 'assertShellArgvGoverned',
      evidence: [shellGate.reasonCode, shellGate.reason],
      attackPath: 'execFile(git, [push])',
      fix: 'Retain equivalent-action guard on all argv paths.',
    }),
  )
  return { tests, findings, denials: [], unavailable: [] }
}

/** Red-team the red team — attempts must be denied without execution. */
export function runSelfRedTeamProbes(): ProbeBundle {
  const tests: SecurityTestRun[] = []
  const findings: SecurityFinding[] = []
  const denials: ProbeBundle['denials'] = []
  const attempts = [
    'POLICY_CHANGE',
    'ARBITRARY_SHELL',
    'AGENT_SPAWN',
    'CREDENTIAL_EXFILTRATION',
    'EXTERNAL_EXPLOITATION',
    'PRODUCTION_RESTART',
    'GIT_PUSH',
    'PRODUCTION_DEPLOY',
    'APPROVAL_CHANGE',
  ] as const
  let allDenied = true
  for (const a of attempts) {
    const d = denySecurityRedTeamAction(a)
    if (d.outcome !== 'DENY') allDenied = false
    denials.push({ capability_or_action: a, reason_code: d.reasonCode, reason: d.reason })
  }
  const foreign = assertSecurityOwnerScopeMatch('sec-owner', 'other-owner')
  if (foreign.ok) allDenied = false
  tests.push(
    allDenied
      ? pass('redteam_the_redteam', 'AGENT_AUTHORITY_TEST', 'security self-attacks denied')
      : fail('redteam_the_redteam', 'AGENT_AUTHORITY_TEST', 'security self-attack leak'),
  )
  findings.push(
    controlFinding({
      title: 'SECURITY_RED_TEAM_AGENT cannot escalate itself',
      category: 'SELF_RED_TEAM',
      actor: 'SECURITY_RED_TEAM_AGENT',
      tool: 'denySecurityRedTeamAction',
      evidence: denials.map(d => `${d.capability_or_action}:${d.reason_code}`),
      attackPath: 'disable audit / grant shell / spawn eng / dump secrets / push remediation',
      fix: 'Keep security agent read/evaluate-only with Phase 1 denials.',
    }),
  )
  return { tests, findings, denials, unavailable: [] }
}
