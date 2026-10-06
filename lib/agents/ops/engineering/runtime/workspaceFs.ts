import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { WorkspacePort } from './ports'

export class WorkspaceError extends Error {
  constructor(public readonly code: 'UNSAFE_ROOT' | 'ESCAPE' | 'FORBIDDEN_PATH' | 'TOO_LARGE' | 'NOT_FOUND', msg: string) { super(msg) }
}
const MAX_WRITE_BYTES = 400_000
const MAX_FILES = 2000
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'coverage'])
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

/** Refuses roots that are not safe sandboxes: system dirs, the user's home, installed War Room runtimes, or War Room's own source tree (unless explicitly allowed). */
export function assertSafeWorkspaceRoot(root: string, opts: { allowSelfRepo?: boolean } = {}): string {
  if (!path.isAbsolute(root)) throw new WorkspaceError('UNSAFE_ROOT', 'workspace root must be absolute')
  const real = realpathSync(root)
  const home = os.homedir()
  const bad = [path.parse(real).root, home, '/home', '/tmp', '/etc', '/usr', '/var']
  if (bad.includes(real)) throw new WorkspaceError('UNSAFE_ROOT', `refusing broad root ${real}`)
  if (real.includes(`${path.sep}.local${path.sep}opt${path.sep}war-room-os`) || real.includes(`${path.sep}resources${path.sep}runtime`)) throw new WorkspaceError('UNSAFE_ROOT', 'refusing to treat an installed War Room runtime as a source workspace')
  const repo = resolveBaseRepoRoot()
  if (!opts.allowSelfRepo && (real === realpathSync(repo) || real.startsWith(realpathSync(repo) + path.sep))) throw new WorkspaceError('UNSAFE_ROOT', 'refusing War Room\'s own source tree without an explicit self-repo grant')
  return real
}

/** Confined, atomic file access for ONE bound workspace. Paths are relative; traversal, absolute paths and symlink escapes are refused. */
export class Workspace implements WorkspacePort {
  readonly root: string
  constructor(root: string, opts: { allowSelfRepo?: boolean } = {}) { this.root = assertSafeWorkspaceRoot(root, opts) }

  resolve(rel: string): string {
    if (!rel || path.isAbsolute(rel) || rel.includes('\0')) throw new WorkspaceError('ESCAPE', `invalid path: ${rel}`)
    const abs = path.resolve(this.root, rel)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new WorkspaceError('ESCAPE', `path escapes the workspace: ${rel}`)
    const parts = path.relative(this.root, abs).split(path.sep)
    if (parts[0] === '.git' || parts.includes('node_modules')) throw new WorkspaceError('FORBIDDEN_PATH', `protected path: ${rel}`)
    // walk existing ancestors: no symlink may lead outside
    let cur = this.root
    for (const p of parts) { cur = path.join(cur, p); if (!existsSync(cur)) break; if (lstatSync(cur).isSymbolicLink()) { const t = realpathSync(cur); if (t !== this.root && !t.startsWith(this.root + path.sep)) throw new WorkspaceError('ESCAPE', `symlink escapes the workspace: ${rel}`) } }
    return abs
  }
  exists(rel: string) { try { return existsSync(this.resolve(rel)) } catch { return false } }
  read(rel: string) { const abs = this.resolve(rel); if (!existsSync(abs)) throw new WorkspaceError('NOT_FOUND', `no such file: ${rel}`); if (statSync(abs).size > MAX_WRITE_BYTES * 2) throw new WorkspaceError('TOO_LARGE', `file too large: ${rel}`); return readFileSync(abs, 'utf8') }
  hash(rel: string): string | null { try { const abs = this.resolve(rel); return existsSync(abs) ? sha(readFileSync(abs)) : null } catch { return null } }
  write(rel: string, content: string) {
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new WorkspaceError('TOO_LARGE', `refusing to write ${Buffer.byteLength(content)} bytes`)
    const abs = this.resolve(rel)
    const before = existsSync(abs) ? sha(readFileSync(abs)) : null
    mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.tmp`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, abs)
    return { beforeHash: before, afterHash: sha(content) }
  }
  list(): string[] {
    const out: string[] = []
    const walk = (rel: string) => {
      if (out.length >= MAX_FILES) return
      for (const n of readdirSync(path.join(this.root, rel)).sort()) {
        if (SKIP.has(n) || n.endsWith('.tmp')) continue
        const r = rel ? `${rel}/${n}` : n
        const st = lstatSync(path.join(this.root, r))
        if (st.isSymbolicLink()) continue
        if (st.isDirectory()) walk(r); else out.push(r)
      }
    }
    walk('')
    return out
  }
  snapshot(): Record<string, string> { const m: Record<string, string> = {}; for (const f of this.list()) { const h = this.hash(f); if (h) m[f] = h } return m }
}
export const treeHash = (snap: Record<string, string>) => sha(Object.keys(snap).sort().map((k) => `${k}:${snap[k]}`).join('\n'))
