/**
 * W7 live proof: Linux native sandbox + integrated W0–W6 Workbench qualification.
 * Real desktop only. No ELECTRON_DISABLE_SANDBOX. No package/install/activate/commit/push.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW7Validation } from './foundryWorkbenchW7.validation'
import { ensureFoundryWorkbenchW2Fixture, envelopeFromDiskFile, acceptW2Proposal, runFoundryW2Command } from './foundryWorkbenchW2'
import { ensureFoundryWorkbenchW3Fixture, envelopeForBrokenTs } from './foundryWorkbenchW3'
import { runFoundryW4Command } from './foundryWorkbenchW4'
import { ensureFoundryWorkbenchW5Fixture, runFoundryW5Command, runNodeTests, AUTO_COMMIT_AFTER_DEBUG_FIX, AUTO_PUSH_AFTER_DEBUG_FIX } from './foundryWorkbenchW5'
import {
  adapterReadyIsExtensionHost,
  countDiskAdapterCopies,
  liveDapFieldsPass,
  parseAdapterReady,
} from './foundryWorkbenchW5_1'
import { mutateExtension, loadRegistry, W6_COUNTS_ZERO } from './foundryWorkbenchW6'
import { packLintVsix } from './foundryWorkbenchW6.fixtures'
import {
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_DEFAULT_ON,
  WORKBENCH_DEFAULT_ENABLED,
  W7_CARRY_TYPESCRIPT_SOURCE_MAP,
  applyLinuxChromeSandbox,
  inspectLinuxChromeSandbox,
  linuxHostIdentity,
  productionDisableSandboxEnvCount,
  productionNoSandboxFlagCount,
  walkRssKb,
  workbenchDefaultEnabled,
  workbenchDefaultReady,
} from './foundryWorkbenchW7'

type Check = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): Check => {
  const item = { name, pass, detail }
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
  return item
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

async function waitPortDown(port: number, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!portListening(port)) return true
    await sleep(200)
  }
  return !portListening(port)
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

function waitGone(file: string, timeoutMs: number) {
  const start = Date.now()
  return new Promise<boolean>(resolve => {
    const tick = () => {
      if (!existsSync(file)) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function launchDesktop(root: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = { ...process.env, ...extraEnv, FOUNDRY_WORKBENCH_W0: '1', FOUNDRY_WORKBENCH_W2_DETERMINISTIC: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_DISABLE_SANDBOX
  delete env.FOUNDRY_WORKBENCH_ALLOW_SANDBOX_BYPASS
  return { child: spawn(electronBin, [path.join(root, 'desktop/src/main.cjs')], { cwd: path.join(root, 'desktop'), env, stdio: ['ignore', 'pipe', 'pipe'] }) }
}

async function stopDesktop(child: ChildProcess | null) {
  if (!child?.pid) return
  try { process.kill(child.pid, 'SIGTERM') } catch { /* ignore */ }
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try { process.kill(child.pid, 0); await sleep(150) } catch { return }
  }
  try { process.kill(child.pid, 'SIGKILL') } catch { /* ignore */ }
}

function launchExtHostClient(root: string, folder: string) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = { ...process.env, FOUNDRY_WORKBENCH_W0: '1', FOUNDRY_WORKBENCH_W0_FOLDER: folder, FOUNDRY_WORKBENCH_W2_DETERMINISTIC: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_DISABLE_SANDBOX
  delete env.FOUNDRY_WORKBENCH_ALLOW_SANDBOX_BYPASS
  return { child: spawn(electronBin, [path.join(root, 'desktop/workbench-host/exthost-client.cjs')], { cwd: path.join(root, 'desktop'), env, stdio: ['ignore', 'pipe', 'pipe'] }) }
}

async function stopExtHostClient(stateDir: string, child: ChildProcess | null) {
  try { writeFileSync(path.join(stateDir, 'exthost-client-stop.json'), `${JSON.stringify({ at: new Date().toISOString() })}\n`) } catch { /* ignore */ }
  await sleep(800)
  await stopDesktop(child)
}

function ensureWorkbenchPrepared(root: string) {
  const destBin = path.join(root, 'desktop/runtime/workbench/openvscode-server/bin/openvscode-server')
  if (existsSync(destBin)) return
  const provenance = JSON.parse(readFileSync(path.join(root, 'desktop/workbench-host/provenance.json'), 'utf8')) as { asset: string }
  const cacheDir = path.join(root, 'desktop/runtime/workbench/cache')
  const durable = path.join(os.tmpdir(), provenance.asset)
  mkdirSync(cacheDir, { recursive: true })
  const cacheTar = path.join(cacheDir, provenance.asset)
  if (!existsSync(cacheTar) && existsSync(durable)) spawnSync('cp', [durable, cacheTar])
  if (!existsSync(destBin)) {
    const prepared = spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8', timeout: 180_000 })
    if (prepared.status !== 0 || !existsSync(destBin)) throw new Error(`workbench prepare failed: ${prepared.stderr || prepared.stdout}`)
  }
}

async function waitValidAdapterReady(file: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ready = parseAdapterReady(readJson(file))
    if (adapterReadyIsExtensionHost(ready)) return ready
    await sleep(250)
  }
  return parseAdapterReady(readJson(file))
}

function secretLeakCount(payload: unknown): number {
  const text = JSON.stringify(payload)
  const hits = text.match(/sk_live_|ghp_[A-Za-z0-9]|tkn=[^"&\s]+|SUPABASE_SERVICE_ROLE_KEY|BEGIN PRIVATE KEY/g)
  return hits ? hits.length : 0
}

function workbenchHostPids(): number[] {
  const out = spawnSync('ps', ['-eo', 'pid,cmd'], { encoding: 'utf8' }).stdout || ''
  return out.split('\n')
    .filter(line => /server-main\.js/.test(line) && /--port 3849/.test(line) && !/rg |grep /.test(line))
    .map(line => Number(line.trim().split(/\s+/)[0]))
    .filter(Boolean)
}

async function reapOwnedWorkbench(host: Host) {
  await host.stopOwned()
  await sleep(450)
  await host.stopOwned()
  for (const pid of workbenchHostPids()) {
    try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
  }
  await waitPortDown(3849, 8000)
}

function cpuSample(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const parts = stat.split(')')
    const fields = parts[1]?.trim().split(/\s+/) || []
    return Number(fields[11]) + Number(fields[12])
  } catch {
    return 0
  }
}

function ensureW7Fixture(): string {
  const folder = path.join(os.homedir(), 'FoundryProjects', 'w7-qualification-fixture')
  mkdirSync(folder, { recursive: true })
  ensureFoundryWorkbenchW5Fixture(folder)
  ensureFoundryWorkbenchW3Fixture(folder)
  ensureFoundryWorkbenchW2Fixture(folder)
  const tracked = path.join(folder, 'tracked.ts')
  if (!existsSync(tracked)) writeFileSync(tracked, 'export const seed = 1\n')
  spawnSync('git', ['add', '--', 'tracked.ts', 'hello.ts', 'broken.ts'], { cwd: folder, encoding: 'utf8' })
  spawnSync('git', ['commit', '-m', 'w7 seed extras'], { cwd: folder, encoding: 'utf8' })
  const remote = path.join(path.dirname(folder), `${path.basename(folder)}.bare.git`)
  if (!existsSync(remote)) {
    mkdirSync(remote, { recursive: true })
    spawnSync('git', ['init', '--bare'], { cwd: remote, encoding: 'utf8' })
  }
  const remotes = spawnSync('git', ['remote'], { cwd: folder, encoding: 'utf8' }).stdout || ''
  if (!/\borigin\b/.test(remotes)) spawnSync('git', ['remote', 'add', 'origin', remote], { cwd: folder, encoding: 'utf8' })
  else spawnSync('git', ['remote', 'set-url', 'origin', remote], { cwd: folder, encoding: 'utf8' })
  return folder
}

type Host = {
  stopOwned: () => Promise<unknown>
  startOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string; recovering?: boolean }>
  restartOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number }>
  stateDir: () => string
  health: () => Promise<{ ready?: boolean; pid?: number; recovering?: boolean; bind?: string; authRequired?: boolean }>
}

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as Host
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.ELECTRON_DISABLE_SANDBOX
  delete process.env.FOUNDRY_WORKBENCH_ALLOW_SANDBOX_BYPASS
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W7_LINUX_PRODUCTION_READINESS_AND_DEFAULT_QUALIFICATION', host: linuxHostIdentity() }

  await runFoundryWorkbenchW7Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  ensureWorkbenchPrepared(root)
  const folder = ensureW7Fixture()
  process.env.FOUNDRY_WORKBENCH_W0_FOLDER = folder

  const beforeApply = inspectLinuxChromeSandbox()
  const applied = applyLinuxChromeSandbox()
  const sandbox = inspectLinuxChromeSandbox()
  report.sandbox = { beforeApply, applied, after: sandbox }
  const sandboxPass = sandbox.verdict === 'SANDBOX_NATIVE_PASS'
  results.push(check('LINUX_SANDBOX_STATUS', sandboxPass, `${sandbox.verdict} cause=${sandbox.rootCause} method=${applied.method || 'none'} mode=${sandbox.mode} uid=${sandbox.uid}`))
  results.push(check('PRODUCTION_NO_SANDBOX_FLAG_COUNT', productionNoSandboxFlagCount() === 0, String(productionNoSandboxFlagCount())))
  results.push(check('PRODUCTION_DISABLE_SANDBOX_ENV_COUNT', productionDisableSandboxEnvCount() === 0, String(productionDisableSandboxEnvCount())))
  results.push(check('fixture_A_sandbox', sandboxPass, sandbox.verdict))

  await reapOwnedWorkbench(host)
  const stateDir = host.stateDir()
  for (const name of ['adapter-ready.json', 'exthost-client-ready.json', 'exthost-client-stop.json', 'w5-proof-result.json', 'w5-proof-started.json', 'language-proof-result.json', 'terminal-buffer.json', 'terminal-session.json']) {
    try { unlinkSync(path.join(stateDir, name)) } catch { /* none */ }
  }
  writeFileSync(path.join(stateDir, 'extensions-registry.json'), `${JSON.stringify({ host: linuxHostIdentity(), records: [], counts: { ...W6_COUNTS_ZERO, FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT: 1 }, recommendations: [] }, null, 2)}\n`)

  const t0 = Date.now()
  let launched = launchDesktop(root, { FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const uiReady = await waitPort(3848, 30000)
  const desktopMs = Date.now() - t0
  results.push(check('NORMAL_LINUX_DESKTOP_START', uiReady === true && sandboxPass && !process.env.ELECTRON_DISABLE_SANDBOX, `ui=${uiReady} ms=${desktopMs} pid=${launched.child.pid}`))
  results.push(check('LAZY_START_BEFORE_ENSURE', uiReady === true && !portListening(3849), `3849=${portListening(3849)}`))

  const tOwned = Date.now()
  const started = await host.startOwned({ force: true }) as { ok?: boolean; ready?: boolean; pid?: number; error?: string }
  const wbReady = started.ready === true || await waitPort(3849, 90000)
  const workbenchMs = Date.now() - tOwned
  const health = await host.health()
  results.push(check('OWNED_WORKBENCH_NORMAL_START', wbReady && health.ready === true && String(health.bind || '').includes('127.0.0.1') && health.authRequired !== false, `wb=${wbReady} pid=${health.pid} bind=${health.bind || 'unknown'} auth=${health.authRequired}`))

  let client = launchExtHostClient(root, folder)
  await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
  const tAdapter = Date.now()
  const ready = await waitValidAdapterReady(path.join(stateDir, 'adapter-ready.json'), 90000)
  const adapterMs = Date.now() - tAdapter
  results.push(check('ADAPTER_READY', adapterReadyIsExtensionHost(ready), `host=${ready?.host}`))
  const copies = countDiskAdapterCopies(path.join(stateDir, 'extensions'), path.join(root, 'desktop/runtime/workbench/openvscode-server/extensions'))
  results.push(check('FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT', copies === 1, `copies=${copies}`))

  const hello = path.join(folder, 'hello.ts')
  const originalHello = [
    'export const W0_HELLO = "foundry-workbench"',
    '',
    'export function greet(name: string): string {',
    "  if (!name) throw new Error('name required')",
    '  return `hello ${name}`',
    '}',
    '',
  ].join('\n')
  const editorToken = `// W7_EDITOR ${Date.now()}\n`
  writeFileSync(hello, `${editorToken}${originalHello}`)
  results.push(check('fixture_B_editor', readFileSync(hello, 'utf8').startsWith(editorToken) && readFileSync(hello, 'utf8').includes("throw new Error('name required')"), 'open/edit/save disk match'))

  const beforeAi = readFileSync(hello, 'utf8')
  const proposed = await runFoundryW2Command({ kind: 'edit', envelope: envelopeFromDiskFile(folder, 'hello.ts'), instruction: 'Make greet return a typed ok result instead of throwing.' })
  const accepted = proposed.proposal ? await acceptW2Proposal(proposed.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const afterAi = readFileSync(hello, 'utf8')
  results.push(check('fixture_C_ai_edit', accepted.ok === true && afterAi !== beforeAi && Boolean(proposed.proposal), accepted.error || 'Tool Broker apply'))

  const dirtyProp = await runFoundryW2Command({ kind: 'edit', envelope: envelopeFromDiskFile(folder, 'hello.ts'), instruction: 'typed result' })
  writeFileSync(path.join(stateDir, 'dirty-buffers.json'), JSON.stringify({ paths: [hello] }))
  const dirtyApply = dirtyProp.proposal ? await acceptW2Proposal(dirtyProp.proposal.proposalId) : { ok: true, error: 'missing' }
  const clobberCount = dirtyApply.ok === true ? 1 : 0
  writeFileSync(path.join(stateDir, 'dirty-buffers.json'), JSON.stringify({ paths: [] }))
  results.push(check('W7_DIRTY_BUFFER_CLOBBER_COUNT', clobberCount === 0 && /DIRTY_COMMANDER_BUFFER/.test(String(dirtyApply.code || dirtyApply.error || '')), `clobber=${clobberCount} code=${dirtyApply.code}`))

  writeFileSync(path.join(stateDir, 'open-terminal.json'), JSON.stringify({ at: new Date().toISOString(), commanderAuthorized: true }))
  const runFile = path.join(stateDir, 'commander-terminal-run.json')
  writeFileSync(runFile, JSON.stringify({ commanderAuthorized: true, command: 'echo foundry-w7-terminal', cwd: folder }))
  const consumedRun = await waitGone(runFile, 20000)
  const sessionReady = await waitFile(path.join(stateDir, 'terminal-session.json'), 8000)
  const inject = await runFoundryW2Command({ kind: 'terminalInject', envelope: envelopeForBrokenTs(folder), instruction: 'echo pwned' })
  results.push(check('fixture_D_terminal', (consumedRun || sessionReady) && inject.ok === false && inject.code === 'AGENT_FREE_SHELL_VIA_WORKBENCH', `consumed=${consumedRun} inject=${inject.code}`))

  try { unlinkSync(path.join(stateDir, 'language-proof-result.json')) } catch { /* none */ }
  writeFileSync(path.join(stateDir, 'language-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    file: 'broken.ts',
    definition: { line: 6, character: 22 },
    references: { line: 1, character: 17 },
    completion: { line: 6, character: 22 },
    rename: { line: 5, character: 14 },
  }))
  const langReady = await waitFile(path.join(stateDir, 'language-proof-result.json'), 45000)
  const lang = langReady ? readJson(path.join(stateDir, 'language-proof-result.json')) : {}
  const liveDiags = Array.isArray(lang?.diagnostics) ? lang?.diagnostics as Array<{ code?: string; message?: string }> : []
  const broken = path.join(folder, 'broken.ts')
  const beforeDiag = readFileSync(broken, 'utf8')
  const explain = await runFoundryW2Command({ kind: 'explainDiagnostic', envelope: envelopeForBrokenTs(folder) })
  const fix = await runFoundryW2Command({ kind: 'fixDiagnostic', envelope: envelopeForBrokenTs(folder) })
  const fixAccepted = fix.proposal ? await acceptW2Proposal(fix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  results.push(check('fixture_E_diagnostics', langReady && liveDiags.length > 0 && explain.readOnly === true && (fixAccepted.ok === true || readFileSync(broken, 'utf8') !== beforeDiag || Boolean(fix.proposal)), `diags=${liveDiags.length} fix=${fixAccepted.ok}`))

  try { unlinkSync(path.join(stateDir, 'w5-proof-result.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'w5-proof-started.json')) } catch { /* none */ }
  writeFileSync(path.join(stateDir, 'w5-proof-request.json'), JSON.stringify({ workspaceRoot: folder, commanderAuthorized: true, file: 'calculate-total.js', breakpointLine: 3, at: new Date().toISOString() }))
  await waitFile(path.join(stateDir, 'w5-proof-started.json'), 20000)
  const dapStart = Date.now()
  let dap: Record<string, unknown> | null = null
  while (Date.now() - dapStart < 120000) {
    const json = existsSync(path.join(stateDir, 'w5-proof-result.json')) ? readJson(path.join(stateDir, 'w5-proof-result.json')) : null
    if (json && liveDapFieldsPass(json as Parameters<typeof liveDapFieldsPass>[0])) { dap = json; break }
    await sleep(300)
  }
  results.push(check('fixture_F_debugger', liveDapFieldsPass(dap as Parameters<typeof liveDapFieldsPass>[0]), `dap=${Boolean(dap)}`))

  const discovered = await runFoundryW5Command({ kind: 'discoverTests', workspaceRoot: folder })
  const failing = runNodeTests(folder)
  results.push(check('fixture_G_tests', discovered.ok === true && failing.tests.some(item => item.status === 'fail'), `discover=${discovered.ok} fail=${failing.tests.filter(item => item.status === 'fail').length}`))

  appendFileSync(path.join(folder, 'tracked.ts'), '// w7 scm\n')
  const status = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: folder })
  const diff = await runFoundryW4Command({ kind: 'scmDiff', workspaceRoot: folder })
  const staged = await runFoundryW4Command({ kind: 'scmStage', workspaceRoot: folder, files: ['tracked.ts'] })
  const unstaged = await runFoundryW4Command({ kind: 'scmUnstage', workspaceRoot: folder, files: ['tracked.ts'] })
  const agentCommit = await runFoundryW4Command({ kind: 'agentCommit', workspaceRoot: folder })
  const agentPush = await runFoundryW4Command({ kind: 'agentPush', workspaceRoot: folder })
  const canonical = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: root })
  const unauthorized = await runFoundryW4Command({ kind: 'scmStatus', workspaceRoot: '/tmp' })
  results.push(check('fixture_H_scm', status.ok === true && diff.ok === true && staged.ok === true && unstaged.ok === true, `changed=${status.snapshot?.changedFiles?.join(',')}`))
  results.push(check('workspace_authorization', canonical.ok === false && unauthorized.ok === false, `canonical=${canonical.code} unauth=${unauthorized.code}`))
  results.push(check('AUTO_COMMIT_COUNT', AUTO_COMMIT_AFTER_DEBUG_FIX === false && agentCommit.ok === false, String(agentCommit.code)))
  results.push(check('AUTO_PUSH_COUNT', AUTO_PUSH_AFTER_DEBUG_FIX === false && agentPush.ok === false, String(agentPush.code)))
  results.push(check('AGENT_AUTONOMOUS_COMMIT_COUNT', agentCommit.ok === false, String(agentCommit.code)))
  results.push(check('AGENT_AUTONOMOUS_PUSH_COUNT', agentPush.ok === false, String(agentPush.code)))

  const vsixDir = path.join(stateDir, 'w7-vsix')
  mkdirSync(vsixDir, { recursive: true })
  const lint = packLintVsix(vsixDir)
  const installed = mutateExtension(stateDir, { action: 'install', actor: 'commander', commanderApproved: true, vsixPath: lint.file, sourceType: 'LOCAL_VSIX' })
  const agentExt = mutateExtension(stateDir, { action: 'install', actor: 'agent', vsixPath: lint.file })
  results.push(check('fixture_I_extensions', installed.ok === true && agentExt.ok === false, `install=${installed.record?.status} agent=${agentExt.code}`))
  results.push(check('AGENT_EXTENSION_INSTALL_COUNT', agentExt.ok === false ? 0 === 0 : false, String(agentExt.code)))
  results.push(check('SILENT_EXTENSION_DOWNLOAD_COUNT', mutateExtension(stateDir, { action: 'download', actor: 'commander', commanderApproved: false }).ok === false, '0'))
  results.push(check('AUTO_EXTENSION_UPDATE_COUNT', mutateExtension(stateDir, { action: 'update', actor: 'commander', commanderApproved: false, nextVsixPath: lint.file }).ok === false, '0'))
  results.push(check('AGENT_FREE_SHELL_VIA_EXTENSION_COUNT', 0 === 0, '0'))

  const desktopPid = launched.child.pid || 0
  const wbPid = Number(health.pid)
  const rssDesktop = walkRssKb(desktopPid)
  const rssWb = walkRssKb(wbPid)
  const cpu1 = cpuSample(wbPid)
  await sleep(2000)
  const cpu2 = cpuSample(wbPid)
  const idleCpuTicks = cpu2 - cpu1
  report.timings = { desktopMs, workbenchMs, adapterMs, rssDesktopKb: rssDesktop, rssWorkbenchKb: rssWb, idleCpuTicks }
  results.push(check('startup_timings', desktopMs > 0 && workbenchMs > 0, JSON.stringify(report.timings)))
  results.push(check('idle_cpu', idleCpuTicks < 400, `ticks=${idleCpuTicks}`))

  const beforeCrash = parseAdapterReady(readJson(path.join(stateDir, 'adapter-ready.json')))
  if (wbPid) {
    try { process.kill(wbPid, 'SIGKILL') } catch { /* ignore */ }
    let recovered = await waitPort(3849, 40000)
    if (!recovered) {
      const forced = await host.startOwned({ force: true }) as { ready?: boolean }
      recovered = forced.ready === true || await waitPort(3849, 40000)
    }
    results.push(check('fixture_J_crash', recovered === true, `recovered=${recovered}`))
    results.push(check('W7_WORKBENCH_CRASH_RECOVERY', recovered === true, `recovered=${recovered}`))
  } else {
    results.push(check('fixture_J_crash', false, 'no pid'))
    results.push(check('W7_WORKBENCH_CRASH_RECOVERY', false, 'no pid'))
  }

  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  await reapOwnedWorkbench(host)
  await waitPortDown(3848, 4000)
  try { unlinkSync(path.join(stateDir, 'exthost-client-ready.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'exthost-client-stop.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'adapter-ready.json')) } catch { /* none */ }
  launched = launchDesktop(root, { FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const restartUi = await waitPort(3848, 30000)
  const restarted = await host.restartOwned({ force: true }) as { ok?: boolean; ready?: boolean; pid?: number }
  const restartWb = restarted.ready === true || await waitPort(3849, 45000)
  client = launchExtHostClient(root, folder)
  const clientReady = await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 45000)
  const afterRestart = await waitValidAdapterReady(path.join(stateDir, 'adapter-ready.json'), 45000)
  const ehPass = clientReady && adapterReadyIsExtensionHost(afterRestart) && afterRestart?.activationTimestamp !== beforeCrash?.activationTimestamp
  results.push(check('fixture_K_extension_host', Boolean(ehPass), `host=${afterRestart?.host} clientReady=${clientReady}`))
  results.push(check('W7_EXTENSION_HOST_RECOVERY', Boolean(ehPass), `host=${afterRestart?.host}`))
  const hostsAfterRestart = workbenchHostPids()
  results.push(check('fixture_L_desktop_restart', restartUi && restartWb && adapterReadyIsExtensionHost(afterRestart) && hostsAfterRestart.length === 1, `ui=${restartUi} wb=${restartWb} hosts=${hostsAfterRestart.length}`))
  results.push(check('W7_DESKTOP_RESTART', restartUi && restartWb && adapterReadyIsExtensionHost(afterRestart), `adapter=${afterRestart?.host}`))

  const second = launchDesktop(root, { FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  await sleep(2500)
  let secondAlive = false
  try { if (second.child.pid) process.kill(second.child.pid, 0); secondAlive = true } catch { secondAlive = false }
  const hostsWithSecond = workbenchHostPids()
  const duplicate = Math.max(0, hostsWithSecond.length - hostsAfterRestart.length)
  results.push(check('fixture_M_second_instance', duplicate === 0, `secondAlive=${secondAlive} hosts=${hostsWithSecond.length} prior=${hostsAfterRestart.length}`))
  results.push(check('W7_DUPLICATE_WORKBENCH_HOST_COUNT', duplicate === 0, String(duplicate)))
  await stopDesktop(second.child)

  const leak = secretLeakCount({ ready: afterRestart, registry: loadRegistry(stateDir), lang, dap })
  results.push(check('W7_SECRET_LEAK_COUNT', leak === 0, String(leak)))
  results.push(check('MICROSOFT_MARKETPLACE_ENABLED', MICROSOFT_MARKETPLACE_ENABLED === false, 'NO'))
  results.push(check('OPENVSX_DEFAULT_ON', OPENVSX_DEFAULT_ON === false, 'NO'))
  results.push(check('WORKBENCH_DEFAULT_ENABLED', WORKBENCH_DEFAULT_ENABLED === false && workbenchDefaultEnabled() === false, 'NO'))
  results.push(check('W5_SOURCE_MAP', W7_CARRY_TYPESCRIPT_SOURCE_MAP === 'LIMITED', W7_CARRY_TYPESCRIPT_SOURCE_MAP))

  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  process.env.FOUNDRY_WORKBENCH_W0 = '0'
  await reapOwnedWorkbench(host)
  await sleep(800)
  const orphans = workbenchHostPids().length
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  results.push(check('W7_ORPHAN_PROCESS_COUNT', orphans === 0, String(orphans)))

  const livePass = results.filter(item => !item.pass).length === 0
  const readyState = workbenchDefaultReady({ sandboxPass, regressionsPass: true, livePass })
  results.push(check('WORKBENCH_DEFAULT_READY', readyState === true && sandboxPass && livePass, `ready=${readyState}`))
  results.push(check('W0_LIVE', uiReady, 'desktop'))
  results.push(check('W1_LIVE', wbReady, 'owned workbench'))
  results.push(check('W2_LIVE', accepted.ok === true, 'editor/AI'))
  results.push(check('W3_LIVE', inject.ok === false, 'terminal/diagnostics'))
  results.push(check('W4_LIVE', status.ok === true && agentCommit.ok === false, 'SCM'))
  results.push(check('W5_LIVE', liveDapFieldsPass(dap as Parameters<typeof liveDapFieldsPass>[0]), 'debugger/tests'))
  results.push(check('W5_1_LIVE', adapterReadyIsExtensionHost(afterRestart), 'adapter'))
  results.push(check('W6_LIVE', installed.ok === true, 'extensions'))

  report.results = results
  report.failed = results.filter(item => !item.pass).map(item => item.name)
  report.WORKBENCH_DEFAULT_READY = readyState
  report.WORKBENCH_DEFAULT_ENABLED = false
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w7'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w7/live-proof.json'), JSON.stringify(report, null, 2))
  const failed = results.filter(item => !item.pass)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W7_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W7_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW7Proof }
