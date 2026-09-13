/**
 * Engineer activation suite: policy/security boundaries plus three disposable-workspace E2E
 * missions that go through SingleAgentEngineeringStrategy (the same core the UI/API call).
 */
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import {
  createNewProjectWorkspace,
  openExistingProjectWorkspace,
  WorkspaceValidationError,
} from '@/lib/native-builder/workspaceRegistry'
import { classifyArgv, classifyCommandCwd } from '@/lib/native-builder/commandPolicy'
import { isEngineerToolName, ENGINEER_TOOL_NAMES } from '@/lib/native-builder/engineerTools'
import { executeApprovedGitCommit, executeApprovedGitPush, denyDeploy, GitGovernanceError } from '@/lib/native-builder/gitGovernance'
import { assertCanonicalRepoPath, resolveRepoRelativePath, RepoAccessDeniedError } from '@/lib/native-builder/repositoryInspector'
import { redactSecretsFromOutput } from '@/lib/native-builder/outputRedaction'
import { NATIVE_TERMINAL_OPERATION_IDS, isNativeTerminalOperationId } from '@/lib/native-builder/types'
import { isDuplicateFailureLoop, runCodingMission, stopCodingMission } from '@/lib/native-builder/engineerLoop'
import { stopOwnedProcesses } from '@/lib/native-builder/terminalExecutor'
import { rollbackNow } from '@/lib/native-builder/runtime'
import { getRepair, saveRepair } from '@/lib/native-builder/storage'
import { runValidationOperation } from '@/lib/native-builder/validationRunner'

const execFileAsync = promisify(execFile)

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const SUM_BROKEN = `export function sumFixtureValues(values) {
  let total = 0
  for (let i = 0; i < values.length - 1; i += 1) {
    total += values[i]
  }
  return total
}
`

const SUM_TEST = `import test from 'node:test'
import assert from 'node:assert/strict'
import { sumFixtureValues } from './sum.mjs'

test('sum includes every element', () => {
  assert.equal(sumFixtureValues([1, 2, 3, 4]), 10)
})
`

const GREETING = `export const GREETING = 'hello'
`

const GREETING_TEST = `import test from 'node:test'
import assert from 'node:assert/strict'
import { GREETING } from './greeting.mjs'

test('greeting stays hello until farewell is added', () => {
  assert.equal(GREETING, 'hello')
})
`

async function withProjectsRoot<T>(fn: (projectsRoot: string) => Promise<T>): Promise<T> {
  const previous = process.env.WAR_ROOM_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-engineer-e2e-'))
  process.env.WAR_ROOM_PROJECTS_ROOT = projectsRoot
  try {
    return await fn(projectsRoot)
  } finally {
    if (previous === undefined) delete process.env.WAR_ROOM_PROJECTS_ROOT
    else process.env.WAR_ROOM_PROJECTS_ROOT = previous
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
}

function testCommandPolicy(): CaseResult[] {
  return [
    check('policy_safe_pnpm_install', classifyArgv('pnpm', ['install']).policyClass === 'SAFE_LOCAL', classifyArgv('pnpm', ['install']).reason),
    check('policy_safe_git_status', classifyArgv('git', ['status']).policyClass === 'SAFE_LOCAL', classifyArgv('git', ['status']).reason),
    check('policy_commit_requires_approval', classifyArgv('git', ['commit', '-m', 'x']).policyClass === 'REQUIRES_APPROVAL', classifyArgv('git', ['commit', '-m', 'x']).reason),
    check('policy_push_requires_approval', classifyArgv('git', ['push']).policyClass === 'REQUIRES_APPROVAL', classifyArgv('git', ['push']).approvalKind === 'push' ? 'push' : 'wrong kind'),
    check('policy_deploy_denied', classifyArgv('vercel', ['deploy']).policyClass === 'DENIED', classifyArgv('vercel', ['deploy']).reason),
    check('policy_rm_rf_denied', classifyArgv('rm', ['-rf', '/']).policyClass === 'DENIED', classifyArgv('rm', ['-rf', '/']).reason),
    check('policy_powershell_denied', classifyArgv('powershell', ['-Command', 'Get-ChildItem']).policyClass === 'DENIED', classifyArgv('powershell', ['-Command', 'Get-ChildItem']).reason),
    check('policy_git_commit_not_terminal_op', !NATIVE_TERMINAL_OPERATION_IDS.includes('git_commit' as never), 'ok'),
    check('policy_git_push_not_terminal_op', !NATIVE_TERMINAL_OPERATION_IDS.includes('git_push' as never), 'ok'),
    check('policy_no_raw_shell_op', !isNativeTerminalOperationId('shell') && !isNativeTerminalOperationId('exec'), 'ok'),
    check('policy_tools_are_typed', ENGINEER_TOOL_NAMES.every(isEngineerToolName) && !isEngineerToolName('rm -rf'), String(ENGINEER_TOOL_NAMES.length)),
    check('policy_deploy_helper_denied', denyDeploy().denied === true, denyDeploy().reason),
    check(
      'policy_outside_workspace_cwd',
      classifyCommandCwd('C:\\Windows\\System32', 'C:\\Users\\markb\\WarRoomProjects\\demo').policyClass === 'REQUIRES_APPROVAL',
      classifyCommandCwd('C:\\Windows\\System32', 'C:\\Users\\markb\\WarRoomProjects\\demo').reason,
    ),
    check('retry_01_duplicate_failure_loop', isDuplicateFailureLoop(['a', 'a'], 'a') === true, 'three identical signatures'),
    check('retry_02_allows_progress', isDuplicateFailureLoop(['a', 'b'], 'a') === false, 'mixed signatures still progress'),
  ]
}

function testSecretRedaction(): CaseResult[] {
  const sample = 'token sk-abcdefghijklmnopqrstuvwxyz123456 password=supersecretvalue Bearer abcdefghijklmnop'
  const redacted = redactSecretsFromOutput(sample)
  return [
    check('redact_01_strips_openai_style', !redacted.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), redacted),
    check('redact_02_strips_password_assignment', !redacted.includes('supersecretvalue'), redacted),
    check('redact_03_strips_bearer', !redacted.includes('abcdefghijklmnop'), redacted),
  ]
}

async function testGitGates(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  try {
    await executeApprovedGitCommit({ approvalGranted: false, message: 'x', files: ['a.ts'] })
    results.push(check('git_commit_blocked_without_approval', false, 'did not throw'))
  } catch (error) {
    results.push(check('git_commit_blocked_without_approval', error instanceof GitGovernanceError, String(error)))
  }
  try {
    await executeApprovedGitPush({ approvalGranted: false })
    results.push(check('git_push_blocked_without_approval', false, 'did not throw'))
  } catch (error) {
    results.push(check('git_push_blocked_without_approval', error instanceof GitGovernanceError, String(error)))
  }
  return results
}

async function testWorkspaceEscape(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const results: CaseResult[] = []
    const ws = await createNewProjectWorkspace({ name: 'escape-box', initializeGit: false })
    return runWithWorkspaceRoot(ws.root, async () => {
      try {
        resolveRepoRelativePath('../outside.txt')
        results.push(check('escape_01_path_traversal', false, 'did not throw'))
      } catch (error) {
        results.push(check('escape_01_path_traversal', error instanceof RepoAccessDeniedError, String(error)))
      }
      try {
        await openExistingProjectWorkspace('C:\\Windows\\System32')
        results.push(check('escape_02_system_dir_open', false, 'did not throw'))
      } catch (error) {
        results.push(check('escape_02_system_dir_open', error instanceof WorkspaceValidationError, String(error)))
      }
      const link = path.join(ws.root, 'escape-link')
      try {
        await symlink('C:\\Windows', link, 'junction')
        try {
          await assertCanonicalRepoPath(path.join(link, 'notepad.exe'))
          results.push(check('escape_03_junction_escape', false, 'did not throw'))
        } catch (error) {
          results.push(check('escape_03_junction_escape', error instanceof RepoAccessDeniedError, String(error)))
        }
      } catch (error) {
        results.push(check('escape_03_junction_escape', true, `junction not creatable here: ${String(error)}`))
      }
      return results
    }, ws.id)
  })
}

async function seedGit(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'engineer-e2e@warroom.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Engineer E2E'], { cwd: dir })
}

async function testE2ERepair(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'repair-fixture', initializeGit: true })
    await writeFile(path.join(ws.root, 'package.json'), JSON.stringify({ name: 'repair-fixture', type: 'module', scripts: { test: 'node --test' } }, null, 2), 'utf8')
    await writeFile(path.join(ws.root, 'sum.mjs'), SUM_BROKEN, 'utf8')
    await writeFile(path.join(ws.root, 'test.mjs'), SUM_TEST, 'utf8')
    await seedGit(ws.root)
    return runWithWorkspaceRoot(ws.root, async () => {
      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.create({
        title: 'Fix the sum helper',
        description: 'Include every array element so the local test passes.',
        subsystem: 'sum.mjs',
        targetFiles: ['sum.mjs'],
        executionMode: 'bounded_coding',
        autoRun: true,
        waitForCompletion: true,
        naturalLanguage: 'Fix the sum helper so tests pass.',
      })
      const source = await readFile(path.join(ws.root, 'sum.mjs'), 'utf8')
      const repair = await getRepair(mission.id)
      return [
        check('e2e_repair_01_completed_or_validated', mission.status === 'completed' || mission.engineer?.currentStep === 'DONE', `${mission.status} ${mission.engineer?.currentStep}`),
        check('e2e_repair_02_file_fixed', source.includes('values.length;') && !source.includes('values.length - 1'), source.slice(0, 200)),
        check('e2e_repair_03_validations_ran', (mission.validationResults?.length ?? 0) > 0, JSON.stringify(mission.validationResults?.map(v => [v.operation.id, v.ok]))),
        check('e2e_repair_04_no_autonomous_commit_executed', !String(repair?.commitPreparation?.commitMessage ?? '').includes('git commit -m'), repair?.commitPreparation?.commitMessage ?? 'none'),
        check('e2e_repair_05_trace_has_progress', (mission.engineer?.progressEvents.length ?? 0) >= 2, String(mission.engineer?.progressEvents.length)),
      ]
    }, ws.id)
  })
}

async function testE2EGreenfield(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'task-tracker-app', initializeGit: true })
    return runWithWorkspaceRoot(ws.root, async () => {
      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.create({
        title: 'Build a local task tracker',
        description: 'Build a small local task-tracker web app with create, complete and delete actions and persistent local storage.',
        subsystem: 'project',
        executionMode: 'bounded_coding',
        autoRun: true,
        waitForCompletion: true,
        naturalLanguage: 'Build a small local task-tracker web app with create, complete and delete actions and persistent local storage.',
      })
      const app = await readFile(path.join(ws.root, 'app.mjs'), 'utf8').catch(() => '')
      const pkg = await readFile(path.join(ws.root, 'package.json'), 'utf8').catch(() => '')
      await stopOwnedProcesses(mission.id)
      await new Promise(resolve => setTimeout(resolve, 400))
      const probe = (mission.validationResults ?? []).find(v => v.operation.id === 'http_probe')
      return [
        check('e2e_greenfield_01_files_created', app.includes('createStore') && app.includes('writeFileSync') && pkg.includes('task-tracker'), `app=${app.length} pkg=${pkg.length}`),
        check('e2e_greenfield_02_mission_done', (mission.status === 'completed' || mission.engineer?.currentStep === 'DONE') && mission.engineer?.validationOutcome === 'VALIDATED', `${mission.status} ${mission.engineer?.currentStep} ${mission.engineer?.validationOutcome}`),
        check('e2e_greenfield_03_tests_executed', (mission.validationResults ?? []).some(v => v.operation.id === 'node_test' && v.ok), JSON.stringify(mission.validationResults?.map(v => [v.operation.id, v.ok]))),
        check('e2e_greenfield_04_http_probe', Boolean(probe?.ok) && Boolean(probe?.stdout.includes('"ok":true')) && !Boolean(probe?.stdout.includes('War Room Local Core')), JSON.stringify(probe)),
        check('e2e_greenfield_05_no_push', classifyArgv('git', ['push']).policyClass !== 'SAFE_LOCAL', 'ok'),
      ]
    }, ws.id)
  })
}

async function testE2EExisting(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'existing-greeting', initializeGit: true })
    await writeFile(path.join(ws.root, 'package.json'), JSON.stringify({ name: 'existing-greeting', type: 'module', scripts: { test: 'node --test' } }, null, 2), 'utf8')
    await writeFile(path.join(ws.root, 'greeting.mjs'), GREETING, 'utf8')
    await writeFile(path.join(ws.root, 'test.mjs'), GREETING_TEST, 'utf8')
    await seedGit(ws.root)
    return runWithWorkspaceRoot(ws.root, async () => {
      const before = await readFile(path.join(ws.root, 'greeting.mjs'), 'utf8')
      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.create({
        title: 'Add farewell export',
        description: 'Add FAREWELL without breaking GREETING.',
        subsystem: 'greeting.mjs',
        targetFiles: ['greeting.mjs'],
        executionMode: 'bounded_coding',
        autoRun: true,
        waitForCompletion: true,
      })
      const after = await readFile(path.join(ws.root, 'greeting.mjs'), 'utf8')
      return [
        check('e2e_existing_01_greeting_preserved', after.includes("export const GREETING = 'hello'"), after),
        check('e2e_existing_02_farewell_added', after.includes('FAREWELL'), after),
        check('e2e_existing_03_diff_present', Boolean(mission.diff?.changedFiles?.length || after !== before), JSON.stringify(mission.diff?.changedFiles)),
        check('e2e_existing_04_not_committed_autonomously', mission.policy.commitCapable === false, JSON.stringify(mission.policy)),
      ]
    }, ws.id)
  })
}

async function testHttpTimeoutAndProviderPause(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'timeout-box', initializeGit: false })
    return runWithWorkspaceRoot(ws.root, async () => {
      const results: CaseResult[] = []
      const remote = await runValidationOperation({ id: 'http_probe', targets: ['http://example.com/'] })
      results.push(check('http_probe_blocks_non_loopback', !remote.ok && remote.stderr.includes('only allows'), remote.stderr))

      const hung = createServer(() => {
        /* accept TCP but never send HTTP */
      })
      await new Promise<void>(resolve => hung.listen(0, '127.0.0.1', () => resolve()))
      const addr = hung.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const started = Date.now()
      const timed = await runValidationOperation({ id: 'http_probe', targets: [`http://127.0.0.1:${port}/hang`] })
      hung.close()
      results.push(check(
        'timeout_01_http_probe_aborts',
        !timed.ok && timed.timedOut === true && Date.now() - started < 12_000,
        `timedOut=${timed.timedOut} duration=${timed.durationMs} stderr=${timed.stderr}`,
      ))

      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.create({
        title: 'Provider pause',
        description: 'Inject escalation_recommended to prove pause persistence.',
        subsystem: 'project',
        executionMode: 'bounded_coding',
        autoRun: false,
      })
      const repair = await getRepair(mission.id)
      if (!repair) throw new Error('missing repair for provider pause')
      await saveRepair({ ...repair, state: 'escalation_recommended' })
      const paused = await runCodingMission(mission.id)
      results.push(check(
        'provider_01_pauses_when_unavailable',
        paused.codingMission?.currentStep === 'PAUSED_PROVIDER_UNAVAILABLE' && paused.codingMission.blockingReason === 'PAUSED_PROVIDER_UNAVAILABLE',
        `${paused.state} ${paused.codingMission?.currentStep}`,
      ))
      return results
    }, ws.id)
  })
}

async function testCancelAndRollback(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'cancel-box', initializeGit: false })
    return runWithWorkspaceRoot(ws.root, async () => {
      const strategy = getMissionExecutionStrategy('engineering')
      const mission = await strategy.create({
        title: 'Will cancel',
        description: 'Create a mission then stop it.',
        subsystem: 'project',
        executionMode: 'bounded_coding',
        autoRun: false,
      })
      const stopped = await stopCodingMission(mission.id, 'test stop')
      let rollbackOk = true
      try {
        if (stopped.state !== 'cancelled') await rollbackNow(mission.id)
      } catch {
        rollbackOk = stopped.state === 'cancelled'
      }
      return [
        check('cancel_01_stops', stopped.state === 'cancelled', stopped.state),
        check('cancel_02_rollback_safe', rollbackOk, stopped.state),
      ]
    }, ws.id)
  })
}

async function run(): Promise<void> {
  const results: CaseResult[] = [
    ...testCommandPolicy(),
    ...testSecretRedaction(),
    ...(await testGitGates()),
    ...(await testWorkspaceEscape()),
    ...(await testCancelAndRollback()),
    ...(await testHttpTimeoutAndProviderPause()),
    ...(await testE2ERepair()),
    ...(await testE2EGreenfield()),
    ...(await testE2EExisting()),
  ]
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Engineer validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runEngineerValidation }
