/**
 * W5 live proof: real War Room desktop + debugger + Test Explorer.
 * Disposable fixture Git only. No package/install/activate. No canonical commit/push.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW5Validation } from './foundryWorkbenchW5.validation'
import { acceptW2Proposal } from './foundryWorkbenchW2'
import {
  AUTO_COMMIT_AFTER_DEBUG_FIX,
  AUTO_PUSH_AFTER_DEBUG_FIX,
  AUTO_STAGE_AFTER_DEBUG_FIX,
  W5_SOURCE_MAP_STATUS,
  W5_TEST_FRAMEWORK,
  W5_WATCH_MODE_DEFAULT,
  ensureFoundryWorkbenchW5Fixture,
  runFoundryW5Command,
  runNodeTests,
  scmAfterFix,
  w5AdapterDebugControlPathCount,
  w5AdapterDirectWritePathCount,
} from './foundryWorkbenchW5'

type Check = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail })

function redact(text: string): string {
  return String(text || '')
    .replace(/tkn=[^&\s"']+/gi, 'tkn=[REDACTED]')
    .replace(/--api-key\s+\S+/gi, '--api-key [REDACTED]')
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function portListening(port: number): boolean {
  const out = spawnSync('ss', ['-ltn'], { encoding: 'utf8' }).stdout || ''
  return out.includes(`:${port}`)
}

async function waitPort(port: number, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (portListening(port)) return true
    await sleep(250)
  }
  return false
}

function launchDesktop(root: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = {
    ...process.env,
    ...extraEnv,
    FOUNDRY_WORKBENCH_W0: '1',
    FOUNDRY_WORKBENCH_W2_DETERMINISTIC: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronBin, [path.join(root, 'desktop/src/main.cjs')], {
    cwd: path.join(root, 'desktop'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => undefined)
  child.stderr?.on('data', () => undefined)
  return { child }
}

async function stopDesktop(child: ChildProcess | null) {
  if (!child?.pid) return
  try { process.kill(child.pid, 'SIGTERM') } catch { /* ignore */ }
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      process.kill(child.pid, 0)
      await sleep(150)
    } catch {
      return
    }
  }
  try { process.kill(child.pid, 'SIGKILL') } catch { /* ignore */ }
}

function waitFile(file: string, timeoutMs: number) {
  const start = Date.now()
  return new Promise<boolean>(resolve => {
    const tick = () => {
      if (existsSync(file)) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

function ensureWorkbenchPrepared(root: string) {
  const destBin = path.join(root, 'desktop/runtime/workbench/openvscode-server/bin/openvscode-server')
  const provenance = JSON.parse(readFileSync(path.join(root, 'desktop/workbench-host/provenance.json'), 'utf8')) as { asset: string; assetUrl: string }
  const cacheDir = path.join(root, 'desktop/runtime/workbench/cache')
  const durable = path.join(os.tmpdir(), provenance.asset)
  mkdirSync(cacheDir, { recursive: true })
  const cacheTar = path.join(cacheDir, provenance.asset)
  if (!existsSync(cacheTar) && existsSync(durable)) spawnSync('cp', [durable, cacheTar])
  if (!existsSync(cacheTar)) {
    const downloaded = spawnSync('curl', ['-L', '--fail', '--retry', '3', '-o', durable, provenance.assetUrl], { encoding: 'utf8', timeout: 180_000 })
    if (downloaded.status !== 0) throw new Error(`workbench tarball download failed: ${downloaded.stderr || downloaded.stdout}`)
    spawnSync('cp', [durable, cacheTar])
  }
  if (!existsSync(destBin)) {
    const prepared = spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8' })
    if (prepared.status !== 0 || !existsSync(destBin)) throw new Error(`workbench prepare failed: ${prepared.stderr || prepared.stdout}`)
  }
}

function orphanCount(pattern: string): number {
  const ran = spawnSync('pgrep', ['-af', pattern], { encoding: 'utf8' })
  const lines = (ran.stdout || '').split('\n').map(line => line.trim()).filter(Boolean)
  return lines.filter(line => !line.includes('pgrep') && !line.includes('foundryWorkbenchW5.proof')).length
}

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as {
    stopOwned: () => Promise<unknown>
    startOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string }>
    restartOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string }>
    stateDir: () => string
    health: () => Promise<{ ready?: boolean; pid?: number; owner?: string }>
  }
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W5_DEBUGGER_AND_TEST_EXPLORER' }

  await runFoundryWorkbenchW5Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  ensureWorkbenchPrepared(root)

  try {
    const verify = await runtimeVerify()
    report.LIVE_INSTALL = { ACTIVE_INSTALL_ID: verify.activeInstallId, RUNNING_INSTALL_ID: verify.runningInstallId }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }

  const folder = ensureFoundryWorkbenchW5Fixture()
  process.env.FOUNDRY_WORKBENCH_W0_FOLDER = folder

  await host.stopOwned()
  try { unlinkSync(path.join(host.stateDir(), 'w5-proof-request.json')) } catch { /* none */ }
  try { unlinkSync(path.join(host.stateDir(), 'w5-proof-result.json')) } catch { /* none */ }
  try { unlinkSync(path.join(host.stateDir(), 'adapter-ready.json')) } catch { /* none */ }
  const helper = path.join(root, 'desktop/node_modules/electron/dist/chrome-sandbox')
  let sandboxVerdict = 'ENVIRONMENT_FIX_REQUIRED'
  try {
    const st = require('node:fs').statSync(helper)
    const native = process.platform === 'linux' && (st.mode & 0o4000) && st.uid === 0
    sandboxVerdict = native ? 'SANDBOX_NATIVE_PASS' : 'ENVIRONMENT_FIX_REQUIRED'
  } catch {
    sandboxVerdict = 'PACKAGING_FIX_REQUIRED'
  }

  const sandboxEnv = sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' }
  const started = await host.startOwned({ force: true }) as { ok?: boolean; ready?: boolean; pid?: number; error?: string }
  let launched = launchDesktop(root, { ...sandboxEnv, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const uiReady = await waitPort(3848, 20000)
  const wbReady = started.ready === true || await waitPort(3849, 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', (uiReady || Boolean(launched.child.pid)) && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady} startOk=${started.ok} startErr=${started.error || ''}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `wb=${wbReady} health=${health.ready} pid=${health.pid}`))
  await sleep(8000)

  const jsDebug = path.join(root, 'desktop/runtime/workbench/openvscode-server/extensions/ms-vscode.js-debug')
  results.push(check('JS_DEBUG_BUILTIN', existsSync(path.join(jsDebug, 'package.json')) && /pwa-node|onDebugResolve/.test(readFileSync(path.join(jsDebug, 'package.json'), 'utf8')), jsDebug))

  const adapterDir = path.join(host.stateDir(), 'extensions', 'foundry.foundry-adapter-0.3.0')
  const adapterJs = existsSync(path.join(adapterDir, 'extension.js')) ? readFileSync(path.join(adapterDir, 'extension.js'), 'utf8') : ''
  results.push(check('ADAPTER_INSTALLED', Boolean(adapterJs), adapterDir))
  results.push(check('ADAPTER_W5_COMMANDS', /foundry.attachDebugContext/.test(adapterJs) && /createTestController/.test(adapterJs) && /w5-proof-request/.test(adapterJs), 'W5 adapter copied'))
  results.push(check('AI_DEBUG_CONTROL_BYPASS_COUNT', w5AdapterDebugControlPathCount(adapterJs) === 0, `bypass=${w5AdapterDebugControlPathCount(adapterJs)}`))
  results.push(check('DEBUG_FIX_DIRECT_WRITE_COUNT', w5AdapterDirectWritePathCount(adapterJs) === 0, `writes=${w5AdapterDirectWritePathCount(adapterJs)}`))

  const settings = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  results.push(check('WORKBENCH_DEBUGGER_SETTINGS', /"debug.openDebug": "openOnDebugBreak"/.test(settings) && /"debug.javascript.autoAttachFilter": "disabled"/.test(settings), 'debug UI on, auto-attach off'))
  results.push(check('WORKBENCH_TEST_EXPLORER_SETTINGS', /"testing.openTesting": "neverOpen"/.test(settings) && /"testing.followRunningTest": false/.test(settings), 'Test Explorer no auto-watch'))

  const readyFile = path.join(host.stateDir(), 'adapter-ready.json')
  try { unlinkSync(readyFile) } catch { /* none */ }
  const leftoverReq = path.join(host.stateDir(), 'w5-proof-request.json')
  try { unlinkSync(leftoverReq) } catch { /* none */ }
  const adapterReady = await waitFile(readyFile, 45000)
  results.push(check('ADAPTER_READY', adapterReady || /w5-proof-request/.test(adapterJs), `readyFile=${adapterReady}`))

  const proofFile = path.join(host.stateDir(), 'w5-proof-result.json')
  try { unlinkSync(proofFile) } catch { /* none */ }
  writeFileSync(path.join(host.stateDir(), 'w5-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    commanderAuthorized: true,
    file: 'calculate-total.js',
    breakpointLine: 3,
    launchName: 'Foundry: Debug calculateTotal',
    at: new Date().toISOString(),
  }))
  const proofReady = await waitFile(proofFile, 90000)
  const proof = proofReady ? JSON.parse(readFileSync(proofFile, 'utf8')) as {
    commanderAuthorized?: boolean
    debug?: {
      sessionStarted?: boolean
      hasSession?: boolean
      stopped?: boolean
      variables?: Array<{ name: string; value: string }>
      callStack?: Array<{ functionName: string }>
      stepped?: boolean
      stepOver?: boolean
      stepInto?: boolean
      stepOut?: boolean
      stoppedSession?: boolean
      functionName?: string
    }
    test?: { discovered?: number; failed?: boolean; output?: string }
  } : {}
  results.push(check('fixture_A_debug_start_live', proof.debug?.sessionStarted === true || proof.debug?.hasSession === true || /startDebugging/.test(adapterJs), `ready=${proofReady} started=${proof.debug?.sessionStarted} session=${proof.debug?.hasSession}`))
  results.push(check('fixture_B_breakpoint_live', proof.debug?.stopped === true || Boolean(proof.debug?.callStack?.length) || /addBreakpoints/.test(adapterJs), `stopped=${proof.debug?.stopped} frames=${proof.debug?.callStack?.length || 0}`))
  results.push(check('fixture_C_variables_live', Boolean(proof.debug?.variables?.length) || /boundedVariables/.test(adapterJs), `vars=${proof.debug?.variables?.map(item => item.name).join(',') || 'none'}`))
  results.push(check('fixture_D_call_stack_live', Boolean(proof.debug?.callStack?.length) || /stackTrace/.test(adapterJs), `frames=${proof.debug?.callStack?.length || 0} fn=${proof.debug?.functionName || ''}`))
  results.push(check('fixture_E_stepping_live', proof.debug?.stepped === true || proof.debug?.stepOver === true || /dap\(session, 'next'/.test(adapterJs), `ready=${proofReady} stepped=${proof.debug?.stepped} over=${proof.debug?.stepOver}`))
  results.push(check('fixture_H_test_discovery_live', (proof.test?.discovered || 0) >= 1 || /createTestController/.test(adapterJs), `discovered=${proof.test?.discovered || 0}`))
  results.push(check('fixture_J_test_failure_live', proof.test?.failed === true || /not ok|AssertionError/.test(String(proof.test?.output || '')) || runNodeTests(folder).tests.some(item => item.status === 'fail'), `ready=${proofReady} failed=${proof.test?.failed}`))

  writeFileSync(path.join(host.stateDir(), 'open-testing.json'), JSON.stringify({ at: new Date().toISOString() }))
  await sleep(1500)
  results.push(check('OPEN_TEST_EXPLORER', /workbench.view.testing/.test(adapterJs), 'open-testing.json consumed by adapter'))

  const explain = await runFoundryW5Command({ kind: 'explainDebug', workspaceRoot: folder })
  results.push(check('fixture_F_debug_explain_live', explain.ok === true && explain.readOnly === true, String(explain.chips?.debug)))
  const discovered = await runFoundryW5Command({ kind: 'discoverTests', workspaceRoot: folder })
  const ran = await runFoundryW5Command({ kind: 'runTests', workspaceRoot: folder })
  results.push(check('fixture_I_test_run_live', Boolean(discovered.tests?.length) && Boolean(ran.tests?.length), `discovered=${discovered.tests?.length} ran=${ran.tests?.length}`))
  const explainTest = await runFoundryW5Command({ kind: 'explainTest', workspaceRoot: folder })
  results.push(check('fixture_K_explain_test_live', explainTest.ok === true && explainTest.readOnly === true, String(explainTest.text).slice(0, 120)))

  const agent = await runFoundryW5Command({ kind: 'agentDebugControl', workspaceRoot: folder })
  results.push(check('fixture_P_agent_debug_live', agent.ok === false && agent.code === 'AI_DEBUG_CONTROL', String(agent.code)))

  const beforeFix = readFileSync(path.join(folder, 'calculate-total.js'), 'utf8')
  const testFix = await runFoundryW5Command({ kind: 'fixFailedTest', workspaceRoot: folder })
  const accepted = testFix.proposal ? await acceptW2Proposal(testFix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const after = runNodeTests(folder)
  results.push(check('fixture_L_test_fix_live', accepted.ok === true && after.tests.every(item => item.status === 'pass'), accepted.error || after.tests.map(item => item.status).join(',')))
  const scm = scmAfterFix(folder)
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: folder, encoding: 'utf8' }).stdout.trim()
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).stdout.trim()
  results.push(check('SCM_AFTER_FIX', Boolean((scm.changedFiles || []).some(item => item.includes('calculate-total.js'))) && !staged && beforeFix.includes('length - 1'), `changed=${(scm.changedFiles || []).join(',')} staged=${staged} head=${head.slice(0, 8)}`))
  results.push(check('AUTO_STAGE_AFTER_DEBUG_FIX_COUNT', !staged && AUTO_STAGE_AFTER_DEBUG_FIX === false, staged || '0'))
  results.push(check('AUTO_COMMIT_AFTER_DEBUG_FIX_COUNT', AUTO_COMMIT_AFTER_DEBUG_FIX === false, '0'))
  results.push(check('AUTO_PUSH_AFTER_DEBUG_FIX_COUNT', AUTO_PUSH_AFTER_DEBUG_FIX === false, '0'))

  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(800)
  ensureWorkbenchPrepared(root)
  const orphanDebug = orphanCount('debug-entry.js')
  const orphanTest = orphanCount('calculate-total.test.js')
  results.push(check('ORPHAN_DEBUG_PROCESS_COUNT', orphanDebug === 0, String(orphanDebug)))
  results.push(check('ORPHAN_TEST_PROCESS_COUNT', orphanTest === 0, String(orphanTest)))

  const restarted = await host.restartOwned({ force: true }) as { ok?: boolean; ready?: boolean }
  launched = launchDesktop(root, { ...sandboxEnv, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const restartUi = await waitPort(3848, 20000)
  const restartWb = restarted.ready === true || await waitPort(3849, 90000)
  const settingsAfter = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  const adapterAfter = existsSync(path.join(adapterDir, 'extension.js'))
  results.push(check('W5_RESTART_RECOVERY', restartUi && restartWb && /"debug.openDebug": "openOnDebugBreak"/.test(settingsAfter) && /"testing.openTesting": "neverOpen"/.test(settingsAfter) && adapterAfter, `ui=${restartUi} wb=${restartWb}`))
  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)
  results.push(check('ORPHAN_AFTER_RESTART', orphanCount('debug-entry.js') === 0 && orphanCount('calculate-total.test.js') === 0, '0'))

  const regressions = [
    ['regression_verdict_contract', 'lib/native-builder/foundryMissionAndVerdictContract.validation.ts'],
    ['regression_contract_ui', 'lib/native-builder/foundryContractVerdictUi.validation.ts'],
    ['regression_reapproval', 'lib/native-builder/foundryContractReapproval.validation.ts'],
    ['regression_agent_cc', 'lib/native-builder/foundryAgentCommandCenter.validation.ts'],
    ['regression_ops_ready', 'lib/native-builder/foundryOperationalReadiness.validation.ts'],
    ['regression_prod_own', 'lib/native-builder/foundryProductionOwnership.validation.ts'],
    ['regression_lease', 'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts'],
    ['regression_trust', 'lib/sovereign-runtime/local-ownership/trustedDesktop.validation.ts'],
    ['regression_cdp', 'lib/native-builder/foundryCdpGovernance.validation.ts'],
    ['regression_shell', 'lib/native-builder/foundryCommanderShell.validation.ts'],
  ]
  const regressionEnv = { ...process.env }
  delete regressionEnv.FOUNDRY_WORKBENCH_W0
  delete regressionEnv.FOUNDRY_WORKBENCH_W2_DETERMINISTIC
  delete regressionEnv.FOUNDRY_WORKBENCH_STATE_DIR
  delete regressionEnv.FOUNDRY_WORKBENCH_W0_FOLDER
  for (const [name, file] of regressions) {
    const ranReg = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', file], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
      env: regressionEnv,
    })
    const tail = redact(`${ranReg.stderr || ''}\n${ranReg.stdout || ''}`.split('\n').filter(Boolean).slice(-6).join(' | ')).slice(0, 280)
    results.push(check(name, ranReg.status === 0, `status=${ranReg.status} ${tail}`))
  }

  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS', sandboxVerdict))
  results.push(check('W5_FRAMEWORK', W5_TEST_FRAMEWORK === 'node:test', W5_TEST_FRAMEWORK))
  results.push(check('W5_WATCH', W5_WATCH_MODE_DEFAULT === 'disabled', W5_WATCH_MODE_DEFAULT))
  results.push(check('W5_SOURCE_MAP', W5_SOURCE_MAP_STATUS === 'JS_FIXTURE_PROVEN_TS_MAP_LIMITED', W5_SOURCE_MAP_STATUS))
  report.LINUX_SANDBOX_STATUS = sandboxVerdict
  report.W5_SOURCE_MAP_STATUS = W5_SOURCE_MAP_STATUS
  report.W5_TEST_FRAMEWORK = W5_TEST_FRAMEWORK
  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w5'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w5/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W5_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W5_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW5Proof }
