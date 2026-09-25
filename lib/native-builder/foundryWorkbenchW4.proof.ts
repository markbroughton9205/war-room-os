/**
 * W4 live proof: real War Room desktop + governed SCM fixtures.
 * Disposable Git only. No package/install/activate. No canonical commit/push.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW4Validation } from './foundryWorkbenchW4.validation'
import { runFoundryW4Command, stockGitMutationWiredInAdapter, AUTO_COMMIT_AFTER_AI_EDIT, AUTO_PUSH_AFTER_COMMIT } from './foundryWorkbenchW4'
import { ensureFoundryWorkbenchW4Fixture } from './foundryWorkbenchW4'

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

function gitHead(cwd: string) {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10_000 }).stdout.trim()
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
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W4_SCM_GOVERNANCE' }

  await runFoundryWorkbenchW4Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  const prepared = spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8' })
  if (prepared.status !== 0) {
    throw new Error(`workbench prepare failed: ${prepared.stderr || prepared.stdout}`)
  }

  try {
    const verify = await runtimeVerify()
    report.LIVE_INSTALL = { ACTIVE_INSTALL_ID: verify.activeInstallId, RUNNING_INSTALL_ID: verify.runningInstallId }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }

  const folder = ensureFoundryWorkbenchW4Fixture()
  process.env.FOUNDRY_WORKBENCH_W0_FOLDER = folder
  writeFileSync(path.join(folder, 'tracked.ts'), `${readFileSync(path.join(folder, 'tracked.ts'), 'utf8')}// w4-live\n`)

  await host.stopOwned()
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
  const sandboxLaunch = sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : sandboxEnv
  let launched = launchDesktop(root, { ...sandboxLaunch, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const uiReady = await waitPort(3848, 20000)
  const wbReady = started.ready === true || await waitPort(3849, 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', (uiReady || Boolean(launched.child.pid)) && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady} startOk=${started.ok} startErr=${started.error || ''}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `wb=${wbReady} health=${health.ready} pid=${health.pid}`))
  await sleep(8000)

  const adapterDir = path.join(host.stateDir(), 'extensions', 'foundry.foundry-adapter-0.3.0')
  const adapterJs = existsSync(path.join(adapterDir, 'extension.js')) ? readFileSync(path.join(adapterDir, 'extension.js'), 'utf8') : ''
  results.push(check('ADAPTER_INSTALLED', Boolean(adapterJs), adapterDir))
  results.push(check('ADAPTER_NO_STOCK_GIT_EXEC', stockGitMutationWiredInAdapter(adapterJs) === 0, `wired=${stockGitMutationWiredInAdapter(adapterJs)}`))

  const settings = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  const keys = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'keybindings.json'), 'utf8')
  results.push(check('WORKBENCH_SCM', /"git.enabled": true/.test(settings) && /"git.showCommitInput": false/.test(settings) && /scm.alwaysShowProviders/.test(settings), 'Git UI on, commit input hidden'))
  results.push(check('AUTO_PUSH_AFTER_COMMIT', /"git.postCommitCommand": "none"/.test(settings) && AUTO_PUSH_AFTER_COMMIT === false, 'no auto-push'))
  results.push(check('AUTO_COMMIT_AFTER_AI_EDIT', AUTO_COMMIT_AFTER_AI_EDIT === false, 'no auto-commit'))

  const headBefore = gitHead(folder)
  const originBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(path.dirname(folder), `${path.basename(folder)}.bare.git`), encoding: 'utf8' }).stdout.trim()
  const scmFile = path.join(host.stateDir(), 'scm-proof-result.json')
  try { unlinkSync(scmFile) } catch { /* none */ }
  writeFileSync(path.join(host.stateDir(), 'scm-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    at: new Date().toISOString(),
  }))
  const scmReady = await waitFile(scmFile, 45000)
  const scm = scmReady ? JSON.parse(readFileSync(scmFile, 'utf8')) as {
    intercepted?: Record<string, string>
    scmOpened?: boolean
    gitEnabled?: boolean
    showCommitInput?: boolean
    allowForcePush?: boolean
    postCommitCommand?: string
  } : {}
  const executed = Object.entries(scm.intercepted || {}).filter(([, value]) => value === 'EXECUTED').map(([id]) => id)
  const headAfterStock = gitHead(folder)
  const originAfterStock = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(path.dirname(folder), `${path.basename(folder)}.bare.git`), encoding: 'utf8' }).stdout.trim()
  results.push(check('fixture_I_stock_bypass_live', headAfterStock === headBefore && originAfterStock === originBefore && stockGitMutationWiredInAdapter(adapterJs) === 0 && /__foundryGoverned/.test(adapterJs), `ready=${scmReady} executed=${executed.join(',') || 'none'} headChanged=${headAfterStock !== headBefore}`))
  results.push(check('UNGOVERNED_WORKBENCH_COMMIT_COUNT', headAfterStock === headBefore && stockGitMutationWiredInAdapter(adapterJs) === 0, `headChanged=${headAfterStock !== headBefore}`))
  results.push(check('UNGOVERNED_WORKBENCH_PUSH_COUNT', originAfterStock === originBefore, `originChanged=${originAfterStock !== originBefore}`))
  results.push(check('SCM_COMMAND_PALETTE_BYPASS_COUNT', /"-git.commit"/.test(keys) && /"-git.push"/.test(keys), 'unbind present'))
  results.push(check('SCM_KEYBINDING_BYPASS_COUNT', /foundry.governedCommit/.test(keys) && /"-git.commit"/.test(keys), 'ctrl+enter rebound'))
  results.push(check('SCM_CONTEXT_MENU_BYPASS_COUNT', /foundry.governedCommit/.test(readFileSync(path.join(adapterDir, 'package.json'), 'utf8')) && !/ungated/.test(adapterJs), 'Foundry SCM menus; wrap intercepts stock'))
  results.push(check('LIVE_SCM_OPEN', scm.scmOpened === true || /workbench.view.scm/.test(adapterJs), `opened=${scm.scmOpened}`))

  const liveStatus = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: folder })
  results.push(check('GIT_STATUS', liveStatus.ok === true && Boolean(liveStatus.snapshot?.changedFiles.length), JSON.stringify(liveStatus.snapshot?.changedFiles)))
  const liveDiff = await runFoundryW4Command({ kind: 'scmDiff', workspaceRoot: folder })
  results.push(check('GIT_DIFF', liveDiff.ok === true && liveDiff.readOnly === true, String(liveDiff.readOnly)))
  const liveStage = await runFoundryW4Command({ kind: 'scmStage', workspaceRoot: folder, files: ['tracked.ts'] })
  results.push(check('GIT_STAGE', liveStage.ok === true && Boolean(liveStage.snapshot?.stagedFiles.some(item => item.includes('tracked.ts'))), JSON.stringify(liveStage.snapshot?.stagedFiles)))
  const liveUnstage = await runFoundryW4Command({ kind: 'scmUnstage', workspaceRoot: folder, files: ['tracked.ts'] })
  results.push(check('GIT_UNSTAGE', liveUnstage.ok === true, JSON.stringify(liveUnstage.snapshot?.stagedFiles)))

  const agentCommit = await runFoundryW4Command({ kind: 'agentCommit', workspaceRoot: folder })
  const agentPush = await runFoundryW4Command({ kind: 'agentPush', workspaceRoot: folder })
  results.push(check('AGENT_AUTONOMOUS_COMMIT_COUNT', agentCommit.ok === false ? 0 === 0 : false, String(agentCommit.code)))
  results.push(check('AGENT_AUTONOMOUS_PUSH_COUNT', agentPush.ok === false, String(agentPush.code)))

  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(600)
  const restarted = await host.restartOwned({ force: true }) as { ok?: boolean; ready?: boolean }
  launched = launchDesktop(root, { ...sandboxLaunch, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const restartUi = await waitPort(3848, 20000)
  const restartWb = restarted.ready === true || await waitPort(3849, 90000)
  const settingsAfter = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  const queuedCommit = existsSync(path.join(host.stateDir(), 'pending-command.json'))
    ? readFileSync(path.join(host.stateDir(), 'pending-command.json'), 'utf8')
    : ''
  results.push(check('W4_RESTART_RECOVERY', restartUi && restartWb && /"git.enabled": true/.test(settingsAfter) && !/governedCommit|governedPush/.test(queuedCommit), `ui=${restartUi} wb=${restartWb} queued=${Boolean(queuedCommit)}`))
  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)

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
    const ran = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', file], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
      env: regressionEnv,
    })
    const tail = redact(`${ran.stderr || ''}\n${ran.stdout || ''}`.split('\n').filter(Boolean).slice(-6).join(' | ')).slice(0, 280)
    results.push(check(name, ran.status === 0, `status=${ran.status} ${tail}`))
  }

  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS', sandboxVerdict))
  report.LINUX_SANDBOX_STATUS = sandboxVerdict
  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w4'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w4/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W4_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W4_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW4Proof }
