/**
 * Large-project ownership for the existing Foundry engineering runtime.
 * FRK remains the reasoning owner. This module does not call a model and does not write files.
 * Small workspaces (1–80 files) stay on engineeringRuntimeShouldOwn.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { inspectSymbolUsages, type RepoSearchHit } from './repositoryInspector'
import { parseUnexpectedKeyword } from './foundryEngineeringFailure'

export const SMALL_WORKSPACE_FILE_LIMIT = 80
export const ACTIVE_WORKING_SET_LIMIT = 16
export const FILE_INSPECT_BUDGET = 24
export const COMMAND_BUDGET = 12
export const EXPANSION_BUDGET = 8

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.war-room', '.turbo', 'dist', 'build', 'coverage',
  '__pycache__', '.pytest_cache', '.mypy_cache',
])

export type EngineeringExecutionMode = 'SMALL' | 'LARGE_PROJECT' | 'UNOWNED'

export type ScopeExpansion = {
  trigger: string
  added: string[]
  reason: string
  expectedGain: string
  layer: 'L0' | 'L1' | 'L2' | 'L3'
}

export type LargeProjectState = {
  mode: 'LARGE_PROJECT'
  phase: string
  pauseAfter?: string | null
  repoFileCount: number
  filesDiscovered: number
  filesInspected: string[]
  filesMutated: string[]
  directoriesTraversed: string[]
  commandsRun: number
  modelCalls: number
  modelDirectWrites: number
  frkDirectWrites: number
  secondMissionTruthCount: number
  repeatedFailureWithoutReplan: number
  startedAt: string
  mapMs: number
  firstRelevantFileMs: number | null
  workingSet: string[]
  peakWorkingSet: number
  expansions: ScopeExpansion[]
  git: { branch: string; head: string; dirty: string[]; untracked: string[] }
  ignored: string[]
  preexistingDirty: string[]
  checkpoints: string[]
  plan: string[]
  rootCause: string | null
  targetedTest: string | null
  appliedEditKeys: string[]
  lastFailure: string | null
  configNumbers: number[]
  scopeManifest: {
    initialWorkingSet: string[]
    expandedWorkingSet: string[]
    mutatedFiles: string[]
    preexistingDirty: string[]
    ignored: string[]
    hashes: Record<string, string>
  }
}

export type StructuralMap = {
  fileCount: number
  topLevelDirectories: string[]
  manifests: string[]
  packages: string[]
  testFiles: string[]
  languages: { ext: string; count: number }[]
  ignored: string[]
  directoriesTraversed: string[]
  names: string[]
}

export type PlannedEdit = {
  file: string
  before: string
  after: string
  start: number
  end: number
  reason: string
}

export type RepairPlan =
  | { status: 'need_reads'; paths: string[]; expansion: ScopeExpansion }
  | { status: 'edits'; edits: PlannedEdit[]; rootCause: string; strategy: 'CALLSITE_TRACE' | 'CONFIG_DIAGNOSIS' | 'TEST_FAILURE_ISOLATION'; configNumbers: number[] }
  | { status: 'blocked'; reason: string }
  | { status: 'unsupported'; reason: string }

const ENGINEERING_REQUEST = /\b(fix|repair|debug|failing|bug|serialization|validate this)\b/i
const GOVERNANCE_REQUEST = /governance\s+block/i

export function isLargeProjectRequest(request: string): boolean {
  return GOVERNANCE_REQUEST.test(request) || ENGINEERING_REQUEST.test(request)
}

export function selectEngineeringExecutionMode(input: {
  fileCount: number
  request: string
  fullScanBounded?: boolean
  dependencyEdges?: number
}): EngineeringExecutionMode {
  if (!isLargeProjectRequest(input.request)) return 'UNOWNED'
  const overGraph = (input.dependencyEdges ?? 0) > SMALL_WORKSPACE_FILE_LIMIT
  const unbounded = input.fullScanBounded === false
  if (input.fileCount > SMALL_WORKSPACE_FILE_LIMIT || unbounded || overGraph) {
    return input.fileCount <= 0 && !unbounded && !overGraph ? 'UNOWNED' : 'LARGE_PROJECT'
  }
  if (input.fileCount > 0 && input.fileCount <= SMALL_WORKSPACE_FILE_LIMIT) return 'SMALL'
  return 'UNOWNED'
}

export function largeProjectShouldOwn(input: { fileCount: number; request: string }): boolean {
  return selectEngineeringExecutionMode(input) === 'LARGE_PROJECT'
}

export function emptyLargeProjectState(pauseAfter?: string | null): LargeProjectState {
  return {
    mode: 'LARGE_PROJECT',
    phase: 'LOCATE',
    pauseAfter: pauseAfter ?? null,
    repoFileCount: 0,
    filesDiscovered: 0,
    filesInspected: [],
    filesMutated: [],
    directoriesTraversed: [],
    commandsRun: 0,
    modelCalls: 0,
    modelDirectWrites: 0,
    frkDirectWrites: 0,
    secondMissionTruthCount: 0,
    repeatedFailureWithoutReplan: 0,
    startedAt: new Date().toISOString(),
    mapMs: 0,
    firstRelevantFileMs: null,
    workingSet: [],
    peakWorkingSet: 0,
    expansions: [],
    git: { branch: '', head: '', dirty: [], untracked: [] },
    ignored: [],
    preexistingDirty: [],
    checkpoints: [],
    plan: [],
    rootCause: null,
    targetedTest: null,
    appliedEditKeys: [],
    lastFailure: null,
    configNumbers: [],
    scopeManifest: {
      initialWorkingSet: [],
      expandedWorkingSet: [],
      mutatedFiles: [],
      preexistingDirty: [],
      ignored: [],
      hashes: {},
    },
  }
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function sourceStillMatches(expected: string, current: string): boolean {
  return expected === current
}

function skipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || /^\.next[-.].*$/i.test(name) || /^dist(-.*)?$/i.test(name)
}

export async function scanRepositoryStructure(root = resolveRepoRoot()): Promise<StructuralMap> {
  const names: string[] = []
  const dirs = new Set<string>()
  const languages = new Map<string, number>()
  const manifests: string[] = []
  const packages: string[] = []
  const testFiles: string[] = []
  const ignored = ['.git', 'node_modules', '.war-room', '__pycache__', 'dist', '.next']
  const walked: string[] = []

  async function walk(abs: string, rel: string): Promise<void> {
    walked.push(rel || '.')
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    const childNames = new Set(entries.map(entry => entry.name))
    if (childNames.has('__init__.py') && rel) packages.push(rel)
    for (const entry of entries) {
      if (skipDir(entry.name)) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const childAbs = path.join(abs, entry.name)
      if (entry.isDirectory()) {
        if (!rel) dirs.add(entry.name)
        await walk(childAbs, childRel)
        continue
      }
      if (!entry.isFile()) continue
      names.push(childRel)
      const ext = path.extname(entry.name).toLowerCase() || '(none)'
      languages.set(ext, (languages.get(ext) ?? 0) + 1)
      if (/^(package\.json|pyproject\.toml|requirements\.txt|setup\.cfg|pytest\.ini)$/i.test(entry.name)) {
        manifests.push(childRel)
      }
      if ((rel === 'tests' || rel.endsWith('/tests') || rel === 'test') && /^test_.*\.py$/i.test(entry.name)) {
        testFiles.push(childRel)
      }
    }
  }

  await walk(root, '')
  return {
    fileCount: names.length,
    topLevelDirectories: [...dirs].sort(),
    manifests: manifests.sort(),
    packages: packages.sort(),
    testFiles: testFiles.sort(),
    languages: [...languages.entries()].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count),
    ignored,
    directoriesTraversed: walked,
    names: names.sort(),
  }
}

export async function countProjectFiles(root = resolveRepoRoot()): Promise<number> {
  const map = await scanRepositoryStructure(root)
  return map.fileCount
}

export type GitPorcelainRecord = {
  indexStatus: string
  workTreeStatus: string
  paths: string[]
  untracked: boolean
}

/** Repo-relative form used by the preexisting-dirty registry. Rejects traversal. */
export function canonicalRepoRelativePath(file: string): { rel: string; ok: boolean } {
  const raw = file.replace(/\\/g, '/')
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return { rel: file, ok: false }
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return { rel: file, ok: false }
      parts.pop()
      continue
    }
    parts.push(part)
  }
  if (parts.length === 0) return { rel: file, ok: false }
  return { rel: parts.join('/'), ok: true }
}

export function dirtyPathMatches(registry: readonly string[], target: string): boolean {
  const wanted = canonicalRepoRelativePath(target)
  if (!wanted.ok) return false
  return registry.some(entry => {
    const have = canonicalRepoRelativePath(entry)
    return have.ok && have.rel === wanted.rel
  })
}

export function preexistingDirtyBlocksEdit(registry: readonly string[], file: string, alreadyMutated: readonly string[]): boolean {
  const target = canonicalRepoRelativePath(file)
  if (!target.ok) return true
  if (alreadyMutated.some(item => canonicalRepoRelativePath(item).rel === target.rel)) return false
  return dirtyPathMatches(registry, file)
}

function unescapeGitQuotedPath(raw: string): string | null {
  if (!raw.startsWith('"')) return raw
  if (raw.length < 2 || !raw.endsWith('"')) return null
  let out = ''
  const body = raw.slice(1, -1)
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      out += body[i]
      continue
    }
    const next = body[i + 1]
    if (next === undefined) return null
    i += 1
    if (next === 'n') out += '\n'
    else if (next === 't') out += '\t'
    else if (next === 'r') out += '\r'
    else if (next === '\\' || next === '"') out += next
    else if (next >= '0' && next <= '7') {
      let oct = next
      while (oct.length < 3 && i + 1 < body.length && body[i + 1] >= '0' && body[i + 1] <= '7') {
        i += 1
        oct += body[i]
      }
      out += String.fromCharCode(Number.parseInt(oct, 8))
    } else out += next
  }
  return out
}

function splitRenameField(rest: string): string[] | null {
  let quoted = false
  let escaped = false
  for (let i = 0; i < rest.length - 3; i += 1) {
    const ch = rest[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && quoted) {
      escaped = true
      continue
    }
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && rest.startsWith(' -> ', i)) {
      const oldPath = unescapeGitQuotedPath(rest.slice(0, i))
      const newPath = unescapeGitQuotedPath(rest.slice(i + 4))
      if (!oldPath || !newPath) return null
      return [oldPath, newPath]
    }
  }
  return null
}

function recordFromStatus(xy: string, paths: string[]): GitPorcelainRecord | null {
  if (xy.length !== 2 || paths.some(item => item.length === 0)) return null
  const untracked = xy === '??'
  return {
    indexStatus: xy[0] === ' ' ? '' : xy[0],
    workTreeStatus: xy[1] === ' ' ? '' : xy[1],
    paths,
    untracked,
  }
}

/**
 * Porcelain v1 newline records. Does not trim the status prefix.
 * Rename and copy records return [old, new]. A rename that is not `old -> new` is rejected.
 */
export function parsePorcelainV1(output: string): { records: GitPorcelainRecord[]; rejected: number } {
  const lines = output.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const records: GitPorcelainRecord[] = []
  let rejected = 0
  for (const rawLine of lines) {
    if (rawLine === '') continue
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length < 4 || line[2] !== ' ') {
      rejected += 1
      continue
    }
    const xy = line.slice(0, 2)
    const rename = xy.includes('R') || xy.includes('C')
    const paths = rename ? splitRenameField(line.slice(3)) : (() => {
      const one = unescapeGitQuotedPath(line.slice(3))
      return one ? [one] : null
    })()
    const record = paths ? recordFromStatus(xy, paths) : null
    if (!record) rejected += 1
    else records.push(record)
  }
  return { records, rejected }
}

/** Porcelain v1 NUL records from `git status --porcelain=v1 -z`. Rename order is old, then new. */
export function parsePorcelainV1Z(output: string): { records: GitPorcelainRecord[]; rejected: number } {
  const records: GitPorcelainRecord[] = []
  let rejected = 0
  let i = 0
  while (i < output.length) {
    if (output.length - i < 4 || output[i + 2] !== ' ') {
      rejected += 1
      break
    }
    const xy = output.slice(i, i + 2)
    const rename = xy.includes('R') || xy.includes('C')
    const firstEnd = output.indexOf('\0', i + 3)
    if (firstEnd < 0) {
      rejected += 1
      break
    }
    const first = output.slice(i + 3, firstEnd)
    i = firstEnd + 1
    let paths = [first]
    if (rename) {
      const secondEnd = output.indexOf('\0', i)
      if (secondEnd < 0 || secondEnd === i) {
        rejected += 1
        break
      }
      paths = [output.slice(i, secondEnd), first]
      i = secondEnd + 1
    }
    const record = recordFromStatus(xy, paths)
    if (!record) rejected += 1
    else records.push(record)
  }
  return { records, rejected }
}

function classifyPorcelain(records: GitPorcelainRecord[]): { dirty: string[]; untracked: string[] } {
  const dirty: string[] = []
  const untracked: string[] = []
  for (const record of records) {
    for (const file of record.paths) {
      const canon = canonicalRepoRelativePath(file)
      if (!canon.ok) continue
      const bucket = record.untracked ? untracked : dirty
      if (!bucket.includes(canon.rel)) bucket.push(canon.rel)
    }
  }
  return { dirty, untracked }
}

export async function captureGitBaseline(root = resolveRepoRoot()): Promise<LargeProjectState['git']> {
  const run = (args: string[]) => new Promise<string>(resolve => {
    const child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { out += chunk })
    child.on('error', () => resolve(''))
    child.on('close', code => resolve(code === 0 ? out : ''))
  })
  const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).replace(/\r?\n$/, '')
  const head = (await run(['rev-parse', 'HEAD'])).replace(/\r?\n$/, '')
  const porcelain = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const parsed = parsePorcelainV1Z(porcelain)
  const classified = classifyPorcelain(parsed.records)
  return { branch, head, dirty: classified.dirty, untracked: classified.untracked }
}

export async function readManifestText(root: string, rel: string): Promise<string> {
  const abs = path.join(root, rel)
  const info = await stat(abs)
  if (info.size > 64_000) return ''
  return readFile(abs, 'utf8')
}

export function noteWorkingSet(state: LargeProjectState, files: readonly string[]): void {
  const next = [...new Set([...state.workingSet, ...files])]
  state.workingSet = next.slice(0, ACTIVE_WORKING_SET_LIMIT)
  state.peakWorkingSet = Math.max(state.peakWorkingSet, Math.min(next.length, ACTIVE_WORKING_SET_LIMIT))
  if (state.scopeManifest.initialWorkingSet.length === 0) {
    state.scopeManifest.initialWorkingSet = [...state.workingSet]
  }
  state.scopeManifest.expandedWorkingSet = [...state.workingSet]
}

export function rememberExpansion(state: LargeProjectState, expansion: ScopeExpansion): boolean {
  if (state.expansions.length >= EXPANSION_BUDGET) return false
  state.expansions.push(expansion)
  noteWorkingSet(state, expansion.added)
  return true
}

export async function searchBounded(query: string, pathPrefix: string): Promise<RepoSearchHit[]> {
  if (!pathPrefix.trim()) return []
  return inspectSymbolUsages(query, { pathPrefix })
}

function relFromAbsolute(root: string, file: string): string | null {
  const absRoot = path.resolve(root)
  const abs = path.resolve(file)
  const rel = path.relative(absRoot, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

function moduleFile(spec: string, names: ReadonlySet<string>): string | null {
  const rel = spec.replace(/\./g, '/')
  if (names.has(`${rel}.py`)) return `${rel}.py`
  if (names.has(`${rel}/__init__.py`)) return `${rel}/__init__.py`
  return null
}

function lineSpan(source: string, index: number): { start: number; end: number; line: string } {
  const start = source.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  const breakAt = source.indexOf('\n', index)
  const end = breakAt === -1 ? source.length : breakAt
  return { start, end, line: source.slice(start, end) }
}

type FnDef = { name: string; params: { name: string; annotation?: string }[]; ret?: string; kwOnly: boolean }

function parseDef(source: string, name: string): FnDef | null {
  const match = new RegExp(`def\\s+${name}\\s*\\(`).exec(source)
  if (!match || match.index === undefined) return null
  const open = source.indexOf('(', match.index)
  let depth = 0
  let close = -1
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) { close = i; break }
    }
  }
  if (close < 0) return null
  const retMatch = /^\s*->\s*([A-Za-z_][\w.]*)/.exec(source.slice(close + 1))
  const raw = source.slice(open + 1, close)
  const kwOnly = raw.includes('*')
  const params = raw.split(',').map(part => part.trim()).filter(part => part && part !== '*' && part !== '*args' && !part.startsWith('**'))
  return {
    name,
    kwOnly,
    ret: retMatch?.[1],
    params: params.map(part => {
      const cleaned = part.replace(/^\*/, '').trim()
      const [left, annotation] = cleaned.split(':').map(item => item.trim())
      const paramName = left.split('=')[0].trim()
      return { name: paramName, annotation }
    }).filter(param => param.name && param.name !== 'self'),
  }
}

function parseAllDefs(source: string): FnDef[] {
  const names = [...source.matchAll(/^def\s+([A-Za-z_]\w*)\s*\(/gm)].map(hit => hit[1])
  return names.map(name => parseDef(source, name)).filter((item): item is FnDef => Boolean(item))
}

function importBinding(source: string, localName: string): { module: string; imported: string; lineStart: number; lineEnd: number } | null {
  const pattern = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm
  let hit: RegExpExecArray | null
  while ((hit = pattern.exec(source))) {
    const names = hit[2].split(',').map(part => part.trim()).filter(Boolean)
    for (const name of names) {
      const [imported, alias] = name.split(/\s+as\s+/).map(part => part.trim())
      if ((alias || imported) === localName) {
        const span = lineSpan(source, hit.index)
        return { module: hit[1], imported, lineStart: span.start, lineEnd: span.end }
      }
    }
  }
  return null
}

function followExport(source: string, name: string): string | null {
  const binding = importBinding(source, name)
  return binding ? `${binding.module}.${binding.imported}` : null
}

function replaceSpan(source: string, start: number, end: number, text: string): string {
  return source.slice(0, start) + text + source.slice(end)
}

export function planLargeProjectRepair(input: {
  failureText: string
  root: string
  sources: Record<string, string>
  names: readonly string[]
  configNumbers: readonly number[]
}): RepairPlan {
  const keyword = planKeywordRepair(input)
  if (keyword) return keyword
  const missingKey = planConfigKeyRepair(input)
  if (missingKey) return missingKey
  const comparison = planBoundaryComparison(input)
  if (comparison) return comparison
  const missingImport = planMissingImport(input)
  if (missingImport) return missingImport
  if (/AssertionError|TypeError|KeyError|ImportError/.test(input.failureText)) {
    return { status: 'blocked', reason: 'The failure is visible, but no bounded cross-file repair was supported by the files already read.' }
  }
  return { status: 'unsupported', reason: 'No recognized test failure yet.' }
}

function planKeywordRepair(input: {
  failureText: string
  root: string
  sources: Record<string, string>
  names: readonly string[]
}): RepairPlan | null {
  const parsed = parseUnexpectedKeyword(input.failureText)
  if (!parsed) return null
  const names = new Set(input.names)
  const frames = [...input.failureText.matchAll(/File ["']([^"']+)["'], line (\d+)/g)]
    .map(hit => relFromAbsolute(input.root, hit[1]))
    .filter((file): file is string => Boolean(file))
  const caller = frames.find(file => (input.sources[file] ?? '').includes(`${parsed.keyword}=`))
  if (!caller) {
    const needed = frames.filter(file => !input.sources[file])
    if (needed.length === 0) return { status: 'blocked', reason: `Keyword ${parsed.keyword} was reported, but no workspace frame contains that call.` }
    return {
      status: 'need_reads',
      paths: needed.slice(0, 4),
      expansion: {
        trigger: 'traceback',
        added: needed.slice(0, 4),
        reason: 'The unexpected-keyword frame has not been read.',
        expectedGain: 'Identify the callsite that passed the rejected keyword.',
        layer: 'L0',
      },
    }
  }
  const callerSource = input.sources[caller]
  const binding = importBinding(callerSource, parsed.callable.split('.').pop() ?? parsed.callable)
  if (!binding) return { status: 'blocked', reason: `No import binds ${parsed.callable} in ${caller}.` }
  const declared = moduleFile(binding.module, names)
  if (!declared) return { status: 'blocked', reason: `Import ${binding.module} does not resolve inside the repository.` }
  if (!input.sources[declared]) {
    return {
      status: 'need_reads',
      paths: [declared],
      expansion: {
        trigger: `import ${binding.module}`,
        added: [declared],
        reason: 'The callsite imports the failing symbol from another module.',
        expectedGain: 'Resolve the module that owns the callee.',
        layer: 'L1',
      },
    }
  }
  let owner = declared
  const forwarded = followExport(input.sources[declared], binding.imported)
  if (forwarded) {
    const ownerFile = moduleFile(forwarded.split('.').slice(0, -1).join('.'), names)
    if (ownerFile && !input.sources[ownerFile]) {
      return {
        status: 'need_reads',
        paths: [ownerFile],
        expansion: {
          trigger: `re-export ${binding.imported}`,
          added: [ownerFile],
          reason: `${declared} re-exports ${binding.imported}.`,
          expectedGain: 'Read the function signature that rejected the keyword.',
          layer: 'L1',
        },
      }
    }
    if (ownerFile) owner = ownerFile
  }
  const def = parseDef(input.sources[owner], binding.imported)
  if (!def) return { status: 'blocked', reason: `${binding.imported} is not defined in ${owner}.` }
  if (def.params.some(param => param.name === parsed.keyword)) {
    return { status: 'blocked', reason: `${parsed.callable} already accepts ${parsed.keyword}.` }
  }
  const target = def.params.filter(param => param.name.startsWith(`${parsed.keyword}_`) || param.name.startsWith(parsed.keyword))
  if (target.length !== 1) {
    return { status: 'blocked', reason: `No single parameter on ${binding.imported} corresponds to keyword ${parsed.keyword}.` }
  }
  const callMatch = new RegExp(`${binding.imported}\\([^\\n]*${parsed.keyword}\\s*=\\s*([A-Za-z_]\\w*)`).exec(callerSource)
  if (!callMatch || callMatch.index === undefined) return { status: 'blocked', reason: 'The rejected keyword is not a bare name at the callsite.' }
  const value = callMatch[1]
  const param = target[0]
  const packageDir = owner.split('/').slice(0, -1).join('/')
  const siblings = input.names.filter(file => file.startsWith(`${packageDir}/`) && file.endsWith('.py') && file !== owner)
  const unread = siblings.filter(file => !input.sources[file])
  if (param.annotation && unread.length > 0) {
    return {
      status: 'need_reads',
      paths: unread.slice(0, 6),
      expansion: {
        trigger: `parameter ${param.name}`,
        added: unread.slice(0, 6),
        reason: `${param.name} is annotated ${param.annotation}, and the callsite passes ${value}.`,
        expectedGain: 'Find the package function that converts the callsite value.',
        layer: 'L2',
      },
    }
  }
  const helpers = siblings.flatMap(file => parseAllDefs(input.sources[file] ?? '').map(fn => ({ file, fn })))
    .filter(item => item.fn.ret === param.annotation && item.fn.params.some(candidate => candidate.name === value))
  if (helpers.length !== 1) {
    return { status: 'blocked', reason: `Expected one ${param.annotation} helper for ${value}, found ${helpers.length}.` }
  }
  const helper = helpers[0]
  const helperModule = helper.file.replace(/\.py$/, '').replace(/\//g, '.')
  const edits: PlannedEdit[] = []
  const callSpan = lineSpan(callerSource, callMatch.index)
  const importLine = callerSource.slice(binding.lineStart, binding.lineEnd)
  const namesOnImport = importLine.split(' import ')[1]?.split(',').map(item => item.trim()) ?? []
  let nextCaller = callerSource
  let callerStart = callSpan.start
  let callerEnd = callSpan.end
  if (!namesOnImport.includes(helper.fn.name)) {
    const nextImport = importLine.replace(binding.imported, `${helper.fn.name}, ${binding.imported}`)
    nextCaller = replaceSpan(nextCaller, binding.lineStart, binding.lineEnd, nextImport)
    const shift = nextImport.length - importLine.length
    if (callSpan.start >= binding.lineEnd) {
      callerStart += shift
      callerEnd += shift
    }
  }
  const nextCall = callSpan.line.replace(`${parsed.keyword}=${value}`, `${param.name}=${helper.fn.name}(${value})`)
  nextCaller = replaceSpan(nextCaller, callerStart, callerEnd, nextCall)
  const regionStart = Math.min(binding.lineStart, callSpan.start)
  const regionEnd = Math.max(binding.lineEnd, callSpan.end)
  edits.push({
    file: caller,
    before: callerSource,
    after: nextCaller,
    start: regionStart,
    end: regionEnd,
    reason: `${binding.imported} accepts ${param.name}, not ${parsed.keyword}. ${helper.fn.name} converts ${value}.`,
  })
  if (!input.sources[declared].includes(helper.fn.name)) {
    const initBefore = input.sources[declared]
    const exportLine = `from ${helperModule} import ${helper.fn.name}`
    const anchor = lineSpan(initBefore, 0)
    const initAfter = replaceSpan(initBefore, anchor.start, anchor.end, `${anchor.line}\n${exportLine}`)
    edits.push({
      file: declared,
      before: initBefore,
      after: initAfter,
      start: anchor.start,
      end: anchor.end,
      reason: `${declared} must export ${helper.fn.name} so the callsite can import it.`,
    })
  }
  return {
    status: 'edits',
    edits,
    strategy: 'CALLSITE_TRACE',
    configNumbers: [],
    rootCause: `${caller} passes ${parsed.keyword}=${value}, but ${owner}:${binding.imported} requires ${param.name}. ${helper.file} defines ${helper.fn.name}(${value}).`,
  }
}

function parseTomlNumbers(source: string): { sections: Record<string, Record<string, number>>; numbers: number[] } {
  const sections: Record<string, Record<string, number>> = {}
  let section = ''
  const numbers: number[] = []
  for (const line of source.split('\n')) {
    const heading = /^\[([^\]]+)\]/.exec(line.trim())
    if (heading) {
      section = heading[1]
      sections[section] ??= {}
      continue
    }
    const pair = /^([A-Za-z_][\w-]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line.trim())
    if (!pair || !section) continue
    const value = Number(pair[2])
    sections[section][pair[1]] = value
    numbers.push(value)
  }
  return { sections, numbers }
}

function planConfigKeyRepair(input: {
  failureText: string
  root: string
  sources: Record<string, string>
  names: readonly string[]
}): RepairPlan | null {
  const missing = /KeyError:\s*'([^']+)'/.exec(input.failureText)
  if (!missing) return null
  const key = missing[1]
  const frames = [...input.failureText.matchAll(/File ["']([^"']+)["'], line (\d+)/g)]
    .map(hit => relFromAbsolute(input.root, hit[1]))
    .filter((file): file is string => Boolean(file))
  const owner = frames.find(file => (input.sources[file] ?? '').includes(`'${key}'`) || (input.sources[file] ?? '').includes(`"${key}"`))
  if (!owner) {
    const needed = frames.filter(file => !input.sources[file]).slice(0, 4)
    if (needed.length === 0) return { status: 'blocked', reason: `KeyError ${key} has no unread workspace frame.` }
    return {
      status: 'need_reads',
      paths: needed,
      expansion: {
        trigger: `KeyError ${key}`,
        added: needed,
        reason: 'The frame that indexes the missing key has not been read.',
        expectedGain: 'See which config file and function own the lookup.',
        layer: 'L0',
      },
    }
  }
  const source = input.sources[owner]
  const configRel = /['"]([^'"]+\.(?:toml|json))['"]/.exec(source)?.[1]
  if (!configRel) return { status: 'blocked', reason: `${owner} raises ${key} without a config path.` }
  if (!input.sources[configRel]) {
    return {
      status: 'need_reads',
      paths: [configRel],
      expansion: {
        trigger: `config ${configRel}`,
        added: [configRel],
        reason: `${owner} reads ${configRel} while looking up ${key}.`,
        expectedGain: 'Compare the missing key with the keys the config actually defines.',
        layer: 'L1',
      },
    }
  }
  const keyIndex = source.indexOf(`'${key}'`) >= 0 ? source.indexOf(`'${key}'`) : source.indexOf(`"${key}"`)
  const beforeKey = source.slice(0, keyIndex)
  const fn = [...beforeKey.matchAll(/^def\s+([A-Za-z_]\w*)\s*\(/gm)].at(-1)?.[1]
  if (!fn) return { status: 'blocked', reason: 'The missing key is not inside a function.' }
  const parsed = parseTomlNumbers(input.sources[configRel])
  const table = Object.entries(parsed.sections).find(([, values]) => values[fn] !== undefined && values[key] === undefined)
  if (!table) return { status: 'blocked', reason: `Config does not define ${fn} as a replacement for missing key ${key}.` }
  const quoted = source.includes(`'${key}'`) ? `'${key}'` : `"${key}"`
  const replacement = source.includes(`'${key}'`) ? `'${fn}'` : `"${fn}"`
  if (source.split(quoted).length !== 2) return { status: 'blocked', reason: `${key} is not a unique literal in ${owner}.` }
  const start = source.indexOf(quoted)
  const after = replaceSpan(source, start, start + quoted.length, replacement)
  return {
    status: 'edits',
    strategy: 'CONFIG_DIAGNOSIS',
    configNumbers: parsed.numbers,
    rootCause: `${owner}:${fn} reads ${key}, which ${configRel} does not define. The [${table[0]}] table defines ${fn}.`,
    edits: [{
      file: owner,
      before: source,
      after,
      start,
      end: start + quoted.length,
      reason: `Read ${fn} from [${table[0]}] instead of missing key ${key}.`,
    }],
  }
}

function planBoundaryComparison(input: {
  failureText: string
  root: string
  sources: Record<string, string>
  names: readonly string[]
  configNumbers: readonly number[]
}): RepairPlan | null {
  if (!/AssertionError:\s*False is not true/.test(input.failureText)) return null
  const frames = [...input.failureText.matchAll(/File ["']([^"']+)["'], line (\d+), in ([^\n]+)\n\s+([^\n]+)/g)]
  const assertion = frames.find(hit => hit[4].includes('assertTrue') || hit[4].includes('assert '))
  if (!assertion) return null
  const testFile = relFromAbsolute(input.root, assertion[1])
  if (!testFile) return null
  if (!input.sources[testFile]) {
    return {
      status: 'need_reads',
      paths: [testFile],
      expansion: {
        trigger: 'AssertionError',
        added: [testFile],
        reason: 'The failing assertion names the function under test.',
        expectedGain: 'Find the implementation that returned the rejected boolean.',
        layer: 'L1',
      },
    }
  }
  const called = /assertTrue\(\s*([A-Za-z_]\w*)\s*\(/.exec(assertion[4])?.[1]
  if (!called) return { status: 'blocked', reason: 'The assertion does not call a local function.' }
  const binding = importBinding(input.sources[testFile], called)
  if (!binding) return { status: 'blocked', reason: `${testFile} does not import ${called}.` }
  const names = new Set(input.names)
  const impl = moduleFile(binding.module, names)
  if (!impl) return { status: 'blocked', reason: `Import ${binding.module} does not resolve.` }
  if (!input.sources[impl]) {
    return {
      status: 'need_reads',
      paths: [impl],
      expansion: {
        trigger: `call ${called}`,
        added: [impl],
        reason: `${testFile} calls ${binding.module}.${called}, which is outside the assertion frame.`,
        expectedGain: 'Read the boolean comparison that rejected the configured boundary.',
        layer: 'L1',
      },
    }
  }
  const list = /\[[^\]]*\]/.exec(assertion[4])?.[0] ?? ''
  const count = list ? list.split(',').map(part => part.trim()).filter(part => part && part !== '[' && part !== ']').length : 0
  if (!input.configNumbers.includes(count) || count === 0) {
    return { status: 'blocked', reason: 'The assertion size does not match a known config limit.' }
  }
  const source = input.sources[impl]
  const lineMatch = /len\([^)]*\)\s*</.exec(source)
  if (!lineMatch || lineMatch.index === undefined) return { status: 'blocked', reason: `${impl} has no strict length comparison.` }
  const line = lineSpan(source, lineMatch.index).line
  if (source.split(line).length !== 2 || line.includes('<=')) return { status: 'blocked', reason: 'The length comparison is not a unique strict operator.' }
  const start = lineMatch.index + lineMatch[0].lastIndexOf('<')
  const after = replaceSpan(source, start, start + 1, '<=')
  return {
    status: 'edits',
    strategy: 'TEST_FAILURE_ISOLATION',
    configNumbers: [...input.configNumbers],
    rootCause: `${testFile} accepts a list of ${count}, which is a configured limit, but ${impl} uses a strict less-than.`,
    edits: [{
      file: impl,
      before: source,
      after,
      start,
      end: start + 1,
      reason: `Include the configured boundary ${count}.`,
    }],
  }
}

function planMissingImport(input: {
  failureText: string
  sources: Record<string, string>
  names: readonly string[]
}): RepairPlan | null {
  const missing = /cannot import name '([^']+)' from '([^']+)'/.exec(input.failureText)
  if (!missing) return null
  const name = missing[1]
  const moduleName = missing[2]
  const declared = moduleFile(moduleName, new Set(input.names))
  if (!declared) return { status: 'blocked', reason: `Import ${moduleName} does not resolve inside the repository.` }
  if (!input.sources[declared]) {
    return {
      status: 'need_reads',
      paths: [declared],
      expansion: {
        trigger: `ImportError ${name}`,
        added: [declared],
        reason: `${moduleName} was named as the owner of ${name}.`,
        expectedGain: 'See whether that module actually defines the symbol.',
        layer: 'L0',
      },
    }
  }
  if (parseDef(input.sources[declared], name)) return null
  const dir = declared.split('/').slice(0, -1).join('/')
  const parent = dir.includes('/') ? dir.split('/').slice(0, -1).join('/') : dir
  const candidates = input.names.filter(file => file.endsWith('.py') && (file.startsWith(`${dir}/`) || file.startsWith(`${parent}/`)))
  const unread = candidates.filter(file => input.sources[file] === undefined)
  if (unread.length > 0) {
    return {
      status: 'need_reads',
      paths: unread.slice(0, 6),
      expansion: {
        trigger: `missing ${name}`,
        added: unread.slice(0, 6),
        reason: `${declared} does not define ${name}.`,
        expectedGain: 'Find the one module in the package that does define it, and the files that import the missing name.',
        layer: 'L1',
      },
    }
  }
  const owners = candidates.filter(file => parseDef(input.sources[file] ?? '', name))
  if (owners.length !== 1) return { status: 'blocked', reason: `Expected one definition of ${name}, found ${owners.length}.` }
  const ownerModule = owners[0].replace(/\.py$/, '').replace(/\//g, '.')
  const importLine = `from ${moduleName} import ${name}`
  const nextLine = `from ${ownerModule} import ${name}`
  const importers = candidates.filter(file => file !== owners[0] && (input.sources[file] ?? '').includes(importLine))
  if (importers.length === 0) return { status: 'blocked', reason: `No loaded file imports ${name} from ${moduleName}.` }
  const edits: PlannedEdit[] = []
  for (const file of importers) {
    const source = input.sources[file]
    if (source.split(importLine).length !== 2) return { status: 'blocked', reason: `${importLine} is not unique in ${file}.` }
    const span = lineSpan(source, source.indexOf(importLine))
    edits.push({
      file,
      before: source,
      after: replaceSpan(source, span.start, span.end, span.line.replace(importLine, nextLine)),
      start: span.start,
      end: span.end,
      reason: `${name} is defined in ${owners[0]}, not ${moduleName}.`,
    })
  }
  return {
    status: 'edits',
    edits,
    strategy: 'CALLSITE_TRACE',
    configNumbers: [],
    rootCause: `${name} is imported from ${moduleName}, which does not define it. ${owners[0]} does.`,
  }
}

export function targetedTestCommand(testFile: string | null): { args: string[] } {
  if (testFile && testFile.endsWith('.py')) {
    return { args: ['-m', 'unittest', 'discover', '-s', path.dirname(testFile) || '.', '-p', path.basename(testFile), '-q'] }
  }
  return { args: ['-m', 'unittest', 'discover', '-s', 'tests', '-q'] }
}

export function regressionTestCommand(): { args: string[] } {
  return { args: ['-m', 'unittest', 'discover', '-s', 'tests', '-q'] }
}

export function failureFile(root: string, failureText: string): string | null {
  const frames = [...failureText.matchAll(/File ["']([^"']+)["'], line (\d+)/g)]
  for (const hit of frames) {
    const rel = relFromAbsolute(root, hit[1])
    if (rel && rel.startsWith('tests/')) return rel
  }
  return null
}

export function keyFailureLine(text: string): string {
  const lines = text.split('\n').map(item => item.trim())
  const named = lines.find(item => /^(NameError|TypeError|KeyError|AssertionError|ImportError|AttributeError|SyntaxError)\b/.test(item))
  const other = lines.find(item => /Error:/.test(item) && !/^ERROR:\s/.test(item))
  return (named ?? other ?? 'command failed').slice(0, 240)
}
