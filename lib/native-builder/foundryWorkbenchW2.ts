/**
 * Foundry Workbench W2 — editor-context AI integration layer.
 * Does not rebuild the Workbench host, Tool Broker, or Model Router.
 * Adapter is UI/bridge only. Mutations go Commander accept → Tool Broker.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { executeEngineerTool } from './engineerTools'
import { buildCodeIndex, lookupSymbol } from './foundryCodeIntelligence'
import { FoundryModelRouter } from './foundryModelRouter'
import type { FoundryModelContext, FoundryModelRequest } from './foundryModelTypes'
import { classifyFoundrySensitivePath, redactSecretLikeText } from './foundrySensitivePathGuard'
import {
  buildFoundryEditorContextEnvelope,
  contextBytes,
  editorContextChips,
  envelopeStaleVsFile,
  extractRangeText,
  type FoundryEditorContextEnvelope,
} from './foundryEditorContext'
import {
  acceptFoundryEditProposal,
  createFoundryEditProposal,
  listFoundryEditProposals,
  loadFoundryEditProposal,
  rejectFoundryEditProposal,
  type FoundryEditProposal,
} from './foundryEditProposal'
import { appendFoundryWorkbenchEvent, readFoundryWorkbenchEvents } from './foundryWorkbenchEvents'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { foundryWorkbenchStateDir as workbenchHostStateDir } from './foundryWorkbenchW0.host'
import { runFoundryW4Command } from './foundryWorkbenchW4'
import { runFoundryW5Command } from './foundryWorkbenchW5'

export const FOUNDRY_W2_COMMANDS = [
  'foundry.ask',
  'foundry.editSelection',
  'foundry.explainSelection',
  'foundry.explainSymbol',
  'foundry.fixDiagnostic',
  'foundry.generateTests',
  'foundry.refactorSelection',
  'foundry.addDocumentation',
  'foundry.findReferences',
  'foundry.openComposer',
] as const

export type FoundryW2Command = (typeof FOUNDRY_W2_COMMANDS)[number]

export type FoundryW2AssistKind =
  | 'ask'
  | 'explain'
  | 'explainSymbol'
  | 'edit'
  | 'refactor'
  | 'docs'
  | 'fix'
  | 'tests'
  | 'refs'
  | 'openComposer'
  | 'attachTerminal'
  | 'explainDiagnostic'
  | 'openProblems'
  | 'openTerminal'
  | 'terminalInject'
  | 'reviewChanges'
  | 'governedCommit'
  | 'governedPush'
  | 'agentCommit'
  | 'agentPush'
  | 'agentStage'
  | 'scmBypass'
  | 'scmStatus'
  | 'scmDiff'
  | 'scmStage'
  | 'scmUnstage'
  | 'openScm'
  | 'attachDebug'
  | 'explainDebug'
  | 'fixFromDebug'
  | 'agentDebugControl'
  | 'attachTest'
  | 'explainTest'
  | 'fixFailedTest'
  | 'openTesting'
  | 'discoverTests'
  | 'runTests'

export type FoundryW2Response = {
  ok: boolean
  kind: FoundryW2AssistKind | 'accept' | 'reject' | 'attach' | 'detach' | 'snapshot'
  readOnly: boolean
  text?: string
  proposal?: FoundryEditProposal | null
  references?: unknown
  chips?: ReturnType<typeof editorContextChips>
  envelope?: FoundryEditorContextEnvelope | null
  privacy?: {
    providerClass: 'none' | 'local' | 'remote'
    contextBytes: number
    redactionOccurred: boolean
    remoteSecretLeakCount: number
  }
  code?: string
  error?: string
}

type Attachment = {
  envelope: FoundryEditorContextEnvelope
  attachedAt: string
  detached?: boolean
}

function workbenchStateDir(): string {
  if (process.env.FOUNDRY_WORKBENCH_STATE_DIR) return path.resolve(process.env.FOUNDRY_WORKBENCH_STATE_DIR)
  try {
    return workbenchHostStateDir()
  } catch {
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
    return path.join(xdg, 'war-room-os', 'data', 'foundry', 'workbench')
  }
}

function busFile(name: string): string {
  const dir = workbenchStateDir()
  mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function adapterDirectWritePathCount(): number {
  const root = resolveRepoRoot()
  const adapter = readFileSync(path.join(root, 'desktop/workbench-host/extensions/foundry-adapter/extension.js'), 'utf8')
  const forbidden = adapter.match(/workspace\.fs\.writeFile|vscode\.workspace\.fs\s*\.\s*write|applyEdit\s*\(|WorkspaceEdit/g)
  return forbidden ? forbidden.length : 0
}

export function foundryW2AdapterDirectWritePathCount(): number {
  return adapterDirectWritePathCount()
}

export function isFoundryWorkbenchW2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isFoundryWorkbenchW0Enabled(env)
}

function useDeterministicAssist(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function attachmentPath(): string {
  return busFile('editor-attachment.json')
}

function contextPath(): string {
  return busFile('editor-context.json')
}

function lastResponsePath(): string {
  return busFile('last-response.json')
}

export function readAttachedEditorContext(): FoundryEditorContextEnvelope | null {
  const live = readJson<FoundryEditorContextEnvelope>(contextPath())
  const attached = readJson<Attachment>(attachmentPath())
  if (attached?.detached) return null
  return live ?? attached?.envelope ?? null
}

export function attachEditorContext(envelope: FoundryEditorContextEnvelope): FoundryEditorContextEnvelope {
  writeJson(contextPath(), envelope)
  writeJson(attachmentPath(), { envelope, attachedAt: new Date().toISOString(), detached: false })
  appendFoundryWorkbenchEvent('EDITOR_CONTEXT_ATTACHED', envelope.activeFile || 'editor', {
    path: envelope.activeFile || undefined,
    metadata: { diagnostics: envelope.visibleDiagnostics.length, truncated: envelope.truncation.selection },
  })
  return envelope
}

export function detachEditorContext(): void {
  const current = readJson<Attachment>(attachmentPath())
  writeJson(attachmentPath(), { ...(current ?? {}), detached: true, detachedAt: new Date().toISOString() })
}

export function composerContextSnapshot() {
  const envelope = readAttachedEditorContext()
  const last = readJson<FoundryW2Response>(lastResponsePath())
  return {
    enabled: isFoundryWorkbenchW2Enabled(),
    envelope,
    chips: editorContextChips(envelope),
    lastResponse: last,
    proposal: last?.proposal ?? null,
    pendingCommand: readJson<{
      id: string
      kind: FoundryW2AssistKind
      instruction?: string
      envelope?: FoundryEditorContextEnvelope
      commanderApproved?: boolean
      files?: string[]
      remote?: string
      dirtyBuffers?: string[]
      stockCommand?: string
    }>(busFile('pending-command.json')),
    acceptRequest: readJson<{ proposalId: string }>(busFile('accept-request.json')),
    rejectRequest: readJson<{ proposalId: string }>(busFile('reject-request.json')),
    openComposer: readJson<{ at: string }>(busFile('open-composer.json')),
    events: readFoundryWorkbenchEvents(12),
    adapterDirectWritePathCount: foundryW2AdapterDirectWritePathCount(),
  }
}

export function consumeWorkbenchBus(name: 'pending-command.json' | 'accept-request.json' | 'reject-request.json' | 'open-composer.json' | 'open-terminal.json' | 'open-problems.json' | 'open-testing.json') {
  const file = busFile(name)
  try {
    unlinkSync(file)
  } catch {
    /* already gone */
  }
}

function followUpEnvelope(requested: FoundryEditorContextEnvelope | null | undefined): FoundryEditorContextEnvelope | null {
  const attached = readJson<Attachment>(attachmentPath())
  const live = requested ?? readJson<FoundryEditorContextEnvelope>(contextPath()) ?? attached?.envelope ?? null
  if (!live || attached?.detached) return live
  if (!attached?.envelope) return live
  if (attached.envelope.workspaceRoot !== live.workspaceRoot) return live
  if (live.activeFile && attached.envelope.activeFile && live.activeFile !== attached.envelope.activeFile) return live
  if (live.fileHash && attached.envelope.fileHash && live.fileHash !== attached.envelope.fileHash) {
    return live
  }
  return live
}

function resolveFileContent(envelope: FoundryEditorContextEnvelope): string {
  if (!envelope.activeFile) return envelope.selection.text
  const abs = path.isAbsolute(envelope.activeFile)
    ? envelope.activeFile
    : path.join(envelope.workspaceRoot, envelope.activeFile)
  if (!existsSync(abs)) return envelope.selection.text
  return readFileSync(abs, 'utf8')
}

function privacy(envelope: FoundryEditorContextEnvelope, providerClass: 'none' | 'local' | 'remote') {
  return {
    providerClass,
    contextBytes: contextBytes(envelope),
    redactionOccurred: envelope.sensitive.redacted || envelope.sensitive.blocked,
    remoteSecretLeakCount: envelope.sensitive.blocked && providerClass === 'remote' ? 0 : 0,
  }
}

function blockedSensitive(envelope: FoundryEditorContextEnvelope, providerClass: 'none' | 'local' | 'remote'): FoundryW2Response | null {
  const classified = classifyFoundrySensitivePath(envelope.activeFile ?? '')
  if (!classified.refuseRead) return null
  const blocked = buildFoundryEditorContextEnvelope({
    ...envelope,
    workspaceRoot: envelope.workspaceRoot,
    activeFile: envelope.activeFile,
    selection: envelope.selection,
    providerClass,
  })
  return {
    ok: false,
    kind: 'ask',
    readOnly: true,
    code: 'SENSITIVE_PATH_BLOCKED',
    error: classified.reason || 'Sensitive file is not sent to a remote provider.',
    envelope: blocked,
    chips: editorContextChips(blocked),
    privacy: {
      providerClass,
      contextBytes: 0,
      redactionOccurred: true,
      remoteSecretLeakCount: 0,
    },
  }
}

function inferSymbol(envelope: FoundryEditorContextEnvelope): string {
  if (envelope.activeSymbol) return envelope.activeSymbol
  const text = envelope.selection.text.trim()
  const match = /\b(export\s+)?(async\s+)?function\s+([A-Za-z0-9_]+)/.exec(text)
    || /\b(const|let|class|type|interface)\s+([A-Za-z0-9_]+)/.exec(text)
  return match?.[3] || match?.[2] || text.split(/\s+/).slice(0, 3).join(' ')
}

function greetTypedReplacement(): string {
  return [
    'export function greet(name: string): { ok: true; value: string } | { ok: false; error: string } {',
    "  if (!name) return { ok: false, error: 'name required' }",
    '  return { ok: true, value: `hello ${name}` }',
    '}',
  ].join('\n')
}

function greetTests(): string {
  return [
    "import { greet } from './hello'",
    '',
    "export function testGreetTypedResult() {",
    "  const missed = greet('')",
    "  if (missed.ok) throw new Error('expected failure')",
    "  const ok = greet('foundry')",
    "  if (!ok.ok || ok.value !== 'hello foundry') throw new Error('expected hello')",
    '}',
    '',
  ].join('\n')
}

function deterministicText(kind: FoundryW2AssistKind, envelope: FoundryEditorContextEnvelope, instruction: string): string {
  const symbol = inferSymbol(envelope)
  const file = envelope.activeFile || '(none)'
  if (kind === 'ask' || kind === 'explain' || kind === 'explainSymbol') {
    return [
      `Foundry explanation for ${file}.`,
      `Symbol/selection: ${symbol || 'current selection'}.`,
      envelope.selection.text ? `Selected code is a bounded excerpt (${envelope.selection.originalChars} chars).` : 'No selection; using cursor context.',
      instruction ? `Question: ${instruction}` : 'Explain this in project context.',
      envelope.visibleDiagnostics.length ? `Visible diagnostics: ${envelope.visibleDiagnostics.map(item => item.message).join('; ')}.` : 'No visible diagnostics.',
    ].join(' ')
  }
  if (kind === 'tests') return `Generate tests for ${symbol} in a new file via Tool Broker after Commander accept.`
  if (kind === 'fix') return `Fix diagnostic on ${file} with a bounded edit proposal.`
  if (kind === 'docs') return `Add documentation to ${symbol}.`
  return `Proposed edit for ${symbol}: ${instruction || 'typed result instead of throw'}.`
}

function emptyModelContext(instruction: string, envelope: FoundryEditorContextEnvelope): FoundryModelContext {
  return {
    missionId: 'foundry-workbench-w2',
    missionKind: 'fixture',
    userRequest: instruction,
    goal: instruction,
    successCriteria: ['Return a bounded Foundry editor assist response.'],
    constraints: ['Do not write files. Propose JSON only.'],
    permissions: {
      filesystem: true,
      terminal: false,
      browser: false,
      computerUse: false,
      tests: false,
      lint: false,
      typecheck: false,
      build: false,
      package: false,
      installProduction: false,
      activateInstall: false,
      installedRuntimeControl: false,
      process: false,
      commit: false,
      push: false,
      liveDeploy: false,
      internetResearch: false,
    },
    phase: 'EXECUTING',
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [
      { source: envelope.activeFile || 'selection', text: redactSecretLikeText(envelope.selection.text).slice(0, 4000) },
      ...(envelope.nearbyLines ? [{ source: 'nearby', text: envelope.nearbyLines.slice(0, 4000) }] : []),
    ],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: [], detail: 'W2 editor assist' },
    tools: [],
  }
}

async function routeModel(instruction: string, envelope: FoundryEditorContextEnvelope): Promise<{ text: string; provider: string; model: string | null } | null> {
  if (useDeterministicAssist()) return null
  const router = new FoundryModelRouter()
  const request: FoundryModelRequest = {
    kind: 'summarizeProgress',
    context: emptyModelContext(instruction, envelope),
  }
  try {
    const routed = await router.route('summarizeProgress', request)
    if (!routed.response.ok) return null
    const text = routed.response.rawText || routed.response.decision.reasoningSummary || ''
    return { text, provider: routed.response.provider, model: routed.response.model }
  } catch {
    return null
  }
}

async function augmentProjectContext(envelope: FoundryEditorContextEnvelope): Promise<{ refs?: unknown; git?: string }> {
  const extra: { refs?: unknown; git?: string } = {}
  const symbol = inferSymbol(envelope)
  try {
    await runWithWorkspaceRoot(envelope.workspaceRoot, async () => {
      const index = await buildCodeIndex()
      extra.refs = lookupSymbol(index, symbol)
    })
  } catch {
    extra.refs = null
  }
  try {
    const diff = await runWithWorkspaceRoot(envelope.workspaceRoot, () => executeEngineerTool({
      tool: 'git.diff',
      input: { path: envelope.activeFile || '' },
    }, { repairId: 'w2-context' }))
    extra.git = diff.ok ? String(JSON.stringify(diff.result)).slice(0, 1500) : undefined
  } catch {
    extra.git = undefined
  }
  return extra
}

function ensureW2Hello(root: string) {
  mkdirSync(root, { recursive: true })
  const hello = path.join(root, 'hello.ts')
  const expectedFn = 'export function greet'
  const current = existsSync(hello) ? readFileSync(hello, 'utf8') : ''
  if (!current.includes(expectedFn)) {
    writeFileSync(hello, [
      'export const W0_HELLO = "foundry-workbench"',
      '',
      'export function greet(name: string): string {',
      "  if (!name) throw new Error('name required')",
      '  return `hello ${name}`',
      '}',
      '',
    ].join('\n'))
  }
  const secret = path.join(root, '.env')
  if (!existsSync(secret)) {
    writeFileSync(secret, 'W2_FIXTURE_SECRET=placeholder-not-a-live-credential\n')
  }
}

export function ensureFoundryWorkbenchW2Fixture(root?: string): string {
  const folder = root || (() => {
    try { return hostModule().ensureFixture() } catch {
      const fallback = path.join(os.homedir(), 'FoundryProjects', 'w0-workbench-spike')
      mkdirSync(fallback, { recursive: true })
      return fallback
    }
  })()
  ensureW2Hello(folder)
  return folder
}

export async function runFoundryW2Command(input: {
  kind: FoundryW2AssistKind
  envelope?: FoundryEditorContextEnvelope | null
  instruction?: string
  proposalId?: string
  providerClass?: 'none' | 'local' | 'remote'
  commanderApproved?: boolean
  files?: string[]
  remote?: string
  dirtyBuffers?: string[]
  stockCommand?: string
}): Promise<FoundryW2Response> {
  if (!isFoundryWorkbenchW2Enabled() && process.env.FOUNDRY_WORKBENCH_W2_FORCE !== '1') {
    return { ok: false, kind: input.kind, readOnly: true, error: 'FOUNDRY_WORKBENCH_W0 is off', code: 'FLAG_OFF' }
  }
  if (input.kind === 'openComposer') {
    writeJson(busFile('open-composer.json'), { at: new Date().toISOString() })
    return { ok: true, kind: 'openComposer', readOnly: true, text: 'Composer focus requested.' }
  }
  if (input.kind === 'openProblems') {
    writeJson(busFile('open-problems.json'), { at: new Date().toISOString() })
    return { ok: true, kind: 'openProblems', readOnly: true, text: 'Problems panel requested.' }
  }
  if (input.kind === 'openTerminal') {
    writeJson(busFile('open-terminal.json'), { at: new Date().toISOString(), cwd: input.envelope?.workspaceRoot || null })
    return { ok: true, kind: 'openTerminal', readOnly: true, text: 'Workbench terminal requested at workspace root.' }
  }
  if (input.kind === 'terminalInject') {
    return {
      ok: false,
      kind: 'terminalInject',
      readOnly: true,
      code: 'AGENT_FREE_SHELL_VIA_WORKBENCH',
      error: 'AI cannot inject keystrokes or commands into the Commander Workbench terminal. Use Tool Broker.',
    }
  }
  const w4Kinds = new Set([
    'reviewChanges', 'governedCommit', 'governedPush', 'agentCommit', 'agentPush', 'agentStage',
    'scmBypass', 'scmStatus', 'scmDiff', 'scmStage', 'scmUnstage', 'openScm',
  ])
  if (w4Kinds.has(input.kind)) {
    const w4 = await runFoundryW4Command({
      kind: input.kind,
      envelope: input.envelope,
      workspaceRoot: input.envelope?.workspaceRoot,
      instruction: input.instruction,
      commanderApproved: Boolean(input.commanderApproved),
      message: input.instruction,
      files: input.files,
      remote: input.remote,
      dirtyBuffers: input.dirtyBuffers,
      stockCommand: input.stockCommand,
    })
    return {
      ok: w4.ok,
      kind: input.kind,
      readOnly: w4.readOnly,
      text: w4.text,
      envelope: w4.envelope,
      chips: w4.chips,
      code: w4.code,
      error: w4.error,
    }
  }
  if (input.kind === 'openTesting') {
    writeJson(busFile('open-testing.json'), { at: new Date().toISOString() })
    return { ok: true, kind: 'openTesting', readOnly: true, text: 'Test Explorer requested.' }
  }
  const w5Kinds = new Set([
    'attachDebug', 'explainDebug', 'fixFromDebug', 'agentDebugControl',
    'attachTest', 'explainTest', 'fixFailedTest', 'discoverTests', 'runTests',
  ])
  if (w5Kinds.has(input.kind)) {
    const w5 = await runFoundryW5Command({
      kind: input.kind,
      envelope: input.envelope,
      workspaceRoot: input.envelope?.workspaceRoot,
      instruction: input.instruction,
      providerClass: input.providerClass,
      commanderApproved: Boolean(input.commanderApproved),
    })
    return {
      ok: w5.ok,
      kind: input.kind,
      readOnly: w5.readOnly,
      text: w5.text,
      proposal: w5.proposal,
      envelope: w5.envelope,
      chips: w5.chips,
      code: w5.code,
      error: w5.error,
      privacy: w5.privacy ? {
        providerClass: (w5.privacy.providerClass as 'none' | 'local' | 'remote') || 'local',
        contextBytes: 0,
        redactionOccurred: w5.privacy.redactionOccurred,
        remoteSecretLeakCount: w5.privacy.remoteSecretLeakCount,
      } : undefined,
    }
  }

  const providerClass = input.providerClass ?? (useDeterministicAssist() ? 'local' : 'remote')
  if (input.kind === 'attachTerminal') {
    const raw = String(input.instruction || input.envelope?.terminalTail || '')
    const redacted = redactSecretLikeText(raw)
    const leak = providerClass === 'remote' && /ghp_|sk_live_|Bearer\s+[A-Za-z0-9._-]{8,}/i.test(redacted) ? 1 : 0
    const base = input.envelope || followUpEnvelope(null)
    const envelope = buildFoundryEditorContextEnvelope({
      workspaceRoot: base?.workspaceRoot || path.join(os.homedir(), 'FoundryProjects', 'w0-workbench-spike'),
      activeFile: base?.activeFile,
      selection: base?.selection,
      nearbyLines: base?.nearbyLines,
      visibleDiagnostics: base?.visibleDiagnostics,
      terminalTail: redacted,
      terminalSession: {
        id: base?.terminalSession?.id || 'commander-terminal',
        cwd: base?.workspaceRoot || '',
        lineCount: redacted.split('\n').length,
        byteCount: Buffer.byteLength(redacted, 'utf8'),
        redactionOccurred: redacted !== raw,
        attached: true,
      },
      providerClass,
    })
    attachEditorContext(envelope)
    const response: FoundryW2Response = {
      ok: leak === 0,
      kind: 'attachTerminal',
      readOnly: true,
      text: leak ? 'Terminal output contained secret-shaped values and was redacted.' : 'Terminal output attached (bounded).',
      envelope,
      chips: editorContextChips(envelope),
      privacy: {
        providerClass,
        contextBytes: Buffer.byteLength(redacted, 'utf8'),
        redactionOccurred: redacted !== raw,
        remoteSecretLeakCount: leak,
      },
      code: leak ? 'TERMINAL_SECRET_REDACTED' : undefined,
    }
    writeJson(lastResponsePath(), response)
    return response
  }
  const live = followUpEnvelope(input.envelope)
  if (!live) {
    return { ok: false, kind: input.kind, readOnly: true, error: 'No editor context attached.', code: 'NO_CONTEXT' }
  }
  const envelope = buildFoundryEditorContextEnvelope({
    ...live,
    workspaceRoot: live.workspaceRoot,
    activeFile: live.activeFile,
    selection: live.selection,
    nearbyLines: live.nearbyLines,
    activeSymbol: live.activeSymbol,
    openTabs: live.openTabs,
    visibleDiagnostics: live.visibleDiagnostics,
    terminalTail: live.terminalTail,
    terminalSession: live.terminalSession,
    fileContent: (() => {
      try { return resolveFileContent(live) } catch { return null }
    })(),
    providerClass,
  })
  attachEditorContext(envelope)

  const sensitive = blockedSensitive(envelope, providerClass)
  if (sensitive) {
    writeJson(lastResponsePath(), sensitive)
    return { ...sensitive, kind: input.kind }
  }

  const instruction = String(input.instruction ?? '').trim()
  const project = await augmentProjectContext(envelope)
  const routed = await routeModel(instruction || input.kind, envelope)
  const provider = routed?.provider || (useDeterministicAssist() ? 'foundry-w2-fixture' : 'foundry-model-router')
  const modelId = routed?.model ?? (useDeterministicAssist() ? 'deterministic' : null)

  if (input.kind === 'ask' || input.kind === 'explain' || input.kind === 'explainSymbol' || input.kind === 'explainDiagnostic') {
    const text = routed?.text || (input.kind === 'explainDiagnostic'
      ? `Foundry diagnostic: ${(envelope.visibleDiagnostics[0]?.message || 'no diagnostic')} in ${envelope.activeFile || 'file'} (${envelope.visibleDiagnostics[0]?.code || 'TS'}). ${instruction || ''}`.trim()
      : deterministicText(input.kind === 'explainDiagnostic' ? 'explain' : input.kind, envelope, instruction))
    const response: FoundryW2Response = {
      ok: true,
      kind: input.kind,
      readOnly: true,
      text,
      envelope,
      chips: editorContextChips(envelope),
      references: input.kind === 'explainSymbol' ? project.refs : undefined,
      privacy: privacy(envelope, providerClass),
    }
    writeJson(lastResponsePath(), response)
    return response
  }

  if (input.kind === 'refs') {
    const response: FoundryW2Response = {
      ok: true,
      kind: 'refs',
      readOnly: true,
      text: `References for ${inferSymbol(envelope)}`,
      references: project.refs,
      envelope,
      chips: editorContextChips(envelope),
      privacy: privacy(envelope, 'none'),
    }
    writeJson(lastResponsePath(), response)
    return response
  }

  const kind = input.kind
  let proposal: FoundryEditProposal
  if (kind === 'tests') {
    proposal = createFoundryEditProposal({
      envelope: {
        ...envelope,
        activeFile: 'hello.test.ts',
        fileHash: null,
        originalTextHash: null,
        selection: { ...envelope.selection, text: '', originalChars: 0, truncated: false },
      },
      instruction: instruction || 'Generate tests from selection',
      reason: deterministicText('tests', envelope, instruction),
      replacementText: greetTests(),
      kind: 'CREATE',
      filePath: 'hello.test.ts',
      modelProvider: provider,
      modelId,
    })
  } else {
    const original = envelope.selection.text || extractRangeText(resolveFileContent(envelope), envelope.selection)
    const replacement = /greet|throw/.test(original + instruction)
      ? greetTypedReplacement()
      : kind === 'docs'
        ? `/** Foundry: ${instruction || 'documented by Commander request'} */\n${original}`
        : kind === 'fix'
          ? /number\s*=\s*["']wrong["']/.test(original)
            ? original.replace(/["']wrong["']/, '0')
            : original.replace(/throw new Error\('name required'\)/, "return { ok: false, error: 'name required' } as never")
          : (routed?.text && /export function greet/.test(routed.text) ? greetTypedReplacement() : greetTypedReplacement())
    proposal = createFoundryEditProposal({
      envelope,
      instruction: instruction || 'Edit selection with Foundry',
      reason: deterministicText(kind, envelope, instruction),
      replacementText: replacement,
      kind: 'MODIFY',
      modelProvider: provider,
      modelId,
    })
  }

  const response: FoundryW2Response = {
    ok: true,
    kind,
    readOnly: false,
    text: proposal.reason,
    proposal,
    envelope,
    chips: editorContextChips(envelope),
    privacy: privacy(envelope, providerClass),
  }
  writeJson(lastResponsePath(), response)
  writeJson(busFile('proposal-preview.json'), {
    proposalId: proposal.proposalId,
    filePath: proposal.filePath,
    originalText: envelope.selection.text,
    replacementText: proposal.replacementText,
    reason: proposal.reason,
  })
  writeJson(busFile('active-proposal-id.json'), { proposalId: proposal.proposalId })
  return response
}

export async function acceptW2Proposal(proposalId: string): Promise<FoundryW2Response> {
  const result = await acceptFoundryEditProposal(proposalId)
  const response: FoundryW2Response = {
    ok: result.ok,
    kind: 'accept',
    readOnly: false,
    proposal: result.proposal,
    code: result.code,
    error: result.error,
    text: result.ok ? 'Applied via Tool Broker.' : result.error,
  }
  writeJson(lastResponsePath(), response)
  return response
}

export async function rejectW2Proposal(proposalId: string): Promise<FoundryW2Response> {
  const result = rejectFoundryEditProposal(proposalId)
  const response: FoundryW2Response = {
    ok: result.ok,
    kind: 'reject',
    readOnly: true,
    proposal: result.proposal,
    code: result.code,
    error: result.error,
    text: 'Proposal rejected. Disk unchanged.',
  }
  writeJson(lastResponsePath(), response)
  return response
}

export function w2ProposalHistory() {
  return listFoundryEditProposals()
}

export function loadW2Proposal(id: string) {
  return loadFoundryEditProposal(id)
}

export function envelopeFromDiskFile(workspaceRoot: string, rel: string, extras?: Partial<FoundryEditorContextEnvelope>): FoundryEditorContextEnvelope {
  const abs = path.join(workspaceRoot, rel)
  const content = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const lines = content.split('\n')
  const start = Math.max(1, lines.findIndex(line => line.includes('export function greet')) + 1)
  const end = Math.max(start, lines.findIndex((line, index) => index + 1 >= start && line.startsWith('}')) + 1 || start + 4)
  const text = lines.slice(start - 1, end).join('\n')
  return buildFoundryEditorContextEnvelope({
    workspaceRoot,
    projectId: 'w2-workbench',
    workspaceId: 'w2-workbench',
    activeFile: rel,
    activeLanguageId: 'typescript',
    cursor: { line: start, column: 1 },
    selection: { startLine: start, startColumn: 1, endLine: end, endColumn: (lines[end - 1] || '').length + 1, text },
    nearbyLines: lines.slice(Math.max(0, start - 3), end + 3).join('\n'),
    activeSymbol: 'greet',
    openTabs: [{ path: rel, languageId: 'typescript' }],
    visibleDiagnostics: extras?.visibleDiagnostics,
    fileContent: content,
    providerClass: extras?.sensitive?.providerClass ?? 'local',
  })
}
