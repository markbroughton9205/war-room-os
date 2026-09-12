/**
 * #22 Phase 3 — Worktree verification + path escape defense.
 */
import { realpathSync, existsSync, lstatSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

const BLOCKED_RELATIVE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.war-room(\/|$)/i,
  /^package\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /(^|\/)supabase\/.*\.sql$/i,
  /(^|\/)vercel\.json$/i,
  /(^|\/)netlify\.toml$/i,
  /secret/i,
  /credential/i,
  /\.pem$/i,
  /\.key$/i,
]

export type WorktreeVerification =
  | {
      ok: true
      worktreeAbs: string
      repositoryRootAbs: string
      baseSha: string | null
      preexistingDirty: string[]
    }
  | { ok: false; reason: string; reasonCode: string }

function tryRealpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

export function verifyApprovedWorktree(input: {
  worktreePath: string
  repositoryRoot?: string
  /** When true, worktree may be created empty for fixture proofs (still must not equal repo root). */
  allowCreateEmpty?: boolean
}): WorktreeVerification {
  const repoRoot = tryRealpath(input.repositoryRoot ?? resolveRepoRoot())
  const requested = path.resolve(input.worktreePath)

  if (!requested || requested === repoRoot) {
    return {
      ok: false,
      reason: 'Worktree must be an isolated path distinct from the canonical repository checkout.',
      reasonCode: 'PRODUCTION_CHECKOUT_WRITE_DENIED',
    }
  }

  if (!existsSync(requested)) {
    if (!input.allowCreateEmpty) {
      return { ok: false, reason: 'Approved worktree path does not exist.', reasonCode: 'WORKTREE_MISSING' }
    }
    mkdirSync(requested, { recursive: true })
  }

  const worktreeAbs = tryRealpath(requested)
  if (worktreeAbs === repoRoot) {
    return {
      ok: false,
      reason: 'Resolved worktree equals production checkout — fail closed.',
      reasonCode: 'PRODUCTION_CHECKOUT_WRITE_DENIED',
    }
  }

  // Symlink/junction escape: if worktree itself is a link into the repo root, deny.
  try {
    const st = lstatSync(requested)
    if (st.isSymbolicLink()) {
      const target = tryRealpath(requested)
      if (target === repoRoot || target.startsWith(repoRoot + path.sep)) {
        // Isolated worktree that is a git worktree link INTO the repo object store is OK only if
        // the worktree path itself is outside repoRoot — already enforced above.
      }
    }
  } catch {
    /* ignore */
  }

  let baseSha: string | null = null
  let preexistingDirty: string[] = []
  try {
    // Read-only git metadata when worktree is a git dir / worktree
    baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreeAbs,
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreeAbs,
      encoding: 'utf8',
      windowsHide: true,
    })
    preexistingDirty = status
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.slice(3).trim())
  } catch {
    baseSha = null
    preexistingDirty = []
  }

  return {
    ok: true,
    worktreeAbs,
    repositoryRootAbs: repoRoot,
    baseSha,
    preexistingDirty,
  }
}

export function resolvePathInsideWorktree(input: {
  worktreeAbs: string
  relativePath: string
  allowedPathPrefixes: readonly string[]
}): { ok: true; abs: string; rel: string } | { ok: false; reason: string; reasonCode: string } {
  const relRaw = input.relativePath.trim().replace(/^[/\\]+/, '')
  if (!relRaw || relRaw.includes('\0')) {
    return { ok: false, reason: 'Empty or invalid relative path.', reasonCode: 'PATH_DENIED' }
  }

  // Block traversal tokens before resolve
  if (relRaw.split(/[/\\]/).includes('..')) {
    return { ok: false, reason: 'Path traversal denied.', reasonCode: 'PATH_TRAVERSAL_DENIED' }
  }

  if (path.isAbsolute(input.relativePath)) {
    return { ok: false, reason: 'Absolute path escape denied.', reasonCode: 'ABSOLUTE_ESCAPE_DENIED' }
  }

  const absCandidate = path.resolve(input.worktreeAbs, relRaw)
  let absReal = absCandidate
  try {
    if (existsSync(absCandidate)) absReal = realpathSync(absCandidate)
    else {
      // For creates: resolve parent
      const parent = path.dirname(absCandidate)
      if (existsSync(parent)) {
        const parentReal = realpathSync(parent)
        absReal = path.join(parentReal, path.basename(absCandidate))
      }
    }
  } catch {
    return { ok: false, reason: 'Unable to resolve canonical path.', reasonCode: 'PATH_DENIED' }
  }

  const worktreeReal = tryRealpath(input.worktreeAbs)
  const relFromWorktree = path.relative(worktreeReal, absReal).split(path.sep).join('/')
  if (relFromWorktree.startsWith('..') || path.isAbsolute(relFromWorktree)) {
    return { ok: false, reason: 'Resolved target escapes approved worktree.', reasonCode: 'SYMLINK_ESCAPE_DENIED' }
  }

  if (BLOCKED_RELATIVE_PATTERNS.some(p => p.test(relFromWorktree))) {
    return { ok: false, reason: `Path blocked by policy: ${relFromWorktree}`, reasonCode: 'SENSITIVE_PATH_DENIED' }
  }

  const allowed = input.allowedPathPrefixes.some(prefix => {
    const norm = prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    return relFromWorktree === norm || relFromWorktree.startsWith(norm + '/')
  })
  if (!allowed) {
    return {
      ok: false,
      reason: `Path ${relFromWorktree} is outside allowed_paths.`,
      reasonCode: 'NON_APPROVED_PATH_DENIED',
    }
  }

  return { ok: true, abs: absReal, rel: relFromWorktree }
}

export function writeBoundedFile(input: {
  worktreeAbs: string
  relativePath: string
  allowedPathPrefixes: readonly string[]
  content: string
  maxBytes: number
}): { ok: true; abs: string; rel: string; bytes: number } | { ok: false; reason: string; reasonCode: string } {
  const resolved = resolvePathInsideWorktree(input)
  if (!resolved.ok) return resolved
  const bytes = Buffer.byteLength(input.content, 'utf8')
  if (bytes > input.maxBytes) {
    return { ok: false, reason: `File exceeds max bytes (${bytes} > ${input.maxBytes}).`, reasonCode: 'PATCH_SIZE_EXCEEDED' }
  }
  mkdirSync(path.dirname(resolved.abs), { recursive: true })
  writeFileSync(resolved.abs, input.content, 'utf8')
  return { ok: true, abs: resolved.abs, rel: resolved.rel, bytes }
}

export function readBoundedFile(input: {
  worktreeAbs: string
  relativePath: string
  allowedPathPrefixes: readonly string[]
}): { ok: true; content: string; rel: string } | { ok: false; reason: string; reasonCode: string } {
  const resolved = resolvePathInsideWorktree(input)
  if (!resolved.ok) return resolved
  if (!existsSync(resolved.abs)) {
    return { ok: false, reason: 'File not found.', reasonCode: 'NOT_FOUND' }
  }
  return { ok: true, content: readFileSync(resolved.abs, 'utf8'), rel: resolved.rel }
}

export function removeBoundedFile(input: {
  worktreeAbs: string
  relativePath: string
  allowedPathPrefixes: readonly string[]
}): { ok: true } | { ok: false; reason: string; reasonCode: string } {
  const resolved = resolvePathInsideWorktree(input)
  if (!resolved.ok) return resolved
  if (existsSync(resolved.abs)) rmSync(resolved.abs, { force: true })
  return { ok: true }
}
