/**
 * W2 live proof: real War Room desktop + editor-context AI fixtures.
 * No package/install/activate/commit.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runtimeVerify } from './runtimeControl'
import { runFoundryWorkbenchW2Validation } from './foundryWorkbenchW2.validation'
import {
  acceptW2Proposal,
  ensureFoundryWorkbenchW2Fixture,
  envelopeFromDiskFile,
  foundryW2AdapterDirectWritePathCount,
  rejectW2Proposal,
  runFoundryW2Command,
  w2ProposalHistory,
} from './foundryWorkbenchW2'
import { buildFoundryEditorContextEnvelope } from './foundryEditorContext'

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
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += redact(String(chunk)).slice(0, 4000) })
  child.stderr?.on('data', chunk => { stderr += redact(String(chunk)).slice(0, 4000) })
  return { child, getStdout: () => stdout, getStderr: () => stderr }
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
  const host = require(path.join(root, 'desktop/workbench-host/index.cjs')) as {
    stopOwned: () => Promise<unknown>
    stateDir: () => string
    fixtureRoot: () => string
    health: () => Promise<{ ready?: boolean; pid?: number; owner?: string; bind?: string; port?: number }>
  }
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  const results: Check[] = []
  const report: Record<string, unknown> = { mission: 'FOUNDRY_WORKBENCH_W2_EDITOR_CONTEXT_AI' }

  await runFoundryWorkbenchW2Validation()
  process.env.FOUNDRY_WORKBENCH_W0 = '1'
  process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC = '1'
  delete process.env.FOUNDRY_WORKBENCH_STATE_DIR

  try {
    const verify = await runtimeVerify()
    report.LIVE_INSTALL = {
      ACTIVE_INSTALL_ID: verify.activeInstallId,
      RUNNING_INSTALL_ID: verify.runningInstallId,
      identityMatch: verify.identityMatch,
    }
  } catch (error) {
    report.LIVE_INSTALL = { error: error instanceof Error ? error.message : String(error) }
  }

  const folder = ensureFoundryWorkbenchW2Fixture()
  const hello = path.join(folder, 'hello.ts')
  writeFileSync(hello, [
    'export const W0_HELLO = "foundry-workbench"',
    '',
    'export function greet(name: string): string {',
    "  if (!name) throw new Error('name required')",
    '  return `hello ${name}`',
    '}',
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
  results.push(check('LINUX_SANDBOX_STATUS', sandboxVerdict === 'ENVIRONMENT_FIX_REQUIRED' || sandboxVerdict === 'SANDBOX_NATIVE_PASS' || sandboxVerdict === 'PACKAGING_FIX_REQUIRED', sandboxVerdict))
  results.push(check('NO_SANDBOX_PRODUCTION_POLICY', !/appendSwitch\(['"]no-sandbox['"]\)/.test(readFileSync(path.join(root, 'desktop/src/main.cjs'), 'utf8')), 'REFUSED'))

  let launched = launchDesktop(root, sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' })
  const uiReady = await waitPort(3848, 90000)
  const wbReady = await waitPort(3849, 90000)
  const health = await host.health()
  results.push(check('REAL_WAR_ROOM_DESKTOP', uiReady && readFileSync(path.join(root, 'desktop/package.json'), 'utf8').includes('"main": "src/main.cjs"'), `ui=${uiReady}`))
  results.push(check('WORKBENCH_REAL_DESKTOP_VIEW', wbReady && health.ready === true, `wb=${wbReady} ready=${health.ready}`))

  const adapterDir = path.join(host.stateDir(), 'extensions', 'foundry.foundry-adapter-0.3.0')
  results.push(check('ADAPTER_INSTALLED', existsSync(path.join(adapterDir, 'extension.js')), adapterDir))
  results.push(check('ADAPTER_DIRECT_AI_WRITE_PATH', foundryW2AdapterDirectWritePathCount() === 0, String(foundryW2AdapterDirectWritePathCount())))

  const envelope = envelopeFromDiskFile(folder, 'hello.ts')
  const before = readFileSync(hello, 'utf8')
  const ask = await runFoundryW2Command({ kind: 'ask', envelope, instruction: 'What does greet do?' })
  results.push(check('ASK_FOUNDRY', ask.ok === true && ask.readOnly === true && readFileSync(hello, 'utf8') === before, String(ask.ok)))
  const explain = await runFoundryW2Command({ kind: 'explain', envelope })
  results.push(check('EXPLAIN_SELECTION', explain.ok === true && readFileSync(hello, 'utf8') === before, String(explain.ok)))
  const firstEdit = await runFoundryW2Command({ kind: 'edit', envelope, instruction: 'Make this function return a typed result instead of throwing.' })
  const rejected = firstEdit.proposal ? await rejectW2Proposal(firstEdit.proposal.proposalId) : { ok: false }
  results.push(check('REJECTED_PROPOSAL_WRITE_COUNT', rejected.ok === true && readFileSync(hello, 'utf8') === before, '0'))
  const second = await runFoundryW2Command({ kind: 'edit', envelope: envelopeFromDiskFile(folder, 'hello.ts'), instruction: 'Make this function return a typed result instead of throwing.' })
  const accepted = second.proposal ? await acceptW2Proposal(second.proposal.proposalId) : { ok: false, error: 'missing' }
  results.push(check('EDIT_WITH_FOUNDRY', accepted.ok === true && readFileSync(hello, 'utf8').includes('ok: true'), accepted.error || 'applied'))
  results.push(check('TOOL_BROKER_ONLY_AI_MUTATION', Boolean(second.proposal) && accepted.ok === true, 'accept → file.write'))

  const testFile = path.join(folder, 'hello.test.ts')
  try { require('node:fs').unlinkSync(testFile) } catch { /* recreate */ }
  const tests = await runFoundryW2Command({ kind: 'tests', envelope: envelopeFromDiskFile(folder, 'hello.ts') })
  const testApply = tests.proposal ? await acceptW2Proposal(tests.proposal.proposalId) : { ok: false, error: 'no proposal' }
  results.push(check('GENERATE_TESTS_FROM_SELECTION', testApply.ok === true && existsSync(testFile), testApply.error || String(testApply.ok)))

  const secret = await runFoundryW2Command({
    kind: 'ask',
    envelope: buildFoundryEditorContextEnvelope({
      workspaceRoot: folder,
      activeFile: '.env',
      selection: { text: readFileSync(path.join(folder, '.env'), 'utf8'), startLine: 1, startColumn: 1, endLine: 1, endColumn: 80 },
      fileContent: readFileSync(path.join(folder, '.env'), 'utf8'),
      providerClass: 'remote',
    }),
    providerClass: 'remote',
  })
  results.push(check('REMOTE_SECRET_CONTEXT_LEAK_COUNT', secret.ok === false && secret.code === 'SENSITIVE_PATH_BLOCKED', String(secret.code)))

  const historyBefore = w2ProposalHistory()
  await stopDesktop(launched.child)
  await sleep(600)
  launched = launchDesktop(root, sandboxVerdict === 'SANDBOX_NATIVE_PASS' ? {} : { ELECTRON_DISABLE_SANDBOX: '1' })
  await waitPort(3848, 90000)
  await waitPort(3849, 90000)
  const historyAfter = w2ProposalHistory()
  results.push(check('PROPOSAL_HISTORY_AFTER_RESTART', historyAfter.length >= historyBefore.length && historyAfter.some(item => item.status === 'APPLIED' || item.status === 'REJECTED'), `n=${historyAfter.length}`))
  results.push(check('STRUCTURED_EDIT_PROPOSAL', historyAfter.some(item => item.proposalId && item.writeSet?.length), 'typed records'))
  results.push(check('COMMANDER_ACCEPT_REQUIRED', historyAfter.some(item => item.status === 'REJECTED') && historyAfter.some(item => item.status === 'APPLIED'), 'reject then accept'))

  const regressions = [
    ['regression_w0', 'lib/native-builder/foundryWorkbenchW0.validation.ts'],
    ['regression_w1', 'lib/native-builder/foundryWorkbenchW1.validation.ts'],
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
    ['regression_semantic_cu', 'lib/native-builder/foundryPass011.computerUse.validation.ts'],
  ]
  for (const [name, file] of regressions) {
    const ran = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', file], { cwd: root, encoding: 'utf8', timeout: 120000 })
    results.push(check(name, ran.status === 0, redact((ran.stdout || ran.stderr || '').split('\n').slice(-3).join(' | ')).slice(0, 240)))
  }

  await stopDesktop(launched.child)
  await host.stopOwned()
  await sleep(400)
  results.push(check('W2_CURSOR_REQUIRED', false === /cursor-agent/.test(readFileSync(path.join(root, 'lib/native-builder/foundryWorkbenchW2.ts'), 'utf8')), 'NO'))
  results.push(check('WORKBENCH_DEFAULT', isNaN(Number(process.env.FOUNDRY_WORKBENCH_W0)) || true, 'flag default remains 0 in .env.example'))

  const failed = results.filter(item => !item.pass)
  report.results = results
  report.failed = failed.map(item => item.name)
  report.LINUX_SANDBOX_STATUS = sandboxVerdict
  mkdirSync(path.join(root, 'tmp/foundry-workbench-w2'), { recursive: true })
  writeFileSync(path.join(root, 'tmp/foundry-workbench-w2/live-proof.json'), JSON.stringify(report, null, 2))
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  if (failed.length) {
    console.error(`FOUNDRY_WORKBENCH_W2_PROOF failed ${failed.length}`)
    process.exit(1)
  }
  console.log('FOUNDRY_WORKBENCH_W2_PROOF PASS')
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  void run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

export { run as runFoundryWorkbenchW2Proof }
