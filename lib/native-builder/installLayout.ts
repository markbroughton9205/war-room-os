/**
 * Per-user install layout. New installs use a SPACE-FREE app tree name: Chromium builds the
 * SUID sandbox helper command by splitting its path on spaces, so a helper under
 * `.../opt/War Room OS/chrome-sandbox` aborts native sandbox startup. Older installs keep the
 * legacy spaced directory and stay resolvable.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

export const APP_TREE_DIRNAME = 'War-Room-OS'
export const LEGACY_APP_TREE_DIRNAME = 'War Room OS'

/** Directory that holds war-room-os, chrome-sandbox and resources for an install. */
export function installedAppTreeDir(installDir: string): string {
  const current = path.join(installDir, 'opt', APP_TREE_DIRNAME)
  if (existsSync(current)) return current
  const legacy = path.join(installDir, 'opt', LEGACY_APP_TREE_DIRNAME)
  return existsSync(legacy) ? legacy : current
}
