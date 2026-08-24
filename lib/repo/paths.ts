import path from 'node:path'
import { getActiveWorkspaceRootOverride } from './workspaceContext'

/**
 * Project root for repo operations: an active Phase B workspace-context override when one is set
 * (see workspaceContext.ts), else `REPO_ROOT` when set (absolute or relative), else
 * `process.cwd()` (matches `app/api/repo/scan` behavior). The override check is additive: with no
 * workspace context active — every existing caller, always, before Phase B — resolution is
 * byte-for-byte identical to the pre-Phase-B implementation.
 */
export function resolveRepoRoot(): string {
  const override = getActiveWorkspaceRootOverride()
  if (override) return override
  return resolveBaseRepoRoot()
}

/**
 * The process's own base repo root, ignoring any active workspace-context override. Used only for
 * data that must live in one fixed place regardless of which workspace is currently active — the
 * workspace registry itself.
 */
export function resolveBaseRepoRoot(): string {
  const raw = process.env.REPO_ROOT?.trim()
  if (!raw) return process.cwd()
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
}
