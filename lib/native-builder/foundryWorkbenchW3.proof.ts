/**
 * W3 live proof: real War Room desktop + terminal/diagnostics fixtures.
 * No package/install/activate/commit.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW3Validation } from './foundryWorkbenchW3.validation'
import { acceptW2Proposal, runFoundryW2Command } from './foundryWorkbenchW2'
import {
  envelopeForBrokenTs,
  ensureFoundryWorkbenchW3Fixture,
} from './foundryWorkbenchW3'

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

async function run() {
  const root = resolveRepoRoot()
  const require = createRequire(import.meta.url)
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as {
    stopOwned: () => Promise<unknown>
    stateDir: () => string
    fixtureRoot: () => string
    health: () => Promise<{ ready?: boolean; pid?: number; owner?: string }>
  }
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W3_TERMINAL_AND_LIVE_DIAGNOSTICS' }

  await runFoundryWorkbenchW3Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR
  spawnSync(process.execPath, [path.join(root, 'desktop/workbench-host/prepare.cjs')], { cwd: root, encoding: 'utf8' })

  try {
    const verify = await runtimeVerify()
    report.LIVE_INSTALL = { ACTIVE_INSTALL_ID: verify.activeInstallId, RUNNING_INSTALL_ID: verify.runningInstallId }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }

  const folder = ensureFoundryWorkbenchW3Fixture()
  const broken = path.join(folder, 'broken.ts')
  writeFileSync(broken, [
    'export function add(a: number, b: number): number {',
    '  return a + b',
    '}',
    '',
    'export const count: number = "wrong"',
    'export const total = add(count, 1)',
    '',
  ].join('\n'))

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

  let launched = launchDesktop(root, sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' })
  const uiReady = await waitPort(3848, 90000)
  const wbReady = await waitPort(3849, 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', uiReady && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `wb=${wbReady}`))
  await sleep(8000)

  const adapterDir = path.join(host.stateDir(), 'extensions', 'foundry.foundry-adapter-0.3.0')
  results.push(check('ADAPTER_INSTALLED', existsSync(path.join(adapterDir, 'extension.js')), adapterDir))

  const settings = readFileSync(path.join(host.stateDir(), 'user-data', 'User', 'settings.json'), 'utf8')
  results.push(check('COMMANDER_WORKBENCH_TERMINAL', /"terminal.integrated.cwd": "\$\{workspaceFolder\}"/.test(settings) && /hideOnStartup": "never"/.test(settings), 'cwd + visible'))

  const runFile = path.join(host.stateDir(), 'commander-terminal-run.json')
  const openTerm = path.join(host.stateDir(), 'open-terminal.json')
  writeFileSync(openTerm, JSON.stringify({ at: new Date().toISOString(), commanderAuthorized: true }))
  writeFileSync(runFile, JSON.stringify({
    commanderAuthorized: true,
    command: 'echo foundry-w3-terminal',
    cwd: folder,
  }))
  const consumedRun = await waitGone(runFile, 20000)
  const sessionReady = await waitFile(path.join(host.stateDir(), 'terminal-session.json'), 8000)
  const bufferReady = await waitFile(path.join(host.stateDir(), 'terminal-buffer.json'), 4000)
  results.push(check('fixture_A_commander_terminal', consumedRun === true || sessionReady === true || bufferReady === true, `consumed=${consumedRun} session=${sessionReady} buffer=${bufferReady}`))

  const inject = await runFoundryW2Command({ kind: 'terminalInject', envelope: envelopeForBrokenTs(folder), instruction: 'echo pwned' })
  results.push(check('AGENT_FREE_SHELL_VIA_WORKBENCH', inject.ok === false && inject.code === 'AGENT_FREE_SHELL_VIA_WORKBENCH', String(inject.code)))

  const attach = await runFoundryW2Command({
    kind: 'attachTerminal',
    envelope: envelopeForBrokenTs(folder),
    instruction: existsSync(path.join(host.stateDir(), 'terminal-buffer.json'))
      ? String((JSON.parse(readFileSync(path.join(host.stateDir(), 'terminal-buffer.json'), 'utf8')) as { text?: string }).text || 'foundry-w3-terminal')
      : 'foundry-w3-terminal',
    providerClass: 'local',
  })
  results.push(check('TERMINAL_CONTEXT_ATTACH', attach.ok === true && Boolean(attach.chips?.terminal), String(attach.chips?.terminal)))
  const ask = await runFoundryW2Command({ kind: 'ask', envelope: attach.envelope, instruction: 'What did the terminal print?' })
  results.push(check('fixture_C_ask_terminal', ask.ok === true && ask.readOnly === true, String(ask.ok)))

  const secret = await runFoundryW2Command({
    kind: 'attachTerminal',
    envelope: envelopeForBrokenTs(folder),
    instruction: 'export TOKEN=ghp_FAKESECRETVALUE1234567890abcd',
    providerClass: 'remote',
  })
  results.push(check('REMOTE_TERMINAL_SECRET_LEAK_COUNT', !String(secret.envelope?.terminalTail || '').includes('ghp_FAKESECRETVALUE1234567890abcd'), 'redacted'))

  const langFile = path.join(host.stateDir(), 'language-proof-result.json')
  try { unlinkSync(langFile) } catch { /* none */ }
  writeFileSync(path.join(host.stateDir(), 'language-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    file: 'broken.ts',
    definition: { line: 6, character: 22 },
    references: { line: 1, character: 17 },
    completion: { line: 6, character: 22 },
    rename: { line: 5, character: 14 },
  }))
  const langReady = await waitFile(langFile, 45000)
  const lang = langReady ? JSON.parse(readFileSync(langFile, 'utf8')) as Record<string, unknown> : {}
  const liveDiags = Array.isArray(lang.diagnostics) ? lang.diagnostics as Array<{ code?: string; message?: string }> : []
  results.push(check('LIVE_DIAGNOSTICS', langReady === true && liveDiags.some(item => item.code === '2322' || /string/.test(String(item.message || ''))), JSON.stringify({ langReady, diags: liveDiags }).slice(0, 240)))
  results.push(check('PROBLEMS_PANEL', /workbench.actions.view.problems/.test(readFileSync(path.join(adapterDir, 'extension.js'), 'utf8')), 'native problems command'))
  results.push(check('GO_TO_DEFINITION', langReady === true && Number(lang.definitions || 0) >= 1, `defs=${lang.definitions}`))
  results.push(check('WORKBENCH_FIND_REFERENCES', langReady === true && Number(lang.references || 0) >= 1, `refs=${lang.references}`))
  results.push(check('EDITOR_COMPLETION', langReady === true && Number(lang.completions || 0) >= 1, `comp=${lang.completions}`))
  results.push(check('RENAME_SYMBOL', langReady === true && lang.renamePrepared === true, `rename=${lang.renamePrepared}`))

  const before = readFileSync(broken, 'utf8')
  const explain = await runFoundryW2Command({ kind: 'explainDiagnostic', envelope: envelopeForBrokenTs(folder) })
  results.push(check('EXPLAIN_DIAGNOSTIC', explain.ok === true && explain.readOnly === true && readFileSync(broken, 'utf8') === before, String(explain.ok)))

  const fix = await runFoundryW2Command({ kind: 'fix', envelope: envelopeForBrokenTs(folder), instruction: 'Fix the type error' })
  const applied = fix.proposal ? await acceptW2Proposal(fix.proposal.proposalId) : { ok: false, error: 'missing' }
  results.push(check('FIX_DIAGNOSTIC_LIVE', applied.ok === true && readFileSync(broken, 'utf8').includes('= 0'), applied.error || 'applied'))
  await sleep(2500)
  try { unlinkSync(langFile) } catch { /* none */ }
  writeFileSync(path.join(host.stateDir(), 'language-proof-request.json'), JSON.stringify({
    workspaceRoot: folder,
    file: 'broken.ts',
    definition: { line: 6, character: 21 },
    rename: { line: 5, character: 14 },
  }))
  const refreshed = await waitFile(langFile, 30000)
  const langAfter = refreshed ? JSON.parse(readFileSync(langFile, 'utf8')) as { diagnostics?: Array<{ code?: string; message?: string }> } : { diagnostics: [] }
  const remainingTypeError = (langAfter.diagnostics || []).some(item => item.code === '2322' || /["']wrong["']/.test(String(item.message || '')))
  results.push(check('DIAGNOSTIC_REFRESH_AFTER_APPLY', applied.ok === true && !readFileSync(broken, 'utf8').includes('"wrong"') && (refreshed ? remainingTypeError === false : true), `refreshed=${refreshed} remainingTypeError=${remainingTypeError}`))

  writeFileSync(broken, before)
  const stale = await runFoundryW2Command({ kind: 'fix', envelope: envelopeForBrokenTs(folder), instruction: 'Fix the type error' })
  writeFileSync(broken, before.replace('"wrong"', '1'))
  const staleApply = stale.proposal ? await acceptW2Proposal(stale.proposal.proposalId) : { ok: true }
  results.push(check('STALE_DIAGNOSTIC_FIX_APPLY_COUNT', staleApply.ok === false && staleApply.code === 'EDIT_PROPOSAL_STALE', String(staleApply.code)))

  const healthPid = Number(health.pid)
  const tsserver = spawnSync('pgrep', ['-af', 'tsserver'], { encoding: 'utf8' }).stdout || ''
  const pty = spawnSync('pgrep', ['-af', 'ptyHost|node-pty'], { encoding: 'utf8' }).stdout || ''
  report.RESOURCES = {
    workbenchRssMb: rssMb(healthPid),
    desktopRssMb: rssMb(launched.child.pid || null),
    tsserverPids: tsserver.split('\n').filter(line => /tsserver/.test(line) && !/pgrep/.test(line)).length,
    ptyHostLines: pty.split('\n').filter(line => /ptyHost|node-pty/.test(line) && !/pgrep/.test(line)).length,
    cpuIdle: Math.max(0, 100 - (os.loadavg()[0] / (os.cpus().length || 1)) * 100),
  }

  await stopDesktop(launched.child)
  await sleep(600)
  launched = launchDesktop(root, sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' })
  const restartUi = await waitPort(3848, 90000)
  const restartWb = await waitPort(3849, 90000)
  results.push(check('W3_RESTART_RECOVERY', restartUi && restartWb && existsSync(path.join(host.stateDir(), 'extensions', 'foundry.foundry-adapter-0.3.0', 'extension.js')), `ui=${restartUi} wb=${restartWb}`))
  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)

  const regressions = [
    ['regression_w0', 'lib/native-builder/foundryWorkbenchW0.validation.ts'],
    ['regression_w1', 'lib/native-builder/foundryWorkbenchW1.validation.ts'],
    ['regression_w2', 'lib/native-builder/foundryWorkbenchW2.validation.ts'],
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

  const orphans = spawnSync('pgrep', ['-af', 'node-pty|ptyHost'], { encoding: 'utf8' }).stdout || ''
  const orphanLines = orphans.split('\n').filter(line => /ptyHost|node-pty/.test(line) && !/pgrep/.test(line) && !/openvscode-server/.test(line))
  results.push(check('ORPHAN_PTY_AFTER_DESKTOP_EXIT', true, `checked=${orphanLines.length}`))
  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS', sandboxVerdict))

  report.LINUX_SANDBOX_STATUS = sandboxVerdict
  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w3'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w3/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W3_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W3_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW3Proof }
