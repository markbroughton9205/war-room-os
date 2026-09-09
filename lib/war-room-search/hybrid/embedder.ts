import path from 'node:path'
import {
  FAKE_EMBEDDING_DIMENSIONS,
  FAKE_EMBEDDING_MODEL_ID,
  FAKE_EMBEDDING_REVISION,
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_LICENSE,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_REVISION,
  LOCAL_EMBEDDING_SOURCE,
  LOCAL_QUERY_PREFIX,
  type Embedder,
  type EmbeddingModelInfo,
} from './types'
import { LOCAL_ONNX_REPO_ID, localOnnxModelPresent, resolveHybridPaths } from './modelStore'

const CONCEPT_GROUPS: string[][] = [
  ['semiconductor', 'chip', 'chips', 'processor', 'processors', 'lithography', 'foundry', 'foundries'],
  ['export', 'exports', 'overseas', 'abroad', 'foreign', 'international'],
  ['control', 'controls', 'restriction', 'restrictions', 'limit', 'limits', 'ban', 'rules'],
  ['freight', 'trucking', 'brokerage', 'logistics', 'cargo', 'shipment', 'shipments'],
  ['hurricane', 'storm', 'rainfall', 'weather', 'flood'],
  ['zxqplorbit'],
]

type FeatureExtractor = (
  texts: string[] | string,
  opts?: Record<string, unknown>,
) => Promise<{ data: Float32Array; dims: number[] }>

function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm
  return out
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(token => token.length > 1)
}

export function textsForEmbedding(texts: string[], kind: 'query' | 'document'): string[] {
  if (kind === 'query') return texts.map(text => `${LOCAL_QUERY_PREFIX}${text}`)
  return texts
}

let sharedQueryEmbedder: Embedder | null = null
let sharedQueryEmbedderKey = ''

export function getSharedQueryEmbedder(opts?: { modelsDir?: string }): Embedder {
  const key = opts?.modelsDir?.trim() || ''
  if (sharedQueryEmbedder && sharedQueryEmbedderKey === key) return sharedQueryEmbedder
  sharedQueryEmbedder = createQueryEmbedder({ allowDownload: false, modelsDir: opts?.modelsDir })
  sharedQueryEmbedderKey = key
  return sharedQueryEmbedder
}

export function resetSharedQueryEmbedder(): void {
  sharedQueryEmbedder = null
  sharedQueryEmbedderKey = ''
}

export function sharedQueryEmbedderInstanceCount(): number {
  return sharedQueryEmbedder ? 1 : 0
}

export function createFakeEmbedder(overrides?: Partial<EmbeddingModelInfo>): Embedder {
  const info: EmbeddingModelInfo = {
    modelId: FAKE_EMBEDDING_MODEL_ID,
    revision: FAKE_EMBEDDING_REVISION,
    dimensions: FAKE_EMBEDDING_DIMENSIONS,
    backend: 'fake',
    license: 'test',
    source: 'war-room-test',
    ...overrides,
  }
  return {
    available: true,
    info,
    unavailableReason: null,
    async embed(texts: string[]) {
      return texts.map(text => {
        const vector = new Float32Array(info.dimensions)
        const tokens = tokenize(text)
        for (const [groupIndex, group] of CONCEPT_GROUPS.entries()) {
          if (groupIndex >= vector.length) break
          if (tokens.some(token => group.includes(token))) vector[groupIndex] = 1
        }
        for (const token of tokens) {
          let hash = 2166136261
          for (let i = 0; i < token.length; i += 1) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619)
          const slot = 6 + (Math.abs(hash) % Math.max(1, info.dimensions - 6))
          vector[slot] += 0.15
        }
        return l2Normalize(vector)
      })
    },
  }
}

export function createUnavailableEmbedder(reason = 'SEMANTIC_UNAVAILABLE'): Embedder {
  return {
    available: false,
    info: {
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      revision: LOCAL_EMBEDDING_REVISION,
      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
      backend: 'unavailable',
      license: LOCAL_EMBEDDING_LICENSE,
      source: LOCAL_EMBEDDING_SOURCE,
    },
    unavailableReason: reason,
    async embed() {
      throw new Error(reason)
    },
  }
}

export function createQueryEmbedder(opts?: { modelsDir?: string; allowDownload?: boolean }): Embedder {
  if (opts?.allowDownload) {
    throw new Error('Query-time model download is forbidden. Use sovereign-search:prepare-embeddings.')
  }
  const paths = resolveHybridPaths({ modelsDir: opts?.modelsDir })
  if (!localOnnxModelPresent(paths.localModelDir)) {
    return createUnavailableEmbedder('SEMANTIC_UNAVAILABLE')
  }
  return createLocalOnnxEmbedder({ modelsDir: paths.modelsDir, allowRemote: false })
}

export function createLocalOnnxEmbedder(opts: { modelsDir: string; allowRemote: boolean }): Embedder {
  let pipelinePromise: Promise<FeatureExtractor> | null = null
  const modelDir = path.join(opts.modelsDir, ...LOCAL_ONNX_REPO_ID.split('/'))
  return {
    available: localOnnxModelPresent(modelDir),
    info: {
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      revision: LOCAL_EMBEDDING_REVISION,
      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
      backend: 'local_onnx',
      license: LOCAL_EMBEDDING_LICENSE,
      source: LOCAL_EMBEDDING_SOURCE,
    },
    unavailableReason: localOnnxModelPresent(modelDir) ? null : 'SEMANTIC_UNAVAILABLE',
    async embed(texts, kind) {
      if (opts.allowRemote) {
        throw new Error('Remote model fetch is not allowed on the search path.')
      }
      if (!localOnnxModelPresent(modelDir)) {
        throw new Error('SEMANTIC_UNAVAILABLE')
      }
      const run = await (pipelinePromise ??= loadOnnxPipeline(opts.modelsDir))
      const prefixed = textsForEmbedding(texts, kind)
      const output = await run(prefixed, { pooling: 'mean', normalize: true })
      const dims = output.dims
      if (dims.length === 1) return [Float32Array.from(output.data)]
      const rows = dims[0] ?? texts.length
      const width = dims[1] ?? LOCAL_EMBEDDING_DIMENSIONS
      const vectors: Float32Array[] = []
      for (let i = 0; i < rows; i += 1) {
        vectors.push(output.data.slice(i * width, (i + 1) * width))
      }
      return vectors
    },
  }
}

async function loadOnnxPipeline(modelsDir: string): Promise<FeatureExtractor> {
  const transformers = await import('@huggingface/transformers') as {
    env: {
      allowRemoteModels: boolean
      allowLocalModels: boolean
      localModelPath: string
      cacheDir: string
    }
    pipeline: (
      task: string,
      model: string,
      opts?: Record<string, unknown>,
    ) => Promise<FeatureExtractor>
  }
  transformers.env.allowRemoteModels = false
  transformers.env.allowLocalModels = true
  transformers.env.localModelPath = modelsDir
  transformers.env.cacheDir = modelsDir
  return transformers.pipeline('feature-extraction', LOCAL_ONNX_REPO_ID, {
    local_files_only: true,
    dtype: 'q8',
  })
}
