import type { CrawlDocumentRecord } from '../crawler/types'

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

export type HybridSearchResult = {
  query: string
  hits: HybridSearchHit[]
  lexicalHits: number
  semanticHits: number
  semanticAvailable: boolean
  semanticReason: string | null
  usedFallback: 'none' | 'fts' | 'fts_vector_error'
  durationMs: number
}

export type IndexDocumentsResult = {
  documents: number
  chunks: number
  embedded: number
  skippedFresh: number
  staleSkipped: number
  durationMs: number
}
