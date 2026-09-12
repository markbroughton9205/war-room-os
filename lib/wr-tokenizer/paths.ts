/**
 * Canonical WR-TOKENIZER storage under sovereign AppData — never the Mac dump, never git.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'

export type WrTokenizerPaths = {
  appRoot: string
  data: string
  root: string
  historical: string
  tokenizerJson: string
  trainingManifest: string
  importManifest: string
  benchmarks: string
  decisionPath: string
}

export function resolveWrTokenizerPaths(dataDirOverride?: string | null): WrTokenizerPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wr-tokenizer')
  const historical = path.join(root, 'WR-TOKENIZER-0')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    historical,
    tokenizerJson: path.join(historical, 'tokenizer.json'),
    trainingManifest: path.join(historical, 'training-manifest.json'),
    importManifest: path.join(historical, 'import-manifest.json'),
    benchmarks: path.join(root, 'benchmarks'),
    decisionPath: path.join(root, 'decision.json'),
  }
}

export function ensureWrTokenizerDirs(paths: WrTokenizerPaths): void {
  for (const dir of [paths.root, paths.historical, paths.benchmarks]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
