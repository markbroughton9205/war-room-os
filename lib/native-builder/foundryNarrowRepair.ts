/**
 * Narrow, diagnostic-driven repair of an existing TypeScript file.
 *
 * Whole-file rewrites do not converge with a small local model: it copies the file back. Here the executive does the orchestration - it runs the
 * authoritative diagnostics, picks ONE diagnostic (or one tightly related cluster), shows the model only the affected window plus the directly
 * relevant definitions, and accepts the model's single bounded line patch only if the diagnostics get better. Everything is deterministic except
 * the one bounded edit. Generic: nothing in here knows about any particular feature.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'

export type Diag = { file: string; line: number; col: number; code: string; message: string; syntactic: boolean }

/** A diagnostic + source digest that already got this many unproductive tries is not retried the same way again. */
export const MAX_TRIES_PER_TARGET = 2
export const MAX_PATCH_SPAN_LINES = 40
export const MAX_REPLACEMENT_LINES = 80
export const MAX_FRAGMENT_LINES = 20
const MAX_CLUSTER = 4

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)
const normalizeMessage = (message: string) => message.replace(/\s+/g, ' ').trim()

/* ------------------------------------------------ authoritative diagnostics ------------------------------------------------ */

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, 'tsconfig.json')
  const base: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, allowImportingTsExtensions: true }
  if (!existsSync(configPath)) return base
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, root)
  return { ...parsed.options, noEmit: true, incremental: false, skipLibCheck: true, plugins: undefined, tsBuildInfoFile: undefined }
}

/**
 * The compiler's own diagnostics for one file, in-process (parse + full type check of the file against its import graph). `overlay` substitutes
 * candidate text for files without touching disk: that is the preflight.
 */
export function diagnoseFile(root: string, file: string, overlay: Record<string, string> = {}): Diag[] {
  const options = compilerOptions(root)
  const host = ts.createCompilerHost(options, true)
  const abs = (rel: string) => path.join(root, rel)
  const overlays = new Map(Object.entries(overlay).map(([rel, text]) => [abs(rel), text]))
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => overlays.has(name)
    ? ts.createSourceFile(name, overlays.get(name)!, languageVersion, true)
    : getSourceFile(name, languageVersion, onError, shouldCreate)
  const readFile = host.readFile.bind(host)
  host.readFile = name => overlays.get(name) ?? readFile(name)
  const rootNames = [abs(file), ...['next-env.d.ts'].map(abs).filter(item => existsSync(item))]
  const program = ts.createProgram({ rootNames, options, host })
  const source = program.getSourceFile(abs(file))
  if (!source) return []
  const syntactic = new Set<ts.Diagnostic>(program.getSyntacticDiagnostics(source))
  return [...syntactic, ...program.getSemanticDiagnostics(source)]
    .filter(item => item.category === ts.DiagnosticCategory.Error && item.start !== undefined)
    .map(item => {
      const at = source.getLineAndCharacterOfPosition(item.start!)
      return { file, line: at.line + 1, col: at.character + 1, code: `TS${item.code}`, message: normalizeMessage(ts.flattenDiagnosticMessageText(item.messageText, ' ')), syntactic: syntactic.has(item) }
    })
    .sort(compareDiags)
}

/** CJK / full-width characters: never legitimate inside this repository's identifiers, and what a sampled-too-hot local model leaks into code. */
const STRAY_CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/g
export const strayCharacterCount = (text: string): number => (text.match(STRAY_CJK) ?? []).length
/** A write to a source file may not add stray CJK characters that the file did not already have. */
export function introducesStrayCharacters(fileName: string, before: string, after: string): boolean {
  return /\.(?:tsx?|mjs|cjs|jsx?)$/.test(fileName) && strayCharacterCount(after) > strayCharacterCount(before)
}

/** Number of syntax errors in a source text (parse only). A write may never raise it. */
export function syntaxErrorCount(fileName: string, text: string): number {
  if (!/\.(?:tsx?|mjs|jsx?)$/.test(fileName)) return 0
  const result = ts.transpileModule(text, { reportDiagnostics: true, fileName, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 } })
  return (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length
}

/** ESLint errors for a file (or for candidate text via stdin, so nothing touches disk). Only when the repo has an ESLint config. */
export function lintDiagnose(root: string, file: string, overlay: Record<string, string> = {}): Diag[] {
  if (!['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts'].some(name => existsSync(path.join(root, name)))) return []
  const bin = path.join(root, 'node_modules', '.bin', 'eslint')
  if (!existsSync(bin)) return []
  const text = overlay[file] ?? readFileSync(path.join(root, file), 'utf8')
  const run = spawnSync(bin, ['--stdin', '--stdin-filename', file, '-f', 'json'], { cwd: root, input: text, encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024 })
  try {
    const parsed = JSON.parse(run.stdout) as Array<{ messages: Array<{ line?: number; column?: number; ruleId: string | null; message: string; severity: number; fatal?: boolean }> }>
    return (parsed[0]?.messages ?? []).filter(item => item.severity === 2).map(item => ({ file, line: item.line ?? 1, col: item.column ?? 1, code: `eslint:${item.ruleId ?? 'parse'}`, message: normalizeMessage(item.message), syntactic: Boolean(item.fatal) })).sort(compareDiags)
  } catch { return [] }
}

/**
 * A stub that satisfies the type checker by deleting data: `tasks: []` (or `{}` / '' / null) where a local variable of the same name, holding the real value,
 * is declared in the same function and never used. Reported as an error so it can neither be introduced by a repair nor left in a "clean" file.
 */
export function stubDiagnose(file: string, text: string): Diag[] {
  if (!/\.tsx?$/.test(file)) return []
  const sf = parseSource(text, file)
  const out: Diag[] = []
  const isEmpty = (node: ts.Expression) => (ts.isArrayLiteralExpression(node) && node.elements.length === 0) || (ts.isObjectLiteralExpression(node) && node.properties.length === 0) || (ts.isStringLiteral(node) && node.text === '') || node.kind === ts.SyntaxKind.NullKeyword
  const functionOf = (node: ts.Node): ts.Node => { let cur: ts.Node | undefined = node.parent; while (cur && !ts.isFunctionLike(cur)) cur = cur.parent; return cur ?? sf }
  const references = (scope: ts.Node, name: string, declaration: ts.Node): number => {
    let count = 0
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === name && node !== declaration) {
        const parent = node.parent
        const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isPropertySignature(parent) && parent.name === node)
        if (!isMemberName) count += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(scope)
    return count
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isEmpty(node.initializer)) {
      const name = node.name.text
      const scope = functionOf(node)
      let declared: ts.VariableDeclaration | null = null
      const find = (inner: ts.Node) => { if (ts.isVariableDeclaration(inner) && ts.isIdentifier(inner.name) && inner.name.text === name && inner.initializer && inner.getStart(sf) < node.getStart(sf)) declared = inner; if (inner !== scope && ts.isFunctionLike(inner)) return; ts.forEachChild(inner, find) }
      find(scope)
      const hit = declared as ts.VariableDeclaration | null
      if (hit && references(scope, name, hit.name) === 0) {
        const at = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const declLine = sf.getLineAndCharacterOfPosition(hit.getStart(sf)).line + 1
        out.push({ file, line: at.line + 1, col: at.character + 1, code: 'stub:EMPTY_VALUE', message: `property '${name}' is set to an empty literal, but the variable '${name}' (line ${declLine}) holds the real value and is never used: the data is being dropped to satisfy the type`, syntactic: false })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * A value-style import of a name that is only a TYPE (`import { McInput } from './types'` where McInput is `export type`): tsc accepts it, but the project's node runner
 * (type stripping, no cross-file analysis) cannot erase it and the module fails to load at runtime. Scoped to lib/ modules, which validators load directly.
 */
export function typeOnlyImportDiagnose(root: string, file: string, source: string): Diag[] {
  if (!/^lib\/.+\.tsx?$/.test(file)) return []
  const sf = parseSource(source, file)
  const out: Diag[] = []
  for (const decl of sf.statements.filter(ts.isImportDeclaration)) {
    const clause = decl.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || !ts.isStringLiteral(decl.moduleSpecifier)) continue
    const spec = decl.moduleSpecifier.text
    const resolved = resolveImport(root, file, spec)
    if (!resolved) continue
    let text = ''
    try { text = readFileSync(path.join(root, resolved), 'utf8') } catch { continue }
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue
      const imported = (element.propertyName ?? element.name).text
      if (exportKind(text, imported) !== 'type') continue
      const at = sf.getLineAndCharacterOfPosition(element.name.getStart(sf))
      out.push({ file, line: at.line + 1, col: at.character + 1, code: 'import:TYPE_ONLY', message: `'${imported}' is only a type in '${spec}': import it as a type (\`type ${element.getText(sf)}\` inside the braces, or \`import type\`). The node runner cannot erase a value-style import of a type and the module fails to load.`, syntactic: false })
    }
  }
  return out
}

const runtimeCache = new Map<string, Diag[]>()
const isValidatorFile = (file: string) => /^lib\/.+\.validation\.tsx?$/.test(file)
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

/** Run a validator with the project's node runner, optionally against candidate versions of other files (loader overlay). Null when the runner is not available. */
function runValidator(root: string, validatorAbs: string, overlay: Record<string, string> = {}): { status: number | null; output: string } | null {
  const loader = path.join(root, 'scripts', 'ts-extension-loader.mjs')
  if (!existsSync(loader)) return null
  // Opaque to static analysis: Turbopack reads a literal node argument list as a script to bundle, tries to resolve '--loader' as a module and fails the production build.
  const nodeArgs: string[] = JSON.parse(JSON.stringify(['--loader', loader, '--experimental-transform-types', validatorAbs]))
  const run = spawnSync('node', nodeArgs, { cwd: root, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NODE_NO_WARNINGS: '1', ...(Object.keys(overlay).length ? { FOUNDRY_OVERLAY: JSON.stringify(overlay) } : {}) } })
  return { status: run.status, output: stripAnsi(`${run.stderr ?? ''}\n${run.stdout ?? ''}`) }
}

/** Every repository file a module reaches through relative imports (bounded), including itself. */
export function importClosure(root: string, start: string): Set<string> {
  const seen = new Set<string>()
  const walk = (current: string, depth: number) => {
    if (seen.has(current) || depth > 6 || seen.size > 80) return
    seen.add(current)
    let text = ''
    try { text = readFileSync(path.join(root, current), 'utf8') } catch { return }
    for (const match of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) { const next = resolveImport(root, current, match[1]); if (next) walk(next, depth + 1) }
  }
  walk(start, 0)
  return seen
}

/** Validators in the same directory whose (relative) import closure reaches `file`: the ones that exercise it. Best name match first. */
export function linkedValidators(root: string, file: string): string[] {
  const dir = path.posix.dirname(file)
  let names: string[] = []
  try { names = readdirSync(path.join(root, dir)).filter(name => /\.validation\.tsx?$/.test(name)) } catch { return [] }
  const closureOf = (start: string) => importClosure(root, start)
  const common = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }
  return names.map(name => path.posix.join(dir, name)).filter(item => item !== file && closureOf(item).has(file)).sort((x, y) => common(path.posix.basename(y), path.posix.basename(file)) - common(path.posix.basename(x), path.posix.basename(file)))
}

/** What a failing validator run says: where it failed, and whether the blame is on the validator (a wrong expectation) or on the code under test (a broken value, or a throw inside it). */
export function analyzeValidatorFailure(output: string, copyBase: string, root: string): { gap: string; line: number; col: number; message: string; implementation: boolean; frameFile: string | null; frameLine: number } {
  const frame = new RegExp(`${copyBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`).exec(output)
  const lines = output.split('\n').map(line => line.trimEnd())
  const start = lines.findIndex(line => /\b\w*Error\b/.test(line) && !/^\s*at /.test(line))
  const body = lines.slice(Math.max(0, start), Math.max(0, start) + 8).filter(line => line.trim() && !/^\s*at /.test(line) && !/^\s*\^+\s*$/.test(line))
  const message = normalizeMessage(body.slice(0, 6).join(' ')).slice(0, 420)
  // Node prints a primitive mismatch on one line (`'NaN' !== '129'`) and an object mismatch as a `+ actual - expected` diff.
  const pair = /strictly equal:\s*(.+?)\s+!==\s+(.+)$/.exec(normalizeMessage(body.join(' ')))
  const diffLines = body.filter(line => !/^\+\s+actual\s+-\s+expected/.test(line.trim()))
  const actual = pair ? pair[1] : (diffLines.find(line => /^\+\s/.test(line.trim())) ?? '')
  const expected = pair ? pair[2] : diffLines.filter(line => /^-\s/.test(line.trim())).join(' ')
  // a throw inside the code under test: the first stack frame that is a repository source file other than the validator copy
  const implFrame = [...output.matchAll(/\(?(\/[^\s():]+\.tsx?):(\d+):(\d+)\)?/g)].map(match => ({ abs: match[1], line: Number(match[2]) })).find(item => !item.abs.includes('.candidate-') && !/\.validation\.tsx?$/.test(item.abs) && item.abs.startsWith(root) && !item.abs.includes('node_modules'))
  const brokenValue = /NaN|undefined|\[object Object\]|\bnull\b/.test(actual) && !/NaN|undefined|null/.test(expected)
  const thrownInside = /\b(TypeError|ReferenceError|RangeError)\b/.test(output) && Boolean(implFrame)
  // The code under test produced only PART of the required text (`'credentials missing'` where `'Commander decision required: credentials missing'` is expected): its output is incomplete.
  const unquote = (text: string) => text.trim().replace(/^[+-]\s*/, '').replace(/^['"`]|['"`]$/g, '')
  const partialOutput = unquote(actual).length >= 3 && unquote(expected).length > unquote(actual).length && unquote(expected).includes(unquote(actual))
  // What exactly is missing: the text before and after the produced part inside the required text.
  const gap = (() => {
    if (!partialOutput) return ''
    const want = unquote(expected)
    const have = unquote(actual)
    const at = want.indexOf(have)
    const before = want.slice(0, at)
    const after = want.slice(at + have.length)
    return `The code produces '${have}' but the required text is '${want}': ${before ? `it is missing the prefix '${before}'` : ''}${before && after ? ' and ' : ''}${after ? `it is missing the suffix '${after}'` : ''}.`
  })()
  return { gap, line: frame ? Number(frame[1]) : 1, col: frame ? Number(frame[2]) : 1, message: message || 'the validator failed', implementation: brokenValue || thrownInside || partialOutput, frameFile: implFrame ? path.relative(root, implFrame.abs).split(path.sep).join('/') : null, frameLine: implFrame?.line ?? 1 }
}

/** Which implementation file defines the field the failing assertion reads (`.elapsed` -> the file with `elapsed:`), and the first line that defines it. */
function implicatedDefinition(root: string, validatorFile: string, failingLine: string): { file: string; line: number } | null {
  const fields = [...failingLine.matchAll(/\.([A-Za-z_$][\w$]*)/g)].map(item => item[1]).filter(name => !/^(equal|ok|deepEqual|strictEqual|includes|some|every|length|map|filter|find|endsWith|startsWith)$/.test(name))
  if (!fields.length) return null
  // Only what the validator actually imports can be the code under test (a whole directory has many unrelated `elapsed:` definitions).
  const reachable = [...importClosure(root, validatorFile)].filter(item => item !== validatorFile && !/\.(validation|proof|test|spec)\.tsx?$/.test(item) && !item.includes('.candidate-'))
  for (const field of [...fields].reverse()) {
    const hits = reachable.map(item => { try { const text = readFileSync(path.join(root, item), 'utf8'); const index = text.split('\n').findIndex(line => new RegExp(`\\b${field}\\s*:`).test(line)); return index >= 0 ? { file: item, line: index + 1 } : null } catch { return null } }).filter((item): item is { file: string; line: number } => Boolean(item))
    if (hits.length === 1) return hits[0]
    // A type-declaration file defines the field's TYPE, never its wrong value; of the rest, the files that contain logic are the candidates.
    const logic = hits.filter(item => !/Types?\.tsx?$/.test(item.file)).filter(item => { try { return /\bfunction\b|=>/.test(readFileSync(path.join(root, item.file), 'utf8')) } catch { return false } })
    if (logic.length === 1) return logic[0]
  }
  return null
}

/**
 * A validator that compiles can still fail when it runs. A clean `lib/**\/*.validation.ts` is executed with the project's node runner (a transient copy of the candidate text,
 * removed afterwards). The failure is blamed where it belongs: a wrong expectation is an error in the validator at the failing line; a broken value (NaN, undefined, [object Object])
 * or a throw inside the code under test is an error in the implementation file that defines the field, found by running the linked validator against the candidate text of that
 * file (loader overlay, the repository is never touched). Results are cached by content: the same text is never run twice.
 */
export function runtimeDiagnose(root: string, file: string, source: string): Diag[] {
  if (!/^lib\/.+\.tsx?$/.test(file)) return []
  const validator = isValidatorFile(file)
  const linked = validator ? [] : linkedValidators(root, file).slice(0, 1)
  if (!validator && !linked.length) return []
  const linkedText = linked[0] ? (() => { try { return readFileSync(path.join(root, linked[0]), 'utf8') } catch { return '' } })() : ''
  const key = sha(`${file}\n${source}\n${linkedText}`)
  const cached = runtimeCache.get(key)
  if (cached) return cached
  const abs = path.join(root, file)
  const copy = path.join(path.dirname(abs), `${path.basename(file).replace(/\.tsx?$/, '')}.candidate-${key}.ts`)
  let result: Diag[] = []
  try {
    writeFileSync(copy, source)
    const run = validator ? runValidator(root, copy) : runValidator(root, path.join(root, linked[0]), { [abs]: copy })
    if (run && run.status !== 0) {
      // Frames inside the candidate copy of an implementation file belong to that file; the failing line to read is the validator's own.
      const output = validator ? run.output : run.output.split(copy).join(abs)
      const analysis = analyzeValidatorFailure(output, path.basename(validator ? copy : linked[0]), root)
      const failingLine = validator ? (source.split('\n')[analysis.line - 1] ?? '') : (linkedText.split('\n')[analysis.line - 1] ?? '')
      if (validator) {
        const blamed = analysis.implementation ? (analysis.frameFile && !isValidatorFile(analysis.frameFile) ? { file: analysis.frameFile, line: analysis.frameLine } : implicatedDefinition(root, file, failingLine)) : null
        // The implementation is to blame: the validator is right, and the diagnostic belongs to the file that must change.
        if (!blamed) result = [{ file, line: analysis.line, col: analysis.col, code: 'runtime:FAILURE', message: analysis.message, syntactic: false }]
      } else {
        const blamed = analysis.implementation ? (analysis.frameFile && !isValidatorFile(analysis.frameFile) ? { file: analysis.frameFile, line: analysis.frameLine } : implicatedDefinition(root, linked[0], failingLine)) : null
        if (blamed && blamed.file === file) result = [{ file, line: blamed.line, col: 1, code: 'runtime:FAILURE', message: `${analysis.gap ? `${analysis.gap} ` : ''}The validator ${linked[0]} fails against this file (${analysis.message}); the expectation is right, this file's value is wrong.`.trim(), syntactic: false }]
      }
    }
  } catch { result = [] } finally { rmSync(copy, { force: true }) }
  runtimeCache.set(key, result)
  return result
}

/** The authoritative diagnostics for repair: compiler errors plus lint errors plus dropped-data stubs plus runtime-breaking type imports plus (for a clean validator) its first runtime failure. */
export function diagnoseAll(root: string, file: string, overlay: Record<string, string> = {}): Diag[] {
  let text = overlay[file]
  if (text === undefined) { try { text = readFileSync(path.join(root, file), 'utf8') } catch { text = '' } }
  const static_ = [...diagnoseFile(root, file, overlay), ...lintDiagnose(root, file, overlay), ...stubDiagnose(file, text), ...typeOnlyImportDiagnose(root, file, text)]
  // A validator is only run once it is otherwise clean: a file that does not compile fails for a reason the compiler already reports.
  return [...static_, ...(static_.length === 0 ? runtimeDiagnose(root, file, text) : [])].sort(compareDiags)
}

/** Deterministic order: position first, then code, then message. */
export function compareDiags(a: Diag, b: Diag): number {
  return a.line - b.line || a.col - b.col || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
}

/* ------------------------------------------------ persisted stagnation ledger ------------------------------------------------ */

type Try = { kind: 'ACCEPTED' | 'REJECTED' | 'NO_CHANGE'; candidate: string; at: string }
export type RepairLedger = { file: string; tries: Record<string, Try[]>; trail: number[]; /** Why the last narrow edit for a diagnostic (by identity, not by code digest) was rejected: shown to the wider retry. */ notes?: Record<string, string> }

let ledgerRootOverride: string | null = null
export function setNarrowRepairLedgerRootForTests(root: string | null): void { ledgerRootOverride = root }

function ledgerPath(file: string): string {
  const dir = ledgerRootOverride ?? path.join(foundryDataHierarchy().foundryRoot, 'narrow-repair')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${sha(file)}.json`)
}

/** Survives process restarts: the ledger is a file, keyed by repaired file, with every entry bound to a diagnostic and a source digest. */
export function loadLedger(file: string): RepairLedger {
  try { return JSON.parse(readFileSync(ledgerPath(file), 'utf8')) as RepairLedger } catch { return { file, tries: {}, trail: [] } }
}
/** Forget the tries recorded for a file (it is being regenerated: its old code context no longer exists). */
export function clearNarrowRepairLedger(file: string): void { try { rmSync(ledgerPath(file), { force: true }) } catch { /* nothing recorded */ } }
function saveLedger(ledger: RepairLedger): void { writeFileSync(ledgerPath(ledger.file), JSON.stringify(ledger, null, 1)) }

export const diagnosticIdentity = (diag: Diag, lineText: string) => sha(`${diag.code}|${diag.message}|${lineText.trim()}`)
const targetKey = (diag: Diag, lineText: string, digest: string) => `${sha(`${diag.code}|${diag.message}|${lineText.trim()}`)}@${digest}`
export const sourceDigest = (text: string) => sha(text)

/**
 * What the model would see for a diagnostic: its outermost enclosing statement (within the span limit) and the declarations of the names it uses.
 * Stagnation is keyed on this, not on the whole file: an accepted patch somewhere else must not reopen a diagnostic whose surroundings are unchanged.
 */
export function localDigest(source: string, line: number): string {
  const lines = source.split('\n')
  const chain = statementChain(source, line).filter(item => item.end - item.start + 1 <= MAX_PATCH_SPAN_LINES)
  const outer = chain[chain.length - 1] ?? { start: line, end: line }
  const parts = [lines.slice(outer.start - 1, outer.end).join('\n'), ...localDeclarations(source, line).map(item => lines.slice(item.start - 1, item.end).join('\n'))]
  return sha(parts.join('\n--\n'))
}

/* ------------------------------------------------ choosing the one thing to repair ------------------------------------------------ */

export type RepairTarget = { target: Diag; cluster: Diag[]; key: string; attempt: number; lineText: string; cause: RootCause | null }

/** Diagnostics that are usually the downstream echo of an upstream defect: patched only after every other diagnostic is gone. */
const isDownstream = (diag: Diag) => diag.code === 'TS2322'
/** Root causes whose narrow range can be insufficient: they get one wider statement-level retry. */
const ESCALATING = new Set(['TOKEN_FIX', 'PROPERTY_EXPRESSION', 'MEMBER_ACCESS', 'VALUE_SHAPE'])

/**
 * ONE diagnostic, or the few that clearly share a cause: identical code+message (one missing property reported many times) or the same line.
 * Unrelated errors are never grouped to save a turn. A target whose (diagnostic, source digest) already had MAX_TRIES unproductive tries is skipped.
 * Order: a missing name that a sibling module exports first (cheapest, deterministic), then the rest by position; downstream-prone diagnostics
 * wait until nothing else remains, and are never reached past an upstream diagnostic that is stuck.
 * `resolve` maps a diagnostic to its root cause (writable range elsewhere), which then also becomes part of the stagnation key.
 */
export function selectTarget(diags: Diag[], source: string, ledger: RepairLedger, resolve: (diag: Diag, full: boolean) => RootCause | null = () => null): RepairTarget | null {
  const lines = source.split('\n')
  // Cheap (syntax/file based) causes rank every diagnostic; the type-checker based ones are computed only for the target actually being considered.
  const causes = new Map<Diag, RootCause | null>(diags.map(diag => [diag, resolve(diag, false)]))
  const rank = (diag: Diag) => causes.get(diag)?.kind === 'IMPORT' ? 0 : isDownstream(diag) ? 2 : 1
  const sorted = [...diags].sort((a, b) => rank(a) - rank(b) || compareDiags(a, b))
  const upstream = sorted.filter(diag => rank(diag) < 2)
  const eligible = upstream.length ? upstream : sorted
  for (const target of eligible) {
    const lineText = lines[target.line - 1] ?? ''
    if (!causes.get(target)) causes.set(target, resolve(target, true))
    // Escalation ladder: a compiler-named token or a single property expression may be only half the fix (the suggestion can be right for the name and
    // wrong for the type). After its bounded tries fail, the diagnostic is retried once at the statement the compiler points at, with no narrower range.
    for (const cause of [causes.get(target) ?? null, ...(ESCALATING.has(causes.get(target)?.kind ?? '') ? [null] : [])]) {
      const digest = localDigest(source, target.line) + (cause ? `+${sha(lines.slice(cause.range.start - 1, cause.range.end).join('\n'))}` : '')
      const key = targetKey(target, lineText, digest) + (cause === null && causes.get(target) ? '#statement' : '')
      const attempt = (ledger.tries[key] ?? []).filter(item => item.kind !== 'ACCEPTED').length
      const fallback = cause === null && causes.get(target) !== null && causes.get(target) !== undefined
      if (attempt >= (fallback || (cause && ESCALATING.has(cause.kind)) ? 1 : MAX_TRIES_PER_TARGET)) continue
      const cluster = sorted.filter(other => other !== target && ((other.code === target.code && other.message === target.message) || other.line === target.line)).slice(0, MAX_CLUSTER - 1)
      // The statement-level fallback starts from the statement the compiler points at (attempt 0 range rules); its own key bounds it to one try.
      return { target, cluster, key, attempt: fallback ? 0 : attempt, lineText, cause }
    }
  }
  return null
}

/* ------------------------------------------------ the bounded context the model sees ------------------------------------------------ */

const DEFINITION = (name: string) => new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:type|interface|function|class|const|enum)\\s+${name}\\b`, 'm')

function resolveImport(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? spec.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(path.join(root, candidate)) && /\.tsx?$/.test(candidate)) return candidate
  return null
}

/** The declaration of `name` in `text`, brace-matched, capped. */
function definitionOf(text: string, name: string, cap = 3_200): string | null {
  const match = DEFINITION(name).exec(text)
  if (!match) return null
  const start = match.index
  let depth = 0
  let seen = false
  for (let i = start; i < Math.min(text.length, start + cap); i++) {
    const ch = text[i]
    if (ch === '{' || ch === '(') { depth += 1; seen = true }
    else if (ch === '}' || ch === ')') { depth -= 1; if (seen && depth <= 0 && /[}]/.test(ch)) return text.slice(start, i + 1) }
    else if (ch === ';' && !seen) return text.slice(start, i + 1)
  }
  return text.slice(start, start + cap)
}

/** Only what the diagnostic points at: types named in its message, and imported names used on the affected lines. */
export function relevantReferences(root: string, file: string, source: string, window: { start: number; end: number }, cluster: Diag[]): string {
  const lines = source.split('\n')
  const windowText = lines.slice(window.start - 1, window.end).join('\n')
  const named = new Set<string>()
  for (const diag of cluster) for (const match of diag.message.matchAll(/'([A-Za-z_]\w*)'/g)) if (/^[A-Z]/.test(match[1])) named.add(match[1])
  const imported = new Map<string, string>()
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveImport(root, file, match[2])
    if (!target) continue
    for (const part of match[1].split(',')) { const name = part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, ''); if (name) imported.set(name, target) }
  }
  const wanted = new Set([...named, ...[...imported.keys()].filter(name => new RegExp(`\\b${name}\\b`).test(windowText))])
  const out: string[] = []
  for (const name of wanted) {
    const owners = imported.has(name) ? [imported.get(name)!] : [file, ...new Set(imported.values())]
    for (const owner of owners) {
      let text = ''
      try { text = owner === file ? source : readFileSync(path.join(root, owner), 'utf8') } catch { continue }
      const def = definitionOf(text, name)
      if (def) { out.push(`// ${owner} (READ-ONLY: never edit this)\n${def}`); break }
    }
  }
  return out.join('\n\n').slice(0, 5_000)
}

export type NarrowContext = { file: string; target: RepairTarget; window: { start: number; end: number }; patchRange: { start: number; end: number }; text: string; remaining: number }

export function windowFor(target: RepairTarget, totalLines: number): { start: number; end: number } {
  const radius = target.attempt === 0 ? 5 : 12
  const lines = [target.target, ...target.cluster].map(item => item.line)
  const start = Math.max(1, Math.min(...lines) - radius)
  const end = Math.min(totalLines, Math.max(...lines) + radius)
  return { start, end: Math.min(end, start + MAX_PATCH_SPAN_LINES - 1) }
}

/**
 * The complete statements that contain a line, deepest first (blocks excluded). A patch must replace whole syntactic units: a single line inside
 * a multi-line expression can never be valid on its own.
 */
export function statementChain(source: string, line: number): Array<{ start: number; end: number }> {
  const file = ts.createSourceFile('unit.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const lineStart = file.getPositionOfLineAndCharacter(line - 1, 0)
  const text = source.split('\n')[line - 1] ?? ''
  const pos = lineStart + (text.length - text.trimStart().length)
  const chain: Array<{ start: number; end: number }> = []
  const visit = (node: ts.Node) => {
    if (pos < node.getStart(file) || pos >= node.getEnd()) return
    // A braced JSX expression (`{items.map(item => (...))}`) is a complete unit inside a component's return: without it the only enclosing unit is the whole return.
    if ((ts.isStatement(node) && !ts.isBlock(node)) || (ts.isJsxExpression(node) && node.expression)) chain.unshift({ start: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, end: file.getLineAndCharacterOfPosition(node.getEnd()).line + 1 })
    ts.forEachChild(node, visit)
  }
  visit(file)
  return chain.filter((item, index) => chain.findIndex(other => other.start === item.start && other.end === item.end) === index)
}

/**
 * Where the names used on a line are declared inside the same function: the use site is where the compiler complains, the declaration is often
 * where the cause is. Deterministic (syntax only), nearest first, bounded.
 */
export function localDeclarations(source: string, line: number): Array<{ name: string; start: number; end: number }> {
  const file = ts.createSourceFile('unit.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const lineStart = file.getPositionOfLineAndCharacter(line - 1, 0)
  const text = source.split('\n')[line - 1] ?? ''
  const pos = lineStart + (text.length - text.trimStart().length)
  let fn: ts.Node = file
  let statement: ts.Node | null = null
  const find = (node: ts.Node) => {
    if (pos < node.getStart(file) || pos >= node.getEnd()) return
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node) || ts.isArrowFunction(node) && ts.isBlock(node.body)) fn = node
    if (ts.isStatement(node) && !ts.isBlock(node)) statement = node
    ts.forEachChild(node, find)
  }
  find(file)
  if (!statement) return []
  const used = new Set<string>()
  const collect = (node: ts.Node) => { if (ts.isIdentifier(node)) used.add(node.text); ts.forEachChild(node, collect) }
  collect(statement)
  const out: Array<{ name: string; start: number; end: number; at: number }> = []
  const scan = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.getStart(file) < pos && node !== statement) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && used.has(declaration.name.text)) {
          out.push({ name: declaration.name.text, start: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, end: file.getLineAndCharacterOfPosition(node.getEnd()).line + 1, at: node.getStart(file) })
        }
      }
    }
    if (node !== fn && ts.isFunctionLike(node)) return
    ts.forEachChild(node, scan)
  }
  scan(fn)
  return out.filter(item => item.end - item.start + 1 <= MAX_PATCH_SPAN_LINES).sort((a, b) => b.at - a.at).slice(0, 2).map(({ name, start, end }) => ({ name, start, end }))
}

export type AccumulatorRoot = {
  seed: { start: number; end: number }
  /** Character offsets of the seed expression itself: the model supplies only its replacement. */
  seedSpan: { from: number; to: number }
  callback: { start: number; end: number }
  keyType: string
  valueShapes: string[]
  /** A ready type expression for one element of what is being reduced, when the receiver is a simple path: `(typeof items)[number]`. */
  itemType: string | null
  related: Diag[]
}

/**
 * TS7053 on `acc[key]` inside `items.reduce((acc, item) => {...}, {})`: the compiler reports the use site, the cause is the structurally empty
 * seed. Deterministic and syntax-only: find the enclosing reduce call whose seed is an untyped empty object and report where it is, the key type
 * from the message, and what the callback stores into the accumulator.
 */
export function accumulatorRoot(source: string, diag: Diag, all: Diag[] = [diag]): AccumulatorRoot | null {
  const untypedSeed = diag.code === 'TS7053' && /type '\{\}'/.test(diag.message)
  const arrayIndexedByKey = diag.code === 'TS7015'
  if (!untypedSeed && !arrayIndexedByKey) return null
  const file = ts.createSourceFile('unit.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const pos = file.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => file.getLineAndCharacterOfPosition(at).line + 1
  let found: ts.CallExpression | null = null
  const visit = (node: ts.Node) => {
    if (pos < node.getStart(file) || pos >= node.getEnd()) return
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'reduce' && !node.typeArguments && node.arguments.length >= 2) {
      const [callback, seed] = node.arguments
      const inside = pos >= callback.getStart(file) && pos < callback.getEnd()
      const emptySeed = ts.isObjectLiteralExpression(seed) && seed.properties.length === 0
      // TS7015: the seed carries a type assertion (`{} as T`) that is an array where a keyed record is needed: the whole assertion is the seed to rewrite.
      const assertedSeed = arrayIndexedByKey && ts.isAsExpression(seed) && ts.isObjectLiteralExpression(seed.expression) && seed.expression.properties.length === 0
      if (inside && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ((untypedSeed && emptySeed) || assertedSeed)) found = node
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!found) return null
  const call: ts.CallExpression = found
  const callback = call.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
  const seed = call.arguments[1]
  const accName = callback.parameters[0] && ts.isIdentifier(callback.parameters[0].name) ? callback.parameters[0].name.text : ''
  const valueShapes: string[] = []
  const scan = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left) && ts.isIdentifier(node.left.expression) && node.left.expression.text === accName) valueShapes.push(node.right.getText(file))
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'push' && ts.isElementAccessExpression(node.expression.expression) && ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === accName) valueShapes.push(`an array that receives ${node.arguments.map(arg => arg.getText(file)).join(', ')}`)
    ts.forEachChild(node, scan)
  }
  scan(callback.body)
  const callbackRange = { start: lineOf(callback.getStart(file)), end: lineOf(callback.getEnd()) }
  const key = /expression of type '([^']+)'/.exec(diag.message)?.[1] ?? (arrayIndexedByKey ? 'string (the index used on the accumulator)' : 'the key type in the message')
  return {
    seed: { start: lineOf(seed.getStart(file)), end: lineOf(seed.getEnd()) },
    seedSpan: { from: seed.getStart(file), to: seed.getEnd() },
    callback: callbackRange,
    keyType: key,
    valueShapes: [...new Set(valueShapes)].map(item => item.replace(/\s+/g, ' ').slice(0, 300)).map(item => item === '[]' ? 'an array that starts empty and is filled by push (its element type is the type of what is pushed; never write `[]` as a type, that is an empty tuple)' : item).slice(0, 3),
    itemType: (() => { const receiver = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(file) : ''; return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(receiver) ? `(typeof ${receiver})[number]` : null })(),
    related: all.filter(item => item.code === diag.code && item.line >= callbackRange.start && item.line <= callbackRange.end),
  }
}

/* ------------------------------------------------ root causes that live somewhere other than the use site ------------------------------------------------ */

export type ImportRoot = { symbol: string; spec: string; resolved: string; mode: 'AUGMENT' | 'ADD' | 'MOVE'; symbolKind: 'type' | 'value'; existing: string }
/** `from`/`to` are character offsets of the declaration fragment: the model supplies only its replacement and the executive splices it in. */
export type EmptyArrayRoot = { property: string; current: string; pushedType: string; declaration: 'type' | 'value'; from: number; to: number }
export type RootCause =
  | { kind: 'ACCUMULATOR_SEED'; range: { start: number; end: number }; accumulator: AccumulatorRoot }
  | { kind: 'IMPORT'; range: { start: number; end: number }; maxReplacementLines: number; importRoot: ImportRoot }
  | { kind: 'EMPTY_ARRAY_TYPE'; range: { start: number; end: number }; emptyArray: EmptyArrayRoot }
  | { kind: 'PROPERTY_EXPRESSION'; range: { start: number; end: number }; property: PropertyRoot }
  | { kind: 'TOKEN_FIX'; range: { start: number; end: number }; token: TokenFix }
  | { kind: 'MEMBER_ACCESS'; range: { start: number; end: number }; member: MemberAccess }
  | { kind: 'VALUE_SHAPE'; range: { start: number; end: number }; value: ValueShape }
  | { kind: 'STUB_VALUE'; range: { start: number; end: number }; stub: StubValue }
  | { kind: 'STATE_TYPE'; range: { start: number; end: number }; state: StateType }

/** React state initialised with an empty literal (`useState([])`, `useState({})`): everything read from it is typed `{}`/`never[]`. The fragment is the useState(...) call. */
export type StateType = { name: string; setter: string | null; initial: string; array: boolean; fields: string[]; candidates: string[]; setterCalls: string[]; from: number; to: number }

/** A property set to an empty literal while the variable holding its real value sits unused. The fragment is that property. */
export type StubValue = { name: string; declaration: string; from: number; to: number }

/** A TS2322 reported on one property of an object literal: the name is right, the VALUE has the wrong type. The fragment is that whole property. */
export type ValueShape = { name: string; shorthand: boolean; value: string; found: string; expected: string; from: number; to: number }

/** `receiver.name` where `name` is not a member of the receiver's type: the fragment is the whole access expression, the members are the type's real ones. */
export type MemberAccess = { expression: string; missing: string; typeName: string; members: string[]; nested: string[]; from: number; to: number; /** The fragment is only the receiver: the method that follows it (`.map`) stays. */ keepsMethod: boolean; /** Offsets of the explicit parameter type annotations (`: T`) of the callback passed to that method: the only thing the paired repair may remove. */ callbackAnnotations: Array<{ from: number; to: number }>; /** The access is called with `(...)` right after it: an array member needs a method (`.map`, `.filter`). */ called: boolean; /** What the callback after a called access does with each item: builds a value (map) or answers a test (filter/find/some). */ callbackKind: 'value' | 'test' | null; methods: string[]; /** The receiver is a plain primitive (string/number/boolean): there are no members to choose from, the value itself is what is needed. */ primitive: string | null }

/** A one-token defect the compiler itself diagnoses (misspelt name, wrong import form): the fragment is that token, `suggestion` is the compiler's own advice. */
export type TokenFix = { text: string; from: number; to: number; suggestion: string; why: string }

/** A TS2322 that elaborates to "Types of property 'X' are incompatible": the cause is the one expression that produces X. */
export type PropertyRoot = { name: string; current: string; found: string; expected: string; from: number; to: number }

/** The fragment (character offsets) a root cause lets the model rewrite on its own; null means whole-line mode. */
export const fragmentOf = (cause: RootCause | null): { from: number; to: number } | null =>
  cause?.kind === 'EMPTY_ARRAY_TYPE' ? { from: cause.emptyArray.from, to: cause.emptyArray.to }
  : cause?.kind === 'PROPERTY_EXPRESSION' ? { from: cause.property.from, to: cause.property.to }
  : cause?.kind === 'ACCUMULATOR_SEED' ? cause.accumulator.seedSpan
  : cause?.kind === 'TOKEN_FIX' ? { from: cause.token.from, to: cause.token.to }
  : cause?.kind === 'MEMBER_ACCESS' ? { from: cause.member.from, to: cause.member.to }
  : cause?.kind === 'VALUE_SHAPE' ? { from: cause.value.from, to: cause.value.to }
  : cause?.kind === 'STUB_VALUE' ? { from: cause.stub.from, to: cause.stub.to }
  : cause?.kind === 'STATE_TYPE' ? { from: cause.state.from, to: cause.state.to }
  : null

const parseSource = (text: string, name = 'unit.tsx') => ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

/** Does this module text export `name`, and as a type or a value? Syntax only. */
function exportKind(text: string, name: string): 'type' | 'value' | null {
  const file = parseSource(text)
  let found: 'type' | 'value' | null = null
  for (const node of file.statements) {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)
    if (exported && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === name) found = 'type'
    else if (exported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name?.text === name) found = 'value'
    else if (exported && ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === name)) found = 'value'
    else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(item => item.name.text === name)) found = node.isTypeOnly ? 'type' : 'value'
  }
  return found
}

/**
 * TS2304 'Cannot find name X' where exactly one reachable local module (an existing import target or a sibling file) exports X: the cause is the
 * import block, not the use. Existing import of that module -> the writable range is that import; otherwise the last import line (one new line allowed).
 */
export function importRoot(repoRoot: string, file: string, source: string, diag: Diag): { range: { start: number; end: number }; maxReplacementLines: number; importRoot: ImportRoot } | null {
  if (diag.code !== 'TS2304') return null
  const symbol = /^Cannot find name '([A-Za-z_$][\w$]*)'\.?$/.exec(diag.message)?.[1]
  if (!symbol) return null
  const sf = parseSource(source)
  const imports = sf.statements.filter(ts.isImportDeclaration)
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  const reachable = new Map<string, { kind: 'type' | 'value'; spec: string | null; decl: ts.ImportDeclaration | null }>()
  const consider = (resolved: string, spec: string | null, decl: ts.ImportDeclaration | null) => {
    if (resolved === file || reachable.has(resolved)) { const known = reachable.get(resolved); if (known && decl && !known.decl) known.decl = decl; return }
    let text = ''
    try { text = readFileSync(path.join(repoRoot, resolved), 'utf8') } catch { return }
    if (!text.includes(symbol)) return
    const kind = exportKind(text, symbol)
    if (kind) reachable.set(resolved, { kind, spec, decl })
  }
  for (const decl of imports) {
    if (!ts.isStringLiteral(decl.moduleSpecifier)) continue
    const resolved = resolveImport(repoRoot, file, decl.moduleSpecifier.text)
    if (resolved) consider(resolved, decl.moduleSpecifier.text, decl)
  }
  const dir = path.posix.dirname(file)
  try {
    for (const name of readdirSync(path.join(repoRoot, dir)).filter(item => /\.tsx?$/.test(item) && !/\.d\.ts$/.test(item)).slice(0, 600)) consider(path.posix.join(dir, name), null, null)
  } catch { /* unreadable directory: only existing imports count */ }
  if (reachable.size !== 1) return null
  const [[resolved, hit]] = [...reachable.entries()]
  const decl = hit.decl
  if (decl && decl.importClause?.namedBindings && ts.isNamedImports(decl.importClause.namedBindings)) {
    const range = { start: lineOf(decl.getStart(sf)), end: lineOf(decl.getEnd()) }
    return { range, maxReplacementLines: range.end - range.start + 1, importRoot: { symbol, spec: hit.spec!, resolved, mode: 'AUGMENT', symbolKind: hit.kind, existing: decl.getText(sf) } }
  }
  const last = imports[imports.length - 1]
  const range = last ? { start: lineOf(last.getStart(sf)), end: lineOf(last.getEnd()) } : { start: 1, end: 1 }
  const relative = path.posix.relative(dir, resolved).replace(/\.tsx?$/, '')
  const spec = relative.startsWith('.') ? relative : `./${relative}`
  return { range, maxReplacementLines: range.end - range.start + 2, importRoot: { symbol, spec, resolved, mode: 'ADD', symbolKind: hit.kind, existing: last ? last.getText(sf) : '' } }
}

/**
 * TS2459 / TS2305 / TS2614: a name is imported from a module that does not export it. When exactly one other reachable module does, the cause is
 * that import: the symbol leaves it and one new import line is allowed. If the right module is already imported, there is no unambiguous one-line edit.
 */
export function misimportRoot(repoRoot: string, file: string, source: string, diag: Diag): { range: { start: number; end: number }; maxReplacementLines: number; importRoot: ImportRoot } | null {
  if (!['TS2459', 'TS2305', 'TS2614'].includes(diag.code)) return null
  const names = [...diag.message.matchAll(/'([A-Za-z_$][\w$]*)'/g)].map(item => item[1])
  const symbol = names.find(name => /^[A-Za-z_$][\w$]*$/.test(name) && !/^["./]/.test(name) && source.includes(name))
  if (!symbol) return null
  const sf = parseSource(source)
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  const decl = sf.statements.filter(ts.isImportDeclaration).find(item => lineOf(item.getStart(sf)) <= diag.line && diag.line <= lineOf(item.getEnd()) && item.getText(sf).includes(symbol))
  if (!decl || !ts.isStringLiteral(decl.moduleSpecifier)) return null
  const wrong = resolveImport(repoRoot, file, decl.moduleSpecifier.text)
  const imported = new Set(sf.statements.filter(ts.isImportDeclaration).map(item => ts.isStringLiteral(item.moduleSpecifier) ? resolveImport(repoRoot, file, item.moduleSpecifier.text) : null))
  const dir = path.posix.dirname(file)
  const owners: Array<{ resolved: string; kind: 'type' | 'value' }> = []
  try {
    for (const name of readdirSync(path.join(repoRoot, dir)).filter(item => /\.tsx?$/.test(item) && !/\.d\.ts$/.test(item)).slice(0, 600)) {
      const resolved = path.posix.join(dir, name)
      if (resolved === file || resolved === wrong) continue
      let text = ''
      try { text = readFileSync(path.join(repoRoot, resolved), 'utf8') } catch { continue }
      if (!text.includes(symbol)) continue
      const kind = exportKind(text, symbol)
      if (kind) owners.push({ resolved, kind })
    }
  } catch { return null }
  if (owners.length !== 1 || imported.has(owners[0].resolved)) return null
  const relative = path.posix.relative(dir, owners[0].resolved).replace(/\.tsx?$/, '')
  const range = { start: lineOf(decl.getStart(sf)), end: lineOf(decl.getEnd()) }
  return { range, maxReplacementLines: range.end - range.start + 2, importRoot: { symbol, spec: relative.startsWith('.') ? relative : `./${relative}`, resolved: owners[0].resolved, mode: 'MOVE', symbolKind: owners[0].kind, existing: decl.getText(sf) } }
}

/**
 * `x.items.push(value)` failing with "parameter of type 'never'": the array was declared empty, so its element type is never. The cause is that
 * declaration (an empty tuple type or an untyped empty array on the same property), not the push.
 */
export function emptyArrayRoot(source: string, diag: Diag): { range: { start: number; end: number }; emptyArray: EmptyArrayRoot } | null {
  if (diag.code !== 'TS2345' || !/is not assignable to parameter of type 'never'/.test(diag.message)) return null
  const sf = parseSource(source)
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  let call: ts.CallExpression | null = null
  let scope: ts.Node = sf
  const visit = (node: ts.Node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return
    if (ts.isFunctionLike(node) && scope === sf) scope = node
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['push', 'unshift'].includes(node.expression.name.text)) call = node
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!call) return null
  const receiver = (call as ts.CallExpression).expression as ts.PropertyAccessExpression
  const property = ts.isPropertyAccessExpression(receiver.expression) ? receiver.expression.name.text : ts.isIdentifier(receiver.expression) ? receiver.expression.text : ''
  if (!property) return null
  const named = (name: ts.PropertyName | ts.BindingName) => (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === property
  const typeSites: ts.Node[] = []
  const valueSites: ts.Node[] = []
  const scan = (node: ts.Node) => {
    if (ts.isPropertySignature(node) && named(node.name) && node.type && ts.isTupleTypeNode(node.type) && node.type.elements.length === 0) typeSites.push(node)
    if (ts.isPropertyAssignment(node) && named(node.name) && ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) valueSites.push(node)
    if (ts.isVariableDeclaration(node) && named(node.name) && !node.type && node.initializer && ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) valueSites.push(node)
    ts.forEachChild(node, scan)
  }
  scan(scope)
  const pool = typeSites.length ? typeSites : valueSites
  const site = pool.filter(node => node.getStart(sf) < pos).sort((a, b) => b.getStart(sf) - a.getStart(sf))[0] ?? pool[0]
  if (!site) return null
  const pushed = /Argument of type '(.*)' is not assignable to parameter of type 'never'/.exec(diag.message)?.[1] ?? ''
  return {
    range: { start: lineOf(site.getStart(sf)), end: lineOf(site.getEnd()) },
    emptyArray: { property, current: site.getText(sf), pushedType: pushed.slice(0, 400), declaration: typeSites.length ? 'type' : 'value', from: site.getStart(sf), to: site.getEnd() },
  }
}

/**
 * TS2322 "Types of property 'X' are incompatible ... Type 'A' is not assignable to type 'B'": the error is reported where the whole value is
 * returned or assigned, the cause is the single property assignment named X inside it. Exactly one candidate, else no root cause.
 */
export function propertyExpressionRoot(source: string, diag: Diag): { range: { start: number; end: number }; property: PropertyRoot } | null {
  if (diag.code !== 'TS2322') return null
  const names = [...diag.message.matchAll(/Types of property '([^']+)' are incompatible/g)]
  const last = names[names.length - 1]?.[1]
  const types = /Type '([^']*)' is not assignable to type '([^']*)'\.?\s*$/.exec(diag.message)
  if (!last || !types) return null
  const sf = parseSource(source)
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  let anchor: ts.PropertyAssignment | null = null
  const find = (node: ts.Node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return
    if (ts.isPropertyAssignment(node) && node.getStart(sf) === pos) anchor = node
    ts.forEachChild(node, find)
  }
  find(sf)
  if (!anchor) return null
  const hits: ts.PropertyAssignment[] = []
  const scan = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === last && !ts.isObjectLiteralExpression(node.initializer) && !ts.isArrayLiteralExpression(node.initializer)) hits.push(node)
    ts.forEachChild(node, scan)
  }
  scan((anchor as ts.PropertyAssignment).initializer)
  if (hits.length === 0) {
    // The reported property only references a variable (`rows` or `rows ?? []`): the expression that produces the wrong property is in that variable's declaration.
    const refs = new Set<string>()
    const collect = (node: ts.Node) => { if (ts.isIdentifier(node)) refs.add(node.text); ts.forEachChild(node, collect) }
    collect((anchor as ts.PropertyAssignment).initializer)
    let scope: ts.Node = sf
    const climb = (node: ts.Node) => { if (pos < node.getStart(sf) || pos >= node.getEnd()) return; if (ts.isFunctionLike(node)) scope = node; ts.forEachChild(node, climb) }
    climb(sf)
    const declarations: ts.VariableDeclaration[] = []
    const findDeclarations = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && refs.has(node.name.text) && node.initializer && node.getStart(sf) < pos) declarations.push(node); if (node !== scope && ts.isFunctionLike(node)) return; ts.forEachChild(node, findDeclarations) }
    findDeclarations(scope)
    for (const declaration of declarations) scan(declaration.initializer!)
  }
  if (hits.length !== 1) return null
  const hit = hits[0]
  if (lineOf(hit.getEnd()) - lineOf(hit.getStart(sf)) > 6) return null
  return { range: { start: lineOf(hit.getStart(sf)), end: lineOf(hit.getEnd()) }, property: { name: last, current: hit.getText(sf), found: types[1].slice(0, 200), expected: types[2].slice(0, 300), from: hit.getStart(sf), to: hit.getEnd() } }
}

/** The value part of a `name: expression` fragment. */
export const propertyValueText = (property: PropertyRoot): string => property.current.replace(/^[^:]+:\s*/, '')

/**
 * Which kind of edit is the smallest valid repair for a found/expected mismatch. Deterministic guidance from the two types and the expression
 * only; the model still writes the edit.
 */
export function propertyRepairOptions(property: PropertyRoot): string[] {
  const value = propertyValueText(property)
  const widened = /^(string|number|boolean|bigint)$/.test(property.found.trim()) && !new RegExp(`^${property.found.trim()}$`).test(property.expected.trim())
  const options: string[] = []
  if (widened) {
    options.push(`1. A local type assertion on the whole expression: ${property.name}: (${value}) as ${property.expected.length <= 60 ? property.expected : 'the expected type'}  (valid because the expected type is a narrower form of ${property.found}).`)
    if (/\|\||\?\?/.test(value)) options.push(`2. Keep the expression but make its fallback a value that already has the expected type, and assert the left operand to it.`)
    options.push('3. A correctly typed intermediate: declare a const of the expected type above and use it here (only if the line above is inside your range; it is not, so prefer 1 or 2).')
  } else if (/\bundefined\b|\bnull\b/.test(property.found)) {
    options.push(`1. A fallback with ?? or || whose value has the expected type, so undefined/null cannot flow through.`)
  } else {
    options.push(`1. Build or convert the value so that it has type ${property.expected.slice(0, 120)} (construct the missing fields, or convert from ${property.found.slice(0, 80)}).`)
    options.push('2. If the value is already correct at runtime, a local type assertion to the expected type.')
  }
  return options
}

/**
 * Defects the compiler names exactly: a misspelt identifier ("Did you mean 'x'?"), a default import of a module that only has named exports,
 * and a member read off a default/namespace import that is really a named export. The writable fragment is that one token.
 */
export function tokenFixRoot(source: string, diag: Diag): { range: { start: number; end: number }; token: TokenFix } | null {
  const sf = parseSource(source)
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  const at = (node: ts.Node, suggestion: string, why: string) => ({ range: { start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()) }, token: { text: node.getText(sf), from: node.getStart(sf), to: node.getEnd(), suggestion, why } })
  let token: ts.Identifier | null = null
  const find = (node: ts.Node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return
    if (ts.isIdentifier(node) && node.getStart(sf) === pos) token = node
    ts.forEachChild(node, find)
  }
  find(sf)
  if (!token) return null
  const ident: ts.Identifier = token
  if (diag.code === 'TS2551' || diag.code === 'TS2552') {
    const suggestion = /Did you mean '([^']+)'\?/.exec(diag.message)?.[1]
    return suggestion ? at(ident, suggestion, `'${ident.text}' does not exist; the compiler found the near match '${suggestion}'.`) : null
  }
  if (diag.code === 'TS2561' && ts.isPropertyAssignment(ident.parent) || diag.code === 'TS2561' && ts.isShorthandPropertyAssignment(ident.parent)) {
    // "Object literal may only specify known properties, but 'x' does not exist in type '{ a: string; b: number }'": the type's own property names are in the message.
    const typeText = /does not exist in type '(.*)'\./.exec(diag.message)?.[1] ?? ''
    const known = [...new Set([...typeText.matchAll(/([A-Za-z_$][\w$]*)\??:/g)].map(item => item[1]))].slice(0, 30)
    const guess = /Did you mean to write '([^']+)'\?/.exec(diag.message)?.[1]
    // Closest own property by shared prefix, then by length: `started` -> `startedAt`, not the compiler's spelling guess `state`.
    const commonPrefix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++; return n }
    const ranked = [...known].sort((a, b) => commonPrefix(b, ident.text) - commonPrefix(a, ident.text) || Math.abs(a.length - ident.text.length) - Math.abs(b.length - ident.text.length))
    const best = ranked[0] && commonPrefix(ranked[0], ident.text) >= 3 ? ranked[0] : null
    return known.length ? at(ident, `${best ? `${best}  (the type's own property whose name is closest to '${ident.text}'${guess && guess !== best ? `; the compiler's spelling guess '${guess}' is a weaker match` : ''}). ` : ''}All own properties: ${known.join(', ')}`, `'${ident.text}' is not a property of the expected type.`) : null
  }
  if (diag.code === 'import:TYPE_ONLY' && ts.isImportSpecifier(ident.parent)) {
    return at(ident, `type ${ident.text}`, `'${ident.text}' is only a type: it must be imported as a type or the node runner fails to load this module.`)
  }
  if (diag.code === 'TS2613' && ts.isImportClause(ident.parent)) {
    const named = /import \{ ([A-Za-z_$][\w$]*) \} from/.exec(diag.message)?.[1]
    return named ? at(ident, `{ ${named} }`, `The module has no default export; '${named}' is a named export, so the import must use braces.`) : null
  }
  if (diag.code === 'TS2339' && /on type 'typeof import\(/.test(diag.message) && ts.isPropertyAccessExpression(ident.parent) && ident.parent.name === ident && ts.isIdentifier(ident.parent.expression)) {
    const base = ident.parent.expression.text
    for (const decl of sf.statements.filter(ts.isImportDeclaration)) {
      const clause = decl.importClause
      if (clause?.name?.text === base) return at(clause.name, `{ ${base} }`, `'${base}' is imported as the module itself, but '.${ident.text}' belongs to a member of the module. '${base}' is most likely a named export: import it with braces.`)
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === base) return at(clause.namedBindings, `{ ${base} }`, `'${base}' is the whole module namespace, but '.${ident.text}' belongs to a member of the module. '${base}' is most likely a named export: import it with braces.`)
    }
  }
  return null
}

/**
 * TS2339 "Property 'x' does not exist on type 'T'" on an object type: the compiler can list T's real members, so the model chooses among them
 * instead of inventing one. Needs the type checker, so it is computed only for the target being offered.
 */
export function memberAccessRoot(repoRoot: string, file: string, source: string, diag: Diag): { range: { start: number; end: number }; member: MemberAccess } | null {
  if (diag.code !== 'TS2339' || /typeof import\(/.test(diag.message)) return null
  const missing = /Property '([^']+)' does not exist on type/.exec(diag.message)?.[1]
  if (!missing) return null
  const options = compilerOptions(repoRoot)
  const host = ts.createCompilerHost(options, true)
  const abs = path.join(repoRoot, file)
  const base = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => name === abs ? ts.createSourceFile(name, source, languageVersion, true) : base(name, languageVersion, onError, shouldCreate)
  const readFile = host.readFile.bind(host)
  host.readFile = name => name === abs ? source : readFile(name)
  const program = ts.createProgram({ rootNames: [abs], options, host })
  const sf = program.getSourceFile(abs)
  if (!sf) return null
  const checker = program.getTypeChecker()
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  let access: ts.PropertyAccessExpression | null = null
  const find = (node: ts.Node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return
    if (ts.isPropertyAccessExpression(node) && node.name.getStart(sf) === pos && node.name.text === missing) access = node
    ts.forEachChild(node, find)
  }
  find(sf)
  if (!access) return null
  const found: ts.PropertyAccessExpression = access
  const type = checker.getTypeAtLocation(found.expression)
  // A plain primitive (`failure.text` where `failure` is a string) has no members worth listing: the value itself is what is needed.
  if (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)) {
    const lineOfPrimitive = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
    const kind = type.flags & ts.TypeFlags.StringLike ? 'string' : type.flags & ts.TypeFlags.NumberLike ? 'number' : 'boolean'
    return {
      range: { start: lineOfPrimitive(found.getStart(sf)), end: lineOfPrimitive(found.getEnd()) },
      member: { expression: found.getText(sf), missing, typeName: checker.typeToString(type).slice(0, 80), members: [], nested: [], from: found.getStart(sf), to: found.getEnd(), keepsMethod: false, callbackAnnotations: [], called: false, callbackKind: null, methods: [], primitive: kind },
    }
  }
  const props = checker.getPropertiesOfType(type)
  if (!props.length || props.length > 60) return null
  const members = props.slice(0, 30).map(symbol => `${symbol.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, found)).replace(/\s+/g, ' ').slice(0, 90)}`)
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  // Where the thing the code wants really is: a member of that exact name, or (for an array method such as map/filter) an array-typed member,
  // searched up to three levels down from the receiver AND from the root of the access chain (the right member is often a sibling of the receiver).
  const arrayMethod = /^(map|filter|some|every|find|findIndex|forEach|reduce|flatMap|includes|indexOf|slice|sort|length)$/.test(missing)
  // What the callback does with its item names the element shape: used property names and annotated members.
  const wanted = new Set<string>()
  if (ts.isCallExpression(found.parent) && found.parent.expression === found && found.parent.arguments[0] && (ts.isArrowFunction(found.parent.arguments[0]) || ts.isFunctionExpression(found.parent.arguments[0]))) {
    const callback = found.parent.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
    const param = callback.parameters[0]
    if (param && ts.isIdentifier(param.name)) {
      const name = param.name.text
      const collect = (node: ts.Node) => { if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) wanted.add(node.name.text); ts.forEachChild(node, collect) }
      collect(callback.body)
      if (param.type && ts.isTypeLiteralNode(param.type)) for (const member of param.type.members) if (member.name && ts.isIdentifier(member.name)) wanted.add(member.name.text)
    }
  }
  // A collection that is CALLED like a function: what the callback does with each item decides which collection method was meant.
  const calledShape: { callbackKind: 'value' | 'test' | null; methods: string[] } = { callbackKind: null, methods: [] }
  if (ts.isCallExpression(found.parent) && found.parent.expression === found) {
    const callback = found.parent.arguments[0]
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      let body: ts.Node = callback.body
      if (ts.isBlock(body)) { const last = body.statements[body.statements.length - 1]; body = last && ts.isReturnStatement(last) && last.expression ? last.expression : body }
      while (ts.isParenthesizedExpression(body)) body = body.expression
      const isTest = (ts.isBinaryExpression(body) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(body.operatorToken.kind)) || (ts.isPrefixUnaryExpression(body) && body.operator === ts.SyntaxKind.ExclamationToken) || (ts.isCallExpression(body) && ts.isPropertyAccessExpression(body.expression) && ['includes', 'startsWith', 'endsWith', 'some', 'every', 'test'].includes(body.expression.name.text))
      calledShape.callbackKind = isTest ? 'test' : 'value'
      calledShape.methods = isTest ? ['filter', 'find', 'some', 'every'] : ['map', 'flatMap', 'forEach']
    }
  }
  const callbackAnnotations: Array<{ from: number; to: number }> = []
  if ((arrayMethod || calledShape.callbackKind) && ts.isCallExpression(found.parent) && found.parent.expression === found) {
    const callback = found.parent.arguments[0]
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) for (const param of callback.parameters) if (param.type) callbackAnnotations.push({ from: param.name.getEnd() + (param.questionToken ? 1 : 0), to: param.type.getEnd() })
  }
  const scored: Array<{ line: string; score: number; order: number }> = []
  let order = 0
  const roots: Array<{ path: string; type: ts.Type; depth: number; nullable: boolean }> = []
  let leftmost: ts.Expression = found.expression
  while (ts.isPropertyAccessExpression(leftmost) || ts.isNonNullExpression(leftmost) || ts.isElementAccessExpression(leftmost)) leftmost = leftmost.expression
  roots.push({ path: found.expression.getText(sf), type: checker.getNonNullableType(type), depth: 0, nullable: false })
  if (leftmost !== found.expression && ts.isIdentifier(leftmost)) roots.push({ path: leftmost.getText(sf), type: checker.getNonNullableType(checker.getTypeAtLocation(leftmost)), depth: 0, nullable: false })
  const seenPaths = new Set<string>()
  const queue = [...roots]
  for (let seen = 0; queue.length && seen < 400; seen++) {
    const item = queue.shift()!
    if (item.depth >= 3) continue
    for (const symbol of checker.getPropertiesOfType(item.type).slice(0, 40)) {
      const raw = checker.getTypeOfSymbolAtLocation(symbol, found)
      const plain = checker.getNonNullableType(raw)
      const optional = plain !== raw
      const path2 = `${item.path}${item.nullable ? '?.' : '.'}${symbol.name}`
      if (seenPaths.has(path2)) continue
      seenPaths.add(path2)
      const typeText = checker.typeToString(plain)
      const isArray = typeText.endsWith('[]') || plain.symbol?.name === 'Array'
      if (symbol.name === missing || (arrayMethod && isArray)) {
        let score = symbol.name === missing ? 100 : 0
        if (isArray && wanted.size) {
          const element = isArray && (plain as ts.TypeReference).target ? checker.getTypeArguments(plain as ts.TypeReference)[0] : undefined
          const names = new Set((element ? checker.getPropertiesOfType(checker.getNonNullableType(element)) : []).map(item2 => item2.name))
          score += [...wanted].filter(name => names.has(name)).length
        }
        scored.push({ line: `${path2}${optional ? '  (can be null: use ?.)' : ''}: ${checker.typeToString(raw).replace(/\s+/g, ' ').slice(0, 80)}`, score, order: order++ })
      }
      if (!isArray && plain.getProperties().length && plain.getProperties().length <= 40) queue.push({ path: path2, type: plain, depth: item.depth + 1, nullable: optional })
    }
  }
  const nested = scored.sort((x, y) => y.score - x.score || x.order - y.order).slice(0, 8).map(item => wanted.size && item.score > 0 && !item.line.includes(`.${missing}:`) ? `${item.line}   <- its items have ${item.score} of the member(s) the callback uses` : item.line)
  return {
    range: { start: lineOf(found.getStart(sf)), end: lineOf(found.getEnd()) },
    member: arrayMethod
      ? { expression: found.expression.getText(sf), missing, typeName: checker.typeToString(type).slice(0, 80), members, nested, from: found.expression.getStart(sf), to: found.expression.getEnd(), keepsMethod: true, callbackAnnotations, called: false, callbackKind: null, methods: [], primitive: null }
      : { expression: found.getText(sf), missing, typeName: checker.typeToString(type).slice(0, 80), members, nested, from: found.getStart(sf), to: found.getEnd(), keepsMethod: false, callbackAnnotations, called: ts.isCallExpression(found.parent) && found.parent.expression === found, ...calledShape, primitive: null },
  }
}

/**
 * The smallest value correction a found/expected pair proves: number -> string, string -> number, and `T | undefined` -> T (with the definite default of T
 * for strings, numbers, booleans and arrays). Anything else has no deterministic correction.
 */
export function coerceValue(expression: string, found: string, expected: string): string | null {
  const compact = (text: string) => text.replace(/\s+/g, '')
  const f = compact(found)
  const e = compact(expected)
  const wrap = /^[\w$.?!]+(\([^()]*\))?$/.test(expression.trim()) ? expression.trim() : `(${expression.trim()})`
  if (f === 'number' && e === 'string') return `String(${expression.trim()})`
  if (f === 'string' && e === 'number') return `Number(${expression.trim()})`
  const nullable = /\|(undefined|null)$/.exec(f) ?? /^(undefined|null)\|/.exec(f)
  if (nullable) {
    const stripped = f.replace(/\|(undefined|null)(?=\||$)/g, '').replace(/^(undefined|null)\|/, '')
    if (stripped === e) {
      const fallback = e === 'string' ? "''" : e === 'number' ? '0' : e === 'boolean' ? 'false' : e.endsWith('[]') ? '[]' : null
      if (fallback) return `${wrap} ?? ${fallback}`
    }
  }
  return null
}

/**
 * TS2322 reported on one property of an object literal ("Type 'A' is not assignable to type 'B'", no property chain): the property name is not the
 * problem, its value is. Gives the bounded prompt FOUND / EXPECTED / CURRENT PROPERTY / CURRENT VALUE.
 */
export function valueShapeRoot(source: string, diag: Diag): { range: { start: number; end: number }; value: ValueShape } | null {
  if (diag.code !== 'TS2322' || /Types of property '[^']+' are incompatible/.test(diag.message)) return null
  const types = /^Type '(.+?)' is not assignable to type '(.+?)'\.(?: |$)/.exec(diag.message)
  if (!types) return null
  const sf = parseSource(source)
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  const hits: Array<ts.PropertyAssignment | ts.ShorthandPropertyAssignment> = []
  const find = (node: ts.Node) => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getStart(sf) === pos) hits.push(node)
    ts.forEachChild(node, find)
  }
  find(sf)
  const node = hits[0]
  if (!node) return null
  if (lineOf(node.getEnd()) - lineOf(node.getStart(sf)) > 6) return null
  const shorthand = ts.isShorthandPropertyAssignment(node)
  return {
    range: { start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()) },
    value: { name: node.name.getText(sf), shorthand, value: shorthand ? node.name.getText(sf) : (node as ts.PropertyAssignment).initializer.getText(sf), found: types[1].slice(0, 300), expected: types[2].slice(0, 300), from: node.getStart(sf), to: node.getEnd() },
  }
}

/** `stub:EMPTY_VALUE`: the writable fragment is the stubbed property; the unused variable that holds the real value is shown. */
export function stubValueRoot(source: string, diag: Diag): { range: { start: number; end: number }; stub: StubValue } | null {
  if (diag.code !== 'stub:EMPTY_VALUE') return null
  const name = /property '([^']+)'/.exec(diag.message)?.[1]
  if (!name) return null
  const sf = parseSource(source)
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const hits: ts.PropertyAssignment[] = []
  const find = (node: ts.Node) => { if (pos < node.getStart(sf) || pos >= node.getEnd()) return; if (ts.isPropertyAssignment(node) && node.getStart(sf) === pos) hits.push(node); ts.forEachChild(node, find) }
  find(sf)
  const node = hits[0]
  if (!node) return null
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  const declLine = Number(/\(line (\d+)\)/.exec(diag.message)?.[1] ?? 0)
  const lines = source.split('\n')
  return { range: { start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()) }, stub: { name, declaration: declLine ? lines.slice(declLine - 1, declLine + 2).join('\n').trim().slice(0, 240) : '', from: node.getStart(sf), to: node.getEnd() } }
}

/**
 * `const [view, setView] = useState({})` / `useState([])`: a property read (or an item callback) on `view` fails because the state has no type. The cause is that declaration,
 * not the reads. The writable fragment is the useState(...) call; the executive supplies the fields that are read, candidate types ranked by how many of those fields they
 * have (local aliases, imported types, `import('...')` types and their modules' exports) and how the setter is called.
 */
export function stateTypeRoot(repoRoot: string, file: string, source: string, diag: Diag): { range: { start: number; end: number }; state: StateType } | null {
  if (diag.code !== 'TS2339' || !/does not exist on type '(\{\}|never\[\]|never)'/.test(diag.message)) return null
  const options = compilerOptions(repoRoot)
  const host = ts.createCompilerHost(options, true)
  const abs = path.join(repoRoot, file)
  const base = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => name === abs ? ts.createSourceFile(name, source, languageVersion, true) : base(name, languageVersion, onError, shouldCreate)
  const readFile = host.readFile.bind(host)
  host.readFile = name => name === abs ? source : readFile(name)
  const program = ts.createProgram({ rootNames: [abs], options, host })
  const sf = program.getSourceFile(abs)
  if (!sf) return null
  const checker = program.getTypeChecker()
  const pos = sf.getPositionOfLineAndCharacter(diag.line - 1, Math.max(0, diag.col - 1))
  const lineOf = (at: number) => sf.getLineAndCharacterOfPosition(at).line + 1
  let access: ts.PropertyAccessExpression | null = null
  const find = (node: ts.Node) => { if (pos < node.getStart(sf) || pos >= node.getEnd()) return; if (ts.isPropertyAccessExpression(node) && node.name.getStart(sf) === pos) access = node; ts.forEachChild(node, find) }
  find(sf)
  const found = access as ts.PropertyAccessExpression | null
  if (!found) return null
  let root: ts.Expression = found.expression
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root) || ts.isNonNullExpression(root)) root = root.expression
  if (!ts.isIdentifier(root)) return null
  let name = root.text
  // The failing read may be on an ITEM of the state (`items.map(item => item.name)`): the item parameter resolves back to the state it came from.
  for (let cur: ts.Node | undefined = found.parent; cur; cur = cur.parent) {
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && cur.parameters[0] && ts.isIdentifier(cur.parameters[0].name) && cur.parameters[0].name.text === name && ts.isCallExpression(cur.parent) && cur.parent.arguments[0] === cur) {
      const callee = cur.parent.expression
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) { name = callee.expression.text; break }
    }
  }
  // the declaration: const [name, setter] = useState(<empty or nothing>)
  let call: ts.CallExpression | null = null
  let setter: string | null = null
  const findDeclaration = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const callee = node.initializer.expression
      const isUseState = (ts.isIdentifier(callee) && callee.text === 'useState') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'useState')
      const first = node.name.elements[0]
      if (isUseState && first && ts.isBindingElement(first) && ts.isIdentifier(first.name) && first.name.text === name && !node.initializer.typeArguments) {
        const arg = node.initializer.arguments[0]
        const empty = !arg || (ts.isArrayLiteralExpression(arg) && arg.elements.length === 0) || (ts.isObjectLiteralExpression(arg) && arg.properties.length === 0)
        if (empty) {
          call = node.initializer
          const second = node.name.elements[1]
          setter = second && ts.isBindingElement(second) && ts.isIdentifier(second.name) ? second.name.text : null
        }
      }
    }
    ts.forEachChild(node, findDeclaration)
  }
  findDeclaration(sf)
  const useStateCall = call as ts.CallExpression | null
  if (!useStateCall) return null
  const array = useStateCall.arguments[0] ? ts.isArrayLiteralExpression(useStateCall.arguments[0]) : false
  // fields read from the state value (directly, or from the items of a callback over it)
  const fields = new Set<string>()
  const collectFrom = (node: ts.Node, identifier: string) => { if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier) fields.add(node.name.text); ts.forEachChild(node, inner => collectFrom(inner, identifier)) }
  const scanReads = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) fields.add(node.name.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === name) {
      const callback = node.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0] && ts.isIdentifier(callback.parameters[0].name)) collectFrom(callback.body, callback.parameters[0].name.text)
    }
    ts.forEachChild(node, scanReads)
  }
  scanReads(sf)
  // object state: `view.taskGroups.map(group => group.state)` also reads `taskGroups` from view; keep both levels flat (names only)
  const setterCalls: string[] = []
  if (setter) {
    const lines = source.split('\n')
    lines.forEach((text, index) => { if (new RegExp(`\\b${setter}\\(`).test(text) && setterCalls.length < 4) setterCalls.push(`line ${index + 1}: ${text.trim().slice(0, 140)}`) })
  }
  // candidate types: type symbols in scope that this file declares/imports, plus the exports of modules it imports or names in import('...') types
  const pool = new Map<string, ts.Symbol>()
  const addSymbol = (symbol: ts.Symbol | undefined, label?: string) => { if (symbol && symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)) pool.set(label ?? symbol.name, symbol) }
  const moduleSpecs: string[] = []
  const visitTypes = (node: ts.Node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) moduleSpecs.push(node.argument.literal.text)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) moduleSpecs.push(node.moduleSpecifier.text)
    ts.forEachChild(node, visitTypes)
  }
  visitTypes(sf)
  for (const symbol of checker.getSymbolsInScope(sf, ts.SymbolFlags.Type)) {
    const declaredHere = symbol.declarations?.some(item => item.getSourceFile() === sf)
    if (declaredHere) {
      // An exported local declaration appears in scope as a placeholder with no flags: the real symbol is its export symbol (or the one named by its declaration).
      const declaration = symbol.declarations?.find(item => ts.isTypeAliasDeclaration(item) || ts.isInterfaceDeclaration(item)) as ts.TypeAliasDeclaration | ts.InterfaceDeclaration | undefined
      const real = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : declaration ? (checker.getSymbolAtLocation(declaration.name) ?? checker.getExportSymbolOfSymbol(symbol)) : symbol
      addSymbol(real, symbol.name)
    }
    else if (symbol.flags & ts.SymbolFlags.Alias) { const aliased = checker.getAliasedSymbol(symbol); if (aliased.declarations?.some(item => item.getSourceFile().fileName !== sf.fileName && !/node_modules/.test(item.getSourceFile().fileName))) addSymbol(aliased, symbol.name) }
  }
  for (const spec of new Set(moduleSpecs)) {
    const resolved = ts.resolveModuleName(spec, abs, options, host).resolvedModule
    const moduleFile = resolved ? program.getSourceFile(resolved.resolvedFileName) : undefined
    const moduleSymbol = moduleFile ? checker.getSymbolAtLocation(moduleFile) : undefined
    if (!moduleSymbol || /node_modules/.test(moduleFile!.fileName)) continue
    for (const exported of checker.getExportsOfModule(moduleSymbol)) if (!pool.has(exported.name)) addSymbol(exported, `import('${spec}').${exported.name}`)
  }
  const wanted = [...fields]
  const ranked = [...pool.entries()].map(([label, symbol]) => {
    const type = checker.getDeclaredTypeOfSymbol(symbol)
    const members = new Set(checker.getPropertiesOfType(type).map(item => item.name))
    const hits = wanted.filter(item => members.has(item))
    return { label, hits: hits.length, members: [...members] }
  }).filter(item => item.hits >= Math.min(2, Math.max(1, wanted.length)) && item.hits >= Math.ceil(wanted.length / 3)).sort((x, y) => y.hits - x.hits || x.members.length - y.members.length).slice(0, 4)
    .map(item => `${item.label}   (has ${item.hits} of the ${wanted.length} fields read: ${wanted.filter(field => item.members.includes(field)).join(', ')})`)
  return {
    range: { start: lineOf(useStateCall.getStart(sf)), end: lineOf(useStateCall.getEnd()) },
    state: { name, setter, initial: useStateCall.getText(sf), array, fields: wanted.slice(0, 30), candidates: ranked, setterCalls, from: useStateCall.getStart(sf), to: useStateCall.getEnd() },
  }
}

/** The root cause of a diagnostic when it is not at the line the compiler reports; null means "patch the statement it points at". */
export function rootCauseFor(repoRoot: string, file: string, source: string, diag: Diag, all: Diag[] = [diag], full = true): RootCause | null {
  const imported = importRoot(repoRoot, file, source, diag) ?? misimportRoot(repoRoot, file, source, diag)
  if (imported) return { kind: 'IMPORT', ...imported }
  const accumulator = accumulatorRoot(source, diag, all)
  if (accumulator) return { kind: 'ACCUMULATOR_SEED', range: accumulator.seed, accumulator }
  const empty = emptyArrayRoot(source, diag)
  if (empty) return { kind: 'EMPTY_ARRAY_TYPE', ...empty }
  const tokenFix = tokenFixRoot(source, diag)
  if (tokenFix) return { kind: 'TOKEN_FIX', ...tokenFix }
  const property = propertyExpressionRoot(source, diag)
  if (property) return { kind: 'PROPERTY_EXPRESSION', ...property }
  const stub = stubValueRoot(source, diag)
  if (stub) return { kind: 'STUB_VALUE', ...stub }
  const shape = valueShapeRoot(source, diag)
  if (shape) return { kind: 'VALUE_SHAPE', ...shape }
  if (full) {
    const state = stateTypeRoot(repoRoot, file, source, diag)
    if (state) return { kind: 'STATE_TYPE', ...state }
    const member = memberAccessRoot(repoRoot, file, source, diag)
    if (member) return { kind: 'MEMBER_ACCESS', ...member }
  }
  return null
}

/** Import declarations per module specifier (a patch may add a name to one, or add exactly one new declaration; never a duplicate of a module). */
const importCounts = (text: string): { total: number; bySpec: Map<string, number> } => {
  const bySpec = new Map<string, number>()
  let total = 0
  for (const node of parseSource(text).statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) { total += 1; bySpec.set(node.moduleSpecifier.text, (bySpec.get(node.moduleSpecifier.text) ?? 0) + 1) }
  return { total, bySpec }
}

/** The line range one patch replaces: the deepest complete statement on the first try, the next enclosing statement on each retry (within the span limit). */
export function patchRangeFor(source: string, target: RepairTarget, cause: RootCause | null = null): { start: number; end: number } {
  // A diagnostic that is a symptom (untyped accumulator, missing import, empty-array type) is repaired where it comes from.
  if (cause) return cause.range
  const chain = statementChain(source, target.target.line).filter(item => item.end - item.start + 1 <= MAX_PATCH_SPAN_LINES)
  // First try: the statement the compiler points at. Retry: the declaration of what that statement uses (the likelier cause), else the next enclosing statement.
  if (target.attempt > 0) {
    const declaration = localDeclarations(source, target.target.line)[0]
    if (declaration) return { start: declaration.start, end: declaration.end }
  }
  return chain[Math.min(target.attempt, Math.max(0, chain.length - 1))] ?? { start: target.target.line, end: target.target.line }
}

/** What the common diagnostics mean and the usual shape of the fix: deterministic guidance, so the model spends its one turn on the edit itself. */
const HINTS: Array<[RegExp, string]> = [
  [/^runtime:FAILURE$/, "The test file compiles but fails when it RUNS: the message names the failing assertion. Decide which side is wrong by the request and the real shape of what the code under test returns: usually the expectation reads the wrong field or value. Fix the expectation (this file is the only writable file); do not weaken it into something that always passes."],
  [/^import:TYPE_ONLY$/, "This name is only a type. Mark it as a type inside the braces (`type Name`) so the runtime can erase it; keep every other name as it is."],
  [/^stub:EMPTY_VALUE$/, "A property was set to an empty literal to silence the type checker while the real value sits unused in a variable. Use that variable (for example `name` or `name: name`); if its type is `T | undefined`, give it a real default with ?? instead of deleting the data."],
  [/^TS7053$/, "An object literal such as {} has no index signature. Give the accumulator or object an explicit type (for example `{} as Record<string, ItemType>` or `reduce<Record<string, ItemType>>(...)`), using the real item type from the reference."],
  [/^TS18046$/, "The value is of type unknown (for example Object.values of an untyped record). Give the collection a real type, or annotate the parameter with the type shown in the reference."],
  [/^TS7006$/, "Annotate the parameter with its type, taken from the reference."],
  [/^TS2339$/, "That property is not in the type. Use the property the reference type really defines (look inside nested objects). Do not add properties to the type."],
  [/^TS2322$/, "The value does not match the declared type. Produce a value of the declared type, or return what the function signature declares."],
  [/^TS(18048|2532|2531)$/, "The value may be undefined. Narrow before use: optional chaining, a default with ??, or an if-guard."],
  [/^TS2304$/, "The name is not defined here. Import it from where the reference shows it is defined: add it to an existing import of that module or add one import line. Do not touch other code."],
  [/^TS2345$/, "The argument does not match the parameter type. Pass what the signature in the reference expects (convert the argument, or fix the expression that produces it). If the parameter type is never, the array was declared empty: give it an element type. If the argument is a callback whose parameter has an explicit type annotation that differs from the real item type shown in the message, rewrite the callback so it uses the real item type: drop or correct the annotation AND change the callback body to what that item type really offers (a string item is used directly, not as an object)."],
  [/^TS2451$/, "A name is declared twice in the same scope. Do not repeat an existing declaration: change only what is inside it."],
  [/^TS(2739|2740|2741)$/, "The object is missing properties of its declared type. Add exactly the properties the message names."],
  [/^TS2698$/, "Spread needs an object type. Make sure the spread value has an object type, not unknown or a primitive."],
]
export const hintFor = (code: string): string => HINTS.find(([pattern]) => pattern.test(code))?.[1] ?? ''

/** TS2345 on a callback argument: the item type the collection really has, taken from the compiler's own expected signature (`(value: string, index: number, ...) =>`). */
export function callbackItemType(diag: { code: string; message: string }): string | null {
  if (diag.code !== 'TS2345' || !/Argument of type '\(/.test(diag.message)) return null
  const match = /parameter of type '\((?:value|item|element|x|[a-z]+): ([^,)]+(?:\[\])?)[,)]/.exec(diag.message)
  return match ? match[1].trim() : null
}

/**
 * For a runtime failure: the values the failing statement reads (callback items, variables) and the real members of their types, so the expectation can be corrected against what
 * the code under test really returns. Syntax + type checker only; nothing is executed here.
 */
export function runtimeReads(repoRoot: string, file: string, source: string, line: number): string[] {
  const options = compilerOptions(repoRoot)
  const host = ts.createCompilerHost(options, true)
  const abs = path.join(repoRoot, file)
  const base = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => name === abs ? ts.createSourceFile(name, source, languageVersion, true) : base(name, languageVersion, onError, shouldCreate)
  const readFile = host.readFile.bind(host)
  host.readFile = name => name === abs ? source : readFile(name)
  const program = ts.createProgram({ rootNames: [abs], options, host })
  const sf = program.getSourceFile(abs)
  if (!sf) return []
  const checker = program.getTypeChecker()
  const lineStart = sf.getPositionOfLineAndCharacter(line - 1, 0)
  const lineEnd = sf.getPositionOfLineAndCharacter(Math.min(sf.getLineAndCharacterOfPosition(sf.end).line, line), 0)
  const out = new Map<string, string>()
  const visit = (node: ts.Node) => {
    if (node.getEnd() < lineStart || node.getStart(sf) > lineEnd) return
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      // `assert.ok(...)`: an imported library used as the callee is not a value the test reads.
      const importedCallee = ts.isCallExpression(node.parent) && node.parent.expression === node && (checker.getSymbolAtLocation(node.expression)?.declarations ?? []).some(item => ts.isImportClause(item) || ts.isNamespaceImport(item) || ts.isImportSpecifier(item))
      if (!out.has(name) && !importedCallee) {
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node.expression))
        const props = checker.getPropertiesOfType(type).map(item => item.name)
        if (props.length && props.length <= 40) out.set(name, props.join(', '))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...out.entries()].map(([name, members]) => `${name}: ${members}`).slice(0, 6)
}

/**
 * For the quoted strings in a failing assertion line: real strings in the sibling source files (the code under test) that contain the literal's leading words, so an
 * expectation that no longer matches can be restored to the wording the code really produces.
 */
export function literalHints(repoRoot: string, file: string, line: string): string[] {
  const literals = [...line.matchAll(/(['"`])((?:(?!\1)[^\\\n]){4,80})\1/g)].map(item => item[2]).filter(text => /[A-Za-z]{3}/.test(text))
  if (!literals.length) return []
  const dir = path.posix.dirname(file)
  let siblings: string[] = []
  try { siblings = readdirSync(path.join(repoRoot, dir)).filter(name => /\.tsx?$/.test(name) && !/\.(validation|proof|test|spec)\.tsx?$/.test(name) && !name.includes('.candidate-') && path.posix.join(dir, name) !== file).slice(0, 300) } catch { return [] }
  const texts = siblings.map(name => { try { return { name, text: readFileSync(path.join(repoRoot, dir, name), 'utf8') } } catch { return { name, text: '' } } })
  const out: string[] = []
  for (const literal of literals.slice(0, 3)) {
    const words = literal.split(/\s+/)
    for (let take = words.length; take >= 1 && !out.some(item => item.startsWith(`"${literal}"`)); take--) {
      const probe = words.slice(0, take).join(' ')
      if (probe.length < 5) break
      const hit = texts.find(item => item.text.includes(probe))
      if (hit) {
        const index = hit.text.indexOf(probe)
        const start = Math.max(hit.text.lastIndexOf('\n', index) + 1, index - 40)
        const key = /([A-Za-z_$][\w$]*)\s*[:=]\s*['\"`]?$/.exec(hit.text.slice(Math.max(0, index - 40), index))?.[1]
        out.push(`"${literal}" -> the code under test has: ${hit.text.slice(start, index + 90).split('\n')[0].trim()}  (${hit.name})${key ? ` [stored under the key '${key}']` : ''}`)
        break
      }
    }
  }
  return out
}

/** The unresolved name when the diagnostic's whole source line is just that name (a stray word), else null. */
export function strayWord(target: { target: { code: string; message: string }; lineText: string }): string | null {
  if (target.target.code !== 'TS2304') return null
  const name = /Cannot find name '([^']+)'/.exec(target.target.message)?.[1]
  return name && target.lineText.trim().replace(/[;,]$/, '') === name ? name : null
}

/** Everything the executive hands the model for one repair turn, or null when there is nothing (left) to repair. */
export function buildNarrowContext(root: string, file: string, diags: Diag[] = diagnoseAll(root, file)): NarrowContext | null {
  if (!diags.length) return null
  const source = readFileSync(path.join(root, file), 'utf8')
  const target = selectTarget(diags, source, loadLedger(file), (diag, full) => rootCauseFor(root, file, source, diag, diags, full))
  if (!target) return null
  const lines = source.split('\n')
  const cause = target.cause
  const ledgerNote = loadLedger(file).notes?.[diagnosticIdentity(target.target, target.lineText)]
  const patchRange = patchRangeFor(source, target, cause)
  const window = { start: Math.max(1, patchRange.start - 3), end: Math.min(lines.length, patchRange.end + 3) }
  const shown = lines.slice(window.start - 1, window.end).map((text, index) => `${String(window.start + index).padStart(4)}| ${text}`).join('\n')
  const declarations = localDeclarations(source, target.target.line).filter(item => item.start < patchRange.start || item.end > patchRange.end).map(item => lines.slice(item.start - 1, item.end).map((text, index) => `${String(item.start + index).padStart(4)}| ${text}`).join('\n')).join('\n')
  const describe = (item: Diag) => `line ${item.line}: ${item.code}: ${item.message}`.slice(0, 420)
  const references = relevantReferences(root, file, source, window, [target.target, ...target.cluster])
  const accumulator = cause?.kind === 'ACCUMULATOR_SEED' ? cause.accumulator : null
  const rootSection = cause?.kind === 'IMPORT' ? [
    `TARGET:\nthe import section (lines ${cause.range.start}-${cause.range.end}). The name is not missing from the code: it is not imported.`,
    `${cause.importRoot.mode === 'MOVE' ? 'SYMBOL AND ITS REAL MODULE' : 'MISSING SYMBOL'}:\n${cause.importRoot.symbol} (a ${cause.importRoot.symbolKind} exported by ${cause.importRoot.spec})`,
    cause.importRoot.mode === 'MOVE' ? `WRONG MODULE. This import takes ${cause.importRoot.symbol} from a module that does not export it:\n${cause.importRoot.existing}\nREMOVE ${cause.importRoot.symbol} from this import (keep every other name; drop the whole line only if it was the only name) and add exactly one new line: import ${cause.importRoot.symbolKind === 'type' ? 'type ' : ''}{ ${cause.importRoot.symbol} } from '${cause.importRoot.spec}'` : cause.importRoot.mode === 'AUGMENT' ? `EXISTING IMPORT OF THAT MODULE (add the symbol to this named import; do not add a second import of the module):\n${cause.importRoot.existing}` : `NO IMPORT OF THAT MODULE YET. Add exactly one line: import ${cause.importRoot.symbolKind === 'type' ? 'type ' : ''}{ ${cause.importRoot.symbol} } from '${cause.importRoot.spec}'\nLAST IMPORT (keep it, then the new line):\n${cause.importRoot.existing}`,
  ].join('\n') : cause?.kind === 'EMPTY_ARRAY_TYPE' ? [
    `TARGET:\nthe empty-array declaration of '${cause.emptyArray.property}' (lines ${cause.range.start}-${cause.range.end}). push fails because an empty array has element type never.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${cause.emptyArray.current}`,
    `PUSHED VALUE TYPE:\n${cause.emptyArray.pushedType || 'see the push in the window'}`,
    `EXPECTED ARRAY ELEMENT TYPE:\nthe type of the pushed value. Your content is ONLY the replacement for the fragment above, on one line (for example \`${cause.emptyArray.property}: ElementType[]\`), never the whole line.`,
  ].join('\n') : cause?.kind === 'MEMBER_ACCESS' ? [
    `TARGET:\n${cause.member.keepsMethod ? `the receiver \`${cause.member.expression}\` (line ${cause.range.start}). It has no member '${cause.member.missing}' because it is not the collection: the collection is somewhere inside it. The \`.${cause.member.missing}\` after it stays exactly as it is.` : `the access \`${cause.member.expression}\` (line ${cause.range.start}). '${cause.member.missing}' is not a member of ${cause.member.typeName}.`}`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${cause.member.expression}`,
    ...(cause.member.primitive ? [`\`${cause.member.expression.slice(0, cause.member.expression.lastIndexOf('.'))}\` is a ${cause.member.primitive}, not an object: it has no '${cause.member.missing}'. Write the value itself (the part before the dot), or a real ${cause.member.primitive} method if a transformation is needed.`] : []),
    ...(cause.member.primitive ? [] : [`REAL MEMBERS OF ${cause.member.typeName} (use only these; one of them may itself hold what you need, for example a nested collection):\n${cause.member.members.join('\n')}`]),
    cause.member.nested.length ? `MEMBER PATHS THAT MATCH WHAT THE CODE ASKS FOR '${cause.member.missing}' (searched up to three levels down; start from one of these):\n${cause.member.nested.join('\n')}` : '',
    cause.member.called && cause.member.callbackKind ? `COLLECTION CALL: the callback after this access ${cause.member.callbackKind === 'value' ? 'builds a new value from each item' : 'answers a yes/no question about each item'}, so the method that was meant is one of: ${cause.member.methods.join(', ')}. The first is the most likely. Your content is the member path followed by that method name.` : '',
    cause.member.called ? `NOTE: this access is CALLED with (...) right after it, but a member that holds a collection is an array, not a function. Your answer must therefore end with an array method that fits the callback that follows (for example \`.map\` if it turns each item into something else, \`.filter\` if it keeps some items), e.g. \`receiver.path.map\`.` : '',
    cause.member.keepsMethod ? `Your content is ONLY the replacement for the receiver (a member path such as the ones listed, starting from \`${cause.member.expression}\`), on one line, WITHOUT \`.${cause.member.missing}\`: it is already after the fragment and stays.` : 'Your content is ONLY the replacement for that access expression (for example `receiver.member` or `receiver.member.other`), on one line. Do not touch the rest of the line.',
  ].join('\n') : cause?.kind === 'STATE_TYPE' ? [
    `TARGET:\nthe React state '${cause.state.name}' (line ${cause.range.start}). It is created with ${cause.state.initial}, so it has no type: every field read from it below is an error. The reads are not the problem; this declaration is.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${cause.state.initial}`,
    `FIELDS READ FROM '${cause.state.name}' (what the type must have):\n${cause.state.fields.join(', ') || '(none found)'}`,
    `TYPE CANDIDATES (best first; use one of these, spelled as shown):\n${cause.state.candidates.join('\n') || '(none found in the imports; use a type from the reference below)'}`,
    cause.state.setterCalls.length ? `HOW THE SETTER IS CALLED (the type must accept these values):\n${cause.state.setterCalls.join('\n')}` : '',
    `Give the state its type with the smallest bounded edit: ${cause.state.array ? 'for an array write `useState<Item[]>([])`' : 'for an object write `useState<Thing>({} as Thing)` (or `useState<Thing | null>(null)` only if every read is already guarded)'}. Your content is ONLY the replacement for that useState(...) call, on one line.`,
  ].join('\n') : cause?.kind === 'STUB_VALUE' ? [
    `TARGET:\nthe property '${cause.stub.name}' (line ${cause.range.start}). It was emptied to silence the type checker, which deletes real data.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${source.slice(cause.stub.from, cause.stub.to)}`,
    `THE REAL VALUE (declared above and never used):\n${cause.stub.declaration}`,
    `Use the real value: write \`${cause.stub.name}\` (shorthand) or \`${cause.stub.name}: ${cause.stub.name}\`. Do not replace it with another empty literal. If the real value's type is wrong for the field, fix that with a default (??) or a conversion, not by deleting the data. Your content is ONLY the replacement for that property, on one line.`,
  ].join('\n') : cause?.kind === 'VALUE_SHAPE' ? [
    `TARGET:\nthe property '${cause.value.name}' (line ${cause.range.start}). Its name is right; its VALUE has the wrong type.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${source.slice(cause.value.from, cause.value.to)}`,
    `FOUND TYPE:\n${cause.value.found}`,
    `EXPECTED TYPE:\n${cause.value.expected}`,
    `CURRENT PROPERTY:\n${cause.value.name}`,
    `CURRENT VALUE EXPRESSION:\n${cause.value.value}`,
    `Make the smallest valid edit that makes the VALUE satisfy the expected type. ${/^(string)$/.test(cause.value.expected.trim()) ? 'The field must be a string: do not leave a numeric value. ' : ''}${/\|\s*(undefined|null)/.test(cause.value.found) && !/\|\s*(undefined|null)/.test(cause.value.expected) ? 'The field must be a definite value: do not leave undefined/null possible (use ?? with a real default, or a guard). ' : ''}Your content is ONLY the replacement for that property, on one line, in the form \`${cause.value.name}: <value>\`.`,
  ].join('\n') : cause?.kind === 'TOKEN_FIX' ? [
    `TARGET:\nthe single token at line ${cause.range.start}. ${cause.token.why}`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${cause.token.text}`,
    `COMPILER SUGGESTS:\n${cause.token.suggestion}`,
    'Your content is ONLY the replacement for that token, on one line.',
  ].join('\n') : cause?.kind === 'PROPERTY_EXPRESSION' ? [
    `TARGET:\nthe expression that produces property '${cause.property.name}' (lines ${cause.range.start}-${cause.range.end}). The reported line only returns it; this is where its type is wrong.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${cause.property.current}`,
    `FOUND TYPE:\n${cause.property.found}`,
    `EXPECTED TYPE:\n${cause.property.expected}`,
    `CURRENT EXPRESSION:\n${propertyValueText(cause.property)}`,
    `SMALLEST VALID REPAIRS (choose one; your content must differ from the current text, an unchanged copy is rejected as NO_CHANGE):\n${propertyRepairOptions(cause.property).join('\n')}`,
    `Your content is ONLY the replacement for the fragment above, on one line (for example \`${cause.property.name}: <expression of the expected type>\`), never the whole line.`,
  ].join('\n') : accumulator ? [
    `TARGET:\nreduce accumulator seed/type (lines ${accumulator.seed.start}-${accumulator.seed.end}). The errors below are symptoms of the untyped empty seed.`,
    `REPLACE EXACTLY THIS TEXT (only this fragment is writable):\n${source.slice(accumulator.seedSpan.from, accumulator.seedSpan.to)}`,
    `RELATED DIAGNOSTICS (all fixed by typing the accumulator):\n${accumulator.related.map(describe).join('\n')}`,
    `KEY TYPE:\n${accumulator.keyType}`,
    `EXPECTED VALUE TYPE (what the callback stores into the accumulator; write a type for it):\n${accumulator.valueShapes.join('\n') || 'see the callback in the window'}`,
    accumulator.itemType ? `TYPE OF ONE ITEM BEING REDUCED (valid as written; use it for array elements):\n${accumulator.itemType}` : '',
  ].join('\n') : ''
  const text = [
    `FILE:\n${file}`,
    rootSection,
    `TARGET DIAGNOSTIC:\n${describe(target.target)}${target.cluster.length ? `\nSAME ROOT CAUSE (fix together):\n${target.cluster.map(describe).join('\n')}` : ''}`,
    hintFor(target.target.code) ? `WHAT THIS MEANS:\n${hintFor(target.target.code)}` : '',
    callbackItemType(target.target) ? `THE ITEMS OF THIS COLLECTION ARE: ${callbackItemType(target.target)}\nThe callback receives one item of that type. Its parameter must be that type (or have no annotation) and the callback body must use the item as that type: if the items are strings, the body uses the string itself, never fields such as .name or .value. Your answer must differ from the current code.` : '',
    target.target.code === 'runtime:FAILURE' ? (() => { const reads = runtimeReads(root, file, source, target.target.line); return reads.length ? `WHAT THE FAILING ASSERTION READS (the real members; the expectation must use fields that exist):\n${reads.join('\n')}` : '' })() : '',
    target.target.code === 'runtime:FAILURE' ? (() => {
      const hints = literalHints(root, file, target.lineText)
      if (!hints.length) return ''
      // The text is stored under a key (`label: '...'`): the item field whose name contains that key is where the test should look.
      const keys = hints.map(item => /\[stored under the key '([^']+)'\]/.exec(item)?.[1]).filter((item): item is string => Boolean(item))
      const fields = runtimeReads(root, file, source, target.target.line).flatMap(line => { const [name, members] = line.split(': '); return (members ?? '').split(', ').filter(member => keys.some(key => member.toLowerCase().includes(key.toLowerCase()))).map(member => `${name}.${member}`) })
      return `REAL TEXT IN THE CODE UNDER TEST (restore the expectation to wording that really exists):\n${hints.join('\n')}${fields.length ? `\nTHE FIELD THAT HOLDS THIS TEXT (check this field, not another one): ${fields.join(', ')}\nTHIS LINE HAS MORE THAN ONE PROBLEM: the field it reads is wrong AND the quoted text does not exist in the code under test. The assertion only passes when ONE replacement line fixes BOTH: it must read ${fields[0]} and quote wording that really exists (a leading part of the real text above is enough).` : ''}`
    })() : '',
    strayWord(target) ? `THE WHOLE LINE IS ONLY THE WORD '${strayWord(target)}': it is a leftover fragment, not a use of something that needs importing. Remove it, or complete it into what it was meant to be (a directive is a string: for example 'use client' at the top of a React component file).` : '',
    `SOURCE LINE:\n${target.lineText.trim()}`,
    `CURRENT CODE WINDOW (lines ${window.start}-${window.end}; the numbers are not part of the code):\n${shown}`,
    `PATCH RANGE:\nstartLine=${patchRange.start} endLine=${patchRange.end}. Your content replaces exactly these lines - ${cause?.kind === 'IMPORT' ? 'the import only. Write the import line(s) again with the symbol added' : cause?.kind === 'EMPTY_ARRAY_TYPE' || cause?.kind === 'PROPERTY_EXPRESSION' || cause?.kind === 'TOKEN_FIX' || cause?.kind === 'MEMBER_ACCESS' || cause?.kind === 'VALUE_SHAPE' || cause?.kind === 'STUB_VALUE' || cause?.kind === 'STATE_TYPE' || cause?.kind === 'ACCUMULATOR_SEED' ? 'only the fragment shown under REPLACE EXACTLY THIS TEXT. Your content is the replacement for that fragment alone (one line); the executive keeps everything else on the line' : accumulator ? 'the seed fragment only. Your content is the typed seed expression on one line (for example `{} as Record<KeyType, ValueType>`)' : 'one complete statement. Write the whole statement again, with the fix'}. Keep every closing bracket and parenthesis that is on those lines. Do not repeat lines from outside the range.`,
    declarations ? `WHERE THE NAMES ON THE TARGET LINE ARE DECLARED (the cause may be here):\n${declarations}` : '',
    references ? `RELEVANT TYPE/IMPORT REFERENCE (read-only; it is the truth - change the code in the window to match it, never the reference):\n${references}` : '',
    target.attempt > 0 ? 'A previous patch for this diagnostic was rejected or changed nothing. Make a smaller, different change.' : '',
    !cause && ledgerNote ? `WHAT HAPPENED WITH THE NARROW EDIT YOU TRIED FIRST:\n${ledgerNote}\nFix BOTH the target and what it exposed in this one statement. If an explicit type annotation you or the file wrote conflicts with the real type, remove or correct the annotation (let the type be inferred) instead of keeping it.` : '',
    cause ? `TASK:\n${cause.kind === 'IMPORT' ? 'Make the smallest bounded import edit' : cause.kind === 'EMPTY_ARRAY_TYPE' ? 'Give the array its element type with the smallest bounded edit' : cause.kind === 'PROPERTY_EXPRESSION' ? 'Make the expression produce the expected type with the smallest bounded edit' : cause.kind === 'TOKEN_FIX' ? 'Replace the token as the compiler suggests, with the smallest bounded edit' : cause.kind === 'MEMBER_ACCESS' ? 'Use a real member of the type, with the smallest bounded edit' : cause.kind === 'VALUE_SHAPE' ? 'Make the value satisfy the expected type, with the smallest bounded edit' : cause.kind === 'STUB_VALUE' ? 'Use the real value instead of the empty literal, with the smallest bounded edit' : cause.kind === 'STATE_TYPE' ? 'Give the React state its type, with the smallest bounded edit' : 'Type the accumulator correctly with the smallest bounded edit'}, inside the PATCH RANGE only. Return exactly one bounded PATCH_FILE.` : '',
    cause ? '' : `TASK:\nFix THIS diagnostic only, by changing the code in the PATCH RANGE of ${file}. Return exactly one bounded PATCH_FILE. Do not rewrite the file. Do not alter unrelated behavior.`,
  ].filter(Boolean).join('\n')
  return { file, target, window, patchRange, text, remaining: diags.length }
}

/* ------------------------------------------------ the monotonic accept / reject ------------------------------------------------ */

export type PatchOutcome =
  | { ok: true; content: string; before: number; after: number; summary: string }
  | { ok: false; error: string }

const isBalanced = (text: string): boolean => { const stack: string[] = []; for (const ch of text) { if ('([{'.includes(ch)) stack.push(ch); else if (')]}'.includes(ch)) { const open = stack.pop(); if (!open || '([{'.indexOf(open) !== ')]}'.indexOf(ch)) return false } } return stack.length === 0 }

/**
 * A model that is asked for one fragment often also echoes the punctuation that continues on the same line (a trailing `)` of `);`, a leading
 * `}, ` of `}, {}`). Such partial echoes are dropped only when the fragment is unbalanced as given and balanced once the echo is removed:
 * a legitimate bracket is never removed.
 */
export function stripEchoedPunctuation(fragment: string, before: string, after: string): string {
  const out = fragment.trim()
  if (isBalanced(out)) return out
  const tail = after.trim()
  for (let n = Math.min(tail.length, 6); n >= 1; n--) {
    const echo = tail.slice(0, n)
    if (out.endsWith(echo) && isBalanced(out.slice(0, out.length - n).trimEnd())) return out.slice(0, out.length - n).trimEnd()
  }
  const head = before.trim()
  for (let n = Math.min(head.length, 6); n >= 1; n--) {
    const echo = head.slice(head.length - n)
    if (out.startsWith(echo) && isBalanced(out.slice(n).trimStart())) return out.slice(n).trimStart()
  }
  return out
}

const isPunctuationOnly = (line: string) => /^[\s{}()[\];,]*$/.test(line)

/**
 * The model sometimes echoes the read-only lines shown around the patch range. Exact copies of the unchanged lines immediately before the range
 * (at the start of the replacement) or immediately after it (at the end) are dropped; anything else, including a legitimate edit, is kept as is.
 * Blank lines are ignored when matching, punctuation-only lines are never treated as copies, and a replacement that would become empty is kept.
 */
export function stripBoundaryCopies(source: string, startLine: number, endLine: number, replacement: string, context = 3): { replacement: string; strippedBefore: number; strippedAfter: number } {
  const lines = source.split('\n')
  const raw = replacement.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  let body = raw.every(line => /^\s*\d+\|\s?/.test(line)) ? raw.map(line => line.replace(/^\s*\d+\|\s?/, '')) : raw
  const pre = lines.slice(Math.max(0, startLine - 1 - context), startLine - 1).filter(line => line.trim())
  const post = lines.slice(endLine, endLine + context).filter(line => line.trim())
  const norm = (line: string) => line.trim()
  let strippedBefore = 0
  let strippedAfter = 0
  // Leading run: the longest suffix of the pre-context that the replacement starts with.
  for (let n = pre.length; n >= 1; n--) {
    const want = pre.slice(pre.length - n).map(norm)
    const lead = body.filter(line => line.trim()).slice(0, n).map(norm)
    if (lead.length === n && want.every((line, i) => line === lead[i]) && want.some(line => !isPunctuationOnly(line))) {
      let seen = 0
      let cut = 0
      while (cut < body.length && seen < n) { if (body[cut].trim()) seen += 1; cut += 1 }
      if (body.slice(cut).some(line => line.trim())) { body = body.slice(cut); strippedBefore = n }
      break
    }
  }
  // Trailing run: the longest prefix of the post-context that the replacement ends with.
  for (let n = post.length; n >= 1; n--) {
    const want = post.slice(0, n).map(norm)
    const tail = body.filter(line => line.trim()).slice(-n).map(norm)
    if (tail.length === n && want.every((line, i) => line === tail[i]) && want.some(line => !isPunctuationOnly(line))) {
      let seen = 0
      let cut = body.length
      while (cut > 0 && seen < n) { cut -= 1; if (body[cut].trim()) seen += 1 }
      if (body.slice(0, cut).some(line => line.trim())) { body = body.slice(0, cut); strippedAfter = n }
      break
    }
  }
  return { replacement: body.join('\n'), strippedBefore, strippedAfter }
}

export function applyLinePatch(source: string, startLine: number, endLine: number, replacement: string): string {
  const lines = source.split('\n')
  const stripped = replacement.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  // The model sees numbered lines; if it echoes the numbers back, they are not code.
  const body = stripped.every(line => /^\s*\d+\|\s?/.test(line)) ? stripped.map(line => line.replace(/^\s*\d+\|\s?/, '')) : stripped
  return [...lines.slice(0, startLine - 1), ...body, ...lines.slice(endLine)].join('\n')
}

const lineKey = (diag: Diag, lines: string[]) => `${diag.code}|${diag.message}|${(lines[diag.line - 1] ?? '').trim()}`

/**
 * Evaluate ONE candidate bounded patch against the authoritative diagnostics, without touching the file. Accept only when the candidate stays
 * syntactically valid and either the error count drops, or the selected error is gone with nothing worse. The caller writes `content` on ok;
 * on !ok the file on disk is the checkpoint and stays as it is.
 */
export function evaluatePatch(root: string, file: string, input: { startLine: number; endLine: number; replacement: string }): PatchOutcome {
  const abs = path.join(root, file)
  const source = readFileSync(abs, 'utf8')
  const lines = source.split('\n')
  const { startLine, endLine } = input
  if (![startLine, endLine].every(Number.isInteger) || startLine < 1 || endLine < startLine || endLine > lines.length) return { ok: false, error: `PATCH_REJECTED: startLine/endLine must be whole numbers inside the file (1-${lines.length}) with startLine <= endLine.` }
  if (endLine - startLine + 1 > MAX_PATCH_SPAN_LINES) return { ok: false, error: `PATCH_REJECTED: a patch may replace at most ${MAX_PATCH_SPAN_LINES} lines; this one names ${endLine - startLine + 1}. Patch the target lines only.` }
  if (input.replacement.split('\n').length > MAX_REPLACEMENT_LINES) return { ok: false, error: `PATCH_REJECTED: the replacement is over ${MAX_REPLACEMENT_LINES} lines. Return a smaller patch.` }
  const ledger = loadLedger(file)
  const oldDiags = diagnoseAll(root, file)
  const selection = selectTarget(oldDiags, source, ledger, (diag, full) => rootCauseFor(root, file, source, diag, oldDiags, full))
  const cause = selection?.cause ?? null
  const noteRejection = (message: string) => {
    if (!selection) return
    const fresh = loadLedger(file)
    fresh.notes = { ...(fresh.notes ?? {}), [diagnosticIdentity(selection.target, selection.lineText)]: message.replace(/\s+/g, ' ').slice(0, 420) }
    saveLedger(fresh)
  }
  const record = (key: string | undefined, kind: Try['kind'], candidate: string) => {
    if (!key) return
    ledger.tries[key] = [...(ledger.tries[key] ?? []), { kind, candidate: sha(candidate), at: new Date().toISOString() }]
    saveLedger(ledger)
  }
  if (cause && (startLine !== cause.range.start || endLine !== cause.range.end)) {
    record(selection?.key, 'REJECTED', `${startLine}-${endLine}:${input.replacement}`)
    return { ok: false, error: `PATCH_REJECTED: the root cause of this diagnostic is at lines ${cause.range.start}-${cause.range.end}; that is the only writable range (you named ${startLine}-${endLine}). The file is unchanged.` }
  }
  let trimmed = stripBoundaryCopies(source, startLine, endLine, input.replacement)
  let candidate: string
  const span = fragmentOf(cause)
  if (span) {
    let fragment = input.replacement.replace(/\r?\n$/, '')
    if (!fragment.trim() || fragment.split('\n').length > MAX_FRAGMENT_LINES) {
      record(selection?.key, 'REJECTED', `fragment:${input.replacement}`)
      return { ok: false, error: `PATCH_REJECTED: content must be the replacement for the fragment under REPLACE EXACTLY THIS TEXT (at most ${MAX_FRAGMENT_LINES} lines), not the whole line. The file is unchanged.` }
    }
    // The model sometimes echoes the unchanged text that surrounds the fragment on its line: exact copies of that prefix/suffix are dropped (nothing else is).
    const before = source.slice(source.lastIndexOf('\n', span.from - 1) + 1, span.from)
    const afterEnd = source.indexOf('\n', span.to)
    const after = source.slice(span.to, afterEnd === -1 ? source.length : afterEnd)
    if (before.trim().length >= 3 && fragment.trimStart().startsWith(before.trim())) fragment = fragment.trimStart().slice(before.trim().length)
    if (after.trim().length >= 1 && fragment.trimEnd().endsWith(after.trim())) fragment = fragment.trimEnd().slice(0, fragment.trimEnd().length - after.trim().length)
    fragment = stripEchoedPunctuation(fragment, before, after)
    // The method that follows the receiver stays in the file: when the answer repeats it (and whatever follows), only the receiver in front of it is the answer.
    if (cause?.kind === 'MEMBER_ACCESS' && cause.member.keepsMethod) {
      const echoed = new RegExp(`\\.${cause.member.missing}\\b`).exec(fragment)
      if (echoed && echoed.index > 0) {
        const receiver = fragment.slice(0, echoed.index).trim()
        if (receiver && !receiver.includes('\n') && isBalanced(receiver)) fragment = receiver
      }
    }
    if (!fragment.trim()) {
      record(selection?.key, 'REJECTED', `fragment:${input.replacement}`)
      return { ok: false, error: 'PATCH_REJECTED: nothing is left after removing the copied surrounding text; give the replacement for the fragment itself. The file is unchanged.' }
    }
    trimmed = { replacement: fragment.trim(), strippedBefore: 0, strippedAfter: 0 }
    candidate = source.slice(0, span.from) + trimmed.replacement + source.slice(span.to)
  } else candidate = applyLinePatch(source, startLine, endLine, trimmed.replacement)
  // An implementation patch that pastes the validator's whole expected text makes the test pass without fixing anything: that is gaming the test, not a repair.
  if (selection?.target.code === 'runtime:FAILURE' && /the expectation is right/.test(selection.target.message)) {
    const required = /the required text is '([^']{4,})'/.exec(selection.target.message)?.[1]
    const patchedRegion = candidate.split('\n').slice(startLine - 1, startLine - 1 + trimmed.replacement.split('\n').length + 2).join('\n')
    if (required && (patchedRegion.includes(`'${required}'`) || patchedRegion.includes(`"${required}"`) || patchedRegion.includes('`' + required + '`'))) {
      record(selection.key, 'REJECTED', candidate)
      return { ok: false, error: 'PATCH_REJECTED: the patch contains the exact text the validator expects as a literal: that special-cases the test instead of producing the text from the data. Build the text from the values the code already has. The file is unchanged.' }
    }
  }
  // A model that identifies the property but leaves its value alone is not a no-op for a value-shape cause: the paired value correction may still apply.
  const unchanged = candidate === source
  const valueCause = cause?.kind === 'VALUE_SHAPE' || cause?.kind === 'PROPERTY_EXPRESSION'
  const noChange = () => {
    record(selection?.key, 'NO_CHANGE', candidate)
    return { ok: false as const, error: `NO_CHANGE: the patch leaves lines ${startLine}-${endLine} exactly as they are. Change the code on the target line.` }
  }
  if (introducesStrayCharacters(file, source, candidate)) {
    record(selection?.key, 'REJECTED', candidate)
    return { ok: false, error: 'PATCH_REJECTED: the patch adds stray non-code characters (CJK/full-width text) to the source: that is corrupted output, not an edit. Write plain ASCII code only. The file is unchanged.' }
  }
  if (unchanged && !valueCause) return noChange()
  // The same candidate for the same target and source is not tried twice.
  const candidateDigest = sha(candidate)
  if (!unchanged && selection && (ledger.tries[selection.key] ?? []).some(item => item.candidate === candidateDigest)) {
    record(selection.key, 'REJECTED', candidate)
    return { ok: false, error: 'PATCH_REJECTED: this exact patch was already tried for this diagnostic on this source. Make a different, smaller change.' }
  }
  if (cause?.kind === 'IMPORT') {
    const before = importCounts(source)
    const after = importCounts(candidate)
    const duplicated = [...after.bySpec].some(([spec, count]) => count > Math.max(1, before.bySpec.get(spec) ?? 0))
    const limit = cause.importRoot.mode === 'ADD' || cause.importRoot.mode === 'MOVE' ? before.total + 1 : before.total
    if (duplicated || after.total > limit || after.total < before.total || trimmed.replacement.split('\n').length > cause.maxReplacementLines) {
      record(selection?.key, 'REJECTED', candidate)
      return { ok: false, error: `PATCH_REJECTED: an import repair may ${cause.importRoot.mode === 'ADD' || cause.importRoot.mode === 'MOVE' ? 'add exactly one import line' : 'only add the symbol to the existing import'}, never duplicate an import of a module or drop one. The file is unchanged.` }
    }
  }
  const oldSyntax = oldDiags.filter(item => item.syntactic).length
  // Gone means fewer diagnostics of that kind remain, not that the edited line reads differently: an edit that merely moves the same error does not count.
  // For missing-member/name errors the identity is the missing name, not the type text: `map` missing on S and `map` missing on string are the same unfixed defect.
  const identityOf = (item: Diag) => item.code.startsWith('runtime:') ? `${item.code}|line ${item.line}` : /^TS(2339|2551|2552|2304|2305|2459|2614)$/.test(item.code) ? `${item.code}|${/'([^']+)'/.exec(item.message)?.[1] ?? item.message}` : `${item.code}|${item.message}`
  const sameKind = (list: Diag[], like: Diag) => list.filter(item => identityOf(item) === identityOf(like)).length
  const oldCodes = new Set(oldDiags.map(item => item.code))
  /** One set of rules for every candidate (the model's edit, a paired candidate, a control): syntax, target, total, and new kinds of error. */
  const judge = (cand: string) => {
    const diags = diagnoseAll(root, file, { [file]: cand })
    const candLines = cand.split('\n')
    const syntaxBroken = diags.filter(item => item.syntactic).length > oldSyntax
    const gone = selection ? sameKind(diags, selection.target) < sameKind(oldDiags, selection.target) : false
    const better = diags.length < oldDiags.length || (gone && diags.length <= oldDiags.length)
    // A decrease bought by a NEW diagnostic family is the defect moving, not being fixed. New kinds of error are tolerated only when they are
    // errors the edit merely UNMASKED elsewhere (outside the patched lines) and the patch removes strictly more errors than it reveals with a lower total;
    // an error created by the patch's own text, or any new kind with no net gain, is rejected.
    const fresh = diags.filter(item => !oldCodes.has(item.code))
    const patchedLast = startLine + (candLines.length - lines.length) + (endLine - startLine)
    const freshInside = fresh.filter(item => item.line >= startLine && item.line <= patchedLast)
    // One root cause can clear a whole cluster (an untyped state removes every `{}` read error at once): the cluster counts as what the patch removed.
    const clusterOf = (list: Diag[]) => list.filter(item => item.code === 'TS2339' && /does not exist on type '(\{\}|never\[\]|never)'/.test(item.message)).length
    const removed = selection ? (cause?.kind === 'STATE_TYPE' ? clusterOf(oldDiags) - clusterOf(diags) : sameKind(oldDiags, selection.target) - sameKind(diags, selection.target)) : 0
    const hidden = fresh.length > 0 && freshInside.length === 0 && diags.length < oldDiags.length && fresh.length < removed
    return { diags, candLines, syntaxBroken, gone, better, fresh, hidden, acceptable: !syntaxBroken && better && (fresh.length === 0 || hidden) }
  }
  let verdict = unchanged ? { diags: oldDiags, candLines: lines, syntaxBroken: false, gone: false, better: false, fresh: [] as Diag[], hidden: false, acceptable: false } : judge(candidate)
  // Paired repair (Commander-approved, narrow): the model's receiver fix and the removal of the callback's conflicting parameter annotation are ONE root
  // cause. The combined candidate is used only when the model's edit alone is not acceptable, the combination is, and the annotation removal alone
  // would not have helped: so both edits are required, and nothing else in the file is touched.
  let pairedNote = ''
  if (!verdict.acceptable && !verdict.syntaxBroken && cause?.kind === 'MEMBER_ACCESS' && cause.member.keepsMethod && cause.member.callbackAnnotations.length && span) {
    const edits = [{ from: span.from, to: span.to, text: trimmed.replacement }, ...cause.member.callbackAnnotations.map(item => ({ from: item.from, to: item.to, text: '' }))].sort((x, y) => y.from - x.from)
    const apply = (list: typeof edits) => list.reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), source)
    const paired = apply(edits)
    const annotationOnly = apply(edits.filter(edit => edit.text === ''))
    const combined = judge(paired)
    const control = judge(annotationOnly)
    if (combined.acceptable && !control.acceptable) {
      candidate = paired
      verdict = combined
      pairedNote = `; paired repair: the callback's ${cause.member.callbackAnnotations.length} conflicting parameter annotation(s) on the same call were removed with the receiver fix (both edits were needed)`
    }
  }
  // Collection call (Commander-approved): the model found the real collection but wrote only the path where a collection METHOD is needed. The methods that fit the
  // callback's shape (map/flatMap/forEach for a value, filter/find/some/every for a test) are tried in order; the first acceptable candidate is used.
  if (!verdict.acceptable && !verdict.syntaxBroken && !unchanged && span && cause?.kind === 'MEMBER_ACCESS' && cause.member.called && cause.member.methods.length && !cause.member.keepsMethod) {
    const answer = trimmed.replacement
    if (!/\.[A-Za-z]+$/.test(answer) || !cause.member.methods.some(method => answer.endsWith(`.${method}`))) {
      for (const method of cause.member.methods) {
        const completion = { from: span.from, to: span.to, text: `${answer}.${method}` }
        const apply = (edits: Array<{ from: number; to: number; text: string }>) => [...edits].sort((x, y) => y.from - x.from).reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), source)
        const withMethod = apply([completion])
        // The callback's own parameter annotations belong to the same root cause (as in the receiver pairing): tried only after the plain completion is not acceptable.
        const variants = [withMethod, ...(cause.member.callbackAnnotations.length ? [apply([completion, ...cause.member.callbackAnnotations.map(item => ({ from: item.from, to: item.to, text: '' }))])] : [])]
        let done = false
        for (const [index, variant] of variants.entries()) {
          const attempt = judge(variant)
          if (attempt.acceptable) {
            candidate = variant
            verdict = attempt
            pairedNote = `${pairedNote}; collection call: the model's path was completed with .${method}, the method that fits the callback (${cause.member.callbackKind})${index === 1 ? ' and the callback\'s conflicting parameter annotation(s) were removed' : ''}`
            done = true
            break
          }
        }
        if (done) break
      }
    }
  }
  // Paired value-shape repair (Commander-approved, narrow): the model's name/member/root-cause edit is right but the VALUE still has the wrong type, and the
  // two must change together. The executive adds only the correction that the diagnostic's own found/expected types prove (number<->string, T|undefined -> T),
  // to the one property in the same cluster, and only when the model's edit alone is not acceptable and the paired candidate is.
  if (!verdict.acceptable && !verdict.syntaxBroken && span) {
    const shapeOf = (): { found: string; expected: string; name: string } | null => {
      if (cause?.kind === 'VALUE_SHAPE') return { found: cause.value.found, expected: cause.value.expected, name: cause.value.name }
      if (cause?.kind === 'PROPERTY_EXPRESSION') return { found: cause.property.found, expected: cause.property.expected, name: cause.property.name }
      return null
    }
    let paired: string | null = null
    const shape = shapeOf()
    if (shape) {
      const given = unchanged ? source.slice(span.from, span.to) : trimmed.replacement
      const bare = new RegExp(`^${shape.name}\\s*:\\s*`).test(given) ? given.replace(new RegExp(`^${shape.name}\\s*:\\s*`), '') : given
      // An empty literal is never a value to correct: coercing it (`[] ?? []`) would just be a stub in disguise.
      const coerced = /^(\[\s*\]|\{\s*\}|''|""|null|undefined)\s*[,;]?$/.test(bare.trim()) ? null : coerceValue(bare, shape.found, shape.expected)
      if (coerced) paired = source.slice(0, span.from) + `${shape.name}: ${coerced}` + source.slice(span.to)
    } else if (cause?.kind === 'TOKEN_FIX') {
      // A renamed property whose (unchanged) value now fails: found/expected come from the diagnostic the rename exposed on that property.
      const patchedLast = startLine + (verdict.candLines.length - lines.length) + (endLine - startLine)
      const exposed = verdict.diags.find(item => item.code === 'TS2322' && item.line >= startLine && item.line <= patchedLast)
      const types = exposed ? /^Type '(.+?)' is not assignable to type '(.+?)'\.(?: |$)/.exec(exposed.message) : null
      if (types) {
        const sf = parseSource(candidate)
        let property: ts.PropertyAssignment | null = null
        const find = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getStart(sf) === span.from) property = node; ts.forEachChild(node, find) }
        find(sf)
        const found = property as ts.PropertyAssignment | null
        const coerced = found ? coerceValue(found.initializer.getText(sf), types[1], types[2]) : null
        if (found && coerced) paired = candidate.slice(0, found.initializer.getStart(sf)) + coerced + candidate.slice(found.initializer.getEnd())
      }
    }
    if (paired && paired !== candidate && paired !== source) {
      const combined = judge(paired)
      if (combined.acceptable) {
        candidate = paired
        verdict = combined
        pairedNote = `${pairedNote}; paired value repair: the value was corrected together with the model's edit (the diagnostic proved found/expected types)`
      }
    }
  }
  // Paired import (narrow): the model's edit is right but uses a name that is not imported, and ONLY that (the new errors in the patched lines are all "cannot find name"
  // for names that exactly one reachable module exports). The import is the directly required consequence of the same edit: an existing import of that module gets the name,
  // otherwise one import line is added. Used only when the combined candidate is acceptable.
  if (!verdict.acceptable && !verdict.syntaxBroken && !unchanged) {
    const patchedLast = startLine + (verdict.candLines.length - lines.length) + (endLine - startLine)
    const freshInside = verdict.fresh.filter(item => item.line >= startLine && item.line <= patchedLast)
    const missingNames = freshInside.filter(item => item.code === 'TS2304')
    if (freshInside.length > 0 && missingNames.length === freshInside.length && verdict.fresh.length === freshInside.length) {
      const sf = parseSource(candidate)
      const edits: Array<{ from: number; to: number; text: string }> = []
      const handled = new Set<string>()
      let ok = true
      for (const diag of missingNames) {
        const resolved = importRoot(root, file, candidate, diag)
        if (!resolved || handled.has(resolved.importRoot.symbol)) { if (!resolved) ok = false; continue }
        handled.add(resolved.importRoot.symbol)
        const symbol = resolved.importRoot.symbol
        if (resolved.importRoot.mode === 'AUGMENT') {
          const decl = sf.statements.filter(ts.isImportDeclaration).find(item => ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === resolved.importRoot.spec)
          const named = decl?.importClause?.namedBindings
          if (!decl || !named || !ts.isNamedImports(named)) { ok = false; continue }
          edits.push({ from: named.getEnd() - 1, to: named.getEnd() - 1, text: `${named.elements.length ? ', ' : ''}${symbol} ` })
        } else if (resolved.importRoot.mode === 'ADD') {
          const imports = sf.statements.filter(ts.isImportDeclaration)
          const last = imports[imports.length - 1]
          const line = `import ${resolved.importRoot.symbolKind === 'type' ? 'type ' : ''}{ ${symbol} } from '${resolved.importRoot.spec}'`
          edits.push(last ? { from: last.getEnd(), to: last.getEnd(), text: `\n${line}` } : { from: 0, to: 0, text: `${line}\n` })
        } else ok = false
      }
      if (ok && edits.length) {
        const withImports = [...edits].sort((x, y) => y.from - x.from).reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), candidate)
        const combined = judge(withImports)
        if (combined.acceptable) {
          candidate = withImports
          verdict = combined
          pairedNote = `${pairedNote}; paired import: ${[...handled].join(', ')} was imported from its one defining module because the model's edit uses it`
        }
      }
    }
  }
  if (unchanged && !verdict.acceptable) return noChange()
  // Untyped state: the chosen type must also accept what the setter is given. An error left on a setter call line means the type is wrong for how the state is used.
  if (cause?.kind === 'STATE_TYPE' && verdict.acceptable) {
    const setterLines = cause.state.setterCalls.map(item => Number(/^line (\d+):/.exec(item)?.[1] ?? 0)).filter(Boolean)
    const broken = verdict.diags.find(item => setterLines.includes(item.line))
    if (broken) {
      record(selection?.key, 'REJECTED', candidate)
      noteRejection(`that type does not accept what the setter is given: line ${broken.line} ${broken.code}: ${broken.message.slice(0, 220)}`)
      return { ok: false, error: `PATCH_REJECTED: the type has the fields that are read but does not accept the values passed to the setter (line ${broken.line} ${broken.code}: ${broken.message.slice(0, 140)}). The file is unchanged.` }
    }
  }
  const { diags: newDiags, candLines: newLines, syntaxBroken, gone: targetGone, better: improves, fresh: introducedAll, hidden: unmasked } = verdict
  if (syntaxBroken) {
    record(selection?.key, 'REJECTED', candidate)
    return { ok: false, error: `PATCH_REJECTED: the patch breaks the syntax (${newDiags.find(item => item.syntactic)?.message}). The file is unchanged.` }
  }
  const introduced = introducedAll[0]
  if (improves && introduced && !unmasked) {
    record(selection?.key, 'REJECTED', candidate)
    noteRejection(`your narrow edit fixed the target but exposed another error: line ${introduced.line} ${introduced.code}: ${introduced.message.slice(0, 260)}`)
    return { ok: false, error: `PATCH_REJECTED: errors ${oldDiags.length} -> ${newDiags.length}, but the patch introduces a new kind of error (line ${introduced.line} ${introduced.code}: ${introduced.message.slice(0, 160)}); that shifts the defect instead of fixing it. The file is unchanged.` }
  }
  if (!improves) {
    record(selection?.key, 'REJECTED', candidate)
    const worse = newDiags.find(item => !oldDiags.some(old => lineKey(old, lines) === lineKey(item, newLines)))
    if (worse) noteRejection(`your narrow edit ${targetGone ? 'removed the target but' : 'did not remove it and'} produced: line ${worse.line} ${worse.code}: ${worse.message.slice(0, 260)}`)
    return { ok: false, error: `PATCH_REJECTED: errors ${oldDiags.length} -> ${newDiags.length}; the target ${targetGone ? 'went away but something as bad appeared' : 'is still there'}${worse ? ` (new: line ${worse.line} ${worse.code}: ${worse.message.slice(0, 160)})` : ''}. The file is unchanged.` }
  }
  record(selection?.key, 'ACCEPTED', candidate)
  const next = loadLedger(file)
  next.trail = [...next.trail, newDiags.length]
  saveLedger(next)
  const downstream = selection && !isDownstream(selection.target) ? oldDiags.filter(isDownstream).length - newDiags.filter(isDownstream).length : 0
  return { ok: true, content: candidate, before: oldDiags.length, after: newDiags.length, summary: `PATCH_ACCEPTED: errors ${oldDiags.length} -> ${newDiags.length} (lines ${startLine}-${endLine})${downstream > 0 ? `; ${downstream} downstream TS2322 resolved by this upstream fix` : ''}${unmasked ? `; ${introducedAll.length} existing error(s) of another kind are now visible elsewhere (they were hidden by the defect that was fixed)` : ''}${trimmed.strippedBefore + trimmed.strippedAfter ? `; ${trimmed.strippedBefore + trimmed.strippedAfter} copied context line(s) dropped` : ''}${pairedNote}.` }
}

/** True when diagnostics remain but every one of them has used up its tries on this exact source: stop repeating, escalate. */
export function repairStagnant(root: string, file: string): { stagnant: boolean; remaining: number } {
  const diags = diagnoseAll(root, file)
  if (!diags.length) return { stagnant: false, remaining: 0 }
  const source = readFileSync(path.join(root, file), 'utf8')
  return { stagnant: selectTarget(diags, source, loadLedger(file), (diag, full) => rootCauseFor(root, file, source, diag, diags, full)) === null, remaining: diags.length }
}

export { resolveRepoRoot as defaultRepairRoot }
