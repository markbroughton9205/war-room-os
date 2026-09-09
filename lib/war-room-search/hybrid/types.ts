import type { CrawlDocumentRecord } from '../crawler/types'
import type { LocalLexicalPlan } from '../crawler/lexicalPlan'

export const CHUNKING_VERSION = 'wr-chunk-v1'
export const TARGET_CHUNK_CHARS = 720
export const CHUNK_OVERLAP_CHARS = 80
export const MAX_CHUNK_CHARS = 1100
export const RRF_K = 60

export const LOCAL_EMBEDDING_MODEL_ID = 'BAAI/bge-small-en-v1.5'
export const LOCAL_EMBEDDING_REVISION = 'xenova-onnx-q8'
export const LOCAL_EMBEDDING_DIMENSIONS = 384
export const LOCAL_EMBEDDING_LICENSE = 'MIT'
export const LOCAL_EMBEDDING_SOURCE = 'https://huggingface.co/BAAI/bge-small-en-v1.5'
export const LOCAL_ONNX_SOURCE = 'https://huggingface.co/Xenova/bge-small-en-v1.5'
export const LOCAL_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export const FAKE_EMBEDDING_MODEL_ID = 'war-room/fake-concept-v1'
export const FAKE_EMBEDDING_REVISION = 'test-v1'
export const FAKE_EMBEDDING_DIMENSIONS = 16

export type EmbeddingBackend = 'local_onnx' | 'fake' | 'unavailable'
export type HybridRetrievalMode = 'fts' | 'semantic' | 'hybrid'
export type LocalRetrievalMode = 'FTS_ONLY' | 'SEMANTIC_ONLY' | 'HYBRID_RRF' | 'FTS_FALLBACK'
export type LocalSemanticStatus =
  | 'available'
  | 'modelMissing'
  | 'indexMissing'
  | 'stale'
  | 'corrupt'
  | 'disabled'
  | 'error'

export const BRUTE_FORCE_CHUNK_WARN = 10_000
export const BRUTE_FORCE_INDEX_BYTES_WARN = 64 * 1024 * 1024
export const ANN_RECONSIDER_CHUNKS = 50_000
export const ANN_RECONSIDER_INDEX_BYTES = 256 * 1024 * 1024
export const SEMANTIC_QUERY_MS_WARN = 500

export type LocalRetrievalSignals = {
  lexicalRank: number | null
  lexicalScore: number | null
  semanticRank: number | null
  semanticScore: number | null
  fusionRank: number | null
  fusionScore: number | null
  matchedChunkId: string | null
  mode: LocalRetrievalMode
}

export type LocalSemanticHealth = {
  status: LocalSemanticStatus
  reason: string | null
  modelId: string | null
  revision: string | null
  dimensions: number | null
  chunkVersion: string | null
  indexedDocumentCount: number | null
  indexedChunkCount: number | null
  staleEmbeddingCount: number | null
  vectorIndexBytes: number | null
  semanticQueryMs: number | null
  bruteForceWarning: boolean
  annReconsider: boolean
  inferenceBackend: string | null
}

export type EmbeddingModelInfo = {
  modelId: string
  revision: string
  dimensions: number
  backend: EmbeddingBackend
  license: string
  source: string
}

export type DocumentChunk = {
  chunkId: string
  documentId: number
  canonicalUrl: string
  publisher: string
  contentHash: string
  chunkOrdinal: number
  charStart: number
  charEnd: number
  text: string
  chunkingVersion: string
}

export type StoredEmbedding = {
  chunkId: string
  embeddingModel: string
  embeddingRevision: string
  dimensions: number
  chunkingVersion: string
  contentHash: string
  vector: Float32Array
  createdAt: string
}

export type Embedder = {
  available: boolean
  info: EmbeddingModelInfo
  unavailableReason: string | null
  embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]>
}

export type HybridSearchHit = {
  document: CrawlDocumentRecord
  fusionRank: number
  fusionScore: number
  lexicalRank: number | null
  semanticRank: number | null
  lexicalScore: number | null
  semanticScore: number | null
  matchedChunkId: string | null
  matchedChunkText: string | null
  snippet: string
}

export type LocalSemanticAdmission = {
  candidateScore: number | null
  secondScore: number | null
  margin: number | null
  threshold: number | null
  marginThreshold: number | null
  admitted: boolean
  abstained: boolean
  strategy: string | null
  profileVersion: string | null
  embeddingModel: string | null
  embeddingRevision: string | null
  chunkingVersion: string | null
  rrfK: number | null
}

export type HybridSearchResult = {
  query: string
  hits: HybridSearchHit[]
  lexicalHits: number
  semanticHits: number
  semanticCandidates: number
  semanticAvailable: boolean
  semanticReason: string | null
  usedFallback: 'none' | 'fts' | 'fts_vector_error'
  durationMs: number
  retrievalMode: LocalRetrievalMode
  staleEmbeddingCount: number
  indexedDocumentCount: number
  indexedChunkCount: number
  vectorIndexBytes: number
  semanticQueryMs: number | null
  dimensionMismatchCount: number
  semanticAdmission: LocalSemanticAdmission
  lexicalPlan: LocalLexicalPlan
}

export type IndexDocumentsResult = {
  documents: number
  chunks: number
  embedded: number
  skippedFresh: number
  staleSkipped: number
  durationMs: number
}
