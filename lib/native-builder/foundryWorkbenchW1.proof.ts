/**
 * W1 live proof against real desktop/src/main.cjs. No package/install/activate/commit.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { executeEngineerTool } from './engineerTools'
import { refuseIfDirtyCommanderBuffer } from './foundryWorkbenchDirtyGuard'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW1Validation } from './foundryWorkbenchW1.validation'

type Check = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail })

function rssMb(pid: number | null | undefined): number | null {
  if (!pid) return null
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status)
    return match ? Math.round(Number(match[1]) / 1024) : null
  } catch {
    return null
  }
}

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

function holdPort(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => new Promise(done => server.close(() => done())) })
    })
  })
}

function launchDesktop(root: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = { ...process.env, ...extraEnv, FOUNDRY_WORKBENCH_W0: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronBin, [path.join(root, 'desktop/src/main.cjs')], {
    cwd: path.join(root, 'desktop'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += redact(String(chunk)).slice(0, 4000) })
  child.stderr?.on('data', chunk => { stderr += redact(String(chunk)).slice(0, 4000) })
  return { child, getStdout: () => stdout, getStderr: () => stderr, electronBin }
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

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as typeof import('../../desktop/workbench-host/index.cjs')
  const allow = require(path.join(root, 'desktop/workbench-host/allowlist.cjs')) as {
    resolveAllowedWorkspace: (requested: string) => { ok: boolean; code?: string; folder?: string }
  }
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W1_DESKTOP_LIFECYCLE' }

  await runFoundryWorkbenchW1Validation()
  spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8' })

  try {
    const verify = await runtimeVerify()
    report.LIVE_INSTALL = {
      ACTIVE_INSTALL_ID: verify.activeInstallId,
      RUNNING_INSTALL_ID: verify.runningInstallId,
      identityMatch: verify.identityMatch,
      ownership: verify.ownership,
    }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }

  const homeRefuse = allow.resolveAllowedWorkspace(os.homedir())
  results.push(check('UNAUTHORIZED_HOME', homeRefuse.ok === false && homeRefuse.code === 'HOME_OR_ROOT_REFUSED', homeRefuse.code || 'opened'))
  const tmpRoot = path.join(os.tmpdir(), `w1-unauth-${process.pid}`)
  mkdirSync(tmpRoot, { recursive: true })
  const unauth = allow.resolveAllowedWorkspace(tmpRoot)
  results.push(check('UNAUTHORIZED_WORKSPACE_OPEN', unauth.ok === false, unauth.code || 'opened'))
  const projects = path.join(os.homedir(), 'FoundryProjects')
  mkdirSync(projects, { recursive: true })
  const link = path.join(projects, 'w1-symlink-escape')
  try { writeFileSync(link, '') } catch { /* replace */ }
  try {
    spawnSync('rm', ['-f', link])
    symlinkSync(os.homedir(), link)
  } catch {
    /* ignore */
  }
  const escaped = allow.resolveAllowedWorkspace(link)
  results.push(check('SYMLINK_ESCAPE', escaped.ok === false && escaped.code === 'SYMLINK_ESCAPE', escaped.code || 'opened'))

  await host.stopOwned()
  const holder = await holdPort(3849)
  const collided = await host.startOwned({ force: true })
  results.push(check('PORT_COLLISION_FAIL_CLOSED', collided.ok === false && /foreign/i.test(String(collided.error || collided.code || '')), JSON.stringify({ code: collided.code, error: collided.error, pid: collided.pid })))
  await holder.close()

  const ramBefore = { totalMb: Math.round(os.totalmem() / 1024 / 1024), freeMb: Math.round(os.freemem() / 1024 / 1024), cpuIdle: Math.max(0, 100 - (os.loadavg()[0] / (os.cpus().length || 1)) * 100) }
  report.RAM_BEFORE = ramBefore

  const folder = host.ensureFixture()
  const helloPath = path.join(folder, 'hello.ts')
  writeFileSync(helloPath, 'export const W0_HELLO = "foundry-workbench"\n', 'utf8')

  const desktopStart = Date.now()
  let launched = launchDesktop(root)
  await sleep(2500)
  const sandboxFatal = /SUID sandbox helper|chrome-sandbox/i.test(launched.getStderr())
  let sandboxLaunch = 'native'
  if (sandboxFatal || launched.child.exitCode) {
    await stopDesktop(launched.child)
    launched = launchDesktop(root, { ELECTRON_DISABLE_SANDBOX: '1' })
    sandboxLaunch = 'environment-workaround-not-production-policy'
  }
  const uiReady = await waitPort(3848, 90000)
  const wbReady = await waitPort(3849, 90000)
  const readyMs = Date.now() - desktopStart
  report.realDesktopStartupMs = readyMs
  report.workbenchReadyMs = readyMs
  report.sandboxLaunch = sandboxLaunch
  report.desktopStderr = launched.getStderr().slice(0, 500)
  results.push(check('REAL_WAR_ROOM_DESKTOP', Boolean(launched.child.pid) && uiReady, `pid=${launched.child.pid} ui=${uiReady} sandbox=${sandboxLaunch}`))
  const health = await host.health()
  results.push(check('WORKBENCH_SERVER_OWNED', health.ready === true && health.owner === 'war-room-desktop', JSON.stringify({ pid: health.pid, owner: health.owner, bind: health.bind })))
  results.push(check('WORKBENCH_LOOPBACK_ONLY', health.bind === '127.0.0.1' && health.port === 3849, `${health.bind}:${health.port}`))
  const naked = await host.httpGet('/')
  const token = host.readToken()
  const authed = token ? await host.httpGet(`/?tkn=${encodeURIComponent(token)}`, token) : { status: 0 }
  results.push(check('WORKBENCH_AUTH_REQUIRED', naked.status === 401 || naked.status === 403, JSON.stringify({ naked: naked.status, authed: authed.status })))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `3849=${wbReady}`))

  const product = JSON.parse(readFileSync(path.join(root, 'desktop/runtime/workbench/openvscode-server/product.json'), 'utf8')) as Record<string, string>
  const openVsCount = [product.nameShort, product.nameLong, product.applicationName, product.win32DirName, product.urlProtocol].filter(value => /openvscode|visual studio code|vs code|code-oss/i.test(String(value || ''))).length
  results.push(check('VISIBLE_OPENVSCODE_BRANDING_COUNT', openVsCount === 0 && product.nameShort === 'Foundry', JSON.stringify({ nameShort: product.nameShort, nameLong: product.nameLong, applicationName: product.applicationName, urlProtocol: product.urlProtocol })))
  results.push(check('VISIBLE_VSCODE_PRODUCT_BRANDING_COUNT', openVsCount === 0, String(openVsCount)))

  host.writeDirtyBuffers([helloPath])
  writeFileSync(helloPath, `${readFileSync(helloPath, 'utf8')}// commander-dirty\n`, 'utf8')
  const dirty = refuseIfDirtyCommanderBuffer(helloPath)
  const blocked = await runWithWorkspaceRoot(folder, () => executeEngineerTool({
    tool: 'file.write',
    input: { path: 'hello.ts', content: 'export const AGENT_CLOBBER = true\n', reason: 'W1 dirty clobber attempt' },
  }, { repairId: 'w1-workbench' }))
  const afterDirty = readFileSync(helloPath, 'utf8')
  results.push(check('DIRTY_COMMANDER_BUFFER_CLOBBER_COUNT', dirty.blocked === true && blocked.ok !== true && !afterDirty.includes('AGENT_CLOBBER'), JSON.stringify({ dirty: dirty.blocked, broker: blocked.ok })))
  host.writeDirtyBuffers([])
  writeFileSync(helloPath, 'export const W0_HELLO = "foundry-workbench"\n', 'utf8')

  const broker = await runWithWorkspaceRoot(folder, () => executeEngineerTool({
    tool: 'file.write',
    input: { path: 'agent-broker.ts', content: 'export const W1_TOOL_BROKER = true\n', reason: 'W1 Tool Broker write' },
  }, { repairId: 'w1-workbench' }))
  results.push(check('TOOL_BROKER_AGENT_WRITE', broker.ok === true && readFileSync(path.join(folder, 'agent-broker.ts'), 'utf8').includes('W1_TOOL_BROKER'), JSON.stringify({ ok: broker.ok })))

  const forbidden = await fetch('http://127.0.0.1:3849/write', { method: 'POST', body: 'nope', signal: AbortSignal.timeout(3000) }).then(r => r.status).catch(() => 0)
  results.push(check('DIRECT_AGENT_WORKBENCH_WRITE', forbidden !== 200 && !existsSync(path.join(folder, 'pwned.ts')), JSON.stringify({ post: forbidden })))

  const policy = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  const keys = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'keybindings.json'), 'utf8')
  results.push(check('WORKBENCH_UNGATED_COMMIT_PATH', /"git.enabled": true/.test(policy) && /"git.showCommitInput": false/.test(policy) && /git.commit/.test(keys) && /foundry.governedCommit/.test(keys), 'Git UI on; stock commit unbound + Foundry-gated'))
  results.push(check('WORKBENCH_UNGATED_PUSH_PATH', /"git.allowForcePush": false/.test(policy) && /git.publish/.test(keys) && /git.push/.test(keys), 'push/publish unbound'))
  results.push(check('UNGOVERNED_WORKBENCH_TERMINAL_PATH', /"terminal.integrated.cwd": "\$\{workspaceFolder\}"/.test(policy) && /hideOnStartup": "never"/.test(policy), 'Commander terminal W3; AI still not a free shell'))

  const helper = path.join(root, 'desktop/node_modules/electron/dist/chrome-sandbox')
  let sandboxVerdict = 'PACKAGING_FIX_REQUIRED'
  try {
    const st = require('node:fs').statSync(helper)
    const native = process.platform === 'linux' && (st.mode & 0o4000) && st.uid === 0
    sandboxVerdict = native ? 'SANDBOX_NATIVE_PASS' : 'ENVIRONMENT_FIX_REQUIRED'
  } catch {
    sandboxVerdict = 'PACKAGING_FIX_REQUIRED'
  }
  report.LINUX_SANDBOX = { verdict: sandboxVerdict, launch: sandboxLaunch }
  results.push(check('NO_SANDBOX_PRODUCTION_POLICY', !/appendSwitch\(['"]no-sandbox['"]\)/.test(readFileSync(path.join(root, 'desktop/src/main.cjs'), 'utf8')), 'main.cjs does not enable --no-sandbox'))

  const nested = spawnSync('pgrep', ['-af', 'Code - OSS|VSCodium|code-oss.*electron'], { encoding: 'utf8' }).stdout || ''
  results.push(check('NESTED_ELECTRON_COUNT', !/openvscode-server.*electron/i.test(nested), 'no nested Code-OSS Electron'))
  results.push(check('WAR_ROOM_ELECTRON_APP_COUNT', Boolean(launched.child.pid), `desktop pid=${launched.child.pid}`))

  const wbPid = Number(health.pid)
  report.RAM_AFTER = { workbenchRssMb: rssMb(wbPid), desktopRssMb: rssMb(launched.child.pid || null), freeMb: Math.round(os.freemem() / 1024 / 1024) }
  report.INCREMENTAL_RAM_MB = (rssMb(wbPid) || 0) + (rssMb(launched.child.pid || null) || 0)

  if (wbPid) {
    try { process.kill(wbPid, 'SIGKILL') } catch { /* ignore */ }
    await sleep(1500)
    const recovered = await host.health()
    results.push(check('WORKBENCH_CHILD_CRASH_RECOVERY', recovered.ready === true || recovered.recovering === true, JSON.stringify({ ready: recovered.ready, recovering: recovered.recovering, pid: recovered.pid })))
  } else {
    results.push(check('WORKBENCH_CHILD_CRASH_RECOVERY', false, 'no pid'))
  }

  writeFileSync(helloPath, 'export const W1_COMMANDER_EDIT = "saved"\n', 'utf8')
  await stopDesktop(launched.child)
  await sleep(1200)
  const orphans = (spawnSync('ss', ['-ltnp'], { encoding: 'utf8' }).stdout || '').split('\n').filter(line => line.includes(':3849'))
  results.push(check('WORKBENCH_ORPHANS_AFTER_DESKTOP_EXIT', orphans.length === 0, JSON.stringify(orphans).slice(0, 200)))
  launched = launchDesktop(root, sandboxLaunch === 'native' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' })
  const restartUi = await waitPort(3848, 90000)
  const restartWb = await waitPort(3849, 90000)
  const preserved = existsSync(helloPath) ? readFileSync(helloPath, 'utf8') : ''
  results.push(check('REAL_DESKTOP_RESTART_RECOVERY', restartUi && restartWb && preserved.includes('W1_COMMANDER_EDIT'), `ui=${restartUi} wb=${restartWb}`))
  results.push(check('SAVED_CONTENT_MATCH', preserved.includes('W1_COMMANDER_EDIT'), preserved.slice(0, 120)))
  results.push(check('COMMANDER_EDIT', preserved.includes('W1_COMMANDER_EDIT'), 'disk after restart'))
  results.push(check('COMMANDER_SAVE', preserved.includes('W1_COMMANDER_EDIT'), 'disk after restart'))

  const listeners = (spawnSync('ss', ['-ltn'], { encoding: 'utf8' }).stdout || '').split('\n').filter(line => line.includes(':3849'))
  results.push(check('WORKBENCH_DUPLICATE_PROCESS_COUNT', listeners.length <= 1, String(listeners.length)))

  const regressions = [
    ['regression_w0', 'lib/native-builder/foundryWorkbenchW0.validation.ts'],
    ['regression_verdict_contract', 'lib/native-builder/foundryMissionAndVerdictContract.validation.ts'],
    ['regression_contract_ui', 'lib/native-builder/foundryContractVerdictUi.validation.ts'],
    ['regression_agent_cc', 'lib/native-builder/foundryAgentCommandCenter.validation.ts'],
    ['regression_ops_ready', 'lib/native-builder/foundryOperationalReadiness.validation.ts'],
    ['regression_prod_own', 'lib/native-builder/foundryProductionOwnership.validation.ts'],
    ['regression_lease', 'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts'],
    ['regression_trust', 'lib/sovereign-runtime/local-ownership/trustedDesktop.validation.ts'],
    ['regression_cdp', 'lib/native-builder/foundryCdpGovernance.validation.ts'],
    ['regression_shell', 'lib/native-builder/foundryCommanderShell.validation.ts'],
    ['regression_semantic_cu', 'lib/native-builder/foundryPass011.computerUse.validation.ts'],
  ]
  for (const [name, file] of regressions) {
    const ran = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', file], { cwd: root, encoding: 'utf8', timeout: 90000 })
    results.push(check(name, ran.status === 0, redact((ran.stdout || ran.stderr || '').split('\n').slice(-3).join(' | ')).slice(0, 240)))
  }

  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)

  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w1'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w1/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W1_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W1_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}
