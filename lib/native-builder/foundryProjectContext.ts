/**
 * Phase 3 - automatic codebase context. Given only the Commander's goal and the project's files, decide which files, symbols, callers,
 * dependencies and tests Foundry needs to understand the task, keep that set bounded, explain every member, notice when it goes stale,
 * grow it only when runtime evidence points somewhere new, and survive a restart.
 *
 * Pure: no filesystem, network, clock or randomness (the caller passes file contents, hashes and timestamps). Python and JS/TS are parsed with
 * small, honest line-level parsers, not a full AST: what they cannot see they do not claim. Nothing here ever returns a secret value: env and
 * config awareness carries NAMES (and non-secret defaults), and any text that leaves this module is passed through `redactSecrets`.
 */

export type ContextLanguage = 'py' | 'js' | 'config' | 'other'
export type SymbolKind = 'function' | 'class' | 'method' | 'constant' | 'route' | 'component' | 'schema'
export type ContextRole = 'implementation' | 'consumer' | 'dependency' | 'test' | 'config' | 'contract' | 'evidence'

export type SymbolInfo = { name: string; kind: SymbolKind; line: number; endLine: number; exported: boolean; owner?: string; route?: string }
export type ImportInfo = { module: string; resolved: string | null; names: string[]; line: number }
export type EnvVar = { name: string; secret: boolean; /** A feature flag: named like one, or declared boolean. */ flag?: boolean; /** Present only when the default is a short literal and the name is not secret-like. */ default?: string; line: number }

export type FileFacts = {
  path: string
  lang: ContextLanguage
  hash: string
  lines: number
  isTest: boolean
  symbols: SymbolInfo[]
  imports: ImportInfo[]
  env: EnvVar[]
  /** Distinct identifier-like tokens, bounded. */
  tokens: string[]
}

export type SourceFile = { path: string; content: string }

export type ProjectIndex = {
  files: Record<string, FileFacts>
  contents: Record<string, string>
  /** file -> files that import it. */
  dependents: Record<string, string[]>
  /** symbol name -> definitions. */
  definitions: Record<string, { path: string; line: number; kind: SymbolKind }[]>
}

export const CONTEXT_LIMITS = {
  maxIndexedFiles: 800,
  maxFileBytes: 200_000,
  maxTokensPerFile: 1500,
  /** Files in the initial working set (tests included). */
  workingSet: 8,
  /** Hard ceiling after evidence-driven growth. */
  workingSetHardMax: 14,
  /** Files one piece of evidence may add. */
  expansionPerEvidence: 3,
  seeds: 3,
  testsPerSeed: 3,
  symbolsPerEntry: 4,
  notesChars: 900,
} as const

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Stable short content hash (djb2 over UTF-16 code units). Not cryptographic; it only detects change. */
export function contentHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}${text.length.toString(36)}`
}

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|AUTH|SESSION_?KEY|SIGNING|(^|_)KEY($|_))/i
const SECRET_FILE = /(^|\/)(\.env(\.(?!example|sample|template|dist)[^/]*)?|id_rsa[^/]*|[^/]*\.(pem|key|p12|pfx|jks)|credentials?(\.[^/]*)?|secrets?(\.[^/]*)?|\.netrc|\.npmrc|\.pypirc)$/i

/** Files whose contents must never be read into context. Env TEMPLATES (.env.example) are fine: names only are used from them. */
export function isSecretFile(rel: string): boolean {
  return SECRET_FILE.test(rel.replace(/\\/g, '/'))
}

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

export function isFlagName(name: string): boolean {
  return /(^|_)(ENABLE|ENABLED|DISABLE|DISABLED|FEATURE|FLAG|TOGGLE)(_|$)/i.test(name)
}

const TOKENISH = /\b(?:AKIA[0-9A-Z]{12,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g

/** Removes secret values from text that may reach a prompt, a persisted record or the UI. KEY = "value" with a secret-like KEY, and token-shaped strings. */
export function redactSecrets(text: string): string {
  return text
    .replace(/((?:^|[\s,{(])["']?[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|AUTH|SIGNING)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["'])[^"'\n]*\2/gi, '$1$2[redacted]$2')
    .replace(TOKENISH, '[redacted]')
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function basenameNoExt(p: string): string {
  const b = p.slice(p.lastIndexOf('/') + 1)
  return b.replace(/\.[^.]+$/, '')
}

function joinPath(...parts: string[]): string {
  const out: string[] = []
  for (const part of parts.join('/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const STOP = new Set(('a an and are as at be but by can for from has have how i if in into is it its make me my of on or our so some that the their them then there these this to up us was we what when which who will with would you your ' +
  'add adds added adding implement implements implemented update updates updated change changes changed support supports allow allows let lets new use uses using want need needs please should must also only each every any all more most just like ' +
  'feature function method code file files project app application thing things way work works working make makes making create creates created get gets set sets do does done').split(/\s+/))

/** Lower-case words of a goal, snake/camel split, stop-words removed, light stemming. */
export function goalTerms(goal: string): string[] {
  const words = goal
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !STOP.has(word))
  const stems = words.map(stem)
  return [...new Set(stems)].slice(0, 24)
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('es') && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Terms of an identifier or path: order_totals / orderTotals / order-totals -> [order, total]. */
export function identifierTerms(name: string): string[] {
  return [...new Set(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3).map(stem))]
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export function languageOf(rel: string): ContextLanguage {
  const lower = rel.toLowerCase()
  if (lower.endsWith('.py')) return 'py'
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) return 'js'
  if (/(\.env\.(example|sample|template|dist)$|\.(json|toml|ini|cfg|ya?ml)$)/.test(lower)) return 'config'
  return 'other'
}

export function isTestPath(rel: string): boolean {
  const p = normalizePath(rel).toLowerCase()
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (/^test_.*\.py$|.*_tests?\.py$|.*\.(test|spec)\.(t|j)sx?$/.test(base)) return true
  return /(^|\/)(tests?|__tests__|spec)\//.test(p) && /\.(py|tsx?|jsx?)$/.test(base) && base !== '__init__.py' && base !== 'conftest.py'
}

function pyIndent(line: string): number {
  return line.length - line.trimStart().length
}

function shortLiteral(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = raw.trim()
  const literal = /^["']([^"'\n]{0,40})["']$|^(-?\d+(?:\.\d+)?|True|False|None|true|false|null)$/.exec(text)
  return literal ? (literal[1] ?? literal[2]) : undefined
}

function parsePython(rel: string, content: string): { symbols: SymbolInfo[]; imports: Omit<ImportInfo, 'resolved'>[]; env: EnvVar[] } {
  const lines = content.split('\n')
  const symbols: SymbolInfo[] = []
  const imports: Omit<ImportInfo, 'resolved'>[] = []
  const env: EnvVar[] = []
  const classStack: { name: string; indent: number }[] = []
  let pendingRoute: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = pyIndent(line)
    while (classStack.length && indent <= classStack[classStack.length - 1].indent && !trimmed.startsWith('@')) classStack.pop()
    const route = /^@\s*[\w.]+\.(?:route|get|post|put|delete|patch)\(\s*["']([^"']+)["']/.exec(trimmed)
    if (route) { pendingRoute = route[1]; continue }
    const fn = /^(?:async\s+)?def\s+(\w+)\s*\(/.exec(trimmed)
    if (fn) {
      const owner = classStack.length ? classStack[classStack.length - 1].name : undefined
      symbols.push({ name: fn[1], kind: pendingRoute ? 'route' : owner ? 'method' : 'function', line: i + 1, endLine: i + 1, exported: !fn[1].startsWith('_') && !owner, owner, route: pendingRoute ?? undefined })
      pendingRoute = null
      continue
    }
    const klass = /^class\s+(\w+)/.exec(trimmed)
    if (klass) {
      symbols.push({ name: klass[1], kind: /\b(BaseModel|Schema|Serializer|TypedDict|dataclass)\b/.test(trimmed) || /schema|model/i.test(klass[1]) ? 'schema' : 'class', line: i + 1, endLine: i + 1, exported: !klass[1].startsWith('_') })
      classStack.push({ name: klass[1], indent })
      continue
    }
    if (indent === 0) {
      const constant = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/.exec(trimmed)
      if (constant) symbols.push({ name: constant[1], kind: 'constant', line: i + 1, endLine: i + 1, exported: true })
    }
    const fromImport = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(trimmed)
    if (fromImport) {
      let names = fromImport[2]
      let last = i
      if (names.includes('(') && !names.includes(')')) {
        for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
          names += ` ${lines[j].trim()}`
          last = j
          if (lines[j].includes(')')) break
        }
      }
      imports.push({ module: fromImport[1], names: names.replace(/[()\\]/g, ' ').split(',').map(part => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean), line: i + 1 })
      i = Math.max(i, last)
      continue
    }
    const plainImport = /^import\s+(.+)$/.exec(trimmed)
    if (plainImport) {
      for (const part of plainImport[1].split(',')) {
        const module = part.trim().split(/\s+as\s+/)[0].trim()
        if (module) imports.push({ module, names: [], line: i + 1 })
      }
      continue
    }
    for (const hit of trimmed.matchAll(/os\.(?:environ\.get|getenv)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*(?:,\s*([^)]+))?\)|os\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g)) {
      const name = hit[1] ?? hit[3]
      const secret = isSecretName(name)
      env.push({ name, secret, ...(isFlagName(name) ? { flag: true } : {}), default: secret ? undefined : shortLiteral(hit[2]), line: i + 1 })
    }
  }
  closeRanges(symbols, lines, 'py')
  return { symbols, imports, env }
}

function parseJs(rel: string, content: string): { symbols: SymbolInfo[]; imports: Omit<ImportInfo, 'resolved'>[]; env: EnvVar[] } {
  const lines = content.split('\n')
  const symbols: SymbolInfo[] = []
  const imports: Omit<ImportInfo, 'resolved'>[] = []
  const env: EnvVar[] = []
  const jsx = /\.(tsx|jsx)$/i.test(rel)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    const exported = /^export\b/.test(trimmed)
    const fn = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/.exec(trimmed)
    if (fn) {
      symbols.push({ name: fn[1], kind: jsx && /^[A-Z]/.test(fn[1]) ? 'component' : 'function', line: i + 1, endLine: i + 1, exported })
      continue
    }
    const klass = /^(?:export\s+(?:default\s+)?)?class\s+(\w+)/.exec(trimmed)
    if (klass) { symbols.push({ name: klass[1], kind: 'class', line: i + 1, endLine: i + 1, exported }); continue }
    const arrow = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/.exec(trimmed)
    if (arrow) {
      symbols.push({ name: arrow[1], kind: jsx && /^[A-Z]/.test(arrow[1]) ? 'component' : 'function', line: i + 1, endLine: i + 1, exported })
      continue
    }
    const constant = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=/.exec(trimmed)
    if (constant) symbols.push({ name: constant[1], kind: 'constant', line: i + 1, endLine: i + 1, exported })
    const route = /\b(?:app|router)\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/.exec(trimmed)
    if (route) symbols.push({ name: `${route[1].toUpperCase()} ${route[2]}`, kind: 'route', line: i + 1, endLine: i + 1, exported: true, route: route[2] })
    const importFrom = /^import\s+(?:type\s+)?([^'"]*?)\s*from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/.exec(trimmed)
    if (importFrom) {
      const spec = importFrom[2] ?? importFrom[3]
      const names = (importFrom[1] ?? '').replace(/[{}*]/g, ' ').split(',').map(part => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      imports.push({ module: spec, names, line: i + 1 })
    }
    for (const req of trimmed.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) imports.push({ module: req[1], names: [], line: i + 1 })
    for (const hit of trimmed.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)(?:\s*(?:\|\||\?\?)\s*([^;,)]+))?|process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g)) {
      const name = hit[1] ?? hit[3]
      const secret = isSecretName(name)
      env.push({ name, secret, ...(isFlagName(name) ? { flag: true } : {}), default: secret ? undefined : shortLiteral(hit[2]), line: i + 1 })
    }
  }
  closeRanges(symbols, lines, 'js')
  return { symbols, imports, env }
}

/** endLine of each symbol: up to (not including) the next symbol that starts at the same or shallower nesting, or the end of the file. */
function closeRanges(symbols: SymbolInfo[], lines: string[], lang: 'py' | 'js'): void {
  const sorted = [...symbols].sort((a, b) => a.line - b.line)
  for (let i = 0; i < sorted.length; i += 1) {
    const sym = sorted[i]
    const indent = lang === 'py' ? pyIndent(lines[sym.line - 1] ?? '') : 0
    let end = lines.length
    for (let j = sym.line; j < lines.length; j += 1) {
      const text = lines[j]
      if (!text.trim()) continue
      if (lang === 'py') {
        if (pyIndent(text) <= indent && !/^\s*[)\]}]/.test(text) && !text.trim().startsWith('#')) { end = j; break }
      } else if (/^[}\])]/.test(text) === false && pyIndent(text) === 0 && /^(export\s|function\s|class\s|const\s|let\s|var\s|async\s|import\s|@)/.test(text)) { end = j; break }
    }
    while (end > sym.line && !(lines[end - 1] ?? '').trim()) end -= 1
    sym.endLine = Math.max(sym.line, end)
  }
}

function tokensOf(content: string): string[] {
  const seen = new Set<string>()
  for (const hit of content.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    seen.add(hit[0])
    if (seen.size >= CONTEXT_LIMITS.maxTokensPerFile) break
  }
  return [...seen]
}

/** Resolves an import specifier to a project file, or null when it points outside the project. */
export function resolveImport(from: string, module: string, lang: ContextLanguage, known: ReadonlySet<string>): string | null {
  const dir = dirname(from)
  if (lang === 'py') {
    let base: string
    if (module.startsWith('.')) {
      const dots = /^\.+/.exec(module)![0].length
      let anchor = dir
      for (let i = 1; i < dots; i += 1) anchor = dirname(anchor)
      const rest = module.slice(dots).replace(/\./g, '/')
      base = joinPath(anchor, rest)
    } else {
      base = module.replace(/\./g, '/')
    }
    const candidates = [`${base}.py`, `${base}/__init__.py`, ...(dir && !module.startsWith('.') ? [joinPath(dir, `${base}.py`)] : [])]
    return candidates.find(candidate => known.has(candidate)) ?? null
  }
  if (lang === 'js') {
    if (!module.startsWith('.')) return null
    const base = joinPath(dir, module)
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map(ext => `${base}${ext}`), ...['index.ts', 'index.tsx', 'index.js'].map(name => `${base}/${name}`)]
    return candidates.find(candidate => known.has(candidate)) ?? null
  }
  return null
}

export function indexFile(file: SourceFile): FileFacts {
  const rel = normalizePath(file.path)
  const lang = languageOf(rel)
  const parsed = lang === 'py' ? parsePython(rel, file.content) : lang === 'js' ? parseJs(rel, file.content) : { symbols: [], imports: [], env: [] as EnvVar[] }
  const configKeys = lang === 'config' ? configKeyNames(rel, file.content) : []
  return {
    path: rel,
    lang,
    hash: contentHash(file.content),
    lines: file.content.split('\n').length,
    isTest: isTestPath(rel),
    symbols: parsed.symbols,
    imports: parsed.imports.map(item => ({ ...item, resolved: null })),
    env: [...parsed.env, ...configKeys],
    tokens: lang === 'config' ? [] : tokensOf(file.content),
  }
}

/**
 * Env/config names a template or schema declares. An env template (.env.example) yields NAMES only. A JSON schema is parsed properly: the variables under the
 * root, `properties`, `variables` or `env`, with a non-secret literal default and a boolean/flag marker when it says so. A secret's default is never kept. Other config
 * files yield only upper-case, env-like keys, never nested noise.
 */
function configKeyNames(rel: string, content: string): EnvVar[] {
  const out: EnvVar[] = []
  const envLike = /^[A-Z][A-Z0-9_]{2,}$/
  if (/\.json$/i.test(rel)) {
    try {
      const root = JSON.parse(content) as Record<string, unknown>
      const scopes = [root, root?.properties, root?.variables, root?.env].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      for (const scope of scopes) {
        for (const [key, raw] of Object.entries(scope)) {
          if (!envLike.test(key) || out.some(item => item.name === key)) continue
          const spec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
          const secret = isSecretName(key) || spec.secret === true
          const literal = typeof spec.default === 'string' || typeof spec.default === 'number' || typeof spec.default === 'boolean' ? shortLiteral(typeof spec.default === 'string' ? `"${spec.default}"` : String(spec.default)) : undefined
          out.push({ name: key, secret, ...(isFlagName(key) || spec.type === 'boolean' ? { flag: true } : {}), default: secret ? undefined : literal, line: 1 })
        }
      }
    } catch { /* not valid JSON: it declares nothing */ }
    return out.slice(0, 60)
  }
  const lines = content.split('\n')
  const isEnvTemplate = /\.env\./i.test(rel)
  for (let i = 0; i < lines.length && out.length < 60; i += 1) {
    const line = lines[i].trim()
    const hit = isEnvTemplate ? /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line) : /^["']?([A-Z][A-Z0-9_]{2,})["']?\s*[:=]/.exec(line)
    if (hit) out.push({ name: hit[1], secret: isSecretName(hit[1]), ...(isFlagName(hit[1]) ? { flag: true } : {}), line: i + 1 })
  }
  return out
}

export function buildIndex(files: readonly SourceFile[]): ProjectIndex {
  const index: ProjectIndex = { files: {}, contents: {}, dependents: {}, definitions: {} }
  for (const file of files.slice(0, CONTEXT_LIMITS.maxIndexedFiles)) {
    const rel = normalizePath(file.path)
    if (isSecretFile(rel) || file.content.length > CONTEXT_LIMITS.maxFileBytes) continue
    index.files[rel] = indexFile({ path: rel, content: file.content })
    index.contents[rel] = file.content
  }
  relink(index)
  return index
}

function relink(index: ProjectIndex): void {
  const known = new Set(Object.keys(index.files))
  index.dependents = {}
  index.definitions = {}
  for (const facts of Object.values(index.files)) {
    for (const imp of facts.imports) imp.resolved = resolveImport(facts.path, imp.module, facts.lang, known)
    for (const sym of facts.symbols) (index.definitions[sym.name] ??= []).push({ path: facts.path, line: sym.line, kind: sym.kind })
    for (const imp of facts.imports) {
      if (!imp.resolved || imp.resolved === facts.path) continue
      const list = (index.dependents[imp.resolved] ??= [])
      if (!list.includes(facts.path)) list.push(facts.path)
    }
  }
  for (const list of Object.values(index.dependents)) list.sort()
}

/** Re-indexes changed files (or adds/removes them) and re-links. Returns the paths whose content hash actually changed. */
export function updateIndex(index: ProjectIndex, files: readonly { path: string; content: string | null }[]): string[] {
  const changed: string[] = []
  for (const file of files) {
    const rel = normalizePath(file.path)
    const before = index.files[rel]?.hash
    if (file.content === null || isSecretFile(rel) || file.content.length > CONTEXT_LIMITS.maxFileBytes) {
      if (before) { delete index.files[rel]; delete index.contents[rel]; changed.push(rel) }
      continue
    }
    const facts = indexFile({ path: rel, content: file.content })
    if (facts.hash !== before) changed.push(rel)
    index.files[rel] = facts
    index.contents[rel] = file.content
  }
  relink(index)
  return changed
}

// ---------------------------------------------------------------------------------------------
// Relations: dependencies, callers, callees, tests
// ---------------------------------------------------------------------------------------------

export function importsOf(index: ProjectIndex, rel: string): string[] {
  return [...new Set((index.files[rel]?.imports ?? []).map(item => item.resolved).filter((item): item is string => Boolean(item) && item !== rel))]
}

export function dependentsOf(index: ProjectIndex, rel: string): string[] {
  return index.dependents[rel] ?? []
}

/** Names a file actually pulls from `target` (empty when it imports the module as a whole). */
function namesImportedFrom(index: ProjectIndex, from: string, target: string): string[] {
  return (index.files[from]?.imports ?? []).filter(item => item.resolved === target).flatMap(item => item.names)
}

/** Callers of a symbol: files that import its defining file and use the name in their code (whole-module imports count when the name appears). */
export function callersOf(index: ProjectIndex, symbol: string, definedIn: string): { path: string; symbols: string[] }[] {
  const out: { path: string; symbols: string[] }[] = []
  for (const dependent of dependentsOf(index, definedIn)) {
    const facts = index.files[dependent]
    if (!facts || !facts.tokens.includes(symbol)) continue
    const names = namesImportedFrom(index, dependent, definedIn)
    if (names.length && !names.includes(symbol) && !names.includes('*')) continue
    const enclosing = facts.symbols.filter(sym => sym.kind !== 'constant' && bodyMentions(index.contents[dependent] ?? '', sym, symbol)).map(sym => sym.name)
    out.push({ path: dependent, symbols: enclosing.slice(0, 3) })
  }
  return out
}

function bodyMentions(content: string, sym: SymbolInfo, name: string): boolean {
  const body = content.split('\n').slice(sym.line, sym.endLine).join('\n')
  return new RegExp(`(?<![\\w.])${name}\\b`).test(body)
}

/** What one symbol calls that is defined elsewhere in the project (or in the same file). */
export function calleesOf(index: ProjectIndex, rel: string, symbol: string): { name: string; path: string }[] {
  const facts = index.files[rel]
  const sym = facts?.symbols.find(item => item.name === symbol)
  if (!facts || !sym) return []
  const body = (index.contents[rel] ?? '').split('\n').slice(sym.line, sym.endLine).join('\n')
  const out: { name: string; path: string }[] = []
  const reachable = new Set([rel, ...importsOf(index, rel)])
  for (const hit of body.matchAll(/(?<![\w.])([A-Za-z_]\w{2,})\s*\(/g)) {
    const name = hit[1]
    if (name === symbol) continue
    const def = (index.definitions[name] ?? []).find(item => reachable.has(item.path) && item.kind !== 'constant')
    if (def && !out.some(item => item.name === name)) out.push({ name, path: def.path })
    if (out.length >= 6) break
  }
  return out
}

export type TestLink = { test: string; how: 'imports' | 'calls' | 'through' | 'goal'; via?: string; symbols: string[] }

/** Tests that exercise `rel`: they import it, call a symbol it defines, or import a file that imports it. The test's own name is never consulted. */
export function testsFor(index: ProjectIndex, rel: string): TestLink[] {
  const symbols = (index.files[rel]?.symbols ?? []).filter(sym => sym.exported && sym.kind !== 'constant').map(sym => sym.name)
  const consumers = new Set(dependentsOf(index, rel).filter(item => !index.files[item]?.isTest))
  const out: TestLink[] = []
  for (const facts of Object.values(index.files)) {
    if (!facts.isTest) continue
    const imported = importsOf(index, facts.path)
    const used = symbols.filter(name => facts.tokens.includes(name))
    const via = imported.find(item => consumers.has(item))
    if (imported.includes(rel)) {
      const named = namesImportedFrom(index, facts.path, rel)
      out.push({ test: facts.path, how: 'imports', symbols: (named.length ? named : used).slice(0, 4) })
    } else if (used.length && usesWithoutImport(facts, used, rel)) {
      out.push({ test: facts.path, how: 'calls', symbols: used.slice(0, 4) })
    } else if (via) {
      out.push({ test: facts.path, how: 'through', via, symbols: [] })
    }
  }
  return out.sort((a, b) => rank(a.how) - rank(b.how) || a.test.localeCompare(b.test))
}

function rank(how: TestLink['how']): number {
  return how === 'imports' ? 0 : how === 'calls' ? 1 : how === 'through' ? 2 : 3
}

/** A test that names the symbol without importing the file: it only counts when a star or package import can reach the file's directory. */
function usesWithoutImport(test: FileFacts, used: string[], rel: string): boolean {
  const dir = dirname(rel)
  return used.length > 0 && test.imports.some(imp => imp.names.includes('*') || (dir !== '' && imp.module.replace(/\./g, '/').startsWith(dir)))
}

// ---------------------------------------------------------------------------------------------
// The context: discovery, scoring, layers
// ---------------------------------------------------------------------------------------------

export type ContextSymbol = { name: string; line: number; kind: SymbolKind; why: string }
export type ContextEntry = {
  path: string
  role: ContextRole
  score: number
  /** Why this file is here, in plain sentences. Never empty. */
  reasons: string[]
  symbols: ContextSymbol[]
  hash: string
  /** The file that brought this one in (a seed, or the evidence's file). */
  via?: string
}
export type ContextExpansion = { at: string; file: string; reason: string; evidence: string; generation: number }
export type ContextRefresh = { at: string; file: string; reason: string; generation: number }
export type ContextEnv = { name: string; secret: boolean; flag?: boolean; default?: string; files: string[] }
/** What one specialist call was actually given: the files it was shown and the context notes, exactly as sent (never a secret value). */
export type ContextSent = { role: string; task: string; files: string[]; notes: string[] }
/** A file's content as a specialist was actually shown it, so a later look can be compared with disk. */
export type ContextRead = { file: string; hash: string; generation: number }

export type ProjectContext = {
  version: 1
  goal: string
  terms: string[]
  confidence: 'high' | 'medium' | 'low'
  entries: ContextEntry[]
  /** implementation file -> tests that exercise it, with how. */
  tests: Record<string, TestLink[]>
  env: ContextEnv[]
  /** Files the mission changed, and the generation they were changed at. */
  changed: { path: string; generation: number }[]
  expansions: ContextExpansion[]
  refreshes: ContextRefresh[]
  reads: ContextRead[]
  /** What the last failing run showed about which code it goes through, in plain sentences (replaced on every failure). */
  evidence: string[]
  /** The last few specialist calls' context, so what the model was given can be audited from the record. */
  sent: ContextSent[]
  gatheredAt: string
  generation: number
}

const CONTRACT_PATH = /(^|\/)(shared|common|contracts?|types|models?|schemas?|constants?|settings|config)(\/|\.|$)/i

function isTrivial(rel: string): boolean {
  return /(^|\/)__init__\.py$/.test(rel) || /(^|\/)conftest\.py$/.test(rel)
}

type Scored = { path: string; score: number; reasons: string[]; symbols: ContextSymbol[] }

function scoreFile(facts: FileFacts, content: string, terms: readonly string[], goal: string): Scored {
  const reasons: string[] = []
  const symbols: ContextSymbol[] = []
  let score = 0
  const pathTerms = new Set(identifierTerms(facts.path.replace(/\.[^.]+$/, '').replace(/\//g, '_')))
  const pathHits = terms.filter(term => pathTerms.has(term))
  if (pathHits.length) {
    score += Math.min(3, pathHits.length) * 25
    reasons.push(`its name mentions ${pathHits.slice(0, 3).join(' and ')}`)
  }
  const goalLower = goal.toLowerCase()
  const base = facts.path.slice(facts.path.lastIndexOf('/') + 1).toLowerCase()
  if (goalLower.includes(facts.path.toLowerCase()) || (base.length > 5 && goalLower.includes(base))) {
    score += 100
    reasons.push('you named it')
  }
  for (const sym of facts.symbols) {
    if (sym.kind === 'method' && !terms.some(term => identifierTerms(sym.name).includes(term))) continue
    const symTerms = identifierTerms(`${sym.owner ?? ''}_${sym.name}`.replace(/^_/, ''))
    const hits = terms.filter(term => symTerms.includes(term))
    if (goalLower.includes(sym.name.toLowerCase()) && sym.name.length > 3) {
      score += 100
      symbols.push({ name: sym.name, line: sym.line, kind: sym.kind, why: 'you named it' })
    } else if (hits.length) {
      score += 30 + (hits.length - 1) * 10
      symbols.push({ name: sym.name, line: sym.line, kind: sym.kind, why: `it is about ${hits.slice(0, 2).join(' and ')}` })
    }
  }
  if (symbols.length) reasons.push(`it defines ${symbols.slice(0, 3).map(sym => sym.name).join(', ')}`)
  const tokenTerms = new Set<string>()
  for (const token of facts.tokens) for (const term of identifierTerms(token)) tokenTerms.add(term)
  const stringTerms = new Set<string>()
  for (const hit of content.matchAll(/["'#]\s*([A-Za-z][A-Za-z ,._-]{5,80})/g)) for (const term of identifierTerms(hit[1])) stringTerms.add(term)
  const contentHits = terms.filter(term => (tokenTerms.has(term) || stringTerms.has(term)) && !pathHits.includes(term))
  if (contentHits.length) {
    score += Math.min(4, contentHits.length) * 8
    reasons.push(`its code talks about ${contentHits.slice(0, 3).join(', ')}`)
  }
  return { path: facts.path, score, reasons, symbols: symbols.slice(0, CONTEXT_LIMITS.symbolsPerEntry) }
}

function entryFor(index: ProjectIndex, path: string, role: ContextRole, score: number, reasons: string[], symbols: ContextSymbol[], via?: string): ContextEntry {
  return { path, role, score, reasons: [...new Set(reasons)].slice(0, 4), symbols: symbols.slice(0, CONTEXT_LIMITS.symbolsPerEntry), hash: index.files[path]?.hash ?? '', ...(via ? { via } : {}) }
}

/**
 * Finds the files a goal is about, from the goal and the project alone: seeds by name/symbol/content relevance, then the code that uses them, the code
 * they rely on, the tests that exercise them, and the env/config they read. Bounded; every entry says why it is there.
 */
export function discoverContext(index: ProjectIndex, goal: string, at: string): ProjectContext {
  const terms = goalTerms(goal)
  const scored = Object.values(index.files)
    .filter(facts => (facts.lang === 'py' || facts.lang === 'js') && !facts.isTest && !isTrivial(facts.path))
    .map(facts => scoreFile(facts, index.contents[facts.path] ?? '', terms, goal))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const seedFloor = Math.max(24, (scored[0]?.score ?? 0) * 0.45)
  const seeds = scored.filter(item => item.score >= seedFloor).slice(0, CONTEXT_LIMITS.seeds)
  const entries = new Map<string, ContextEntry>()
  const add = (entry: ContextEntry) => {
    const known = entries.get(entry.path)
    if (!known) { entries.set(entry.path, entry); return }
    known.reasons = [...new Set([...known.reasons, ...entry.reasons])].slice(0, 4)
    known.score = Math.max(known.score, entry.score)
    known.symbols = [...known.symbols, ...entry.symbols.filter(sym => !known.symbols.some(item => item.name === sym.name))].slice(0, CONTEXT_LIMITS.symbolsPerEntry)
  }
  const seedPaths = seeds.map(seed => seed.path)
  // A seed that imports another seed uses it: the provider owns the logic, the importer is its consumer.
  for (const seed of seeds) {
    const provider = importsOf(index, seed.path).find(item => seedPaths.includes(item))
    add(provider
      ? entryFor(index, seed.path, 'consumer', seed.score, [`it uses ${basenameNoExt(provider)}`, ...seed.reasons], seed.symbols, provider)
      : entryFor(index, seed.path, 'implementation', seed.score, seed.reasons, seed.symbols))
  }
  // Consumers: files that import a seed and use what it defines.
  const relations: ContextEntry[] = []
  for (const seed of seeds) {
    const seedSymbols = (index.files[seed.path]?.symbols ?? []).filter(sym => sym.exported && sym.kind !== 'constant')
    for (const dependent of dependentsOf(index, seed.path)) {
      const facts = index.files[dependent]
      if (!facts || facts.isTest || isTrivial(dependent) || seedPaths.includes(dependent)) continue
      const usedSymbols = (seed.symbols.length ? seed.symbols.map(sym => sym.name) : seedSymbols.map(sym => sym.name)).filter(name => facts.tokens.includes(name))
      const named = namesImportedFrom(index, dependent, seed.path)
      const uses = usedSymbols.length ? usedSymbols : named
      const callerSyms = uses.flatMap(name => callersOf(index, name, seed.path).filter(item => item.path === dependent).flatMap(item => item.symbols))
      relations.push(entryFor(index, dependent, 'consumer', 40 + Math.min(10, uses.length * 5), [`it uses ${uses.slice(0, 2).join(', ') || basenameNoExt(seed.path)} from ${basenameNoExt(seed.path)}${callerSyms.length ? ` (in ${callerSyms[0]})` : ''}`], callerSyms.slice(0, 2).map(name => {
        const def = facts.symbols.find(sym => sym.name === name)
        return { name, line: def?.line ?? 1, kind: def?.kind ?? 'function', why: `it calls ${uses[0] ?? basenameNoExt(seed.path)}` }
      }), seed.path))
    }
    // Dependencies: project files a seed imports and actually uses names from.
    for (const imp of index.files[seed.path]?.imports ?? []) {
      if (!imp.resolved || isTrivial(imp.resolved) || seedPaths.includes(imp.resolved)) continue
      const facts = index.files[imp.resolved]
      if (!facts || facts.isTest) continue
      const used = imp.names.filter(name => (index.files[seed.path]?.tokens ?? []).filter(token => token === name).length >= 1)
      const role: ContextRole = CONTRACT_PATH.test(imp.resolved) ? 'contract' : 'dependency'
      relations.push(entryFor(index, imp.resolved, role, 30, [`${basenameNoExt(seed.path)} relies on ${used.slice(0, 2).join(', ') || basenameNoExt(imp.resolved)} from it`], used.slice(0, 2).map(name => {
        const def = facts.symbols.find(sym => sym.name === name)
        return { name, line: def?.line ?? 1, kind: def?.kind ?? 'function', why: `${basenameNoExt(seed.path)} imports it` }
      }), seed.path))
    }
  }
  relations.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const nonTestBudget = CONTEXT_LIMITS.workingSet - 3
  for (const relation of relations) {
    if ([...entries.values()].filter(item => item.role !== 'test').length >= nonTestBudget) break
    add(relation)
  }
  // Tests: whichever exercise the selected files, found by imports and symbol use, never by the test's file name.
  const tests: Record<string, TestLink[]> = {}
  const testScores = new Map<string, { score: number; reasons: string[]; via: string }>()
  for (const entry of [...entries.values()]) {
    const links = testsFor(index, entry.path).slice(0, CONTEXT_LIMITS.testsPerSeed)
    if (links.length) tests[entry.path] = links
    for (const link of links) {
      const known = testScores.get(link.test) ?? { score: 0, reasons: [], via: entry.path }
      const weight = link.how === 'imports' ? 55 : link.how === 'calls' ? 50 : 40
      known.score = Math.max(known.score, weight + (entry.role === 'implementation' ? 5 : 0))
      known.reasons.push(link.how === 'imports'
        ? `it tests ${basenameNoExt(entry.path)}${link.symbols.length ? ` (${link.symbols.slice(0, 2).join(', ')})` : ''}`
        : link.how === 'calls'
          ? `it exercises ${link.symbols.slice(0, 2).join(', ')} from ${basenameNoExt(entry.path)}`
          : `it reaches ${basenameNoExt(entry.path)} through ${basenameNoExt(link.via ?? '')}`)
      testScores.set(link.test, known)
    }
  }
  for (const [test, info] of [...testScores.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, 3)) {
    add(entryFor(index, test, 'test', info.score, info.reasons, [], info.via))
  }
  // Env/config: names the selected code reads, and the schema/template files that declare them (added as `config` entries, with the reason). Names, non-secret
  // defaults and flag markers only; a secret's value is never read (secret files are not indexed) and never kept.
  const envMap = new Map<string, ContextEnv>()
  for (const entry of entries.values()) {
    for (const item of index.files[entry.path]?.env ?? []) {
      const known = envMap.get(item.name) ?? { name: item.name, secret: item.secret, ...(item.flag ? { flag: true } : {}), default: item.default, files: [] }
      if (!known.files.includes(entry.path)) known.files.push(entry.path)
      envMap.set(item.name, known)
    }
  }
  if (envMap.size) {
    const declared = Object.values(index.files).filter(facts => facts.lang === 'config' && facts.env.length && !facts.isTest)
    for (const facts of declared.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 4)) {
      const shared = facts.env.filter(item => envMap.has(item.name))
      if (!shared.length || entries.size >= CONTEXT_LIMITS.workingSet + 2) continue
      const reader = (envMap.get(shared[0].name)?.files[0]) ?? ''
      for (const item of shared) {
        const known = envMap.get(item.name)!
        if (known.default === undefined && item.default !== undefined && !known.secret) known.default = item.default
        if (item.flag) known.flag = true
        if (!known.files.includes(facts.path)) known.files.push(facts.path)
      }
      add(entryFor(index, facts.path, 'config', 25, [`it declares ${shared.slice(0, 3).map(item => item.name).join(', ')}, which ${basenameNoExt(reader)} reads`], [], reader))
    }
  }
  const list = [...entries.values()].sort((a, b) => order(a.role) - order(b.role) || b.score - a.score || a.path.localeCompare(b.path)).slice(0, CONTEXT_LIMITS.workingSet)
  const top = seeds[0]?.score ?? 0
  return {
    version: 1,
    goal: redactSecrets(goal).slice(0, 600),
    terms,
    confidence: !seeds.length ? 'low' : top >= 60 && list.some(item => item.role === 'test') ? 'high' : 'medium',
    entries: list,
    tests,
    env: [...envMap.values()].slice(0, 12),
    changed: [],
    expansions: [],
    refreshes: [],
    reads: [],
    evidence: [],
    sent: [],
    gatheredAt: at,
    generation: 0,
  }
}

function order(role: ContextRole): number {
  return { implementation: 0, dependency: 1, contract: 2, consumer: 3, config: 4, evidence: 5, test: 6 }[role]
}

/** The layers the campaign's task graph is built from, taken from what the context found instead of from directory names. */
export function layersFromContext(context: ProjectContext): { contract: string[]; backend: string[]; frontend: string[]; tests: string[]; database: string[] } {
  const pick = (...roles: ContextRole[]) => context.entries.filter(entry => roles.includes(entry.role)).map(entry => entry.path).slice(0, 8)
  return {
    contract: pick('contract'),
    backend: pick('implementation', 'dependency'),
    frontend: pick('consumer'),
    tests: pick('test'),
    database: [],
  }
}

export function inContext(context: ProjectContext, rel: string): boolean {
  return context.entries.some(entry => entry.path === rel)
}

/** Drops duplicate entries (merging their reasons), caps sizes and rejects anything malformed. Used when a record is loaded after a restart. */
export function restoreContext(raw: unknown): ProjectContext | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<ProjectContext>
  if (value.version !== 1 || !Array.isArray(value.entries)) return null
  const merged = new Map<string, ContextEntry>()
  for (const entry of value.entries) {
    if (!entry || typeof entry.path !== 'string') continue
    const known = merged.get(entry.path)
    if (!known) { merged.set(entry.path, { ...entry, reasons: [...new Set(entry.reasons ?? [])].slice(0, 4), symbols: [...(entry.symbols ?? [])].slice(0, CONTEXT_LIMITS.symbolsPerEntry) }); continue }
    known.reasons = [...new Set([...known.reasons, ...(entry.reasons ?? [])])].slice(0, 4)
    known.score = Math.max(known.score, entry.score)
  }
  const seenExpansion = new Set<string>()
  return {
    version: 1,
    goal: String(value.goal ?? ''),
    terms: [...(value.terms ?? [])],
    confidence: value.confidence ?? 'medium',
    entries: [...merged.values()].slice(0, CONTEXT_LIMITS.workingSetHardMax),
    tests: { ...(value.tests ?? {}) },
    env: [...(value.env ?? [])].slice(0, 12),
    changed: dedupeBy(value.changed ?? [], item => `${item.path}@${item.generation}`).slice(-24),
    expansions: (value.expansions ?? []).filter(item => { const key = `${item.file}|${item.reason}`; if (seenExpansion.has(key)) return false; seenExpansion.add(key); return true }).slice(-12),
    refreshes: (value.refreshes ?? []).slice(-12),
    reads: dedupeBy(value.reads ?? [], item => `${item.file}|${item.hash}|${item.generation}`).slice(-24),
    evidence: [...(value.evidence ?? [])].slice(0, 2),
    sent: [...(value.sent ?? [])].slice(-8),
    gatheredAt: String(value.gatheredAt ?? ''),
    generation: Number(value.generation ?? 0),
  }
}

function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => { const k = key(item); if (seen.has(k)) return false; seen.add(k); return true })
}

// ---------------------------------------------------------------------------------------------
// Changed files, staleness and refresh
// ---------------------------------------------------------------------------------------------

/** Files whose content on disk no longer matches what the context recorded: the model must not reason from the old text. */
export function staleEntries(context: ProjectContext, diskHashes: Readonly<Record<string, string | null>>): string[] {
  return context.entries.filter(entry => {
    const now = diskHashes[entry.path]
    return now !== undefined && now !== entry.hash
  }).map(entry => entry.path)
}

/** Records what a specialist was shown for a file (its hash and the mutation generation), so a stale read is detectable afterwards. */
export function noteRead(context: ProjectContext, file: string, text: string, generation: number): ProjectContext {
  const hash = contentHash(text)
  const last = context.reads[context.reads.length - 1]
  if (last && last.file === file && last.hash === hash && last.generation === generation) return context
  if (context.reads.some(item => item.file === file && item.hash === hash && item.generation === generation)) return context
  return { ...context, reads: [...context.reads, { file, hash, generation }].slice(-24) }
}

/** What a diagnosis is shown: the code the change lives in and the code around it (files already ruled out last), plus the first test that covers it. */
export function debugSet(context: ProjectContext, avoid: readonly string[] = []): string[] {
  const roleOrder: ContextRole[] = ['implementation', 'consumer', 'dependency', 'contract', 'evidence']
  const code = context.entries.filter(entry => entry.role !== 'test' && entry.role !== 'config').sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || b.score - a.score)
  const fresh = code.filter(entry => !avoid.includes(entry.path)).map(entry => entry.path)
  const stale = code.filter(entry => avoid.includes(entry.path)).map(entry => entry.path)
  const test = context.entries.find(entry => entry.role === 'test')?.path
  return [...fresh, ...stale].slice(0, test ? 3 : 4).concat(test ? [test] : [])
}

/** Records what a specialist call was given (file names and the notes, both redacted), so the record shows exactly what reached the model. */
export function noteSent(context: ProjectContext, call: { role: string; task: string; files: readonly string[]; notes: readonly string[] }): ProjectContext {
  const entry: ContextSent = { role: call.role, task: call.task, files: [...new Set(call.files)].slice(0, 10), notes: call.notes.map(redactSecrets).slice(0, 8) }
  return { ...context, sent: [...(context.sent ?? []), entry].slice(-8) }
}

export function noteChanged(context: ProjectContext, file: string, generation: number): ProjectContext {
  const changed = context.changed.filter(item => !(item.path === file && item.generation === generation))
  changed.push({ path: file, generation })
  return { ...context, changed: changed.slice(-24), generation: Math.max(context.generation, generation) }
}

/**
 * Brings the context back in line with the index after files changed: hashes and symbols of the affected entries are recomputed, entries whose
 * relations changed keep their reasons, and every refresh is recorded with why. Returns the new context and the entries that were refreshed.
 */
export function refreshContext(context: ProjectContext, index: ProjectIndex, changedFiles: readonly string[], why: string, at: string, generation: number): { context: ProjectContext; refreshed: string[] } {
  const refreshed: string[] = []
  const entries = context.entries.map(entry => {
    const facts = index.files[entry.path]
    if (!facts) return entry
    const isChanged = changedFiles.includes(entry.path)
    if (!isChanged && facts.hash === entry.hash) return entry
    refreshed.push(entry.path)
    const symbols = entry.symbols
      .map(sym => facts.symbols.find(item => item.name === sym.name))
      .filter((sym): sym is SymbolInfo => Boolean(sym))
      .map((sym, i) => ({ name: sym.name, line: sym.line, kind: sym.kind, why: entry.symbols[i]?.why ?? 'it was relevant' }))
    return { ...entry, hash: facts.hash, symbols: symbols.length ? symbols : entry.symbols }
  })
  const tests: Record<string, TestLink[]> = { ...context.tests }
  for (const entry of entries) if (entry.role !== 'test' && index.files[entry.path]) tests[entry.path] = testsFor(index, entry.path).slice(0, CONTEXT_LIMITS.testsPerSeed)
  const log: ContextRefresh[] = refreshed.map(file => ({ at, file, reason: why, generation }))
  return { context: { ...context, entries, tests, refreshes: [...context.refreshes, ...log].slice(-12), generation: Math.max(context.generation, generation) }, refreshed }
}

// ---------------------------------------------------------------------------------------------
// Evidence-driven expansion
// ---------------------------------------------------------------------------------------------

function relFromFrame(frame: string, known: ReadonlySet<string>, root: string): string | null {
  const normalized = frame.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (base && normalized.startsWith(`${base}/`) && known.has(normalized.slice(base.length + 1))) return normalized.slice(base.length + 1)
  let best: string | null = null
  for (const candidate of known) if (normalized.endsWith(`/${candidate}`) && (!best || candidate.length > best.length)) best = candidate
  return best
}

export type ExpansionEvidence = { text: string; root: string }

/**
 * Runtime evidence decides when the working set grows. A traceback frame in a project file, the file that defines a name an error names, or the
 * test that failed each add at most a few files, each with the reason and the evidence that pointed at it. Files already present are never
 * added twice, and the set never passes its hard ceiling. Returns what was added (possibly nothing).
 */
export function expandFromEvidence(context: ProjectContext, index: ProjectIndex, evidence: ExpansionEvidence, at: string, generation: number): { context: ProjectContext; added: ContextEntry[] } {
  const known = new Set(Object.keys(index.files))
  const present = new Set(context.entries.map(entry => entry.path))
  const candidates: { path: string; role: ContextRole; reason: string; why: string; evidence: string; score: number }[] = []
  const text = evidence.text
  for (const hit of text.matchAll(/File ["']([^"']+)["'], line (\d+), in (\S+)/g)) {
    const rel = relFromFrame(hit[1], known, evidence.root)
    if (!rel || present.has(rel) || isTrivial(rel) || index.files[rel]?.isTest) continue
    candidates.push({ path: rel, role: 'implementation', reason: `the failing run goes through ${hit[3] === '<module>' ? basenameNoExt(rel) : hit[3]} in ${basenameNoExt(rel)}`, why: `the traceback ends in ${rel}:${hit[2]}`, evidence: `File "${rel}", line ${hit[2]}, in ${hit[3]}`, score: 70 })
  }
  for (const hit of text.matchAll(/(?:NameError: name|ImportError: cannot import name|AttributeError: module \S+ has no attribute|AttributeError: '\w+' object has no attribute)\s*['"]([A-Za-z_]\w*)['"]/g)) {
    for (const def of index.definitions[hit[1]] ?? []) {
      if (present.has(def.path) || isTrivial(def.path)) continue
      candidates.push({ path: def.path, role: index.files[def.path]?.isTest ? 'test' : 'implementation', reason: `it defines ${hit[1]}, which the error names`, why: `the error mentions ${hit[1]}`, evidence: hit[0].slice(0, 100), score: 60 })
    }
  }
  for (const hit of text.matchAll(/^(?:FAIL|ERROR):\s+(\w+) \(([\w.]+)\)/gm)) {
    const dotted = hit[2].split('.')
    for (let take = dotted.length; take >= 1; take -= 1) {
      const rel = [`${dotted.slice(0, take).join('/')}.py`, `tests/${dotted.slice(0, take).join('/')}.py`].find(candidate => known.has(candidate))
      if (rel) {
        if (!present.has(rel)) candidates.push({ path: rel, role: 'test', reason: `the failing test ${hit[1]} lives in it`, why: `${hit[1]} failed`, evidence: `${hit[0].slice(0, 100)}`, score: 65 })
        break
      }
    }
  }
  const added: ContextEntry[] = []
  const entries = [...context.entries]
  const expansions = [...context.expansions]
  const taken = new Set<string>()
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))) {
    if (added.length >= CONTEXT_LIMITS.expansionPerEvidence || entries.length >= CONTEXT_LIMITS.workingSetHardMax) break
    if (taken.has(candidate.path) || present.has(candidate.path) || !index.files[candidate.path]) continue
    taken.add(candidate.path)
    const facts = index.files[candidate.path]
    const symbolNames = (candidate.evidence.match(/in (\w+)$/)?.[1] ? [candidate.evidence.match(/in (\w+)$/)![1]] : []).filter(name => facts.symbols.some(sym => sym.name === name))
    const symbols = symbolNames.map(name => { const sym = facts.symbols.find(item => item.name === name)!; return { name, line: sym.line, kind: sym.kind, why: 'the failing run went through it' } })
    const entry: ContextEntry = { path: candidate.path, role: candidate.role, score: candidate.score, reasons: [candidate.reason], symbols, hash: facts.hash, via: 'evidence' }
    entries.push(entry)
    added.push(entry)
    expansions.push({ at, file: candidate.path, reason: candidate.reason, evidence: redactSecrets(candidate.evidence).slice(0, 140), generation })
  }
  return { context: { ...context, entries, expansions: expansions.slice(-12), generation: Math.max(context.generation, generation) }, added }
}

// ---------------------------------------------------------------------------------------------
// Notes for the model, and words for the Commander
// ---------------------------------------------------------------------------------------------

function words(rel: string): string {
  if (/\.env\.[a-z]+$/i.test(rel)) return 'environment template'
  if (/schema\.json$/i.test(rel)) return 'config schema'
  return basenameNoExt(rel).replace(/^test_/, '').replace(/_test$/, '').replace(/[_-]+/g, ' ')
}

/**
 * One plain sentence the Commander sees ("I'm tracing ..."). Contains no scores, counts, paths with slashes or enum names; technical detail is in
 * `contextDetails`.
 */
export function describeContext(context: ProjectContext): string {
  const by = (role: ContextRole) => context.entries.filter(entry => entry.role === role)
  const joinWords = (parts: string[]) => parts.length <= 1 ? parts[0] ?? '' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const impl = by('implementation').map(entry => words(entry.path))
  const consumers = by('consumer').map(entry => words(entry.path))
  const deps = [...by('dependency'), ...by('contract'), ...by('config')].map(entry => words(entry.path))
  const tests = by('test')
  const parts: string[] = []
  if (impl.length) parts.push(`the ${joinWords([...new Set(impl)].slice(0, 2))} code`)
  if (consumers.length) parts.push(`the ${joinWords([...new Set(consumers)].slice(0, 2))} code that uses it`)
  if (deps.length) parts.push(`what it relies on (${joinWords([...new Set(deps)].slice(0, 2))})`)
  if (tests.length) parts.push(tests.length === 1 ? 'the test that covers it' : 'the tests that cover it')
  if (!parts.length) return "I couldn't find code that clearly matches this yet, so I'm looking around the project."
  return `I'm tracing ${joinWords(parts)}.`
}

export function describeExpansion(expansion: ContextExpansion): string {
  const reason = expansion.reason.replace(/_/g, ' ')
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}, so I'm adding ${words(expansion.file)} to what I'm looking at.`
}

/** Technical detail for Activity: one line per file with the reasons it is in the set. */
export function contextDetails(context: ProjectContext): string[] {
  return [
    ...context.entries.map(entry => `${entry.path} (${entry.role}): ${entry.reasons.join('; ')}${entry.symbols.length ? ` [${entry.symbols.map(sym => `${sym.name}:${sym.line}`).join(', ')}]` : ''}`),
    ...context.expansions.map(item => `added ${item.file}: ${item.reason} (${item.evidence})`),
    ...context.env.map(item => `env ${item.name}${item.secret ? ' (secret, value hidden)' : `${item.flag ? ' (feature flag' : ' ('}${item.default !== undefined ? `${item.flag ? ', ' : ''}default ${item.default}` : item.flag ? '' : 'setting'})`} in ${item.files.join(', ')}`),
  ].map(line => redactSecrets(line))
}

/**
 * What a specialist is told, symbol-level and bounded: what the selected code defines, who calls it, what it calls, which tests cover it, and which
 * env names it reads. Values are never included.
 */
export function contextNotes(context: ProjectContext, index: ProjectIndex, focusFile?: string): string[] {
  const notes: string[] = [...(context.evidence ?? [])]
  const entries = focusFile ? context.entries.filter(entry => entry.path === focusFile || entry.via === focusFile || entry.role === 'test') : context.entries
  for (const entry of entries.slice(0, 6)) {
    const facts = index.files[entry.path]
    if (!facts) continue
    if (entry.role === 'test') {
      notes.push(`${entry.path} is a test that ${entry.reasons[0] ?? 'covers this code'}`)
      continue
    }
    const syms = entry.symbols.slice(0, 3)
    const callers = [...new Set(syms.flatMap(sym => callersOf(index, sym.name, entry.path).map(item => `${item.path}${item.symbols[0] ? `:${item.symbols[0]}` : ''}`)))].slice(0, 2)
    const callees = [...new Set(syms.flatMap(sym => calleesOf(index, entry.path, sym.name).map(item => `${item.name} (${item.path})`)))].slice(0, 2)
    notes.push(`${entry.path}: ${entry.reasons[0] ?? entry.role}${syms.length ? `; symbols ${syms.map(sym => `${sym.name} line ${sym.line}`).join(', ')}` : ''}${callers.length ? `; used by ${callers.join(', ')}` : ''}${callees.length ? `; calls ${callees.join(', ')}` : ''}`)
  }
  if (context.env.length) notes.push(`env ${context.env.slice(0, 6).map(item => `${item.name} (${item.secret ? 'secret, value hidden' : `${item.flag ? 'feature flag' : 'setting'}${item.default !== undefined ? `, default ${item.default}` : ''}`})`).join(', ')}`)
  const out: string[] = []
  let used = 0
  for (const note of notes.map(redactSecrets)) {
    if (used + note.length > CONTEXT_LIMITS.notesChars) break
    out.push(note)
    used += note.length
  }
  return out
}

/** A symbol-level excerpt of a large file: the imports header and only the bodies of the relevant symbols, with line numbers. Small files come back whole. */
export function symbolExcerpt(content: string, symbols: readonly { name: string; line: number; endLine?: number }[], maxLines = 120): string {
  const lines = content.split('\n')
  if (lines.length <= maxLines || !symbols.length) return content
  const head = lines.slice(0, Math.min(12, lines.length)).filter(line => /^(from|import|const|export|#|"""|'''|\s*$)/.test(line))
  const parts: string[] = [...head, '']
  for (const sym of symbols.slice(0, 4)) {
    const start = Math.max(0, sym.line - 1)
    const end = Math.min(lines.length, sym.endLine && sym.endLine > sym.line ? sym.endLine : start + 25)
    parts.push(`# lines ${start + 1}-${end}`, ...lines.slice(start, end), '')
  }
  return parts.join('\n')
}

/**
 * The smallest span of `current` that has to change to become `snapshot`, widened by a little unchanged text on each side so the governed edit can anchor on
 * it. Returns null when they are equal. Used to put a file back to the version whose tests passed.
 */
export function minimalRevertSpan(current: string, snapshot: string): { start: number; end: number } | null {
  if (current === snapshot) return null
  let prefix = 0
  while (prefix < current.length && prefix < snapshot.length && current[prefix] === snapshot[prefix]) prefix += 1
  let suffix = 0
  while (suffix < current.length - prefix && suffix < snapshot.length - prefix && current[current.length - 1 - suffix] === snapshot[snapshot.length - 1 - suffix]) suffix += 1
  return { start: Math.max(0, prefix - 8), end: Math.min(current.length, current.length - suffix + 8) }
}
