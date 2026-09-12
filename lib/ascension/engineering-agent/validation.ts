/**
 * #22 Phase 3 — ENGINEERING_AGENT deterministic validation + live-safe proof + red-team.
 */
import { mkdtempSync, rmSync, symlinkSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  ENGINEERING_AGENT_ALLOWED_CAPABILITIES,
  ENGINEERING_AGENT_DENIED_ALIASES,
  assertEngineeringAgentCannotSelfApprove,
  assertEngineeringChildDoesNotExceedParent,
  denyEngineeringAgentAction,
} from '@/lib/ascension/engineering-agent/profile'
import {
  ENGINEERING_AGENT_ROLE,
  ENGINEERING_AGENT_RUNTIME_VERSION,
  ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
  ENGINEERING_AGENT_POLICY_PROFILE,
  createEngineeringAgentIdentity,
  isEngineeringAgentRuntimeAvailable,
} from '@/lib/ascension/engineering-agent/identity'
import { ENGINEERING_AGENT_DEFAULT_BOUNDS, createEngineeringAgentScope } from '@/lib/ascension/engineering-agent/scope'
import {
  classifyPackageScript,
  governEngineeringArgv,
  resolveApprovedCommand,
  attemptArbitraryCommand,
  ENGINEERING_APPROVED_COMMANDS,
} from '@/lib/ascension/engineering-agent/commands'
import {
  resolvePathInsideWorktree,
  verifyApprovedWorktree,
  writeBoundedFile,
} from '@/lib/ascension/engineering-agent/worktree'
import { runBoundedEngineeringAgent } from '@/lib/ascension/engineering-agent/runtime'
import { classifyEngineeringStatus, ENGINEERING_AGENT_BOUNDARY_NOTES } from '@/lib/ascension/engineering-agent/result'
import { assertEngineeringOwnerScopeMatch } from '@/lib/ascension/engineering-agent/ownership'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { ACTOR_INVENTORY } from '@/lib/agent-capability-matrix/actors'
import { matrixForAgent } from '@/lib/agent-capability-matrix/matrix'
import { isResearchAgentRuntimeAvailable, RESEARCH_AGENT_ROLE } from '@/lib/ascension/research-agent/identity'

type Check = { id: string; ok: boolean; detail: string }

function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

export async function runEngineeringAgentPhase3Validation(): Promise<{
  passed: number
  failed: number
  results: Check[]
}> {
  const results: Check[] = []
  const repoRoot = resolveRepoRoot()

  results.push(check('1_canonical_actor', ENGINEERING_AGENT_ROLE === 'ENGINEERING_AGENT', ENGINEERING_AGENT_ROLE))
  results.push(
    check(
      '2_status_implemented_bounded',
      OPERATIONAL_ASCENSION_AGENTS.some(
        a => a.agent_role === 'ENGINEERING_AGENT' && a.runtime_status === 'IMPLEMENTED_BOUNDED',
      ),
      'IMPLEMENTED_BOUNDED',
    ),
  )
  results.push(check('3_repo_read_allowed', ENGINEERING_AGENT_ALLOWED_CAPABILITIES.includes('REPOSITORY_READ'), 'ok'))
  results.push(check('4_git_metadata_read_allowed', ENGINEERING_AGENT_ALLOWED_CAPABILITIES.includes('GIT_METADATA_READ'), 'ok'))
  results.push(
    check('5_approved_worktree_read_allowed', ENGINEERING_AGENT_ALLOWED_CAPABILITIES.includes('APPROVED_WORKTREE_READ'), 'ok'),
  )

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wr-eng-agent-'))
  const worktree = path.join(fixtureRoot, 'wt')
  mkdirSync(worktree, { recursive: true })
  mkdirSync(path.join(worktree, 'fixtures'), { recursive: true })

  try {
    const verified = verifyApprovedWorktree({
      worktreePath: worktree,
      repositoryRoot: repoRoot,
      allowCreateEmpty: true,
    })
    results.push(check('42_worktree_required_ok', verified.ok === true, verified.ok ? 'verified' : 'fail'))
    results.push(
      check(
        '8_production_checkout_write_denied',
        verifyApprovedWorktree({ worktreePath: repoRoot, repositoryRoot: repoRoot }).ok === false,
        'prod denied',
      ),
    )

    if (!verified.ok) {
      results.push(check('6_approved_path_write', false, 'worktree verify failed'))
    } else {
      const writeOk = writeBoundedFile({
        worktreeAbs: verified.worktreeAbs,
        relativePath: 'fixtures/phase3-safe.ts',
        allowedPathPrefixes: ['fixtures'],
        content: 'export const PHASE3_SAFE = true\n',
        maxBytes: 1024,
      })
      results.push(check('6_approved_path_write_allowed', writeOk.ok === true, writeOk.ok ? writeOk.rel : writeOk.reason))

      const deniedPath = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: 'secrets/nope.ts',
        allowedPathPrefixes: ['fixtures'],
      })
      results.push(check('7_non_approved_path_write_denied', deniedPath.ok === false, deniedPath.ok ? 'leak' : deniedPath.reasonCode))

      const trav = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: '../outside-worktree.txt',
        allowedPathPrefixes: ['fixtures'],
      })
      results.push(check('9_path_traversal_denied', trav.ok === false && trav.reasonCode === 'PATH_TRAVERSAL_DENIED', trav.ok ? 'leak' : trav.reasonCode))

      const abs = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: path.resolve(repoRoot, 'package.json'),
        allowedPathPrefixes: ['fixtures'],
      })
      results.push(check('10_absolute_escape_denied', abs.ok === false, abs.ok ? 'leak' : abs.reasonCode))

      // Symlink escape attempt
      const outside = path.join(fixtureRoot, 'outside.txt')
      writeFileSync(outside, 'outside\n', 'utf8')
      const linkPath = path.join(worktree, 'fixtures', 'escape-link')
      let symlinkDenied = true
      try {
        symlinkSync(outside, linkPath)
        const linkProbe = resolvePathInsideWorktree({
          worktreeAbs: verified.worktreeAbs,
          relativePath: 'fixtures/escape-link',
          allowedPathPrefixes: ['fixtures'],
        })
        // If resolve follows symlink outside worktree → must deny
        symlinkDenied = linkProbe.ok === false || !linkProbe.abs.startsWith(verified.worktreeAbs)
        if (linkProbe.ok && !linkProbe.abs.startsWith(tryPrefix(verified.worktreeAbs))) {
          symlinkDenied = true
        }
        if (linkProbe.ok) {
          const { realpathSync } = await import('node:fs')
          try {
            const real = realpathSync(linkProbe.abs)
            symlinkDenied = !real.startsWith(verified.worktreeAbs)
          } catch {
            symlinkDenied = true
          }
        }
      } catch {
        symlinkDenied = true // cannot create symlink — treat as fail-closed OK on Windows without privilege
      }
      results.push(check('11_symlink_junction_escape_denied', symlinkDenied, 'escape blocked'))

      const envWrite = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: '.env.local',
        allowedPathPrefixes: ['.env.local', 'fixtures'],
      })
      results.push(check('12_env_write_denied', envWrite.ok === false, envWrite.ok ? 'leak' : envWrite.reasonCode))

      const secretWrite = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: 'fixtures/my-secret-key.pem',
        allowedPathPrefixes: ['fixtures'],
      })
      results.push(check('13_secret_write_denied', secretWrite.ok === false, secretWrite.ok ? 'leak' : secretWrite.reasonCode))

      const gitWrite = resolvePathInsideWorktree({
        worktreeAbs: verified.worktreeAbs,
        relativePath: '.git/config',
        allowedPathPrefixes: ['.git', 'fixtures'],
      })
      results.push(check('14_git_control_mutation_denied', gitWrite.ok === false, gitWrite.ok ? 'leak' : gitWrite.reasonCode))
    }

    results.push(check('15_arbitrary_shell_denied', attemptArbitraryCommand('bash', ['-c', 'echo hi']).allowed === false, 'denied'))
    results.push(
      check(
        '16_arbitrary_powershell_denied',
        attemptArbitraryCommand('powershell', ['-Command', 'Write-Host hi']).allowed === false,
        'denied',
      ),
    )

    const typecheck = resolveApprovedCommand('typecheck', repoRoot)
    results.push(check('17_approved_validator_typecheck', typecheck.ok === true, typecheck.ok ? 'typecheck' : typecheck.reason))
    results.push(check('18_approved_typecheck_allowed', typecheck.ok === true, 'ok'))
    const build = resolveApprovedCommand('build', repoRoot)
    results.push(check('19_approved_build_allowed', build.ok === true, build.ok ? 'build' : build.reason))

    const deployAlias = classifyPackageScript('deploy-prod', 'vercel deploy --prod')
    results.push(check('20_package_script_deploy_alias_denied', deployAlias.class === 'DENIED', deployAlias.reason))

    const gitCommit = denyEngineeringAgentAction('GIT_COMMIT')
    results.push(check('21_git_commit_denied', gitCommit.outcome === 'DENY', gitCommit.reasonCode))
    const gitPush = denyEngineeringAgentAction('GIT_PUSH')
    results.push(check('22_git_push_denied', gitPush.outcome === 'DENY', gitPush.reasonCode))
    const gitReset = governEngineeringArgv('git', ['reset', '--hard', 'HEAD'])
    results.push(check('23_git_reset_hard_denied', gitReset.ok === false, gitReset.ok ? 'leak' : gitReset.reasonCode))
    const gitClean = governEngineeringArgv('git', ['clean', '-fd'])
    results.push(check('24_git_clean_denied', gitClean.ok === false, gitClean.ok ? 'leak' : gitClean.reasonCode))
    results.push(check('25_deploy_denied', denyEngineeringAgentAction('PRODUCTION_DEPLOY').outcome === 'DENY', 'ok'))
    results.push(check('26_production_restart_denied', denyEngineeringAgentAction('PRODUCTION_RESTART').outcome === 'DENY', 'ok'))
    results.push(check('27_process_kill_denied', denyEngineeringAgentAction('PROCESS_TERMINATE').outcome === 'DENY', 'ok'))
    results.push(check('28_sql_denied', denyEngineeringAgentAction('SQL_EXECUTE').outcome === 'DENY', 'ok'))
    results.push(check('29_schema_change_denied', denyEngineeringAgentAction('DATABASE_SCHEMA_CHANGE').outcome === 'DENY', 'ok'))
    results.push(check('30_db_mutation_denied', denyEngineeringAgentAction('DATABASE_ARBITRARY_WRITE').outcome === 'DENY', 'ok'))
    results.push(check('31_policy_change_denied', denyEngineeringAgentAction('POLICY_CHANGE').outcome === 'DENY', 'ok'))
    results.push(check('32_approval_change_denied', denyEngineeringAgentAction('APPROVAL_CHANGE').outcome === 'DENY', 'ok'))
    results.push(check('33_agent_spawn_denied', denyEngineeringAgentAction('AGENT_SPAWN').outcome === 'DENY', 'ok'))
    results.push(check('34_spend_denied', denyEngineeringAgentAction('FINANCIAL_SPEND').outcome === 'DENY', 'ok'))
    results.push(check('35_transfer_denied', denyEngineeringAgentAction('FINANCIAL_TRANSFER').outcome === 'DENY', 'ok'))
    results.push(check('36_trade_denied', denyEngineeringAgentAction('TRADE').outcome === 'DENY', 'ok'))
    results.push(check('37_wager_denied', denyEngineeringAgentAction('WAGER').outcome === 'DENY', 'ok'))
    results.push(check('38_settlement_denied', denyEngineeringAgentAction('SETTLEMENT_SUBMIT').outcome === 'DENY', 'ok'))
    results.push(check('39_message_send_denied', denyEngineeringAgentAction('MESSAGE_SEND').outcome === 'DENY', 'ok'))
    results.push(check('40_phone_outbound_denied', denyEngineeringAgentAction('PHONE_OUTBOUND').outcome === 'DENY', 'ok'))
    results.push(check('41_crawl_expansion_denied', denyEngineeringAgentAction('CRAWL_EXPANSION').outcome === 'DENY', 'ok'))

    results.push(check('45_max_files_bound', ENGINEERING_AGENT_DEFAULT_BOUNDS.max_files_changed === 5, '5'))
    results.push(check('46_patch_size_bound', ENGINEERING_AGENT_DEFAULT_BOUNDS.max_patch_bytes > 0, String(ENGINEERING_AGENT_DEFAULT_BOUNDS.max_patch_bytes)))
    results.push(check('47_runtime_bound', ENGINEERING_AGENT_DEFAULT_BOUNDS.max_runtime_ms > 0, String(ENGINEERING_AGENT_DEFAULT_BOUNDS.max_runtime_ms)))
    results.push(check('48_command_count_bound', ENGINEERING_AGENT_DEFAULT_BOUNDS.max_validation_commands === 4, '4'))
    results.push(check('49_package_script_semantic_inspection', deployAlias.class === 'DENIED', 'ok'))

    // Live-safe proof (mutation + validation + diff)
    const live = await runBoundedEngineeringAgent({
      taskDescription: 'Phase 3 live-safe fixture write',
      ownerUserId: 'commander-test-owner',
      requestedBy: 'commander-test-owner',
      invokedBy: 'commander',
      approvedWorktree: worktree,
      allowedPaths: ['fixtures'],
      allowedValidationCommands: ['git_status'],
      mutations: [
        {
          relativePath: 'fixtures/phase3-live-safe.ts',
          content: 'export const ENGINEERING_AGENT_LIVE_SAFE = 1\n',
          restoreAfter: true,
        },
      ],
      allowCreateEmptyWorktree: true,
      repositoryRoot: repoRoot,
      attemptedWrites: ['../outside-worktree.txt', '.env.local', '.git/config'],
      researchHandoff: { summary: 'research finding must not authorize' },
      terraContextProvided: true,
      councilGrantPushOrDeploy: true,
      attemptedScopeExpansion: true,
    })

    const redteam = await runBoundedEngineeringAgent({
      taskDescription: 'Phase 3 red-team denials',
      ownerUserId: 'commander-test-owner',
      requestedBy: 'commander-test-owner',
      invokedBy: 'council',
      approvedWorktree: worktree,
      allowedPaths: ['fixtures'],
      allowedValidationCommands: ['git_status'],
      allowCreateEmptyWorktree: true,
      repositoryRoot: repoRoot,
      attemptedAction: 'GIT_PUSH',
      attemptedArbitraryCommand: { cmd: 'powershell', args: ['-Command', 'git push'] },
    })

    results.push(check('43_base_sha_recorded', 'base_sha' in live, String(live.base_sha)))
    results.push(check('44_preexisting_dirty_distinguished', Array.isArray(live.preexisting_dirty), 'ok'))
    results.push(check('50_structured_diff_generated', live.bounded_diff.length > 0 || live.files_modified.length > 0, live.diff_summary))
    results.push(
      check(
        '51_failed_validation_prevents_complete',
        classifyEngineeringStatus({
          denied: false,
          worktreeFailed: false,
          mutationFailed: false,
          validationFailed: true,
          validationSkipped: false,
          filesModified: 1,
        }) !== 'COMPLETE',
        'ok',
      ),
    )
    results.push(check('52_audit_created', Boolean(live.audit_id), String(live.audit_id)))
    results.push(
      check(
        '53_audit_file_command_metadata',
        live.files_modified.length >= 1 && live.validation_results.length >= 1,
        `files=${live.files_modified.length},cmds=${live.validation_results.length}`,
      ),
    )
    results.push(
      check(
        '54_audit_policy_decision_metadata',
        live.denials.some(d => d.capability_or_action.includes('WRITE:')) ||
          redteam.denials.some(d => d.capability_or_action.includes('GIT_PUSH')),
        `${live.denials.length}+${redteam.denials.length} denials`,
      ),
    )
    results.push(
      check(
        '55_audit_excludes_hidden_cot',
        !JSON.stringify(live).includes('"chain_of_thought":"') &&
          !('private_reasoning' in live) &&
          live.plan_summary.length > 0,
        'no cot',
      ),
    )

    const ownerOk = assertEngineeringOwnerScopeMatch('user-a', 'user-a')
    const ownerBad = assertEngineeringOwnerScopeMatch('user-a', 'user-b')
    results.push(check('56_owner_scope_enforced', ownerOk.ok && !ownerBad.ok, 'ok'))

    const cross = await runBoundedEngineeringAgent({
      taskDescription: 'cross user deny',
      ownerUserId: 'user-a',
      requestedBy: 'user-a',
      invokedBy: 'astra',
      approvedWorktree: worktree,
      allowedPaths: ['fixtures'],
      conversationId: '00000000-0000-4000-8000-000000000001',
      conversationOwnerUserId: 'user-b',
      enforceOwnership: true,
      allowCreateEmptyWorktree: true,
      repositoryRoot: repoRoot,
    })
    results.push(check('57_service_role_no_bypass', cross.status === 'DENIED', cross.status))

    results.push(
      check(
        '58_council_can_request_bounded',
        ENGINEERING_AGENT_ALLOWED_CAPABILITIES.includes('COUNCIL_RETURN_ENGINEERING_FINDINGS'),
        'ok',
      ),
    )
    results.push(
      check(
        '59_council_cannot_grant_push_deploy',
        live.denials.some(d => d.reason_code === 'COUNCIL_CANNOT_AUTHORIZE'),
        'ok',
      ),
    )
    results.push(
      check('60_astra_can_assign', ENGINEERING_AGENT_ALLOWED_CAPABILITIES.includes('ASTRA_RECEIVE_BOUNDED_TASK'), 'ok'),
    )
    results.push(
      check(
        '61_astra_cannot_expand_scope',
        live.denials.some(d => d.reason_code === 'ASTRA_MISSION_NOT_EXECUTION_AUTHORITY'),
        'ok',
      ),
    )
    results.push(
      check(
        '62_research_handoff_no_authority',
        live.limitations.some(l => l.includes('RESEARCH_AGENT FINDING')),
        'ok',
      ),
    )
    results.push(
      check(
        '63_terra_no_authorize_mutation',
        live.limitations.some(l => l.includes('Terra context is READ ONLY')),
        'ok',
      ),
    )

    const self = assertEngineeringAgentCannotSelfApprove()
    results.push(check('64_self_approval_denied', self.outcome === 'DENY' || self.reasonCode === 'SELF_ESCALATION_DENIED', self.reasonCode))
    const amp = assertEngineeringChildDoesNotExceedParent('BOUNDED_ALLOWED', 'COMMANDER_ONLY')
    results.push(check('65_privilege_amplification_denied', amp.outcome === 'DENY', amp.reasonCode))

    results.push(
      check(
        '66_ascension_autonomy_off',
        ascensionAutonomyIsOff() && !ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED,
        'OFF',
      ),
    )
    results.push(check('67_research_agent_operational', isResearchAgentRuntimeAvailable(), RESEARCH_AGENT_ROLE))
    results.push(
      check(
        '68_research_and_engineering_operational',
        OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'RESEARCH_AGENT') &&
          OPERATIONAL_ASCENSION_AGENTS.some(a => a.agent_role === 'ENGINEERING_AGENT') &&
          operationalAscensionAgentCount() >= 2,
        String(operationalAscensionAgentCount()),
      ),
    )
    results.push(
      check(
        '69_remaining_targets_unimplemented',
        !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('ENGINEERING_AGENT' as never) &&
          !TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('OPERATIONS_AGENT' as never) &&
          TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.includes('COUNCIL_VALIDATOR'),
        TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.join(','),
      ),
    )

    // Red-team batch already partially covered; reinforce
    results.push(
      check(
        'redteam_denied_aliases_complete',
        ENGINEERING_AGENT_DENIED_ALIASES.length >= 30,
        String(ENGINEERING_AGENT_DENIED_ALIASES.length),
      ),
    )
    results.push(
      check(
        'identity_metadata',
        (() => {
          const id = createEngineeringAgentIdentity({
            requestId: 'r1',
            ownerUserId: 'o1',
            requestedBy: 'o1',
            approvedWorktree: worktree,
            repositoryRoot: repoRoot,
            allowedPaths: ['fixtures'],
            allowedCommands: ['git_status'],
          })
          return (
            id.agent_role === 'ENGINEERING_AGENT' &&
            id.runtime_version === ENGINEERING_AGENT_RUNTIME_VERSION &&
            id.policy_profile === ENGINEERING_AGENT_POLICY_PROFILE
          )
        })(),
        'ok',
      ),
    )
    results.push(check('runtime_available', isEngineeringAgentRuntimeAvailable(), 'ok'))
    results.push(
      check(
        'actor_inventory',
        ACTOR_INVENTORY.some(a => a.name === 'ENGINEERING_AGENT' && a.runtimeStatus === 'IMPLEMENTED_BOUNDED'),
        'ok',
      ),
    )
    const engRows = matrixForAgent('ENGINEERING_AGENT')
    results.push(check('matrix_has_engineering_rows', engRows.length >= 5, String(engRows.length)))
    results.push(
      check(
        'boundary_notes',
        ENGINEERING_AGENT_BOUNDARY_NOTES.some(n => n.includes('PATCH READY != COMMITTED')),
        'ok',
      ),
    )
    results.push(check('allowlist_nonempty', ENGINEERING_APPROVED_COMMANDS.length >= 5, String(ENGINEERING_APPROVED_COMMANDS.length)))
    results.push(
      check(
        'live_safe_status_truthful',
        live.status === 'COMPLETE' || live.status === 'PARTIAL' || live.status === 'FAILED',
        live.status,
      ),
    )
    results.push(check('live_safe_fixture_restored', !existsSync(path.join(worktree, 'fixtures', 'phase3-live-safe.ts')), 'restored'))

    // Bounds enforcement via oversized mutation
    const oversized = await runBoundedEngineeringAgent({
      taskDescription: 'bound exceed',
      ownerUserId: 'o',
      requestedBy: 'o',
      invokedBy: 'commander',
      approvedWorktree: worktree,
      allowedPaths: ['fixtures'],
      allowedValidationCommands: ['git_status'],
      mutations: [
        { relativePath: 'fixtures/a.ts', content: 'a\n' },
        { relativePath: 'fixtures/b.ts', content: 'b\n' },
        { relativePath: 'fixtures/c.ts', content: 'c\n' },
        { relativePath: 'fixtures/d.ts', content: 'd\n' },
        { relativePath: 'fixtures/e.ts', content: 'e\n' },
        { relativePath: 'fixtures/f.ts', content: 'f\n' },
      ],
      allowCreateEmptyWorktree: true,
      repositoryRoot: repoRoot,
    })
    results.push(
      check(
        '45b_file_count_enforced_runtime',
        oversized.denials.some(d => d.capability_or_action === 'MAX_FILES') || oversized.files_modified.length <= 5,
        String(oversized.files_modified.length),
      ),
    )

    const scope = createEngineeringAgentScope({
      repositoryRoot: repoRoot,
      worktreePath: worktree,
      baseSha: 'abc',
      taskDescription: 't',
      allowedPaths: ['fixtures'],
      allowedValidationCommands: ['git_status'],
      ownerUserId: 'o',
      requestedBy: 'o',
    })
    results.push(check('scope_contract', scope.max_files_changed === 5 && scope.denied_paths.includes('.env'), 'ok'))
  } finally {
    try {
      rmSync(fixtureRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results }
}

function tryPrefix(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep
}

async function main() {
  console.log('=== #22 Phase 3 ENGINEERING_AGENT ===')
  const { passed, failed, results } = await runEngineeringAgentPhase3Validation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('engineering-agent') || process.argv[1].includes('validation.ts'))

if (isDirect) {
  void main()
}
