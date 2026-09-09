import { SovereignCorpus } from '../crawler/corpus'
import { chunkDocument } from './chunk'
import type { Embedder, IndexDocumentsResult } from './types'
import { CHUNKING_VERSION } from './types'
import { SqliteVectorStore } from './vectors'

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
      const produced = chunkDocument(document, CHUNKING_VERSION)
      store.upsertChunks(produced, createdAt)
      chunks += produced.length
      const pending = produced.filter(chunk => {
        const existing = store.getEmbedding(chunk.chunkId)
        return !(
          existing
          && existing.embeddingModel === opts.embedder.info.modelId
          && existing.embeddingRevision === opts.embedder.info.revision
          && existing.chunkingVersion === CHUNKING_VERSION
          && existing.contentHash === document.contentHash
          && existing.dimensions === opts.embedder.info.dimensions
        )
      })
      skippedFresh += produced.length - pending.length
      if (!pending.length) continue
      const vectors = await opts.embedder.embed(pending.map(chunk => chunk.text), 'document')
      for (const [index, chunk] of pending.entries()) {
        const vector = vectors[index]
        if (!vector) continue
        store.upsertEmbedding({
          chunkId: chunk.chunkId,
          embeddingModel: opts.embedder.info.modelId,
          embeddingRevision: opts.embedder.info.revision,
          dimensions: opts.embedder.info.dimensions,
          chunkingVersion: CHUNKING_VERSION,
          contentHash: document.contentHash,
          vector,
          createdAt,
        })
        embedded += 1
      }
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
