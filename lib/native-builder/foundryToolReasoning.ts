/**
 * Phase 5 - tool depth and agentic research (pure: no filesystem, network or clock; timestamps come in).
 *
 * Foundry picks its next tool from the latest evidence, never from a fixed order:
 *   repository truth  -> the context engine (files, symbols, callers, tests)
 *   behaviour truth   -> a targeted terminal run (installed versions, the failing test under a call trace)
 *   external facts    -> primary-source research (official docs, release notes, the project's own repository)
 *   nothing missing   -> no tool: the local tests already answer it
 * Research is a tool, not a destination: every question has a stated reason, a budget, a stop rule and an explicit return to coding.
 *
 * Everything the Commander reads is built here from typed fields; raw enums, scores and counters stay in receipts (Activity/Details).
 */
import { isSecretFile, redactSecrets } from './foundryProjectContext'
import { secureHintFor } from './foundrySecureDefaults'

export const TOOL_LIMITS = {
  receipts: 40,
  questions: 4,
  questionsPerMission: 3,
  waves: 2,
  fetchesPerQuestion: 6,
  fetchesPerMission: 12,
  notes: 4,
  noteChars: 640,
  quoteChars: 260,
  claimsPerDocument: 6,
  findingsPerQuestion: 6,
  consultedPerQuestion: 10,
  traces: 3,
  traceEntries: 16,
  traceChars: 1400,
  freshDays: 30,
  queryChars: 120,
} as const

export type ToolKind = 'PROJECT_SEARCH' | 'TERMINAL' | 'WEB' | 'NONE'

/** 1 = best. Official documentation, the official source repository, the official changelog, standards, maintainer material, reputable references, community. */
export type SourceTier = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const TIER_NAMES: Record<SourceTier, string> = {
  1: 'official documentation',
  2: 'official source repository',
  3: 'official release notes',
  4: 'standard or specification',
  5: 'maintainer material',
  6: 'technical reference',
  7: 'community or project notes',
}

export type ClaimAction = 'REMOVED' | 'MOVED' | 'RENAMED' | 'DEPRECATED' | 'ADDED' | 'NOW_REQUIRED' | 'AVAILABLE'
const GONE: readonly ClaimAction[] = ['REMOVED', 'MOVED', 'RENAMED']

export type Claim = { subject: string; action: ClaimAction; version: string | null; replacement: string | null; quote: string }
export type SourcedClaim = Claim & { url: string; tier: SourceTier; label: string; fetchedAt: string }

export type InstalledInfo = {
  root: string
  python: string
  stdlib: boolean
  dist: string | null
  version: string | null
  urls: { label: string; url: string }[]
}

export type ExternalDetail = 'MISSING_IMPORT' | 'MISSING_ATTRIBUTE' | 'SIGNATURE' | 'LIBRARY_RAISED'
export type FailureKind = 'EXTERNAL_API' | 'MISSING_PACKAGE' | 'LOCAL_SYMBOL' | 'LOCAL_VALUE' | 'LOCAL_RUNTIME' | 'UNKNOWN'

export type FailureAnalysis = {
  kind: FailureKind
  exception: string | null
  message: string
  external: { root: string; symbol: string | null; argument: string | null; detail: ExternalDetail } | null
  projectFrames: string[]
  projectFileCount: number
  testId: string | null
  importFailure: boolean
  /** The module a "No module named" failure asked for. */
  missing: string | null
  /** Same failure, same code: identical keys mean nothing new has been learned. */
  key: string
}

export type ResearchQuestion = {
  key: string
  root: string
  symbol: string | null
  argument: string | null
  detail: ExternalDetail
  text: string
  terms: string[]
  /** Every group must have at least one member in the paragraph a claim comes from: keeps a common word from being taken for the answer. */
  groups: string[][]
  installedLabel: string
  /** What answer would change the plan, in one plain phrase. */
  wouldChange: string
}

export type ConflictNote = { winner: { label: string; url: string; tier: SourceTier; claim: string }; loser: { label: string; url: string; tier: SourceTier; claim: string }; reason: string }

export type QuestionState = {
  key: string
  text: string
  root: string
  symbol: string | null
  status: 'OPEN' | 'ANSWERED' | 'INCONCLUSIVE'
  waves: number
  consulted: { url: string; tier: SourceTier; ok: boolean; at: string }[]
  findings: SourcedClaim[]
  conflicts: ConflictNote[]
  implication: string | null
  installedVersion: string | null
  answeredAt: string | null
  /** Set when the answer came from an earlier verified mission (same library, same installed version, still fresh) and no web read was made for it. */
  fromMemory?: { checkedAt: string; url: string }
  /** True when an earlier verified mission had already researched this and the answer was re-checked against the source instead of trusted. */
  recheckedFromMemory?: boolean
}

export type ToolReceipt = {
  id: string
  tool: ToolKind
  at: string
  stage: 'start' | 'failure'
  why: string
  question: string | null
  ran: string
  sent: string[]
  found: string
  changedPlan: boolean
  next: string
  urls?: string[]
  command?: string
  exitCode?: number | null
}

export type ToolingState = {
  receipts: ToolReceipt[]
  installed: Record<string, InstalledInfo>
  questions: QuestionState[]
  probed: string[]
  mode: 'CODING' | 'RESEARCHING'
  fetches: number
  /** Failure keys the terminal was already used for; the same key with the same code is never traced twice. */
  traced: string[]
  localSaid: boolean
  notes: string[]
  told: string[]
  /** Set while a question is open and unresolved so a restart continues it rather than starting over. */
  current: string | null
  /** How much of the context engine's work already has a receipt, so a restart or a later failure never writes the same receipt twice. */
  searched: { discovered: boolean; expansions: number }
  /** Package name -> the module names it is imported as, learned from the installed metadata (a changelog says "MarkupSafe", the code imports markupsafe). */
  importNames: Record<string, { version: string | null; modules: string[] }>
  /** `root.symbol` -> what the INSTALLED callable accepts, read locally. Answers "unexpected keyword argument" failures without any web read. */
  signatures: Record<string, { signature: string | null; params: string[] }>
}

export function emptyTooling(): ToolingState {
  return { receipts: [], installed: {}, questions: [], probed: [], mode: 'CODING', fetches: 0, traced: [], localSaid: false, notes: [], told: [], current: null, searched: { discovered: false, expansions: 0 }, importNames: {}, signatures: {} }
}

/** Restores a persisted state: anything malformed is dropped, sizes are capped. */
export function restoreTooling(raw: unknown): ToolingState {
  const base = emptyTooling()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Partial<ToolingState>
  const list = <T,>(input: unknown, max: number, ok: (item: unknown) => boolean): T[] => (Array.isArray(input) ? (input.filter(ok).slice(-max) as T[]) : [])
  base.receipts = list<ToolReceipt>(value.receipts, TOOL_LIMITS.receipts, item => Boolean(item) && typeof (item as ToolReceipt).id === 'string' && typeof (item as ToolReceipt).tool === 'string')
  base.questions = list<QuestionState>(value.questions, TOOL_LIMITS.questions, item => Boolean(item) && typeof (item as QuestionState).key === 'string' && Array.isArray((item as QuestionState).findings))
  base.probed = list<string>(value.probed, 12, item => typeof item === 'string')
  base.traced = list<string>(value.traced, 12, item => typeof item === 'string')
  base.notes = list<string>(value.notes, TOOL_LIMITS.notes, item => typeof item === 'string')
  base.told = list<string>(value.told, 12, item => typeof item === 'string')
  if (value.installed && typeof value.installed === 'object') {
    for (const [root, info] of Object.entries(value.installed)) if (info && typeof info === 'object' && typeof (info as InstalledInfo).python === 'string') base.installed[root] = info as InstalledInfo
  }
  base.mode = value.mode === 'RESEARCHING' ? 'RESEARCHING' : 'CODING'
  base.fetches = typeof value.fetches === 'number' ? Math.max(0, Math.min(999, value.fetches)) : 0
  base.localSaid = value.localSaid === true
  base.current = typeof value.current === 'string' ? value.current : null
  if (value.importNames && typeof value.importNames === 'object') {
    for (const [name, info] of Object.entries(value.importNames)) if (info && Array.isArray((info as { modules: string[] }).modules)) base.importNames[name] = { version: typeof (info as { version: string | null }).version === 'string' ? (info as { version: string }).version : null, modules: (info as { modules: string[] }).modules.filter(item => typeof item === 'string').slice(0, 4) }
  }
  if (value.signatures && typeof value.signatures === 'object') {
    for (const [key, info] of Object.entries(value.signatures).slice(0, 8)) if (info && Array.isArray((info as { params: string[] }).params)) base.signatures[key] = { signature: typeof (info as { signature: string | null }).signature === 'string' ? (info as { signature: string }).signature.slice(0, 200) : null, params: (info as { params: string[] }).params.filter(item => typeof item === 'string' && IDENT.test(item)).slice(0, 24) }
  }
  if (value.searched && typeof value.searched === 'object') base.searched = { discovered: value.searched.discovered === true, expansions: Math.max(0, Math.min(99, Number(value.searched.expansions) || 0)) }
  return base
}

// ---------------------------------------------------------------- versions

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(part => parseInt(part, 10) || 0)
  const pb = b.split('.').map(part => parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff < 0 ? -1 : 1
  }
  return 0
}

function cleanVersion(text: string | null | undefined): string | null {
  const hit = /(\d+(?:\.\d+){1,3})/.exec(text ?? '')
  return hit ? hit[1] : null
}

// ---------------------------------------------------------------- failure analysis

const ANSI = /\u001b\[[0-9;]*m/g
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const EXTERNAL_PATH = /(site-packages|dist-packages|\/lib\/python3[^/]*\/(?!site-packages))/

export type FailureContext = {
  projectFiles: readonly string[]
  sourceOf: (rel: string) => string | null
  /** Top-level names the project itself defines (modules and packages), so an import of one of them is never treated as external. */
  projectModules?: readonly string[]
}

type Frame = { path: string; line: number; name: string; code: string; project: string | null; external: boolean }

function parseFrames(block: string, files: readonly string[]): Frame[] {
  const frames: Frame[] = []
  const pattern = /File "([^"]+)", line (\d+), in (\S+)\n?([^\n]*)/g
  for (const hit of block.matchAll(pattern)) {
    const abs = hit[1].replace(/\\/g, '/')
    const project = files.filter(file => abs === file || abs.endsWith(`/${file}`)).sort((a, b) => b.length - a.length)[0] ?? null
    const code = /^\s{2,}(\S.*)$/.exec(hit[4] ?? '')?.[1] ?? ''
    frames.push({ path: abs, line: Number(hit[2]), name: hit[3], code, project, external: !project && EXTERNAL_PATH.test(abs) })
  }
  return frames
}

function packageFromPath(abs: string): string | null {
  const hit = /(?:site-packages|dist-packages)\/([A-Za-z0-9_]+)/.exec(abs)
  return hit ? hit[1] : null
}

function importedRoot(source: string | null, alias: string): string | null {
  if (!source) return null
  const plain = new RegExp(`^\\s*import\\s+([A-Za-z0-9_.]+)(?:\\s+as\\s+${alias})?\\s*$`, 'm')
  const asForm = new RegExp(`^\\s*import\\s+([A-Za-z0-9_.]+)\\s+as\\s+${alias}\\b`, 'm').exec(source)
  if (asForm) return asForm[1].split('.')[0]
  const named = new RegExp(`^\\s*from\\s+([A-Za-z0-9_.]+)\\s+import\\s+[^\\n]*\\b${alias}\\b`, 'm').exec(source)
  if (named) return named[1].split('.')[0]
  if (new RegExp(`^\\s*import\\s+${alias}\\b`, 'm').test(source)) return alias
  void plain
  return null
}

export function analyzeFailure(rawOutput: string, ctx: FailureContext): FailureAnalysis {
  const raw = rawOutput.replace(ANSI, '')
  const projectModules = new Set([...(ctx.projectModules ?? []), ...ctx.projectFiles.map(file => file.split('/')[0].replace(/\.py$/, ''))])
  const importFailure = /unittest\.loader\._FailedTest|Failed to import test module/.test(raw)
  const header = /^(?:ERROR|FAIL): (\S+) \(([^)]+)\)/m.exec(raw)
  let testId: string | null = null
  if (header && !importFailure) testId = header[2].endsWith(`.${header[1]}`) ? header[2] : `${header[2]}.${header[1]}`
  const start = raw.indexOf('Traceback (most recent call last):')
  const block = start >= 0 ? (raw.slice(start).split(/\n(?:={10,}|-{10,})\n/)[0] ?? '') : ''
  const frames = parseFrames(block, ctx.projectFiles)
  const lines = block.trim().split('\n')
  const last = [...lines].reverse().find(line => line && !/^\s/.test(line) && !/^Traceback/.test(line)) ?? ''
  const parsed = /^([A-Za-z_][\w.]*)(?::\s?(.*))?$/.exec(last)
  const exception = parsed ? parsed[1].split('.').pop() ?? null : null
  const message = (parsed?.[2] ?? '').trim().slice(0, 240)
  const projectFrames = frames.filter(frame => frame.project && !/^tests?\//.test(frame.project)).map(frame => `${frame.project}:${frame.name}`)
  const projectFileCount = new Set(frames.filter(frame => frame.project && !/^tests?\//.test(frame.project)).map(frame => frame.project)).size
  const isExternalName = (name: string) => Boolean(name) && !projectModules.has(name)
  const noModule = /No module named ['"]([^'"]+)['"]/.exec(message)
  const done = (kind: FailureKind, external: FailureAnalysis['external'] = null): FailureAnalysis => ({
    kind, exception, message, external, projectFrames: [...new Set(projectFrames)].slice(0, 8), projectFileCount, testId, importFailure, missing: noModule ? noModule[1].split('.')[0] : null,
    key: `${kind}|${exception ?? ''}|${message.replace(/0x[0-9a-f]+|\d+/gi, '#').slice(0, 100)}|${external?.root ?? ''}|${external?.symbol ?? ''}`,
  })
  if (!exception) return done('UNKNOWN')

  const cannotImport = /cannot import name ['"]([^'"]+)['"] from ['"]([^'"]+)['"]/.exec(message)
  if (exception === 'ImportError' && cannotImport) {
    const root = cannotImport[2].split('.')[0]
    if (isExternalName(root)) return done('EXTERNAL_API', { root, symbol: cannotImport[1], argument: null, detail: 'MISSING_IMPORT' })
    return done('LOCAL_SYMBOL')
  }
  if (noModule) return isExternalName(noModule[1].split('.')[0]) ? done('MISSING_PACKAGE') : done('LOCAL_SYMBOL')
  const noAttribute = /module ['"]([^'"]+)['"] has no attribute ['"]([^'"]+)['"]/.exec(message)
  if (exception === 'AttributeError' && noAttribute) {
    const root = noAttribute[1].split('.')[0]
    if (isExternalName(root)) return done('EXTERNAL_API', { root, symbol: noAttribute[2], argument: null, detail: 'MISSING_ATTRIBUTE' })
    return done('LOCAL_SYMBOL')
  }
  if (exception === 'NameError') return done('LOCAL_SYMBOL')

  const innermost = frames[frames.length - 1]
  const lastProject = [...frames].reverse().find(frame => frame.project && !/^tests?\//.test(frame.project))
  // A call made with the wrong signature, or a library raising because of how it was called: find which library from the call site.
  const signature = /(\w+)\(\) (?:missing|got an unexpected|takes|got multiple)/.exec(message)
  const argument = /argument[s]?:? ['"]([A-Za-z_]\w*)['"]/.exec(message)?.[1] ?? /unexpected keyword argument ['"]([A-Za-z_]\w*)['"]/.exec(message)?.[1] ?? null
  if (lastProject && (signature || innermost?.external)) {
    const call = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/.exec(lastProject.code)
    if (call) {
      const root = importedRoot(ctx.sourceOf(lastProject.project ?? ''), call[1])
      if (root && isExternalName(root)) return done('EXTERNAL_API', { root, symbol: call[2], argument, detail: signature ? 'SIGNATURE' : 'LIBRARY_RAISED' })
    }
    const named = /\b([A-Za-z_]\w*)\(/.exec(lastProject.code)
    if (named && signature) {
      const source = ctx.sourceOf(lastProject.project ?? '')
      const from = source ? new RegExp(`^\\s*from\\s+([A-Za-z0-9_.]+)\\s+import\\s+[^\\n]*\\b${named[1]}\\b`, 'm').exec(source) : null
      if (from && isExternalName(from[1].split('.')[0])) return done('EXTERNAL_API', { root: from[1].split('.')[0], symbol: named[1], argument, detail: 'SIGNATURE' })
    }
  }
  if (innermost?.external) {
    const root = packageFromPath(innermost.path)
    if (root && isExternalName(root)) return done('EXTERNAL_API', { root, symbol: innermost.name, argument, detail: 'LIBRARY_RAISED' })
  }
  if (exception === 'AssertionError') return done('LOCAL_VALUE')
  if (projectFrames.length) return done('LOCAL_RUNTIME')
  return done('UNKNOWN')
}

// ---------------------------------------------------------------- questions

export function questionFor(analysis: FailureAnalysis, installed: InstalledInfo | null): ResearchQuestion | null {
  const ext = analysis.external
  if (!ext) return null
  if (!IDENT.test(ext.root) || (ext.symbol && !IDENT.test(ext.symbol)) || (ext.argument && !IDENT.test(ext.argument))) return null
  const label = installed ? (installed.stdlib ? `Python ${installed.python}` : `${ext.root}${installed.version ? ` ${installed.version}` : ''}`) : ext.root
  const target = ext.symbol ? `${ext.root}.${ext.symbol}` : ext.root
  const text = ext.detail === 'MISSING_IMPORT' || ext.detail === 'MISSING_ATTRIBUTE'
    ? `What happened to ${target} in ${label}, the version installed here, and what should the code use instead?`
    : `What does ${label}, the version installed here, expect when ${target} is called${ext.argument ? ` (the ${ext.argument} argument)` : ''}?`
  const names = ext.symbol ? [ext.symbol, `${ext.root}.${ext.symbol}`] : [ext.root]
  const terms = [...names, ext.argument].filter((term): term is string => Boolean(term))
  const groups = ext.detail === 'SIGNATURE' && ext.argument ? [names, [ext.argument]] : [names]
  return {
    key: `${ext.root}.${ext.symbol ?? ''}.${ext.detail}.${ext.argument ?? ''}@${installed?.version ?? installed?.python ?? '?'}`,
    root: ext.root, symbol: ext.symbol, argument: ext.argument, detail: ext.detail, text, terms, groups, installedLabel: label,
    wouldChange: ext.detail === 'SIGNATURE' ? 'how the call must be written' : 'which name the code should use',
  }
}

/** Only technical identifiers ever leave the machine: never file content, values, paths or anything that looks like a secret. */
export function isSafeQuery(query: string): boolean {
  if (query.length === 0 || query.length > TOOL_LIMITS.queryChars) return false
  if (!/^[A-Za-z0-9_.\- ]+$/.test(query)) return false
  return redactSecrets(query) === query
}

export function safeQueryFor(question: ResearchQuestion, installed: InstalledInfo | null): string | null {
  const parts = [question.root, question.symbol, installed?.version ? `${installed.version}` : null, question.detail === 'SIGNATURE' ? 'changelog' : 'removed changelog'].filter((part): part is string => Boolean(part))
  const query = parts.join(' ')
  return isSafeQuery(query) ? query : null
}

// ---------------------------------------------------------------- sources

export function docsHostFor(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export function tierOf(url: string, official: { hosts: readonly string[]; repos: readonly string[] }): SourceTier {
  let parsed: URL
  try { parsed = new URL(url) } catch { return 7 }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.toLowerCase()
  const changelog = /change|release|history|whatsnew|news|migrat/.test(path)
  if (host === 'docs.python.org') return changelog ? 3 : 1
  if (/(^|\.)(rfc-editor\.org|w3\.org|whatwg\.org|ietf\.org|ecma-international\.org|unicode\.org)$/.test(host)) return 4
  if (host === 'raw.githubusercontent.com' || host === 'github.com' || host === 'api.github.com') {
    const parts = parsed.pathname.split('/').filter(Boolean)
    const slug = (host === 'api.github.com' ? parts.slice(1, 3) : parts.slice(0, 2)).join('/').toLowerCase()
    if (official.repos.some(repo => repo.toLowerCase() === slug)) return changelog ? 3 : 2
    return 6
  }
  if (official.hosts.some(officialHost => host === officialHost || host.endsWith(`.${officialHost}`))) return changelog ? 3 : 1
  if (host === 'pypi.org' || host === 'registry.npmjs.org') return 5
  if (/(^|\.)(developer\.mozilla\.org|readthedocs\.io)$/.test(host)) return 6
  return 7
}

function githubSlug(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com') return null
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
    return owner && repo ? `${owner}/${repo.replace(/\.git$/, '')}` : null
  } catch { return null }
}

export function rawGithubUrl(url: string): string {
  const blob = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(url)
  return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}` : url
}

export type SourcePlan = { url: string; why: string }
export type OfficialHints = { hosts: string[]; repos: string[] }

export function officialHints(info: InstalledInfo): OfficialHints {
  const hosts: string[] = []
  const repos: string[] = []
  for (const link of info.urls) {
    const slug = githubSlug(link.url)
    if (slug) repos.push(slug)
    else { const host = docsHostFor(link.url); if (host) hosts.push(host) }
  }
  if (info.stdlib) hosts.push('docs.python.org', 'python.org')
  return { hosts: [...new Set(hosts)], repos: [...new Set(repos)] }
}


/**
 * Where to look, in the order the evidence quality says: official docs and release notes first (wave one), then the official repository and registry
 * (wave two). Already-consulted addresses are never proposed again.
 */
export function sourcePlan(question: ResearchQuestion, info: InstalledInfo, wave: 1 | 2, consulted: readonly string[]): SourcePlan[] {
  const out: SourcePlan[] = []
  const add = (url: string, why: string) => { if (!consulted.includes(url) && !out.some(item => item.url === url)) out.push({ url, why }) }
  const py = /^(\d+)\.(\d+)/.exec(info.python)
  if (info.stdlib) {
    if (wave === 1) {
      add(`https://docs.python.org/3/library/${question.root}.html`, 'the current library documentation')
      if (py) add(`https://docs.python.org/3/whatsnew/${py[1]}.${py[2]}.html`, 'the release notes for the installed Python')
    } else {
      if (py) for (let minor = Number(py[2]) - 1; minor >= Math.max(0, Number(py[2]) - 4); minor -= 1) add(`https://docs.python.org/3/whatsnew/${py[1]}.${minor}.html`, 'earlier Python release notes')
      add(`https://raw.githubusercontent.com/python/cpython/main/Doc/library/${question.root}.rst`, 'the documentation source in the official repository')
    }
    return out.slice(0, 4)
  }
  const changes = info.urls.filter(link => /change|release|history|news/i.test(link.label))
  const docs = info.urls.filter(link => /^doc/i.test(link.label))
  const repo = info.urls.map(link => githubSlug(link.url)).find(Boolean) ?? null
  if (wave === 1) {
    for (const link of changes.slice(0, 2)) add(rawGithubUrl(link.url), 'the official changelog')
    if (!changes.length) for (const link of docs.slice(0, 1)) add(link.url, 'the official documentation')
  } else {
    if (repo) add(`https://api.github.com/repos/${repo}/contents/`, 'the file list of the official repository')
    for (const link of docs.slice(0, 1)) add(link.url, 'the official documentation')
    if (info.dist) add(`https://pypi.org/pypi/${info.dist}/json`, 'the package registry entry')
  }
  return out.slice(0, 4)
}

// ---------------------------------------------------------------- reading documents

export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(h\d|li|p|pre|dt|dd|div|tr|section)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/¶/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 600_000)
}

const ACTION_PATTERNS: [ClaimAction, RegExp][] = [
  ['REMOVED', /\b(removed|remove|dropped|drop|no longer (?:available|exist[s]?|supported|provided|importable|accepted))\b/i],
  ['RENAMED', /\brenamed\b/i],
  ['MOVED', /\b(should be imported from|moved to|now (?:lives|found) in|import(?:ed)? (?:it |them )?from)\b/i],
  ['NOW_REQUIRED', /\b(?:always require[sd]?|now requires?|is now required|is required|are now required|became required|mandatory)\b/i],
  ['DEPRECATED', /\b(deprecated|deprecation)\b/i],
  ['AVAILABLE', /\b(still (?:works?|available|supported|importable|exists?)|works? (?:fine )?(?:in|with|on) (?:all )?(?:versions?|\d)|remains? available)\b/i],
  ['ADDED', /\b(new in version|added in|introduced in|new function|was added)\b/i],
]

function actionOf(text: string): ClaimAction | null {
  for (const [action, pattern] of ACTION_PATTERNS) if (pattern.test(text)) return action
  return null
}

function replacementOf(text: string): string | null {
  const patterns = [
    /(?:should be )?imported? (?:it |them )?from ([`'"]?[A-Za-z0-9_.]+[`'"]?)/i,
    /renamed to ([`'"]?[A-Za-z0-9_.()]+[`'"]?)/i,
    /use ([`'"]?[A-Za-z0-9_.()]+[`'"]?)(?: or ([`'"]?[A-Za-z0-9_.()]+[`'"]?))? instead/i,
    /replaced (?:by|with) ([`'"]?[A-Za-z0-9_.()]+[`'"]?)/i,
    /moved to ([`'"]?[A-Za-z0-9_.()]+[`'"]?)/i,
  ]
  for (const pattern of patterns) {
    const hit = pattern.exec(text)
    if (hit) return hit[1].replace(/[`'"]/g, '').replace(/[.,;:]+$/, '')
  }
  return null
}

const HEADING = /^\s*(?:(?:Version|Release|v)\s*(\d+\.\d+(?:\.\d+){0,2})\b|(\d+\.\d+(?:\.\d+){0,2})\s*(?:\(\d{4}|[—-]\s*\d{4}|\(TBD|$))/i

const escapeRe = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(term)}([^A-Za-z0-9_]|$)`).test(text)

/** Claims a document makes about the terms: what happened to a name, in which version, and what replaces it. */
export function extractClaims(text: string, terms: readonly string[], opts: { pageVersion?: string | null; groups?: string[][] } = {}): Claim[] {
  const lines = text.split('\n')
  const headingAt = (index: number): string | null => {
    if (opts.pageVersion) return opts.pageVersion
    for (let i = index; i >= 0; i -= 1) {
      const line = lines[i]
      if (line.length > 90) continue
      const hit = HEADING.exec(line)
      if (hit) return hit[1] ?? hit[2] ?? null
    }
    return null
  }
  const claims: Claim[] = []
  const seen = new Set<string>()
  const wanted = terms.filter(term => term.length >= 2)
  for (let i = 0; i < lines.length && claims.length < TOOL_LIMITS.claimsPerDocument; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const hits = wanted.filter(term => mentions(line, term))
    if (!hits.length) continue
    const paragraph = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    // Every group must be met on the very line that names the thing: neighbouring lines only ever lend the verb, never the subject.
    if (opts.groups && !opts.groups.every(group => group.some(term => mentions(line, term)))) continue
    // The action can sit on the line itself, next to it, or on the lead line of a list ("Remove the following functions:").
    let own = actionOf(line) ?? actionOf(lines[i + 1] ?? '') ?? actionOf(lines[i - 1] ?? '')
    let lead = ''
    for (let back = 1; back <= 6 && i - back >= 0; back += 1) {
      const candidate = lines[i - back]
      if (!/:\s*$/.test(candidate.trim())) continue
      const leadAction = actionOf(candidate)
      // A list under "Removed from X:" states removals even when an item mentions an older deprecation.
      if (leadAction === 'REMOVED' && (!own || own === 'DEPRECATED' || own === 'ADDED')) { own = 'REMOVED'; lead = candidate; break }
      if (!own && leadAction) { own = leadAction; lead = candidate; break }
    }
    if (!own) continue
    const full = `${lead} ${paragraph}`.replace(/\s+/g, ' ').trim()
    const versionHere = own === 'ADDED' || own === 'DEPRECATED'
      ? cleanVersion(/(?:new in version|added in|introduced in|deprecated since(?: version| python)?)\s+(?:python\s+)?(\d+(?:\.\d+)+)/i.exec(full)?.[0])
      : null
    const textVersion = cleanVersion(/(?:removed|dropped|moved|renamed|required|no longer)[^.]{0,50}?\b(?:in|since|from|as of|after|until)\s+(?:version\s+)?(?:[A-Za-z]+\s+)?(\d+\.\d+(?:\.\d+)?)/i.exec(full)?.[0])
    const version = versionHere && own === 'ADDED' ? versionHere : headingAt(i) ?? versionHere ?? textVersion
    const claim: Claim = { subject: hits[0], action: own, version, replacement: replacementOf(full), quote: redactSecrets(full).slice(0, TOOL_LIMITS.quoteChars) }
    const id = `${claim.action}|${claim.version}|${claim.quote.slice(0, 60)}`
    if (seen.has(id)) continue
    seen.add(id)
    claims.push(claim)
  }
  return claims
}

// ---------------------------------------------------------------- weighing claims

function family(action: ClaimAction): string {
  return GONE.includes(action) ? 'GONE' : action
}

export type Resolution = {
  best: SourcedClaim | null
  supporting: SourcedClaim[]
  conflicts: ConflictNote[]
  outcome: 'CONFIRMED' | 'SINGLE_SOURCE' | 'CONFLICT_RESOLVED' | 'UNRESOLVED' | 'NONE'
  /** True when the winning claim says the name is not usable as-is in the installed version. */
  appliesHere: boolean | null
}

export function describeClaim(claim: SourcedClaim): string {
  const what = { REMOVED: 'was removed', MOVED: 'moved', RENAMED: 'was renamed', DEPRECATED: 'was deprecated', ADDED: 'was added', NOW_REQUIRED: 'became required', AVAILABLE: 'is still available' }[claim.action]
  return `${claim.subject} ${what}${claim.version ? ` in ${claim.version}` : ''}`
}

/** Two claims tell one story when they are steps of it (deprecated, then removed; added, then removed); they conflict when they cannot both be true. */
function consistent(a: SourcedClaim, b: SourcedClaim): boolean {
  if (family(a.action) === family(b.action)) return a.version === null || b.version === null || compareVersions(a.version, b.version) === 0
  const pair = new Set([family(a.action), family(b.action)])
  const [early, late] = a.version && b.version && compareVersions(a.version, b.version) > 0 ? [b, a] : [a, b]
  if (pair.has('AVAILABLE')) return false
  if (pair.has('DEPRECATED') && pair.has('GONE')) return !(early.version && late.version) || family(early.action) === 'DEPRECATED'
  if (pair.has('ADDED') && pair.has('GONE')) return !(early.version && late.version) || family(early.action) === 'ADDED'
  return true
}

function priority(action: ClaimAction, detail: ExternalDetail | undefined): number {
  const order: ClaimAction[] = detail === 'SIGNATURE' ? ['NOW_REQUIRED', 'REMOVED', 'MOVED', 'RENAMED', 'DEPRECATED', 'ADDED', 'AVAILABLE'] : ['REMOVED', 'MOVED', 'RENAMED', 'NOW_REQUIRED', 'DEPRECATED', 'ADDED', 'AVAILABLE']
  return order.indexOf(action)
}

/** Official evidence outranks everything else; disagreements are written down with the reason, never averaged. */
export function weighClaims(claims: readonly SourcedClaim[], installedVersion: string | null, detail?: ExternalDetail): Resolution {
  if (!claims.length) return { best: null, supporting: [], conflicts: [], outcome: 'NONE', appliesHere: null }
  const ranked = [...claims].sort((a, b) => a.tier - b.tier || priority(a.action, detail) - priority(b.action, detail) || (b.version ? 1 : 0) - (a.version ? 1 : 0))
  const authoritative = ranked.filter(claim => claim.tier <= 5)
  const pool = authoritative.length ? authoritative : ranked
  const best = pool[0]
  const conflicts: ConflictNote[] = []
  for (const other of ranked) {
    if (other === best || consistent(best, other)) continue
    if (other.tier === best.tier && other.tier <= 5) continue
    conflicts.push({
      winner: { label: best.label, url: best.url, tier: best.tier, claim: describeClaim(best) },
      loser: { label: other.label, url: other.url, tier: other.tier, claim: describeClaim(other) },
      reason: other.tier > best.tier ? `${TIER_NAMES[best.tier]} outranks ${TIER_NAMES[other.tier]}` : 'the more specific source wins',
    })
  }
  const equalTierDisagree = pool.some(other => other !== best && other.tier === best.tier && other.tier <= 5 && !consistent(best, other) && family(other.action) === family(best.action))
  const supporting = pool.filter(other => other !== best && consistent(best, other) && family(other.action) === family(best.action))
  let appliesHere: boolean | null = null
  if (installedVersion && best.version) {
    const cmp = compareVersions(installedVersion, best.version)
    appliesHere = best.action === 'ADDED' ? cmp < 0 : cmp >= 0
  }
  const outcome = equalTierDisagree ? 'UNRESOLVED' : conflicts.length ? 'CONFLICT_RESOLVED' : supporting.length ? 'CONFIRMED' : 'SINGLE_SOURCE'
  return { best, supporting, conflicts, outcome, appliesHere }
}

export type Verdict = 'STOP_ANSWERED' | 'CONTINUE_CONFLICT' | 'CONTINUE_UNANSWERED' | 'STOP_BUDGET' | 'STOP_INCONCLUSIVE'

/**
 * When to stop researching. Answered means an authoritative source states what happened to the name; a second authoritative source is only needed when
 * the sources disagree or the answer has no version to check against the installed one.
 */
export function researchVerdict(state: { waves: number; findings: readonly SourcedClaim[]; consulted: readonly unknown[]; fetchesThisMission: number }, resolution: Resolution): Verdict {
  const budgetLeft = state.waves < TOOL_LIMITS.waves && state.consulted.length < TOOL_LIMITS.fetchesPerQuestion && state.fetchesThisMission < TOOL_LIMITS.fetchesPerMission
  if (resolution.outcome === 'UNRESOLVED') return budgetLeft ? 'CONTINUE_CONFLICT' : 'STOP_INCONCLUSIVE'
  const best = resolution.best
  if (best && best.tier <= 5) {
    if (best.version === null && budgetLeft && resolution.supporting.length === 0) return 'CONTINUE_UNANSWERED'
    return 'STOP_ANSWERED'
  }
  if (best) return budgetLeft ? 'CONTINUE_UNANSWERED' : 'STOP_INCONCLUSIVE'
  return budgetLeft ? 'CONTINUE_UNANSWERED' : 'STOP_BUDGET'
}

export function implicationOf(question: ResearchQuestion, resolution: Resolution, _installedVersion: string | null): string | null {
  const best = resolution.best
  if (!best) return null
  const where = question.installedLabel
  if (resolution.appliesHere === false) return `${describeClaim(best).replace(/^./, c => c.toUpperCase())}, which does not affect the ${where} installed here, so the cause is somewhere else.`
  const use = best.replacement ? (best.action === 'MOVED' ? ` Import it from ${best.replacement} instead.` : ` Use ${best.replacement} instead.`) : ''
  const sentence = `${describeClaim(best)}, and ${where} is installed here.${use}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

// ---------------------------------------------------------------- the next tool

export type NextTool =
  | { tool: 'TERMINAL'; probe: 'VERSION'; why: string; say: string }
  | { tool: 'TERMINAL'; probe: 'CALL_TRACE'; why: string; say: string }
  | { tool: 'TERMINAL'; probe: 'PACKAGE'; name: string; why: string; say: string }
  | { tool: 'TERMINAL'; probe: 'SIGNATURE'; root: string; symbol: string; why: string; say: string }
  | { tool: 'WEB'; question: ResearchQuestion; why: string; say: string }
  | { tool: 'PROJECT_SEARCH'; why: string; say: string }
  | { tool: 'NONE'; why: string; say: string | null; reason: 'LOCAL_SUFFICIENT' | 'RETURN_TO_CODING' | 'BUDGET' | 'REPEAT' | 'UNSUPPORTED' }

export function findQuestion(state: ToolingState, key: string): QuestionState | undefined {
  return state.questions.find(item => item.key === key)
}

/**
 * The next tool given everything learned so far. Called again after every result, so the sequence follows the evidence instead of a fixed order:
 * an unfamiliar library failure needs the installed version first, then its official notes, then coding; a local failure needs neither.
 */
export function chooseNextTool(input: { analysis: FailureAnalysis; state: ToolingState; codeGeneration: number; commandsLeft: number; codeFilesInPlay: number }): NextTool {
  const { analysis, state } = input
  const ext = analysis.external
  if (analysis.kind === 'EXTERNAL_API' && ext) {
    // A library that rejects an argument is answered by the installed callable itself: ask it locally first, and only read the web when that cannot settle it.
    const local = localSignatureStep(analysis, state, input.commandsLeft)
    if (local) return local
    const info = state.installed[ext.root] ?? null
    if (!info) {
      if (state.probed.includes(`version:${ext.root}`) || input.commandsLeft <= 0) return { tool: 'NONE', reason: 'BUDGET', why: 'The installed version could not be checked.', say: null }
      return { tool: 'TERMINAL', probe: 'VERSION', why: `the docs differ by version of ${ext.root}`, say: `The failure comes from the installed ${ext.root} package, so I'm checking which version is installed before I read its docs.` }
    }
    const question = questionFor(analysis, info)
    if (!question) return { tool: 'NONE', reason: 'UNSUPPORTED', why: 'The failure could not be turned into a safe question.', say: null }
    const known = findQuestion(state, question.key)
    if (known && known.status !== 'OPEN') return { tool: 'NONE', reason: 'RETURN_TO_CODING', why: 'The question is already answered.', say: null }
    if (state.questions.length >= TOOL_LIMITS.questionsPerMission && !known) return { tool: 'NONE', reason: 'BUDGET', why: 'Enough questions were researched for one mission.', say: null }
    if (state.fetches >= TOOL_LIMITS.fetchesPerMission) return { tool: 'NONE', reason: 'BUDGET', why: 'The research budget is used up.', say: null }
    return {
      tool: 'WEB', question,
      why: `the failure depends on how ${ext.root} behaves in the installed version, and the project doesn't say`,
      say: `The failure looks version-specific, so I'm checking the current ${ext.root} docs and release notes before changing the code.`,
    }
  }
  if ((analysis.kind === 'LOCAL_RUNTIME' || analysis.kind === 'LOCAL_VALUE') && analysis.testId && !analysis.importFailure) {
    // A value mismatch that passes through several project files needs the values seen; one that lives in one file is answered by the source and the test.
    const worthTracing = analysis.kind === 'LOCAL_RUNTIME' || input.codeFilesInPlay >= 2
    const traceKey = `${analysis.key}@${input.codeGeneration}`
    if (worthTracing && !state.traced.includes(traceKey) && state.traced.length < TOOL_LIMITS.traces && input.commandsLeft > 0) {
      return {
        tool: 'TERMINAL', probe: 'CALL_TRACE',
        why: analysis.kind === 'LOCAL_RUNTIME' ? 'the error depends on values the source alone does not show' : 'the answer depends on what the functions actually return',
        say: analysis.kind === 'LOCAL_RUNTIME'
          ? "The error depends on the data the code is handling, so I'm running the failing test under a trace to see the actual values."
          : "The failing test compares values that several functions produce, so I'm running it under a trace to see what each one returned.",
      }
    }
  }
  if (analysis.kind === 'LOCAL_SYMBOL') return { tool: 'PROJECT_SEARCH', why: 'the failing run names something inside the project', say: "The failing run names something in the project, so I'm following it into the code." }
  if (analysis.kind === 'MISSING_PACKAGE' && analysis.missing && IDENT.test(analysis.missing) && !state.probed.includes(`package:${analysis.missing}`) && input.commandsLeft > 0) {
    return { tool: 'TERMINAL', probe: 'PACKAGE', name: analysis.missing, why: `the import ${analysis.missing} failed and the installed name may differ`, say: `The import of ${analysis.missing} failed, so I'm checking what the installed package is actually called before changing anything.` }
  }
  if (analysis.kind === 'EXTERNAL_API' || analysis.kind === 'MISSING_PACKAGE') return { tool: 'NONE', reason: 'UNSUPPORTED', why: 'Nothing more can be checked safely.', say: null }
  return { tool: 'NONE', reason: 'LOCAL_SUFFICIENT', why: 'The local tests and source already answer this.', say: state.localSaid ? null : "The local tests already answer this, so I don't need the web here." }
}

/**
 * "unexpected keyword argument X": the installed function's own signature says whether X is accepted. A stable, local, version-exact fact, so no web read
 * is needed when it settles the question (the argument is not among the accepted ones). Anything it cannot settle continues to the docs as before.
 */
function localSignatureStep(analysis: FailureAnalysis, state: ToolingState, commandsLeft: number): NextTool | null {
  const ext = analysis.external
  if (!ext || !ext.symbol || !ext.argument || !IDENT.test(ext.root) || !IDENT.test(ext.symbol) || !IDENT.test(ext.argument)) return null
  if (!/unexpected keyword argument|got an unexpected/i.test(analysis.message)) return null
  const key = `${ext.root}.${ext.symbol}`
  const known = state.signatures[key]
  if (known) {
    if (known.signature && !known.params.includes(ext.argument)) {
      return { tool: 'NONE', reason: 'LOCAL_SUFFICIENT', why: 'The installed signature already answers this.', say: state.localSaid ? null : `The installed ${ext.root}.${ext.symbol} shows what it accepts, so I don't need the web here.` }
    }
    return null
  }
  if (state.probed.includes(`signature:${key}`) || commandsLeft <= 0) return null
  return {
    tool: 'TERMINAL', probe: 'SIGNATURE', root: ext.root, symbol: ext.symbol,
    why: `the installed ${ext.root} can say what ${ext.symbol} accepts`,
    say: `The library rejected an argument, so I'm asking the installed ${ext.root} what ${ext.symbol} accepts before looking anything up.`,
  }
}

export const SIGNATURE_PROBE_SCRIPT = [
  'import sys, json, importlib, inspect',
  'root, symbol = sys.argv[1], sys.argv[2]',
  'out = {"root": root, "symbol": symbol, "signature": None, "params": []}',
  'try:',
  '    obj = getattr(importlib.import_module(root), symbol)',
  '    sig = inspect.signature(obj)',
  '    out["signature"] = str(sig)[:200]',
  '    out["params"] = [p.name for p in sig.parameters.values()][:24]',
  'except Exception:',
  '    pass',
  'print("SIGNATURE_JSON " + json.dumps(out))',
].join('\n')

export function parseSignature(stdout: string): { signature: string | null; params: string[] } | null {
  const line = stdout.split('\n').find(row => row.startsWith('SIGNATURE_JSON '))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice('SIGNATURE_JSON '.length)) as { signature?: string | null; params?: string[] }
    return { signature: typeof value.signature === 'string' ? value.signature.slice(0, 200) : null, params: (value.params ?? []).filter(item => typeof item === 'string' && IDENT.test(item)).slice(0, 24) }
  } catch { return null }
}

// ---------------------------------------------------------------- receipts

export type SearchView = {
  terms: string[]
  entries: { path: string; role: string; reasons: string[] }[]
  expansions: { file: string; reason: string }[]
  totalFiles: number
}

/** Receipts for what the context engine did (discovery, following a failing run into more code), derived from its record: no second copy of the work. */
export function searchReceipts(view: SearchView, state: ToolingState, at: string, stage: 'start' | 'failure'): ToolReceipt[] {
  const out: ToolReceipt[] = []
  const terms = view.terms.filter(term => IDENT.test(term)).slice(0, 6)
  if (!state.searched.discovered && view.entries.length) {
    const code = view.entries.filter(entry => entry.role !== 'test')
    const tests = view.entries.filter(entry => entry.role === 'test')
    const linked = view.entries.find(entry => entry.role === 'dependency' || entry.role === 'consumer')
    out.push(makeReceipt({
      tool: 'PROJECT_SEARCH', at, stage, question: null,
      why: 'no files were named, so I looked for the code the request is about',
      ran: `searched the project for ${terms.join(', ') || 'the request words'}`, sent: [],
      found: `${view.entries.length} of ${view.totalFiles} files matter: ${code.slice(0, 3).map(entry => entry.path).join(', ')}${tests.length ? `; covered by ${tests.slice(0, 2).map(entry => entry.path).join(', ')}` : ''}${linked ? `; ${linked.path} is ${linked.role === 'dependency' ? 'used by' : 'a caller of'} them` : ''}`,
      changedPlan: true, next: 'read those files and run the tests; widen only if a failing run points elsewhere',
    }, { ...state, receipts: [...state.receipts, ...out] }))
    state.searched.discovered = true
  }
  const fresh = view.expansions.slice(state.searched.expansions)
  if (fresh.length) {
    out.push(makeReceipt({
      tool: 'PROJECT_SEARCH', at, stage, question: null,
      why: 'the failing run pointed at code the working set did not hold',
      ran: `followed the failing run into ${fresh.slice(0, 3).map(item => item.file).join(', ')}`, sent: [],
      found: fresh.slice(0, 3).map(item => `${item.file}: ${item.reason}`).join('; '),
      changedPlan: true, next: 'give the change those files as well',
    }, { ...state, receipts: [...state.receipts, ...out] }))
    state.searched.expansions = view.expansions.length
  }
  return out
}

export function makeReceipt(input: Omit<ToolReceipt, 'id'>, state: ToolingState): ToolReceipt {
  return { id: `tool-${state.receipts.length + 1}`, ...input, why: input.why.slice(0, 200), found: input.found.slice(0, 320), next: input.next.slice(0, 200), ran: input.ran.slice(0, 200) }
}

export function pushReceipt(state: ToolingState, receipt: ToolReceipt): void {
  state.receipts = [...state.receipts, receipt].slice(-TOOL_LIMITS.receipts)
}

/** The same tool call on the same evidence is never repeated. */
export function isRepeat(state: ToolingState, tool: ToolKind, ran: string): boolean {
  return state.receipts.some(receipt => receipt.tool === tool && receipt.ran === ran)
}

// ---------------------------------------------------------------- call-trace probe (a fixed script; nothing from the project or a model is ever placed inside it)

export const CALL_TRACE_SCRIPT = [
  'import sys, os, json, unittest',
  'root = os.getcwd(); sys.path.insert(0, root); sys.path.insert(0, os.path.join(root, "tests"))',
  'target = sys.argv[1]',
  'calls = []',
  'SKIP = ("password", "passwd", "secret", "token", "api_key", "apikey", "credential", "auth")',
  'def short(v):',
  '    try: r = repr(v)',
  '    except Exception: r = "<unprintable>"',
  '    return r if len(r) <= 90 else r[:87] + "..."',
  'def profile(frame, event, arg):',
  '    if event != "return" or len(calls) >= 400: return',
  '    fn = frame.f_code.co_filename',
  '    if not fn.startswith(root) or "site-packages" in fn or "dist-packages" in fn: return',
  '    rel = os.path.relpath(fn, root)',
  '    if rel.startswith("tests" + os.sep) or rel.startswith("test_") or os.sep + "tests" + os.sep in rel: return',
  '    code = frame.f_code',
  '    names = code.co_varnames[:code.co_argcount]',
  '    args = ", ".join(n + "=" + ("<hidden>" if any(s in n.lower() for s in SKIP) else short(frame.f_locals.get(n))) for n in names[:4])',
  '    calls.append({"at": rel.replace(os.sep, "/") + ":" + code.co_name, "args": args, "returned": short(arg)})',
  'out = {"calls": [], "failure": None}',
  'suite = unittest.defaultTestLoader.loadTestsFromName(target)',
  'sys.setprofile(profile)',
  'try:',
  '    suite.debug()',
  'except BaseException as error:',
  '    sys.setprofile(None)',
  '    tb = error.__traceback__',
  '    frames = []',
  '    while tb is not None:',
  '        frames.append(tb); tb = tb.tb_next',
  '    picked = []',
  '    for t in frames:',
  '        fn = t.tb_frame.f_code.co_filename',
  '        if fn.startswith(root) and "site-packages" not in fn:',
  '            picked.append(t)',
  '    where = picked[-1] if picked else None',
  '    local = {}',
  '    if where is not None:',
  '        for k, v in list(where.tb_frame.f_locals.items())[:8]:',
  '            if k.startswith("__") or callable(v) or type(v).__name__ == "module": continue',
  '            local[k] = "<hidden>" if any(s in k.lower() for s in SKIP) else short(v)',
  '    out["failure"] = {"type": type(error).__name__, "message": (str(error).strip().splitlines() or [""])[0][:160], "at": (os.path.relpath(where.tb_frame.f_code.co_filename, root).replace(os.sep, "/") + ":" + where.tb_frame.f_code.co_name + ":" + str(where.tb_lineno)) if where else None, "locals": local}',
  'finally:',
  '    sys.setprofile(None)',
  'out["calls"] = calls[:60]',
  'print("TRACE_JSON " + json.dumps(out))',
].join('\n')

export const VERSION_PROBE_SCRIPT = [
  'import sys, json',
  'import importlib.metadata as m',
  'root = sys.argv[1]',
  'out = {"python": ".".join(str(p) for p in sys.version_info[:3]), "stdlib": root in sys.stdlib_module_names, "dist": None, "version": None, "urls": []}',
  'try:',
  '    names = m.packages_distributions().get(root) or [root, root.replace("_", "-")]',
  '    for name in names:',
  '        try:',
  '            md = m.metadata(name)',
  '            out["dist"] = md["Name"]; out["version"] = m.version(name)',
  '            for entry in md.get_all("Project-URL") or []:',
  '                label, _, url = entry.partition(",")',
  '                out["urls"].append({"label": label.strip(), "url": url.strip()})',
  '            if md.get("Home-page"): out["urls"].append({"label": "Homepage", "url": md.get("Home-page")})',
  '            break',
  '        except Exception:',
  '            continue',
  'except Exception:',
  '    pass',
  'print("VERSION_JSON " + json.dumps(out))',
].join('\n')

export const PACKAGE_PROBE_SCRIPT = [
  'import sys, json',
  'import importlib.metadata as m',
  'name = sys.argv[1]',
  'out = {"name": name, "installed": False, "modules": [], "version": None}',
  'try:',
  '    dist = m.distribution(name)',
  '    out["installed"] = True; out["version"] = dist.version; out["name"] = dist.metadata["Name"]',
  '    top = dist.read_text("top_level.txt")',
  '    mods = [t.strip() for t in top.split() if t.strip()] if top else []',
  '    if not mods:',
  '        for mod, dists in m.packages_distributions().items():',
  '            if dist.metadata["Name"] in dists: mods.append(mod)',
  '    out["modules"] = mods[:4]',
  'except Exception:',
  '    pass',
  'print("PACKAGE_JSON " + json.dumps(out))',
].join('\n')

export function parsePackage(stdout: string): { name: string; installed: boolean; version: string | null; modules: string[] } | null {
  const line = stdout.split('\n').find(row => row.startsWith('PACKAGE_JSON '))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice('PACKAGE_JSON '.length)) as { name?: string; installed?: boolean; version?: string | null; modules?: string[] }
    if (typeof value.name !== 'string') return null
    return { name: value.name, installed: value.installed === true, version: typeof value.version === 'string' ? value.version : null, modules: (value.modules ?? []).filter(item => typeof item === 'string' && IDENT.test(item)).slice(0, 4) }
  } catch { return null }
}

/** A replacement named as a package ("MarkupSafe") rather than a dotted name is looked up: the code needs the name it is imported as. */
export function replacementPackage(replacement: string | null, root: string): string | null {
  if (!replacement || !/^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(replacement)) return null
  return replacement.toLowerCase() === root.toLowerCase() ? null : replacement
}

export type TraceResult = {
  calls: { at: string; args: string; returned: string }[]
  failure: { type: string; message: string; at: string | null; locals: Record<string, string> } | null
}

export function parseTrace(stdout: string): TraceResult | null {
  const line = stdout.split('\n').find(row => row.startsWith('TRACE_JSON '))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice('TRACE_JSON '.length)) as TraceResult
    if (!value || !Array.isArray(value.calls)) return null
    return { calls: value.calls.filter(call => call && typeof call.at === 'string').slice(0, 60), failure: value.failure ?? null }
  } catch { return null }
}

export function parseInstalled(root: string, stdout: string): InstalledInfo | null {
  const line = stdout.split('\n').find(row => row.startsWith('VERSION_JSON '))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice('VERSION_JSON '.length)) as { python?: string; stdlib?: boolean; dist?: string | null; version?: string | null; urls?: { label: string; url: string }[] }
    if (typeof value.python !== 'string') return null
    return {
      root, python: value.python, stdlib: value.stdlib === true, dist: typeof value.dist === 'string' ? value.dist : null, version: typeof value.version === 'string' ? value.version : null,
      urls: (value.urls ?? []).filter(link => link && typeof link.url === 'string' && /^https:\/\//.test(link.url)).slice(0, 12).map(link => ({ label: String(link.label).slice(0, 40), url: link.url })),
    }
  } catch { return null }
}

/**
 * Shows project paths the way the project itself would: the folder the mission runs in (and the same folder spelled through a link) is dropped, so
 * `/home/me/shop/app/x.py` reads `app/x.py` and the folder itself reads `.`. A sibling that merely shares the prefix (`/home/me/shop2`) is left alone.
 */
export function relativizeProjectPaths(text: string, roots: readonly string[]): string {
  let out = text
  for (const root of [...new Set(roots.map(item => item.replace(/[\\/]+$/, '')).filter(item => item.length > 1))].sort((a, b) => b.length - a.length)) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`${escaped}[\\\\/]+(?=[^\\s'"])`, 'g'), '').replace(new RegExp(`${escaped}(?![\\w.-])`, 'g'), '.')
  }
  return out
}

/** The trace as short plain lines for whoever edits: what each project function returned, then where the failure happened and the values in scope. */
export function traceNotes(trace: TraceResult, roots: readonly string[] = []): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const call of trace.calls) {
    const line = `${call.at}(${call.args}) returned ${call.returned}`
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  const shown = lines.length > TOOL_LIMITS.traceEntries ? [...lines.slice(0, TOOL_LIMITS.traceEntries - 4), ...lines.slice(-4)] : lines
  const out: string[] = []
  if (trace.failure) {
    const locals = Object.entries(trace.failure.locals).map(([name, value]) => `${name}=${value}`).join(', ')
    out.push(`It failed with ${trace.failure.type}: ${trace.failure.message}${trace.failure.at ? ` at ${trace.failure.at}` : ''}${locals ? `; values in scope there: ${locals}` : ''}`)
  }
  out.push(...shown)
  return out.map(line => redactSecrets(relativizeProjectPaths(line, roots))).join('\n').slice(0, TOOL_LIMITS.traceChars).split('\n')
}

/** Files the trace shows were actually executed: runtime truth for growing the working set. */
export function traceFiles(trace: TraceResult): string[] {
  const files = new Set<string>()
  if (trace.failure?.at) files.add(trace.failure.at.split(':')[0])
  for (const call of trace.calls) files.add(call.at.split(':')[0])
  return [...files].filter(file => !isSecretFile(file)).slice(0, 8)
}

// ---------------------------------------------------------------- what the specialist is told

/**
 * The finding says a name moved to another package, and the failing run shows the exact import line that broke: the change is mechanical, so it is stated
 * outright (this line becomes that line, nothing else changes) instead of leaving a small model to rewrite the code around it. Nothing here names a library:
 * the old package, the name and the new module all come from the failing output, the finding and the installed-package probe.
 */
export function migrationHint(input: { raw: string; root: string; symbol: string | null; action: string; replacement: string | null; importNames: ToolingState['importNames'] }): string {
  if (!input.symbol || !IDENT.test(input.symbol) || !IDENT.test(input.root) || !input.replacement) return ''
  if (input.action !== 'MOVED' && input.action !== 'RENAMED') return ''
  const module = input.importNames[input.replacement]?.modules[0]
  if (!module || !IDENT.test(module)) return ''
  const pattern = new RegExp(`^[ \\t]*from[ \\t]+${input.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.\\w+)*[ \\t]+import[ \\t]+([^\\n#]*\\b${input.symbol}\\b[^\\n#]*)$`, 'm')
  const hit = pattern.exec(input.raw.replace(ANSI, ''))
  if (!hit) return ''
  const line = hit[0].trim()
  const names = hit[1].replace(/[()]/g, '').split(',').map(item => item.trim()).filter(Boolean)
  const others = names.filter(item => item !== input.symbol)
  const moved = `from ${module} import ${input.symbol}`
  const replacement = others.length ? `from ${input.root} import ${others.join(', ')}\\n${moved}` : moved
  return `THE EXACT CHANGE: replace the line \`${line}\` with ${others.length ? 'these two lines' : 'the line'} \`${replacement.replace(/\\n/g, ' / ')}\` and change nothing else; every other line, including how ${input.symbol} is used, stays exactly as it is.`
}

const HINT_SENTENCE = /THE EXACT CHANGE: replace the line `([^`\n]+)` with [^\n]*?stays exactly as it is\./

/**
 * The exact-change hint is true only while the line it names still exists. Once the change has been made (or the line is gone for any other reason) the
 * sentence is replaced by a plain statement that it was done, so a later attempt is never told to replace text that is no longer there.
 * With no file shown there is nothing to check against, so the hint stays.
 */
export function dropStaleHints(notes: readonly string[], shownTexts: readonly string[]): string[] {
  if (!shownTexts.length) return [...notes]
  return notes.map(note => {
    const hit = HINT_SENTENCE.exec(note)
    if (!hit) return note
    const line = hit[1].trim()
    const present = shownTexts.some(text => text.split(/\r?\n/).some(row => row.trim() === line))
    return present ? note : note.replace(HINT_SENTENCE, 'That import line has already been changed; do not change it again.')
  })
}

/** A remembered answer that is still valid is used as it is; the reason it is trusted (same installed version, checked recently, primary source) is what made it eligible. */
export type RememberedFinding = { url: string; claim: string; finding?: { action: string; version: string | null; replacement: string | null; tier: number; checkedAt: string } }

export function researchNote(question: QuestionState, importNames: ToolingState['importNames'] = {}, failingOutput = ''): string | null {
  if (question.status !== 'ANSWERED' || !question.implication) return null
  const best = question.findings[0]
  const source = best ? `${TIER_NAMES[best.tier]}, ${best.url}` : 'the official sources'
  const conflict = question.conflicts[0] ? ` A less reliable source said ${question.conflicts[0].loser.claim}; it is wrong for this version.` : ''
  const quote = best ? ` It says: "${best.quote.slice(0, 200)}"` : ''
  const replacement = best?.replacement ? importNames[best.replacement] : undefined
  const importName = replacement?.modules[0] ? ` The installed ${best!.replacement} package is imported as \`${replacement.modules[0]}\`.` : ''
  const safer = secureHintFor(question.root, question.symbol)
  const exact = best ? migrationHint({ raw: failingOutput, root: question.root, symbol: question.symbol, action: best.action, replacement: best.replacement, importNames }) : ''
  const lead = question.fromMemory ? `From earlier in this project (${question.root}), checked ${question.fromMemory.checkedAt.slice(0, 10)} in ${source} for this same installed version` : `Checked just now (${question.root}) in ${source}`
  return `${lead}: ${question.implication}${importName}${quote}${conflict}${safer ? ` ${safer}` : ''}${exact ? ` ${exact}` : ''} Change the code that uses it; do not add a workaround.`.slice(0, TOOL_LIMITS.noteChars + 640)
}

/**
 * Adds a research note for what the editor is told. Only an earlier note about the SAME library is replaced (a re-check of the same question); notes
 * about other questions stay, so a second answer never erases the first one while the mission is still working on both.
 */
export function mergeResearchNote(notes: readonly string[], note: string, root: string, limit: number): string[] {
  return [...notes.filter(item => !item.startsWith(`Checked just now (${root}) `) && !item.startsWith(`From earlier in this project (${root}), `)), note].slice(-limit)
}

// ---------------------------------------------------------------- human language (main thread: no enums, counters or scores)

export const say = {
  version: (root: string) => `The failure comes from the installed ${root} package, so I'm checking which version is installed before I read its docs.`,
  checking: (root: string) => `The failure looks version-specific, so I'm checking the current ${root} docs and release notes before changing the code.`,
  reused: (root: string) => `I already looked into this ${root} question in this project for the same installed version and the answer is still current, so I'm using it instead of reading the docs again.`,
  recheck: (root: string) => `I looked into this ${root} question before, so I'm confirming the answer against the same source instead of trusting my notes.`,
  answered: (question: QuestionState) => {
    const best = question.findings[0]
    if (!best) return `I couldn't settle the ${question.root} question from the sources I could reach, so I'm going on the local evidence.`
    const replacement = best.replacement && best.action !== 'MOVED' ? `; the replacement is ${best.replacement}` : best.replacement ? `; it now comes from ${best.replacement}` : ''
    return `${question.fromMemory ? 'From my earlier research in this project, the' : 'The'} ${TIER_NAMES[best.tier]} say ${describeClaim(best)}${replacement}. I'm updating the code that uses it and running the linked tests.`
  },
  conflict: (note: ConflictNote) => `The ${TIER_NAMES[note.loser.tier]} say ${note.loser.claim}, but the ${TIER_NAMES[note.winner.tier]} say ${note.winner.claim}, so I'm going with the official source and updating the code to match.`,
  inconclusive: (root: string) => `I couldn't settle the ${root} question from the sources I could reach, so I'm going on the local evidence.`,
  unavailable: () => "That source wasn't reachable, so I'm trying the project's own repository instead.",
  traced: (found: string) => `The trace showed ${found}, so I'm pointing the change there.`,
  traceUnavailable: () => "The trace couldn't run, so I'm rerunning just the failing test to see it in full.",
  local: () => "The local tests already answer this, so I don't need the web here.",
  backToCode: () => "That's enough research for this question, so I'm going back to the code.",
}

/** True when a Commander-facing sentence carries an internal token instead of words. */
export function looksInternal(text: string): boolean {
  return /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\btier\s?\d|\bscore\b|\bbudget\s?=|=\d|TOOL_|RESEARCH_/.test(text)
}

export function describeReceipt(receipt: ToolReceipt): string {
  return [`${receipt.tool} [${receipt.stage}]`, `why: ${receipt.why}`, receipt.question ? `question: ${receipt.question}` : null, `ran: ${receipt.ran}`, receipt.sent.length ? `sent: ${receipt.sent.join(', ')}` : 'sent: nothing left the machine', `found: ${receipt.found}`, `changed the plan: ${receipt.changedPlan ? 'yes' : 'no'}`, `next: ${receipt.next}`, receipt.urls?.length ? `sources: ${receipt.urls.join(' ')}` : null].filter(Boolean).join(' | ')
}
