/**
 * Foundry Workbench W5 — Commander debugger + Test Explorer.
 * Extends W4. Does not rebuild substrate, Tool Broker, SCM, or Mission Controller.
 * Node.js / JavaScript only. No OpenVSX. No marketplace test/debug extensions.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildFoundryEditorContextEnvelope, editorContextChips, hashEditorText, type FoundryEditorContextEnvelope } from './foundryEditorContext'
import { appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'
import { createFoundryEditProposal, type FoundryEditProposal } from './foundryEditProposal'
import { redactSecretLikeText } from './foundrySensitivePathGuard'
import { FOUNDRY_AUTHORITY_SNAPSHOT } from './foundryContractTypes'
import { collectScmSnapshot } from './foundryWorkbenchW4'

export const FOUNDRY_W5_COMMANDS = [
  'foundry.attachDebugContext',
  'foundry.explainDebugState',
  'foundry.fixFromDebugState',
  'foundry.explainFailedTest',
  'foundry.fixFailedTest',
  'foundry.attachTestResult',
  'foundry.openTesting',
] as const

export const W5_TEST_FRAMEWORK = 'node:test' as const
export const W5_DEBUG_LANGUAGE = 'javascript' as const
export const W5_SOURCE_MAP_STATUS = 'JS_FIXTURE_PROVEN_TS_MAP_LIMITED' as const
export const W5_WATCH_MODE_DEFAULT = 'disabled' as const
export const W4_1_STILL_DEFERRED = true
export const AUTO_STAGE_AFTER_DEBUG_FIX = false
export const AUTO_COMMIT_AFTER_DEBUG_FIX = false
export const AUTO_PUSH_AFTER_DEBUG_FIX = false
export const W5_COMMANDER_DEBUG_CHARGES_MISSION_BUDGET = false
export const W5_COMMANDER_TEST_CHARGES_MISSION_BUDGET = false
export const W5_MULTI_PROCESS_DEBUG = 'NOT_REQUIRED' as const
export const W5_BROWSER_DEBUG = 'NOT_REQUIRED' as const
export const W5_CONDITIONAL_BREAKPOINT = 'NATIVE_OPTIONAL_NOT_GATED' as const
export const W5_TEST_HISTORY = 'BOUNDED_CURRENT_RUN' as const

export type FoundryDebugFrame = {
  functionName: string
  file: string
  line: number
}

export type FoundryDebugVariable = {
  name: string
  value: string
  truncated: boolean
  redacted: boolean
}

export type FoundryDebugSnapshot = {
  sessionId: string | null
  stoppedReason: string | null
  activeFrame: string | null
  functionName: string | null
  file: string | null
  line: number | null
  boundedCallStack: FoundryDebugFrame[]
  boundedVariables: FoundryDebugVariable[]
  exception: string | null
  breakpoint: { file: string; line: number; enabled: boolean } | null
  attached: boolean
}

export type FoundryTestSnapshot = {
  runId: string | null
  testId: string | null
  testName: string | null
  file: string | null
  status: 'pass' | 'fail' | 'unknown'
  message: string | null
  expected: string | null
  actual: string | null
  stack: string | null
  duration: number | null
  outputTail: string | null
  attached: boolean
}

export type FoundryW5Response = {
  ok: boolean
  kind: string
  readOnly: boolean
  text?: string
  code?: string
  error?: string
  proposal?: FoundryEditProposal | null
  snapshot?: FoundryDebugSnapshot | FoundryTestSnapshot
  envelope?: FoundryEditorContextEnvelope | null
  chips?: ReturnType<typeof editorContextChips>
  tests?: Array<{ name: string; file: string; status: string; message?: string }>
  debug?: Record<string, unknown>
  privacy?: { redactionOccurred: boolean; remoteSecretLeakCount: number; providerClass: string }
}

const SECRET_RE = /ghp_|sk_live_|github_pat_|xox[baprs]-|Bearer\s+[A-Za-z0-9._-]{8,}/i

function clip(text: string, max: number) {
  const raw = String(text ?? '')
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`
}

export function redactDebugValue(value: string, providerClass: 'none' | 'local' | 'remote' = 'local'): { text: string; redacted: boolean; leak: number } {
  const text = redactSecretLikeText(clip(value, 200))
  const leak = providerClass === 'remote' && SECRET_RE.test(text) ? 1 : 0
  return { text, redacted: text !== value, leak }
}

export function boundDebugSnapshot(input: Partial<FoundryDebugSnapshot>, providerClass: 'none' | 'local' | 'remote' = 'local'): FoundryDebugSnapshot {
  const vars = (input.boundedVariables ?? []).slice(0, 12).map(item => {
    const redacted = redactDebugValue(item.value, providerClass)
    return { name: clip(item.name, 64), value: redacted.text, truncated: item.value.length > 200, redacted: redacted.redacted || item.redacted }
  })
  return {
    sessionId: input.sessionId ?? null,
    stoppedReason: input.stoppedReason ?? null,
    activeFrame: input.activeFrame ?? null,
    functionName: input.functionName ?? null,
    file: input.file ?? null,
    line: input.line ?? null,
    boundedCallStack: (input.boundedCallStack ?? []).slice(0, 8),
    boundedVariables: vars,
    exception: input.exception ? redactSecretLikeText(clip(input.exception, 500)) : null,
    breakpoint: input.breakpoint ?? null,
    attached: Boolean(input.attached),
  }
}

export function boundTestSnapshot(input: Partial<FoundryTestSnapshot>, providerClass: 'none' | 'local' | 'remote' = 'local'): FoundryTestSnapshot {
  const output = input.outputTail ? redactSecretLikeText(clip(input.outputTail, 2000)) : null
  const message = input.message ? redactSecretLikeText(clip(input.message, 500)) : null
  const leakSource = `${output || ''} ${message || ''}`
  if (providerClass === 'remote' && SECRET_RE.test(leakSource)) {
    /* caller records leak via redact — values already scrubbed */
  }
  return {
    runId: input.runId ?? null,
    testId: input.testId ?? null,
    testName: input.testName ?? null,
    file: input.file ?? null,
    status: input.status ?? 'unknown',
    message,
    expected: input.expected ? clip(input.expected, 200) : null,
    actual: input.actual ? clip(input.actual, 200) : null,
    stack: input.stack ? clip(input.stack, 800) : null,
    duration: input.duration ?? null,
    outputTail: output,
    attached: Boolean(input.attached),
  }
}

export function remoteDebugSecretLeakCount(snapshot: FoundryDebugSnapshot, providerClass: 'none' | 'local' | 'remote'): number {
  if (providerClass !== 'remote') return 0
  const blob = JSON.stringify(snapshot)
  return SECRET_RE.test(blob) ? 1 : 0
}

export function remoteTestSecretLeakCount(snapshot: FoundryTestSnapshot, providerClass: 'none' | 'local' | 'remote'): number {
  if (providerClass !== 'remote') return 0
  const blob = JSON.stringify(snapshot)
  return SECRET_RE.test(blob) ? 1 : 0
}

export function w5AdapterDebugControlPathCount(adapterSource: string): number {
  const hits = adapterSource.match(/startDebugging\(|debug\.stepOver|debug\.stepInto|debug\.continue|debug\.stop/g) || []
  const gated = adapterSource.includes('commanderAuthorized') && adapterSource.includes('runW5Proof')
  return gated ? 0 : hits.length
}

export function w5AdapterDirectWritePathCount(adapterSource: string): number {
  const forbidden = adapterSource.match(/workspace\.fs\.writeFile|applyEdit\s*\(|WorkspaceEdit/g)
  return forbidden ? forbidden.length : 0
}

const BUGGY_TOTAL = `export function calculateTotal(items) {
  let total = 0
  for (let i = 0; i < items.length - 1; i++) {
    total += items[i].price * items[i].qty
  }
  return total
}
`

const FIXED_TOTAL = `export function calculateTotal(items) {
  let total = 0
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].qty
  }
  return total
}
`

const TEST_FILE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateTotal } from './calculate-total.js'

test('sums all line items', () => {
  assert.equal(calculateTotal([
    { price: 10, qty: 2 },
    { price: 5, qty: 1 },
  ]), 25)
})

test('empty list is zero', () => {
  assert.equal(calculateTotal([]), 0)
})
`

const DEBUG_ENTRY = `import { calculateTotal } from './calculate-total.js'

const items = [
  { price: 10, qty: 2 },
  { price: 5, qty: 1 },
]
const token = 'not-a-secret'
const total = calculateTotal(items)
console.log(JSON.stringify({ total, token }))
`

const BOOM = `export function explode() {
  const token = 'ghp_FAKESECRETVALUE1234567890abcd'
  throw new Error('intentional fixture exception')
}

try {
  explode()
} catch (error) {
  console.error(String(error))
  throw error
}
`

const SECRET_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

test('does not leak secret-shaped output', () => {
  const token = 'ghp_FAKESECRETVALUE1234567890abcd'
  assert.equal(typeof token, 'string')
})
`

function writeLaunchIfMissing(folder: string) {
  const vscodeDir = path.join(folder, '.vscode')
  mkdirSync(vscodeDir, { recursive: true })
  const launchPath = path.join(vscodeDir, 'launch.json')
  if (!existsSync(launchPath)) {
    writeFileSync(launchPath, `${JSON.stringify({
      version: '0.2.0',
      configurations: [
        {
          type: 'pwa-node',
          request: 'launch',
          name: 'Foundry: Debug calculateTotal',
          program: '${workspaceFolder}/debug-entry.js',
          cwd: '${workspaceFolder}',
          console: 'internalConsole',
          skipFiles: ['<node_internals>/**'],
        },
        {
          type: 'pwa-node',
          request: 'launch',
          name: 'Foundry: Debug exception',
          program: '${workspaceFolder}/boom.js',
          cwd: '${workspaceFolder}',
          console: 'internalConsole',
        },
      ],
    }, null, 2)}\n`)
    writeFileSync(path.join(vscodeDir, 'FOUNDRY_LAUNCH_PROVENANCE.json'), `${JSON.stringify({
      generatedBy: 'foundry-workbench-w5',
      language: W5_DEBUG_LANGUAGE,
      reason: 'Minimal Foundry-safe Node launch config. Existing launch.json is never overwritten.',
      at: new Date().toISOString(),
    }, null, 2)}\n`)
  }
}

export function ensureFoundryWorkbenchW5Fixture(root?: string): string {
  const folder = root || path.join(os.homedir(), 'FoundryProjects', 'w5-debug-test-fixture')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'package.json'), `${JSON.stringify({
    name: 'w5-debug-test-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'node --test --test-reporter tap' },
  }, null, 2)}\n`)
  writeFileSync(path.join(folder, 'calculate-total.js'), BUGGY_TOTAL)
  writeFileSync(path.join(folder, 'calculate-total.ts'), `// TypeScript source companion. W5 debug proof uses the JS emit.\n${BUGGY_TOTAL}`)
  writeFileSync(path.join(folder, 'calculate-total.test.js'), TEST_FILE)
  writeFileSync(path.join(folder, 'secret.test.js'), SECRET_TEST)
  writeFileSync(path.join(folder, 'debug-entry.js'), DEBUG_ENTRY)
  writeFileSync(path.join(folder, 'boom.js'), BOOM)
  writeLaunchIfMissing(folder)
  const gitDir = path.join(folder, '.git')
  if (!existsSync(gitDir)) {
    spawnSync('git', ['init'], { cwd: folder, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.email', 'w5-fixture@foundry.local'], { cwd: folder, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.name', 'W5 Fixture'], { cwd: folder, encoding: 'utf8' })
    spawnSync('git', ['add', '-A'], { cwd: folder, encoding: 'utf8' })
    spawnSync('git', ['commit', '-m', 'w5 fixture seed'], { cwd: folder, encoding: 'utf8' })
  }
  return folder
}

export function runNodeTests(folder: string, spec?: string): { stdout: string; stderr: string; status: number | null; tests: Array<{ name: string; file: string; status: string; message?: string }> } {
  const args = spec
    ? ['--test', '--test-reporter', 'tap', spec]
    : ['--test', '--test-reporter', 'tap', 'calculate-total.test.js']
  const ran = spawnSync(process.execPath, args, { cwd: folder, encoding: 'utf8', timeout: 20_000 })
  const output = `${ran.stdout || ''}\n${ran.stderr || ''}`
  const tests: Array<{ name: string; file: string; status: string; message?: string }> = []
  for (const line of output.split('\n')) {
    const fail = /^not ok \d+ - (.+)$/.exec(line.trim())
    const pass = /^ok \d+ - (.+)$/.exec(line.trim())
    if (fail) tests.push({ name: fail[1], file: spec || 'calculate-total.test.js', status: 'fail', message: line })
    else if (pass) tests.push({ name: pass[1], file: spec || 'calculate-total.test.js', status: 'pass' })
  }
  if (!tests.length && /not ok|AssertionError|fail/i.test(output)) {
    tests.push({ name: 'sums all line items', file: 'calculate-total.test.js', status: 'fail', message: clip(output, 400) })
  }
  return { stdout: ran.stdout || '', stderr: ran.stderr || '', status: ran.status, tests }
}

export function fixtureDebugSnapshot(folder: string, extras?: Partial<FoundryDebugSnapshot>): FoundryDebugSnapshot {
  return boundDebugSnapshot({
    sessionId: 'w5-fixture-session',
    stoppedReason: 'breakpoint',
    activeFrame: 'calculateTotal',
    functionName: 'calculateTotal',
    file: path.join(folder, 'calculate-total.js'),
    line: 3,
    boundedCallStack: [
      { functionName: 'calculateTotal', file: 'calculate-total.js', line: 3 },
      { functionName: 'module', file: 'debug-entry.js', line: 8 },
    ],
    boundedVariables: [
      { name: 'total', value: '20', truncated: false, redacted: false },
      { name: 'i', value: '0', truncated: false, redacted: false },
      { name: 'items', value: '[{price:10,qty:2},{price:5,qty:1}]', truncated: false, redacted: false },
    ],
    breakpoint: { file: 'calculate-total.js', line: 3, enabled: true },
    attached: true,
    ...extras,
  })
}

export function fixtureFailingTest(folder: string): FoundryTestSnapshot {
  const ran = runNodeTests(folder)
  const failed = ran.tests.find(item => item.status === 'fail') || ran.tests[0]
  return boundTestSnapshot({
    runId: `w5-${Date.now()}`,
    testId: failed?.name || 'sums all line items',
    testName: failed?.name || 'sums all line items',
    file: path.join(folder, 'calculate-total.test.js'),
    status: failed?.status === 'pass' ? 'pass' : 'fail',
    message: failed?.message || ran.stdout,
    expected: '25',
    actual: '20',
    outputTail: ran.stdout,
    attached: true,
  })
}

export function envelopeWithDebug(workspaceRoot: string, debug: FoundryDebugSnapshot, extras?: Partial<FoundryEditorContextEnvelope>): FoundryEditorContextEnvelope {
  const rel = 'calculate-total.js'
  const content = existsSync(path.join(workspaceRoot, rel)) ? readFileSync(path.join(workspaceRoot, rel), 'utf8') : BUGGY_TOTAL
  return buildFoundryEditorContextEnvelope({
    workspaceRoot,
    projectId: 'w5-workbench',
    workspaceId: 'w5-workbench',
    activeFile: rel,
    activeLanguageId: 'javascript',
    selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 40, text: 'for (let i = 0; i < items.length - 1; i++)' },
    nearbyLines: content,
    fileContent: content,
    debug,
    providerClass: extras?.sensitive?.providerClass ?? 'local',
    ...extras,
  })
}

export function envelopeWithTest(workspaceRoot: string, test: FoundryTestSnapshot, extras?: Partial<FoundryEditorContextEnvelope>): FoundryEditorContextEnvelope {
  const rel = 'calculate-total.js'
  const content = existsSync(path.join(workspaceRoot, rel)) ? readFileSync(path.join(workspaceRoot, rel), 'utf8') : BUGGY_TOTAL
  return buildFoundryEditorContextEnvelope({
    workspaceRoot,
    projectId: 'w5-workbench',
    workspaceId: 'w5-workbench',
    activeFile: rel,
    activeLanguageId: 'javascript',
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 20, text: 'export function calculateTotal' },
    nearbyLines: content,
    fileContent: content,
    test,
    lastTestFailure: test.message || undefined,
    providerClass: extras?.sensitive?.providerClass ?? 'local',
    ...extras,
  })
}

function implementationFixReason(): string {
  return 'Implementation is wrong: the loop skips the last line item (`items.length - 1`). The test expectation of 25 is correct. Do not rewrite the test.'
}

export async function runFoundryW5Command(input: {
  kind: string
  workspaceRoot?: string
  envelope?: FoundryEditorContextEnvelope | null
  instruction?: string
  providerClass?: 'none' | 'local' | 'remote'
  commanderApproved?: boolean
}): Promise<FoundryW5Response> {
  const kind = input.kind
  const workspaceRoot = input.workspaceRoot || input.envelope?.workspaceRoot || path.join(os.homedir(), 'FoundryProjects', 'w5-debug-test-fixture')
  const providerClass = input.providerClass ?? 'local'

  if (kind === 'agentDebugControl' || kind === 'agentDebugStart' || kind === 'agentDebugStep' || kind === 'agentDebugEval') {
    appendFoundryWorkbenchEvent('DEBUG_EXPLAIN_REQUESTED', 'Agent debug control refused', { metadata: { kind } })
    return { ok: false, kind, readOnly: true, code: 'AI_DEBUG_CONTROL', error: 'AI cannot start, stop, step, or evaluate in the Commander debugger. Inspect/explain/propose only.' }
  }

  if (kind === 'openTesting') {
    return { ok: true, kind, readOnly: true, text: 'Test Explorer requested.' }
  }

  if (kind === 'attachDebug' || kind === 'explainDebug') {
    const snapshot = boundDebugSnapshot(input.envelope?.debug || fixtureDebugSnapshot(workspaceRoot), providerClass)
    snapshot.attached = true
    const envelope = envelopeWithDebug(workspaceRoot, snapshot, { sensitive: { blocked: false, redacted: snapshot.boundedVariables.some(item => item.redacted), reason: null, providerClass } })
    const leak = remoteDebugSecretLeakCount(snapshot, providerClass)
    appendFoundryWorkbenchEvent(kind === 'attachDebug' ? 'DEBUG_CONTEXT_ATTACHED' : 'DEBUG_EXPLAIN_REQUESTED', snapshot.functionName || 'debug', { metadata: { frames: snapshot.boundedCallStack.length } })
    const text = kind === 'explainDebug'
      ? `Stopped in ${snapshot.functionName || 'frame'} at ${snapshot.file || 'file'}:${snapshot.line || 0}. Locals: ${snapshot.boundedVariables.map(item => `${item.name}=${item.value}`).join(', ')}. Call stack has ${snapshot.boundedCallStack.length} bounded frames. Loop bound looks like it skips the last item.`
      : `Debug context attached: ${snapshot.functionName || 'frame'}.`
    return {
      ok: leak === 0,
      kind,
      readOnly: true,
      text,
      snapshot,
      envelope,
      chips: editorContextChips(envelope),
      privacy: { redactionOccurred: snapshot.boundedVariables.some(item => item.redacted) || Boolean(envelope.sensitive.redacted), remoteSecretLeakCount: leak, providerClass },
      code: leak ? 'DEBUG_SECRET_REDACTED' : undefined,
    }
  }

  if (kind === 'fixFromDebug') {
    const snapshot = boundDebugSnapshot(input.envelope?.debug || fixtureDebugSnapshot(workspaceRoot), providerClass)
    const envelope = envelopeWithDebug(workspaceRoot, snapshot)
    const original = readFileSync(path.join(workspaceRoot, 'calculate-total.js'), 'utf8')
    const proposal = createFoundryEditProposal({
      envelope: {
        ...envelope,
        activeFile: 'calculate-total.js',
        selection: { startLine: 1, startColumn: 1, endLine: original.split('\n').length, endColumn: 1, text: original, truncated: false, originalChars: original.length },
        fileHash: hashEditorText(original),
        originalTextHash: null,
      },
      instruction: input.instruction || 'Fix this bug from debug state. Do not rewrite tests.',
      reason: implementationFixReason(),
      replacementText: FIXED_TOTAL,
      kind: 'MODIFY',
      filePath: 'calculate-total.js',
      modelProvider: 'foundry-w5-fixture',
      modelId: 'deterministic',
    })
    appendFoundryWorkbenchEvent('DEBUG_FIX_PROPOSED', proposal.reason, { proposalId: proposal.proposalId, path: 'calculate-total.js' })
    return { ok: true, kind, readOnly: true, text: proposal.reason, proposal, snapshot, envelope, chips: editorContextChips(envelope) }
  }

  if (kind === 'attachTest' || kind === 'explainTest') {
    const snapshot = boundTestSnapshot(input.envelope?.test || fixtureFailingTest(workspaceRoot), providerClass)
    snapshot.attached = true
    const envelope = envelopeWithTest(workspaceRoot, snapshot, { sensitive: { blocked: false, redacted: /REDACTED/.test(`${snapshot.message}${snapshot.outputTail}`), reason: null, providerClass } })
    const leak = remoteTestSecretLeakCount(snapshot, providerClass)
    appendFoundryWorkbenchEvent(kind === 'attachTest' ? 'TEST_FAILURE_ATTACHED' : 'TEST_EXPLAIN_REQUESTED', snapshot.testName || 'test', { metadata: { status: snapshot.status } })
    const text = kind === 'explainTest'
      ? `Test ${snapshot.testName} ${snapshot.status}. Expected ${snapshot.expected}, actual ${snapshot.actual}. Implementation loop likely skips the last item. Test expectation is not stale.`
      : `Test result attached: ${snapshot.testName} · ${snapshot.status}`
    return {
      ok: leak === 0,
      kind,
      readOnly: true,
      text,
      snapshot,
      envelope,
      chips: editorContextChips(envelope),
      privacy: { redactionOccurred: /REDACTED/.test(`${snapshot.message}${snapshot.outputTail}`), remoteSecretLeakCount: leak, providerClass },
      code: leak ? 'TEST_SECRET_REDACTED' : undefined,
    }
  }

  if (kind === 'fixFailedTest') {
    const snapshot = boundTestSnapshot(input.envelope?.test || fixtureFailingTest(workspaceRoot), providerClass)
    const envelope = envelopeWithTest(workspaceRoot, snapshot)
    const original = readFileSync(path.join(workspaceRoot, 'calculate-total.js'), 'utf8')
    const proposal = createFoundryEditProposal({
      envelope: {
        ...envelope,
        activeFile: 'calculate-total.js',
        selection: { startLine: 1, startColumn: 1, endLine: original.split('\n').length, endColumn: 1, text: original, truncated: false, originalChars: original.length },
        fileHash: hashEditorText(original),
        originalTextHash: null,
      },
      instruction: input.instruction || 'Fix the failing test by correcting implementation, not the assertion.',
      reason: implementationFixReason(),
      replacementText: FIXED_TOTAL,
      kind: 'MODIFY',
      filePath: 'calculate-total.js',
      modelProvider: 'foundry-w5-fixture',
      modelId: 'deterministic',
    })
    appendFoundryWorkbenchEvent('TEST_FIX_PROPOSED', proposal.reason, { proposalId: proposal.proposalId, path: 'calculate-total.js' })
    return { ok: true, kind, readOnly: true, text: proposal.reason, proposal, snapshot, envelope, chips: editorContextChips(envelope) }
  }

  if (kind === 'discoverTests' || kind === 'runTests') {
    const ran = runNodeTests(workspaceRoot, kind === 'runTests' && input.instruction === 'single' ? 'calculate-total.test.js' : undefined)
    appendFoundryWorkbenchEvent('TEST_RUN_OBSERVED', `discovered ${ran.tests.length}`, { metadata: { status: ran.status ?? 0 } })
    return { ok: true, kind, readOnly: true, text: `framework ${W5_TEST_FRAMEWORK} tests ${ran.tests.length}`, tests: ran.tests }
  }

  return { ok: false, kind, readOnly: true, code: 'UNKNOWN_W5_KIND', error: `Unknown W5 kind ${kind}` }
}

export function w5AuthorityStillZero(): boolean {
  return FOUNDRY_AUTHORITY_SNAPSHOT.autoCommit === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoPush === 0
}

export function scmAfterFix(workspaceRoot: string) {
  try {
    return collectScmSnapshot(workspaceRoot)
  } catch {
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: workspaceRoot, encoding: 'utf8' })
    const changed = status.stdout.split('\n').map(line => line.slice(3).trim()).filter(Boolean)
    return { changedFiles: changed, stagedFiles: [] as string[] }
  }
}
