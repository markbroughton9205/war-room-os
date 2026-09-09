import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { resolveCorpusPaths } from '../crawler/corpus'
import {
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_LICENSE,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_REVISION,
  LOCAL_EMBEDDING_SOURCE,
  LOCAL_ONNX_SOURCE,
} from './types'

export const DEFAULT_MODELS_RELATIVE = ['.war-room', 'models'] as const
export const LOCAL_ONNX_REPO_ID = 'Xenova/bge-small-en-v1.5'

export type HybridPaths = {
  corpusRoot: string
  corpusDbPath: string
  vectorDbPath: string
  modelsDir: string
  localModelDir: string
}

export function resolveModelsDir(rootDir?: string): string {
  if (rootDir?.trim()) {
    return path.isAbsolute(rootDir) ? rootDir : path.resolve(resolveBaseRepoRoot(), rootDir)
  }
  return path.join(resolveBaseRepoRoot(), ...DEFAULT_MODELS_RELATIVE)
}

export function resolveHybridPaths(opts?: { corpusRoot?: string; modelsDir?: string }): HybridPaths {
  const corpus = resolveCorpusPaths(opts?.corpusRoot)
  const modelsDir = resolveModelsDir(opts?.modelsDir)
  return {
    corpusRoot: corpus.rootDir,
    corpusDbPath: corpus.dbPath,
    vectorDbPath: path.join(corpus.rootDir, 'vectors.sqlite'),
    modelsDir,
    localModelDir: path.join(modelsDir, ...LOCAL_ONNX_REPO_ID.split('/')),
  }
}

function findOnnxFile(root: string, depth = 0): boolean {
  if (depth > 6 || !existsSync(root)) return false
  try {
    if (statSync(root).isFile()) return /\.onnx$/i.test(root)
    for (const name of readdirSync(root)) {
      if (name.startsWith('.') && name !== '.cache') continue
      if (findOnnxFile(path.join(root, name), depth + 1)) return true
    }
  } catch {
    return false
  }
  return false
}

export function localOnnxModelPresent(modelDir?: string): boolean {
  const resolved = modelDir ?? resolveHybridPaths().localModelDir
  const roots = Array.from(new Set([resolved, path.dirname(resolved)]))
  return roots.some(root => {
    const candidates = [
      path.join(root, 'onnx', 'model_quantized.onnx'),
      path.join(root, 'onnx', 'model.onnx'),
      path.join(root, 'model_quantized.onnx'),
      path.join(root, 'Xenova', 'bge-small-en-v1.5', 'onnx', 'model_quantized.onnx'),
    ]
    return candidates.some(file => existsSync(file)) || findOnnxFile(root)
  })
}

export function localModelGovernance() {
  return {
    model: LOCAL_EMBEDDING_MODEL_ID,
    onnxRepo: LOCAL_ONNX_REPO_ID,
    officialSource: LOCAL_EMBEDDING_SOURCE,
    onnxSource: LOCAL_ONNX_SOURCE,
    license: LOCAL_EMBEDDING_LICENSE,
    commercialUse: true,
    approximateDownloadBytes: 34_000_000,
    expectedRuntimeMemoryBytes: 250_000_000,
    dimensions: LOCAL_EMBEDDING_DIMENSIONS,
    revision: LOCAL_EMBEDDING_REVISION,
    inferenceBackend: 'native onnxruntime-node 1.24.3 CPU via @huggingface/transformers; not WASM',
    storageLocation: resolveHybridPaths().localModelDir,
    gitignored: true,
  }
}
