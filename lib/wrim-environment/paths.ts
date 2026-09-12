import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'

export type WrimEnvironmentPaths = {
  appRoot: string
  data: string
  root: string
  reportPath: string
  manifestPath: string
  venvPython: string
  venvRoot: string
}

export function resolveWrimEnvironmentPaths(dataDirOverride?: string | null): WrimEnvironmentPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wrim-environment')
  const venvRoot = path.join(app.root, 'venvs', 'wrim-pytorch')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    reportPath: path.join(root, 'stage0-report.json'),
    manifestPath: path.join(root, 'environment-manifest.json'),
    venvRoot,
    venvPython: path.join(venvRoot, 'Scripts', 'python.exe'),
  }
}

export function ensureWrimEnvironmentDirs(paths: WrimEnvironmentPaths): void {
  fs.mkdirSync(paths.root, { recursive: true })
}
