/**
 * Phase 5 edit forensics (pure: no filesystem, network or clock). What an edit actually did, in words a repairer cannot misread:
 * BEFORE / AFTER / ADDED / REMOVED / MOVED, which parts of it worked, and which unaffected element it accidentally took away.
 *
 * Nothing here knows a library. It reasons about import bindings and the names a file still uses, so "move Markup to another package" and
 * "keep Environment where it was" is the same rule as any other pair of names.
 */

export type Language = 'python' | 'js'

export function languageOf(file: string): Language | null {
  if (/\.pyi?$/i.test(file)) return 'python'
  if (/\.(?:[cm]?[jt]sx?)$/i.test(file)) return 'js'
  return null
}

export type Binding = {
  name: string
  /** The package or module the name comes from ('' for a plain `import x`). */
  module: string
  kind: 'from' | 'import' | 'js-named' | 'js-default' | 'js-namespace'
  /** How the name was written in the import: `Environment`, `foo as bar`. */
  imported: string
}

const PY_FROM = /^([ \t]*)from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm
const PY_IMPORT = /^([ \t]*)import[ \t]+([^\n]+)/gm
const JS_IMPORT = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]\s*;?/g

function splitNames(text: string): string[] {
  return text.replace(/[()]/g, ' ').replace(/#.*$/gm, '').split(',').map(item => item.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

export function importBindings(source: string, lang: Language): Binding[] {
  const out: Binding[] = []
  if (lang === 'python') {
    for (const hit of source.matchAll(PY_FROM)) {
      for (const item of splitNames(hit[3])) {
        if (item === '*') continue
        const alias = /^(\S+)\s+as\s+(\S+)$/.exec(item)
        out.push({ name: alias ? alias[2] : item, module: hit[2], kind: 'from', imported: item })
      }
    }
    for (const hit of source.matchAll(PY_IMPORT)) {
      if (/^\s*from\b/.test(hit[0])) continue
      for (const item of splitNames(hit[2])) {
        const alias = /^(\S+)\s+as\s+(\S+)$/.exec(item)
        out.push({ name: alias ? alias[2] : item.split('.')[0], module: '', kind: 'import', imported: item })
      }
    }
    return out
  }
  for (const hit of source.matchAll(JS_IMPORT)) {
    if (hit[1]) out.push({ name: hit[1], module: hit[4], kind: 'js-default', imported: hit[1] })
    for (const item of splitNames(hit[2] ?? '')) {
      const alias = /^(\S+)\s+as\s+(\S+)$/.exec(item)
      out.push({ name: alias ? alias[2] : item, module: hit[4], kind: 'js-named', imported: item })
    }
    if (hit[3]) out.push({ name: hit[3], module: hit[4], kind: 'js-namespace', imported: `* as ${hit[3]}` })
  }
  return out
}

const STRING_LITERAL = /"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g

/** The source with import statements, comments and string text removed; the expressions inside f-strings and template literals are kept, since they are code. */
function codeOutsideImports(source: string, lang: Language): string {
  let text = source
  if (lang === 'python') text = text.replace(PY_FROM, '').replace(PY_IMPORT, '').replace(/#.*$/gm, '')
  else text = text.replace(JS_IMPORT, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const expressions: string[] = []
  text = text.replace(STRING_LITERAL, literal => {
    for (const hit of literal.matchAll(lang === 'python' ? /\{([^{}]+)\}/g : /\$\{([^{}]+)\}/g)) expressions.push(hit[1])
    return ' '
  })
  return `${text}\n${expressions.join('\n')}`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when the name appears as a name (not as an attribute of something else) in the code. */
export function usesName(source: string, name: string, lang: Language): boolean {
  return new RegExp(`(?<![\\w$.])${escapeRegex(name)}(?![\\w$])`).test(codeOutsideImports(source, lang))
}

/** Names the file itself defines besides its imports: functions, classes, assignments. A name defined here is not missing. */
export function definedNames(source: string, lang: Language): Set<string> {
  const names = new Set<string>()
  for (const binding of importBindings(source, lang)) names.add(binding.name)
  const patterns = lang === 'python'
    ? [/^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/gm, /^[ \t]*class[ \t]+([A-Za-z_]\w*)/gm, /^[ \t]*([A-Za-z_]\w*)[ \t]*(?::[^=\n]+)?=(?!=)/gm, /\bfor[ \t]+([A-Za-z_]\w*)[ \t]+in\b/g, /\bas[ \t]+([A-Za-z_]\w*)[ \t]*[:,)]/g]
    : [/\b(?:function|class|const|let|var)[ \t]+([A-Za-z_$][\w$]*)/g]
  for (const pattern of patterns) for (const hit of source.matchAll(pattern)) names.add(hit[1])
  return names
}

function restorationLine(bindings: Binding[], lang: Language): string {
  const first = bindings[0]
  if (lang === 'python') {
    if (first.kind === 'import') return `import ${first.imported}`
    return `from ${first.module} import ${bindings.map(item => item.imported).join(', ')}`
  }
  if (first.kind === 'js-default') return `import ${first.imported} from '${first.module}'`
  if (first.kind === 'js-namespace') return `import ${first.imported} from '${first.module}'`
  return `import { ${bindings.map(item => item.imported).join(', ')} } from '${first.module}'`
}

export type Preserved = {
  /** The replacement text, with any accidentally removed binding put back. Equal to the input when nothing was lost. */
  after: string
  restored: Binding[]
}

/**
 * A targeted change must leave the unaffected elements alone. When an edit removes an imported name that the file still uses and does not
 * bring it back (under any module), that name is put back, next to the change, from where it was originally imported.
 * `from a import X, Y` -> `from b import Y` becomes `from a import X` + `from b import Y`.
 */
export function preserveUnaffected(input: { file: string; source: string; start: number; end: number; after: string }): Preserved {
  const lang = languageOf(input.file)
  if (!lang) return { after: input.after, restored: [] }
  const { source, start, end } = input
  const next = source.slice(0, start) + input.after + source.slice(end)
  const nextNames = new Set(importBindings(next, lang).map(item => item.name))
  const inSpan = new Set(importBindings(source.slice(start, end), lang).map(item => item.name))
  const defined = definedNames(next, lang)
  const lost = importBindings(source, lang).filter(binding => inSpan.has(binding.name) && !nextNames.has(binding.name) && !defined.has(binding.name) && usesName(next, binding.name, lang))
  if (!lost.length) return { after: input.after, restored: [] }
  const groups = new Map<string, Binding[]>()
  for (const binding of lost) {
    const key = `${binding.kind}|${binding.module}`
    groups.set(key, [...(groups.get(key) ?? []), binding])
  }
  const nl = source.includes('\r\n') ? '\r\n' : '\n'
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const indent = /^[ \t]*$/.test(source.slice(lineStart, start)) ? source.slice(lineStart, start) : ''
  const lines = [...groups.values()].map(group => restorationLine(group, lang))
  const restored = lines.join(nl + indent) + (input.after.trim() ? nl + indent + input.after : '')
  return { after: restored, restored: lost }
}

// ---------------------------------------------------------------- what the edit did

export type EditForensics = {
  file: string
  before: string[]
  after: string[]
  added: string[]
  removed: string[]
  moved: { name: string; from: string; to: string }[]
  /** Names the edit took away that the file still uses. Empty once the preservation guard has run. */
  lost: string[]
  /** Names the guard put back. */
  restored: string[]
}

const shortLines = (text: string): string[] => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 6).map(line => line.slice(0, 160))
const where = (binding: Binding) => (binding.module ? `${binding.name} (from ${binding.module})` : binding.name)

export function forensicsOf(input: { file: string; source: string; start: number; end: number; after: string; restored?: readonly Binding[] }): EditForensics {
  const lang = languageOf(input.file)
  const removedText = input.source.slice(input.start, input.end)
  const empty: EditForensics = { file: input.file, before: shortLines(removedText), after: shortLines(input.after), added: [], removed: [], moved: [], lost: [], restored: (input.restored ?? []).map(item => item.name) }
  if (!lang) return empty
  const was = importBindings(removedText, lang)
  const now = importBindings(input.after, lang)
  const nowNames = new Map(now.map(item => [item.name, item]))
  const wasNames = new Map(was.map(item => [item.name, item]))
  const moved = was.filter(item => nowNames.has(item.name) && nowNames.get(item.name)!.module !== item.module).map(item => ({ name: item.name, from: item.module || 'this file', to: nowNames.get(item.name)!.module || 'this file' }))
  return {
    ...empty,
    added: now.filter(item => !wasNames.has(item.name)).map(where),
    removed: was.filter(item => !nowNames.has(item.name)).map(where),
    moved,
  }
}

/** The words a repairer reads. Every line is labelled so a diff can never be read backwards. */
export function editEvidence(f: EditForensics): string {
  const lines = [`MY LAST EDIT in ${f.file}`, `BEFORE: ${f.before.join(' / ') || '(nothing)'}`, `AFTER: ${f.after.join(' / ') || '(nothing)'}`]
  if (f.added.length) lines.push(`ADDED: ${f.added.join(', ')}`)
  if (f.removed.length) lines.push(`REMOVED: ${f.removed.join(', ')}`)
  if (f.moved.length) lines.push(`MOVED: ${f.moved.map(item => `${item.name} from ${item.from} to ${item.to}`).join(', ')}`)
  if (f.restored.length) lines.push(`KEPT: ${f.restored.join(', ')} stayed where it was because the code still uses it`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- failures, progress and oscillation

export type ParsedFailure = { exception: string | null; symbol: string | null; message: string }

const GENERIC_HEADER = /Failed to import test module/i

/** The exception that actually stopped the code: the last real exception line, never the runner's generic "Failed to import test module" header. */
export function parseFailure(text: string): ParsedFailure {
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const found = lines.filter(line => /^[A-Za-z_][\w.]*(?:Error|Exception)\s*:/.test(line) && !GENERIC_HEADER.test(line))
  const last = found[found.length - 1] ?? lines.find(line => /^[A-Za-z_][\w.]*(?:Error|Exception)\b/.test(line)) ?? ''
  const hit = /^([A-Za-z_][\w.]*)\s*:?\s*(.*)$/.exec(last)
  const message = (hit?.[2] ?? '').slice(0, 200)
  const symbol = /cannot import name ['"]([^'"]+)['"]/.exec(message)?.[1] ?? /name ['"]([^'"]+)['"] is not defined/.exec(message)?.[1] ?? /No module named ['"]([^'"]+)['"]/.exec(message)?.[1] ?? /has no attribute ['"]([^'"]+)['"]/.exec(message)?.[1] ?? null
  return { exception: hit ? hit[1].split('.').pop() ?? null : null, symbol, message }
}

/** A stable name for a failure: what was raised and about which name. Two failures with the same identity are the same problem. */
export function failureIdentity(text: string): string {
  const parsed = parseFailure(text)
  if (!parsed.exception) return ''
  return `${parsed.exception}:${parsed.symbol ?? parsed.message.replace(/\s+/g, ' ').replace(/\(.*$/, '').slice(0, 80)}`
}

export type EditOutcome =
  | { kind: 'PARTIAL_PROGRESS'; kept: string; broke: string }
  | { kind: 'NO_EFFECT' }
  | { kind: 'CHANGED' }
  | { kind: 'UNKNOWN' }

/**
 * What the last edit achieved, from the failure before it, the failure after it and what it changed. The failure it was meant to fix is gone and a new one
 * names something the edit removed: that is partial progress, and the good part stays.
 */
export function classifyEditOutcome(input: { previous: string; current: string; forensics: EditForensics | null }): EditOutcome {
  const before = parseFailure(input.previous)
  const now = parseFailure(input.current)
  if (!before.exception || !now.exception) return { kind: 'UNKNOWN' }
  if (failureIdentity(input.previous) === failureIdentity(input.current)) return { kind: 'NO_EFFECT' }
  const f = input.forensics
  if (f && before.symbol && now.symbol && before.symbol !== now.symbol) {
    const addressed = f.moved.some(item => item.name === before.symbol) || f.added.some(item => item.startsWith(before.symbol!))
    const removedNow = f.removed.some(item => item.startsWith(now.symbol!))
    if (addressed && removedNow) return { kind: 'PARTIAL_PROGRESS', kept: before.symbol, broke: now.symbol }
  }
  return { kind: 'CHANGED' }
}

export const TRAIL_LIMIT = 6

export function pushTrail(trail: readonly string[] | undefined, identity: string): string[] {
  if (!identity) return [...(trail ?? [])]
  const list = [...(trail ?? [])]
  if (list[list.length - 1] === identity) return list
  return [...list, identity].slice(-TRAIL_LIMIT)
}

/** A, then B, then A again: the change is bouncing between two broken states instead of fixing either. */
export function isOscillating(trail: readonly string[]): boolean {
  const n = trail.length
  return n >= 3 && trail[n - 1] === trail[n - 3] && trail[n - 1] !== trail[n - 2]
}

export type ProgressEdit = { file: string; start: number; end: number; before: string; after: string; fixed: string; broke: string }

/**
 * Bouncing back to the first failure means the file went back to its old state. The change that had fixed that first failure is applied again,
 * this time with the unaffected elements kept, so the verified-good part is not thrown away with the regression.
 */
export function recoverProgress(input: { file: string; current: string; progress: ProgressEdit }): { content: string; restored: string[] } | null {
  const { progress, current } = input
  if (current.slice(progress.start, progress.end) !== progress.before) return null
  const kept = preserveUnaffected({ file: input.file, source: current, start: progress.start, end: progress.end, after: progress.after })
  if (kept.after === progress.before) return null
  return { content: current.slice(0, progress.start) + kept.after + current.slice(progress.end), restored: kept.restored.map(item => item.name) }
}

// ---------------------------------------------------------------- reading an assertion failure the right way round

export type AssertionReading = { actual: string; expected: string }

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) { current += ch; if (ch === '\\') { current += text[i + 1] ?? ''; i += 1 } else if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if ('([{'.includes(ch)) depth += 1
    if (')]}'.includes(ch)) depth -= 1
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const LITERAL = /^(?:[rbfRBF]{0,2}(["'])(?:\\.|(?!\1).)*\1|-?\d[\d_.eE+-]*|True|False|None|\[[^()]*\]|\{[^()]*\}|\([^()]*\))$/

/**
 * `assertEqual(first, second)` fails as `AssertionError: 'first' != 'second'`. Which side the code produced is not written in the message; it is in the assert line:
 * the argument that is a plain literal is what the test expects, the other is what the code produced. Stated outright, a repairer cannot read it backwards.
 */
export function readAssertion(text: string): AssertionReading | null {
  const message = /AssertionError:\s*(.+?)\s*!=\s*(.+?)\s*$/m.exec(text)
  const call = /\.assertEqual\((.*)\)\s*$/m.exec(text)
  if (!message || !call) return null
  const args = splitTopLevel(call[1])
  if (args.length < 2) return null
  const firstLiteral = LITERAL.test(args[0])
  const secondLiteral = LITERAL.test(args[1])
  if (firstLiteral === secondLiteral) return null
  return firstLiteral ? { actual: message[2], expected: message[1] } : { actual: message[1], expected: message[2] }
}

export function assertionSentence(reading: AssertionReading): string {
  return `WHAT THE TEST COMPARES: the code produced ${reading.actual.slice(0, 120)} but the test expects ${reading.expected.slice(0, 120)}. Change the code so it produces the expected value; never change what the test expects.`
}

// ---------------------------------------------------------------- where the first edit goes

/**
 * The first edit belongs where the failing run points, not where the request's words match best. `frames` are `file:function` entries from the failure, outermost
 * first; the innermost project frame that is not a test comes to the front of the working set. Files not in the set are not added, and a set without one of them
 * is left exactly as it was.
 */
export function failureFirst(workingSet: readonly string[], frames: readonly string[] | undefined): string[] {
  const order = [...(frames ?? [])].reverse().map(item => item.split(':')[0]).filter(file => file && !/^tests?\//.test(file) && !/(^|\/)test_[^/]*$/.test(file))
  const target = order.find(file => workingSet.includes(file))
  if (!target || workingSet[0] === target) return [...workingSet]
  return [target, ...workingSet.filter(file => file !== target)]
}
