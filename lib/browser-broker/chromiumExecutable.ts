import { existsSync } from 'node:fs'
import { resolvePlaywrightChromiumExecutable } from '@/lib/native-builder/foundryPlaywright'

export type BrokerChromiumSource = 'PLAYWRIGHT_CACHE' | 'EXPLICIT_ENV' | 'SYSTEM_CHROME' | 'NONE'

const SYSTEM_CANDIDATES = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/**
 * Which Chromium the browser broker launches. Order: the Playwright cache (the supported install), an explicit
 * WAR_ROOM_BROWSER_EXECUTABLE the operator configured, then an already-installed system Chrome/Chromium. The broker always launches it
 * headless with its own throw-away profile, never the user's profile. The source is reported in diagnostics so the choice is visible.
 */
export function resolveBrokerChromium(): { path: string | undefined; source: BrokerChromiumSource } {
  const cached = resolvePlaywrightChromiumExecutable()
  if (cached && existsSync(cached)) return { path: cached, source: 'PLAYWRIGHT_CACHE' }
  const explicit = process.env.WAR_ROOM_BROWSER_EXECUTABLE?.trim()
  if (explicit && existsSync(explicit)) return { path: explicit, source: 'EXPLICIT_ENV' }
  for (const candidate of SYSTEM_CANDIDATES) if (existsSync(candidate)) return { path: candidate, source: 'SYSTEM_CHROME' }
  return { path: undefined, source: 'NONE' }
}
