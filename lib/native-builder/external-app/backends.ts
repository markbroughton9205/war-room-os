import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from '../foundryPaths'
import type { ExternalBackendId } from './types'

const execFileAsync = promisify(execFile)

export function externalAppBackendScript(): string {
  const rel = path.join(resolveRepoRoot(), 'scripts', 'foundry', 'external-app-backend.py')
  return existsSync(rel) ? rel : path.join(process.cwd(), 'scripts', 'foundry', 'external-app-backend.py')
}

export async function externalPython(
  command: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync('python3', [externalAppBackendScript(), command, JSON.stringify(payload)], {
      timeout: timeoutMs,
      env: { ...process.env },
    })
    try {
      return JSON.parse(stdout) as Record<string, unknown>
    } catch {
      return { ok: false, error: stderr || stdout || 'external-app backend produced non-JSON' }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const BACKEND_CASCADE: ExternalBackendId[] = [
  'accessibility',
  'app-electron-debug',
  'wayland-portal',
  'vision',
]

export function screenshotDest(): string {
  const dirs = foundryDataHierarchy()
  return path.join(dirs.computerUse, `ext-${Date.now()}.png`)
}
