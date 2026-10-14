import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The ONLY way the Reverse Engineer touches a repository: a bounded, read-only walk. It never follows symlinks, never leaves the root, and offers no write operation,
 * so an analysis cannot modify source by construction. Workspace isolation: the root is fixed when the snapshot is taken.
 */
export type Snapshot = {
  root: string
  files: Map<string, string>
  sizes: Map<string, number>
  skipped: { path: string; reason: string }[]
  truncated: boolean
  fingerprint: string
  head: string | null
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'dist-release', 'coverage', '.turbo', '.cache', 'out', '.pnpm-store'])
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
export const SNAPSHOT_LIMITS = { maxFiles: 6000, maxFileBytes: 180_000, maxDepth: 14 }

export class SnapshotError extends Error {}

/** Directory patterns from the root .gitignore (generated output such as desktop/runtime mirrors source and would double every relationship). Only directory-shaped patterns are honoured. */
export function ignoredDirMatchers(root: string): ((rel: string) => boolean)[] {
  let text = ''
  try { text = readFileSync(path.join(root, '.gitignore'), 'utf8') } catch { return [] }
  const out: ((rel: string) => boolean)[] = []
  for (const raw of text.split('\n')) {
    let l = raw.trim()
    if (!l || l.startsWith('#') || l.startsWith('!')) continue
    const anchored = l.startsWith('/') || l.replace(/\/$/, '').includes('/')
    l = l.replace(/^\//, '').replace(/\/$/, '')
    if (!l || /[?\[]/.test(l)) continue
    // a pattern with an extension-like glob (*.log) names files, not directories
    if (/^\*\./.test(l)) continue
    const re = new RegExp('^' + l.split('*').map((x) => x.replace(/[.+^${}()|\\]/g, '\\$&')).join('[^/]*') + '$')
    out.push((rel) => (anchored ? re.test(rel) : re.test(path.posix.basename(rel))))
  }
  return out
}

export function readHead(root: string): string | null {
  try {
    const head = readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref:')) return head
    const ref = head.slice(4).trim()
    const loose = path.join(root, '.git', ref)
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    const packed = readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref))
    return packed ? packed.split(' ')[0] : null
  } catch { return null }
}

export function takeSnapshot(rootIn: string, limits = SNAPSHOT_LIMITS): Snapshot {
  let root: string
  try { root = realpathSync(path.resolve(rootIn)) } catch { throw new SnapshotError(`workspace root does not exist: ${rootIn}`) }
  const files = new Map<string, string>(), sizes = new Map<string, number>(), skipped: Snapshot['skipped'] = []
  const ignored = ignoredDirMatchers(root)
  let truncated = false
  const walk = (dir: string, depth: number) => {
    if (truncated || depth > limits.maxDepth) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { skipped.push({ path: path.relative(root, dir), reason: 'unreadable directory' }); return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const abs = path.join(dir, e.name), rel = path.relative(root, abs).split(path.sep).join('/')
      if (e.isSymbolicLink()) { skipped.push({ path: rel, reason: 'symlink not followed' }); continue }
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        if (ignored.some((m) => m(rel))) { skipped.push({ path: rel, reason: 'gitignored directory' }); continue }
        walk(abs, depth + 1); continue
      }
      if (!e.isFile() || !SOURCE_RE.test(e.name)) continue
      if (files.size >= limits.maxFiles) { truncated = true; return }
      try {
        const st = lstatSync(abs)
        if (st.size > limits.maxFileBytes) { skipped.push({ path: rel, reason: `larger than ${limits.maxFileBytes} bytes` }); continue }
        files.set(rel, readFileSync(abs, 'utf8')); sizes.set(rel, st.size)
      } catch { skipped.push({ path: rel, reason: 'unreadable file' }) }
    }
  }
  walk(root, 0)
  const h = createHash('sha256')
  for (const [rel, content] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) h.update(rel).update('\0').update(createHash('sha256').update(content).digest('hex')).update('\n')
  return { root, files, sizes, skipped, truncated, fingerprint: h.digest('hex'), head: readHead(root) }
}
