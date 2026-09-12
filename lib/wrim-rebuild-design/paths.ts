/**
 * Design reports under AppData. Never copies checkpoint trees.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'

export type WrimRebuildDesignPaths = {
  appRoot: string
  data: string
  root: string
  reportPath: string
}

export function resolveWrimRebuildDesignPaths(dataDirOverride?: string | null): WrimRebuildDesignPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wrim-rebuild-design')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    reportPath: path.join(root, 'training-design-report.json'),
  }
}

export function ensureWrimRebuildDesignDirs(paths: WrimRebuildDesignPaths): void {
  fs.mkdirSync(paths.root, { recursive: true })
}
