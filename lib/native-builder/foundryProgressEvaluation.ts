/**
 * Smart stagnation: typed progress evaluation for the engineering campaign's bounded rework loop.
 *
 * The previous loop counted rework cycles (ceiling 5) and compared the raw first 180 characters of a
 * failure string. That could not tell "the same failure again" from "one defect fixed, a deeper one
 * exposed", so productive missions were blocked at the flat ceiling and every cause was reported as
 * BLOCKED_STAGNATION. This module replaces the *decision* with evidence:
 *
 *   FAILURE IDENTITY  - a semantic fingerprint of the test failure (volatile noise normalized)
 *   STRATEGY IDENTITY - whether the repair cycle tried something new, repeated itself, or changed nothing
 *   PROGRESS SIGNALS  - typed evidence that the situation actually improved
 *   BOUNDED BUDGET    - progress earns credits that extend the window inside a hard absolute ceiling
 *
 * It never weakens the verification barrier, review, verifier or PROJECT_READY gates: it only decides
 * whether another *repair cycle* may be opened. Pure and deterministic: no filesystem, network, clock
 * (timestamps are passed in), or React. State lives in the existing campaign record (`campaign.progress`).
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ProgressClass =
  | 'PROGRESSING'
  | 'PARTIAL_PROGRESS'
  | 'STAGNATING'
  | 'REGRESSING'
  | 'OSCILLATING'
  | 'BLOCKED_PROVIDER'
  | 'BLOCKED_CAPABILITY'
  | 'BLOCKED_POLICY'

export type ProgressSignal =
  | 'FAILURE_CHANGED'
  | 'FAILING_TEST_COUNT_DECREASED'
  | 'NEW_TESTS_PASSING'
  | 'REPAIR_TARGET_CHANGED'
  | 'HYPOTHESIS_CHANGED'
  | 'MUTATION_ADVANCED'
  | 'CONFIRMED_DEFECT_RESOLVED'
  | 'NEW_EVIDENCE'
  | 'REVIEW_FINDING_CHANGED'
  | 'ASSERTION_MOVED_TOWARD_TARGET'

/** A defect was resolved or a distinct one exposed. Other strong signals are measurable improvement without resolution (PARTIAL_PROGRESS). */
export const RESOLUTION_SIGNALS: readonly ProgressSignal[] = ['FAILURE_CHANGED', 'CONFIRMED_DEFECT_RESOLVED', 'REVIEW_FINDING_CHANGED']

export const isProgressClass = (value: ProgressClass | null | undefined): boolean => value === 'PROGRESSING' || value === 'PARTIAL_PROGRESS'

/** Signals that count as reliable progress. Everything else is weak and can never reset a stagnation window alone. */
export const STRONG_SIGNALS: readonly ProgressSignal[] = [
  'FAILURE_CHANGED',
  'FAILING_TEST_COUNT_DECREASED',
  'NEW_TESTS_PASSING',
  'CONFIRMED_DEFECT_RESOLVED',
  'REVIEW_FINDING_CHANGED',
  'ASSERTION_MOVED_TOWARD_TARGET',
]

export type StrategyIdentity = 'NEW_STRATEGY' | 'SAME_STRATEGY' | 'NO_MUTATION'
export type FailureKind = 'TEST' | 'REVIEW' | 'VERIFY'
export type ObservationKind = FailureKind | 'GREEN' | 'INVALID_OUTPUT' | 'NO_EFFECTIVE_CHANGE'
export type FailureDepth = 'STRUCTURAL' | 'BEHAVIORAL' | 'UNKNOWN'

export type FailureFingerprint = {
  /** Stable identity of the failure. Excludes line numbers, paths, timings, memory addresses and (for assertions) the compared values. */
  id: string
  kind: FailureKind
  exceptions: string[]
  /** "ExceptionClass: normalized message" of the primary failure, or the normalized finding text. */
  primary: string | null
  failingTests: string[]
  /** Tests with an explicit `... ok` line in verbose output. Quiet output has none, so passing is then only inferred from counts. */
  passedTests: string[]
  failingCount: number | null
  totalTests: number | null
  /** Project stack frames as `dir/file.py:function`, no line numbers. */
  frames: string[]
  assertion: { left: string; right: string } | null
  /** Hash of the compared values; differs when only the values moved. */
  valueKey: string
  depth: FailureDepth
  /** The test module could not even be imported/collected (unittest `_FailedTest`): nothing ran, which is worse than a failing run. */
  loadFailure: boolean
  /** Significant words (review/verifier findings only) used for fuzzy identity. */
  tokens: string[]
}

export type CycleMutation = {
  file: string
  /** Stable key of what the edit actually added (normalized), used to recognise equivalent repeats. */
  key: string
  kind: 'IMPORT' | 'CODE' | 'NOOP'
  start: number
  end: number
  /** Short human-readable description of what the edit added, used to tell the next attempt what was already tried. */
  summary: string
}

export type CycleContext = {
  hypothesis: string | null
  repairTarget: string | null
  mutations: CycleMutation[]
}

export type ProgressObservation = {
  seq: number
  at: string
  kind: ObservationKind
  fingerprintId: string | null
  exception: string | null
  message: string | null
  failingCount: number | null
  failingTests: string[]
  class: ProgressClass
  signals: ProgressSignal[]
  strategy: StrategyIdentity | null
  mutationGeneration: number
  hypothesis: string | null
  repairTarget: string | null
  stop: ProgressStopReason | null
}

export type ProgressStopReason =
  | 'STAGNATION_SAME_STRATEGY'
  | 'STAGNATION_SAME_FAILURE'
  | 'STAGNATION_NO_MUTATION'
  | 'STAGNATION_NO_PROGRESS'
  | 'STAGNATION_WINDOW'
  | 'OSCILLATION'
  | 'WINDOW_EXHAUSTED'
  | 'ITERATION_LIMIT'
  | 'ABSOLUTE_BOUND'
  | 'CAPABILITY_INVALID_OUTPUT'
  | 'CAPABILITY_NO_EFFECTIVE_CHANGE'
  | 'POLICY_NO_TESTS'
  | 'PROVIDER'

export type ContinuationState = {
  grants: number
  /** A grant was recorded and the executor has not yet reopened a rework cycle for it. */
  pending: boolean
  /** Streak values at the moment of the latest grant: stop windows count from here, the streaks themselves are never reset. */
  offsets: { noStrongProgress: number; sameFailure: number; sameStrategy: number; invalidOutputTotal: number }
  decisions: { at: string; fromStop: ProgressStopReason | null; grantNumber: number }[]
}

export const emptyContinuation = (): ContinuationState => ({ grants: 0, pending: false, offsets: { noStrongProgress: 0, sameFailure: 0, sameStrategy: 0, invalidOutputTotal: 0 }, decisions: [] })

export type ProgressNote = { icon: '✓' | '↻'; text: string }

export type CampaignProgress = {
  version: 1
  observations: ProgressObservation[]
  lastFingerprint: FailureFingerprint | null
  fingerprintHistory: string[]
  seenFingerprints: string[]
  strategyKeys: string[]
  cycle: CycleContext
  lastHypothesis: string | null
  lastRepairTarget: string | null
  sameFailureStreak: number
  sameStrategyStreak: number
  noStrongProgressStreak: number
  invalidOutputStreak: number
  /** Edits already tried, newest last (readable, short). Never erased by a continuation. */
  triedSummaries: string[]
  /** The failure text the loop was reacting to when it stopped, so a continuation reopens work on the same failure. */
  stopFinding: string | null
  /** Commander "Keep trying" grants. Evidence and history are kept; only the stop windows are re-based. */
  continuation: ContinuationState
  /** Invalid structured outputs so far. They spend model calls, not repair attempts, so they do not use the repair window. */
  invalidOutputTotal: number
  /** Edits a worker proposed that would have changed nothing. Not invalid output and not a failed hypothesis: evidence that one way of editing is not producing progress. */
  noEffectTotal: number
  /** Times the ineffective strategy was abandoned for a materially different one. */
  noEffectSwitches: number
  credits: number
  greens: number
  semanticFailureTransitions: number
  stagnationScore: number
  classification: ProgressClass | null
  lastSignals: ProgressSignal[]
  notes: ProgressNote[]
  stop: ProgressStop | null
}

export type ProgressStop = {
  reason: ProgressStopReason
  classification: ProgressClass
  message: string
  cyclesUsed: number
  cycleLimit: number
  absoluteCycles: number
}

export type ProgressDecision = {
  /** Whether another repair cycle may be opened. */
  proceed: boolean
  classification: ProgressClass
  signals: ProgressSignal[]
  strategy: StrategyIdentity | null
  stop: ProgressStop | null
  notes: ProgressNote[]
  summary: string
}

// ---------------------------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------------------------

export const PROGRESS_LIMITS = {
  baseCycles: 5,
  absoluteCycles: 9,
  baseModelCalls: 24,
  absoluteModelCalls: 40,
  modelCallsPerCredit: 4,
  /** Task-loop iterations (each ready task is one). A rework cycle spends about three, so this is the third finite ceiling next to cycles and calls. */
  baseIterations: 24,
  absoluteIterations: 40,
  iterationsPerCredit: 4,
  baseCommands: 12,
  absoluteCommands: 20,
  commandsPerCredit: 2,
  creditCap: 4,
  /** Repeats of the same failure under the same or equivalent strategy before Foundry pauses. */
  sameStrategyWindow: 2,
  /** Repeats of the same failure even when strategies differ (no evidence improving). */
  sameFailureWindow: 4,
  /** Consecutive failures without any strong progress signal, whatever the failure was. */
  noProgressWindow: 4,
  invalidOutputWindow: 2,
  /** Invalid structured outputs tolerated across the whole mission, even when they are not consecutive. */
  invalidOutputTotalWindow: 3,
  /** Commander "Keep trying": how many times one mission may be continued after a stop, and what each grant adds. */
  continuationGrantsMax: 2,
  grantCycles: 3,
  grantIterations: 12,
  grantModelCalls: 12,
  grantCommands: 6,
  /** A changed assertion value counts as movement only when it is at least this much closer to the expected value. */
  assertionCloserBy: 0.15,
  hypothesisChangedBelow: 0.5,
  findingSameAtLeast: 0.6,
} as const

export type ProgressLimits = {
  cycles: number
  iterations: number
  modelCalls: number
  commands: number
  absoluteCycles: number
  absoluteIterations: number
  absoluteModelCalls: number
  absoluteCommands: number
  credits: number
}

/** Progress earns credits (capped); credits extend the window. The absolute ceilings never move. */
export function progressLimits(progress: (Pick<CampaignProgress, 'credits'> & { continuation?: Pick<ContinuationState, 'grants'> }) | null | undefined): ProgressLimits {
  const credits = Math.max(0, Math.min(PROGRESS_LIMITS.creditCap, progress?.credits ?? 0))
  const grants = Math.max(0, Math.min(PROGRESS_LIMITS.continuationGrantsMax, progress?.continuation?.grants ?? 0))
  // A Commander grant raises the ceilings by a fixed, bounded amount. With at most `continuationGrantsMax` grants the total stays finite.
  const gc = grants * PROGRESS_LIMITS.grantCycles
  const gi = grants * PROGRESS_LIMITS.grantIterations
  const gm = grants * PROGRESS_LIMITS.grantModelCalls
  const gk = grants * PROGRESS_LIMITS.grantCommands
  return {
    cycles: Math.min(PROGRESS_LIMITS.absoluteCycles + gc, PROGRESS_LIMITS.baseCycles + credits + gc),
    iterations: Math.min(PROGRESS_LIMITS.absoluteIterations + gi, PROGRESS_LIMITS.baseIterations + credits * PROGRESS_LIMITS.iterationsPerCredit + gi),
    modelCalls: Math.min(PROGRESS_LIMITS.absoluteModelCalls + gm, PROGRESS_LIMITS.baseModelCalls + credits * PROGRESS_LIMITS.modelCallsPerCredit + gm),
    commands: Math.min(PROGRESS_LIMITS.absoluteCommands + gk, PROGRESS_LIMITS.baseCommands + credits * PROGRESS_LIMITS.commandsPerCredit + gk),
    absoluteCycles: PROGRESS_LIMITS.absoluteCycles + gc,
    absoluteIterations: PROGRESS_LIMITS.absoluteIterations + gi,
    absoluteModelCalls: PROGRESS_LIMITS.absoluteModelCalls + gm,
    absoluteCommands: PROGRESS_LIMITS.absoluteCommands + gk,
    credits,
  }
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export function emptyCampaignProgress(): CampaignProgress {
  return {
    version: 1,
    observations: [],
    lastFingerprint: null,
    fingerprintHistory: [],
    seenFingerprints: [],
    strategyKeys: [],
    cycle: { hypothesis: null, repairTarget: null, mutations: [] },
    lastHypothesis: null,
    lastRepairTarget: null,
    sameFailureStreak: 0,
    sameStrategyStreak: 0,
    noStrongProgressStreak: 0,
    invalidOutputStreak: 0,
    triedSummaries: [],
    stopFinding: null,
    continuation: emptyContinuation(),
    invalidOutputTotal: 0,
    noEffectTotal: 0,
    noEffectSwitches: 0,
    credits: 0,
    greens: 0,
    semanticFailureTransitions: 0,
    stagnationScore: 0,
    classification: null,
    lastSignals: [],
    notes: [],
    stop: null,
  }
}

/** Old records (before smart stagnation) and partially persisted records resume with safe defaults; nothing is reset that exists. */
export function ensureCampaignProgress(campaign: { progress?: Partial<CampaignProgress> | null }): CampaignProgress {
  const base = emptyCampaignProgress()
  const existing = campaign.progress ?? {}
  const merged: CampaignProgress = {
    ...base,
    ...existing,
    cycle: { ...base.cycle, ...(existing.cycle ?? {}), mutations: [...(existing.cycle?.mutations ?? [])] },
    observations: [...(existing.observations ?? [])],
    fingerprintHistory: [...(existing.fingerprintHistory ?? [])],
    seenFingerprints: [...(existing.seenFingerprints ?? [])],
    strategyKeys: [...(existing.strategyKeys ?? [])],
    lastSignals: [...(existing.lastSignals ?? [])],
    notes: [...(existing.notes ?? [])],
    triedSummaries: [...(existing.triedSummaries ?? [])],
    stopFinding: existing.stopFinding ?? null,
    continuation: { ...emptyContinuation(), ...(existing.continuation ?? {}), offsets: { ...emptyContinuation().offsets, ...(existing.continuation?.offsets ?? {}) }, decisions: [...(existing.continuation?.decisions ?? [])] },
    version: 1,
  }
  campaign.progress = merged
  return merged
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function cap<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}

// ---------------------------------------------------------------------------------------------
// Normalization and hashing
// ---------------------------------------------------------------------------------------------

/** FNV-1a, two lanes, 16 hex chars. Non-cryptographic: identity only. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ 0x9e3779b9
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** Removes volatile noise while preserving semantics: timestamps, durations, temp paths, memory addresses, line drift. */
export function normalizeVolatile(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\bin \d+(?:\.\d+)?s\b/g, 'in <t>s')
    .replace(/0x[0-9a-fA-F]{4,}/g, '<addr>')
    .replace(/(?:\/tmp|\/var\/folders|\/private\/tmp)\/[^\s'"):,]+/g, '<tmp>')
    .replace(/\/(?:home|Users|root|tmp|var|usr|opt|private|srv|mnt)(?:\/[^\s'"():,\\]+)+/g, match => `<path>/${match.split('/').pop()}`)
    .replace(/\bline \d+\b/g, 'line <n>')
    .replace(/\s+/g, ' ')
    .trim()
}

const STRUCTURAL = new Set(['SyntaxError', 'IndentationError', 'ImportError', 'ModuleNotFoundError', 'NameError', 'UnboundLocalError', 'AttributeError', 'TypeError'])

export function depthOf(exception: string | null): FailureDepth {
  if (!exception) return 'UNKNOWN'
  if (STRUCTURAL.has(exception)) return 'STRUCTURAL'
  if (exception === 'AssertionError') return 'BEHAVIORAL'
  return 'UNKNOWN'
}

function tokensOf(text: string): string[] {
  const stop = new Set(['the', 'that', 'this', 'with', 'from', 'into', 'because', 'which', 'when', 'does', 'have', 'been', 'should', 'would', 'could', 'there', 'their', 'function', 'test', 'tests', 'fail', 'pass', 'status'])
  const counts = new Map<string, number>()
  for (const word of text.toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) ?? []) {
    if (stop.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 16).map(([word]) => word).sort()
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const item of setA) if (setB.has(item)) inter += 1
  const union = setA.size + setB.size - inter
  return union === 0 ? 1 : inter / union
}

// ---------------------------------------------------------------------------------------------
// Failure fingerprints
// ---------------------------------------------------------------------------------------------

const EXCEPTION_LINE = /^(?:[\w.]+\.)?([A-Za-z_]\w*(?:Error|Exception|Failure|Exit))(?::\s?(.*))?$/
const FRAME = /File ["']([^"']+)["'], line \d+, in ([\w<>]+)/g
const STDLIB_PATH = /(?:\/usr\/lib\/python|\/lib\/python\d|site-packages|\/unittest\/|<frozen)/

function projectFrames(text: string): string[] {
  const frames = new Set<string>()
  for (const hit of text.matchAll(FRAME)) {
    if (STDLIB_PATH.test(hit[1])) continue
    const segments = hit[1].split(/[\\/]/).filter(Boolean)
    frames.add(`${segments.slice(-2).join('/')}:${hit[2]}`)
  }
  return [...frames].sort()
}

function assertionOf(message: string): { left: string; right: string } | null {
  const first = message.split('\n')[0]
  const index = first.indexOf(' != ')
  if (index < 0) return null
  const left = first.slice(0, index).replace(/^[A-Za-z ]+ differ:\s*/, '')
  const right = first.slice(index + 4)
  return { left: left.trim().slice(0, 400), right: right.trim().slice(0, 400) }
}

/** Parses unittest/pytest-like failure text. Falls back to the first "SomeError: message" when the shape is unknown. */
export function fingerprintTestFailure(raw: string, kind: FailureKind = 'TEST'): FailureFingerprint {
  const text = raw.replace(/\r/g, '')
  const blocks = text.split(/^={10,}\s*$/m).slice(1)
  const failingTests: string[] = []
  const exceptions: string[] = []
  let loadFailure = false
  let primary: { exception: string; message: string } | null = null
  for (const block of blocks) {
    const header = /^(?:ERROR|FAIL): (\S+) \(([^)]+)\)/m.exec(block)
    if (header) {
      failingTests.push(header[1])
      if (/_FailedTest/.test(header[2])) loadFailure = true
    }
    const body = block.split(/^-{10,}\s*$/m).slice(1).join('\n')
    const lines = body.split('\n')
    let found: { exception: string; message: string } | null = null
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line || /^\s/.test(line)) continue
      if (/^Ran \d+ tests?/.test(line)) break
      const match = EXCEPTION_LINE.exec(line.trim())
      if (match) found = { exception: match[1], message: (match[2] ?? '').trim() }
    }
    if (found) {
      exceptions.push(found.exception)
      if (!primary) primary = found
    }
  }
  if (!primary) {
    for (const line of text.split('\n')) {
      const match = EXCEPTION_LINE.exec(line.trim())
      if (match && !/^ERROR:/.test(line.trim())) { primary = { exception: match[1], message: (match[2] ?? '').trim() }; exceptions.push(match[1]); break }
    }
  }
  const ran = /Ran (\d+) tests?/.exec(text)
  const failed = /FAILED \(([^)]*)\)/.exec(text)
  let failingCount: number | null = null
  if (failed) {
    failingCount = 0
    for (const part of failed[1].matchAll(/(?:failures|errors)=(\d+)/g)) failingCount += Number(part[1])
  } else if (failingTests.length) failingCount = failingTests.length
  const assertion = primary?.exception === 'AssertionError' ? assertionOf(primary.message) : null
  const message = primary ? normalizeVolatile(primary.message).slice(0, 300) : normalizeVolatile(text).slice(0, 200)
  // Assertion messages carry the compared values; the failure's *identity* keeps only their shape.
  const shape = assertion ? `ASSERT_NE:${/^([A-Za-z ]+) differ:/.exec(primary?.message ?? '')?.[1] ?? 'value'}` : message
  const sortedTests = [...new Set(failingTests)].sort()
  const passedTests = [...new Set([...text.matchAll(/^(\w+) \([\w.]+\) \.\.\. ok\s*$/gm)].map(hit => hit[1]))].sort()
  const frames = projectFrames(text)
  // Import-time failures (a test file's own <module> frame, or unittest's loader message) mean nothing ran.
  if (/Failed to import test module/.test(text) || frames.some(frame => frame.endsWith(':<module>') && /(^|\/)tests?\//.test(frame))) loadFailure = true
  const exceptionSet = [...new Set(exceptions)].sort()
  const id = stableHash([kind, exceptionSet.join(','), shape, sortedTests.join(','), frames.join(',')].join('|'))
  return {
    id,
    kind,
    exceptions: exceptionSet,
    primary: primary ? `${primary.exception}: ${message}` : null,
    failingTests: sortedTests,
    passedTests,
    failingCount,
    totalTests: ran ? Number(ran[1]) : null,
    frames,
    assertion: assertion ? { left: normalizeVolatile(assertion.left), right: normalizeVolatile(assertion.right) } : null,
    valueKey: stableHash(assertion ? `${normalizeVolatile(assertion.left)}|${normalizeVolatile(assertion.right)}` : message),
    depth: depthOf(primary?.exception ?? null),
    loadFailure,
    tokens: [],
  }
}

/** Free-text reviewer/verifier findings: identity is fuzzy (token overlap), never raw string equality. */
export function fingerprintFinding(text: string, kind: 'REVIEW' | 'VERIFY'): FailureFingerprint {
  const normalized = normalizeVolatile(text)
  const tokens = tokensOf(normalized)
  return {
    id: stableHash(`${kind}|${tokens.join(',')}`),
    kind,
    exceptions: [],
    primary: normalized.slice(0, 200),
    failingTests: [],
    passedTests: [],
    failingCount: null,
    totalTests: null,
    frames: [],
    assertion: null,
    valueKey: stableHash(normalized),
    depth: 'UNKNOWN',
    loadFailure: false,
    tokens,
  }
}

/** 0 = identical token multiset, 1 = nothing in common. */
export function assertionDistance(a: { left: string; right: string } | null): number | null {
  if (!a) return null
  const wordsOf = (value: string) => value.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  return 1 - jaccard(wordsOf(a.left), wordsOf(a.right))
}

function sameFailure(prev: FailureFingerprint, next: FailureFingerprint): boolean {
  if (prev.kind !== next.kind) return false
  if (next.kind !== 'TEST') return prev.id === next.id || jaccard(prev.tokens, next.tokens) >= PROGRESS_LIMITS.findingSameAtLeast
  return prev.id === next.id
}

// ---------------------------------------------------------------------------------------------
// Cycle context: what happened between two failures
// ---------------------------------------------------------------------------------------------

const IMPORT_LINE = /^\s*(?:from\s+[\w.]+\s+import\s+.+|import\s+.+)$/

function changedLines(before: string, after: string): { added: string[]; removed: string[] } {
  const norm = (line: string) => line.replace(/\s+/g, ' ').trim()
  const a = before.split('\n').map(norm).filter(Boolean)
  const b = after.split('\n').map(norm).filter(Boolean)
  const setA = new Set(a)
  const setB = new Set(b)
  return { added: b.filter(line => !setA.has(line)), removed: a.filter(line => !setB.has(line)) }
}

/** Stable key of what an edit actually did, so equivalent edits (same import, same added lines) are recognised. */
export function mutationOf(edit: { file: string; before: string; after: string; start: number; end: number }): CycleMutation {
  const { added, removed } = changedLines(edit.before, edit.after)
  const describe = (kind: string) => `${edit.file}: ${kind} ${added.slice(0, 2).join(' / ').slice(0, 140)}`
  if (!added.length && !removed.length) return { file: edit.file, key: `noop:${edit.file}`, kind: 'NOOP', start: edit.start, end: edit.end, summary: `${edit.file}: no effective change` }
  const imports = added.filter(line => IMPORT_LINE.test(line))
  if (added.length > 0 && imports.length === added.length) {
    const names = imports
      .flatMap(line => line.replace(/^\s*(?:from\s+[\w.]+\s+)?import\s+/, '').split(','))
      .map(name => name.replace(/\s+as\s+\w+/, '').replace(/[()\s]/g, ''))
      .filter(Boolean)
      .sort()
    return { file: edit.file, key: `import:${edit.file}:${names.join(',')}`, kind: 'IMPORT', start: edit.start, end: edit.end, summary: describe('added import') }
  }
  return { file: edit.file, key: `code:${edit.file}:${stableHash([...added].sort().join('\n'))}:${stableHash([...removed].sort().join('\n'))}`, kind: 'CODE', start: edit.start, end: edit.end, summary: describe('changed code to') }
}

export function noteMutation(progress: CampaignProgress, edit: { file: string; before: string; after: string; start: number; end: number }): CampaignProgress {
  const next = clone(progress)
  next.cycle.mutations.push(mutationOf(edit))
  return next
}

export function noteDebuggerFinding(progress: CampaignProgress, input: { hypothesis?: string | null; repairTarget?: string | null }): CampaignProgress {
  const next = clone(progress)
  if (input.hypothesis) next.cycle.hypothesis = input.hypothesis.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (input.repairTarget) next.cycle.repairTarget = input.repairTarget.replace(/\s+/g, ' ').trim().slice(0, 180)
  return next
}

function strategyOf(progress: CampaignProgress): StrategyIdentity {
  const real = progress.cycle.mutations.filter(item => item.kind !== 'NOOP')
  if (real.length === 0) return 'NO_MUTATION'
  const known = new Set(progress.strategyKeys)
  return real.every(item => known.has(item.key)) ? 'SAME_STRATEGY' : 'NEW_STRATEGY'
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

export type FailureObservationInput = {
  fingerprint: FailureFingerprint
  at: string
  mutationGeneration: number
  /** Rework cycles already opened for this campaign. */
  reworkCycles: number
}

function resolvedLabel(prev: FailureFingerprint | null, mutation: CycleMutation | undefined): string {
  const exception = prev?.exceptions[0] ?? null
  if (exception === 'NameError' || exception === 'UnboundLocalError') return mutation?.kind === 'IMPORT' ? 'missing import' : 'undefined name'
  if (exception === 'ImportError' || exception === 'ModuleNotFoundError') return 'import problem'
  if (exception === 'SyntaxError' || exception === 'IndentationError') return 'syntax error'
  if (exception === 'AttributeError') return 'missing attribute'
  if (exception === 'TypeError') return 'type error'
  if (exception === 'AssertionError') return 'failing assertion'
  if (prev?.kind === 'REVIEW') return 'review finding'
  return 'earlier failure'
}

function pushNotes(progress: CampaignProgress, notes: ProgressNote[]): void {
  for (const note of notes) {
    if (note.text === 'Repairing it') continue // transient; the presentation derives it from the latest evaluation
    const last = progress.notes[progress.notes.length - 1]
    if (last && last.text === note.text) continue
    progress.notes.push(note)
  }
  progress.notes = cap(progress.notes, 8)
}

function record(progress: CampaignProgress, entry: Omit<ProgressObservation, 'seq'>): void {
  progress.observations.push({ ...entry, seq: (progress.observations[progress.observations.length - 1]?.seq ?? 0) + 1 })
  progress.observations = cap(progress.observations, 16)
}

/**
 * Evaluates one failure (test / review / verification) against the recorded history and decides whether
 * another repair cycle may be opened. Returns the next state; the input is not modified.
 */
export function evaluateFailure(prior: CampaignProgress, input: FailureObservationInput): { progress: CampaignProgress; decision: ProgressDecision } {
  const p = clone(prior)
  const fp = input.fingerprint
  const last = p.lastFingerprint
  const first = !last
  const strategy = first ? null : strategyOf(p)
  const mutation = p.cycle.mutations.find(item => item.kind !== 'NOOP')
  const narrowedFrom = (a: FailureFingerprint, b: FailureFingerprint) => a.kind === 'TEST' && b.kind === 'TEST' && a.exceptions.join() === b.exceptions.join()
    && a.primary === b.primary // a different message (another undefined name, another assertion) is a distinct defect, not the same one narrowing
    && !p.seenFingerprints.includes(b.id) // undoing a regression lands on a state seen before: that is a revert, not narrowing
    && b.failingTests.length > 0 && b.failingTests.length < a.failingTests.length && b.failingTests.every(name => a.failingTests.includes(name))
  // The same failure, now affecting fewer tests, is that failure narrowing, not a different failure.
  const same = !first && (sameFailure(last, fp) || narrowedFrom(last, fp))
  const revisit = !first && !same && p.seenFingerprints.includes(fp.id)
  // Passing tests are what count. A run that fails to even import the test module reports "1 failing" and ran nothing:
  // that is a regression (the repair broke something), never fewer failures.
  const passing = (f: FailureFingerprint | null) => (f && f.totalTests !== null && f.failingCount !== null ? f.totalTests - f.failingCount : null)
  const sameKind = !first && last.kind === fp.kind
  const passingDropped = sameKind && passing(last) !== null && passing(fp) !== null && passing(fp)! < passing(last)!
  const loadRegression = sameKind && fp.loadFailure && !last.loadFailure
  const countIncreased = sameKind && ((last.failingCount !== null && fp.failingCount !== null && fp.failingCount > last.failingCount) || passingDropped || loadRegression)
  const countDecreased = sameKind && !countIncreased && last.failingCount !== null && fp.failingCount !== null && fp.failingCount < last.failingCount

  const signals: ProgressSignal[] = []
  const notes: ProgressNote[] = []
  let deeper = false
  if (!first) {
    if (countDecreased) {
      signals.push('FAILING_TEST_COUNT_DECREASED')
    }
    if (last.kind === 'TEST' && fp.kind === 'TEST') {
      // A previously failing test only counts as passing with explicit evidence (a verbose `... ok` line); quiet output
      // omits passing tests, so a shrinking failure list alone is reported as FAILING_TEST_COUNT_DECREASED, never as new passes.
      const passedNow = last.failingTests.filter(name => fp.passedTests.includes(name))
      if (passedNow.length > 0 && !countIncreased && !fp.loadFailure) signals.push('NEW_TESTS_PASSING')
    }
    if (!same && !revisit && !countIncreased) {
      if (fp.kind !== 'TEST') {
        signals.push('REVIEW_FINDING_CHANGED')
        notes.push({ icon: '↻', text: fp.kind === 'REVIEW' ? 'Review found a different issue' : 'Verification found a different issue' })
      } else {
        signals.push('FAILURE_CHANGED')
        deeper = last.depth === 'STRUCTURAL' && fp.depth === 'BEHAVIORAL'
        // A name-resolution defect whose specific name is gone after a real edit, with another name now missing, is also a resolved defect.
        const nextName = ['NameError', 'ImportError', 'ModuleNotFoundError'].includes(fp.exceptions[0] ?? '') && fp.exceptions[0] === last.exceptions[0] && Boolean(mutation)
        if ((last.depth === 'STRUCTURAL' && fp.depth !== 'STRUCTURAL') || nextName) {
          signals.push('CONFIRMED_DEFECT_RESOLVED')
          notes.push({ icon: '✓', text: `Fixed ${resolvedLabel(last, mutation)}` })
        }
        notes.push({ icon: '↻', text: deeper ? 'Found a deeper test failure' : 'Found a different test failure' })
      }
    }
    if (same && last.valueKey !== fp.valueKey && fp.assertion && last.assertion) {
      const before = assertionDistance(last.assertion)
      const after = assertionDistance(fp.assertion)
      if (before !== null && after !== null && before - after >= PROGRESS_LIMITS.assertionCloserBy) {
        signals.push('ASSERTION_MOVED_TOWARD_TARGET')
        notes.push({ icon: '↻', text: 'The result is closer to what the test expects' })
      }
    }
    if (fp.kind === 'TEST' && last.kind === 'TEST') {
      const fresh = fp.frames.filter(frame => !last.frames.includes(frame) && !/(^|\/)test_?[^/]*\.py:|tests?\//.test(frame))
      if (fresh.length > 0) signals.push('NEW_EVIDENCE')
    }
    if (p.cycle.repairTarget && p.lastRepairTarget && normalizeTarget(p.cycle.repairTarget) !== normalizeTarget(p.lastRepairTarget)) signals.push('REPAIR_TARGET_CHANGED')
    if (p.cycle.hypothesis && p.lastHypothesis && jaccard(tokensOf(p.cycle.hypothesis), tokensOf(p.lastHypothesis)) < PROGRESS_LIMITS.hypothesisChangedBelow) signals.push('HYPOTHESIS_CHANGED')
    if (strategy && strategy !== 'NO_MUTATION') signals.push('MUTATION_ADVANCED')
  }
  if (revisit) {
    // Returning to a failure already seen (a revert, an undo) restores an earlier state; it is not progress.
    for (const gone of ['FAILING_TEST_COUNT_DECREASED', 'NEW_TESTS_PASSING', 'FAILURE_CHANGED', 'CONFIRMED_DEFECT_RESOLVED'] as ProgressSignal[]) {
      const at = signals.indexOf(gone)
      if (at >= 0) signals.splice(at, 1)
    }
    notes.length = 0
  }
  if (countDecreased && !revisit && !signals.includes('FAILURE_CHANGED')) {
    // A named defect resolution says more than a count; the count is narrated only when it is the whole story.
    const fewer = last!.failingCount! - fp.failingCount!
    notes.unshift({ icon: '✓', text: `${fewer} fewer failing ${fewer === 1 ? 'test' : 'tests'}` })
  }
  if (first && p.greens > 0 && fp.kind !== 'TEST') {
    // A green run resolved the earlier defect; review/verification now exposes a distinct one.
    signals.push('REVIEW_FINDING_CHANGED')
    notes.push({ icon: '↻', text: fp.kind === 'REVIEW' ? 'Review found a different issue' : 'Verification found a different issue' })
  }
  const strong = signals.some(signal => STRONG_SIGNALS.includes(signal))

  // ---- counters ----
  if (first) {
    p.sameFailureStreak = 0
    p.sameStrategyStreak = 0
    p.noStrongProgressStreak = 0
    if (strong) p.credits = Math.min(PROGRESS_LIMITS.creditCap, p.credits + 1)
  } else {
    if (same) p.sameFailureStreak = signals.includes('ASSERTION_MOVED_TOWARD_TARGET') || countDecreased ? 0 : p.sameFailureStreak + 1
    else p.sameFailureStreak = 0
    p.sameStrategyStreak = same && strategy !== 'NEW_STRATEGY' && !strong ? p.sameStrategyStreak + 1 : 0
    p.noStrongProgressStreak = strong ? 0 : p.noStrongProgressStreak + 1
    if (!same) p.semanticFailureTransitions += 1
    if (strong) p.credits = Math.min(PROGRESS_LIMITS.creditCap, p.credits + 1)
  }
  p.stagnationScore = p.sameFailureStreak * 2 + p.sameStrategyStreak * 2 + p.noStrongProgressStreak
  // Limits are read after progress was credited: progress earned by THIS failure extends the window it is judged against.
  const limits = progressLimits(p)

  // ---- history ----
  const history = p.fingerprintHistory
  const oscillating = history.length >= 3 && fp.id === history[history.length - 2] && history[history.length - 1] === history[history.length - 3] && fp.id !== history[history.length - 1]

  // ---- stop rules (in order) ----
  let stop: ProgressStopReason | null = null
  if (oscillating) stop = 'OSCILLATION'
  else if (!first && same && strategy === 'NO_MUTATION' && !strong) stop = 'STAGNATION_NO_MUTATION'
  else if (!first && p.sameStrategyStreak - p.continuation.offsets.sameStrategy >= PROGRESS_LIMITS.sameStrategyWindow && !strong) stop = 'STAGNATION_SAME_STRATEGY'
  else if (!first && p.sameFailureStreak - p.continuation.offsets.sameFailure >= PROGRESS_LIMITS.sameFailureWindow && !strong) stop = 'STAGNATION_SAME_FAILURE'
  else if (!first && p.noStrongProgressStreak - p.continuation.offsets.noStrongProgress >= PROGRESS_LIMITS.noProgressWindow) stop = 'STAGNATION_NO_PROGRESS'
  else {
    const used = Math.max(0, input.reworkCycles - p.invalidOutputTotal)
    if (input.reworkCycles >= limits.absoluteCycles) stop = strong ? 'ABSOLUTE_BOUND' : 'STAGNATION_WINDOW'
    else if (used >= limits.cycles) stop = strong ? 'WINDOW_EXHAUSTED' : 'STAGNATION_WINDOW'
  }

  const regressed = countIncreased || revisit
  let classification: ProgressClass
  if (stop === 'OSCILLATION') classification = 'OSCILLATING'
  else if (stop === 'ABSOLUTE_BOUND' || stop === 'WINDOW_EXHAUSTED') classification = signals.some(signal => RESOLUTION_SIGNALS.includes(signal)) ? 'PROGRESSING' : 'PARTIAL_PROGRESS'
  else if (stop) classification = regressed ? 'REGRESSING' : 'STAGNATING'
  else if (strong) classification = signals.some(signal => RESOLUTION_SIGNALS.includes(signal)) ? 'PROGRESSING' : 'PARTIAL_PROGRESS'
  else if (regressed) classification = 'REGRESSING'
  else if (first) classification = 'PROGRESSING'
  else classification = 'STAGNATING'

  const stopInfo: ProgressStop | null = stop
    ? { reason: stop, classification, message: stopMessage(stop, p, limits, input.reworkCycles), cyclesUsed: input.reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
    : null

  if (!stop) notes.push({ icon: '↻', text: 'Repairing it' })
  const decisionSignals = [...new Set(signals)]
  record(p, {
    at: input.at,
    kind: fp.kind,
    fingerprintId: fp.id,
    exception: fp.exceptions[0] ?? null,
    message: fp.primary,
    failingCount: fp.failingCount,
    failingTests: fp.failingTests,
    class: classification,
    signals: decisionSignals,
    strategy,
    mutationGeneration: input.mutationGeneration,
    hypothesis: p.cycle.hypothesis,
    repairTarget: p.cycle.repairTarget,
    stop,
  })
  // archive the cycle
  for (const item of p.cycle.mutations) if (item.kind !== 'NOOP' && !p.strategyKeys.includes(item.key)) p.strategyKeys.push(item.key)
  p.strategyKeys = cap(p.strategyKeys, 24)
  for (const item of p.cycle.mutations) if (item.kind !== 'NOOP' && !p.triedSummaries.includes(item.summary)) p.triedSummaries.push(item.summary)
  p.triedSummaries = cap(p.triedSummaries, 8)
  if (p.cycle.hypothesis) p.lastHypothesis = p.cycle.hypothesis
  if (p.cycle.repairTarget) p.lastRepairTarget = p.cycle.repairTarget
  p.cycle = { hypothesis: null, repairTarget: null, mutations: [] }
  p.lastFingerprint = fp
  p.fingerprintHistory = cap([...p.fingerprintHistory, fp.id], 16)
  if (!p.seenFingerprints.includes(fp.id)) p.seenFingerprints = cap([...p.seenFingerprints, fp.id], 16)
  p.classification = classification
  p.lastSignals = decisionSignals
  p.stop = stopInfo
  pushNotes(p, notes)
  return {
    progress: p,
    decision: {
      proceed: !stop,
      classification,
      signals: decisionSignals,
      strategy,
      stop: stopInfo,
      notes,
      summary: summarize(classification, decisionSignals, strategy, stopInfo),
    },
  }
}

function normalizeTarget(value: string): string {
  return value.toLowerCase().replace(/[`'"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** A green test run is the strongest possible evidence that the recorded defect is resolved. */
export function noteGreen(prior: CampaignProgress, input: { at: string; mutationGeneration: number }): CampaignProgress {
  const p = clone(prior)
  const mutation = p.cycle.mutations.find(item => item.kind !== 'NOOP')
  const hadFailure = Boolean(p.lastFingerprint)
  p.greens += 1
  p.sameFailureStreak = 0
  p.sameStrategyStreak = 0
  p.noStrongProgressStreak = 0
  p.invalidOutputStreak = 0
  if (hadFailure) p.credits = Math.min(PROGRESS_LIMITS.creditCap, p.credits + 1)
  const notes: ProgressNote[] = hadFailure ? [{ icon: '✓', text: `Fixed ${resolvedLabel(p.lastFingerprint, mutation)}` }] : []
  record(p, {
    at: input.at,
    kind: 'GREEN',
    fingerprintId: null,
    exception: null,
    message: null,
    failingCount: 0,
    failingTests: [],
    class: 'PROGRESSING',
    signals: hadFailure ? ['CONFIRMED_DEFECT_RESOLVED', 'NEW_TESTS_PASSING'] : [],
    strategy: null,
    mutationGeneration: input.mutationGeneration,
    hypothesis: p.cycle.hypothesis,
    repairTarget: p.cycle.repairTarget,
    stop: null,
  })
  for (const item of p.cycle.mutations) if (item.kind !== 'NOOP' && !p.strategyKeys.includes(item.key)) p.strategyKeys.push(item.key)
  p.cycle = { hypothesis: null, repairTarget: null, mutations: [] }
  // The recorded failure is resolved; whatever fails next is a new situation, not a repeat.
  p.lastFingerprint = null
  p.classification = 'PROGRESSING'
  p.lastSignals = hadFailure ? ['CONFIRMED_DEFECT_RESOLVED', 'NEW_TESTS_PASSING'] : []
  p.stop = null
  pushNotes(p, notes)
  return p
}

/** A specialist returned unusable structured output. This is a capability signal, not a code failure. */
export function evaluateInvalidOutput(prior: CampaignProgress, input: { role: string; summary: string; at: string; mutationGeneration: number; reworkCycles: number }): { progress: CampaignProgress; decision: ProgressDecision } {
  const p = clone(prior)
  const limits = progressLimits(p)
  p.invalidOutputStreak += 1
  p.invalidOutputTotal += 1
  let stop: ProgressStopReason | null = null
  if (p.invalidOutputStreak > PROGRESS_LIMITS.invalidOutputWindow || p.invalidOutputTotal - p.continuation.offsets.invalidOutputTotal > PROGRESS_LIMITS.invalidOutputTotalWindow) stop = 'CAPABILITY_INVALID_OUTPUT'
  else if (input.reworkCycles >= limits.absoluteCycles) stop = 'STAGNATION_WINDOW'
  // An unusable result is not evidence of progress, and it is not a code failure either.
  const classification: ProgressClass = stop === 'CAPABILITY_INVALID_OUTPUT' ? 'BLOCKED_CAPABILITY' : 'STAGNATING'
  const stopInfo: ProgressStop | null = stop
    ? { reason: stop, classification, message: stopMessage(stop, p, limits, input.reworkCycles, input.role), cyclesUsed: input.reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
    : null
  record(p, {
    at: input.at,
    kind: 'INVALID_OUTPUT',
    fingerprintId: null,
    exception: 'InvalidOutput',
    message: normalizeVolatile(input.summary).slice(0, 200),
    failingCount: null,
    failingTests: [],
    class: classification,
    signals: [],
    strategy: null,
    mutationGeneration: input.mutationGeneration,
    hypothesis: null,
    repairTarget: null,
    stop,
  })
  p.stop = stopInfo
  if (stop) p.classification = classification
  return { progress: p, decision: { proceed: !stop, classification, signals: [], strategy: null, stop: stopInfo, notes: [], summary: summarize(classification, [], null, stopInfo) } }
}

/**
 * A worker proposed an edit whose replacement equals the file's current text. Nothing is written. This is evidence about the strategy,
 * not about the hypothesis: the first one is recorded and the mission stays alive; a repeat marks "edit this file" as ineffective, which counts
 * as stagnating strategy evidence (never as a fresh independent attempt) and forces a materially different next move. Only when every distinct
 * approach was exhausted (`exhausted`) is the model judged unable to edit, which is a capability block, not stagnation of the code.
 */
export function evaluateNoEffectiveChange(prior: CampaignProgress, input: { file: string; role: string; repeated: boolean; exhausted: boolean; at: string; mutationGeneration: number; reworkCycles: number }): { progress: CampaignProgress; decision: ProgressDecision } {
  const p = clone(prior)
  const limits = progressLimits(p)
  p.noEffectTotal = (p.noEffectTotal ?? 0) + 1
  if (input.repeated) p.noEffectSwitches = (p.noEffectSwitches ?? 0) + 1
  const summary = `${input.file}: the proposed edit would not change the file`
  if (!p.triedSummaries.includes(summary)) p.triedSummaries.push(summary)
  p.triedSummaries = cap(p.triedSummaries, 12)
  let stop: ProgressStopReason | null = null
  if (input.exhausted) stop = 'CAPABILITY_NO_EFFECTIVE_CHANGE'
  else if (input.reworkCycles >= limits.absoluteCycles) stop = 'STAGNATION_WINDOW'
  const classification: ProgressClass = stop === 'CAPABILITY_NO_EFFECTIVE_CHANGE' ? 'BLOCKED_CAPABILITY' : input.repeated ? 'STAGNATING' : (p.classification ?? 'STAGNATING')
  const stopInfo: ProgressStop | null = stop
    ? { reason: stop, classification, message: stopMessage(stop, p, limits, input.reworkCycles, input.role), cyclesUsed: input.reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
    : null
  record(p, {
    at: input.at,
    kind: 'NO_EFFECTIVE_CHANGE',
    fingerprintId: null,
    exception: 'NoEffectiveChange',
    message: normalizeVolatile(summary).slice(0, 200),
    failingCount: null,
    failingTests: [],
    class: classification,
    signals: [],
    strategy: 'NO_MUTATION',
    mutationGeneration: input.mutationGeneration,
    hypothesis: null,
    repairTarget: null,
    stop,
  })
  if (input.repeated && !stop) pushNotes(p, [{ icon: '↻', text: 'That change would not have altered anything, so I am trying a different approach' }])
  p.stop = stopInfo
  if (stop || input.repeated) p.classification = classification
  return { progress: p, decision: { proceed: !stop, classification, signals: [], strategy: 'NO_MUTATION', stop: stopInfo, notes: [], summary: summarize(classification, [], 'NO_MUTATION', stopInfo) } }
}

export function resetInvalidOutputStreak(prior: CampaignProgress): CampaignProgress {
  if (prior.invalidOutputStreak === 0) return prior
  return { ...prior, invalidOutputStreak: 0 }
}

/**
 * The Commander chose "Keep trying" on a blocked mission. Nothing Foundry learned is erased: fingerprints, strategies,
 * hypotheses, credits and the failure history stay. The stop is lifted, the stop windows are re-based on the current streaks
 * (offsets), and a bounded amount of extra authority is added. At most `continuationGrantsMax` grants exist per mission.
 */
export function grantContinuation(prior: CampaignProgress, input: { at: string; fromStop: ProgressStopReason | null }): { progress: CampaignProgress; granted: boolean; reason?: string } {
  if (prior.continuation.grants >= PROGRESS_LIMITS.continuationGrantsMax) {
    return { progress: prior, granted: false, reason: `The continuation you can grant for one mission (${PROGRESS_LIMITS.continuationGrantsMax}) is already used.` }
  }
  const p = clone(prior)
  p.continuation.grants += 1
  p.continuation.pending = true
  p.continuation.offsets = { noStrongProgress: p.noStrongProgressStreak, sameFailure: p.sameFailureStreak, sameStrategy: p.sameStrategyStreak, invalidOutputTotal: p.invalidOutputTotal }
  p.continuation.decisions.push({ at: input.at, fromStop: input.fromStop, grantNumber: p.continuation.grants })
  p.invalidOutputStreak = 0
  p.stop = null
  return { progress: p, granted: true }
}

export function clearPendingContinuation(prior: CampaignProgress): CampaignProgress {
  if (!prior.continuation.pending) return prior
  const p = clone(prior)
  p.continuation.pending = false
  return p
}

/**
 * The rework loop's guard: has the repair window (earned by progress, inside the absolute ceiling) been used up?
 * Returns the state with the typed stop recorded, or null when another cycle is still allowed.
 */
export function applyWindowStop(prior: CampaignProgress, reworkCycles: number): CampaignProgress | null {
  const limits = progressLimits(prior)
  const used = Math.max(0, reworkCycles - prior.invalidOutputTotal)
  if (used <= limits.cycles && reworkCycles < limits.absoluteCycles + 1) return null
  const p = clone(prior)
  const progressing = isProgressClass(p.classification)
  const reason: ProgressStopReason = progressing ? (reworkCycles >= limits.absoluteCycles ? 'ABSOLUTE_BOUND' : 'WINDOW_EXHAUSTED') : 'STAGNATION_WINDOW'
  const classification: ProgressClass = progressing ? 'PROGRESSING' : (p.classification ?? 'STAGNATING')
  p.stop = { reason, classification, message: stopMessage(reason, p, limits, reworkCycles), cyclesUsed: reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
  return p
}

/** The task loop ran out of iterations. Progressing missions get the typed repair limit; otherwise it is stagnation. */
export function applyIterationStop(prior: CampaignProgress, reworkCycles: number): CampaignProgress {
  const limits = progressLimits(prior)
  const p = clone(prior)
  const progressing = isProgressClass(p.classification)
  const reason: ProgressStopReason = progressing ? 'ITERATION_LIMIT' : 'STAGNATION_WINDOW'
  p.stop = { reason, classification: progressing ? 'PROGRESSING' : (p.classification ?? 'STAGNATING'), message: stopMessage(reason, p, limits, reworkCycles), cyclesUsed: reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
  return p
}

/** The test command collected no tests: the verification barrier cannot be satisfied. A policy stop, not stagnation. */
export function evaluateNoTests(prior: CampaignProgress, input: { at: string; mutationGeneration: number; reworkCycles: number }): { progress: CampaignProgress; decision: ProgressDecision } {
  const p = clone(prior)
  const limits = progressLimits(p)
  const stopInfo: ProgressStop = { reason: 'POLICY_NO_TESTS', classification: 'BLOCKED_POLICY', message: stopMessage('POLICY_NO_TESTS', p, limits, input.reworkCycles), cyclesUsed: input.reworkCycles, cycleLimit: limits.cycles, absoluteCycles: limits.absoluteCycles }
  record(p, { at: input.at, kind: 'TEST', fingerprintId: null, exception: null, message: 'The test command collected no tests.', failingCount: null, failingTests: [], class: 'BLOCKED_POLICY', signals: [], strategy: null, mutationGeneration: input.mutationGeneration, hypothesis: null, repairTarget: null, stop: 'POLICY_NO_TESTS' })
  p.classification = 'BLOCKED_POLICY'
  p.stop = stopInfo
  return { progress: p, decision: { proceed: false, classification: 'BLOCKED_POLICY', signals: [], strategy: null, stop: stopInfo, notes: [], summary: summarize('BLOCKED_POLICY', [], null, stopInfo) } }
}

/** Typed mapping for failures that are NOT stagnation. Returns null when the class is not one this module types. */
export function classifyBlock(failureClass: string | null | undefined): ProgressClass | null {
  const value = (failureClass ?? '').toUpperCase()
  if (['PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'MODEL_UNAVAILABLE', 'BLOCKED_PROVIDER'].includes(value)) return 'BLOCKED_PROVIDER'
  if (['CAPABILITY_FAILURE', 'INVALID_OUTPUT', 'BLOCKED_CAPABILITY'].includes(value)) return 'BLOCKED_CAPABILITY'
  if (['POLICY_BLOCK', 'GOVERNANCE_BLOCK', 'BLOCKED_POLICY', 'DIRTY_FILE'].includes(value)) return 'BLOCKED_POLICY'
  return null
}

// ---------------------------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------------------------

function stopMessage(reason: ProgressStopReason, p: CampaignProgress, limits: ProgressLimits, cycles: number, role?: string): string {
  switch (reason) {
    case 'STAGNATION_SAME_STRATEGY': return `The same failure returned ${p.sameFailureStreak + 1} times under the same repair strategy with no new evidence.`
    case 'STAGNATION_SAME_FAILURE': return `The same failure returned ${p.sameFailureStreak + 1} times even after strategies changed, with no test progress.`
    case 'STAGNATION_NO_MUTATION': return 'The repair cycle changed nothing and the same failure returned.'
    case 'STAGNATION_NO_PROGRESS': return `${p.noStrongProgressStreak} consecutive failures showed no reliable progress.`
    case 'OSCILLATION': return 'The failure keeps alternating between the same states.'
    case 'STAGNATION_WINDOW': return `Repair attempts (${cycles}) used the window (${limits.cycles}) and the recent failures showed no reliable progress.`
    case 'ITERATION_LIMIT': return `Foundry used all ${limits.iterations} task steps it had earned (absolute limit ${limits.absoluteIterations}) while still making progress.`
    case 'WINDOW_EXHAUSTED': return `Repair attempts (${cycles}) reached the window earned by progress so far (${limits.cycles}); the absolute limit is ${limits.absoluteCycles}.`
    case 'ABSOLUTE_BOUND': return `Foundry reached the absolute limit of ${limits.absoluteCycles} repair cycles for one mission while still making progress.`
    case 'CAPABILITY_NO_EFFECTIVE_CHANGE': return `Every way of editing that Foundry tried produced a proposal that would change nothing (${p.noEffectTotal} in all, ${p.noEffectSwitches} approaches abandoned), so the model cannot make an effective edit here.`
    case 'CAPABILITY_INVALID_OUTPUT': return `The model returned unusable structured output ${p.invalidOutputTotal} times during this mission${role ? ` (latest from ${role})` : ''}, so it cannot make reliable edits.`
    case 'POLICY_NO_TESTS': return 'The test command collected no tests, so the verification barrier cannot be satisfied.'
    case 'PROVIDER': return 'The model provider is unavailable.'
  }
}

function summarize(classification: ProgressClass, signals: readonly ProgressSignal[], strategy: StrategyIdentity | null, stop: ProgressStop | null): string {
  const bits: string[] = [classification]
  if (signals.length) bits.push(signals.join('+'))
  if (strategy) bits.push(strategy)
  if (stop) bits.push(`stop:${stop.reason}`)
  return bits.join(' · ')
}

// ---------------------------------------------------------------------------------------------
// Blocked-state typing (BLOCKED_STAGNATION is reserved for genuine stagnation and oscillation)
// ---------------------------------------------------------------------------------------------

export type BlockedProgressEvidence = {
  classification: ProgressClass
  reason: ProgressStopReason
  message: string
  cyclesUsed: number
  cycleLimit: number
  absoluteCycles: number
  credits: number
  sameFailureStreak: number
  sameStrategyStreak: number
  noStrongProgressStreak: number
  stagnationScore: number
  semanticFailureTransitions: number
  fingerprint: { id: string; kind: FailureKind; primary: string | null; failingTests: string[]; failingCount: number | null } | null
  recentStrategies: StrategyIdentity[]
  recentSignals: ProgressSignal[]
}

export function blockedSummaryFor(reason: ProgressStopReason): string {
  switch (reason) {
    case 'STAGNATION_SAME_STRATEGY':
    case 'STAGNATION_SAME_FAILURE':
    case 'STAGNATION_NO_MUTATION':
    case 'STAGNATION_NO_PROGRESS':
    case 'STAGNATION_WINDOW':
    case 'OSCILLATION':
      return 'BLOCKED_STAGNATION'
    case 'WINDOW_EXHAUSTED':
    case 'ITERATION_LIMIT':
    case 'ABSOLUTE_BOUND':
      return 'BLOCKED_REPAIR_LIMIT'
    case 'CAPABILITY_INVALID_OUTPUT':
    case 'CAPABILITY_NO_EFFECTIVE_CHANGE':
      return 'BLOCKED_CAPABILITY'
    case 'POLICY_NO_TESTS':
      return 'BLOCKED_POLICY'
    case 'PROVIDER':
      return 'PROVIDER_UNAVAILABLE'
  }
}

export function blockedEvidence(progress: CampaignProgress): BlockedProgressEvidence | null {
  const stop = progress.stop
  if (!stop) return null
  const last = progress.lastFingerprint
  return {
    classification: stop.classification,
    reason: stop.reason,
    message: stop.message,
    cyclesUsed: stop.cyclesUsed,
    cycleLimit: stop.cycleLimit,
    absoluteCycles: stop.absoluteCycles,
    credits: progress.credits,
    sameFailureStreak: progress.sameFailureStreak,
    sameStrategyStreak: progress.sameStrategyStreak,
    noStrongProgressStreak: progress.noStrongProgressStreak,
    stagnationScore: progress.stagnationScore,
    semanticFailureTransitions: progress.semanticFailureTransitions,
    fingerprint: last ? { id: last.id, kind: last.kind, primary: last.primary, failingTests: last.failingTests, failingCount: last.failingCount } : null,
    recentStrategies: progress.observations.map(item => item.strategy).filter((item): item is StrategyIdentity => Boolean(item)).slice(-6),
    recentSignals: [...new Set(progress.observations.slice(-4).flatMap(item => item.signals))],
  }
}

/** The compact, typed payload persisted on the PROGRESS_EVALUATED event (the campaign record keeps the full state). */
export function progressEventPayload(progress: CampaignProgress, decision: ProgressDecision, limits: ProgressLimits, reworkCycles: number): string {
  const last = progress.observations[progress.observations.length - 1]
  return JSON.stringify({
    v: 1,
    kind: last?.kind ?? null,
    /** The first failure of the mission: recorded as the baseline, not judged as progress. */
    baseline: (last?.kind === 'TEST' || last?.kind === 'REVIEW' || last?.kind === 'VERIFY') && last.strategy === null && last.signals.length === 0 && !progress.lastFingerprint?.loadFailure && progress.observations.filter(item => item.kind !== 'INVALID_OUTPUT').length === 1,
    class: decision.classification,
    signals: decision.signals,
    strategy: decision.strategy,
    fingerprint: last?.fingerprintId ?? null,
    exception: last?.exception ?? null,
    failingCount: last?.failingCount ?? null,
    failingTests: last?.failingTests ?? [],
    hypothesis: last?.hypothesis ?? null,
    repairTarget: last?.repairTarget ?? null,
    mutationGeneration: last?.mutationGeneration ?? null,
    sameFailureStreak: progress.sameFailureStreak,
    sameStrategyStreak: progress.sameStrategyStreak,
    noStrongProgressStreak: progress.noStrongProgressStreak,
    stagnationScore: progress.stagnationScore,
    credits: progress.credits,
    cycles: reworkCycles,
    cycleLimit: limits.cycles,
    absoluteCycles: limits.absoluteCycles,
    stop: decision.stop ? { reason: decision.stop.reason, message: decision.stop.message } : null,
    notes: decision.notes,
  })
}
