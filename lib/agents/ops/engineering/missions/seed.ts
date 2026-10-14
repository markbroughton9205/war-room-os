import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { Workspace, treeHash } from '../runtime/workspaceFs'
import type { SourceSpec } from './types'

export class SeedError extends Error { constructor(public readonly code: 'PATH' | 'SECRET' | 'TOO_BIG' | 'MISSING', msg: string) { super(msg) } }
const MAX_SEED_FILES = 600
const MAX_SEED_BYTES = 3_000_000
const SKIP_SEG = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.turbo'])
const SECRET_NAME = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_rsa.*|.*secrets?\.(json|ya?ml)|\.npmrc|credentials.*)$/i

/** A seed path is a repo-relative file or directory; no absolute paths, no traversal, nothing secret-shaped, nothing that resolves outside the source repo. */
export function checkSeedPath(repo: string, rel: string): string {
  if (!rel || path.isAbsolute(rel) || rel.includes('\0') || rel.split(/[\\/]/).includes('..')) throw new SeedError('PATH', `seed path must be repository-relative without traversal: ${rel}`)
  const clean = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/\/$/, '')
  if (clean.split('/').some((s) => SKIP_SEG.has(s))) throw new SeedError('PATH', `protected seed path: ${rel}`)
  if (SECRET_NAME.test(clean)) throw new SeedError('SECRET', `secret-shaped file is never copied into a workspace: ${rel}`)
  const abs = path.resolve(repo, clean)
  if (!existsSync(abs)) throw new SeedError('MISSING', `seed path does not exist in the source repository: ${rel}`)
  const real = realpathSync(abs), realRepo = realpathSync(repo)
  if (real !== realRepo && !real.startsWith(realRepo + path.sep)) throw new SeedError('PATH', `seed path resolves outside the source repository: ${rel}`)
  return clean
}

/** Copies the named repo paths into a fresh mission workspace (layout preserved, symlinks dropped, size-bounded) and returns the seeded file list and the seed snapshot. */
export function seedWorkspace(root: string, source: SourceSpec | undefined): { seeded: string[]; snapshot: Record<string, string>; treeSha256: string } {
  mkdirSync(root, { recursive: true })
  const seeded: string[] = []
  let bytes = 0
  const copyFile = (repoFile: string, rel: string) => {
    if (SECRET_NAME.test(rel)) throw new SeedError('SECRET', `secret-shaped file is never copied into a workspace: ${rel}`)
    const st = statSync(repoFile)
    bytes += st.size
    if (seeded.length + 1 > MAX_SEED_FILES || bytes > MAX_SEED_BYTES) throw new SeedError('TOO_BIG', `seed exceeds ${MAX_SEED_FILES} files / ${MAX_SEED_BYTES} bytes; narrow the scope`)
    const dst = path.join(root, rel); mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(repoFile, dst); seeded.push(rel)
  }
  const walk = (repoDir: string, rel: string) => {
    for (const n of readdirSync(repoDir).sort()) {
      if (SKIP_SEG.has(n)) continue
      const p = path.join(repoDir, n); const r = `${rel}/${n}`
      const st = lstatSync(p)
      if (st.isSymbolicLink()) continue
      if (SECRET_NAME.test(r)) continue // a directory seed skips secret-shaped files; naming one explicitly is an error
      if (st.isDirectory()) walk(p, r); else if (st.isFile()) copyFile(p, r)
    }
  }
  if (source) {
    const repo = realpathSync(source.repo)
    for (const raw of source.paths) {
      const rel = checkSeedPath(repo, raw)
      const abs = path.join(repo, rel)
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(abs, rel); else copyFile(abs, rel)
    }
  }
  // a workspace the engine can run tests in: plain ES modules, `node --test`
  const pj = path.join(root, 'package.json')
  if (!existsSync(pj)) writeFileSync(pj, JSON.stringify({ name: 'foundry-feature', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test test/' } }, null, 2))
  const ws = new Workspace(root)
  const snapshot = ws.snapshot()
  return { seeded: seeded.sort(), snapshot, treeSha256: treeHash(snapshot) }
}
