/**
 * #22 Phase 11C — Application data paths (not repo / .next / public).
 * Override via WAR_ROOM_LOCAL_DATA_DIR for isolated tests.
 *
 * Canonical algorithm lives in ./appDataRoot.cjs (shared with Electron desktop/src/appDataRoot.cjs).
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

export type LocalAppDataPaths = {
  root: string
  data: string
  logs: string
  cache: string
  exports: string
  runtime: string
  dbPath: string
}

const require = createRequire(import.meta.url)
const impl = require('./appDataRoot.cjs') as {
  resolveAppDataRoot: (options?: { override?: string | null }) => string
  resolveAppDataPaths: (options?: { override?: string | null }) => {
    root: string
    data: string
    logs: string
    cache: string
    exports: string
    runtime: string
  }
}

export function resolveLocalAppDataRoot(override?: string | null): string {
  return impl.resolveAppDataRoot(override == null ? undefined : { override })
}

export function resolveLocalAppDataPaths(override?: string | null): LocalAppDataPaths {
  const resolved = impl.resolveAppDataPaths(override == null ? undefined : { override })
  return {
    ...resolved,
    dbPath: path.join(resolved.data, 'local-ownership.sqlite'),
  }
}

export function ensureLocalAppDataDirs(paths: LocalAppDataPaths): void {
  for (const dir of [paths.root, paths.data, paths.logs, paths.cache, paths.exports, paths.runtime]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Best-effort restrictive mode on POSIX; Windows ACL left to OS defaults. */
export function tightenFileMode(filePath: string): void {
  try {
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
  } catch {
    /* best-effort */
  }
}
