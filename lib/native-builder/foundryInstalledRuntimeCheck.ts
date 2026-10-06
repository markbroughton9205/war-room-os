/**
 * The one disconfirmation probe that runs automatically inside a mission: "the source and its tests pass, but does
 * the actual installed runtime match the source?" Reads the per-user launcher to find which install is active, then
 * compares that install's copy of the file byte-for-byte against the repo's own copy. Never writes anything.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import type { ProbeOutcome } from './foundryDisconfirmation'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function defaultLauncherPath(): string {
  return path.join(os.homedir(), '.local/bin/war-room-os-user')
}

/** The install directory the per-user launcher currently execs, or null if there is none (no desktop install active).
 *  `launcherPath` is only ever overridden by validators, to prove the parsing without touching the real home directory. */
export function activeInstallDir(launcherPath: string = defaultLauncherPath()): string | null {
  if (!existsSync(launcherPath)) return null
  const text = readFileSync(launcherPath, 'utf8')
  const match = text.match(/"(\/[^"]*\/opt\/[^"/]+\/opt\/War-Room-OS\/war-room-os)"/)
  if (!match) return null
  return path.dirname(match[1])
}

/** Whether an active install exists at all — cheap, used to decide whether this probe applies before running it. */
export function installedRuntimeAvailable(launcherPath?: string): boolean {
  return activeInstallDir(launcherPath) !== null
}

/** Compares one repo-relative file's text against the same path inside the active install's bundled UI runtime. */
export function checkInstalledRuntimeMatches(repoRelativeFile: string, repoText: string, launcherPath?: string): ProbeOutcome {
  const installDir = activeInstallDir(launcherPath)
  if (!installDir) return { ran: false, reason: 'no active desktop install to compare against' }
  const installedPath = path.join(installDir, 'resources/runtime/ui', repoRelativeFile)
  if (!existsSync(installedPath)) return { ran: false, reason: `the active install has no copy of ${repoRelativeFile}` }
  const installedText = readFileSync(installedPath, 'utf8')
  const matches = sha256(installedText) === sha256(repoText)
  return { ran: true, passed: matches, detail: matches ? 'installed copy matches source' : `${repoRelativeFile} differs between source and the active install — a fresh runtime has not been built since this change` }
}
