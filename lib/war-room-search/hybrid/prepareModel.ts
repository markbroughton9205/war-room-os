import { mkdirSync } from 'node:fs'
import { LOCAL_ONNX_REPO_ID, localModelGovernance, localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { LOCAL_EMBEDDING_LICENSE, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_SOURCE } from './types'

export type PrepareEmbeddingsResult = {
  ok: boolean
  skipped: boolean
  reason: string
  modelDir: string
  governance: ReturnType<typeof localModelGovernance>
}

export async function prepareLocalEmbeddingModel(opts?: {
  modelsDir?: string
  allowDownload?: boolean
}): Promise<PrepareEmbeddingsResult> {
  const allowDownload = opts?.allowDownload === true
  const paths = resolveHybridPaths({ modelsDir: opts?.modelsDir })
  const governance = localModelGovernance()
  mkdirSync(paths.localModelDir, { recursive: true })
  if (localOnnxModelPresent(paths.localModelDir)) {
    return { ok: true, skipped: true, reason: 'already_present', modelDir: paths.localModelDir, governance }
  }
  if (!allowDownload) {
    return {
      ok: false,
      skipped: true,
      reason: 'Model is absent. Run pnpm run sovereign-search:prepare-embeddings to download it explicitly.',
      modelDir: paths.localModelDir,
      governance,
    }
  }
  if (governance.license !== 'MIT' || LOCAL_EMBEDDING_LICENSE !== 'MIT') {
    throw new Error(`Refusing to download: license is ${governance.license}, expected MIT.`)
  }
  const transformers = await import('@huggingface/transformers') as {
    env: { allowRemoteModels: boolean; allowLocalModels: boolean; cacheDir: string; localModelPath: string }
    pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>
  }
  transformers.env.allowRemoteModels = true
  transformers.env.allowLocalModels = true
  transformers.env.cacheDir = paths.modelsDir
  transformers.env.localModelPath = paths.modelsDir
  await transformers.pipeline('feature-extraction', LOCAL_ONNX_REPO_ID, { dtype: 'q8' })
  if (!localOnnxModelPresent(paths.localModelDir) && !localOnnxModelPresent(paths.modelsDir)) {
    return {
      ok: false,
      skipped: false,
      reason: `Download finished but ONNX files were not found under ${paths.localModelDir}`,
      modelDir: paths.localModelDir,
      governance,
    }
  }
  return {
    ok: true,
    skipped: false,
    reason: `Downloaded ${LOCAL_EMBEDDING_MODEL_ID} (${LOCAL_EMBEDDING_SOURCE})`,
    modelDir: paths.localModelDir,
    governance,
  }
}
