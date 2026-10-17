import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workspace, treeHash } from '../runtime/workspaceFs'
import type { SourceSpec } from './types'

export class SeedError extends Error { constructor(public readonly code: 'PATH' | 'SECRET' | 'TOO_BIG' | 'MISSING', msg: string) { super(msg) } }
const MAX_SEED_FILES = 600
const MAX_SEED_BYTES = 3_000_000
const SKIP_SEG = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.turbo'])
export const SECRET_NAME = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa).*|[^/]*(?:^|[._-])(?:secret|credential|password|passwd|token)s?(?:[._-][^/]*)?\.(?:json|ya?ml|txt|env|ini|cfg|conf)|\.npmrc|\.netrc|[^/]*credentials[^/]*|\.aws|\.ssh)(\/|$)/i
/** Paths a mission may never write (and so never apply or install): security, auth, build, packaging and configuration surfaces. Overridable only by a server operator via WAR_ROOM_ENG_ALLOW_SENSITIVE=1. */
export const SENSITIVE_WRITE = /^(package\.json|pnpm-lock\.yaml|package-lock\.json|tsconfig[^/]*\.json|next\.config\.[^/]+|middleware\.[^/]+|proxy\.[^/]+|instrumentation\.[^/]+|\.github\/|\.env[^/]*|desktop\/|scripts\/|\.gitattributes|\.gitmodules|lib\/agents\/ops\/engineering\/|lib\/intent-prerouter\/|app\/api\/foundry\/|lib\/security\/|lib\/auth\/|lib\/sovereign-runtime\/|lib\/permissions\/|app\/api\/auth\/|app\/auth\/|app\/api\/sovereign\/)/i
export const isSensitiveWrite = (p: string) => process.env.WAR_ROOM_ENG_ALLOW_SENSITIVE !== '1' && SENSITIVE_WRITE.test(p.replace(/\\/g, '/').replace(/^\.\//, ''))

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

/** Resolves a ref to a full commit id inside `repo`, or throws. Only commit-ish names git itself resolves are accepted; the result is a 40-hex id. */
export function resolveRef(repo: string, ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/.test(ref) || ref.includes('..')) throw new SeedError('PATH', `invalid ref: ${ref.slice(0, 60)}`)
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8', timeout: 20_000 })
  const id = (r.stdout ?? '').trim()
  if (r.status !== 0 || !/^[0-9a-f]{40}$/.test(id)) throw new SeedError('MISSING', `ref does not resolve to a commit: ${ref}`)
  return id
}

/** The named paths as they are at `ref`, extracted into a fresh temporary directory (git archive; no working-tree state, no hooks). The caller removes the directory. */
export function materializeRef(repo: string, ref: string, paths: string[]): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-ref-'))
  try {
    for (const p of paths) {
      if (!p || path.isAbsolute(p) || p.includes('\0') || p.split(/[\\/]/).includes('..') || p.startsWith('-')) throw new SeedError('PATH', `seed path must be repository-relative without traversal: ${p}`)
    }
    const ar = spawnSync('git', ['-C', repo, '--literal-pathspecs', 'archive', '--format=tar', ref, '--', ...paths], { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 })
    if (ar.status !== 0) throw new SeedError('MISSING', `a seed path does not exist at ${ref.slice(0, 10)}: ${String(ar.stderr ?? '').trim().slice(0, 160)}`)
    const tar = spawnSync('tar', ['-x', '-C', tmp, '--no-same-owner', '--no-same-permissions'], { input: ar.stdout, timeout: 120_000 })
    if (tar.status !== 0) throw new SeedError('PATH', `could not extract the seed paths at ${ref.slice(0, 10)}`)
    return tmp
  } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e }
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
      if (st.isFile() && st.nlink > 1) continue // a hardlink may be another file's content
      if (st.isDirectory()) walk(p, r); else if (st.isFile()) copyFile(p, r)
    }
  }
  let refTmp: string | null = null
  if (source) {
    if (source.ref) refTmp = materializeRef(source.repo, source.ref, source.paths)
    const repo = realpathSync(refTmp ?? source.repo)
    for (const raw of source.paths) {
      const rel = checkSeedPath(repo, raw)
      const abs = path.join(repo, rel)
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(abs, rel); else copyFile(abs, rel)
    }
    if (refTmp) rmSync(refTmp, { recursive: true, force: true })
  }
  // a workspace the engine can run tests in: plain ES modules, `node --test`
  const pj = path.join(root, 'package.json')
  if (!existsSync(pj)) writeFileSync(pj, JSON.stringify({ name: 'foundry-feature', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2))
  const ws = new Workspace(root)
  const snapshot = ws.snapshot()
  return { seeded: seeded.sort(), snapshot, treeSha256: treeHash(snapshot) }
}
