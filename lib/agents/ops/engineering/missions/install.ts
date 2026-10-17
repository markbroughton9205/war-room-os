import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChangeReceipt, MissionRecord } from './types'
import { resolveBin, runTool, toolEnv, type ToolRun } from './toolchain'
import { activityHeld } from '../runtime/activity'
import { autonomyDir, isEmergencyStopped } from '../autonomy/config'

/** What went wrong in a build, for a reader (and for the next repair attempt): the lines that name the error first, then the tail. Redacted by runTool already. */
export const buildFailureDetail = (r: { stdout: string; stderr: string }): string => {
  const all = `${r.stderr}\n${r.stdout}`.trim()
  const hits = all.split('\n').map((l) => l.trim()).filter((l) => /(^|\W)(\w*Error\b|error TS\d+|Export encountered|is not defined|Cannot find|Module not found|Failed to compile|Unhandled)/.test(l)).slice(0, 10).map((l) => l.slice(0, 220))
  return `${hits.join(' | ')}${hits.length ? ' … ' : ''}${all.slice(-500)}`.slice(0, 1600)
}

/**
 * Install stage (only for a mission whose creator ticked the install approval). TRANSACTIONAL:
 *   1. the integrated branch is merged in a SCRATCH git worktree (detached at the repository's current HEAD), never in the repository itself;
 *   2. `next build` and `prepare-desktop-runtime` (which execute model-written application code) run INSIDE the OS sandbox: read-only host, empty HOME, no network, only the scratch worktree writable;
 *   3. electron-builder packages from the scratch worktree (filesystem sandbox as well; network only if its own dependency step needs it and says so);
 *   4. only when everything succeeded: the packaged output is moved into a NEW versioned directory and the repository branch is advanced with ONE `git merge --ff-only` (the merge commit already exists).
 * Nothing before step 4 touches the repository or any earlier install, so a failure, a crash, or an Emergency Stop at any point leaves the repository exactly as it was. Cleanup of the
 * scratch worktree runs outside the activity registry (an Emergency Stop kills the build, never the cleanup). A leftover scratch directory from a crash is removed by `cleanupStaleInstallScratch`.
 * The packaged output is MOVED (not copied) so a root-owned sandbox helper applied during packaging keeps its ownership.
 */
export type InstallSteps = { build?: string[]; prepare?: string[]; package?: string[] }
export type InstallOpts = {
  optRoot?: string; version?: string
  /** where scratch worktrees live (default: beside the OS temp dir); the service passes <agent-foundry>/engineering-install */
  scratchRoot?: string
  /** override the build commands (tests); defaults are the real pnpm/node/electron-builder commands */
  steps?: InstallSteps
  /** false only for explicit operator opt-out; model-written code is never built unsandboxed otherwise */
  sandbox?: boolean
  /** test hook: runs after a successful build, right before the repository is advanced */
  beforeCommit?: () => Promise<void> | void
}

const sync = (argv: string[], cwd: string, timeout = 120_000) => { const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout, env: toolEnv() }); return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() } }
export const installScratchDir = (scratchRoot: string, missionId: string) => path.join(scratchRoot, missionId)

/** Removes a scratch worktree (and its git registration). Synchronous and outside the activity registry on purpose: it must still run while an Emergency Stop is in force. */
export function removeScratch(repo: string, scratch: string): void {
  const git = resolveBin('git')
  try { sync([git, '-C', repo, 'worktree', 'remove', '--force', scratch], repo, 120_000) } catch { /* fall through to rm */ }
  try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ }
  try { sync([git, '-C', repo, 'worktree', 'prune'], repo, 60_000) } catch { /* best effort */ }
}

/** Crash recovery: scratch worktrees of missions that are not installing any more are removed. */
export function cleanupStaleInstallScratch(repo: string | null, scratchRoot: string, activeMissionIds: string[]): string[] {
  const removed: string[] = []
  if (!repo || !existsSync(scratchRoot)) return removed
  for (const n of readdirSync(scratchRoot)) { if (activeMissionIds.includes(n)) continue; removeScratch(repo, path.join(scratchRoot, n)); removed.push(n) }
  return removed
}

export async function installRuntime(m: MissionRecord, integ: ChangeReceipt['integration'], on: (s: string) => void, repo: string | null, opts: InstallOpts = {}): Promise<ChangeReceipt['install']> {
  if (!repo) return { state: 'FAILED', detail: 'no engineering repository is configured' }
  if (integ.state !== 'APPLIED' || !integ.commit || !integ.branch) return { state: 'FAILED', detail: 'there is no integrated commit to install' }
  const git = resolveBin('git'), pnpm = resolveBin('pnpm'), node = resolveBin('node')
  const useSandbox = opts.sandbox !== false
  const scratchRoot = opts.scratchRoot ?? path.join(os.tmpdir(), 'wr-engineering-install')
  const scratch = installScratchDir(scratchRoot, m.id)
  const optRoot = opts.optRoot ?? path.join(os.homedir(), '.local', 'opt')
  let dest: string | null = null
  let committed = false
  const gitId = ['-c', 'user.name=Foundry Engineering', '-c', 'user.email=foundry@war-room.local']
  const fail = (detail: string): ChangeReceipt['install'] => ({ state: 'FAILED', detail: `${detail}; the repository was not touched (${head0.slice(0, 10)})` })
  let head0 = ''
  const sandboxFor = (net: boolean, cwd: string) => {
    // toolchains and Electron's download cache live under HOME, which the sandbox hides: bind exactly those, read-only
    const home = os.homedir()
    // the repository's .git is visible READ-ONLY: build scripts that read git metadata (build-meta) work, nothing can rewrite history
    const ro = [path.join(home, '.cache', 'electron'), path.join(home, '.cache', 'electron-builder'), path.join(repo, 'node_modules'), path.join(repo, '.git'), path.dirname(pnpm)].filter((d) => existsSync(d))
    return { rw: [scratch], ro, net, cwd }
  }
  const run = async (label: string, argv: string[], cwd: string, timeoutMs: number, net = false): Promise<ToolRun> => {
    on(`${label}${useSandbox ? ' (sandboxed)' : ' (NOT sandboxed: operator opt-out)'}…`)
    const r = await runTool(argv, cwd, { timeoutMs, ...(useSandbox ? { sandbox: sandboxFor(net, cwd) } : {}) })
    on(`${label}: exit ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`)
    return r
  }
  try {
    const dirty = await runTool([git, '-C', repo, 'status', '--porcelain'], repo, { timeoutMs: 60_000 })
    if (dirty.stdout.trim()) return { state: 'FAILED', detail: `the repository has uncommitted changes (${dirty.stdout.trim().split('\n').length} path(s)); the install must be built from a clean tree` }
    head0 = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
    if (activityHeld()) return fail('Emergency Stop is active')
    // ---- 1. scratch worktree + merge (repository untouched)
    mkdirSync(scratchRoot, { recursive: true }); removeScratch(repo, scratch)
    const add = await runTool([git, '-C', repo, 'worktree', 'add', '--detach', scratch, head0], repo, { timeoutMs: 180_000 })
    if (add.exitCode !== 0) return fail(`could not create the scratch worktree: ${(add.stderr || add.stdout).trim().slice(-200)}`)
    on('merge the integration branch in the scratch worktree…')
    const merged = await runTool([git, ...gitId, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'merge', '--no-edit', integ.branch], scratch, { timeoutMs: 120_000 }) // trusted git, no hooks; the model-written code never runs here
    on(`merge: exit ${merged.exitCode}`)
    if (merged.exitCode !== 0) return fail(`merge refused (${(merged.stdout + merged.stderr).trim().slice(-200)})`)
    const sha = (await runTool([git, '-C', scratch, 'rev-parse', 'HEAD'], scratch, { timeoutMs: 20_000 })).stdout.trim()
    const tree = (await runTool([git, '-C', scratch, 'rev-parse', 'HEAD^{tree}'], scratch, { timeoutMs: 20_000 })).stdout.trim()
    const branch = (await runTool([git, '-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
    const installId = `war-room-os-${opts.version ?? '0.2.0'}-${sha.slice(0, 8)}-foundry-${m.id.slice(-8)}`
    dest = path.join(optRoot, installId)
    // idempotent resume: an earlier attempt already finished this very install
    if (existsSync(dest)) {
      try { const st = JSON.parse(readFileSync(path.join(dest, 'INSTALL_STAMP.json'), 'utf8')) as { mission?: string; gitSha?: string }; if (st.mission === m.id && st.gitSha === sha) { dest = null; return { state: 'INSTALLED', path: path.join(optRoot, installId), stamp: path.join(optRoot, installId, 'INSTALL_STAMP.json'), detail: `already installed by an earlier attempt of this mission (${sha.slice(0, 10)})` } } } catch { /* not ours */ }
      const exists = dest; dest = null
      return fail(`install directory already exists and is never overwritten: ${exists}`)
    }
    // ---- 2. real dependencies for the scratch tree (copy-on-write): Turbopack rejects symlinked node_modules
    for (const sub of ['node_modules', path.join('desktop', 'node_modules')]) {
      if (existsSync(path.join(repo, sub)) && !existsSync(path.join(scratch, sub))) { const c = sync(['cp', '-a', '--reflink=auto', path.join(repo, sub), path.join(scratch, sub)], scratch, 600_000); if (c.code !== 0) return fail(`could not prepare ${sub}: ${c.out.slice(-200)}`) }
    }
    // ---- 3. builds (model-written code executes here: sandboxed, no network)
    const stepsB = opts.steps?.build ?? [pnpm, 'run', 'build']
    const b1 = await run('next build', stepsB, scratch, 30 * 60_000)
    if (b1.exitCode !== 0) return fail(`next build failed: ${buildFailureDetail(b1)}`)
    const b2 = await run('prepare the desktop runtime', opts.steps?.prepare ?? [node, 'scripts/prepare-desktop-runtime.mjs'], scratch, 15 * 60_000)
    if (b2.exitCode !== 0) return fail(`prepare-desktop-runtime failed: ${buildFailureDetail(b2)}`)
    const pkgArgv = opts.steps?.package ?? [path.join(path.dirname(node), 'npx'), 'electron-builder', '--linux', 'dir', '--x64']
    let b3 = await run('package the desktop app', pkgArgv, path.join(scratch, 'desktop'), 30 * 60_000)
    if (b3.exitCode !== 0 && useSandbox && /ENOTFOUND|EAI_AGAIN|ENETUNREACH|getaddrinfo|network/i.test(b3.stderr + b3.stdout)) b3 = await run('package the desktop app (its own dependency step needs the network; filesystem stays sandboxed)', pkgArgv, path.join(scratch, 'desktop'), 30 * 60_000, true)
    if (b3.exitCode !== 0) return fail(`electron-builder failed: ${buildFailureDetail(b3)}`)
    const unpacked = path.join(scratch, 'desktop', 'dist-release', 'linux-unpacked')
    if (!existsSync(path.join(unpacked, 'war-room-os'))) return fail('the packaged executable was not produced')
    const after = await runTool([git, '-C', scratch, 'status', '--porcelain'], scratch, { timeoutMs: 60_000 })
    if (after.stdout.trim()) return fail(`the build left the tree dirty (${after.stdout.trim().split('\n').slice(0, 3).join(', ')}); refusing to stamp it as a clean install`)
    // ---- 4. commit point: nothing above touched the repository or any other install
    if (opts.beforeCommit) await opts.beforeCommit()
    if (activityHeld() || isEmergencyStopped(autonomyDir(path.join(scratchRoot, '..')))) return fail('Emergency Stop became active before the install was committed')
    mkdirSync(path.join(dest, 'opt'), { recursive: true })
    renameSync(unpacked, path.join(dest, 'opt', 'War-Room-OS'))
    const headNow = (await runTool([git, '-C', repo, 'rev-parse', 'HEAD'], repo, { timeoutMs: 20_000 })).stdout.trim()
    const dirtyNow = (await runTool([git, '-C', repo, 'status', '--porcelain'], repo, { timeoutMs: 60_000 })).stdout.trim()
    if (dirtyNow) { rmSync(dest, { recursive: true, force: true }); return fail('the repository changed while the build ran (uncommitted changes); the new installation was discarded') }
    const adv = headNow === head0
      ? await runTool([git, '-C', repo, ...gitId, 'merge', '--ff-only', sha], repo, { timeoutMs: 120_000 })
      : await runTool([git, '-C', repo, ...gitId, 'merge', '--no-edit', sha], repo, { timeoutMs: 120_000 }) // the repository moved on: a real merge, aborted if it conflicts
    if (adv.exitCode !== 0) {
      if (headNow !== head0) await runTool([git, '-C', repo, 'merge', '--abort'], repo, { timeoutMs: 30_000 })
      rmSync(dest, { recursive: true, force: true })
      return fail(`the verified build could not be merged into the repository (${(adv.stdout + adv.stderr).trim().slice(-200)}); the new installation was discarded`)
    }
    committed = true
    const stamp = { install_id: installId, feature: `${m.title} (Foundry engineering mission ${m.id})`, mission: m.id, gitSha: sha, gitShort: sha.slice(0, 8), gitTree: tree, gitDirty: false, gitRef: branch, foundryBranch: integ.branch, foundryCommit: integ.commit, builtAt: new Date().toISOString(), executable: path.join(dest, 'opt', 'War-Room-OS', 'war-room-os'), canonical_launcher_repointed: false, rollback_repository_head: head0, built_in: 'scratch worktree', sandboxed: useSandbox }
    writeFileSync(path.join(dest, 'INSTALL_STAMP.json'), JSON.stringify(stamp, null, 2) + '\n')
    on(`installed ${installId}`)
    return { state: 'INSTALLED', path: dest, stamp: path.join(dest, 'INSTALL_STAMP.json'), detail: `built from ${sha.slice(0, 10)} (tree ${tree.slice(0, 10)}) in an isolated scratch worktree${useSandbox ? ', build sandboxed without network' : ''}; gitDirty=false` }
  } finally {
    if (!committed && dest && existsSync(dest) && !existsSync(path.join(dest, 'INSTALL_STAMP.json'))) { try { rmSync(dest, { recursive: true, force: true }) } catch { /* best effort */ } }
    removeScratch(repo, scratch)
  }
}
