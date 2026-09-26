/**
 * Filesystem side of Phase 3 context: reads a project's source files for the (pure) context engine. Bounded, and it never reads a secret file:
 * a real `.env`, keys, credentials and the like are skipped by name before any read, so their values cannot reach an index, a prompt or a record.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { CONTEXT_LIMITS, buildIndex, contentHash, discoverContext, isSecretFile, languageOf, type SourceFile } from './foundryProjectContext'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.war-room', '__pycache__', 'dist', 'build', '.next', '.venv', 'venv', 'env', '.mypy_cache', '.pytest_cache', '.idea', '.vscode', 'coverage', 'archive'])
const MAX_TOTAL_BYTES = 4_000_000

export async function readProjectSources(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  let total = 0
  async function walk(abs: string, rel: string): Promise<void> {
    if (out.length >= CONTEXT_LIMITS.maxIndexedFiles || total >= MAX_TOTAL_BYTES) return
    let entries
    try { entries = await readdir(abs, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= CONTEXT_LIMITS.maxIndexedFiles || total >= MAX_TOTAL_BYTES) return
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(path.join(abs, entry.name), childRel)
        continue
      }
      if (!entry.isFile() || isSecretFile(childRel) || languageOf(childRel) === 'other') continue
      try {
        const info = await stat(path.join(abs, entry.name))
        if (info.size > CONTEXT_LIMITS.maxFileBytes) continue
        const content = await readFile(path.join(abs, entry.name), 'utf8')
        total += content.length
        out.push({ path: childRel, content })
      } catch { /* unreadable: not part of the context */ }
    }
  }
  await walk(root, '')
  return out
}

/** Content of one project file straight from disk (never a cache); null when it is missing, secret, oversized or outside the root. */
export async function readProjectFile(root: string, rel: string): Promise<string | null> {
  const clean = rel.replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || clean.split('/').includes('..') || isSecretFile(clean)) return null
  try {
    const abs = path.join(root, clean)
    const info = await stat(abs)
    if (!info.isFile() || info.size > CONTEXT_LIMITS.maxFileBytes) return null
    return await readFile(abs, 'utf8')
  } catch {
    return null
  }
}

export async function diskHashes(root: string, files: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const file of files) {
    const text = await readProjectFile(root, file)
    out[file] = text === null ? null : contentHash(text)
  }
  return out
}

const REPAIR_REQUEST = /\b(fix|repair|debug|failing|bug|broken|crash)\b/i
const FILTER_SHAPED = /\bfilter/i
const QUESTION = /\?\s*$|^\s*(what|why|how|when|where|who|explain|describe|tell me|is there|does|do you)\b/i

/**
 * A request the context-driven campaign should own: an instruction to change behavior (not a repair, not a filter fixture, not a question) that names
 * no files, on a project with unit tests it can run, where discovery from the request alone confidently finds the code and a test that covers it.
 */
export async function contextShouldOwn(root: string, request: string): Promise<boolean> {
  if (REPAIR_REQUEST.test(request) || FILTER_SHAPED.test(request) || QUESTION.test(request)) return false
  try {
    const names = await readdir(path.join(root, 'tests'))
    if (!names.some(name => /^test_.*\.py$/.test(name))) return false
    const files = await readProjectSources(root)
    if (files.filter(file => file.path.endsWith('.py') && !/(^|\/)tests?\//.test(file.path) && !file.path.endsWith('__init__.py')).length < 2) return false
    return discoverContext(buildIndex(files), request, '').confidence === 'high'
  } catch {
    return false
  }
}

/** True when the request is the Phase 2 filter fixture shape (kept on its own prompts and heuristics). */
export function isFilterShaped(request: string): boolean {
  return FILTER_SHAPED.test(request)
}
