/** Physical repository scope, shared by acquisition and peer checks. */
import { realpathSync } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { missionWorkspaceScope, validateWorkspaceRoot } from './foundryWorkspaceBinding'
import { isPathInsideRoot } from './workspaceRegistry'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryRepoWriteScope } from './foundryOperationsTypes'

export async function repoWriteScope(root: string | undefined, paths: readonly string[] = []): Promise<FoundryRepoWriteScope> {
  if (!root) throw new Error('REPO_WRITE_SCOPE_REQUIRED: explicit workspace root required')
  const checked = await validateWorkspaceRoot(root)
  if (!checked.ok) throw new Error(`REPO_WRITE_SCOPE_INVALID: ${checked.code}: ${checked.reason}`)
  const targets: string[] = []
  const fileIds: string[] = []
  for (const rel of paths) {
    if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel) || rel.split(/[\\/]+/).includes('..')) {
      throw new Error('REPO_WRITE_SCOPE_INVALID: target must be a relative contained path')
    }
    const target = path.resolve(checked.root, rel)
    if (!isPathInsideRoot(target, checked.root)) throw new Error('REPO_WRITE_SCOPE_INVALID: target escapes workspace')
    let ancestor = target
    const suffix: string[] = []
    for (;;) {
      try {
        // lstat distinguishes a dangling symlink from an absent future path. Never walk past it.
        await lstat(ancestor)
        const physical = path.join(await realpath(ancestor), ...suffix)
        if (!isPathInsideRoot(physical, checked.root)) throw new Error('REPO_WRITE_SCOPE_INVALID: symlink target escapes workspace')
        targets.push(physical)
        if (!suffix.length) {
          const info = await stat(physical, { bigint: true })
          if (info.isFile()) fileIds.push(`${info.dev}:${info.ino}`)
        }
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // An existing dangling symlink must fail, even when realpath returned ENOENT.
        try { await lstat(ancestor); throw new Error('REPO_WRITE_SCOPE_INVALID: dangling symlink') } catch (check) {
          if ((check as NodeJS.ErrnoException).code !== 'ENOENT') throw check
        }
        if (ancestor === checked.root) throw new Error('REPO_WRITE_SCOPE_INVALID: workspace disappeared')
        suffix.unshift(path.basename(ancestor))
        ancestor = path.dirname(ancestor)
      }
    }
  }
  return { version: 1, workspaceRoot: checked.root, targets: [...new Set(targets)], fileIds: [...new Set(fileIds)] }
}

export async function missionRepoWriteRoot(mission: FoundryMissionRecord): Promise<string> {
  const scoped = await missionWorkspaceScope(mission)
  if (!scoped.ok) throw new Error(`REPO_WRITE_SCOPE_INVALID: ${scoped.code}: ${scoped.blocker.evidence}`)
  // Existing source-checkout missions are supported; installed unbound writers are refused by missionWorkspaceScope.
  return scoped.root ?? resolveRepoRoot()
}

export function validRepoWriteScope(value: unknown): value is FoundryRepoWriteScope {
  if (!value || typeof value !== 'object') return false
  const scope = value as FoundryRepoWriteScope
  return scope.version === 1 && typeof scope.workspaceRoot === 'string' && path.isAbsolute(scope.workspaceRoot)
    && path.normalize(scope.workspaceRoot) === scope.workspaceRoot
    && !scope.workspaceRoot.split(/[\\/]+/).includes('..')
    && Array.isArray(scope.fileIds) && scope.fileIds.every(id => typeof id === 'string' && /^\d+:\d+$/.test(id))
    && Array.isArray(scope.targets) && scope.targets.every(target => typeof target === 'string'
      && path.normalize(target) === target && isPathInsideRoot(target, scope.workspaceRoot))
}

export function repoWriteScopesOverlap(a: FoundryRepoWriteScope, b: FoundryRepoWriteScope | undefined): boolean {
  // Old or malformed claims retain machine-wide exclusion. Root overlap deliberately excludes even disjoint files.
  if (!validRepoWriteScope(a) || !validRepoWriteScope(b)) return true
  if (a.fileIds.some(id => b.fileIds.includes(id))) return true
  if (isPathInsideRoot(a.workspaceRoot, b.workspaceRoot) || isPathInsideRoot(b.workspaceRoot, a.workspaceRoot)) return true
  try {
    // A persisted root may have been replaced with a symlink since acquisition. Retain physical exclusion.
    const ar = realpathSync(a.workspaceRoot), br = realpathSync(b.workspaceRoot)
    return isPathInsideRoot(ar, br) || isPathInsideRoot(br, ar)
  } catch { return true } // disappeared/unresolvable claims cannot grant permission to write

}
