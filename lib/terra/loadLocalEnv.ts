import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load named keys from `.env.local` into process.env when they are not already
 * set. Never logs values. Only the camera-key names this federation uses are
 * copied — the file is not dumped.
 */
const CAMERA_ENV_NAMES = ['OHGO_API_KEY', '511NY_API_KEY'] as const

export function loadCameraKeysFromLocalEnv(cwd = process.cwd()): { loadedFromFile: boolean; present: Record<(typeof CAMERA_ENV_NAMES)[number], boolean> } {
  const path = resolve(cwd, '.env.local')
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const name = trimmed.slice(0, eq).trim()
      if (!(CAMERA_ENV_NAMES as readonly string[]).includes(name)) continue
      if (process.env[name]?.trim()) continue
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (value) process.env[name] = value
    }
  }
  return {
    loadedFromFile: existsSync(path),
    present: {
      OHGO_API_KEY: Boolean(process.env.OHGO_API_KEY?.trim()),
      '511NY_API_KEY': Boolean(process.env['511NY_API_KEY']?.trim()),
    },
  }
}
