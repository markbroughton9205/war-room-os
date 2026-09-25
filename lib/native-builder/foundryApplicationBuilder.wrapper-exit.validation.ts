/**
 * Application Builder wrapper-exit / preview-ownership validation.
 * Does not rebuild or delete the Commander transportation project.
 * Does not stop the live 127.0.0.1:18780 preview.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { executeFoundryBrowserTool, isFoundryBrowserServiceRunning } from './foundryBrowserService'
import {
  clearWrapperTimers,
  httpGetNoKeepAlive,
  inspectRetainedApplicationPreview,
  releaseMissionWrapperResources,
  scheduleWrapperTimer,
  snapshotWrapperHandles,
  wrapperTimerCount,
} from './foundryApplicationBuilderLifecycle'
import { findContinuableProject, pickFreeLoopbackPort, startProjectProcess } from './foundryProjectIsolation'
import {
  adoptLoopbackPreview,
  findLiveProjectPreview,
  isPidAlive,
  stopOwnedProjectPreview,
} from './foundryProjectProcessRegistry'
import { heartbeatMission } from './foundryOperationsManager'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const LIVE_PROJECT = path.join(os.homedir(), 'FoundryProjects', 'professional-website-for-a')
const LIVE_PORT = 18780
const DUMMY_SERVER = `import http from 'node:http'
const port = Number(process.env.PORT || 18791)
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('wrapper-exit-fixture')
}).listen(port, '127.0.0.1')
`

async function writeDummyProject(root: string): Promise<{ projectRoot: string; projectId: string }> {
  const projectId = randomUUID()
  const projectRoot = path.join(root, `wrapper-exit-${projectId.slice(0, 8)}`)
  await mkdir(projectRoot, { recursive: true })
  await writeFile(path.join(projectRoot, 'server.mjs'), DUMMY_SERVER, 'utf8')
  await writeFile(path.join(projectRoot, 'index.html'), '<html><body>fixture</body></html>', 'utf8')
  return { projectRoot, projectId }
}

async function waitExit(child: ReturnType<typeof spawn>, timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: null, stdout, stderr: stderr + '\nTIMEOUT' })
    }, timeoutMs)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function spawnWrapperChild(mode: 'retain-preview' | 'no-preview' | 'fail', env: Record<string, string>) {
  const repo = resolveRepoRoot()
  return spawn(process.execPath, [
    '--loader', path.join(repo, 'scripts/ts-extension-loader.mjs'),
    '--experimental-transform-types',
    path.join(repo, 'lib/native-builder/foundryApplicationBuilder.wrapper-exit.validation.ts'),
    `--child=${mode}`,
  ], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function runChildMode(mode: string): Promise<void> {
  if (mode === 'fail') {
    console.log('WRAPPER_CHILD_FAIL')
    process.exit(2)
  }
  const projectRoot = process.env.FOUNDRY_WRAPPER_EXIT_PROJECT_ROOT
  const projectId = process.env.FOUNDRY_WRAPPER_EXIT_PROJECT_ID
  const port = Number(process.env.FOUNDRY_WRAPPER_EXIT_PORT)
  if (!projectRoot || !projectId || !Number.isFinite(port)) process.exit(1)
  const retain = mode === 'retain-preview'
  const started = await startProjectProcess({
    projectRoot,
    cmd: 'node',
    args: ['server.mjs'],
    label: 'foundry-app-preview',
    missionId: `wrapper-child-${mode}`,
    env: { PORT: String(port) },
    projectId,
    port,
    processType: 'preview',
    retainAfterWrapper: retain,
  })
  if (!started.ok) process.exit(1)
  await releaseMissionWrapperResources({
    missionId: `wrapper-child-${mode}`,
    retainPreview: retain,
    previewRecordId: started.recordId,
  })
  if (!retain) {
    await stopOwnedProjectPreview({ projectId }).catch(() => undefined)
  }
  console.log(JSON.stringify({ ready: true, pid: started.pid, retain }))
  process.exit(0)
}

async function run(): Promise<void> {
  const liveBefore = await inspectRetainedApplicationPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
  const liveAdopt = existsSync(LIVE_PROJECT)
    ? await adoptLoopbackPreview({
        projectId: 'dd4af6c3-5603-4584-b0ad-88ff900df5c0',
        projectRoot: LIVE_PROJECT,
        missionId: 'wrapper-exit-adopt',
        port: LIVE_PORT,
      })
    : null
  const discovered = await findLiveProjectPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
  const continued = await findContinuableProject('Open the transportation website and add an FAQ section based on the research you already gathered.')

  const previousRoot = process.env.FOUNDRY_PROJECTS_ROOT
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'wr-foundry-wrapper-exit-'))
  process.env.FOUNDRY_PROJECTS_ROOT = tmpRoot
  const results: CaseResult[] = []
  const arbitraryKills = 0
  try {
    results.push(check('live_preview_http_before', liveBefore.httpOk && liveBefore.status === 200, `${liveBefore.status} ${liveBefore.url}`))
    results.push(check('live_project_preserved_before', liveBefore.projectPreserved, LIVE_PROJECT))
    results.push(check(
      'project_continuation_discovers_existing_preview',
      Boolean(discovered && continued && path.resolve(continued.projectRoot) === path.resolve(LIVE_PROJECT)),
      `adopt=${liveAdopt?.pid ?? 'none'} live=${discovered?.pid ?? 'none'} continued=${continued?.projectRoot ?? 'none'}`,
    ))

    const dummyA = await writeDummyProject(tmpRoot)
    const portA = await pickFreeLoopbackPort(18791)
    const retainChild = spawnWrapperChild('retain-preview', {
      FOUNDRY_PROJECTS_ROOT: tmpRoot,
      FOUNDRY_WRAPPER_EXIT_PROJECT_ROOT: dummyA.projectRoot,
      FOUNDRY_WRAPPER_EXIT_PROJECT_ID: dummyA.projectId,
      FOUNDRY_WRAPPER_EXIT_PORT: String(portA),
    })
    const retainExit = await waitExit(retainChild)
    const retainHttp = await httpGetNoKeepAlive(`http://127.0.0.1:${portA}/`)
    results.push(check(
      'successful_mission_retained_preview_wrapper_exit_0',
      retainExit.code === 0 && retainHttp.ok && /wrapper-exit-fixture/.test(retainHttp.text),
      `exit=${retainExit.code} http=${retainHttp.status} ${retainExit.stderr.slice(0, 180)}`,
    ))
    const registered = await findLiveProjectPreview({ projectId: dummyA.projectId, port: portA })
    results.push(check('preview_process_remains_registered', Boolean(registered && isPidAlive(registered.pid)), JSON.stringify(registered)))

    const dummyB = await writeDummyProject(tmpRoot)
    const portB = await pickFreeLoopbackPort(18792)
    const noneChild = spawnWrapperChild('no-preview', {
      FOUNDRY_PROJECTS_ROOT: tmpRoot,
      FOUNDRY_WRAPPER_EXIT_PROJECT_ROOT: dummyB.projectRoot,
      FOUNDRY_WRAPPER_EXIT_PROJECT_ID: dummyB.projectId,
      FOUNDRY_WRAPPER_EXIT_PORT: String(portB),
    })
    const noneExit = await waitExit(noneChild)
    const noneHttp = await httpGetNoKeepAlive(`http://127.0.0.1:${portB}/`)
    results.push(check(
      'successful_mission_no_retained_preview_wrapper_exit_0',
      noneExit.code === 0 && noneHttp.ok === false,
      `exit=${noneExit.code} http=${noneHttp.status}`,
    ))

    const failChild = spawnWrapperChild('fail', { FOUNDRY_PROJECTS_ROOT: tmpRoot })
    const failExit = await waitExit(failChild)
    results.push(check('failed_mission_wrapper_exits_nonzero', failExit.code !== 0 && failExit.code !== null, `exit=${failExit.code}`))

    const browserStart = await executeFoundryBrowserTool('browser.start', {}, { repairId: 'wrapper-exit-browser' })
    if (browserStart.ok) {
      await executeFoundryBrowserTool('browser.stop', {}, { repairId: 'wrapper-exit-browser' })
    }
    await releaseMissionWrapperResources({ missionId: 'wrapper-exit-browser', retainPreview: true })
    results.push(check(
      'temporary_browser_context_closes',
      isFoundryBrowserServiceRunning() === false,
      `startOk=${browserStart.ok} running=${isFoundryBrowserServiceRunning()}`,
    ))

    scheduleWrapperTimer(() => undefined, 60_000)
    const beforeClear = wrapperTimerCount()
    clearWrapperTimers()
    results.push(check('temporary_timers_cleared', beforeClear === 1 && wrapperTimerCount() === 0, `before=${beforeClear} after=${wrapperTimerCount()}`))

    const completeMission = { status: 'COMPLETE', lockClaims: [], lastHeartbeat: 'stale' } as unknown as FoundryMissionRecord
    await heartbeatMission(completeMission, 'should-not-run')
    results.push(check(
      'mission_heartbeat_stops_after_terminal_state',
      completeMission.lastHeartbeat === 'stale',
      String(completeMission.lastHeartbeat),
    ))

    const beforeHandles = snapshotWrapperHandles()
    for (let i = 0; i < 2; i += 1) {
      const dummy = await writeDummyProject(tmpRoot)
      const port = await pickFreeLoopbackPort(18793)
      const started = await startProjectProcess({
        projectRoot: dummy.projectRoot,
        cmd: 'node',
        args: ['server.mjs'],
        label: 'foundry-app-preview',
        missionId: `leak-${i}`,
        env: { PORT: String(port) },
        projectId: dummy.projectId,
        port,
        processType: 'preview',
        retainAfterWrapper: true,
      })
      await stopOwnedProjectPreview({ projectId: dummy.projectId })
      results.push(check(`repeat_spawn_stop_${i}`, Boolean(started.ok), started.error ?? String(started.pid)))
    }
    const afterHandles = snapshotWrapperHandles()
    results.push(check(
      'repeated_mission_does_not_leak_wrapper_handles',
      afterHandles.pipes <= beforeHandles.pipes + 2 && afterHandles.childProcesses <= beforeHandles.childProcesses + 1,
      `before=${JSON.stringify(beforeHandles)} after=${JSON.stringify(afterHandles)}`,
    ))

    const stopDummy = await stopOwnedProjectPreview({ projectId: dummyA.projectId })
    const dummyGone = await httpGetNoKeepAlive(`http://127.0.0.1:${portA}/`)
    const liveAfterStopDummy = await httpGetNoKeepAlive(`http://127.0.0.1:${LIVE_PORT}/`)
    results.push(check(
      'stop_preview_terminates_only_owned_project_preview',
      stopDummy.killed.length >= 1 && dummyGone.ok === false && liveAfterStopDummy.status === 200,
      `killed=${stopDummy.killed.join(',')} dummy=${dummyGone.status} live=${liveAfterStopDummy.status} refused=${stopDummy.refused.join(',')}`,
    ))

    const refuseSelf = await stopOwnedProjectPreview({ projectId: 'no-such-project' })
    results.push(check(
      'no_arbitrary_host_process_kill',
      refuseSelf.killed.length === 0 && arbitraryKills === 0,
      JSON.stringify(refuseSelf),
    ))

    const liveAfter = await inspectRetainedApplicationPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
    const files = existsSync(path.join(LIVE_PROJECT, 'faq.html')) && existsSync(path.join(LIVE_PROJECT, 'foundry-memory.json'))
    results.push(check('no_project_deletion', files && liveAfter.projectPreserved, LIVE_PROJECT))
    results.push(check('live_preview_http_after', liveAfter.httpOk && liveAfter.status === 200, String(liveAfter.status)))
  } finally {
    if (previousRoot === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previousRoot
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry Application Builder wrapper exit: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
  process.exit(0)
}

const childArg = process.argv.find(arg => arg.startsWith('--child='))
if (childArg) {
  await runChildMode(childArg.slice('--child='.length))
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryApplicationBuilderWrapperExitValidation }
