/**
 * Lightweight persistent code intelligence for Foundry.
 * Uses the TypeScript compiler AST — not a vector database, not a hand-rolled parser.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { foundryDataHierarchy } from './foundryPaths'
import { listRepoFiles, readRepoFile } from './repositoryInspector'
import { listTestSuites } from './qualityTools'
import { readEngineeringMemory } from './foundryEngineeringMemory'

export type FoundrySymbolRecord = {
  name: string
  kind: string
  exported: boolean
  line: number
}

export type FoundryFileIndex = {
  path: string
  exports: string[]
  imports: string[]
  symbols: FoundrySymbolRecord[]
  literals?: string[]
  bindings?: string[]
  route?: string
  api?: string
  packageBoundary?: string
  tests: string[]
}

export type FoundryCodeIndex = {
  builtAt: string
  fileCount: number
  cacheVersion?: number
  files: Record<string, FoundryFileIndex>
  symbols: Record<string, string[]>
  dependents: Record<string, string[]>
  tests: Record<string, string[]>
}

export type FoundryOwnershipMap = {
  query: string
  owners: string[]
  dependents: string[]
  tests: string[]
  routes: string[]
  apis: string[]
  packageBoundaries: string[]
}

const INDEX_PREFIXES = ['scripts/foundry', 'lib/native-builder', 'components/war-room/foundry', 'app/api/mission-runtime/engineering', 'app/api/sovereign/local-auth', 'lib/sovereign-runtime/local-ownership', 'desktop/src', 'middleware.ts', 'lib', 'components', 'app', 'scripts']
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const MAX_INDEX_FILES = 2200
const MAX_FILE_BYTES = 180_000
const INDEX_CACHE_VERSION = 5

function cachePath(): string {
  return path.join(foundryDataHierarchy().foundryRoot, 'code-intelligence.json')
}

function packageBoundary(rel: string): string {
  const parts = rel.split('/')
  if (parts[0] === 'app' && parts[1] === 'api') return 'app/api'
  if (parts[0] === 'app') return 'app'
  if (parts[0] === 'components') return parts.slice(0, 3).join('/')
  if (parts[0] === 'lib') return parts.slice(0, 2).join('/')
  if (parts[0] === 'scripts') return parts.slice(0, 2).join('/')
  return parts[0] ?? rel
}

function routeFromPath(rel: string): string | undefined {
  const match = rel.match(/^app\/(.+)\/page\.(tsx|ts|jsx|js)$/)
  if (match) return `/${match[1].replace(/\/index$/, '')}`
  if (/^app\/page\.(tsx|ts)$/.test(rel)) return '/'
  return undefined
}

function apiFromPath(rel: string): string | undefined {
  const match = rel.match(/^app\/api\/(.+)\/route\.(ts|js)$/)
  if (match) return `/api/${match[1]}`
  return undefined
}

function testSiblings(rel: string, files: Set<string>): string[] {
  const dir = path.posix.dirname(rel)
  const base = path.posix.basename(rel).replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '')
  const candidates = [
    `${dir}/${base}.test.ts`,
    `${dir}/${base}.test.mjs`,
    `${dir}/${base}.test.js`,
    `${dir}/${base}.validation.ts`,
    `${dir}/${base}.proof.ts`,
    `${dir}/app.test.mjs`,
    `${dir}/regression.test.mjs`,
  ]
  return candidates.filter(item => files.has(item) && item !== rel)
}

function resolveSpecifier(fromFile: string, spec: string, files: Set<string>): string | null {
  let target = spec
  if (spec.startsWith('@/')) target = spec.slice(2)
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  else return null
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.jsx`,
    `${target}.mjs`,
    `${target}.cjs`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
    `${target}/index.js`,
    `${target}/route.ts`,
    `${target}/page.tsx`,
  ]
  return candidates.find(item => files.has(item)) ?? null
}

function scriptKindFor(rel: string): ts.ScriptKind {
  if (rel.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (rel.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (rel.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function extractFile(rel: string, content: string, files: Set<string>): FoundryFileIndex {
  const source = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, scriptKindFor(rel))
  const exports: string[] = []
  const imports: string[] = []
  const symbols: FoundrySymbolRecord[] = []

  const addSymbol = (name: string, kind: string, exported: boolean, node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    symbols.push({ name, kind, exported, line: line + 1 })
    if (exported && !exports.includes(name)) exports.push(name)
  }

  const literals: string[] = []
  const bindings: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = resolveSpecifier(rel, node.moduleSpecifier.text, files)
      if (resolved && !imports.includes(resolved)) imports.push(resolved)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = resolveSpecifier(rel, node.moduleSpecifier.text, files)
      if (resolved && !imports.includes(resolved)) imports.push(resolved)
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(node.name.text, 'function', Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), node)
    }
    if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(node.name.text, 'class', Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), node)
    }
    if (ts.isVariableStatement(node)) {
      const exported = Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) addSymbol(decl.name.text, 'variable', exported, decl)
      }
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
      addSymbol(node.name.text, ts.SyntaxKind[node.kind].toLowerCase(), Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), node)
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      const text = (ts.isJsxText(node) ? node.getText(source) : node.text).replace(/\s+/g, ' ').trim()
      if (text.length >= 8 && text.length <= 80 && !literals.includes(text)) literals.push(text)
    }
    if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(source).replace(/\s+/g, '')
      if (text.length >= 3 && text.length <= 80 && /[.]/.test(text) && !bindings.includes(text)) bindings.push(text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  for (const match of content.matchAll(/['"](\.[^'"]+\.[A-Za-z0-9]+)['"]/g)) {
    const resolved = resolveSpecifier(rel, match[1], files)
    if (resolved && !imports.includes(resolved)) imports.push(resolved)
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1]))
    if (!imports.includes(joined) && (files.has(joined) || /\.(txt|json|md|css)$/.test(joined))) {
      imports.push(joined)
    }
  }

  return {
    path: rel,
    exports,
    imports: imports.slice(0, 40),
    symbols: symbols.slice(0, 80),
    literals: literals
      .slice()
      .sort((a, b) => {
        const caps = (value: string) => /^[A-Z0-9][A-Z0-9 ]+$/.test(value) ? 1 : 0
        return (caps(b) - caps(a)) || b.length - a.length
      })
      .slice(0, 24),
    bindings: bindings.slice(0, 40),
    route: routeFromPath(rel),
    api: apiFromPath(rel),
    packageBoundary: packageBoundary(rel),
    tests: [],
  }
}

export async function buildCodeIndex(force = false): Promise<FoundryCodeIndex> {
  const dest = cachePath()
  if (!force && existsSync(dest)) {
    try {
      const cached = JSON.parse(await readFile(dest, 'utf8')) as FoundryCodeIndex
      if (cached?.files && cached.fileCount > 0 && cached.cacheVersion === INDEX_CACHE_VERSION) return cached
    } catch {
      /* rebuild */
    }
  }

  const listed: string[] = []
  for (const prefix of INDEX_PREFIXES) {
    const files = await listRepoFiles(prefix)
    for (const file of files) {
      if (!SOURCE_RE.test(file)) continue
      listed.push(file)
      if (listed.length >= MAX_INDEX_FILES) break
    }
    if (listed.length >= MAX_INDEX_FILES) break
  }
  const fileSet = new Set(listed)
  const files: Record<string, FoundryFileIndex> = {}
  for (const rel of listed) {
    const read = await readRepoFile(rel)
    if (!read.ok || read.sizeBytes > MAX_FILE_BYTES) continue
    files[rel] = extractFile(rel, read.content, fileSet)
  }

  const dependents: Record<string, string[]> = {}
  const symbols: Record<string, string[]> = {}
  const tests: Record<string, string[]> = {}
  for (const file of Object.values(files)) {
    file.tests = testSiblings(file.path, fileSet)
    for (const test of file.tests) {
      tests[file.path] ??= []
      if (!tests[file.path].includes(test)) tests[file.path].push(test)
      tests[test] ??= []
      if (!tests[test].includes(file.path)) tests[test].push(file.path)
    }
    for (const imported of file.imports) {
      dependents[imported] ??= []
      if (!dependents[imported].includes(file.path)) dependents[imported].push(file.path)
    }
    for (const symbol of file.symbols) {
      symbols[symbol.name] ??= []
      if (!symbols[symbol.name].includes(file.path)) symbols[symbol.name].push(file.path)
    }
  }

  const index: FoundryCodeIndex = {
    builtAt: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    cacheVersion: INDEX_CACHE_VERSION,
    files,
    symbols,
    dependents,
    tests,
  }
  await mkdir(path.dirname(dest), { recursive: true }).catch(() => undefined)
  await writeFile(dest, JSON.stringify(index), 'utf8').catch(() => undefined)
  return index
}

function titledPhrase(query: string): string | null {
  return query.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/)?.[0] ?? null
}

function bindingNeedles(query: string): string[] {
  const titled = titledPhrase(query)
  const words = (titled ?? query).split(/[^A-Za-z0-9]+/).filter(token => token.length > 2)
  const camel = words.map((word, index) => index === 0 ? word.toLowerCase() : `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`).join('')
  return [...new Set([...words.map(word => word.toLowerCase()), camel.toLowerCase()])].filter(Boolean)
}

function isGenericChromePath(rel: string): boolean {
  const base = path.posix.basename(rel)
  return /(HomeNav|Header|Footer|Sidebar|EntryLink|ContextMenu|TabBar|Banner|Chrome|NavBar|TopNav)(\.|$)/i.test(base)
    || /\/(nav|header|footer|chrome|menu)\//i.test(rel)
}

function hasRenderBinding(file: FoundryFileIndex, query: string): boolean {
  const needles = bindingNeedles(query)
  const bindings = file.bindings ?? []
  if (!needles.length || !bindings.length) return false
  return bindings.some(binding => {
    const lower = binding.toLowerCase()
    return needles.filter(needle => needle.length > 3).every(needle => lower.includes(needle))
      || needles.some(needle => needle.length > 6 && lower.includes(needle))
  })
}

function scoreFile(rel: string, file: FoundryFileIndex, query: string, index?: FoundryCodeIndex): number {
  const needle = query.toLowerCase()
  const tokens = needle.split(/[^a-z0-9]+/).filter(token => token.length > 2)
  let score = 0
  const hay = `${rel} ${file.exports.join(' ')} ${file.symbols.map(s => s.name).join(' ')} ${(file.literals ?? []).join(' ')} ${(file.bindings ?? []).join(' ')} ${file.api ?? ''} ${file.route ?? ''}`.toLowerCase()
  if (hay.includes(needle)) score += 12
  for (const token of tokens) {
    if (rel.toLowerCase().includes(token)) score += 4
    if (file.exports.some(name => name.toLowerCase().includes(token))) score += 3
    if (file.symbols.some(symbol => symbol.name.toLowerCase().includes(token))) score += 2
    if ((file.literals ?? []).some(lit => lit.toLowerCase().includes(token))) score += 6
    if ((file.api ?? '').toLowerCase().includes(token)) score += 3
    if (rel.toLowerCase().split('/').includes(token)) score += 5
  }
  const uniqueIds = query.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []
  const uniqueHit = uniqueIds.some(id =>
    (file.literals ?? []).some(lit => lit.includes(id))
    || hay.includes(id.toLowerCase())
    || rel.toLowerCase().includes(id.toLowerCase()),
  )
  const titled = titledPhrase(query)?.toLowerCase() ?? null
  const runtime = isRuntimeRenderingOwner(rel, file)
  const chrome = isGenericChromePath(rel)
  const bound = hasRenderBinding(file, query)
  const exactTitle = Boolean(titled && (file.literals ?? []).some(lit => lit.toLowerCase() === titled))
  if (titled && exactTitle && bound && runtime && !chrome) score += 48
  else if (titled && bound && runtime && !chrome) score += 36
  else if (titled && exactTitle && runtime && !chrome && !bound) score += 8
  else if (titled && exactTitle && chrome) score += 2
  else if (titled && exactTitle) score += 4
  if (titled && chrome) score -= 18
  if (titled && /^lib\/council\//.test(rel)) score -= 24
  if (titled && /SkillRegistry/.test(rel)) score -= 12
  if (/\.(proof|validation|resume)\.ts$/.test(rel) || /engineeringDepth\.e\./.test(rel)) score -= 40
  else if (!uniqueHit && /(?:^|\/)scripts\//.test(rel) && !/\/pass013-/.test(rel)) score -= 40
  if (uniqueHit) {
    if (/\.(proof|validation|resume)\.ts$/.test(rel)) score += 4
    else if (/\.(test|spec)\./.test(rel)) score += 16
    else score += 80
  }
  if (runtime && !chrome) score += 10
  if (runtime && chrome) score += 2
  if (titled && runtime && bound && /panel|detail|review|status/i.test(rel)) score += 8
  if (file.route) score += 8
  if (/^components\//.test(rel) && !chrome) score += 6
  if (/^components\//.test(rel) && chrome) score += 1
  if (/\b(detail|explain|label|panel|visible|says)\b/i.test(query) && /^components\//.test(rel) && !chrome) score += 10
  if (/\b(detail|explain|label|panel|visible|says)\b/i.test(query) && /^lib\/native-builder\//.test(rel)) score -= 28
  const deps = index ? (index.dependents[rel] ?? []) : []
  const runtimeDeps = deps.filter(dep => /^components\/|^app\//.test(dep) || dep.endsWith('.tsx'))
  score += Math.min(titled ? 18 : 12, runtimeDeps.length * (titled ? 4 : 3))
  const tests = index ? (index.tests[rel] ?? file.tests ?? []) : (file.tests ?? [])
  score += Math.min(titled ? 18 : 4, tests.length * (titled ? 6 : 1))
  const products = ['foundry', 'terra', 'council', 'wrim', 'astra']
  const mentioned = products.filter(product => tokens.includes(product) || needle.includes(product))
  if (mentioned.length) {
    if (mentioned.some(product => rel.toLowerCase().includes(`/${product}/`) || rel.toLowerCase().includes(product))) score += 8
    else if (products.some(product => rel.toLowerCase().includes(`/${product}/`) && !mentioned.includes(product))) score -= 10
  }
  return score
}

function isRuntimeRenderingOwner(rel: string, file: FoundryFileIndex): boolean {
  if (/^components\//.test(rel)) return true
  if (file.route) return true
  if (/^app\/.*\/(page|layout|route)\.(t|j)sx?$/.test(rel)) return true
  if (/\.tsx$/.test(rel) && !/^lib\//.test(rel) && !/\.(proof|validation|resume)\.tsx$/.test(rel)) return true
  return false
}

export function lookupSymbol(index: FoundryCodeIndex, name: string): { name: string; definitions: Array<{ path: string; line: number; kind: string }>; references: string[] } {
  const definitionFiles = index.symbols[name] ?? []
  const definitions = definitionFiles.flatMap(filePath => {
    const file = index.files[filePath]
    return (file?.symbols ?? [])
      .filter(symbol => symbol.name === name)
      .map(symbol => ({ path: filePath, line: symbol.line, kind: symbol.kind, exported: symbol.exported }))
  })
  const exportedFirst = [...definitions].sort((a, b) => Number(b.exported) - Number(a.exported))
  const references = [...new Set([
    ...exportedFirst.flatMap(item => index.dependents[item.path] ?? []),
    ...Object.values(index.files)
      .filter(file => file.symbols.some(symbol => symbol.name === name) && !definitionFiles.includes(file.path))
      .map(file => file.path),
  ])]
  return { name, definitions: exportedFirst.map(({ path, line, kind }) => ({ path, line, kind })), references }
}

export function lookupReferences(index: FoundryCodeIndex, name: string): string[] {
  return lookupSymbol(index, name).references
}

export function lookupDependents(index: FoundryCodeIndex, relPath: string): string[] {
  return index.dependents[relPath] ?? []
}

export function lookupDefinition(index: FoundryCodeIndex, name: string): { path: string; line: number; kind: string } | null {
  return lookupSymbol(index, name).definitions[0] ?? null
}

export function rankOwnersFromIndex(query: string, index: FoundryCodeIndex): Array<{ path: string; score: number }> {
  return Object.values(index.files)
    .map(file => ({ path: file.path, score: scoreFile(file.path, file, query, index) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
}

export function indexSourceFile(rel: string, content: string, knownFiles: Iterable<string> = []): FoundryFileIndex {
  return extractFile(rel, content, new Set(knownFiles))
}

export async function mapOwnership(query: string, index?: FoundryCodeIndex): Promise<FoundryOwnershipMap> {
  const resolved = index ?? await buildCodeIndex()
  const ranked = rankOwnersFromIndex(query, resolved).slice(0, 8)
  let owners = ranked.map(item => item.path)
  try {
    const memory = await readEngineeringMemory()
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 3)
    for (const feature of memory.features) {
      if (feature.stale) continue
      if (!tokens.some(token => feature.feature.toLowerCase().includes(token))) continue
      owners = [...new Set([...owners, ...feature.owners.filter(file => Boolean(resolved.files[file]) || file.endsWith('.tsx') || file.endsWith('.ts'))])]
    }
  } catch {
    /* memory is advisory */
  }
  const dependents = [...new Set(owners.flatMap(owner => lookupDependents(resolved, owner)))].slice(0, 12)
  const tests = [...new Set(owners.flatMap(owner => resolved.tests[owner] ?? []))].slice(0, 12)
  const routes = [...new Set(ranked.flatMap(item => resolved.files[item.path]?.route ? [resolved.files[item.path]!.route!] : []))]
  const apis = [...new Set(ranked.flatMap(item => resolved.files[item.path]?.api ? [resolved.files[item.path]!.api!] : []))]
  const packageBoundaries = [...new Set(ranked.flatMap(item => resolved.files[item.path]?.packageBoundary ? [resolved.files[item.path]!.packageBoundary!] : []))]
  return { query, owners, dependents, tests, routes, apis, packageBoundaries }
}

export function compactOwnership(map: FoundryOwnershipMap): string {
  return [
    `FEATURE: ${map.query}`,
    `PRIMARY_OWNER: ${map.owners[0] || 'none'}`,
    `OWNER_CANDIDATES: ${map.owners.slice(0, 6).join(', ') || 'none'}`,
    `RELATED_TESTS: ${map.tests.slice(0, 6).join(', ') || 'none'}`,
    `REVERSE_DEPENDENTS: ${map.dependents.slice(0, 6).join(', ') || 'none'}`,
    `WHY_THIS_FILE: ${map.owners[0] ? `highest ownership score for "${map.query.slice(0, 80)}"` : 'no owner mapped'}`,
    map.apis.length ? `API: ${map.apis.join(', ')}` : '',
    map.routes.length ? `ROUTES: ${map.routes.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

export async function associatedValidateSuites(files: string[]): Promise<string[]> {
  const suites = await listTestSuites()
  const names = files.map(file => path.posix.basename(file).toLowerCase())
  return suites.filter(suite => {
    const token = suite.replace(/^validate:/, '').toLowerCase()
    if (token === 'foundry' || token === 'engineer' || token === 'terra' || token === 'ui') return false
    const compact = token.replace(/-/g, '')
    return names.some(name => name.replace(/[^a-z0-9]/g, '').includes(compact) || compact.includes(name.replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]/g, '')))
      || files.some(file => file.toLowerCase().includes(`/${token.replace(/-/g, '/')}`))
  }).slice(0, 8)
}

export function indexFingerprint(index: FoundryCodeIndex): string {
  return createHash('sha256').update(`${index.builtAt}:${index.fileCount}`).digest('hex').slice(0, 12)
}
