/**
 * Goal anchor (myopia protection). The Commander's request and its acceptance criteria are the fixed point of a mission;
 * the newest test output is only evidence. When a failure has nothing to do with what the request touches, chasing it means
 * "fixing" a symptom while the actual request stays undone (and blocks completion forever). This module decides, from the
 * failure text and the project's own files, which failing tests belong to the request and which do not:
 *
 *   related   the traceback touches a component file the request is about, a file Foundry itself changed, or the failing
 *             test file imports those components  -> stays a real failure and is repaired
 *   unrelated the failing test file exists, imports none of the components and its traceback never reaches them and never
 *             reaches a file Foundry changed -> deferred: recorded, reported to the Commander, not repaired
 *
 * Conservative by construction: anything it cannot classify with certainty stays related. Pure: no filesystem, network or
 * clock (the caller passes the sources it needs).
 */
import type { ComponentFilesLike } from './foundryEngineeringPlan'

export type DeferredFailure = {
  /** The failing test as the runner names it. Technical detail only. */
  test: string
  /** The test file, when it could be resolved. */
  file: string | null
  /** Plain reason it was left alone. */
  why: string
}

export type ScopedTestResult = {
  /** True when the runner output was parsed reliably enough to classify every failing test. */
  reliable: boolean
  /** True when at least one test failed and every failure is unrelated to the request. */
  onlyUnrelated: boolean
  related: string[]
  deferred: DeferredFailure[]
  /** The failure text limited to related failures, so the next step is never distracted by an unrelated error. */
  relatedText: string
}

type Block = { header: string; body: string }

const RULE = /^={20,}\s*$/m
const HEADER = /^(FAIL|ERROR):\s+(.+?)\s*$/

function blocksOf(output: string): Block[] {
  const parts = output.split(RULE)
  const blocks: Block[] = []
  for (const part of parts) {
    const lines = part.replace(/^\s*\n/, '').split('\n')
    const hit = HEADER.exec(lines[0] ?? '')
    if (hit) blocks.push({ header: `${hit[1]}: ${hit[2]}`, body: lines.join('\n') })
  }
  return blocks
}

function expectedFailureCount(output: string): number | null {
  const summary = /^FAILED \(([^)]*)\)/m.exec(output)
  if (!summary) return null
  let total = 0
  for (const part of summary[1].split(',')) {
    const hit = /(failures|errors)=(\d+)/.exec(part)
    if (hit) total += Number(hit[2])
  }
  return total
}

function dottedCandidates(header: string): string[] {
  const out: string[] = []
  const paren = /\(([^)]+)\)\s*$/.exec(header)
  const before = /^(?:FAIL|ERROR):\s+([^\s(]+)/.exec(header)
  if (paren) out.push(paren[1])
  if (before) out.push(before[1])
  return out
}

/** Repo-relative test file for a failing test header, from the module it names. */
export function testFileFromHeader(header: string, exists: (rel: string) => boolean): string | null {
  for (const dotted of dottedCandidates(header)) {
    const segments = dotted.replace(/^unittest\.loader\._FailedTest\.?/, '').split('.').filter(Boolean)
    for (let take = segments.length; take >= 1; take -= 1) {
      const rel = `${segments.slice(0, take).join('/')}.py`
      if (exists(rel)) return rel
      const inTests = `tests/${rel}`
      if (exists(inTests)) return inTests
    }
  }
  return null
}

/** Candidate test files the runner output names, so the caller can load exactly those sources. */
export function failingTestFiles(output: string): string[] {
  const files = new Set<string>()
  for (const block of blocksOf(output)) {
    for (const dotted of dottedCandidates(block.header)) {
      const segments = dotted.replace(/^unittest\.loader\._FailedTest\.?/, '').split('.').filter(Boolean)
      for (let take = segments.length; take >= 1; take -= 1) {
        const rel = `${segments.slice(0, take).join('/')}.py`
        files.add(rel)
        files.add(`tests/${rel}`)
      }
    }
  }
  return [...files]
}

function relFromFrame(frame: string, root: string): string | null {
  const normalized = frame.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return null
}

function componentDirs(components: ComponentFilesLike): string[] {
  const dirs = new Set<string>()
  for (const file of [...components.backend, ...components.frontend, ...components.contract, ...components.database]) {
    const slash = file.indexOf('/')
    dirs.add(slash > 0 ? file.slice(0, slash) : file.replace(/\.[^.]+$/, ''))
  }
  return [...dirs].filter(Boolean)
}

/** Does a test file's source pull in any of the project's components? */
export function mentionsComponent(source: string, components: ComponentFilesLike): boolean {
  const dirs = componentDirs(components)
  if (!dirs.length) return true
  const escaped = dirs.map(dir => dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (new RegExp(`^\\s*(?:from|import)\\s+(?:${escaped.join('|')})\\b`, 'm').test(source)) return true
  const all = [...components.backend, ...components.frontend, ...components.contract, ...components.database]
  return all.some(file => source.includes(file))
}

export function scopeTestFailures(input: {
  output: string
  root: string
  components: ComponentFilesLike
  /** Files Foundry changed in this mission. A failure that reaches one of them is never deferred. */
  mutated: readonly string[]
  /** Sources of the failing test files, keyed by repo-relative path (missing key = could not be read). */
  sources: Readonly<Record<string, string>>
}): ScopedTestResult {
  const blocks = blocksOf(input.output)
  const expected = expectedFailureCount(input.output)
  const unreliable: ScopedTestResult = { reliable: false, onlyUnrelated: false, related: blocks.map(block => block.header), deferred: [], relatedText: input.output }
  if (!blocks.length || (expected !== null && expected !== blocks.length)) return unreliable
  const componentFiles = new Set([...input.components.backend, ...input.components.frontend, ...input.components.contract, ...input.components.database])
  const touched = new Set(input.mutated)
  const related: Block[] = []
  const deferred: DeferredFailure[] = []
  for (const block of blocks) {
    const frames = [...block.body.matchAll(/File ["']([^"']+)["'], line \d+/g)].map(hit => relFromFrame(hit[1], input.root)).filter((rel): rel is string => Boolean(rel))
    const reachesComponent = frames.some(rel => componentFiles.has(rel) || touched.has(rel))
    const file = testFileFromHeader(block.header, rel => Object.prototype.hasOwnProperty.call(input.sources, rel))
    const source = file ? input.sources[file] : undefined
    // Unknown test source = cannot prove it is unrelated = stays a real failure.
    const importsComponent = source === undefined ? true : mentionsComponent(source, input.components)
    if (reachesComponent || importsComponent) related.push(block)
    else deferred.push({ test: block.header.replace(/^(FAIL|ERROR):\s+/, ''), file, why: 'It does not use any file this request is about, and nothing I changed reaches it.' })
  }
  return {
    reliable: true,
    onlyUnrelated: related.length === 0 && deferred.length > 0,
    related: related.map(block => block.header),
    deferred,
    relatedText: related.map(block => block.body).join('\n=====\n'),
  }
}

/** The project files a diagnosis says the problem is "in": by path or basename, or by the layer it names (the shared contract, the backend, the UI). */
export function filesNamedBy(text: string, components: ComponentFilesLike): string[] {
  const named = new Set<string>()
  const all = [...components.contract, ...components.backend, ...components.frontend, ...components.database]
  for (const file of all) if (text.includes(file) || text.includes(file.split('/').pop() ?? file)) named.add(file)
  if (/\bshared contract\b|\bthe contract\b/i.test(text)) for (const file of components.contract) named.add(file)
  return [...named]
}

/**
 * A diagnosis is a claim about the project. When it says a name is undefined IN a particular file, that file can answer: if it
 * already defines the name, the claim is contradicted by evidence and the real fix is to import the definition where it is used.
 * A diagnosis that names no file, or one that really lacks the name (the normal "not imported here" case), is left alone.
 */
export function contradictedClaim(names: readonly string[], sources: Readonly<Record<string, string>>, claimedFiles: readonly string[]): { name: string; file: string } | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const defines = new RegExp(`^(?:${escaped}\\s*(?::[^=\\n]+)?=(?!=)|def\\s+${escaped}\\s*\\(|class\\s+${escaped}\\b)`, 'm')
    for (const file of claimedFiles) if (file in sources && defines.test(sources[file])) return { name, file }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Ruling out a repair that did not work
// ---------------------------------------------------------------------------------------------

export type RuledOutEdit = { file: string; layer: string; /** How the file was ruled out: an applied edit that did not change the failure (default), or passing tests that call it directly. */ basis?: 'EDIT' | 'ISOLATED_TESTS' }
type LayeredFiles = { contract: string[]; backend: string[]; frontend: string[]; tests?: string[]; database?: string[] }
const LAYER_ORDER = ['backend', 'frontend', 'contract'] as const

/** The layer a project file belongs to, or null when it is not one of the classified component files. */
export function layerOfFile(file: string, components: LayeredFiles): string | null {
  for (const layer of LAYER_ORDER) if (components[layer].includes(file)) return layer
  return null
}

/**
 * Runtime evidence, not a model's opinion: when edits were applied since the last failure and the same failure came back, the files
 * those edits touched are not the cause. Returns the (file, layer) pairs to rule out, or [] when the failure changed or nothing was edited.
 */
export function ineffectiveEdits(input: { sameFailure: boolean; editsSinceFailure: number; recentEdits: readonly { file: string }[]; components: LayeredFiles }): RuledOutEdit[] {
  if (!input.sameFailure || input.editsSinceFailure <= 0) return []
  const files = [...new Set(input.recentEdits.slice(-input.editsSinceFailure).map(edit => edit.file))]
  return files.flatMap(file => {
    const layer = layerOfFile(file, input.components)
    return layer ? [{ file, layer }] : []
  })
}

/** Ruled-out entries accumulate without duplicates and stay bounded. */
export function mergeRuledOut(existing: readonly RuledOutEdit[] | undefined, added: readonly RuledOutEdit[]): RuledOutEdit[] {
  const merged = [...(existing ?? [])]
  for (const item of added) if (!merged.some(known => known.file === item.file)) merged.push(item)
  return merged.slice(-6)
}

/**
 * What the next diagnosis is shown. With nothing ruled out it is the backend file the runtime always started with; once a layer is
 * ruled out the other layers come first, so the diagnosis can look somewhere new instead of confirming the same idea again.
 */
export function debugFilesFor(components: LayeredFiles, ruledOut: readonly RuledOutEdit[] | undefined, noEffect?: readonly NoEffectRecord[]): string[] {
  const stale = new Set([...(ruledOut ?? []).map(item => item.file), ...repeatedNoEffect(noEffect).map(item => item.file)])
  if (!stale.size) return components.backend.slice(0, 1)
  const ruledFiles = stale
  const firsts = LAYER_ORDER.map(layer => components[layer][0]).filter((file): file is string => Boolean(file))
  const fresh = firsts.filter(file => !ruledFiles.has(file))
  const staleFirsts = firsts.filter(file => ruledFiles.has(file))
  return [...fresh, ...staleFirsts].slice(0, 3)
}

/** The layers the runtime must not reopen again for the same failure. */
export function reopenableLayers(layers: readonly string[], ruledOut: readonly RuledOutEdit[] | undefined): string[] {
  const blockedLayers = new Set((ruledOut ?? []).map(item => item.layer))
  return layers.filter(layer => !blockedLayers.has(layer))
}

/** One plain sentence per ruled-out file for the diagnosis prompt. */
export function ruledOutStatements(ruledOut: readonly RuledOutEdit[] | undefined): string[] {
  return (ruledOut ?? []).map(item => item.basis === 'ISOLATED_TESTS'
    ? `The tests that call ${item.file} directly pass, so the cause is not in ${item.file}`
    : `I changed ${item.file} and the same test still fails, so the cause is not in ${item.file}`)
}

// ---------------------------------------------------------------------------------------------
// An edit that would change nothing
// ---------------------------------------------------------------------------------------------

/**
 * A worker proposed an edit whose replacement equals what is already in the file. That is not a failed hypothesis and it is not a
 * fresh independent attempt either: it is evidence that THIS way of trying to change THIS file is not producing progress.
 * Identity is the file (the strategy "edit this file"), counted across every proposal, so four no-ops are one ineffective strategy.
 */
export type NoEffectRecord = { file: string; layer: string; /** Fingerprint of the latest proposed text. */ key: string; /** Proposals against this file that would have changed nothing. */ attempts: number }

/** Proposals against one file that would change nothing before the strategy counts as ineffective. */
export const NO_EFFECT_REPEAT = 2
/** Distinct files whose edit strategy is ineffective before the model is judged unable to make an effective edit. */
export const NO_EFFECT_STRATEGY_LIMIT = 3

export function recordNoEffect(existing: readonly NoEffectRecord[] | undefined, input: { file: string; layer: string; key: string; attempts?: number }): { records: NoEffectRecord[]; record: NoEffectRecord; repeated: boolean; sameProposal: boolean } {
  const records = (existing ?? []).map(item => ({ ...item }))
  const known = records.find(item => item.file === input.file)
  const sameProposal = Boolean(known) && known!.key === input.key
  const record: NoEffectRecord = known ?? { file: input.file, layer: input.layer, key: input.key, attempts: 0 }
  record.attempts += Math.max(1, input.attempts ?? 1)
  record.key = input.key
  if (!known) records.push(record)
  return { records: records.slice(-8), record, repeated: record.attempts >= NO_EFFECT_REPEAT, sameProposal }
}

/** Files whose "propose an edit here" strategy is already known to be ineffective. */
export function repeatedNoEffect(records: readonly NoEffectRecord[] | undefined): NoEffectRecord[] {
  return (records ?? []).filter(item => item.attempts >= NO_EFFECT_REPEAT)
}

/** One plain sentence per ineffective strategy, for the next attempt's "already tried" list. */
export function noEffectStatements(records: readonly NoEffectRecord[] | undefined): string[] {
  return repeatedNoEffect(records).map(item => `I proposed ${item.attempts} edits to ${item.file} and none would change the file, so repeating that is not useful`)
}

/**
 * Bounded search: every distinct way to edit has been tried and produced nothing. True when enough different files were
 * ineffective, or every editable layer (backend and frontend) has an ineffective edit strategy.
 */
export function noEffectExhausted(records: readonly NoEffectRecord[] | undefined, components: LayeredFiles): boolean {
  const repeated = repeatedNoEffect(records)
  if (new Set(repeated.map(item => item.file)).size >= NO_EFFECT_STRATEGY_LIMIT) return true
  const layers = (['backend', 'frontend'] as const).filter(layer => components[layer].length > 0)
  return layers.length > 0 && layers.every(layer => repeated.some(item => item.layer === layer))
}

/**
 * Which implementation layers a rework may reopen. A layer already ruled out by evidence, or whose edit strategy is ineffective,
 * is not reopened for the same failure; when that leaves nothing, the other editable layers are the materially different move.
 */
export function reopenAfterNoEffect(named: readonly string[], ruledOut: readonly RuledOutEdit[] | undefined, noEffect: readonly NoEffectRecord[] | undefined, components: LayeredFiles): string[] {
  const blocked = new Set([...(ruledOut ?? []).map(item => item.layer), ...repeatedNoEffect(noEffect).map(item => item.layer)])
  const keep = named.filter(layer => !blocked.has(layer))
  if (keep.length) return keep
  return (['backend', 'frontend'] as const).filter(layer => components[layer].length > 0 && !blocked.has(layer))
}

// ---------------------------------------------------------------------------------------------
// Alternate evidence: does a layer behave correctly when it is exercised directly?
// ---------------------------------------------------------------------------------------------

export type IsolatedLayerEvidence = {
  /** Tests that call only the layer under suspicion and pass. */
  passing: string[]
  /** Tests that fail and go through some other layer. */
  failing: string[]
  /** The other layers the failing tests go through. */
  suspectLayers: string[]
}

type VerboseOutcome = { name: string; dotted: string; result: 'ok' | 'FAIL' | 'ERROR' }

export function verboseTestOutcomes(output: string): VerboseOutcome[] {
  return [...output.matchAll(/^(\w+) \(([\w.]+)\)(?: \.\.\.|\n[^\n]*\.\.\.) ?(ok|FAIL|ERROR)\b/gm)].map(hit => ({ name: hit[1], dotted: hit[2], result: hit[3] as VerboseOutcome['result'] }))
}

function bodyOfTest(source: string, name: string): string | null {
  const starts = [...source.matchAll(/^[ \t]*(?:def|class)\s+(\w+)/gm)]
  const index = starts.findIndex(hit => hit[1] === name)
  if (index < 0) return null
  return source.slice(starts[index].index ?? 0, starts[index + 1]?.index ?? source.length)
}

/** Names a test module imports from each layer's files: `from backend.api import list_projects` gives list_projects -> backend. */
function importedLayerNames(source: string, components: LayeredFiles): Map<string, string> {
  const names = new Map<string, string>()
  for (const hit of source.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+\(?([^\n)]+)\)?/gm)) {
    const layer = layerOfFile(`${hit[1].replace(/\./g, '/')}.py`, components)
    if (!layer) continue
    for (const part of hit[2].split(',')) {
      const alias = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part)
      if (alias) names.set(alias[2] ?? alias[1], layer)
    }
  }
  for (const hit of source.matchAll(/^[ \t]*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/gm)) {
    const layer = layerOfFile(`${hit[1].replace(/\./g, '/')}.py`, components)
    if (layer) names.set(hit[2] ?? hit[1], layer)
  }
  return names
}

function layersExercised(body: string, names: ReadonlyMap<string, string>): Set<string> {
  const layers = new Set<string>()
  for (const [name, layer] of names) if (new RegExp(`(?<![\\w.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body)) layers.add(layer)
  return layers
}

/**
 * Runtime evidence that a layer is not the cause: tests that call that layer directly pass while every failing test goes through a
 * different layer. Returns null when the output cannot show that (no verbose lines, unreadable test source, a failure whose layers
 * are unknown, or nothing that exercises the layer alone) - an unclear picture never counts as evidence.
 */
export function isolatedLayerEvidence(input: { layer: string; components: LayeredFiles; verboseOutput: string; testSources: Readonly<Record<string, string>> }): IsolatedLayerEvidence | null {
  const outcomes = verboseTestOutcomes(input.verboseOutput)
  if (!outcomes.length) return null
  const passing: string[] = []
  const failing: string[] = []
  const suspect = new Set<string>()
  for (const outcome of outcomes) {
    const file = testFileFromHeader(`${outcome.result}: ${outcome.name} (${outcome.dotted})`, rel => Object.prototype.hasOwnProperty.call(input.testSources, rel))
    const source = file ? input.testSources[file] : undefined
    const body = source === undefined ? null : bodyOfTest(source, outcome.name)
    if (source === undefined || body === null) {
      if (outcome.result !== 'ok') return null
      continue
    }
    const exercised = layersExercised(body, importedLayerNames(source, input.components))
    if (outcome.result === 'ok') {
      if (exercised.size === 1 && exercised.has(input.layer)) passing.push(outcome.name)
      continue
    }
    const others = [...exercised].filter(layer => layer !== input.layer)
    if (!others.length) return null
    failing.push(outcome.name)
    for (const layer of others) suspect.add(layer)
  }
  if (!passing.length || !failing.length) return null
  return { passing, failing, suspectLayers: [...suspect] }
}
