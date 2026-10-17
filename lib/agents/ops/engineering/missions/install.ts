import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChangeReceipt, MissionRecord } from './types'
import { resolveBin, runTool, type ToolRun } from './toolchain'

/**
 * Install stage (only for a mission whose creator ticked the install approval): merge the integration branch into the repository's current branch, build a NEW versioned
 * runtime from the clean tree, stamp it, and leave every earlier install and the canonical launcher untouched. Any failure aborts the merge it made.
 * The packaged output is MOVED (not copied) into the install directory so a root-owned sandbox helper applied during packaging keeps its ownership.
 */
/** What went wrong in a build, for a reader (and for the next repair attempt): the lines that name the error first, then the tail. Redacted by runTool already. */
export const buildFailureDetail = (r: { stdout: string; stderr: string }): string => {
  const all = `${r.stderr}\n${r.stdout}`.trim()
  const hits = all.split('\n').map((l) => l.trim()).filter((l) => /(^|\W)(\w*Error\b|error TS\d+|Export encountered|is not defined|Cannot find|Module not found|Failed to compile|Unhandled)/.test(l)).slice(0, 10).map((l) => l.slice(0, 220))
  return `${hits.join(' | ')}${hits.length ? ' … ' : ''}${all.slice(-500)}`.slice(0, 1600)
}

export async function installRuntime(m: MissionRecord, integ: ChangeReceipt['integration'], on: (s: string) => void, repo: string | null, opts: { optRoot?: string; version?: string } = {}): Promise<ChangeReceipt['install']> {
  if (!repo) return { state: 'FAILED', detail: 'no engineering repository is configured' }
  if (integ.state !== 'APPLIED' || !integ.commit || !integ.branch) return { state: 'FAILED', detail: 'there is no integrated commit to install' }
  const git = resolveBin('git'), pnpm = resolveBin('pnpm'), node = resolveBin('node')
  const run = async (label: string, argv: string[], cwd: string, timeoutMs: number): Promise<ToolRun> => { on(`${label}…`); const r = await runTool(argv, cwd, { timeoutMs }); on(`${label}: exit ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`); return r }
  const dirty = await runTool([git, '-C', repo, 'status', '--porcelain'], repo, { timeoutMs: 60_000 })
  if (dirty.stdout.trim()) return { state: 'FAILED', detail: `the repository has uncommitted changes (${dirty.stdout.trim().split('\n').length} path(s)); the install must be built from a clean tree` }
  const head0 = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
  const merged = await run('merge the integration branch', [git, '-C', repo, '-c', 'user.name=Foundry Engineering', '-c', 'user.email=foundry@war-room.local', 'merge', '--no-edit', integ.branch], repo, 120_000)
  if (merged.exitCode !== 0) {
    await runTool([git, '-C', repo, 'merge', '--abort'], repo, { timeoutMs: 30_000 })
    return { state: 'FAILED', detail: `merge refused (${(merged.stdout + merged.stderr).trim().slice(-200)}); the repository was left as it was (${head0.slice(0, 10)})` }
  }
  /** Undoes ONLY the merge this stage made: HEAD must still be the merged commit and the tree clean; the integrated commit stays reachable on its foundry branch. */
  const mergedAt = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
  const rollback = async (why: string): Promise<ChangeReceipt['install']> => {
    const head = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
    const dirtyNow = (await runTool([git, '-C', repo, 'status', '--porcelain'], repo, { timeoutMs: 60_000 })).stdout.trim()
    if (head === mergedAt && !dirtyNow) {
      const r = await runTool([git, '-C', repo, 'reset', '--hard', head0], repo, { timeoutMs: 60_000 })
      on(`rolled the repository back to ${head0.slice(0, 10)}: exit ${r.exitCode}`)
      return { state: 'FAILED', detail: `${why}; the repository was rolled back to ${head0.slice(0, 10)} (the integrated commit stays on ${integ.branch})` }
    }
    return { state: 'FAILED', detail: `${why}; the repository was NOT rolled back automatically (HEAD moved or the tree changed): it is at ${head.slice(0, 10)}, was ${head0.slice(0, 10)} before the merge` }
  }
  const sha = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
  const tree = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD^{tree}'], repo, { timeoutMs: 20_000 })).stdout.trim()
  const branch = (await runTool([git, '-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
  const installId = `war-room-os-${opts.version ?? '0.2.0'}-${sha.slice(0, 8)}-foundry-${m.id.slice(-8)}`
  const optRoot = opts.optRoot ?? path.join(os.homedir(), '.local', 'opt')
  const dest = path.join(optRoot, installId)
  if (existsSync(dest)) return rollback(`install directory already exists and is never overwritten: ${dest}`)
  const b1 = await run('next build', [pnpm, 'run', 'build'], repo, 30 * 60_000)
  if (b1.exitCode !== 0) return rollback(`next build failed: ${buildFailureDetail(b1)}`)
  const b2 = await run('prepare the desktop runtime', [node, 'scripts/prepare-desktop-runtime.mjs'], repo, 15 * 60_000)
  if (b2.exitCode !== 0) return rollback(`prepare-desktop-runtime failed: ${(b2.stderr || b2.stdout).trim().slice(-300)}`)
  const b3 = await run('package the desktop app', [path.join(path.dirname(node), 'npx'), 'electron-builder', '--linux', 'dir', '--x64'], path.join(repo, 'desktop'), 30 * 60_000)
  if (b3.exitCode !== 0) return rollback(`electron-builder failed: ${(b3.stderr || b3.stdout).trim().slice(-300)}`)
  const unpacked = path.join(repo, 'desktop', 'dist-release', 'linux-unpacked')
  if (!existsSync(path.join(unpacked, 'war-room-os'))) return rollback('the packaged executable was not produced')
  const after = await runTool([git, '-C', repo, 'status', '--porcelain'], repo, { timeoutMs: 60_000 })
  if (after.stdout.trim()) return rollback('the build left the tree dirty; refusing to stamp it as a clean install')
  mkdirSync(path.join(dest, 'opt'), { recursive: true })
  renameSync(unpacked, path.join(dest, 'opt', 'War-Room-OS'))
  const stamp = { install_id: installId, feature: `${m.title} (Foundry engineering mission ${m.id})`, mission: m.id, gitSha: sha, gitShort: sha.slice(0, 8), gitTree: tree, gitDirty: false, gitRef: branch, foundryBranch: integ.branch, foundryCommit: integ.commit, builtAt: new Date().toISOString(), executable: path.join(dest, 'opt', 'War-Room-OS', 'war-room-os'), canonical_launcher_repointed: false, rollback_repository_head: head0 }
  writeFileSync(path.join(dest, 'INSTALL_STAMP.json'), JSON.stringify(stamp, null, 2) + '\n')
  on(`installed ${installId}`)
  return { state: 'INSTALLED', path: dest, stamp: path.join(dest, 'INSTALL_STAMP.json'), detail: `built from ${sha.slice(0, 10)} (tree ${tree.slice(0, 10)}), gitDirty=false` }
}
