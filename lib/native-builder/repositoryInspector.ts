/**
 * Safe, read-only repository inspection. Reuses lib/repo/paths.ts for the server-configured root
 * (never client-overridable) and follows the same execFile/no-shell pattern already proven in
 * lib/repo/status.ts and lib/repo/diff.ts. This module is the ONLY place in native-builder that
 * touches the filesystem for reads outside of the rollback snapshot store.
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getRepoStatus } from '@/lib/repo/status'
import { previewDiff } from '@/lib/repo/diff'
import type { RepoStatus } from '@/lib/repo/types'

/** Directories never walked, regardless of depth. */
const DENYLISTED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.war-room', '.turbo', 'dist', 'build', 'coverage'])

/** File name patterns that are never readable, even inside the repo root. */
const DENYLISTED_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /credentials/i,
  /secret/i,
]

const MAX_SEARCH_FILES = 4000
const MAX_FILE_READ_BYTES = 512 * 1024
const MAX_SEARCH_RESULTS = 200

export class RepoAccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoAccessDeniedError'
  }
}

/** Resolves a repo-relative path to an absolute path, rejecting anything that escapes the repo
 * root, targets a denylisted directory, or matches a denylisted file-name pattern. This is the
 * single containment choke point every read/search function below routes through. */
export function resolveRepoRelativePath(relPath: string): string {
  const root = path.resolve(resolveRepoRoot())
  const trimmed = relPath.trim().replace(/^[/\\]+/, '')
  if (!trimmed) throw new RepoAccessDeniedError('Empty path.')
  const abs = path.resolve(root, trimmed)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RepoAccessDeniedError(`Path escapes repository root: ${relPath}`)
  }
  const segments = rel.split(path.sep)
  if (segments.some(seg => DENYLISTED_DIR_NAMES.has(seg))) {
    throw new RepoAccessDeniedError(`Path targets a denylisted directory: ${relPath}`)
  }
  const fileName = segments.at(-1) ?? ''
  if (DENYLISTED_FILE_PATTERNS.some(pattern => pattern.test(fileName))) {
    throw new RepoAccessDeniedError(`Path targets a denylisted file: ${relPath}`)
  }
  return abs
}

export async function assertCanonicalRepoPath(absPath: string, allowMissingLeaf = false): Promise<void> {
  const root = await realpath(resolveRepoRoot())
  let canonical: string
  try {
    canonical = await realpath(absPath)
  } catch (error) {
    if (!allowMissingLeaf) throw error
    canonical = path.join(await realpath(path.dirname(absPath)), path.basename(absPath))
  }
  const rel = path.relative(root, canonical)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RepoAccessDeniedError('Path resolves through a symlink outside the workspace.')
  }
}

export type RepoFileReadResult =
  | { ok: true; relPath: string; content: string; sizeBytes: number }
  | { ok: false; relPath: string; error: string }

/** Real file read within the repo root only. Never reads .env*, secrets, node_modules, .git
 * internals, or anything outside the configured root — resolveRepoRelativePath enforces this. */
export async function readRepoFile(relPath: string): Promise<RepoFileReadResult> {
  try {
    const abs = resolveRepoRelativePath(relPath)
    await assertCanonicalRepoPath(abs)
    const info = await stat(abs)
    if (!info.isFile()) return { ok: false, relPath, error: 'Not a regular file.' }
    if (info.size > MAX_FILE_READ_BYTES) {
      return { ok: false, relPath, error: `File too large (${info.size} bytes, cap ${MAX_FILE_READ_BYTES}).` }
    }
    const content = await readFile(abs, 'utf8')
    return { ok: true, relPath, content, sizeBytes: info.size }
  } catch (error) {
    if (error instanceof RepoAccessDeniedError) return { ok: false, relPath, error: error.message }
    return { ok: false, relPath, error: error instanceof Error ? error.message : String(error) }
  }
}

export type RepoSearchHit = { relPath: string; lineNumber: number; line: string }

async function walkFiles(dir: string, root: string, out: string[], budget: { remaining: number }): Promise<void> {
  if (budget.remaining <= 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.remaining <= 0) return
    if (DENYLISTED_DIR_NAMES.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(abs, root, out, budget)
      continue
    }
    if (!entry.isFile()) continue
    if (DENYLISTED_FILE_PATTERNS.some(pattern => pattern.test(entry.name))) continue
    if (!/\.(ts|tsx|js|jsx|mjs|json|md)$/i.test(entry.name)) continue
    out.push(abs)
    budget.remaining -= 1
  }
}

/** Bounded, dependency-free text search under the repo root (no ripgrep dependency — plain Node
 * fs walk, capped by file count and result count so a broad query can't become a resource hog). */
export async function searchRepoText(query: string, opts?: { pathPrefix?: string }): Promise<RepoSearchHit[]> {
  const root = path.resolve(resolveRepoRoot())
  const startDir = opts?.pathPrefix ? resolveRepoRelativePath(opts.pathPrefix) : root
  await assertCanonicalRepoPath(startDir)
  const files: string[] = []
  await walkFiles(startDir, root, files, { remaining: MAX_SEARCH_FILES })

  const needle = query.trim()
  if (!needle) return []
  const hits: RepoSearchHit[] = []
  for (const abs of files) {
    if (hits.length >= MAX_SEARCH_RESULTS) break
    let content: string
    try {
      content = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    const relPath = path.relative(root, abs).split(path.sep).join('/')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(needle)) {
        hits.push({ relPath, lineNumber: i + 1, line: lines[i].trim().slice(0, 300) })
        if (hits.length >= MAX_SEARCH_RESULTS) break
      }
    }
  }
  return hits
}

/** Approximate caller inspection — a text-search-based grep for a symbol's usages, not a full AST
 * analysis. Honest scope: good enough to find likely call sites for a bounded repair, not a
 * substitute for real type-aware refactor tooling. */
export async function inspectSymbolUsages(symbol: string, opts?: { pathPrefix?: string }): Promise<RepoSearchHit[]> {
  return searchRepoText(symbol, opts)
}

export async function readPackageScripts(): Promise<Record<string, string>> {
  const result = await readRepoFile('package.json')
  if (!result.ok) return {}
  try {
    const parsed = JSON.parse(result.content) as { scripts?: Record<string, string> }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

/** Bounded, denylist-respecting flat file listing under the repo root (or a given path prefix).
 * Reuses the exact same walkFiles primitive searchRepoText/listValidationFiles already use — this
 * is the file-tree data source for a thin client (Standalone Builder / War Room Engineering UI),
 * not a second directory-walking implementation. */
export async function listRepoFiles(pathPrefix?: string): Promise<string[]> {
  const root = path.resolve(resolveRepoRoot())
  const startDir = pathPrefix ? resolveRepoRelativePath(pathPrefix) : root
  await assertCanonicalRepoPath(startDir)
  const out: string[] = []
  await walkFiles(startDir, root, out, { remaining: MAX_SEARCH_FILES })
  return out.map(f => path.relative(root, f).split(path.sep).join('/')).sort()
}

export async function listValidationFiles(): Promise<string[]> {
  const root = path.resolve(resolveRepoRoot())
  const libDir = path.join(root, 'lib')
  const out: string[] = []
  await walkFiles(libDir, root, out, { remaining: MAX_SEARCH_FILES })
  return out
    .filter(f => f.endsWith('.validation.ts'))
    .map(f => path.relative(root, f).split(path.sep).join('/'))
}

export type RepoGitContext = {
  status: RepoStatus
  recentDiff: { diff: string; truncated: boolean }
}

/** Thin wrapper over the already-real, already-safe lib/repo status/diff modules — native-builder
 * does not reimplement git access. */
export async function getRepoGitContext(paths?: string[]): Promise<RepoGitContext> {
  const status = await getRepoStatus()
  const recentDiff = await previewDiff({ paths, maxBytes: 96 * 1024 })
  return { status, recentDiff: { diff: recentDiff.diff, truncated: recentDiff.truncated } }
}
