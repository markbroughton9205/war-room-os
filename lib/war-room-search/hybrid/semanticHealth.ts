import { existsSync, statSync } from 'node:fs'
import { SovereignCorpus } from '../crawler/corpus'
import {
  ANN_RECONSIDER_CHUNKS,
  ANN_RECONSIDER_INDEX_BYTES,
  BRUTE_FORCE_CHUNK_WARN,
  BRUTE_FORCE_INDEX_BYTES_WARN,
  CHUNKING_VERSION,
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_REVISION,
  SEMANTIC_QUERY_MS_WARN,
  type HybridSearchResult,
  type LocalSemanticHealth,
  type LocalSemanticStatus,
} from './types'
import { localModelGovernance, localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { SqliteVectorStore } from './vectors'

export function resourceGuardrails(input: { indexedChunkCount: number; vectorIndexBytes: number; semanticQueryMs?: number | null }): {
  bruteForceWarning: boolean
  annReconsider: boolean
} {
  const bruteForceWarning = input.indexedChunkCount >= BRUTE_FORCE_CHUNK_WARN
    || input.vectorIndexBytes >= BRUTE_FORCE_INDEX_BYTES_WARN
    || (typeof input.semanticQueryMs === 'number' && input.semanticQueryMs >= SEMANTIC_QUERY_MS_WARN)
  const annReconsider = input.indexedChunkCount >= ANN_RECONSIDER_CHUNKS
    || input.vectorIndexBytes >= ANN_RECONSIDER_INDEX_BYTES
  return { bruteForceWarning, annReconsider }
}

export function emptyLocalSemanticHealth(status: LocalSemanticStatus, reason: string | null = null): LocalSemanticHealth {
  const governance = localModelGovernance()
  return {
    status,
    reason,
    modelId: LOCAL_EMBEDDING_MODEL_ID,
    revision: LOCAL_EMBEDDING_REVISION,
    dimensions: LOCAL_EMBEDDING_DIMENSIONS,
    chunkVersion: CHUNKING_VERSION,
    indexedDocumentCount: null,
    indexedChunkCount: null,
    staleEmbeddingCount: null,
    vectorIndexBytes: null,
    semanticQueryMs: null,
    bruteForceWarning: false,
    annReconsider: false,
    inferenceBackend: governance.inferenceBackend,
  }
}

export function inspectLocalSemanticHealth(opts?: {
  corpusRoot?: string
  modelsDir?: string
  env?: Record<string, string | undefined>
  queryResult?: Pick<HybridSearchResult, 'semanticQueryMs' | 'staleEmbeddingCount' | 'indexedChunkCount' | 'indexedDocumentCount' | 'vectorIndexBytes' | 'semanticAvailable' | 'semanticReason' | 'usedFallback'>
}): LocalSemanticHealth {
  const env = opts?.env ?? process.env
  if (/^(1|true|yes)$/i.test(env.WAR_ROOM_LOCAL_SEARCH_DISABLED ?? '')) {
    return emptyLocalSemanticHealth('disabled', 'WAR_ROOM_LOCAL_DISABLED')
  }

  const paths = resolveHybridPaths({ corpusRoot: opts?.corpusRoot, modelsDir: opts?.modelsDir })
  const governance = localModelGovernance()
  const modelPresent = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
  const vectorIndexBytes = existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0

  if (!modelPresent && opts?.queryResult?.semanticAvailable !== true) {
    return {
      ...emptyLocalSemanticHealth('modelMissing', 'SEMANTIC_UNAVAILABLE'),
      vectorIndexBytes,
    }
  }

  if (!existsSync(paths.vectorDbPath) && opts?.queryResult?.indexedChunkCount == null) {
    return {
      ...emptyLocalSemanticHealth('indexMissing', 'VECTOR_INDEX_MISSING'),
      vectorIndexBytes: 0,
    }
  }

  const fromQuery = opts?.queryResult
  if (fromQuery && fromQuery.indexedChunkCount != null) {
    const indexedChunkCount = fromQuery.indexedChunkCount
    const indexedDocumentCount = fromQuery.indexedDocumentCount
    const staleEmbeddingCount = fromQuery.staleEmbeddingCount
    const semanticQueryMs = fromQuery.semanticQueryMs
    const { bruteForceWarning, annReconsider } = resourceGuardrails({
      indexedChunkCount,
      vectorIndexBytes: fromQuery.vectorIndexBytes || vectorIndexBytes,
      semanticQueryMs,
    })
    let status: LocalSemanticStatus = 'available'
    let reason: string | null = null
    if (fromQuery.usedFallback === 'fts_vector_error') {
      status = 'error'
      reason = fromQuery.semanticReason
    } else if (fromQuery.semanticReason === 'VECTOR_INDEX_CORRUPT') {
      status = 'corrupt'
      reason = fromQuery.semanticReason
    } else if (fromQuery.semanticReason === 'VECTOR_INDEX_MISSING') {
      status = 'indexMissing'
      reason = fromQuery.semanticReason
    } else if (indexedChunkCount === 0) {
      status = 'indexMissing'
      reason = 'VECTOR_INDEX_EMPTY'
    } else if (staleEmbeddingCount > 0) {
      status = 'stale'
      reason = `STALE_EMBEDDINGS:${staleEmbeddingCount}`
    }
    return {
      status,
      reason,
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      revision: LOCAL_EMBEDDING_REVISION,
      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
      chunkVersion: CHUNKING_VERSION,
      indexedDocumentCount,
      indexedChunkCount,
      staleEmbeddingCount,
      vectorIndexBytes: fromQuery.vectorIndexBytes || vectorIndexBytes,
      semanticQueryMs,
      bruteForceWarning,
      annReconsider,
      inferenceBackend: governance.inferenceBackend,
    }
  }

  const opened = SqliteVectorStore.tryOpen(paths.vectorDbPath)
  if (opened === 'missing') {
    return emptyLocalSemanticHealth('indexMissing', 'VECTOR_INDEX_MISSING')
  }
  if (opened === 'corrupt') {
    return emptyLocalSemanticHealth('corrupt', 'VECTOR_INDEX_CORRUPT')
  }

  try {
    const corpus = new SovereignCorpus(opts?.corpusRoot ?? paths.corpusRoot)
    try {
      const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
      const staleEmbeddingCount = opts?.queryResult?.staleEmbeddingCount ?? opened.listStaleEmbeddings(hashes).length
      const indexedChunkCount = opts?.queryResult?.indexedChunkCount ?? opened.countChunks()
      const indexedDocumentCount = opts?.queryResult?.indexedDocumentCount ?? opened.countIndexedDocuments()
      const revisionMismatches = opened.countRevisionMismatches(LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_REVISION)
      const semanticQueryMs = opts?.queryResult?.semanticQueryMs ?? null
      const { bruteForceWarning, annReconsider } = resourceGuardrails({ indexedChunkCount, vectorIndexBytes, semanticQueryMs })

      let status: LocalSemanticStatus = 'available'
      let reason: string | null = null
      if (opts?.queryResult?.usedFallback === 'fts_vector_error') {
        status = 'error'
        reason = opts.queryResult.semanticReason
      } else if (opts?.queryResult?.semanticReason === 'VECTOR_INDEX_CORRUPT') {
        status = 'corrupt'
        reason = opts.queryResult.semanticReason
      } else if (indexedChunkCount === 0) {
        status = 'indexMissing'
        reason = 'VECTOR_INDEX_EMPTY'
      } else if (staleEmbeddingCount > 0) {
        status = 'stale'
        reason = `STALE_EMBEDDINGS:${staleEmbeddingCount}`
      } else if (revisionMismatches > 0) {
        status = 'stale'
        reason = `MODEL_REVISION_MISMATCH:${revisionMismatches}`
      }

      return {
        status,
        reason,
        modelId: LOCAL_EMBEDDING_MODEL_ID,
        revision: LOCAL_EMBEDDING_REVISION,
        dimensions: LOCAL_EMBEDDING_DIMENSIONS,
        chunkVersion: CHUNKING_VERSION,
        indexedDocumentCount,
        indexedChunkCount,
        staleEmbeddingCount,
        vectorIndexBytes,
        semanticQueryMs,
        bruteForceWarning,
        annReconsider,
        inferenceBackend: governance.inferenceBackend,
      }
    } finally {
      corpus.close()
    }
  } finally {
    opened.close()
  }
}
