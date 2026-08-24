/**
 * Phase B (Repository/Workspace Model) — smallest safe workspace abstraction.
 *
 * This is the ONLY new primitive: an AsyncLocalStorage-based override for the active repo root,
 * consumed additively by lib/repo/paths.ts:resolveRepoRoot(). No other file in the codebase is
 * touched by this mechanism — every one of the ~20 existing call sites of resolveRepoRoot()
 * (storage.ts, patchPolicy.ts, patchApplier.ts, validationRunner.ts, rollback.ts,
 * repositoryInspector.ts, etc.) continues to call resolveRepoRoot() exactly as before. When no
 * workspace context is active, resolveRepoRoot() behaves identically to its pre-Phase-B
 * implementation (REPO_ROOT env var, else process.cwd()) — proven by the full existing regression
 * suite passing unchanged.
 *
 * Because every persistence path (issues, repairs, diffs, snapshots, validation evidence, patch
 * containment) is derived from resolveRepoRoot(), running work inside a different workspace root
 * automatically and completely isolates that work's state on disk — no separate "workspace state"
 * system was built or is needed.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const workspaceRootStorage = new AsyncLocalStorage<string>()

/** Active workspace root override for the current async execution context, if any. */
export function getActiveWorkspaceRootOverride(): string | undefined {
  return workspaceRootStorage.getStore()
}

/**
 * Runs `fn` with `root` as the active workspace root for every resolveRepoRoot() call made
 * during its (possibly async) execution, including in code it calls. Does not mutate any global
 * — this is scoped strictly to the async context tree rooted at this call.
 */
export function runWithWorkspaceRoot<T>(root: string, fn: () => Promise<T> | T): Promise<T> | T {
  return workspaceRootStorage.run(root, fn)
}
