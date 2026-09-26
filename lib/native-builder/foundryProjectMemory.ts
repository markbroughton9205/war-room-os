/**
 * Phase 4 - engineering memory. Durable, structured, project-scoped knowledge that Foundry earned in earlier missions: how the code fits together, what
 * fixed a failure, which strategies did not work, what verifies what. It exists to help a later mission start closer to the answer, never to override it.
 *
 * The rules this module enforces:
 *  - A memory is written only from typed runtime evidence (verified completion, a recorded disproval / no-op / revert, a passing test, a disk hash),
 *    never from model prose. Its subject line is generated from the typed fields.
 *  - Every memory carries its evidence, the file hashes/symbols it was anchored to, a typed status (VERIFIED / STALE / SUPERSEDED / RETIRED) and the history
 *    of its status changes. Nothing is mutated without a history entry.
 *  - Memory yields to the current code: it is revalidated against the current project index before use, and anything the disk no longer supports is
 *    downgraded and never retrieved as guidance.
 *  - Retrieval is bounded and needs a concrete link to the current work (failure, file, symbol, test). A goal-word match alone retrieves nothing.
 *  - A memory can never contain a secret: text is redacted, secret files are refused, and a candidate whose text would change under redaction is dropped.
 *
 * Pure: no filesystem, network, clock or randomness (the caller passes the index, hashes and timestamps).
 */
import {
  contentHash,
  dependentsOf,
  goalTerms,
  identifierTerms,
  importsOf,
  isSecretFile,
  redactSecrets,
  testsFor,
  type ProjectContext,
  type ProjectIndex,
} from './foundryProjectContext'

export type MemoryKind = 'PROJECT_FACT' | 'FIX_PATTERN' | 'FAILED_STRATEGY' | 'DECISION' | 'VERIFICATION' | 'WORKFLOW'
export type MemoryStatus = 'VERIFIED' | 'STALE' | 'SUPERSEDED' | 'RETIRED'
export type MemoryScope = 'MISSION' | 'SESSION' | 'PROJECT'
export type EvidenceType = 'TEST_PASS' | 'TEST_FAIL' | 'DISK_HASH' | 'CONTEXT_LINK' | 'DISPROVEN' | 'NO_EFFECT' | 'REVERTED' | 'EDIT_INEFFECTIVE' | 'TRACEBACK'

export const MEMORY_LIMITS = {
  entries: 120,
  evidence: 8,
  history: 8,
  retrieve: 5,
  noteChars: 700,
  textChars: 200,
  writesPerMission: 14,
  files: 6,
} as const

export type MemoryEvidence = { type: EvidenceType; ref: string; mission: string; at: string }
export type MemoryAnchor = {
  file: string
  hash: string
  symbols: string[]
  /** True when the memory only holds while the file is byte-for-byte unchanged (a strategy disproven for a file). */
  hashSensitive?: boolean
}
export type MemoryStatusChange = { at: string; from: MemoryStatus | null; to: MemoryStatus; why: string; mission: string }
/** The identity of a failure, made only from typed fields (never raw output). */
export type FailureKey = { exception: string | null; tests: string[]; frames: string[] }

export type MemoryDetail =
  | { kind: 'PROJECT_FACT'; claim: 'defines' | 'consumes' | 'covers' | 'reads-env'; file: string; symbol?: string; other?: string }
  | { kind: 'FIX_PATTERN'; causeFiles: string[]; changedFiles: string[]; verifiedBy: string[] }
  | { kind: 'FAILED_STRATEGY'; file: string; strategy: 'EDIT_INEFFECTIVE' | 'NO_EFFECTIVE_CHANGE' | 'ISOLATED_TESTS_PASS' | 'REVIEW_REVERTED'; causeFiles: string[] }
  | { kind: 'DECISION'; decision: 'DEPENDENCY_DIRECTION' | 'OWNERSHIP'; from: string; to: string }
  | { kind: 'VERIFICATION'; command: string; tests: string[]; covers: string[] }
  | { kind: 'WORKFLOW'; note: string; command?: string }

export type EngineeringMemory = {
  id: string
  kind: MemoryKind
  scope: MemoryScope
  sessionId?: string
  status: MemoryStatus
  /** One plain sentence, generated from the typed detail. */
  subject: string
  detail: MemoryDetail
  files: string[]
  symbols: string[]
  tests: string[]
  failure?: FailureKey
  anchors: MemoryAnchor[]
  evidence: MemoryEvidence[]
  sourceMission: string
  lastMission: string
  createdAt: string
  lastVerified: string
  supersededBy?: string
  history: MemoryStatusChange[]
}

export type ProjectIdentity = { key: string; projectId: string | null; root: string }
export type MemoryStore = { version: 1; identity: ProjectIdentity; entries: EngineeringMemory[]; updatedAt: string }

// ---------------------------------------------------------------------------------------------
// Text, ids, identity
// ---------------------------------------------------------------------------------------------

/** Text that may be stored: control characters removed, bounded. Returns null when redaction would change it (it carried a secret) or it is empty. */
export function safeText(text: string, max: number = MEMORY_LIMITS.textChars): string | null {
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  if (!clean) return null
  return redactSecrets(clean) === clean ? clean : null
}

export function makeIdentity(input: { root: string; projectId: string | null }): ProjectIdentity {
  return { key: input.projectId ? `pid:${input.projectId}` : `root:${input.root}`, projectId: input.projectId, root: input.root }
}

/** SAME, or CHANGED when the stored memory belongs to a different project (different project id, or a different root when there is no id). */
export function identityStatus(store: Pick<MemoryStore, 'identity'>, current: ProjectIdentity): 'SAME' | 'CHANGED' {
  return store.identity.key === current.key ? 'SAME' : 'CHANGED'
}

export function emptyStore(identity: ProjectIdentity, at: string): MemoryStore {
  return { version: 1, identity, entries: [], updatedAt: at }
}

function memoryId(kind: MemoryKind, parts: readonly string[]): string {
  return `${kind.toLowerCase()}-${contentHash(`${kind}|${parts.join('|')}`)}`
}

function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function fileOfFrame(frame: string): string {
  return frame.split(':')[0]
}

function fnOfFrame(frame: string): string {
  return frame.split(':').slice(1).join(':')
}

// ---------------------------------------------------------------------------------------------
// Write eligibility
// ---------------------------------------------------------------------------------------------

const EVIDENCE_FOR: Record<MemoryKind, readonly EvidenceType[]> = {
  PROJECT_FACT: ['CONTEXT_LINK'],
  FIX_PATTERN: ['TEST_PASS'],
  FAILED_STRATEGY: ['DISPROVEN', 'NO_EFFECT', 'REVERTED', 'EDIT_INEFFECTIVE'],
  DECISION: ['CONTEXT_LINK'],
  VERIFICATION: ['TEST_PASS'],
  WORKFLOW: ['DISK_HASH', 'TEST_PASS'],
}

export type Eligibility = { ok: true } | { ok: false; reason: string }

/**
 * Durable knowledge only. A candidate needs a real scope, a subject, evidence of the type its kind requires, anchors with hashes for every file it names,
 * no secret file, and text that survives redaction unchanged. A durable (PROJECT) failed-strategy also needs a passing test as proof the mission resolved.
 */
export function checkWriteEligibility(candidate: EngineeringMemory): Eligibility {
  if (candidate.scope === 'MISSION') return { ok: false, reason: 'mission-scope notes are kept in the mission record, not the project store' }
  if (!safeText(candidate.subject)) return { ok: false, reason: 'subject is empty or carries secret-like text' }
  if (!candidate.evidence.length) return { ok: false, reason: 'no evidence' }
  const needed = EVIDENCE_FOR[candidate.kind]
  if (!candidate.evidence.some(item => needed.includes(item.type))) return { ok: false, reason: `${candidate.kind} needs ${needed.join(' or ')} evidence` }
  if (candidate.evidence.some(item => !safeText(item.ref, 160))) return { ok: false, reason: 'evidence reference carries secret-like text' }
  const named = uniq([...candidate.files, ...candidate.anchors.map(anchor => anchor.file)])
  if (named.some(file => isSecretFile(file))) return { ok: false, reason: 'names a secret file' }
  if (candidate.anchors.some(anchor => !anchor.hash)) return { ok: false, reason: 'an anchor has no hash' }
  if (candidate.kind !== 'WORKFLOW' && !candidate.anchors.length) return { ok: false, reason: 'not anchored to any file' }
  if (candidate.kind === 'FIX_PATTERN') {
    const d = candidate.detail as Extract<MemoryDetail, { kind: 'FIX_PATTERN' }>
    if (!d.causeFiles.length || !d.causeFiles.every(file => d.changedFiles.includes(file))) return { ok: false, reason: 'the cause must be a file the verified fix changed' }
    if (!candidate.failure) return { ok: false, reason: 'a fix pattern needs the failure it fixed' }
  }
  if (candidate.kind === 'FAILED_STRATEGY') {
    if (!candidate.failure) return { ok: false, reason: 'a failed strategy needs the failure it did not fix' }
    if (candidate.scope === 'PROJECT' && !candidate.evidence.some(item => item.type === 'TEST_PASS')) return { ok: false, reason: 'a durable failed strategy needs the passing test that resolved the mission' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------
// Building candidates from what a mission actually proved
// ---------------------------------------------------------------------------------------------

export type MissionMemoryInput = {
  mission: string
  session: string | null
  at: string
  resolved: boolean
  index: ProjectIndex
  context: ProjectContext | null
  filesMutated: readonly string[]
  /** The first failure of the mission, before any edit. */
  baseline: FailureKey | null
  ruledOut: readonly { file: string; layer: string; basis?: 'EDIT' | 'ISOLATED_TESTS' }[]
  noEffect: readonly { file: string; layer: string; attempts: number }[]
  reverted: readonly string[]
  /** Files edited in the test cycle that turned the failing tests green (recorded by the runtime). */
  greenFiles: readonly string[]
  testCommand: string | null
  greenGeneration: number
  /** File names present in the project (names only), for workflow knowledge such as the package manager. */
  projectFiles: readonly string[]
}

function anchorFor(index: ProjectIndex, file: string, symbols: readonly string[], hashSensitive = false): MemoryAnchor | null {
  const facts = index.files[file]
  if (!facts) return null
  const defined = new Set(facts.symbols.map(symbol => symbol.name))
  return { file, hash: facts.hash, symbols: uniq(symbols.filter(name => defined.has(name))).slice(0, 4), ...(hashSensitive ? { hashSensitive: true } : {}) }
}

function scoped(input: MissionMemoryInput): { scope: MemoryScope; sessionId?: string } {
  return input.resolved ? { scope: 'PROJECT' } : { scope: 'SESSION', ...(input.session ? { sessionId: input.session } : {}) }
}

/**
 * What fixed it: the edit(s) that turned the failing tests green (evidence recorded by the runtime), narrowed to the file the exception was raised in when
 * that file is among them. Nothing else counts: a changed file that merely links to a test is not a cause.
 */
export function causeFilesOf(baseline: FailureKey, greenFiles: readonly string[], index: ProjectIndex): string[] {
  // The edit that turned the tests green is direct evidence, even for a file whose earlier edit changed nothing.
  const candidates = uniq(greenFiles).filter(file => index.files[file] && !index.files[file].isTest)
  const nonTest = baseline.frames.map(fileOfFrame).filter(file => index.files[file] && !index.files[file].isTest)
  const innermost = nonTest[nonTest.length - 1]
  if (innermost && candidates.includes(innermost)) return [innermost]
  return candidates.slice(0, 2)
}

export function memoriesFromMission(input: MissionMemoryInput): EngineeringMemory[] {
  const { index, at, mission } = input
  const out: EngineeringMemory[] = []
  const base = (kind: MemoryKind, detail: MemoryDetail, key: readonly string[], fields: Partial<EngineeringMemory> & { subject: string; evidence: MemoryEvidence[]; anchors: MemoryAnchor[] }): EngineeringMemory => ({
    id: memoryId(kind, key),
    kind,
    ...scoped(input),
    status: 'VERIFIED',
    detail,
    files: [],
    symbols: [],
    tests: [],
    sourceMission: mission,
    lastMission: mission,
    createdAt: at,
    lastVerified: at,
    history: [{ at, from: null, to: 'VERIFIED', why: 'written from verified evidence', mission }],
    ...fields,
  })
  const ev = (type: EvidenceType, ref: string): MemoryEvidence => ({ type, ref, mission, at })
  const passEvidence = input.resolved ? [ev('TEST_PASS', `tests passed at generation ${input.greenGeneration}`)] : []
  const changed = uniq(input.filesMutated).filter(file => index.files[file] && !index.files[file].isTest)
  const failureKey = input.baseline ? { exception: input.baseline.exception, tests: input.baseline.tests.slice(0, 4), frames: input.baseline.frames.slice(0, 6) } : undefined

  // B. what fixed the failure
  let causes: string[] = []
  if (input.resolved && input.baseline && changed.length) {
    causes = causeFilesOf(input.baseline, input.greenFiles, index)
    const contextSymbols = (file: string) => (input.context?.entries.find(entry => entry.path === file)?.symbols ?? []).map(symbol => symbol.name)
    const anchors = causes.map(file => anchorFor(index, file, [...input.baseline!.frames.filter(frame => fileOfFrame(frame) === file).map(fnOfFrame), ...contextSymbols(file)])).filter((item): item is MemoryAnchor => Boolean(item))
    if (causes.length && anchors.length === causes.length) {
      const frameFiles = uniq(input.baseline.frames.map(fileOfFrame)).filter(file => index.files[file]).slice(0, MEMORY_LIMITS.files)
      out.push(base('FIX_PATTERN', { kind: 'FIX_PATTERN', causeFiles: causes, changedFiles: changed.slice(0, MEMORY_LIMITS.files), verifiedBy: input.baseline.tests.slice(0, 3) }, [`${input.baseline.exception ?? ''}`, ...[...causes].sort()], {
        subject: `A ${input.baseline.exception ?? 'test'} failure was fixed by changing ${causes.join(', ')}`,
        evidence: [ev('TEST_FAIL', `${input.baseline.exception ?? 'failure'} in ${input.baseline.tests[0] ?? 'the tests'}`), ...passEvidence, ...causes.map(file => ev('DISK_HASH', `${file}@${index.files[file].hash}`))],
        anchors,
        files: uniq([...causes, ...frameFiles]),
        symbols: uniq(anchors.flatMap(anchor => anchor.symbols)),
        tests: input.baseline.tests.slice(0, 3),
        failure: failureKey,
      }))
    }
  }

  // C. what did not work (only with a recorded, typed reason)
  if (input.baseline) {
    // A file the verified fix ended up changing was the cause after all: an earlier ineffective edit of it is not a lesson about it.
    const add = (file: string, strategy: Extract<MemoryDetail, { kind: 'FAILED_STRATEGY' }>['strategy'], type: EvidenceType, ref: string) => {
      if (causes.includes(file)) return
      const anchor = anchorFor(index, file, [], true)
      if (!anchor) return
      out.push(base('FAILED_STRATEGY', { kind: 'FAILED_STRATEGY', file, strategy, causeFiles: causes }, [file, `${input.baseline!.exception ?? ''}`], {
        subject: `Changing ${file} did not fix a ${input.baseline!.exception ?? 'test'} failure${causes.length ? `; the cause was in ${causes.join(', ')}` : ''}`,
        evidence: [ev(type, ref), ...passEvidence],
        anchors: [anchor],
        files: uniq([file, ...causes]),
        tests: input.baseline!.tests.slice(0, 3),
        failure: failureKey,
      }))
    }
    for (const item of input.ruledOut) add(item.file, item.basis === 'ISOLATED_TESTS' ? 'ISOLATED_TESTS_PASS' : 'EDIT_INEFFECTIVE', item.basis === 'ISOLATED_TESTS' ? 'DISPROVEN' : 'EDIT_INEFFECTIVE', item.basis === 'ISOLATED_TESTS' ? 'tests that call it directly pass while the failing test goes through another layer' : 'edited, same failure came back')
    for (const item of input.noEffect.filter(entry => entry.attempts >= 2)) if (!input.ruledOut.some(known => known.file === item.file)) add(item.file, 'NO_EFFECTIVE_CHANGE', 'NO_EFFECT', `${item.attempts} proposed edits would have changed nothing`)
    for (const file of input.reverted) add(file, 'REVIEW_REVERTED', 'REVERTED', 'a review-driven change broke passing tests and was put back')
  }

  if (input.resolved && input.context) {
    const entries = input.context.entries
    // A. project facts (defines / consumes / covers), each backed by the index and the passing tests
    const facts: EngineeringMemory[] = []
    for (const entry of entries.filter(item => item.role === 'implementation' || item.role === 'dependency')) {
      const anchor = anchorFor(index, entry.path, entry.symbols.map(symbol => symbol.name))
      for (const symbol of entry.symbols.slice(0, 2)) {
        if (!anchor || !anchor.symbols.includes(symbol.name)) continue
        facts.push(base('PROJECT_FACT', { kind: 'PROJECT_FACT', claim: 'defines', file: entry.path, symbol: symbol.name }, ['defines', entry.path, symbol.name], {
          subject: `${entry.path} defines ${symbol.name}`,
          evidence: [ev('CONTEXT_LINK', `${entry.path} defines ${symbol.name} (${entry.reasons[0] ?? entry.role})`), ...passEvidence],
          anchors: [anchor], files: [entry.path], symbols: [symbol.name],
        }))
      }
    }
    for (const entry of entries.filter(item => item.role === 'consumer' && item.via)) {
      const provider = entry.via!
      const anchor = anchorFor(index, entry.path, [])
      if (!anchor || !importsOf(index, entry.path).includes(provider)) continue
      facts.push(base('PROJECT_FACT', { kind: 'PROJECT_FACT', claim: 'consumes', file: entry.path, other: provider }, ['consumes', entry.path, provider], {
        subject: `${entry.path} consumes ${provider}`,
        evidence: [ev('CONTEXT_LINK', `${entry.path} imports ${provider}`), ...passEvidence],
        anchors: [anchor], files: [entry.path, provider],
      }))
      // D. the dependency direction is a design fact the import graph proves
      out.push(base('DECISION', { kind: 'DECISION', decision: 'DEPENDENCY_DIRECTION', from: entry.path, to: provider }, ['dep', entry.path, provider], {
        subject: `${entry.path} depends on ${provider}, not the other way round`,
        evidence: [ev('CONTEXT_LINK', `${entry.path} imports ${provider}; ${provider} does not import it`)],
        anchors: [anchor], files: [entry.path, provider],
      }))
    }
    out.push(...facts.slice(0, 6))
    // Config awareness: which code reads which setting. Only the NAME is remembered (never a value, never a default of a secret).
    for (const env of input.context.env.slice(0, 4)) {
      for (const file of env.files.filter(item => index.files[item]?.lang === 'py' || index.files[item]?.lang === 'js').slice(0, 1)) {
        if (!index.files[file].env.some(item => item.name === env.name)) continue
        const anchor = anchorFor(index, file, [])
        if (!anchor) continue
        out.push(base('PROJECT_FACT', { kind: 'PROJECT_FACT', claim: 'reads-env', file, other: env.name }, ['reads-env', file, env.name], {
          subject: `${file} reads the ${env.name} setting${env.secret ? ' (a secret: only its name is remembered)' : env.flag ? ' (a feature flag)' : ''}`,
          evidence: [ev('CONTEXT_LINK', `${file} reads ${env.name}`), ...passEvidence],
          anchors: [anchor], files: [file],
        }))
      }
    }
    for (const [file, links] of Object.entries(input.context.tests)) {
      for (const link of links.slice(0, 1)) {
        const anchor = anchorFor(index, link.test, [])
        const target = anchorFor(index, file, [])
        if (!anchor || !target) continue
        out.push(base('PROJECT_FACT', { kind: 'PROJECT_FACT', claim: 'covers', file: link.test, other: file }, ['covers', link.test, file], {
          subject: `${link.test} covers ${file}`,
          evidence: [ev('CONTEXT_LINK', `${link.test} ${link.how} ${file}`), ...passEvidence],
          anchors: [anchor, target], files: [link.test, file], tests: [link.test],
        }))
      }
    }
    // E. how the project is verified
    const testFiles = uniq(entries.filter(item => item.role === 'test').map(item => item.path))
    if (input.testCommand && testFiles.length && passEvidence.length) {
      const covers = uniq(entries.filter(item => item.role === 'implementation' || item.role === 'consumer').map(item => item.path)).slice(0, 4)
      const anchors = testFiles.map(file => anchorFor(index, file, [])).filter((item): item is MemoryAnchor => Boolean(item))
      if (anchors.length) out.push(base('VERIFICATION', { kind: 'VERIFICATION', command: input.testCommand, tests: testFiles.slice(0, 3), covers }, [input.testCommand, ...testFiles], {
        subject: `The tests run with ${input.testCommand}; ${testFiles.join(', ')} cover ${covers.join(', ') || 'this code'}`,
        evidence: passEvidence, anchors, files: uniq([...testFiles, ...covers]), tests: testFiles,
      }))
    }
  }

  // F. how the project works (names of files only)
  if (input.resolved) {
    const names = new Set(input.projectFiles)
    const notes: [string, string, string | undefined][] = [
      ['pnpm-lock.yaml', 'This project uses pnpm', 'pnpm'],
      ['package-lock.json', 'This project uses npm', 'npm'],
      ['yarn.lock', 'This project uses yarn', 'yarn'],
      ['poetry.lock', 'This project uses poetry', 'poetry'],
    ]
    for (const [file, note, command] of notes) if (names.has(file)) out.push(base('WORKFLOW', { kind: 'WORKFLOW', note, command }, [note], { subject: note, evidence: [ev('DISK_HASH', `${file} is present`)], anchors: [] }))
    if (input.testCommand && /unittest/.test(input.testCommand)) out.push(base('WORKFLOW', { kind: 'WORKFLOW', note: 'This project is tested with Python unittest', command: input.testCommand }, ['unittest'], { subject: 'This project is tested with Python unittest', evidence: passEvidence, anchors: [] }))
  }

  return out.filter(item => checkWriteEligibility(item).ok).slice(0, MEMORY_LIMITS.writesPerMission)
}

// ---------------------------------------------------------------------------------------------
// Merge, dedupe, bounds
// ---------------------------------------------------------------------------------------------

function pushHistory(entry: EngineeringMemory, to: MemoryStatus, why: string, at: string, mission: string): void {
  if (entry.status === to && entry.history.length && entry.history[entry.history.length - 1].why === why) return
  entry.history = [...entry.history, { at, from: entry.status, to, why, mission }].slice(-MEMORY_LIMITS.history)
  entry.status = to
}

function mergeEvidence(a: readonly MemoryEvidence[], b: readonly MemoryEvidence[]): MemoryEvidence[] {
  const seen = new Set<string>()
  const merged: MemoryEvidence[] = []
  for (const item of [...a, ...b]) {
    const key = `${item.type}|${item.ref}|${item.mission}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged.slice(-MEMORY_LIMITS.evidence)
}

/** Adds candidates to the store. The same durable fact is one entry: its evidence grows, its anchors and last-verified move, it is never duplicated. */
export function mergeMemories(store: MemoryStore, candidates: readonly EngineeringMemory[], at: string): MemoryStore {
  const entries = store.entries.map(entry => ({ ...entry, evidence: [...entry.evidence], history: [...entry.history], anchors: [...entry.anchors] }))
  for (const candidate of candidates) {
    if (!checkWriteEligibility(candidate).ok) continue
    const known = entries.find(entry => entry.id === candidate.id)
    if (!known) { entries.push({ ...candidate }); continue }
    known.evidence = mergeEvidence(known.evidence, candidate.evidence)
    known.anchors = candidate.anchors
    known.lastVerified = at
    known.lastMission = candidate.lastMission
    known.files = uniq([...candidate.files, ...known.files]).slice(0, MEMORY_LIMITS.files + 2)
    known.symbols = uniq([...candidate.symbols, ...known.symbols]).slice(0, 8)
    known.tests = uniq([...candidate.tests, ...known.tests]).slice(0, 5)
    if (candidate.failure) known.failure = { exception: candidate.failure.exception, tests: uniq([...candidate.failure.tests, ...(known.failure?.tests ?? [])]).slice(0, 6), frames: uniq([...candidate.failure.frames, ...(known.failure?.frames ?? [])]).slice(0, 10) }
    if (candidate.detail.kind === 'FIX_PATTERN' && known.detail.kind === 'FIX_PATTERN') known.detail = { ...known.detail, changedFiles: uniq([...candidate.detail.changedFiles, ...known.detail.changedFiles]).slice(0, MEMORY_LIMITS.files), verifiedBy: uniq([...candidate.detail.verifiedBy, ...known.detail.verifiedBy]).slice(0, 4) }
    // A durable confirmation upgrades a session note, and the same fact holding again revives a stale or superseded one.
    if (known.scope === 'SESSION' && candidate.scope === 'PROJECT') { known.scope = 'PROJECT'; delete known.sessionId }
    if (known.status !== 'VERIFIED') { known.supersededBy = undefined; pushHistory(known, 'VERIFIED', 'the same fact was verified again against the current code', at, candidate.lastMission) }
  }
  return { ...store, entries: bound(entries), updatedAt: at }
}

/** Bounded storage: retired first, then stale/superseded, then the least recently verified. */
export function bound(entries: EngineeringMemory[]): EngineeringMemory[] {
  if (entries.length <= MEMORY_LIMITS.entries) return entries
  const rank = (entry: EngineeringMemory) => ({ RETIRED: 0, SUPERSEDED: 1, STALE: 2, VERIFIED: 3 }[entry.status])
  const sorted = [...entries].sort((a, b) => rank(a) - rank(b) || a.lastVerified.localeCompare(b.lastVerified))
  const drop = new Set(sorted.slice(0, entries.length - MEMORY_LIMITS.entries).map(entry => entry.id))
  return entries.filter(entry => !drop.has(entry.id))
}

/** Restores a persisted store: validates shape, merges duplicate ids, caps sizes. Anything malformed is dropped rather than trusted. */
export function restoreStore(raw: unknown): MemoryStore | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<MemoryStore>
  if (value.version !== 1 || !value.identity || typeof value.identity.key !== 'string' || !Array.isArray(value.entries)) return null
  const byId = new Map<string, EngineeringMemory>()
  for (const item of value.entries) {
    if (!item || typeof item.id !== 'string' || typeof item.kind !== 'string' || !Array.isArray(item.anchors) || !Array.isArray(item.evidence)) continue
    if (item.files?.some(file => isSecretFile(file))) continue
    const clean: EngineeringMemory = { ...item, evidence: mergeEvidence([], item.evidence), history: [...(item.history ?? [])].slice(-MEMORY_LIMITS.history), files: [...(item.files ?? [])], symbols: [...(item.symbols ?? [])], tests: [...(item.tests ?? [])] }
    const known = byId.get(clean.id)
    if (!known) { byId.set(clean.id, clean); continue }
    known.evidence = mergeEvidence(known.evidence, clean.evidence)
    if (clean.lastVerified > known.lastVerified) { known.lastVerified = clean.lastVerified; known.anchors = clean.anchors }
  }
  return { version: 1, identity: value.identity, entries: bound([...byId.values()]), updatedAt: String(value.updatedAt ?? '') }
}

// ---------------------------------------------------------------------------------------------
// Revalidation against current disk truth
// ---------------------------------------------------------------------------------------------

export type Revalidation = { store: MemoryStore; changed: { id: string; from: MemoryStatus; to: MemoryStatus; why: string }[] }

/**
 * Compares every memory with the project as it is now. A fact the disk no longer supports is downgraded (STALE), or SUPERSEDED when the code shows where
 * the thing lives now, or RETIRED when its file is gone. A fix pattern survives edits to its file as long as the symbol it was about still exists;
 * a failed strategy only holds while its file is byte-for-byte what it was. Every change is recorded with its reason. Nothing here uses the model.
 */
export function revalidateStore(store: MemoryStore, index: ProjectIndex, at: string, mission: string): Revalidation {
  const changed: Revalidation['changed'] = []
  const entries = store.entries.map(entry => ({ ...entry, history: [...entry.history], anchors: [...entry.anchors] }))
  for (const entry of entries) {
    if (entry.status === 'RETIRED') continue
    const verdict = supportOf(entry, index)
    const before = entry.status
    if (verdict.state === 'SUPPORTED') {
      if (before !== 'VERIFIED') continue // only a new mission's evidence revives a downgraded memory
      entry.lastVerified = at
      if (verdict.rehash) entry.anchors = verdict.rehash
      continue
    }
    if (before === verdict.state) continue
    entry.supersededBy = verdict.supersededBy
    pushHistory(entry, verdict.state, verdict.why, at, mission)
    changed.push({ id: entry.id, from: before, to: verdict.state, why: verdict.why })
  }
  return { store: { ...store, entries, updatedAt: changed.length ? at : store.updatedAt }, changed }
}

type Support = { state: 'SUPPORTED'; rehash?: MemoryAnchor[] } | { state: 'STALE' | 'SUPERSEDED' | 'RETIRED'; why: string; supersededBy?: string }

function supportOf(entry: EngineeringMemory, index: ProjectIndex): Support {
  const missing = entry.anchors.find(anchor => !index.files[anchor.file])
  if (missing) return { state: 'RETIRED', why: `${missing.file} no longer exists` }
  const d = entry.detail
  if (d.kind === 'PROJECT_FACT') {
    if (d.claim === 'defines') {
      const facts = index.files[d.file]
      if (facts.symbols.some(symbol => symbol.name === d.symbol)) return { state: 'SUPPORTED', rehash: rehash(entry, index) }
      const now = (index.definitions[d.symbol ?? ''] ?? []).find(def => def.path !== d.file)
      if (now) return { state: 'SUPERSEDED', why: `${d.symbol} is no longer defined in ${d.file}; it is defined in ${now.path} now`, supersededBy: `${d.symbol} in ${now.path}` }
      return { state: 'STALE', why: `${d.symbol} is no longer defined in ${d.file}` }
    }
    if (d.claim === 'consumes') {
      if (importsOf(index, d.file).includes(d.other ?? '')) return { state: 'SUPPORTED', rehash: rehash(entry, index) }
      return { state: 'STALE', why: `${d.file} no longer imports ${d.other}` }
    }
    if (d.claim === 'reads-env') {
      return index.files[d.file].env.some(item => item.name === d.other) ? { state: 'SUPPORTED', rehash: rehash(entry, index) } : { state: 'STALE', why: `${d.file} no longer reads ${d.other}` }
    }
    if (testsFor(index, d.other ?? '').some(link => link.test === d.file)) return { state: 'SUPPORTED', rehash: rehash(entry, index) }
    return { state: 'STALE', why: `${d.file} no longer covers ${d.other}` }
  }
  if (d.kind === 'DECISION') {
    if (importsOf(index, d.from).includes(d.to) && !importsOf(index, d.to).includes(d.from)) return { state: 'SUPPORTED', rehash: rehash(entry, index) }
    return { state: 'STALE', why: `the dependency between ${d.from} and ${d.to} changed` }
  }
  if (d.kind === 'FIX_PATTERN') {
    for (const anchor of entry.anchors) {
      const defined = new Set(index.files[anchor.file].symbols.map(symbol => symbol.name))
      const gone = anchor.symbols.find(name => !defined.has(name))
      if (gone) {
        const now = (index.definitions[gone] ?? []).find(def => def.path !== anchor.file)
        return now
          ? { state: 'SUPERSEDED', why: `${gone} moved from ${anchor.file} to ${now.path}`, supersededBy: `${gone} in ${now.path}` }
          : { state: 'STALE', why: `${gone} is no longer in ${anchor.file}` }
      }
    }
    return { state: 'SUPPORTED', rehash: rehash(entry, index) }
  }
  if (d.kind === 'FAILED_STRATEGY') {
    const changedFile = entry.anchors.find(anchor => anchor.hashSensitive && index.files[anchor.file].hash !== anchor.hash)
    if (changedFile) return { state: 'STALE', why: `${changedFile.file} changed since this was learned` }
    return { state: 'SUPPORTED' }
  }
  if (d.kind === 'VERIFICATION') {
    const stillCovers = d.covers.length === 0 || d.covers.some(file => testsFor(index, file).some(link => d.tests.includes(link.test)))
    return stillCovers ? { state: 'SUPPORTED', rehash: rehash(entry, index) } : { state: 'STALE', why: 'those tests no longer reach that code' }
  }
  return { state: 'SUPPORTED' }
}

function rehash(entry: EngineeringMemory, index: ProjectIndex): MemoryAnchor[] {
  return entry.anchors.map(anchor => (anchor.hashSensitive ? anchor : { ...anchor, hash: index.files[anchor.file]?.hash ?? anchor.hash }))
}

// ---------------------------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------------------------

export type RetrievalQuery = {
  sessionId: string | null
  goal: string
  files: readonly string[]
  symbols: readonly string[]
  tests: readonly string[]
  failure?: FailureKey | null
}
export type MemoryLink = 'failure' | 'related-failure' | 'file' | 'symbol' | 'test' | 'dependency'
export type MemoryHit = { memory: EngineeringMemory; links: MemoryLink[]; reasons: string[] }
export type RetrievalResult = {
  hits: MemoryHit[]
  /** Downgraded memories that would have matched: reported so the Commander hears they were ignored, never used as guidance. */
  ignored: { memory: EngineeringMemory; why: string }[]
}

const KIND_ORDER: Record<MemoryKind, number> = { FIX_PATTERN: 0, FAILED_STRATEGY: 1, PROJECT_FACT: 2, DECISION: 3, VERIFICATION: 4, WORKFLOW: 5 }

export function failureMatches(entry: FailureKey | undefined, query: FailureKey | null | undefined): 'exact' | 'related' | null {
  if (!entry || !query || !entry.exception || entry.exception !== query.exception) return null
  const frames = new Set(entry.frames)
  const sharedFrame = query.frames.some(frame => frames.has(frame) && !/^tests?\//.test(frame))
  const sharedTest = query.tests.some(name => entry.tests.includes(name))
  return sharedFrame || sharedTest ? 'exact' : 'related'
}

/**
 * Bounded, relevance-gated retrieval. A memory is returned only when it links to the current work through a failure, a file, a symbol, a test or an
 * import relation. The goal's words only order results; they never retrieve anything alone. Memories from another project or another session's scratch
 * notes are never considered.
 */
export function retrieveMemories(store: MemoryStore, query: RetrievalQuery, index?: ProjectIndex): RetrievalResult {
  const files = new Set(query.files)
  const symbols = new Set(query.symbols)
  const tests = new Set(query.tests)
  const terms = new Set(goalTerms(query.goal))
  const related = (file: string) => Boolean(index) && query.files.some(current => importsOf(index!, current).includes(file) || dependentsOf(index!, current).includes(file))
  const hits: MemoryHit[] = []
  const ignored: RetrievalResult['ignored'] = []
  for (const memory of store.entries) {
    if (memory.scope === 'SESSION' && memory.sessionId !== query.sessionId) continue
    const links: MemoryLink[] = []
    const reasons: string[] = []
    const fail = failureMatches(memory.failure, query.failure)
    if (fail === 'exact') { links.push('failure'); reasons.push('the same kind of failure') }
    else if (fail === 'related') { links.push('related-failure'); reasons.push('a related failure') }
    const overlap = memory.files.filter(file => files.has(file))
    if (overlap.length) { links.push('file'); reasons.push(`it involves ${overlap[0]}`) }
    const sharedSymbols = memory.symbols.filter(name => symbols.has(name))
    if (sharedSymbols.length) { links.push('symbol'); reasons.push(`it is about ${sharedSymbols[0]}`) }
    if (memory.tests.some(name => tests.has(name))) { links.push('test'); reasons.push('the same tests') }
    if (!overlap.length && memory.files.some(related)) { links.push('dependency'); reasons.push('it involves code this depends on') }
    if (!links.length) continue
    if (memory.status !== 'VERIFIED') {
      if (memory.status !== 'RETIRED' && (links.includes('file') || links.includes('failure') || links.includes('symbol'))) ignored.push({ memory, why: memory.history[memory.history.length - 1]?.why ?? 'it no longer matches the current code' })
      continue
    }
    hits.push({ memory, links, reasons })
  }
  const termScore = (memory: EngineeringMemory) => identifierTerms(`${memory.subject} ${memory.files.join(' ')}`).filter(term => terms.has(term)).length
  hits.sort((a, b) => (a.links.includes('failure') ? 0 : 1) - (b.links.includes('failure') ? 0 : 1)
    || b.links.length - a.links.length
    || KIND_ORDER[a.memory.kind] - KIND_ORDER[b.memory.kind]
    || termScore(b.memory) - termScore(a.memory)
    || b.memory.lastVerified.localeCompare(a.memory.lastVerified)
    || a.memory.id.localeCompare(b.memory.id))
  return { hits: hits.slice(0, MEMORY_LIMITS.retrieve), ignored: ignored.slice(0, 2) }
}

/** A verified fix pattern for the same kind of failure: the file to look at first, only if it and its symbol still exist right now. */
export function causeSuggestions(result: RetrievalResult, index: ProjectIndex): { file: string; memoryId: string; why: string }[] {
  const out: { file: string; memoryId: string; why: string }[] = []
  for (const hit of result.hits) {
    if (hit.memory.kind !== 'FIX_PATTERN' || !hit.links.includes('failure')) continue
    const d = hit.memory.detail as Extract<MemoryDetail, { kind: 'FIX_PATTERN' }>
    for (const file of d.causeFiles) {
      const facts = index.files[file]
      const anchor = hit.memory.anchors.find(item => item.file === file)
      if (!facts || facts.isTest) continue
      if (anchor && anchor.symbols.some(name => !facts.symbols.some(symbol => symbol.name === name))) continue
      if (!out.some(item => item.file === file)) out.push({ file, memoryId: hit.memory.id, why: 'a similar failure was fixed there before' })
    }
  }
  return out.slice(0, 2)
}

/** Files an earlier verified mission found unrelated to this kind of failure, still byte-identical to what was tested. Used only to ask for fresh evidence, never to skip on its own. */
export function unrelatedCandidates(result: RetrievalResult, index: ProjectIndex, contextFiles: readonly string[]): { file: string; memoryId: string }[] {
  const out: { file: string; memoryId: string }[] = []
  for (const hit of result.hits) {
    if (hit.memory.kind !== 'FAILED_STRATEGY' || !(hit.links.includes('failure') || hit.links.includes('related-failure'))) continue
    const d = hit.memory.detail as Extract<MemoryDetail, { kind: 'FAILED_STRATEGY' }>
    const anchor = hit.memory.anchors.find(item => item.file === d.file)
    if (!contextFiles.includes(d.file) || !index.files[d.file] || (anchor?.hashSensitive && anchor.hash !== index.files[d.file].hash)) continue
    if (!out.some(item => item.file === d.file)) out.push({ file: d.file, memoryId: hit.memory.id })
  }
  return out.slice(0, 2)
}

// ---------------------------------------------------------------------------------------------
// Words for the Commander, notes for the model, details for Activity
// ---------------------------------------------------------------------------------------------

function words(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').replace(/^test_/, '').replace(/[_-]+/g, ' ')
}

function joinWords(parts: readonly string[]): string {
  const list = uniq(parts)
  return list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** What the Commander hears. Natural sentences; no scores, ids, states, counts or paths. */
export function describeMemoryUse(result: RetrievalResult, stage: 'start' | 'failure' = 'start'): string | null {
  const fix = result.hits.find(hit => hit.memory.kind === 'FIX_PATTERN' && hit.links.includes('failure'))
  if (fix) {
    const d = fix.memory.detail as Extract<MemoryDetail, { kind: 'FIX_PATTERN' }>
    return `I've seen this failure in this project before. The last time, the problem was in the ${joinWords(d.causeFiles.map(words))} code and fixing it there made the tests pass, so I'm checking that first.`
  }
  const failed = result.hits.find(hit => hit.memory.kind === 'FAILED_STRATEGY' && (hit.links.includes('failure') || hit.links.includes('related-failure')))
  if (failed) {
    const d = failed.memory.detail as Extract<MemoryDetail, { kind: 'FAILED_STRATEGY' }>
    return `I've seen this kind of failure in this project before. The last time, changing the ${words(d.file)} code didn't help, so I'm not starting there. I'll check that against the tests as they are now.`
  }
  const fact = result.hits.find(hit => hit.memory.kind === 'PROJECT_FACT' || hit.memory.kind === 'DECISION' || hit.memory.kind === 'VERIFICATION')
  if (fact) return stage === 'start' ? `I remember how some of this project fits together, and I'm checking it against the code as it is now.` : null
  return null
}

export function describeIgnoredMemory(result: RetrievalResult): string | null {
  const first = result.ignored[0]
  if (!first) return null
  const kind = first.memory.kind === 'FIX_PATTERN' ? 'fix' : first.memory.kind === 'FAILED_STRATEGY' ? 'lesson' : 'note'
  return `That earlier ${kind} no longer matches the current code, so I'm ignoring it and rebuilding the plan from the repository as it is now.`
}

/** Guidance for a specialist: bounded, marked as a hint to check against SOURCE, redacted. */
export function memoryNotes(result: RetrievalResult): string[] {
  const out: string[] = []
  let used = 0
  for (const hit of result.hits.slice(0, 3)) {
    const line = safeText(`Earlier in this project (verified then, check it against SOURCE now): ${hit.memory.subject}`, 240)
    if (!line || used + line.length > MEMORY_LIMITS.noteChars) continue
    out.push(line)
    used += line.length
  }
  return out
}

/** Technical detail for Activity. Ids and statuses live here, not in the Commander's sentences. */
export function memoryDetails(result: RetrievalResult): string[] {
  return [
    ...result.hits.map(hit => `used ${hit.memory.kind} ${hit.memory.id} [${hit.memory.status}] because ${hit.reasons.join(', ')}; verified ${hit.memory.lastVerified}; evidence ${hit.memory.evidence.map(item => item.type).join('/')}`),
    ...result.ignored.map(item => `ignored ${item.memory.kind} ${item.memory.id} [${item.memory.status}]: ${item.why}`),
  ].map(line => redactSecrets(line))
}
