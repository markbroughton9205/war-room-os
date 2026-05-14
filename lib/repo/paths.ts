import path from 'node:path'

/**
 * Project root for repo operations: `REPO_ROOT` when set (absolute or relative),
 * otherwise `process.cwd()` (matches `app/api/repo/scan` behavior).
 */
export function resolveRepoRoot(): string {
  const raw = process.env.REPO_ROOT?.trim()
  if (!raw) return process.cwd()
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
}
