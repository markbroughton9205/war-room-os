/**
 * Shared Playwright Chromium resolution for Foundry browser verification.
 * Does not fake availability. HTTP fallback is not browser acceptance.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function playwrightBrowsersPath(): string {
  const homeCache = path.join(os.homedir(), '.cache', 'ms-playwright')
  if (existsSync(homeCache)) process.env.PLAYWRIGHT_BROWSERS_PATH = homeCache
  return process.env.PLAYWRIGHT_BROWSERS_PATH || homeCache
}

export function resolvePlaywrightChromiumExecutable(): string | undefined {
  const root = playwrightBrowsersPath()
  if (!existsSync(root)) return undefined
  let dirs: string[] = []
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return undefined
  }
  const ordered = [
    ...dirs.filter(name => name.startsWith('chromium-') && !name.includes('headless')),
    ...dirs.filter(name => name.startsWith('chromium_headless_shell-')),
  ]
  for (const dir of ordered) {
    const candidates = [
      path.join(root, dir, 'chrome-linux64', 'chrome'),
      path.join(root, dir, 'chrome-linux', 'chrome'),
      path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    ]
    const hit = candidates.find(candidate => existsSync(candidate))
    if (hit) return hit
  }
  return undefined
}

export async function loadPlaywrightChromium(): Promise<{
  chromium: typeof import('@playwright/test').chromium
  executablePath?: string
} | null> {
  const specs = ['@playwright/test', 'playwright', 'playwright-core'] as const
  for (const spec of specs) {
    try {
      const mod = await import(spec) as { chromium?: typeof import('@playwright/test').chromium }
      if (!mod.chromium) continue
      return {
        chromium: mod.chromium,
        executablePath: resolvePlaywrightChromiumExecutable(),
      }
    } catch {
      // try the next runtime module
    }
  }
  return null
}

export function playwrightChromiumAvailable(): boolean {
  return Boolean(resolvePlaywrightChromiumExecutable())
}

/**
 * Chromium must not inherit Electron's library path. The UI process is spawned
 * with ELECTRON_RUN_AS_NODE=1 from the War Room executable; Playwright children
 * otherwise load Electron's libc++/ffmpeg and die with SIGTRAP.
 */
export function chromiumChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ASAR',
    'ELECTRON_OZONE_PLATFORM_HINT',
    'LD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_AUDIT',
    'GIO_MODULE_DIR',
    'GTK_PATH',
    'CHROME_DESKTOP',
  ]) {
    delete env[key]
  }
  env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath()
  return env
}
