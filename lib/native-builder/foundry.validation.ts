/**
 * Foundry activation suite: local-coder adapter, structured actions, roles, sessions,
 * persistence, and novel greenfield missions through SingleAgentEngineeringStrategy.
 */
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { createNewProjectWorkspace } from '@/lib/native-builder/workspaceRegistry'
import { parseFoundryActions } from '@/lib/native-builder/foundryActions'
import { parseDirectRoleMention, selectSpecialists } from '@/lib/native-builder/foundryRoles'
import { pickLocalCoderModel, resolveLocalCoder, extractJsonObject } from '@/lib/native-builder/localCoder'
import { createFoundrySession, getFoundrySession, appendFoundryChat, listFoundrySessions } from '@/lib/native-builder/foundrySessions'
import { classifyArgv } from '@/lib/native-builder/commandPolicy'
import { validatePatchPolicy } from '@/lib/native-builder/patchPolicy'
import { classifyDevRuntime, isDevServerLaunch, isUnnecessaryDevScriptPackageMutation } from '@/lib/native-builder/foundryDevRuntime'
import type { NativeCodingMissionState } from '@/lib/native-builder/types'

const execFileAsync = promisify(execFile)

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function withProjectsRoot<T>(fn: (projectsRoot: string) => Promise<T>): Promise<T> {
  const previous = process.env.WAR_ROOM_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-foundry-e2e-'))
  process.env.WAR_ROOM_PROJECTS_ROOT = projectsRoot
  try {
    return await fn(projectsRoot)
  } finally {
    if (previous === undefined) delete process.env.WAR_ROOM_PROJECTS_ROOT
    else process.env.WAR_ROOM_PROJECTS_ROOT = previous
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
}

async function seedGit(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'foundry-e2e@warroom.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Foundry E2E'], { cwd: dir })
}

function unitTests(): CaseResult[] {
  const mention = parseDirectRoleMention('@debugger figure out why this crashes.')
  const parsedOk = parseFoundryActions({
    role: 'BUILDER',
    summary: 'add file',
    actions: [{ type: 'CREATE_FILE', path: 'app.mjs', content: 'export const x = 1\n' }],
  })
  const parsedBad = parseFoundryActions({ actions: [{ type: 'SHELL', command: 'rm -rf /' }] })
  const parsedRm = parseFoundryActions({ actions: [{ type: 'START_PROCESS', cmd: 'rm', args: ['-rf', '/'] }] })
  return [
    check('role_01_direct_mention', mention?.role === 'DEBUGGER' && mention.remainder.includes('crashes'), JSON.stringify(mention)),
    check('role_02_school_mode_web', selectSpecialists('Build a local inventory web app').includes('UI_ENGINEER') && selectSpecialists('Build a local inventory web app').includes('BUILDER'), selectSpecialists('Build a local inventory web app').join(',')),
    check('role_03_cli_roster', selectSpecialists('Build a command-line expense tracker').includes('TEST_ENGINEER'), selectSpecialists('Build a command-line expense tracker').join(',')),
    check('action_01_create_file_valid', parsedOk.ok === true, JSON.stringify(parsedOk)),
    check('action_02_rejects_shell', parsedOk.ok && !parsedBad.ok, parsedBad.ok ? 'accepted SHELL' : parsedBad.error),
    check('action_03_policy_still_denies_rm', classifyArgv('rm', ['-rf', '/']).policyClass === 'DENIED', classifyArgv('rm', ['-rf', '/']).reason),
    check('action_04_start_process_denied', !parsedRm.ok, parsedRm.ok ? 'accepted rm' : parsedRm.error),
    check('coder_01_prefers_qwen_coder', pickLocalCoderModel(['huihui_ai/qwen3-abliterated:14b', 'qwen2.5-coder:14b'], 'BUILDER') === 'qwen2.5-coder:14b', 'ok'),
    check('coder_02_json_extract', extractJsonObject('noise ```json\n{"a":1}\n```')?.a === 1, 'ok'),
  ]
}

function devRuntimeUnitTests(): CaseResult[] {
  const pkgPatch = parseFoundryActions({
    role: 'BUILDER',
    summary: 'remove the next dev script so Commander testing does not use a development server',
    actions: [{
      type: 'PATCH_FILE',
      path: 'package.json',
      matchText: '"dev": "next dev --port 3001"',
      replacementText: '',
      reason: 'dev script conflicts with no development server',
    }],
  })
  const verdict = classifyDevRuntime({
    productionRouteOn3848: true,
    relativeFoundryApis: true,
    installedSpawnsNextDev: false,
    installedSpawnsPort3001: false,
    missionRequiresPort3001: false,
  })
  const warRoomPkg = validatePatchPolicy({
    issueId: 'foundry-dev-runtime',
    sourceKind: 'deterministic',
    proposerId: 'test',
    diagnosis: 'x',
    confidence: 'high',
    relevantFiles: ['package.json'],
    plannedChanges: [{
      file: 'package.json',
      reason: 'x',
      operation: 'replace_range',
      patch: { operation: 'replace_range', file: 'package.json', expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' },
    }],
    validations: [],
    risks: [],
    rollbackPlan: 'none',
    generatedAt: new Date().toISOString(),
  }, 'war_room_repair')
  return [
    check('dev_01_tooling_not_runtime', verdict.requirement === 'PASS' && verdict.runtimeRequired === false, verdict.detail),
    check(
      'dev_02_skips_package_json_dev_patch',
      pkgPatch.ok && isUnnecessaryDevScriptPackageMutation(pkgPatch.actions[0]),
      pkgPatch.ok ? pkgPatch.actions[0].type : pkgPatch.error,
    ),
    check('dev_03_denies_pnpm_run_dev', classifyArgv('pnpm', ['run', 'dev']).policyClass === 'DENIED', classifyArgv('pnpm', ['run', 'dev']).reason),
    check('dev_04_denies_next_dev', classifyArgv('next', ['dev', '--port', '3001']).policyClass === 'DENIED', classifyArgv('next', ['dev', '--port', '3001']).reason),
    check('dev_05_still_allows_pnpm_install', classifyArgv('pnpm', ['install']).policyClass === 'SAFE_LOCAL', classifyArgv('pnpm', ['install']).reason),
    check(
      'dev_06_path_denylist_unchanged',
      !warRoomPkg.ok && warRoomPkg.violations.some(v => v.rule === 'path_denylist'),
      JSON.stringify(warRoomPkg.violations),
    ),
    check('dev_07_not_dev_server_launch', isDevServerLaunch('node', ['server.mjs']) === false, 'ok'),
    check('dev_08_is_dev_server_launch', isDevServerLaunch('pnpm', ['dev']) === true, 'ok'),
  ]
}

async function testSessions(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'session-box', initializeGit: false })
    return runWithWorkspaceRoot(ws.root, async () => {
      const created = await createFoundrySession({ title: 'Initial Build', workspaceId: ws.id, projectName: 'session-box' })
      const second = await createFoundrySession({ title: 'Payments', workspaceId: ws.id, projectName: 'session-box' })
      await appendFoundryChat(created.id, 'COMMANDER', 'Build the first slice.')
      const restored = await getFoundrySession(created.id)
      const listed = await listFoundrySessions(ws.id)
      return [
        check('session_01_created', Boolean(created.id), created.id),
        check('session_02_multiple_per_project', listed.length >= 2 && listed.some(s => s.title === 'Payments'), String(listed.length)),
        check('session_03_chat_persists', Boolean((restored?.chat.length ?? 0) === 1 && restored?.chat[0]?.text.includes('first slice')), String(restored?.chat.length)),
        check('session_04_second_distinct', second.id !== created.id, `${created.id} ${second.id}`),
      ]
    }, ws.id)
  })
}

async function runNovel(name: string, prompt: string, evidence: (root: string, mission: { status: string; engineer?: NativeCodingMissionState }) => Promise<CaseResult[]>): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
    for (const k of keys) delete process.env[k]
    try {
      const ws = await createNewProjectWorkspace({ name, initializeGit: true })
      await seedGit(ws.root)
      return runWithWorkspaceRoot(ws.root, async () => {
        const coder = await resolveLocalCoder()
        if (!coder.available) {
          return [check(`novel_${name}_local_coder`, false, `LOCAL_CODER_UNAVAILABLE: ${coder.detail}`)]
        }
        const strategy = getMissionExecutionStrategy('engineering')
        const mission = await strategy.create({
          title: prompt.slice(0, 80),
          description: prompt,
          subsystem: 'project',
          executionMode: 'bounded_coding',
          autoRun: true,
          waitForCompletion: true,
          naturalLanguage: prompt,
        })
        return evidence(ws.root, mission)
      }, ws.id)
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  })
}

async function testNovelInventory(): Promise<CaseResult[]> {
  const prompt = 'Build a small local inventory management web app with products, quantities, search, add/edit/delete and persistent local storage.'
  return runNovel('inventory', prompt, async (root, mission) => {
    const pkg = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '')
    const files = mission.engineer?.filesChanged ?? []
    const hasSource = files.some(f => f.endsWith('.mjs') || f.endsWith('.js')) || Boolean(pkg)
    return [
      check('e2e_inventory_01_local_mode', mission.engineer?.foundryMode === 'FOUNDRY_LOCAL_MODE' || mission.engineer?.localCoderStatus === 'LOCAL_CODER_READY' || mission.status === 'completed', `${mission.status} ${mission.engineer?.foundryMode} ${mission.engineer?.localCoderStatus}`),
      check('e2e_inventory_02_files', hasSource, `files=${files.join(',')} pkg=${pkg.slice(0, 80)}`),
      check('e2e_inventory_03_not_task_tracker', !pkg.includes('task-tracker'), pkg.slice(0, 120)),
      check('e2e_inventory_04_no_pause_for_cloud', mission.engineer?.blockingReason !== 'PAUSED_PROVIDER_UNAVAILABLE', mission.engineer?.blockingReason ?? 'none'),
    ]
  })
}

async function testNovelExpense(): Promise<CaseResult[]> {
  const prompt = 'Build a command-line expense tracker with categories, totals, persistent local data and tests.'
  return runNovel('expense', prompt, async (root, mission) => {
    const pkg = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '')
    const listing = await readFile(path.join(root, 'app.mjs'), 'utf8').catch(() => readFile(path.join(root, 'expense.mjs'), 'utf8').catch(() => ''))
    return [
      check('e2e_expense_01_distinct_from_inventory', !pkg.includes('inventory') && !listing.includes('inventory management'), `pkg=${pkg.slice(0, 80)}`),
      check('e2e_expense_02_files_exist', Boolean(pkg) || listing.length > 0 || (mission.engineer?.filesChanged?.length ?? 0) > 0, JSON.stringify(mission.engineer?.filesChanged)),
      check('e2e_expense_03_cloud_off', mission.engineer?.blockingReason !== 'PAUSED_PROVIDER_UNAVAILABLE', mission.engineer?.blockingReason ?? 'none'),
    ]
  })
}

async function testExistingAndPersistence(): Promise<CaseResult[]> {
  return withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'existing-greeting', initializeGit: true })
    await writeFile(path.join(ws.root, 'package.json'), JSON.stringify({ name: 'existing-greeting', type: 'module', scripts: { test: 'node --test' } }, null, 2), 'utf8')
    await writeFile(path.join(ws.root, 'greeting.mjs'), "export const GREETING = 'hello'\n", 'utf8')
    await writeFile(path.join(ws.root, 'test.mjs'), "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { GREETING } from './greeting.mjs'\ntest('g', () => assert.equal(GREETING, 'hello'))\n", 'utf8')
    await seedGit(ws.root)
    return runWithWorkspaceRoot(ws.root, async () => {
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
      const sessionId = mission.engineer?.sessionId
      const restored = sessionId ? await getFoundrySession(sessionId) : null
      const reread = await strategy.get(mission.id)
      return [
        check('e2e_existing_01_greeting', after.includes("export const GREETING = 'hello'"), after),
        check('e2e_existing_02_farewell', after.includes('FAREWELL'), after),
        check('persist_01_session_linked', Boolean(sessionId), String(sessionId)),
        check('persist_02_restore_mission', reread?.id === mission.id, reread?.id ?? 'missing'),
        check('persist_03_restore_session', Boolean(restored?.missionIds.includes(mission.id)), JSON.stringify(restored?.missionIds)),
      ]
    }, ws.id)
  })
}

async function testCloudOffStatus(): Promise<CaseResult[]> {
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  for (const k of keys) delete process.env[k]
  try {
    const coder = await resolveLocalCoder()
    return [
      check('cloud_off_01_hosted_unavailable', coder.hostedStatus === 'HOSTED_CODER_UNAVAILABLE', coder.hostedStatus),
      check('cloud_off_02_local_probed', coder.status === 'LOCAL_CODER_READY' || coder.status === 'LOCAL_CODER_UNAVAILABLE', `${coder.status} ${coder.detail}`),
      check('cloud_off_03_not_fake_online', coder.status !== 'LOCAL_CODER_READY' || Boolean(coder.codingModel), coder.codingModel ?? 'none'),
    ]
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(unitTests())
  add(devRuntimeUnitTests())
  add(await testCloudOffStatus())
  add(await testSessions())
  add(await testExistingAndPersistence())
  add(await testNovelInventory())
  add(await testNovelExpense())
  const failed = results.filter(r => !r.pass)
  console.log(`Foundry validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryValidation }
