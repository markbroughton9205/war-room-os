import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureLocalAppDataDirs, resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { foundryDataHierarchy } from '@/lib/native-builder/foundryPaths'

export type BrowserBrokerDataDirs = {
  root: string
  downloads: string
  screenshots: string
  pdfs: string
  foundryProfile: string
  foundryDownloads: string
  foundryScreenshots: string
}

export function browserBrokerDataDirs(): BrowserBrokerDataDirs {
  const app = resolveLocalAppDataPaths()
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'browser-broker')
  const foundry = foundryDataHierarchy()
  const dirs: BrowserBrokerDataDirs = {
    root,
    downloads: path.join(root, 'downloads'),
    screenshots: path.join(root, 'screenshots'),
    pdfs: path.join(root, 'pdfs'),
    foundryProfile: foundry.browserProfile,
    foundryDownloads: foundry.browserDownloads,
    foundryScreenshots: foundry.screenshots,
  }
  for (const dir of [dirs.root, dirs.downloads, dirs.screenshots, dirs.pdfs, dirs.foundryProfile, dirs.foundryDownloads, dirs.foundryScreenshots]) {
    mkdirSync(dir, { recursive: true })
  }
  return dirs
}

/**
 * Playwright creates Chromium --user-data-dir under os.tmpdir() in the Node process,
 * not the child env. This machine's /tmp is quota-limited (EDQUOTA) even when df
 * shows free space, which makes Page.captureScreenshot fail and can disconnect Chromium.
 * Chromium also aborts if the SingletonSocket path exceeds AF_UNIX sun_path, so the
 * replacement tmpdir must be short (XDG_RUNTIME_DIR), not the long app-data path.
 */
export function playwrightTmpDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR
  const base = runtime && runtime.startsWith('/run/') && runtime.length < 40
    ? path.join(runtime, 'wrb')
    : path.join(os.homedir(), '.w', 'b')
  mkdirSync(base, { recursive: true })
  return base
}

export async function withPlaywrightTmpDir<T>(fn: () => Promise<T>): Promise<T> {
  const tmp = playwrightTmpDir()
  const prev = {
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  }
  process.env.TMPDIR = tmp
  process.env.TMP = tmp
  process.env.TEMP = tmp
  try {
    if (os.tmpdir() !== tmp) {
      process.env.TMPDIR = tmp
    }
    return await fn()
  } finally {
    restoreEnv('TMPDIR', prev.TMPDIR)
    restoreEnv('TMP', prev.TMP)
    restoreEnv('TEMP', prev.TEMP)
  }
}

function restoreEnv(key: 'TMPDIR' | 'TMP' | 'TEMP', value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
