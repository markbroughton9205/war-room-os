/**
 * Foundry Workbench W2 — bounded editor context envelope.
 * Adapter may collect this. Foundry server is the only authority that may
 * send it to a model. Secrets are classified, never printed.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { classifyFoundrySensitivePath, redactSecretLikeText } from './foundrySensitivePathGuard'

export const FOUNDRY_EDITOR_CONTEXT_BOUNDS = {
  MAX_SELECTION_CHARS: 8_000,
  MAX_NEARBY_LINES: 40,
  MAX_FILE_CONTEXT_CHARS: 12_000,
  MAX_OPEN_TABS: 12,
  MAX_DIAGNOSTICS: 20,
  MAX_GIT_HUNKS: 8,
  MAX_GIT_HUNK_CHARS: 2_000,
  MAX_TERMINAL_TAIL_CHARS: 2_000,
  MAX_TEST_FAILURE_CHARS: 2_000,
  MAX_DEBUG_FRAMES: 8,
  MAX_DEBUG_VARS: 12,
  MAX_DEBUG_VAR_CHARS: 200,
  MAX_TEST_OUTPUT_CHARS: 2_000,
} as const

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

export type FoundryDebugContext = {
  sessionId?: string | null
  stoppedReason?: string | null
  activeFrame?: string | null
  functionName?: string | null
  file?: string | null
  line?: number | null
  boundedCallStack?: FoundryDebugFrame[]
  boundedVariables?: FoundryDebugVariable[]
  exception?: string | null
  breakpoint?: { file: string; line: number; enabled: boolean } | null
  attached?: boolean
}

export type FoundryTestContext = {
  runId?: string | null
  testId?: string | null
  testName?: string | null
  file?: string | null
  status?: 'pass' | 'fail' | 'unknown'
  message?: string | null
  expected?: string | null
  actual?: string | null
  stack?: string | null
  duration?: number | null
  outputTail?: string | null
  attached?: boolean
}

export type FoundryEditorCursor = {
  line: number
  column: number
}

export type FoundryEditorSelection = {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  truncated: boolean
  originalChars: number
}

export type FoundryEditorTab = {
  path: string
  languageId?: string
}

export type FoundryEditorDiagnostic = {
  diagnosticId?: string
  file: string
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  source?: string
  code?: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export type FoundryGitDiffHunk = {
  file: string
  header: string
  text: string
  truncated: boolean
}

export type FoundryEditorContextEnvelope = {
  projectId: string
  workspaceId: string
  workspaceRoot: string
  activeFile: string | null
  activeLanguageId: string | null
  cursor: FoundryEditorCursor
  selection: FoundryEditorSelection
  nearbyLines?: string
  activeSymbol?: string | null
  openTabs: FoundryEditorTab[]
  visibleDiagnostics: FoundryEditorDiagnostic[]
  terminalTail?: string
  terminalSession?: {
    id: string
    cwd: string
    lineCount: number
    byteCount: number
    redactionOccurred: boolean
    attached: boolean
  }
  lastTestFailure?: string
  gitDiffHunks?: FoundryGitDiffHunk[]
  git?: {
    branch?: string | null
    changedFiles?: string[]
    stagedFiles?: string[]
    unstagedFiles?: string[]
    boundedDiffHunks?: FoundryGitDiffHunk[]
  }
  debug?: FoundryDebugContext
  test?: FoundryTestContext
  fileHash?: string | null
  originalTextHash?: string | null
  sensitive: {
    blocked: boolean
    redacted: boolean
    reason: string | null
    providerClass: 'none' | 'local' | 'remote'
  }
  truncation: {
    selection: boolean
    nearby: boolean
    tabs: boolean
    diagnostics: boolean
    git: boolean
    debug: boolean
    test: boolean
  }
  timestamp: string
}

export type FoundryEditorContextChips = {
  file: string | null
  selection: string | null
  diagnostics: string | null
  symbol: string | null
  sensitive: string | null
  terminal: string | null
  git: string | null
  debug: string | null
  test: string | null
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function clip(text: string, max: number): { text: string; truncated: boolean; originalChars: number } {
  const originalChars = text.length
  if (originalChars <= max) return { text, truncated: false, originalChars }
  return { text: `${text.slice(0, max)}\n/* [FOUNDRY_TRUNCATED ${originalChars - max} chars] */`, truncated: true, originalChars }
}

function posixRel(workspaceRoot: string, filePath: string | null | undefined): string | null {
  if (!filePath) return null
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath)
  const root = path.resolve(workspaceRoot)
  if (abs === root) return '.'
  if (abs.startsWith(root + path.sep)) return abs.slice(root.length + 1).split(path.sep).join('/')
  return abs.split(path.sep).join('/')
}

export function emptySelection(): FoundryEditorSelection {
  return { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, text: '', truncated: false, originalChars: 0 }
}

export function hashEditorText(text: string): string {
  return sha256(text)
}

export function buildFoundryEditorContextEnvelope(input: {
  projectId?: string
  workspaceId?: string
  workspaceRoot: string
  activeFile?: string | null
  activeLanguageId?: string | null
  cursor?: Partial<FoundryEditorCursor>
  selection?: Partial<FoundryEditorSelection> & { text?: string }
  nearbyLines?: string
  activeSymbol?: string | null
  openTabs?: FoundryEditorTab[]
  visibleDiagnostics?: FoundryEditorDiagnostic[]
  terminalTail?: string
  terminalSession?: FoundryEditorContextEnvelope['terminalSession']
  lastTestFailure?: string
  gitDiffHunks?: FoundryGitDiffHunk[]
  git?: {
    branch?: string | null
    changedFiles?: string[]
    stagedFiles?: string[]
    unstagedFiles?: string[]
    boundedDiffHunks?: FoundryGitDiffHunk[]
  }
  debug?: FoundryDebugContext
  test?: FoundryTestContext
  fileContent?: string | null
  providerClass?: 'none' | 'local' | 'remote'
}): FoundryEditorContextEnvelope {
  const workspaceRoot = path.resolve(input.workspaceRoot)
  const activeFile = posixRel(workspaceRoot, input.activeFile ?? null)
  const selectionText = String(input.selection?.text ?? '')
  const clippedSelection = clip(selectionText, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_SELECTION_CHARS)
  const nearby = clip(String(input.nearbyLines ?? ''), FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_FILE_CONTEXT_CHARS)
  const tabs = (input.openTabs ?? []).slice(0, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_OPEN_TABS).map(tab => ({
    path: posixRel(workspaceRoot, tab.path) ?? tab.path,
    languageId: tab.languageId,
  }))
  const ranked = [...(input.visibleDiagnostics ?? [])].sort((a, b) => {
    const sev = { error: 0, warning: 1, info: 2, hint: 3 }
    const active = posixRel(workspaceRoot, input.activeFile ?? null)
    const aFile = posixRel(workspaceRoot, a.file) ?? a.file
    const bFile = posixRel(workspaceRoot, b.file) ?? b.file
    const aActive = aFile === active ? 0 : 1
    const bActive = bFile === active ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    return (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9)
  })
  const diagnostics = ranked.slice(0, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DIAGNOSTICS).map(item => ({
    ...item,
    file: posixRel(workspaceRoot, item.file) ?? item.file,
    message: redactSecretLikeText(item.message).slice(0, 500),
  }))
  const git = (input.gitDiffHunks ?? input.git?.boundedDiffHunks ?? []).slice(0, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_GIT_HUNKS).map(hunk => {
    const clipped = clip(hunk.text, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_GIT_HUNK_CHARS)
    return {
      file: posixRel(workspaceRoot, hunk.file) ?? hunk.file,
      header: hunk.header,
      text: clipped.text,
      truncated: clipped.truncated,
    }
  })
  const sensitivity = classifyFoundrySensitivePath(activeFile ?? '')
  const providerClass = input.providerClass ?? 'none'
  const remoteBlocked = sensitivity.refuseRead && providerClass === 'remote'
  const shouldRedact = sensitivity.sensitive || sensitivity.refuseRead
  const selection: FoundryEditorSelection = {
    startLine: Math.max(1, Number(input.selection?.startLine ?? input.cursor?.line ?? 1)),
    startColumn: Math.max(1, Number(input.selection?.startColumn ?? input.cursor?.column ?? 1)),
    endLine: Math.max(1, Number(input.selection?.endLine ?? input.selection?.startLine ?? input.cursor?.line ?? 1)),
    endColumn: Math.max(1, Number(input.selection?.endColumn ?? input.selection?.startColumn ?? input.cursor?.column ?? 1)),
    text: shouldRedact ? '' : clippedSelection.text,
    truncated: clippedSelection.truncated,
    originalChars: clippedSelection.originalChars,
  }
  return {
    projectId: input.projectId || 'foundry-workbench',
    workspaceId: input.workspaceId || 'foundry-workbench',
    workspaceRoot,
    activeFile: shouldRedact && sensitivity.refuseRead ? activeFile : activeFile,
    activeLanguageId: input.activeLanguageId ?? null,
    cursor: {
      line: Math.max(1, Number(input.cursor?.line ?? selection.startLine)),
      column: Math.max(1, Number(input.cursor?.column ?? selection.startColumn)),
    },
    selection,
    nearbyLines: shouldRedact ? undefined : nearby.text || undefined,
    activeSymbol: input.activeSymbol ?? null,
    openTabs: tabs,
    visibleDiagnostics: diagnostics,
    terminalTail: input.terminalTail
      ? clip(redactSecretLikeText(input.terminalTail), FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_TERMINAL_TAIL_CHARS).text
      : undefined,
    terminalSession: input.terminalSession,
    lastTestFailure: input.lastTestFailure
      ? clip(redactSecretLikeText(input.lastTestFailure), FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_TEST_FAILURE_CHARS).text
      : undefined,
    gitDiffHunks: git.length ? git : undefined,
    git: input.git ? {
      branch: input.git.branch ?? null,
      changedFiles: (input.git.changedFiles ?? []).slice(0, 40),
      stagedFiles: (input.git.stagedFiles ?? []).slice(0, 40),
      unstagedFiles: (input.git.unstagedFiles ?? []).slice(0, 40),
      boundedDiffHunks: git,
    } : git.length ? {
      branch: null,
      changedFiles: [...new Set(git.map(item => item.file))],
      stagedFiles: [],
      unstagedFiles: [],
      boundedDiffHunks: git,
    } : undefined,
    debug: input.debug ? {
      sessionId: input.debug.sessionId ?? null,
      stoppedReason: input.debug.stoppedReason ?? null,
      activeFrame: input.debug.activeFrame ?? null,
      functionName: input.debug.functionName ?? null,
      file: input.debug.file ?? null,
      line: input.debug.line ?? null,
      boundedCallStack: (input.debug.boundedCallStack ?? []).slice(0, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_FRAMES),
      boundedVariables: (input.debug.boundedVariables ?? []).slice(0, FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_VARS).map(item => {
        const clipped = clip(redactSecretLikeText(item.value), FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_VAR_CHARS)
        return {
          ...item,
          value: clipped.text,
          truncated: item.truncated || item.value.length > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_VAR_CHARS,
          redacted: item.redacted || clipped.text !== item.value,
        }
      }),
      exception: input.debug.exception ? clip(redactSecretLikeText(input.debug.exception), 500).text : null,
      breakpoint: input.debug.breakpoint ?? null,
      attached: Boolean(input.debug.attached),
    } : undefined,
    test: input.test ? {
      runId: input.test.runId ?? null,
      testId: input.test.testId ?? null,
      testName: input.test.testName ?? null,
      file: input.test.file ?? null,
      status: input.test.status ?? 'unknown',
      message: input.test.message ? clip(redactSecretLikeText(input.test.message), 500).text : null,
      expected: input.test.expected ?? null,
      actual: input.test.actual ?? null,
      stack: input.test.stack ? clip(input.test.stack, 800).text : null,
      duration: input.test.duration ?? null,
      outputTail: input.test.outputTail ? clip(redactSecretLikeText(input.test.outputTail), FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_TEST_OUTPUT_CHARS).text : null,
      attached: Boolean(input.test.attached),
    } : undefined,
    fileHash: input.fileContent != null ? sha256(input.fileContent) : null,
    originalTextHash: selectionText && !shouldRedact ? sha256(selectionText) : null,
    sensitive: {
      blocked: remoteBlocked || (sensitivity.refuseRead && providerClass !== 'none'),
      redacted: shouldRedact,
      reason: sensitivity.reason,
      providerClass,
    },
    truncation: {
      selection: clippedSelection.truncated,
      nearby: nearby.truncated,
      tabs: (input.openTabs ?? []).length > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_OPEN_TABS,
      diagnostics: (input.visibleDiagnostics ?? []).length > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DIAGNOSTICS,
      git: (input.gitDiffHunks ?? []).length > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_GIT_HUNKS,
      debug: (input.debug?.boundedCallStack?.length ?? 0) > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_DEBUG_FRAMES,
      test: Boolean(input.test?.outputTail && input.test.outputTail.length > FOUNDRY_EDITOR_CONTEXT_BOUNDS.MAX_TEST_OUTPUT_CHARS),
    },
    timestamp: new Date().toISOString(),
  }
}

export function editorContextChips(envelope: FoundryEditorContextEnvelope | null | undefined): FoundryEditorContextChips {
  if (!envelope) {
    return { file: null, selection: null, diagnostics: null, symbol: null, sensitive: null, terminal: null, git: null, debug: null, test: null }
  }
  const file = envelope.activeFile ? path.basename(envelope.activeFile) : null
  const selection = envelope.selection.originalChars
    ? `Selection ${envelope.selection.startLine}–${envelope.selection.endLine}`
    : null
  const diagnostics = envelope.visibleDiagnostics.length
    ? `${envelope.visibleDiagnostics.length} Diagnostic${envelope.visibleDiagnostics.length === 1 ? '' : 's'}`
    : null
  const symbol = envelope.activeSymbol ? `Symbol ${envelope.activeSymbol}` : null
  const sensitive = envelope.sensitive.blocked
    ? 'Sensitive file blocked'
    : envelope.sensitive.redacted
      ? 'Redacted'
      : null
  const terminal = envelope.terminalSession?.attached
    ? `Terminal ${envelope.terminalSession.lineCount} lines`
    : null
  const git = envelope.git?.branch
    ? `Git ${envelope.git.branch} · ${envelope.git.changedFiles.length} changed`
    : envelope.gitDiffHunks?.length
      ? `Git ${envelope.gitDiffHunks.length} hunks`
      : null
  const debug = envelope.debug?.attached
    ? `Debug · ${envelope.debug.functionName || 'frame'} · ${envelope.debug.boundedCallStack?.length || 0} frames`
    : null
  const test = envelope.test?.attached
    ? `Test · ${envelope.test.testName || 'test'} · ${(envelope.test.status || 'unknown').toUpperCase()}`
    : null
  return { file, selection, diagnostics, symbol, sensitive, terminal, git, debug, test }
}

export function envelopeStaleVsFile(envelope: FoundryEditorContextEnvelope, currentContent: string): boolean {
  if (!envelope.fileHash) return false
  return envelope.fileHash !== sha256(currentContent)
}

export function extractRangeText(content: string, selection: FoundryEditorSelection): string {
  const lines = content.split('\n')
  const startLine = Math.max(1, selection.startLine)
  const endLine = Math.max(startLine, selection.endLine)
  const slice = lines.slice(startLine - 1, endLine)
  if (!slice.length) return ''
  const startCol = Math.max(1, selection.startColumn)
  const endCol = Math.max(1, selection.endColumn)
  if (slice.length === 1) return slice[0].slice(startCol - 1, endCol - 1)
  slice[0] = slice[0].slice(startCol - 1)
  slice[slice.length - 1] = slice[slice.length - 1].slice(0, endCol - 1)
  return slice.join('\n')
}

export function applyRangeReplacement(content: string, selection: FoundryEditorSelection, replacement: string): string {
  const lines = content.split('\n')
  const startLine = Math.max(1, selection.startLine)
  const endLine = Math.max(startLine, selection.endLine)
  const startCol = Math.max(1, selection.startColumn)
  const endCol = Math.max(1, selection.endColumn)
  const before = lines.slice(0, startLine - 1)
  const after = lines.slice(endLine)
  const startLineText = lines[startLine - 1] ?? ''
  const endLineText = lines[endLine - 1] ?? startLineText
  const prefix = startLineText.slice(0, startCol - 1)
  const suffix = endLineText.slice(endCol - 1)
  return [...before, `${prefix}${replacement}${suffix}`, ...after].join('\n')
}

export function contextBytes(envelope: FoundryEditorContextEnvelope): number {
  return Buffer.byteLength(JSON.stringify({
    file: envelope.activeFile,
    selection: envelope.selection.text,
    nearby: envelope.nearbyLines,
    diagnostics: envelope.visibleDiagnostics,
    git: envelope.gitDiffHunks,
    symbol: envelope.activeSymbol,
  }), 'utf8')
}
