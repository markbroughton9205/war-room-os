import { SovereignCorpus } from '../crawler/corpus'
import { chunkDocument } from './chunk'
import type { Embedder, IndexDocumentsResult, StoredEmbedding } from './types'
import { CHUNKING_VERSION } from './types'
import { SqliteVectorStore } from './vectors'
import type { CrawlDocumentRecord } from '../crawler/types'

export type IndexDocumentOutcome = 'indexed' | 'skipped_fresh'

export async function indexDocumentVectors(opts: {
  document: CrawlDocumentRecord
  store: SqliteVectorStore
  embedder: Embedder
  createdAt?: string
}): Promise<{ outcome: IndexDocumentOutcome; chunks: number; embedded: number }> {
  if (!opts.embedder.available) {
    throw new Error(opts.embedder.unavailableReason ?? 'SEMANTIC_UNAVAILABLE')
  }
  const createdAt = opts.createdAt ?? new Date().toISOString()
  const produced = chunkDocument(opts.document, CHUNKING_VERSION)
  const allFresh = produced.length > 0 && produced.every(chunk => {
    const existing = opts.store.getEmbedding(chunk.chunkId)
    return Boolean(
      existing
      && existing.embeddingModel === opts.embedder.info.modelId
      && existing.embeddingRevision === opts.embedder.info.revision
      && existing.chunkingVersion === CHUNKING_VERSION
      && existing.contentHash === opts.document.contentHash
      && existing.dimensions === opts.embedder.info.dimensions,
    )
  })
  if (allFresh) {
    return { outcome: 'skipped_fresh', chunks: produced.length, embedded: 0 }
  }

  const vectors = await opts.embedder.embed(produced.map(chunk => chunk.text), 'document')
  if (vectors.length !== produced.length || vectors.some(vector => !vector)) {
    throw new Error('REEMBED_INCOMPLETE')
  }
  const embeddings: StoredEmbedding[] = produced.map((chunk, index) => ({
    chunkId: chunk.chunkId,
    embeddingModel: opts.embedder.info.modelId,
    embeddingRevision: opts.embedder.info.revision,
    dimensions: opts.embedder.info.dimensions,
    chunkingVersion: CHUNKING_VERSION,
    contentHash: opts.document.contentHash,
    vector: vectors[index]!,
    createdAt,
  }))
  opts.store.replaceDocumentIndex(opts.document.id, produced, embeddings)
  return { outcome: 'indexed', chunks: produced.length, embedded: embeddings.length }
}

export async function indexCorpusDocuments(opts: {
  corpusRoot?: string
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder: Embedder
}): Promise<IndexDocumentsResult> {
  const started = Date.now()
  if (!opts.embedder.available) {
    throw new Error(opts.embedder.unavailableReason ?? 'SEMANTIC_UNAVAILABLE')
  }
  const ownsCorpus = !opts.corpus
  const ownsStore = !opts.store
  const corpus = opts.corpus ?? new SovereignCorpus(opts.corpusRoot)
  const store = opts.store ?? SqliteVectorStore.openForCorpus(opts.corpusRoot ?? corpus.paths.rootDir)
  try {
    const documents = corpus.listDocuments()
    let chunks = 0
    let embedded = 0
    let skippedFresh = 0
    const createdAt = new Date().toISOString()
    for (const document of documents) {
      const result = await indexDocumentVectors({ document, store, embedder: opts.embedder, createdAt })
      chunks += result.chunks
      embedded += result.embedded
      if (result.outcome === 'skipped_fresh') skippedFresh += result.chunks
    }
    const hashes = new Map(documents.map(doc => [doc.id, doc.contentHash]))
    return {
      documents: documents.length,
      chunks,
      embedded,
      skippedFresh,
      staleSkipped: store.listStaleEmbeddings(hashes).length,
      durationMs: Date.now() - started,
    }
  } finally {
    if (ownsStore) store.close()
    if (ownsCorpus) corpus.close()
  }
}
