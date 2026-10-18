/** Workspace BASE IDENTITY seam (isolated, READ-ONLY toward git and live War Room).
 *
 * Live reference (read only): lib/native-builder/foundryWorkspaceBinding.ts (FoundryWorkspaceBinding {workspaceId, workspaceRoot=realpath, boundAt, source};
 * validateWorkspaceRoot; missionWorkspaceScope => WORKSPACE_ROOT_CHANGED), foundryWorkspaceIdentity.ts (snapshotFoundryWorkspaceBinding: git_root, git_head_at_start,
 * git_branch, source_fingerprint = sha256(type\nroot\nHEAD)[0:16]; describeSourceWorkspaceState {head, branch, dirty}; classifyWorkspaceRoot; readInstalledRuntimeSha),
 * foundryAgentWorkspaces.ts (detached git worktrees), workspaceRegistry.ts (gitRepository/gitBranch only).
 * Live provides NO repository id, NO worktree id, NO root device/inode identity and records the commit only at mission start; this module defines them.
 *
 * BASE IDENTITY = which physical workspace + which base commit it started from. It is deliberately NOT the working-tree content: per-file before/after hashes
 * (core) own that, so the adapter's own writes can never invalidate the base identity. Dirty state, mtimes, pids, sessions and runtime state are never inputs. */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { canonical, hash, refuse } from './base.mjs'

export const UNKNOWN = 'UNKNOWN'
export const BASE_CLASSES = Object.freeze(['BASE_UNCHANGED', 'BASE_ADVANCED_EXTERNALLY', 'WORKTREE_CHANGED', 'WORKSPACE_REBOUND', 'UNKNOWN'])
export const RECOVERY_CLASSES = Object.freeze({ BASE_UNCHANGED: 'SAME_BASE_SAFE', BASE_ADVANCED_EXTERNALLY: 'BASE_CHANGED_REVIEW_REQUIRED', WORKTREE_CHANGED: 'WORKTREE_CHANGED_REVIEW_REQUIRED', WORKSPACE_REBOUND: 'WORKSPACE_REBOUND_REVIEW_REQUIRED', UNKNOWN: 'UNKNOWN_REVIEW_REQUIRED' })
export const SOURCE_KINDS = Object.freeze(['git-main', 'git-linked-worktree', 'git-subdirectory', 'not-git', UNKNOWN])
const KEYS = ['workspaceId', 'canonicalRoot', 'rootId', 'sourceKind', 'repositoryId', 'worktreeId', 'branch', 'baseCommit', 'sourceEpoch', 'observedAt']
const STABLE = KEYS.filter(k => k !== 'observedAt')
const MUST_KNOW = ['workspaceId', 'canonicalRoot', 'rootId', 'repositoryId', 'worktreeId', 'branch', 'baseCommit']

/** Strict shape; anything absent/invalid becomes UNKNOWN (never invented). `complete` = every identity-bearing field is proven. */
export function normalizeBaseIdentity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !KEYS.includes(k) && k !== 'complete')) return null // `complete` is accepted only because stored identities carry it; it is always RECOMPUTED, never trusted
  const s = (v, re) => (typeof v === 'string' && re.test(v) ? v : UNKNOWN)
  const id = {
    workspaceId: s(raw.workspaceId, /^[\w.:@/-]{1,200}$/), canonicalRoot: s(raw.canonicalRoot, /^\/[^\0]{0,4000}$/), rootId: s(raw.rootId, /^\d+:\d+$/),
    sourceKind: SOURCE_KINDS.includes(raw.sourceKind) ? raw.sourceKind : UNKNOWN, repositoryId: s(raw.repositoryId, /^repo-[a-f0-9]{32}$/), worktreeId: s(raw.worktreeId, /^wt-[a-f0-9]{32}$/),
    branch: s(raw.branch, /^[\w./@+-]{1,250}$/), baseCommit: s(raw.baseCommit, /^[0-9a-f]{40,64}$/), sourceEpoch: s(raw.sourceEpoch, /^[\w.:-]{1,100}$/), observedAt: Number.isFinite(raw.observedAt) ? raw.observedAt : 0,
  }
  return Object.freeze({ ...id, complete: MUST_KNOW.every(k => id[k] !== UNKNOWN) && id.sourceKind !== 'not-git' && id.sourceKind !== UNKNOWN })
}
/** Digest over STABLE fields only (no observedAt, no dirty state). This is the opaque base revision the package/approval/lease bind to. */
export const baseDigestOf = id => `bi1:${hash(canonical(Object.fromEntries(STABLE.map(k => [k, id[k]]))))}`

/** Precedence: rebound > worktree/ref change > commit advance > unchanged. Same base commit + same worktree = unchanged no matter how many files the adapter wrote. */
export function classifyBaseChange(stored, current) {
  if (!stored?.complete || !current?.complete) return 'UNKNOWN'
  if (stored.workspaceId !== current.workspaceId || stored.canonicalRoot !== current.canonicalRoot || stored.rootId !== current.rootId || stored.repositoryId !== current.repositoryId) return 'WORKSPACE_REBOUND'
  if (stored.worktreeId !== current.worktreeId || stored.sourceKind !== current.sourceKind || stored.branch !== current.branch) return 'WORKTREE_CHANGED'
  if (stored.baseCommit !== current.baseCommit) return 'BASE_ADVANCED_EXTERNALLY'
  return stored.sourceEpoch === current.sourceEpoch ? 'BASE_UNCHANGED' : 'UNKNOWN'
}
export const recoveryClassOf = cls => RECOVERY_CLASSES[cls] ?? RECOVERY_CLASSES.UNKNOWN

// ------------------------------------------------------------------ read-only git probe
/** Only these exact argv shapes can ever run: every one is read-only (no status: it can refresh the index; no checkout/reset/switch/worktree/config/update-ref). */
export const ALLOWED_GIT = Object.freeze([
  Object.freeze(['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', 'HEAD']),
  Object.freeze(['symbolic-ref', '-q', '--short', 'HEAD']),
])
export const isAllowedGit = args => Array.isArray(args) && ALLOWED_GIT.some(a => a.length === args.length && a.every((x, i) => x === args[i]))
const GIT_ENV = Object.freeze({ PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' })
const defaultExec = (args, cwd) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })
export function createGitProbe({ exec = defaultExec } = {}) {
  const run = (args, cwd) => {
    if (!isAllowedGit(args)) throw new Error('GIT_COMMAND_NOT_ALLOWED')
    try { return { ok: true, out: String(exec(args, cwd)) } } catch (e) { return { ok: false, status: e?.status ?? null, out: String(e?.stdout ?? '') } }
  }
  const real = p => { try { return fs.realpathSync(p) } catch { return null } }
  const dirId = p => { try { const st = fs.statSync(p, { bigint: true }); return `${st.dev}:${st.ino}` } catch { return null } }
  return Object.freeze({
    /** -> raw facts or {error}. Never throws with host paths/messages. */
    run, // exposed ONLY so the whitelist itself is testable; it throws GIT_COMMAND_NOT_ALLOWED for anything else
    inspect(root) {
      let lst; try { lst = fs.lstatSync(root) } catch { return { error: 'ROOT_MISSING' } }
      const rp = real(root)
      if (lst.isSymbolicLink() || rp === null || rp !== root) return { error: 'ROOT_NOT_CANONICAL' } // symlink / relative / alias spelling: refused, never silently followed
      const rootId = dirId(root); if (!rootId) return { error: 'ROOT_MISSING' }
      const facts = { canonicalRoot: root, rootId, sourceKind: 'not-git', repositoryId: UNKNOWN, worktreeId: UNKNOWN, branch: UNKNOWN, baseCommit: UNKNOWN, sourceEpoch: UNKNOWN }
      const g = run(ALLOWED_GIT[0], root), lines = g.out.split('\n').filter(Boolean)
      if (lines.length < 3) return facts // not a git checkout (or git unavailable): identity stays incomplete
      const [top, gitDir, common, head] = lines.map(l => l.trim()), topR = real(top), gitR = real(gitDir), comR = real(common), gi = dirId(gitDir), ci = dirId(common)
      if (!topR || !gitR || !comR || !gi || !ci) return { ...facts, sourceKind: UNKNOWN }
      facts.repositoryId = `repo-${hash(`${comR}|${ci}`).slice(0, 32)}`; facts.worktreeId = `wt-${hash(`${gitR}|${gi}`).slice(0, 32)}`
      facts.sourceKind = gitR !== comR ? 'git-linked-worktree' : topR !== root ? 'git-subdirectory' : 'git-main'
      if (g.ok && /^[0-9a-f]{40,64}$/.test(head ?? '')) facts.baseCommit = head
      const b = run(ALLOWED_GIT[1], root); facts.branch = b.ok && b.out.trim() ? b.out.trim() : (!b.ok && b.status === 1 && b.out.trim() === '' ? 'DETACHED' : UNKNOWN) // `symbolic-ref -q` exits 1 only for a detached HEAD; any other failure stays UNKNOWN
      return facts
    },
  })
}

// ------------------------------------------------------------------ base-identity adapter for the broker (resolve = opaque digest, inspect = normalized identity)
/** `rootOf(workspaceId) -> {root}` is the host's validated workspace binding (live: missionWorkspaceScope/validateWorkspaceRoot). */
export function createWorkspaceBaseIdentity({ probe, rootOf, now = Date.now }) {
  if (!probe?.inspect || typeof rootOf !== 'function') throw new Error('probe and rootOf are required')
  const inspect = workspaceId => {
    let r = null; try { r = rootOf(workspaceId) } catch { r = null }
    const f = r?.root ? probe.inspect(r.root) : { error: 'ROOT_MISSING' }
    if (f.error) return normalizeBaseIdentity({ workspaceId, observedAt: now() }) // all UNKNOWN => incomplete
    return normalizeBaseIdentity({ workspaceId, ...f, observedAt: now() })
  }
  return Object.freeze({
    kind: 'workspace-git', inspect,
    resolve(workspaceId) { const id = inspect(workspaceId); if (!id?.complete) refuse('BASE_REVISION_MISMATCH', 'preflight', 'Workspace base identity could not be proven (root not canonical, not a git checkout, or unreadable)'); return baseDigestOf(id) },
    classify: (stored, current) => classifyBaseChange(stored, current),
  })
}
