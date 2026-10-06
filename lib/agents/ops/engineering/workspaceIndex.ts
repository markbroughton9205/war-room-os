import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** Code-evidence index of any workspace directory (War Room itself or an isolated project). Read-only, bounded. */
export type Decl = { name: string; kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'component' | 'enum'; exported: boolean; line: number; endLine: number; hasBody: boolean }
export type ImportEdge = { spec: string; resolved: string | null; names: string[]; line: number }
export type PathRef = { path: string; method?: string; line: number; role: 'serves' | 'calls' }
export type StorageRef = { path: string | null; op: 'read' | 'write' | 'append' | 'db'; line: number }
export type FileEntry = {
  path: string
  kind: 'source' | 'test' | 'config' | 'doc' | 'data'
  lines: number
  imports: ImportEdge[]
  nodeImports: string[]
  decls: Decl[]
  exports: string[]
  hasJsx: boolean
  isHtml: boolean
  apiRefs: PathRef[]
  storageRefs: StorageRef[]
  /** Identifier uses (excluding declarations): name -> count. */
  uses: Record<string, number>
  /** Comment/string text only; used to detect keyword matches that are mere mentions. */
  mentionText: string
  routeMethods: string[]
}
export type WorkspaceIndex = {
  root: string
  builtAt: string
  fileCount: number
  truncated: boolean
  files: Record<string, FileEntry>
  /** symbol name -> definitions */
  symbols: Record<string, { file: string; line: number; kind: Decl['kind']; exported: boolean }[]>
  /** file -> files importing it */
  dependents: Record<string, string[]>
  /** target file -> test files that import it */
  testsFor: Record<string, string[]>
  scripts: Record<string, string>
  hasTsconfig: boolean
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.war-room', '.turbo', '.cache', 'out'])
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const MAX_SOURCE_FILES = 9000
const MAX_SQL_FILES = 300
const MAX_BYTES = 400_000
export const IS_TEST = /(\.test\.|\.spec\.|\.validation\.|\/__tests__\/|\.proof\.)/

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const FS_WRITE = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'rename', 'renameSync', 'mkdir', 'mkdirSync', 'unlink', 'unlinkSync', 'rm', 'rmSync'])
const FS_READ = new Set(['readFile', 'readFileSync', 'readdir', 'readdirSync', 'existsSync', 'stat', 'statSync'])
const DB_MODULES = /^(node:sqlite|sqlite3|better-sqlite3|pg|mysql2?|mongodb|mongoose|prisma|@prisma\/client|@supabase\/supabase-js|redis|ioredis|drizzle-orm|knex)/

function walk(root: string, rel: string, out: string[], state: { truncated: boolean; sql: number; src: number }) {
  if (state.src >= MAX_SOURCE_FILES) { state.truncated = true; return }
  let names: string[] = []
  try { names = readdirSync(path.join(root, rel)) } catch { return }
  for (const n of names.sort()) {
    if (SKIP_DIRS.has(n) || n.startsWith('.broker.tmp')) continue
    const r = rel ? `${rel}/${n}` : n
    let st
    try { st = statSync(path.join(root, r)) } catch { continue }
    if (st.isSymbolicLink?.()) continue
    if (st.isDirectory()) walk(root, r, out, state)
    else if (st.size <= MAX_BYTES) {
      if (SRC_EXT.test(n)) { if (state.src >= MAX_SOURCE_FILES) { state.truncated = true; return } state.src += 1; out.push(r) }
      else if (n === 'package.json' || n === 'tsconfig.json' || n.endsWith('.html')) out.push(r)
      else if (n.endsWith('.sql')) { if (state.sql < MAX_SQL_FILES) { state.sql += 1; out.push(r) } else state.truncated = true }
    }
  }
}

function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  const bases: string[] = []
  if (spec.startsWith('.')) bases.push(path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)))
  else if (spec.startsWith('@/')) bases.push(spec.slice(2))
  else return null
  for (const b of bases) for (const c of [b, `${b}.ts`, `${b}.tsx`, `${b}.js`, `${b}.mjs`, `${b}.jsx`, `${b}/index.ts`, `${b}/index.tsx`, `${b}/index.js`, `${b}/index.mjs`]) if (files.has(c)) return c
  return null
}

export function indexSource(rel: string, text: string, known: Set<string>): FileEntry {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/.test(rel) ? ts.ScriptKind.TSX : /\.(mjs|cjs|js)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const entry: FileEntry = { path: rel, kind: IS_TEST.test(rel) ? 'test' : 'source', lines: text.split('\n').length, imports: [], nodeImports: [], decls: [], exports: [], hasJsx: false, isHtml: false, apiRefs: [], storageRefs: [], uses: Object.create(null), mentionText: '', routeMethods: [] }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const endLineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1
  const mentions: string[] = []
  const hasExport = (n: ts.Node) => !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export)
  const isFnLike = (n: ts.Node | undefined) => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))
  const containsJsx = (n: ts.Node): boolean => { let f = false; const v = (x: ts.Node) => { if (f) return; if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { f = true; return } ts.forEachChild(x, v) }; v(n); return f }
  const addApi = (p: string, line: number, role: PathRef['role'], method?: string) => { if (/^\/(api\/|[a-z][\w-]*)/.test(p) && (p.startsWith('/api/') || role === 'serves')) entry.apiRefs.push({ path: p, line, role, ...(method ? { method } : {}) }) }

  const visit = (node: ts.Node, localNames: Set<string>) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      const names: string[] = []
      const c = node.importClause
      if (c?.name) names.push(c.name.text)
      if (c?.namedBindings) { if (ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => names.push((e.propertyName ?? e.name).text)); else names.push('*') }
      const resolved = resolveImport(rel, spec, known)
      entry.imports.push({ spec, resolved, names, line: lineOf(node) })
      if (!resolved && !spec.startsWith('.')) entry.nodeImports.push(spec)
      if (DB_MODULES.test(spec)) entry.storageRefs.push({ path: null, op: 'db', line: lineOf(node) })
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      const exported = hasExport(node)
      entry.decls.push({ name: node.name.text, kind: containsJsx(node) ? 'component' : 'function', exported, line: lineOf(node), endLine: endLineOf(node), hasBody: !!node.body })
      if (exported) { entry.exports.push(node.name.text); if (HTTP_METHODS.includes(node.name.text)) entry.routeMethods.push(node.name.text) }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const exported = hasExport(node)
      entry.decls.push({ name: node.name.text, kind: 'class', exported, line: lineOf(node), endLine: endLineOf(node), hasBody: true }); if (exported) entry.exports.push(node.name.text)
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      const exported = hasExport(node)
      entry.decls.push({ name: node.name.text, kind: ts.isInterfaceDeclaration(node) ? 'interface' : ts.isEnumDeclaration(node) ? 'enum' : 'type', exported, line: lineOf(node), endLine: endLineOf(node), hasBody: false }); if (exported) entry.exports.push(node.name.text)
    } else if (ts.isVariableStatement(node)) {
      const exported = hasExport(node)
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) {
        const fn = isFnLike(d.initializer)
        entry.decls.push({ name: d.name.text, kind: fn ? (containsJsx(d) ? 'component' : 'function') : 'const', exported, line: lineOf(d), endLine: endLineOf(d), hasBody: fn })
        if (exported) { entry.exports.push(d.name.text); if (HTTP_METHODS.includes(d.name.text)) entry.routeMethods.push(d.name.text) }
      }
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) node.exportClause.elements.forEach((e) => entry.exports.push(e.name.text))
    // evidence from expressions
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) entry.hasJsx = true
    if (ts.isIdentifier(node)) {
      const p = node.parent
      const isDecl = (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isVariableDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isParameter(p) || ts.isImportSpecifier(p) || ts.isPropertyAssignment(p) && p.name === node) && (p as { name?: ts.Node }).name === node
      if (!isDecl && !(ts.isPropertyAccessExpression(p) && p.name === node)) entry.uses[node.text] = (entry.uses[node.text] ?? 0) + 1
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const spec = (node.arguments[0] as ts.StringLiteralLike).text
      const resolved = resolveImport(rel, spec, known)
      entry.imports.push({ spec, resolved, names: ['*'], line: lineOf(node) })
      if (!resolved && !spec.startsWith('.')) entry.nodeImports.push(spec)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const fnName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
      const arg0 = node.arguments[0]
      if (fnName === 'fetch' && arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) addApi(arg0.text.split('?')[0], lineOf(node), 'calls')
      if (fnName === 'fetch' && arg0 && ts.isTemplateExpression(arg0)) addApi(arg0.head.text.split('?')[0].replace(/\/$/, ''), lineOf(node), 'calls')
      if (FS_WRITE.has(fnName) || FS_READ.has(fnName)) {
        const lit = arg0 && (ts.isStringLiteral(arg0) ? arg0.text : ts.isNoSubstitutionTemplateLiteral(arg0) ? arg0.text : null)
        entry.storageRefs.push({ path: lit, op: /append/i.test(fnName) ? 'append' : FS_WRITE.has(fnName) ? 'write' : 'read', line: lineOf(node) })
      }
      if (/^(prepare|exec|query|run|all|get)$/.test(fnName) && arg0 && ts.isStringLiteral(arg0) && /\b(select|insert|update|delete|create table)\b/i.test(arg0.text)) entry.storageRefs.push({ path: null, op: 'db', line: lineOf(node) })
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const t = node.text
      if (t.length >= 3 && t.length < 160) mentions.push(t)
      // plain node http servers: req.url === '/api/x' / pathname === '/api/x'
      if (/^\/api\/[\w\-/:]*$/.test(t) && !(ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'fetch') && !(ts.isCallExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === 'fetch')) {
        const inFetchCall = ts.isCallExpression(node.parent) && /fetch/.test(node.parent.expression.getText(sf))
        if (!inFetchCall) addApi(t, lineOf(node), 'serves')
      }
      if (/\.(json|jsonl|db|sqlite|sql|csv)$/i.test(t) && t.length < 120) entry.storageRefs.push({ path: t, op: 'read', line: lineOf(node) })
    }
    ts.forEachChild(node, (c) => visit(c, localNames))
  }
  visit(sf, new Set())
  // comments
  const ranges = new Set<string>()
  const scan = (n: ts.Node) => { for (const r of [...(ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(text, n.getEnd()) ?? [])]) { const k = `${r.pos}`; if (!ranges.has(k)) { ranges.add(k); mentions.push(text.slice(r.pos, r.end)) } } ts.forEachChild(n, scan) }
  scan(sf)
  entry.mentionText = mentions.join(' ').toLowerCase().slice(0, 20_000)
  // JSX text (UI labels) counts as mention text too
  if (entry.hasJsx) { const jt: string[] = []; const v = (x: ts.Node) => { if (ts.isJsxText(x)) jt.push(x.text); ts.forEachChild(x, v) }; v(sf); entry.mentionText += ' ' + jt.join(' ').toLowerCase().slice(0, 5000) }
  // Next.js app-router route files serve their directory path
  const m = rel.match(/^(?:src\/)?app\/(.+)\/route\.(ts|js|mjs)$/)
  if (m && entry.routeMethods.length) entry.apiRefs.push({ path: '/' + m[1].replace(/\[(\w+)\]/g, ':$1'), line: 1, role: 'serves', method: entry.routeMethods.join('|') })
  return entry
}

export function buildWorkspaceIndex(root: string): WorkspaceIndex {
  const abs = path.resolve(root)
  const state = { truncated: false, sql: 0, src: 0 }
  const list: string[] = []
  walk(abs, '', list, state)
  const known = new Set(list)
  const files: Record<string, FileEntry> = Object.create(null)
  const scripts: Record<string, string> = Object.create(null)
  for (const rel of list) {
    let text = ''
    try { text = readFileSync(path.join(abs, rel), 'utf8') } catch { continue }
    if (SRC_EXT.test(rel)) { try { files[rel] = indexSource(rel, text, known) } catch { /* unparsable file: skipped, never fabricated */ } }
    else if (rel.endsWith('.html')) {
      const e: FileEntry = { path: rel, kind: 'source', lines: text.split('\n').length, imports: [], nodeImports: [], decls: [], exports: [], hasJsx: false, isHtml: true, apiRefs: [], storageRefs: [], uses: Object.create(null), mentionText: text.toLowerCase().slice(0, 20_000), routeMethods: [] }
      for (const m of text.matchAll(/fetch\(\s*['"`](\/[^'"`?]*)/g)) e.apiRefs.push({ path: m[1], line: text.slice(0, m.index).split('\n').length, role: 'calls' })
      files[rel] = e
    } else if (rel.endsWith('.sql')) {
      const e: FileEntry = { path: rel, kind: 'data', lines: text.split('\n').length, imports: [], nodeImports: [], decls: [], exports: [], hasJsx: false, isHtml: false, apiRefs: [], storageRefs: [{ path: rel, op: 'db', line: 1 }], uses: Object.create(null), mentionText: text.toLowerCase().slice(0, 5000), routeMethods: [] }
      files[rel] = e
    } else if (rel === 'package.json') {
      try { Object.assign(scripts, (JSON.parse(text).scripts ?? {}) as Record<string, string>) } catch { /* ignore */ }
      files[rel] = { path: rel, kind: 'config', lines: text.split('\n').length, imports: [], nodeImports: [], decls: [], exports: [], hasJsx: false, isHtml: false, apiRefs: [], storageRefs: [], uses: Object.create(null), mentionText: '', routeMethods: [] }
    }
  }
  const symbols: WorkspaceIndex['symbols'] = Object.create(null)
  const dependents: Record<string, string[]> = Object.create(null)
  const testsFor: Record<string, string[]> = Object.create(null)
  for (const f of Object.values(files)) {
    for (const d of f.decls) (symbols[d.name] ??= []).push({ file: f.path, line: d.line, kind: d.kind, exported: d.exported })
    for (const i of f.imports) if (i.resolved) { (dependents[i.resolved] ??= []).push(f.path); if (f.kind === 'test') (testsFor[i.resolved] ??= []).push(f.path) }
  }
  return { root: abs, builtAt: new Date().toISOString(), fileCount: Object.keys(files).length, truncated: state.truncated, files, symbols, dependents, testsFor, scripts, hasTsconfig: existsSync(path.join(abs, 'tsconfig.json')) }
}
