/**
 * Canonical WR-CORPUS storage under sovereign AppData — never the install dir, never git.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'

export type WrCorpusPaths = {
  appRoot: string
  data: string
  root: string
  artifacts: string
  corpus0: string
  corpus1: string
  dbPath: string
  exports: string
}

export function resolveWrCorpusPaths(dataDirOverride?: string | null): WrCorpusPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wr-corpus')
  const artifacts = path.join(root, 'artifacts')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    artifacts,
    corpus0: path.join(artifacts, 'WR-CORPUS-0'),
    corpus1: path.join(artifacts, 'WR-CORPUS-1'),
    dbPath: path.join(root, 'wr-corpus.sqlite'),
    exports: path.join(app.exports, 'wr-corpus'),
  }
}

export function ensureWrCorpusDirs(paths: WrCorpusPaths): void {
  for (const dir of [paths.root, paths.artifacts, paths.corpus0, paths.corpus1, paths.exports]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
