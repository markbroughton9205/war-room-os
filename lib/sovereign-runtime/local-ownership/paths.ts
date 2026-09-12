/**
 * #22 Phase 11C — Application data paths (not repo / .next / public).
 * Override via WAR_ROOM_LOCAL_DATA_DIR for isolated tests.
 */
import fs from 'node:fs'
import os from 'node:os'
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

export function resolveLocalAppDataRoot(override?: string | null): string {
  const env = override?.trim() || process.env.WAR_ROOM_LOCAL_DATA_DIR?.trim()
  if (env) return path.resolve(env)

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'War Room OS')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'War Room OS')
  }
  return path.join(os.homedir(), '.local', 'share', 'war-room-os')
}

export function resolveLocalAppDataPaths(override?: string | null): LocalAppDataPaths {
  const root = resolveLocalAppDataRoot(override)
  const data = path.join(root, 'data')
  return {
    root,
    data,
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
    exports: path.join(root, 'exports'),
    runtime: path.join(root, 'runtime'),
    dbPath: path.join(data, 'local-ownership.sqlite'),
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
