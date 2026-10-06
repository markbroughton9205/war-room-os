/**
 * Scoped edits (pure: no filesystem, network or clock).
 *
 * A repair (rework) edit has to be traceable to why the repair exists. Every allowed edit names its trace:
 *   FAILING_EVIDENCE      the failing test/runtime output names the file (a frame, or the module in the error);
 *   FAILING_SYMBOL        the name the failure is about is defined in the file;
 *   UNMET_CRITERION       a review finding that stands names the file or code it defines;
 *   PRIMARY_IMPLEMENTATION the file is one of those that implement what was asked (a review finding about the request points at them);
 *   NEEDED_DEPENDENCY     the failing run goes through it: a file the failing evidence names imports it, directly or through other files;
 *   COMMANDER_INSTRUCTION the Commander asked for it.
 * An edit with none of those is out of scope: it changes something nobody asked to change and no failure needs changed. The first implementation
 * pass is not a repair and is governed by the plan's working set, not by this guard.
 */
import { languageOf, parseFailure } from './foundryEditForensics'
import { definedNames } from './foundryReviewEvidence'

export type ScopeOrigin = 'TEST' | 'REVIEW' | 'VERIFY' | 'COMMANDER'

export type ScopeSource = { file: string; text: string }

export type ScopeInput = {
  file: string
  /** A repair cycle is open. False for the first implementation pass. */
  rework: boolean
  origin?: ScopeOrigin | null
  /** The failure output or the standing review finding that opened this repair. */
  finding: string
  /** Every project file the campaign knows, with its text as it is on disk now. */
  sources: readonly ScopeSource[]
  /** The files that implement what was asked (found from the request), as opposed to the files they merely depend on. */
  primaryFiles?: readonly string[]
}

export type ScopeTrace = 'INITIAL_PASS' | 'FAILING_EVIDENCE' | 'FAILING_SYMBOL' | 'UNMET_CRITERION' | 'PRIMARY_IMPLEMENTATION' | 'NEEDED_DEPENDENCY' | 'COMMANDER_INSTRUCTION'

export type ScopeVerdict = { allowed: true; trace: ScopeTrace; detail: string } | { allowed: false; trace: 'OUT_OF_SCOPE'; detail: string }

function stemOf(file: string): string {
  return (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '')
}

function namesFile(finding: string, file: string): boolean {
  if (finding.includes(file)) return true
  const stem = stemOf(file)
  if (stem.length < 3 || stem === '__init__') return false
  return new RegExp(`(?<![A-Za-z0-9_])${stem}(?:\\.py|\\.[jt]sx?)?(?![A-Za-z0-9_])`).test(finding)
}

/** The modules a source file imports, as file stems (`from reports.money import money` -> money; `import os` is not a project file and drops out later). */
export function importedStems(file: string, text: string): string[] {
  const stems = new Set<string>()
  const language = languageOf(file)
  if (language === 'python') {
    for (const hit of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+([^\n]+)/gm)) {
      const parts = hit[1].split('.').filter(Boolean)
      if (parts.length) stems.add(parts[parts.length - 1])
      else for (const name of hit[2].replace(/[()]/g, '').split(',')) stems.add(name.trim().split(/\s+as\s+/)[0])
    }
    for (const hit of text.matchAll(/^[ \t]*import[ \t]+([^\n]+)/gm)) for (const part of hit[1].split(',')) stems.add(part.trim().split(/\s+as\s+/)[0].split('.').pop() ?? '')
  } else if (language === 'js') {
    for (const hit of text.matchAll(/from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)) stems.add((hit[1] ?? hit[2]).split('/').pop()?.replace(/\.[^.]+$/, '') ?? '')
  }
  stems.delete('')
  return [...stems]
}

function isTestFile(file: string): boolean {
  return /(^|\/)tests?\//.test(file) || /(^|\/)test_[^/]*$/.test(file) || /\.(?:test|spec)\.[jt]sx?$/.test(file)
}

/** Every file reachable through imports from the seeds, seeds included. */
export function importClosure(seeds: readonly string[], sources: readonly ScopeSource[]): Set<string> {
  const byStem = new Map<string, ScopeSource[]>()
  for (const item of sources) byStem.set(stemOf(item.file), [...(byStem.get(stemOf(item.file)) ?? []), item])
  const seen = new Set<string>(seeds)
  const queue = [...seeds]
  while (queue.length) {
    const next = queue.shift()
    const current = sources.find(item => item.file === next)
    if (!current) continue
    for (const stem of importedStems(current.file, current.text)) {
      for (const reached of byStem.get(stem) ?? []) {
        if (seen.has(reached.file)) continue
        seen.add(reached.file)
        queue.push(reached.file)
      }
    }
  }
  return seen
}

export function scopeOfEdit(input: ScopeInput): ScopeVerdict {
  const { file, finding, sources } = input
  if (!input.rework) return { allowed: true, trace: 'INITIAL_PASS', detail: 'the first implementation pass' }
  if (input.origin === 'COMMANDER') return { allowed: true, trace: 'COMMANDER_INSTRUCTION', detail: 'the Commander asked for this change' }
  const target = sources.find(item => item.file === file)
  const failure = parseFailure(finding)
  const named = sources.filter(item => namesFile(finding, item.file)).map(item => item.file)

  if (input.origin !== 'REVIEW') {
    // Runtime/test evidence. A failing test names where it happened, and the code the failing test goes through is where the fix can be.
    if (named.includes(file)) return { allowed: true, trace: 'FAILING_EVIDENCE', detail: `the failure names ${file}` }
    if (failure.symbol && target && definedNames(target.text).has(failure.symbol)) return { allowed: true, trace: 'FAILING_SYMBOL', detail: `${file} defines ${failure.symbol}, the name the failure is about` }
    const seeds = named.length ? named : sources.filter(item => isTestFile(item.file)).map(item => item.file)
    if (importClosure(seeds, sources).has(file)) return { allowed: true, trace: 'NEEDED_DEPENDENCY', detail: `${file} is reached by the code the failing run goes through` }
    return { allowed: false, trace: 'OUT_OF_SCOPE', detail: `${file} is not named by the failure and the failing run does not go through it` }
  }

  // A review finding that stands is about what was asked: the files that implement it are in scope, the files they merely depend on need a trace of their own.
  if (input.primaryFiles?.includes(file)) return { allowed: true, trace: 'PRIMARY_IMPLEMENTATION', detail: `${file} implements what was asked` }
  if (named.includes(file)) return { allowed: true, trace: 'UNMET_CRITERION', detail: `the finding names ${file}` }
  const tokens = new Set(finding.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [])
  if (target) {
    const hit = [...definedNames(target.text)].find(name => tokens.has(name))
    if (hit) return { allowed: true, trace: 'UNMET_CRITERION', detail: `the finding is about ${hit}, defined in ${file}` }
  }
  return { allowed: false, trace: 'OUT_OF_SCOPE', detail: `${file} is not named by the finding, does not define what it is about, and no failure points there` }
}

/** Plain sentence for the Commander when an edit is refused. */
export function scopeRefusalNote(file: string): string {
  return `I did not change ${file}: nothing that failed or that you asked for points there.`
}
