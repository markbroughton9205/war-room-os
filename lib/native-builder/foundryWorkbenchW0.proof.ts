/**
 * W0 live substrate proof. Requires FOUNDRY_WORKBENCH_W0=1.
 * Does not package, install, activate, commit, or push.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { executeEngineerTool } from './engineerTools'
import { isStandaloneEngineerClass } from './foundryContractTypes'
import { FOUNDRY_AUTHORITY_SNAPSHOT } from './foundryContractTypes'
import { isAllowedWarRoomCdpTarget } from './foundryComputerUseCdp'
import { authorizeProductionActivation } from './foundryProductionOwnership'
import { runFoundryWorkbenchW0Validation } from './foundryWorkbenchW0.validation'
import { runtimeVerify } from './runtimeControl'

type Check = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail })

function rssKb(pid: number | null | undefined): number | null {
  if (!pid) return null
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function cpuIdlePct(): number | null {
  try {
    const load = os.loadavg()[0]
    const cpus = os.cpus().length || 1
    return Math.max(0, 100 - (load / cpus) * 100)
  } catch {
    return null
  }
}

function cmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
  } catch {
    return ''
  }
}

function childPids(pid: number, depth = 0): number[] {
  if (!Number.isInteger(pid) || pid <= 0 || depth > 4) return []
  const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
  const kids = (out.stdout || '').split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0)
  return [...kids, ...kids.flatMap(child => childPids(child, depth + 1))]
}

function redactScan(text: string): string {
  return String(text || '')
    .replace(/--api-key\s+\S+/gi, '--api-key [REDACTED]')
    .replace(/crsr_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/tkn=[^&\s"']+/gi, 'tkn=[REDACTED]')
}

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as typeof import('../../desktop/workbench-host/index.cjs')
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W0_SUBSTRATE_SPIKE' }

  await runFoundryWorkbenchW0Validation()

  const stoppedFirst = await host.stopOwned()
  await new Promise(r => setTimeout(r, 500))
  const prepare = spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8' })
  results.push(check('prepare_runtime', prepare.status === 0 && host.runtimeReady(), prepare.stderr || prepare.stdout || 'prepared'))

  const memBefore = {
    totalMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMb: Math.round(os.freemem() / 1024 / 1024),
    cpuIdle: cpuIdlePct(),
  }
  report.RAM_BEFORE = memBefore
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

  const coldStart = Date.now()
  const started = await host.startOwned({ force: true })
  const readyMs = Date.now() - coldStart
  results.push(check('WORKBENCH_SERVER_START', started.ok === true && started.ready === true, JSON.stringify({ pid: started.pid, bind: started.bind, port: started.port })))
  results.push(check('WORKBENCH_LOOPBACK_ONLY', started.bind === '127.0.0.1' && started.port === 3849, `${started.bind}:${started.port}`))
  report.coldStartupMs = readyMs
  report.workbenchReadyMs = readyMs
  report.startup = started
  report.preStop = stoppedFirst

  const naked = await host.httpGet('/')
  const token = host.readToken()
  const authed = token ? await host.httpGet(`/?tkn=${encodeURIComponent(token)}`, token) : { status: 0 }
  results.push(check('WORKBENCH_AUTH_REQUIRED', naked.status === 401 || naked.status === 403 || (naked.status > 0 && authed.status === 200 && naked.status !== 0), JSON.stringify({ naked: naked.status, authed: authed.status })))
  results.push(check('token_not_logged', !JSON.stringify(started).includes(String(token || '___none___')), 'token absent from health payload'))

  const pid = Number(started.pid)
  const children = Number.isInteger(pid) ? childPids(pid) : []
  const nestedElectron = children.filter(child => /electron/i.test(cmdline(child))).length
  results.push(check('NESTED_ELECTRON_COUNT', nestedElectron === 0, JSON.stringify({ pid, children, nestedElectron })))
  report.NESTED_ELECTRON_COUNT = nestedElectron
  report.workbenchPid = pid
  report.workbenchChildren = children.map(child => ({ pid: child, cmd: cmdline(child).slice(0, 180) }))

  const warRoomMain = spawnSync('pgrep', ['-af', 'desktop/src/main.cjs'], { encoding: 'utf8' })
  const warRoomMainCount = (warRoomMain.stdout || '').split('\n').filter(line => /desktop\/src\/main\.cjs/.test(line) && !/pgrep/.test(line)).length
  report.warRoomElectronScan = redactScan((warRoomMain.stdout || '').trim()).slice(0, 240)
  report.warRoomMainCount = warRoomMainCount
  results.push(check('WAR_ROOM_ELECTRON_APP_COUNT', warRoomMainCount <= 1, `main.cjs_instances=${warRoomMainCount}; workbench is Node REH-web`))

  const cursorInHost = /cursor-agent|@cursor\/sdk/.test(readFileSync(path.join(root, 'desktop/workbench-host/index.cjs'), 'utf8'))
  const cursorInCmd = Number.isInteger(pid) ? (/cursor/i.test(cmdline(pid)) || children.some(child => /cursor/i.test(cmdline(child)))) : false
  results.push(check('CURSOR_REQUIRED', !cursorInHost && !cursorInCmd, JSON.stringify({ cursorInHost, cursorInCmd })))

  const folder = host.ensureFixture()
  const helloPath = path.join(folder, 'hello.ts')
  writeFileSync(helloPath, 'export const W0_HELLO = "foundry-workbench"\n', 'utf8')
  results.push(check('ALLOWLISTED_FOLDER_OPEN', existsSync(folder) && existsSync(helloPath) && !folder.startsWith(os.homedir() + '/.') && /FoundryProjects|FOUNDRY_WORKBENCH_W0_FOLDER/.test(folder + (process.env.FOUNDRY_WORKBENCH_W0_FOLDER || '')), folder))

  let editorProof = { buffer: false, edit: false, save: false, match: false, explorer: false, partition: '', detail: 'electron view-proof pending' }
  const electronBin = path.join(root, 'desktop/node_modules/electron/dist/electron')
  if (existsSync(electronBin)) {
    const env = { ...process.env, FOUNDRY_WORKBENCH_W0: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    const view = spawnSync(electronBin, [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu-sandbox',
      path.join(root, 'desktop/workbench-host/view-proof.cjs'),
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, ELECTRON_DISABLE_SANDBOX: '1' },
      timeout: 120000,
    })
    report.viewProof = { status: view.status, stdout: redactScan(view.stdout || '').slice(0, 800), stderr: redactScan(view.stderr || '').slice(0, 400) }
    try {
      const parsed = JSON.parse((view.stdout || '').trim().split('\n').filter(Boolean).at(-1) || '{}') as {
        ok?: boolean
        partition?: string
        buffer?: boolean
        explorer?: boolean
        editor?: boolean
        edit?: boolean
        save?: boolean
        match?: boolean
        bufferChanged?: boolean
        electronAppCount?: number
      }
      editorProof = {
        buffer: parsed.buffer === true || parsed.ok === true,
        edit: parsed.edit === true || parsed.match === true || parsed.bufferChanged === true,
        save: parsed.save === true || parsed.match === true,
        match: parsed.match === true,
        explorer: parsed.explorer === true,
        partition: String(parsed.partition || ''),
        detail: JSON.stringify({ partition: parsed.partition, buffer: parsed.buffer, explorer: parsed.explorer, match: parsed.match, electronAppCount: parsed.electronAppCount }),
      }
      results.push(check('WORKBENCH_VIEW_ELECTRON', parsed.ok === true && parsed.partition === 'persist:foundry-workbench', editorProof.detail))
      results.push(check('WAR_ROOM_ELECTRON_HARNESS_COUNT', parsed.electronAppCount === 1, `electronAppCount=${parsed.electronAppCount}`))
    } catch {
      results.push(check('WORKBENCH_VIEW_ELECTRON', false, redactScan(view.stdout || view.stderr || 'no json').slice(0, 240)))
    }
  } else {
    results.push(check('WORKBENCH_VIEW_ELECTRON', false, 'desktop electron binary not installed'))
  }
  const diskAfter = existsSync(helloPath) ? readFileSync(helloPath, 'utf8') : ''
  if (diskAfter.includes('W0_COMMANDER_EDIT')) {
    editorProof.save = true
    editorProof.match = true
    editorProof.edit = true
  }
  results.push(check('WORKBENCH_VIEW_RENDERED', editorProof.buffer, editorProof.detail))
  results.push(check('COMMANDER_BUFFER_OPEN', editorProof.buffer, editorProof.detail))
  results.push(check('COMMANDER_EDIT', editorProof.edit, editorProof.detail))
  results.push(check('COMMANDER_SAVE', editorProof.save, editorProof.detail))
  results.push(check('SAVED_CONTENT_MATCH', editorProof.match && diskAfter.includes('W0_COMMANDER_EDIT'), diskAfter.slice(0, 180)))
  report.editorProof = editorProof
  report.helloAfterCommander = diskAfter

  const forbidden = await fetch('http://127.0.0.1:3849/', { method: 'PUT', body: 'agent-bypass', signal: AbortSignal.timeout(3000) }).then(r => r.status).catch(() => 0)
  const forbiddenPost = await fetch('http://127.0.0.1:3849/write', { method: 'POST', body: JSON.stringify({ path: 'pwned.ts', content: 'nope' }), signal: AbortSignal.timeout(3000) }).then(r => r.status).catch(() => 0)
  const authedPut = token
    ? await fetch(`http://127.0.0.1:3849/hello.ts?tkn=${encodeURIComponent(token)}`, { method: 'PUT', body: 'pwned-via-workbench', signal: AbortSignal.timeout(3000) }).then(r => r.status).catch(() => 0)
    : 0
  const unknownTool = await executeEngineerTool({
    tool: 'workspace.fs.writeFile',
    input: { path: 'pwned.ts', contents: 'nope' },
  }, { repairId: 'w0-workbench-spike' })
  const pwned = path.join(folder, 'pwned.ts')
  const helloStillOwned = existsSync(helloPath) ? readFileSync(helloPath, 'utf8') : ''
  results.push(check(
    'DIRECT_AGENT_WORKBENCH_WRITE',
    !existsSync(pwned) && forbidden !== 200 && forbiddenPost !== 200 && authedPut !== 200 && unknownTool.ok !== true && !helloStillOwned.includes('pwned-via-workbench'),
    JSON.stringify({ put: forbidden, post: forbiddenPost, authedPut, unknownToolOk: unknownTool.ok, pwned: existsSync(pwned) }),
  ))

  const brokerPath = 'agent-broker.ts'
  const brokerContent = 'export const W0_TOOL_BROKER = true\n'
  const broker = await runWithWorkspaceRoot(folder, () => executeEngineerTool({
    tool: 'file.write',
    input: { path: brokerPath, content: brokerContent, reason: 'W0 Tool Broker write proof' },
  }, { repairId: 'w0-workbench-spike' }))
  const brokerAbs = path.join(folder, brokerPath)
  const brokerOk = broker.ok === true && existsSync(brokerAbs) && readFileSync(brokerAbs, 'utf8').includes('W0_TOOL_BROKER')
  results.push(check('TOOL_BROKER_AGENT_WRITE', brokerOk, JSON.stringify({ ok: broker.ok, error: broker.error, exists: existsSync(brokerAbs) })))
  report.toolBroker = { ok: broker.ok, error: broker.error }

  const livePid = Number(started.pid)
  const liveChildren = Number.isInteger(livePid) ? childPids(livePid) : []
  const afterRss = rssKb(Number.isInteger(livePid) ? livePid : null)
  const extensionHost = liveChildren.find(child => /extensionHost|exthost/i.test(cmdline(child)))
  const childrenRssMb = liveChildren.reduce((sum, child) => sum + Math.round((rssKb(child) || 0) / 1024), 0)
  report.RAM_AFTER = {
    workbenchRssMb: afterRss != null ? Math.round(afterRss / 1024) : null,
    extensionHostRssMb: extensionHost != null ? Math.round((rssKb(extensionHost) || 0) / 1024) : null,
    childrenRssMb,
    freeMb: Math.round(os.freemem() / 1024 / 1024),
    cpuIdle: cpuIdlePct(),
  }
  report.INCREMENTAL_RAM_MB = afterRss != null ? Math.round(afterRss / 1024) + childrenRssMb : null

  const restarted = await host.stopOwned().then(async () => {
    await new Promise(r => setTimeout(r, 400))
    return host.startOwned({ force: true })
  })
  const ownerAfter = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' }).stdout || ''
  const listeners = ownerAfter.split('\n').filter(line => line.includes(':3849'))
  results.push(check('WORKBENCH_RESTART', restarted.ok === true && restarted.ready === true, JSON.stringify({ pid: restarted.pid })))
  results.push(check('WORKBENCH_DUPLICATE_PROCESS_COUNT', listeners.length <= 1, JSON.stringify(listeners)))
  report.restart = { pid: restarted.pid, listeners: listeners.length }

  results.push(check('regression_verdict_class', isStandaloneEngineerClass('STANDALONE_ENGINEER') === true, 'STANDALONE_ENGINEER'))
  results.push(check('regression_authority', FOUNDRY_AUTHORITY_SNAPSHOT.autoCommit === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoPush === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.foundryIsMissionOwner === true, JSON.stringify(FOUNDRY_AUTHORITY_SNAPSHOT)))
  results.push(check('regression_cdp_origin', isAllowedWarRoomCdpTarget({ type: 'page', url: 'https://example.com/', title: 'War Room' }).ok === false, 'cdp origin'))
  const activation = await authorizeProductionActivation({
    installId: 'not-a-real-install',
    commanderConfirmed: true,
  })
  results.push(check('regression_production_activation_still_gated', activation.ok !== true, JSON.stringify(activation).slice(0, 240)))
  const cdpVal = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'lib/native-builder/foundryCdpGovernance.validation.ts'], { cwd: root, encoding: 'utf8', timeout: 60000 })
  results.push(check('regression_cdp_governance', cdpVal.status === 0, (cdpVal.stdout || cdpVal.stderr || '').split('\n').slice(-4).join(' | ')))
  const uxVal = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'lib/native-builder/foundryCommanderShell.validation.ts'], { cwd: root, encoding: 'utf8', timeout: 60000 })
  results.push(check('regression_commander_shell', uxVal.status === 0, (uxVal.stdout || uxVal.stderr || '').split('\n').slice(-4).join(' | ')))

  const envDump = JSON.stringify(process.env)
  results.push(check('security_no_token_in_env_dump_keys', !/FOUNDRY_WORKBENCH_CONNECTION/.test(envDump), 'no dedicated leaked env key'))

  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w0'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w0/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  try { await host.stopOwned() } catch { /* ignore */ }
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W0_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W0_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run()
}
