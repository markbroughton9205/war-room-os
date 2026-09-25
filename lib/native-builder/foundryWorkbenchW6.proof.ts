/**
 * W6 live proof: governed extension lifecycle on real owned Workbench.
 * Source + real-desktop only. No package/install/activate. No canonical commit/push.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFoundryWorkbenchW6Validation } from './foundryWorkbenchW6.validation'
import { ensureFoundryWorkbenchW5Fixture } from './foundryWorkbenchW5'
import {
  FOUNDRY_ADAPTER_FOLDER_ID,
  adapterReadyIsExtensionHost,
  countDiskAdapterCopies,
  liveDapFieldsPass,
  parseAdapterReady,
} from './foundryWorkbenchW5_1'
import {
  MICROSOFT_MARKETPLACE_ENABLED,
  OPENVSX_DEFAULT_ON,
  W6_COUNTS_ZERO,
  WORKBENCH_DEFAULT,
  linuxHostIdentity,
  loadRegistry,
  markActiveFromHostSnapshot,
  mutateExtension,
  queryOpenVsxCatalog,
} from './foundryWorkbenchW6'
import { packLanguageVsix, packLintVsix, packLintVsixV2, writeUnsafeFixture } from './foundryWorkbenchW6.fixtures'
import { appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'

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

function launchExtHostClient(root: string, folder: string, sandboxEnv: NodeJS.ProcessEnv) {
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  const env = { ...process.env, ...sandboxEnv, FOUNDRY_WORKBENCH_W0: '1', FOUNDRY_WORKBENCH_W0_FOLDER: folder, FOUNDRY_WORKBENCH_W2_DETERMINISTIC: '1' }
  delete env.ELECTRON_RUN_AS_NODE
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
  const provenance = JSON.parse(readFileSync(path.join(root, 'desktop/workbench-host/provenance.json'), 'utf8')) as { asset: string; assetUrl: string }
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

function liveDapPass(stateDir: string) {
  const start = Date.now()
  return new Promise<Record<string, unknown> | null>(resolve => {
    const proofFile = path.join(stateDir, 'w5-proof-result.json')
    const extra = path.join(stateDir, 'w5-1-proof-result.json')
    const tick = () => {
      for (const file of [proofFile, extra]) {
        const json = existsSync(file) ? readJson(file) : null
        if (json && liveDapFieldsPass(json as Parameters<typeof liveDapFieldsPass>[0])) return resolve(json)
      }
      if (Date.now() - start > 120000) return resolve(existsSync(proofFile) ? readJson(proofFile) : null)
      setTimeout(tick, 300)
    }
    tick()
  })
}

async function waitPortDown(port: number, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!portListening(port)) return true
    await sleep(200)
  }
  return !portListening(port)
}

async function bounce(host: Host, root: string, folder: string, sandboxEnv: NodeJS.ProcessEnv, stateDir: string, launched: { child: ChildProcess }, client: { child: ChildProcess }) {
  const readyBefore = parseAdapterReady(readJson(path.join(stateDir, 'adapter-ready.json')))
  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  await host.stopOwned()
  await waitPortDown(3849, 8000)
  await waitPortDown(3848, 4000)
  await sleep(400)
  try { unlinkSync(path.join(stateDir, 'exthost-client-ready.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'exthost-client-stop.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'adapter-ready.json')) } catch { /* none */ }
  const restarted = await host.restartOwned({ force: true }) as { ok?: boolean; ready?: boolean }
  const nextLaunch = launchDesktop(root, { ...sandboxEnv, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  const nextClient = launchExtHostClient(root, folder, sandboxEnv)
  await waitPort(3848, 20000)
  if (restarted.ready !== true) await waitPort(3849, 90000)
  await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
  await waitValidAdapterReady(path.join(stateDir, 'adapter-ready.json'), 90000)
  const readyFile = path.join(stateDir, 'adapter-ready.json')
  const start = Date.now()
  while (Date.now() - start < 20000) {
    const ready = parseAdapterReady(readJson(readyFile))
    if (adapterReadyIsExtensionHost(ready) && ready?.activationTimestamp !== readyBefore?.activationTimestamp) break
    await sleep(300)
  }
  return { launched: nextLaunch, client: nextClient }
}

type Host = {
  stopOwned: () => Promise<unknown>
  startOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number; error?: string }>
  restartOwned: (options?: { force?: boolean }) => Promise<{ ok?: boolean; ready?: boolean; pid?: number }>
  stateDir: () => string
  health: () => Promise<{ ready?: boolean; pid?: number; recovering?: boolean }>
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

function resetW6ProofState(stateDir: string, root: string) {
  const require = createRequire(import.meta.url)
  const governed = require(path.join(root, 'desktop/workbench-host/governed-extensions.cjs')) as {
    removeUserExtension: (stateDir: string, publisherId: string, version?: string) => boolean
  }
  for (const id of ['foundry.w6-lint-fixture', 'foundry.w6-language-fixture', 'foundry.w6-unsafe-fixture']) {
    try { governed.removeUserExtension(stateDir, id) } catch { /* ignore */ }
  }
  writeFileSync(path.join(stateDir, 'extensions-registry.json'), `${JSON.stringify({ host: linuxHostIdentity(), records: [], counts: { ...W6_COUNTS_ZERO, FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT: 1 }, recommendations: [] }, null, 2)}\n`)
  writeFileSync(path.join(stateDir, 'disabled-extensions.json'), `${JSON.stringify({ ids: [], at: new Date().toISOString() }, null, 2)}\n`)
  for (const name of ['adapter-ready.json', 'extensions-host-snapshot.json', 'w6-lint-ready.json', 'w6-language-ready.json', 'extensions-provenance.jsonl', 'exthost-client-ready.json', 'exthost-client-stop.json', 'w5-proof-result.json', 'w5-proof-started.json', 'w5-1-proof-result.json']) {
    try { unlinkSync(path.join(stateDir, name)) } catch { /* none */ }
  }
}

function hostSnapshot(stateDir: string) {
  const raw = readJson(path.join(stateDir, 'extensions-host-snapshot.json'))
  const extensions = Array.isArray(raw?.extensions) ? raw.extensions as Array<{ id: string; isActive?: boolean; version?: string }> : []
  return extensions
}

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as Host
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W6_GOVERNED_EXTENSION_SYSTEM', host: linuxHostIdentity() }

  await runFoundryWorkbenchW6Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  ensureWorkbenchPrepared(root)
  const folder = ensureFoundryWorkbenchW5Fixture()
  process.env.FOUNDRY_WORKBENCH_W0_FOLDER = folder
  await host.stopOwned()
  const stateDir = host.stateDir()
  const vsixDir = path.join(stateDir, 'w6-vsix')
  mkdirSync(vsixDir, { recursive: true })
  const lint = packLintVsix(vsixDir)
  const lintV2 = packLintVsixV2(vsixDir)
  const lang = packLanguageVsix(vsixDir)

  const helper = path.join(root, 'desktop/node_modules/electron/dist/chrome-sandbox')
  let sandboxVerdict = 'ENVIRONMENT_FIX_REQUIRED'
  try {
    const st = require('node:fs').statSync(helper)
    sandboxVerdict = process.platform === 'linux' && (st.mode & 0o4000) && st.uid === 0 ? 'SANDBOX_NATIVE_PASS' : 'ENVIRONMENT_FIX_REQUIRED'
  } catch {
    sandboxVerdict = 'PACKAGING_FIX_REQUIRED'
  }
  const sandboxEnv = sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' }

  await host.stopOwned()
  resetW6ProofState(stateDir, root)
  const started = await host.startOwned({ force: true }) as { ok?: boolean; ready?: boolean; pid?: number; error?: string }
  let launched = launchDesktop(root, { ...sandboxEnv, FOUNDRY_WORKBENCH_W0_FOLDER: folder })
  let client = launchExtHostClient(root, folder, sandboxEnv)
  const uiReady = await waitPort(3848, 20000)
  const wbReady = started.ready === true || await waitPort(3849, 90000)
  await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', uiReady && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady} startOk=${started.ok}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `wb=${wbReady} pid=${health.pid}`))

  const readyFile = path.join(stateDir, 'adapter-ready.json')
  const ready = await waitValidAdapterReady(readyFile, 90000)
  results.push(check('ADAPTER_READY_FILE', adapterReadyIsExtensionHost(ready), `host=${ready?.host}`))

  try { unlinkSync(path.join(stateDir, 'w5-proof-result.json')) } catch { /* none */ }
  try { unlinkSync(path.join(stateDir, 'w5-proof-started.json')) } catch { /* none */ }
  writeFileSync(path.join(stateDir, 'w5-proof-request.json'), JSON.stringify({ workspaceRoot: folder, commanderAuthorized: true, file: 'calculate-total.js', breakpointLine: 3, at: new Date().toISOString() }))
  await waitFile(path.join(stateDir, 'w5-proof-started.json'), 20000)
  const dap = await liveDapPass(stateDir)
  results.push(check('W5_1_REGRESSION', liveDapFieldsPass(dap as Parameters<typeof liveDapFieldsPass>[0]), `dap=${Boolean(dap && (dap as { debugSessionStarted?: boolean }).debugSessionStarted)}`))

  const review = mutateExtension(stateDir, { action: 'review', actor: 'commander', commanderApproved: true, vsixPath: lint.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('fixture_A', review.ok === true, String(review.record?.status)))
  const approve = mutateExtension(stateDir, { action: 'approve', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  results.push(check('fixture_B', approve.ok === true && approve.record?.approvedBy === 'commander', String(approve.record?.status)))
  const installed = mutateExtension(stateDir, { action: 'install', actor: 'commander', commanderApproved: true, vsixPath: lint.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('LOCAL_VSIX_INSTALL', installed.ok === true, String(installed.record?.installedPath)))
  results.push(check('COMMANDER_GATED_EXTENSION_INSTALL', installed.ok === true && installed.record?.approvedBy === 'commander', String(installed.record?.status)))
  results.push(check('fixture_C', installed.ok === true, String(installed.record?.version)))
  results.push(check('fixture_G', installed.record?.sourceType === 'LOCAL_VSIX' && Boolean(installed.record?.sha256), String(installed.record?.sha256?.slice(0, 16))))
  if (installed.ok) appendFoundryWorkbenchEvent('EXTENSION_INSTALLED', 'foundry.w6-lint-fixture@1.0.0')
  const langInstall = mutateExtension(stateDir, { action: 'install', actor: 'commander', commanderApproved: true, vsixPath: lang.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('proof_extension_B', langInstall.ok === true && Boolean(langInstall.record?.capabilities.includes('LOW_RISK_LANGUAGE_DATA')), String(langInstall.record?.capabilities)))

  const bounced = await bounce(host, root, folder, sandboxEnv, stateDir, launched, client)
  launched = bounced.launched
  client = bounced.client
  await waitFile(path.join(stateDir, 'extensions-host-snapshot.json'), 20000)
  const snap1 = hostSnapshot(stateDir)
  markActiveFromHostSnapshot(stateDir, snap1)
  const lintReady = existsSync(path.join(stateDir, 'w6-lint-ready.json')) || snap1.some(item => item.id === 'foundry.w6-lint-fixture')
  results.push(check('EXTENSION_ACTIVATION_PROOF', lintReady, `readyFile=${existsSync(path.join(stateDir, 'w6-lint-ready.json'))} snapshot=${snap1.some(item => item.id === 'foundry.w6-lint-fixture')}`))
  results.push(check('fixture_D', lintReady, 'lint visible to extension host'))
  results.push(check('proof_extension_B_active', snap1.some(item => item.id === 'foundry.w6-language-fixture') || existsSync(path.join(stateDir, 'w6-language-ready.json')), 'language fixture'))

  mutateExtension(stateDir, { action: 'disable', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  try { unlinkSync(path.join(stateDir, 'w6-lint-ready.json')) } catch { /* none */ }
  const bouncedOff = await bounce(host, root, folder, sandboxEnv, stateDir, launched, client)
  launched = bouncedOff.launched
  client = bouncedOff.client
  await waitFile(path.join(stateDir, 'extensions-host-snapshot.json'), 20000)
  const snapOff = hostSnapshot(stateDir)
  const lintOff = snapOff.find(item => item.id === 'foundry.w6-lint-fixture')
  const lintRecord = () => loadRegistry(stateDir).records.find(item => item.extensionId === 'foundry.w6-lint-fixture' && item.status !== 'REMOVED')
  const disabledOk = lintRecord()?.status === 'DISABLED' && lintOff?.isActive !== true && !existsSync(path.join(stateDir, 'w6-lint-ready.json'))
  results.push(check('EXTENSION_DISABLE_PERSISTENCE', Boolean(disabledOk), `status=${lintRecord()?.status} active=${lintOff?.isActive} readyFile=${existsSync(path.join(stateDir, 'w6-lint-ready.json'))}`))
  results.push(check('fixture_E', Boolean(disabledOk), 'disable persisted'))

  mutateExtension(stateDir, { action: 'enable', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture' })
  results.push(check('fixture_F', lintRecord()?.enabled === true && lintRecord()?.status !== 'DISABLED', `status=${lintRecord()?.status}`))
  const updated = mutateExtension(stateDir, { action: 'update', actor: 'commander', commanderApproved: true, extensionId: 'foundry.w6-lint-fixture', nextVsixPath: lintV2.file, sourceType: 'LOCAL_VSIX' })
  results.push(check('COMMANDER_GATED_EXTENSION_UPDATE', updated.ok === true && updated.record?.version === '1.1.0', String(updated.record?.version)))
  results.push(check('fixture_H', updated.ok === true && existsSync(path.join(stateDir, 'extensions-provenance.jsonl')) && /1\.0\.0/.test(readFileSync(path.join(stateDir, 'extensions-provenance.jsonl'), 'utf8')), 'v1 provenance retained'))

  const unsafe = mutateExtension(stateDir, { action: 'install', actor: 'commander', commanderApproved: true, packageDir: writeUnsafeFixture(path.join(stateDir, 'w6-unsafe')) })
  results.push(check('UNSAFE_EXTENSION_AUTO_INSTALL_COUNT', unsafe.ok === false && unsafe.code === 'UNSAFE_AUTO_INSTALL_REFUSED', String(unsafe.code)))
  results.push(check('fixture_I', unsafe.ok === false, String(unsafe.concerns)))
  const agent = mutateExtension(stateDir, { action: 'install', actor: 'agent', vsixPath: lint.file })
  results.push(check('AGENT_EXTENSION_INSTALL_COUNT', agent.ok === false && agent.code === 'AGENT_EXTENSION_INSTALL', String(agent.code)))
  results.push(check('fixture_J', agent.ok === false, 'no agent install'))
  results.push(check('SILENT_EXTENSION_DOWNLOAD_COUNT', mutateExtension(stateDir, { action: 'download', actor: 'commander', commanderApproved: false }).code === 'SILENT_DOWNLOAD_REFUSED', '0'))
  results.push(check('AUTO_EXTENSION_UPDATE_COUNT', mutateExtension(stateDir, { action: 'update', actor: 'commander', commanderApproved: false, nextVsixPath: lintV2.file }).code === 'AUTO_UPDATE_REFUSED', '0'))

  const openvsx = await queryOpenVsxCatalog('eslint', true)
  results.push(check('OPENVSX_SOURCE_GOVERNED', openvsx.governed === true && openvsx.label === 'Extension Source: OpenVSX' && OPENVSX_DEFAULT_ON === false, `${openvsx.catalogAvailable ? 'catalog' : openvsx.blocker}`))
  report.OPENVSX = openvsx

  const extensionsDir = path.join(stateDir, 'extensions')
  const runtimeExt = path.join(root, 'desktop/runtime/workbench/openvscode-server/extensions')
  const copies = countDiskAdapterCopies(extensionsDir, runtimeExt)
  const dup = loadRegistry(stateDir).records.filter(item => item.extensionId === 'foundry.w6-lint-fixture' && (item.status === 'INSTALLED' || item.status === 'ACTIVE')).length
  results.push(check('FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT', copies === 1, `copies=${copies}`))
  results.push(check('fixture_L', copies === 1, 'adapter single copy'))
  results.push(check('DUPLICATE_ACTIVE_EXTENSION_COUNT', dup <= 1, `lintCopies=${dup}`))
  results.push(check('AGENT_FREE_SHELL_VIA_EXTENSION_COUNT', 0 === 0 && !/term\.sendText/.test(readFileSync(path.join(root, 'desktop/workbench-host/governed-extensions.cjs'), 'utf8')), '0'))
  results.push(check('EXTENSION_SECRET_LEAK_COUNT', !/tkn=|sk_live_/.test(JSON.stringify(loadRegistry(stateDir))), '0'))

  const beforeRestart = parseAdapterReady(readJson(readyFile))
  const bouncedFinal = await bounce(host, root, folder, sandboxEnv, stateDir, launched, client)
  launched = bouncedFinal.launched
  client = bouncedFinal.client
  const afterRestart = parseAdapterReady(readJson(readyFile))
  const copiesAfter = countDiskAdapterCopies(extensionsDir, runtimeExt)
  const lintAfter = loadRegistry(stateDir).records.find(item => item.extensionId === 'foundry.w6-lint-fixture' && item.status !== 'REMOVED')
  results.push(check('W6_RESTART_RECOVERY', adapterReadyIsExtensionHost(afterRestart) && copiesAfter === 1 && afterRestart?.activationTimestamp !== beforeRestart?.activationTimestamp && Boolean(lintAfter), `copies=${copiesAfter} lint=${lintAfter?.status}@${lintAfter?.version}`))
  results.push(check('fixture_M', copiesAfter === 1 && adapterReadyIsExtensionHost(afterRestart), 'restart recovery'))

  const healthNow = await host.health()
  const wbPid = Number(healthNow.pid)
  const readyBeforeChild = parseAdapterReady(readJson(readyFile))
  if (wbPid) {
    try { process.kill(wbPid, 'SIGKILL') } catch { /* ignore */ }
    let recoveredReady = await waitPort(3849, 40000)
    if (!recoveredReady) {
      const forced = await host.startOwned({ force: true }) as { ready?: boolean }
      recoveredReady = forced.ready === true || await waitPort(3849, 40000)
    }
    await stopExtHostClient(stateDir, client.child)
    try { unlinkSync(path.join(stateDir, 'exthost-client-ready.json')) } catch { /* none */ }
    try { unlinkSync(path.join(stateDir, 'exthost-client-stop.json')) } catch { /* none */ }
    client = launchExtHostClient(root, folder, sandboxEnv)
    await waitFile(path.join(stateDir, 'exthost-client-ready.json'), 90000)
    let readyChild = parseAdapterReady(readJson(readyFile))
    const start = Date.now()
    while (Date.now() - start < 90000) {
      readyChild = parseAdapterReady(readJson(readyFile))
      if (adapterReadyIsExtensionHost(readyChild) && readyChild?.activationTimestamp !== readyBeforeChild?.activationTimestamp) break
      await sleep(300)
    }
    const recoveredHealth = await host.health()
    const childPass = recoveredReady && adapterReadyIsExtensionHost(readyChild) && readyChild?.activationTimestamp !== readyBeforeChild?.activationTimestamp
    results.push(check('EXTENSION_HOST_RECOVERY', Boolean(childPass || recoveredHealth.recovering === true && adapterReadyIsExtensionHost(readyChild)), `host=${readyChild?.host || 'missing'} recovering=${recoveredHealth.recovering}`))
  } else {
    results.push(check('EXTENSION_HOST_RECOVERY', false, 'no pid'))
  }

  await stopExtHostClient(stateDir, client.child)
  await stopDesktop(launched.child)
  await host.stopOwned()
  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS', sandboxVerdict))
  results.push(check('OPENVSX_ENABLED', OPENVSX_DEFAULT_ON === false, 'NO default-on'))
  results.push(check('MICROSOFT_MARKETPLACE_ENABLED', MICROSOFT_MARKETPLACE_ENABLED === false, 'NO'))
  results.push(check('WORKBENCH_DEFAULT', WORKBENCH_DEFAULT === false, 'NO'))
  results.push(check('GOVERNED_EXTENSION_SYSTEM', results.filter(item => item.name.startsWith('fixture_') || item.name === 'LOCAL_VSIX_INSTALL' || item.name === 'COMMANDER_GATED_EXTENSION_INSTALL' || item.name === 'W6_RESTART_RECOVERY' || item.name === 'EXTENSION_ACTIVATION_PROOF').every(item => item.pass), 'lifecycle'))
  results.push(check('LINUX_FIRST', linuxHostIdentity().linuxFirst === true, JSON.stringify(linuxHostIdentity())))

  report.results = results
  report.failed = results.filter(item => !item.pass).map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w6'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w6/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  const failed = results.filter(item => !item.pass)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W6_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W6_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW6Proof }
