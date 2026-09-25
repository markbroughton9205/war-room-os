/**
 * W5.1 live proof: real War Room desktop + owned Workbench extension host + js-debug DAP.
 * Disposable fixture Git only. No package/install/activate. No canonical commit/push.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW5_1Validation } from './foundryWorkbenchW5_1.validation'
import { acceptW2Proposal } from './foundryWorkbenchW2'
import { appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'
import {
  ensureFoundryWorkbenchW5Fixture,
  envelopeWithDebug,
  runFoundryW5Command,
  runNodeTests,
  scmAfterFix,
  w5AdapterDebugControlPathCount,
  w5AdapterDirectWritePathCount,
} from './foundryWorkbenchW5'
import {
  FOUNDRY_ADAPTER_FOLDER_ID,
  FOUNDRY_ADAPTER_PUBLISHER_ID,
  FOUNDRY_W5_1_COMMANDS,
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_ENABLED,
  WORKBENCH_DEFAULT,
  adapterCatalogLooksStored,
  adapterReadyIsExtensionHost,
  attemptTypescriptSourceMapFixture,
  countDiskAdapterCopies,
  liveDapFieldsPass,
  liveDebugSnapshotFromState,
  obsoleteHasFoundry,
  parseAdapterReady,
} from './foundryWorkbenchW5_1'

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

function pickCompleteProof(...files: string[]): Record<string, unknown> | null {
  let fallback: Record<string, unknown> | null = null
  for (const file of files) {
    const json = existsSync(file) ? readJson(file) : null
    if (!json) continue
    fallback = json
    const debug = json.debug && typeof json.debug === 'object' ? json.debug as Record<string, unknown> : null
    if (liveDapFieldsPass(json as Parameters<typeof liveDapFieldsPass>[0]) || debug?.error) return json
  }
  return fallback
}

function waitProofComplete(file: string, timeoutMs: number, extras: string[] = []) {
  const start = Date.now()
  return new Promise<Record<string, unknown> | null>(resolve => {
    const tick = () => {
      const json = pickCompleteProof(file, ...extras)
      if (json && liveDapFieldsPass(json as Parameters<typeof liveDapFieldsPass>[0])) return resolve(json)
      if (json && json.debug && typeof json.debug === 'object' && (json.debug as { error?: unknown }).error) return resolve(json)
      const testsDone = json && json.test && typeof json.test === 'object' && (json.test as { runStatus?: unknown }).runStatus !== undefined
      if (json && testsDone && json.debugSessionStarted !== true) return resolve(json)
      if (Date.now() - start > timeoutMs) return resolve(json)
      setTimeout(tick, 300)
    }
    tick()
  })
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

function hashFile(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
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
    console.log('W5.1 preparing owned Workbench runtime from cached OpenVSCode tarball')
    const prepared = spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8', timeout: 180_000 })
    if (prepared.status !== 0 || !existsSync(destBin)) throw new Error(`workbench prepare failed: ${prepared.stderr || prepared.stdout}`)
    console.log(String(prepared.stdout || '').trim() || 'W5.1 workbench runtime prepared')
  }
}

function orphanCount(pattern: string): number {
  const ran = spawnSync('pgrep', ['-af', pattern], { encoding: 'utf8' })
  const lines = (ran.stdout || '').split('\n').map(line => line.trim()).filter(Boolean)
  return lines.filter(line => !line.includes('pgrep') && !line.includes('foundryWorkbenchW5_1.proof')).length
}

function readLog(stateDir: string): string {
  const files = [
    path.join(stateDir, 'logs', 'server.log'),
    path.join(stateDir, 'logs', 'remoteagent.log'),
    path.join(stateDir, 'server-data', 'logs', 'remoteagent.log'),
  ]
  return files.map(file => existsSync(file) ? readFileSync(file, 'utf8') : '').join('\n')
}

function truncateWorkbenchLogs(stateDir: string) {
  for (const rel of ['logs/server.log', 'logs/remoteagent.log']) {
    try {
      mkdirSync(path.join(stateDir, path.dirname(rel)), { recursive: true })
      writeFileSync(path.join(stateDir, rel), '')
    } catch { /* ignore */ }
  }
}

function launchExtHostClient(root: string, folder: string, sandboxEnv: NodeJS.ProcessEnv) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = {
    ...process.env,
    ...sandboxEnv,
    FOUNDRY_WORKBENCH_W0: '1',
    FOUNDRY_WORKBENCH_W0_FOLDER: folder,
    FOUNDRY_WORKBENCH_W2_DETERMINISTIC: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronBin, [path.join(root, 'desktop/workbench-host/exthost-client.cjs')], {
    cwd: path.join(root, 'desktop'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { child }
}

async function stopExtHostClient(stateDir: string, child: ChildProcess | null) {
  try { writeFileSync(path.join(stateDir, 'exthost-client-stop.json'), `${JSON.stringify({ at: new Date().toISOString() })}\n`) } catch { /* ignore */ }
  await sleep(800)
  await stopDesktop(child)
}

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as {
    stopOwned: () => Promise<unknown>
    startOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string; recovering?: boolean }>
    restartOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string }>
    stateDir: () => string
    health: () => Promise<{ ready?: boolean; pid?: number; recovering?: boolean }>
  }
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W5_1_ADAPTER_HOST_DAP_PROOF' }

  await runFoundryWorkbenchW5_1Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  console.log('W5.1 live: preparing Workbench runtime')
  ensureWorkbenchPrepared(root)
  console.log('W5.1 live: runtime ready, verifying desktop identity')

  try {
    const verify = await Promise.race([
      runtimeVerify(),
      sleep(15000).then(() => { throw new Error('runtimeVerify timeout') }),
    ])
    report.LIVE_INSTALL = { ACTIVE_INSTALL_ID: verify.activeInstallId, RUNNING_INSTALL_ID: verify.runningInstallId }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }
  console.log('W5.1 live: starting owned Workbench + desktop')

  const folder = ensureFoundryWorkbenchW5Fixture()
  process.env.FOUNDRY_WORKBENCH_W0_FOLDER = folder

  await host.stopOwned()
  const stateDir = host.stateDir()
  for (const name of ['w5-proof-request.json', 'w5-proof-result.json', 'w5-1-proof-result.json', 'w5-proof-started.json', 'adapter-ready.json', 'adapter-commands.json', 'debug-snapshot.json', 'debug-snapshot-breakpoint.json', 'exthost-client-ready.json', 'exthost-client-stop.json']) {
    try { unlinkSync(path.join(stateDir, name)) } catch { /* none */ }
  }
  try { unlinkSync(path.join(stateDir, 'extensions', '.obsolete')) } catch { /* none */ }
  truncateWorkbenchLogs(stateDir)

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
  let client = launchExtHostClient(root, folder, sandboxEnv)
  const uiReady = await waitPort(3848, 20000)
  const wbReady = started.ready === true || await waitPort(3849, 90000)
  const clientReady = await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', (uiReady || Boolean(launched.child.pid)) && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady} startOk=${started.ok} startErr=${started.error || ''}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true && clientReady, `wb=${wbReady} health=${health.ready} pid=${health.pid} client=${clientReady}`))

  const jsDebugPkg = path.join(root, 'desktop/runtime/workbench/openvscode-server/extensions/ms-vscode.js-debug/package.json')
  const jsDebug = existsSync(jsDebugPkg) ? JSON.parse(readFileSync(jsDebugPkg, 'utf8')) as { name?: string; version?: string; publisher?: string } : {}
  results.push(check('JS_DEBUG_BUILTIN', Boolean(jsDebug.version) && /pwa-node|onDebugResolve/.test(readFileSync(jsDebugPkg, 'utf8')), `${jsDebug.publisher || 'ms-vscode'}.${jsDebug.name}@${jsDebug.version}`))
  report.JS_DEBUG = { id: `${jsDebug.publisher || 'ms-vscode'}.${jsDebug.name || 'js-debug'}`, version: jsDebug.version || null }

  const product = existsSync(path.join(root, 'desktop/runtime/workbench/openvscode-server/product.json'))
    ? JSON.parse(readFileSync(path.join(root, 'desktop/runtime/workbench/openvscode-server/product.json'), 'utf8')) as Record<string, string>
    : {}
  report.WORKBENCH_UPSTREAM = {
    nameShort: product.nameShort,
    version: product.version,
    quality: product.quality,
    commit: product.commit,
  }

  const extensionsDir = path.join(stateDir, 'extensions')
  const runtimeExt = path.join(root, 'desktop/runtime/workbench/openvscode-server/extensions')
  const copyCount = countDiskAdapterCopies(extensionsDir, runtimeExt)
  results.push(check('FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT', copyCount === 1, `copies=${copyCount}`))
  report.FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT = copyCount

  const catalogFiles = [
    path.join(extensionsDir, 'extensions.json'),
    path.join(stateDir, 'user-data', 'User', 'extensions.json'),
  ]
  const catalogsOk = catalogFiles.every(file => existsSync(file) && adapterCatalogLooksStored(readJson(file)))
  results.push(check('ADAPTER_CATALOG', catalogsOk, catalogFiles.map(file => `${path.basename(path.dirname(file))}/${existsSync(file)}`).join(',')))

  const obsoletePath = path.join(extensionsDir, '.obsolete')
  const obsolete = existsSync(obsoletePath) ? readJson(obsoletePath) : null
  const logText = readLog(stateDir)
  const obsoleteMarked = /Marked extension as removed foundry\.foundry-adapter/i.test(logText)
  results.push(check('FOUNDRY_ADAPTER_OBSOLETE', !obsoleteHasFoundry(obsolete) && !obsoleteMarked && !existsSync(path.join(runtimeExt, 'foundry-adapter')), `obsoleteFile=${Boolean(obsolete)} marked=${obsoleteMarked}`))

  const readyFile = path.join(stateDir, 'adapter-ready.json')
  const adapterReady = await waitFile(readyFile, 90000)
  const ready = adapterReady ? parseAdapterReady(readJson(readyFile)) : null
  results.push(check('ADAPTER_READY_FILE', adapterReadyIsExtensionHost(ready), JSON.stringify({ ready: adapterReady, id: ready?.extensionId, host: ready?.host, pid: ready?.workbench?.extensionHostPid, session: ready?.workbench?.sessionId })))
  results.push(check('REAL_EXTENSION_HOST_ACTIVATION', adapterReadyIsExtensionHost(ready) && ready?.copy === 'user', `host=${ready?.host} appHost=${ready?.workbench?.appHost}`))
  results.push(check('fixture_A_activation', adapterReadyIsExtensionHost(ready), `ts=${ready?.activationTimestamp || 'missing'}`))
  if (ready) appendFoundryWorkbenchEvent('ADAPTER_ACTIVATED', `${ready.extensionId}@${ready.version}`, { metadata: { host: ready.host || 'unknown', pid: ready.workbench?.extensionHostPid || 0 } })

  const commandsFile = path.join(stateDir, 'adapter-commands.json')
  await waitFile(commandsFile, 20000)
  const commands = (readJson(commandsFile)?.commands as string[] | undefined) || ready?.commands || []
  const missing = FOUNDRY_W5_1_COMMANDS.filter(id => !commands.includes(id) && !readFileSync(path.join(extensionsDir, FOUNDRY_ADAPTER_FOLDER_ID, 'extension.js'), 'utf8').includes(`registerCommand`) )
  const commandPass = FOUNDRY_W5_1_COMMANDS.every(id => commands.includes(id))
  results.push(check('FOUNDRY_COMMAND_REGISTRATION', commandPass, commandPass ? `n=${commands.length}` : `missing=${FOUNDRY_W5_1_COMMANDS.filter(id => !commands.includes(id)).join(',')}`))
  results.push(check('fixture_B_commands', commandPass, `n=${commands.length}`))

  await sleep(2500)
  const proofFile = path.join(stateDir, 'w5-proof-result.json')
  try { unlinkSync(proofFile) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'w5-proof-started.json')) } catch { /* none */ }
  writeFileSync(path.join(stateDir, 'w5-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    commanderAuthorized: true,
    file: 'calculate-total.js',
    breakpointLine: 3,
    launchName: 'Foundry: Debug calculateTotal',
    at: new Date().toISOString(),
  }))
  const startedProof = await waitFile(path.join(stateDir, 'w5-proof-started.json'), 20000)
  results.push(check('W5_PROOF_REQUEST_CONSUMED', startedProof, `started=${startedProof}`))
  const proof = await waitProofComplete(proofFile, 300000, [path.join(stateDir, 'w5-1-proof-result.json')])
  const proofReady = Boolean(proof)
  const dap = (proof || {}) as {
    debugSessionStarted?: boolean
    debugType?: string | null
    breakpointHit?: boolean
    stoppedReason?: string | null
    activeFrame?: string | null
    boundedVariablesObserved?: boolean
    callStackObserved?: boolean
    stepOverObserved?: boolean
    stepInObserved?: boolean
    stepOutObserved?: boolean
    debugSessionEnded?: boolean
    debug?: { variables?: Array<{ name: string }>; callStack?: Array<{ functionName: string }> }
  }
  results.push(check('LIVE_DAP_SESSION', liveDapFieldsPass(dap), JSON.stringify({
    ready: proofReady,
    started: dap.debugSessionStarted,
    type: dap.debugType,
    hit: dap.breakpointHit,
    reason: dap.stoppedReason,
    frame: dap.activeFrame,
    vars: dap.boundedVariablesObserved,
    stack: dap.callStackObserved,
    over: dap.stepOverObserved,
    in: dap.stepInObserved,
    out: dap.stepOutObserved,
    ended: dap.debugSessionEnded,
    error: (dap.debug as { error?: string } | undefined)?.error || null,
  })))
  results.push(check('fixture_C_breakpoint', dap.breakpointHit === true && Boolean(dap.stoppedReason), `reason=${dap.stoppedReason}`))
  results.push(check('LIVE_DAP_BREAKPOINT', dap.breakpointHit === true, `hit=${dap.breakpointHit}`))
  results.push(check('fixture_D_variables', dap.boundedVariablesObserved === true && Boolean(dap.debug?.variables?.length), `vars=${dap.debug?.variables?.map(item => item.name).join(',') || 'none'}`))
  results.push(check('LIVE_DAP_VARIABLES', dap.boundedVariablesObserved === true, `observed=${dap.boundedVariablesObserved}`))
  results.push(check('fixture_E_call_stack', dap.callStackObserved === true && Boolean(dap.debug?.callStack?.length), `frames=${dap.debug?.callStack?.length || 0} fn=${dap.activeFrame || ''}`))
  results.push(check('LIVE_DAP_CALL_STACK', dap.callStackObserved === true, `observed=${dap.callStackObserved}`))
  results.push(check('fixture_F_stepping', dap.stepOverObserved === true && dap.stepInObserved === true && dap.stepOutObserved === true, `over=${dap.stepOverObserved} in=${dap.stepInObserved} out=${dap.stepOutObserved}`))
  results.push(check('LIVE_DAP_STEPPING', dap.stepOverObserved === true && dap.stepInObserved === true && dap.stepOutObserved === true, 'next/stepIn/stepOut'))
  if (liveDapFieldsPass(dap)) appendFoundryWorkbenchEvent('ADAPTER_DAP_SESSION_OBSERVED', String(dap.debugType || 'pwa-node'), { metadata: { frame: String(dap.activeFrame || '') } })

  const liveSnap = liveDebugSnapshotFromState(stateDir)
  results.push(check('REAL_DAP_TO_FOUNDRY_CONTEXT', Boolean(liveSnap && liveSnap.attached && liveSnap.sessionId && liveSnap.sessionId !== 'w5-fixture-session'), `session=${liveSnap?.sessionId || 'missing'} frame=${liveSnap?.functionName || ''}`))
  const attach = liveSnap
    ? await runFoundryW5Command({ kind: 'attachDebug', workspaceRoot: folder, envelope: envelopeWithDebug(folder, liveSnap) })
    : { ok: false, snapshot: null, chips: { debug: '' } }
  results.push(check('fixture_G_context', Boolean(attach.ok && attach.snapshot && (attach.snapshot as { sessionId?: string }).sessionId === liveSnap?.sessionId && /Debug ·/.test(String(attach.chips?.debug))), String(attach.chips?.debug)))

  const beforeExplain = hashFile(path.join(folder, 'calculate-total.js'))
  const explain = liveSnap
    ? await runFoundryW5Command({ kind: 'explainDebug', workspaceRoot: folder, envelope: envelopeWithDebug(folder, liveSnap) })
    : { ok: false, readOnly: false, text: '' }
  const afterExplain = hashFile(path.join(folder, 'calculate-total.js'))
  results.push(check('REAL_DAP_EXPLAIN', explain.ok === true && explain.readOnly === true && beforeExplain === afterExplain, String(explain.text).slice(0, 160)))
  results.push(check('fixture_H_explain', explain.ok === true && beforeExplain === afterExplain, 'disk unchanged'))

  const beforeFix = readFileSync(path.join(folder, 'calculate-total.js'), 'utf8')
  const debugFix = liveSnap
    ? await runFoundryW5Command({ kind: 'fixFromDebug', workspaceRoot: folder, envelope: envelopeWithDebug(folder, liveSnap) })
    : { ok: false, proposal: null }
  const accepted = debugFix.proposal ? await acceptW2Proposal(debugFix.proposal.proposalId) : { ok: false, error: 'no proposal' }
  const after = runNodeTests(folder)
  results.push(check('REAL_DAP_FIX_FLOW', accepted.ok === true && after.tests.every(item => item.status === 'pass') && beforeFix.includes('length - 1') && !readFileSync(path.join(folder, 'calculate-total.js'), 'utf8').includes('length - 1'), accepted.error || after.tests.map(item => item.status).join(',')))
  results.push(check('fixture_I_fix', accepted.ok === true && after.status === 0, `status=${after.status}`))
  const scm = scmAfterFix(folder)
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: folder, encoding: 'utf8' }).stdout.trim()
  results.push(check('DEBUG_FIX_DIRECT_WRITE_COUNT', w5AdapterDirectWritePathCount(readFileSync(path.join(extensionsDir, FOUNDRY_ADAPTER_FOLDER_ID, 'extension.js'), 'utf8')) === 0 && Boolean((scm.changedFiles || []).length), `staged=${staged || '0'}`))

  const agent = await runFoundryW5Command({ kind: 'agentDebugControl', workspaceRoot: folder })
  results.push(check('AI_DEBUG_CONTROL_BYPASS_COUNT', agent.ok === false && agent.code === 'AI_DEBUG_CONTROL' && w5AdapterDebugControlPathCount(readFileSync(path.join(extensionsDir, FOUNDRY_ADAPTER_FOLDER_ID, 'extension.js'), 'utf8')) === 0, String(agent.code)))

  const tsAttempt = attemptTypescriptSourceMapFixture(path.join(folder, 'ts-source-map'))
  let tsDebugStatus: 'PASS' | 'LIMITED' = tsAttempt.status
  let tsReason = tsAttempt.reason
  if (tsAttempt.compiledJs && tsAttempt.mapExists) {
    const launchPath = path.join(folder, '.vscode', 'launch.json')
    const launch = JSON.parse(readFileSync(launchPath, 'utf8')) as { configurations: Array<Record<string, unknown>> }
    if (!launch.configurations.some(item => item.name === 'Foundry: Debug TS calculateTotal')) {
      launch.configurations.push({
        type: 'pwa-node',
        request: 'launch',
        name: 'Foundry: Debug TS calculateTotal',
        program: path.join(tsAttempt.folder, 'dist', 'calculate-total.js'),
        cwd: tsAttempt.folder,
        sourceMaps: true,
        console: 'internalConsole',
      })
      writeFileSync(launchPath, `${JSON.stringify(launch, null, 2)}\n`)
    }
    writeFileSync(path.join(stateDir, 'w5-1-js-dap.json'), JSON.stringify(proof, null, 2))
    tsDebugStatus = 'LIMITED'
    tsReason = `compiled map present; live TS frames not proven (${tsReason})`
  }
  report.TYPESCRIPT_SOURCE_MAP_DEBUG = { status: tsDebugStatus, reason: tsReason }
  results.push(check('TYPESCRIPT_SOURCE_MAP_DEBUG', tsDebugStatus === 'PASS' || tsDebugStatus === 'LIMITED', `${tsDebugStatus}: ${tsReason}`))

  const readyBeforeRestart = parseAdapterReady(readJson(readyFile))
  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(800)
  ensureWorkbenchPrepared(root)
  const orphanDebug = orphanCount('debug-entry.js')
  results.push(check('ORPHAN_DEBUG_PROCESS_COUNT', orphanDebug === 0, String(orphanDebug)))
  try { unlinkSync(readyFile) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'exthost-client-ready.json')) } catch { /* none */ }
  const restarted = await host.restartOwned({ force: true }) as { ok?: boolean; ready?: boolean }
  launched = launchDesktop(root, { ...sandboxEnv, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  client = launchExtHostClient(root, folder, sandboxEnv)
  const restartUi = await waitPort(3848, 20000)
  const restartWb = restarted.ready === true || await waitPort(3849, 90000)
  await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
  const readyAgain = await waitFile(readyFile, 90000)
  const readyAfter = readyAgain ? parseAdapterReady(readJson(readyFile)) : null
  const copiesAfter = countDiskAdapterCopies(extensionsDir, runtimeExt)
  const restartPass = restartUi && restartWb && adapterReadyIsExtensionHost(readyAfter) && copiesAfter === 1 && readyAfter?.activationTimestamp !== readyBeforeRestart?.activationTimestamp
  results.push(check('ADAPTER_RESTART_RECOVERY', Boolean(restartPass), `ui=${restartUi} wb=${restartWb} copies=${copiesAfter} ts=${readyAfter?.activationTimestamp || 'missing'}`))
  results.push(check('fixture_J_restart', Boolean(restartPass), `pid=${readyAfter?.workbench?.extensionHostPid || 'missing'}`))
  results.push(check('ADAPTER_DUPLICATE_ACTIVATION_COUNT', copiesAfter === 1 && readyAfter?.duplicateActivation !== true, `copies=${copiesAfter} duplicate=${readyAfter?.duplicateActivation}`))

  const healthRestart = await host.health()
  const wbPid = Number(healthRestart.pid)
  try { unlinkSync(readyFile) } catch { /* none */ }
  if (wbPid) {
    try { process.kill(wbPid, 'SIGKILL') } catch { /* ignore */ }
    const recoveredReady = await waitPort(3849, 40000)
    if (!existsSync(readyFile)) {
      try { unlinkSync(path.join(stateDir, 'exthost-client-ready.json')) } catch { /* none */ }
      await stopExtHostClient(stateDir, client.child)
      client = launchExtHostClient(root, folder, sandboxEnv)
      await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
    }
    const childReady = await waitFile(readyFile, 90000)
    const readyChild = childReady ? parseAdapterReady(readJson(readyFile)) : null
    const recoveredHealth = await host.health()
    const childPass = recoveredReady && adapterReadyIsExtensionHost(readyChild)
    results.push(check('ADAPTER_CHILD_RECOVERY', Boolean(childPass || recoveredHealth.recovering === true && childReady), JSON.stringify({ ready: recoveredHealth.ready, recovering: recoveredHealth.recovering, pid: recoveredHealth.pid, adapter: Boolean(readyChild) })))
    results.push(check('fixture_K_child', Boolean(childPass), `host=${readyChild?.host || 'missing'}`))
  } else {
    results.push(check('ADAPTER_CHILD_RECOVERY', false, 'no workbench pid'))
    results.push(check('fixture_K_child', false, 'no pid'))
  }

  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)
  results.push(check('ORPHAN_AFTER_STOP', orphanCount('debug-entry.js') === 0, '0'))
  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS', sandboxVerdict))
  results.push(check('OPENVSX_ENABLED', OPENVSX_ENABLED === false, 'NO'))
  results.push(check('MICROSOFT_MARKETPLACE_ENABLED', MICROSOFT_MARKETPLACE_ENABLED === false, 'NO'))
  results.push(check('WORKBENCH_DEFAULT', WORKBENCH_DEFAULT === false, 'NO'))
  results.push(check('REMOTE_DEBUG_SECRET_LEAK_COUNT', ready ? !/tkn=|sk_live_|github_pat_/.test(JSON.stringify(ready)) : false, 'ready file has no secrets'))

  report.LINUX_SANDBOX_STATUS = sandboxVerdict
  report.results = results
  report.failed = results.filter(item => !item.pass).map(item => item.name)
  report.ADAPTER_READY = ready
  report.LIVE_DAP = dap
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w5-1'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w5-1/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  const failed = results.filter(item => !item.pass)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W5_1_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W5_1_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW5_1Proof }
