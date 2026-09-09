import { isTrustedCrawlActor } from '../crawler/candidates'
import { SovereignCorpus } from '../crawler/corpus'
import {
  MAX_MAINTENANCE_BATCH,
  type CrawlApproval,
  type CrawlDocumentRecord,
} from '../crawler/types'
import { createQueryEmbedder } from './embedder'
import { indexDocumentVectors } from './indexCorpus'
import { CHUNKING_VERSION, type Embedder, type StoredEmbedding } from './types'
import { SqliteVectorStore } from './vectors'

export type StaleVectorDocument = {
  documentId: number
  canonicalUrl: string
  contentHash: string
  storedContentHashes: string[]
}

export type ReembedItemResult = {
  ok: boolean
  outcome: 'REEMBEDDED' | 'SKIPPED_CURRENT' | 'UNAVAILABLE' | 'FAILED' | 'UNAPPROVED' | 'MISSING_DOCUMENT' | 'BATCH_LIMIT'
  documentId: number | null
  canonicalUrl: string | null
  previousStoredHash: string | null
  newContentHash: string | null
  modelId: string | null
  revision: string | null
  chunkingVersion: string | null
  chunks: number
  embedded: number
  error: string | null
  errorCategory: string | null
}

export type ReembedBatchResult = {
  ok: boolean
  error: string | null
  errorCategory: string | null
  requested: number
  processed: number
  reembedded: number
  skippedCurrent: number
  failed: number
  items: ReembedItemResult[]
  durationMs: number
}

function emptyItem(partial: Partial<ReembedItemResult> & Pick<ReembedItemResult, 'ok' | 'outcome'>): ReembedItemResult {
  return {
    documentId: null,
    canonicalUrl: null,
    previousStoredHash: null,
    newContentHash: null,
    modelId: null,
    revision: null,
    chunkingVersion: null,
    chunks: 0,
    embedded: 0,
    error: null,
    errorCategory: null,
    ...partial,
  }
}

export function listStaleVectorDocuments(corpus: SovereignCorpus, store: SqliteVectorStore): StaleVectorDocument[] {
  const documents = corpus.listDocuments()
  const hashes = new Map(documents.map(doc => [doc.id, doc.contentHash]))
  const staleIds = new Set(store.listStaleDocumentIds(hashes))
  return documents.filter(doc => staleIds.has(doc.id)).map(doc => {
    const stored = store.listEmbeddingsForDocument(doc.id)
    return {
      documentId: doc.id,
      canonicalUrl: doc.canonicalUrl,
      contentHash: doc.contentHash,
      storedContentHashes: [...new Set(stored.map(row => row.contentHash))],
    }
  })
}

export function documentNeedsReembed(document: CrawlDocumentRecord, store: SqliteVectorStore): boolean {
  const stored = store.listEmbeddingsForDocument(document.id)
  if (!stored.length) return false
  return stored.some(row => row.contentHash !== document.contentHash)
}

function previousStoredHash(store: SqliteVectorStore, documentId: number): string | null {
  return store.listEmbeddingsForDocument(documentId)[0]?.contentHash ?? null
}

export async function reembedStoredDocument(input: {
  documentId?: number
  canonicalUrl?: string
  approval: CrawlApproval | null
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder?: Embedder
  modelsDir?: string
  now?: string
}): Promise<ReembedItemResult> {
  const corpus = input.corpus ?? new SovereignCorpus()
  const ownsCorpus = !input.corpus
  const store = input.store ?? SqliteVectorStore.openForCorpus(corpus.paths.rootDir)
  const ownsStore = !input.store
  const embedder = input.embedder ?? createQueryEmbedder({ allowDownload: false, modelsDir: input.modelsDir })
  try {
    if (!input.approval || !isTrustedCrawlActor(input.approval.actor)) {
      corpus.recordEvent({
        state: 'REEMBED_FAILED',
        url: input.canonicalUrl ?? String(input.documentId ?? ''),
        errorCategory: 'UNAPPROVED',
        durationMs: 0,
      })
      return emptyItem({
        ok: false,
        outcome: 'UNAPPROVED',
        errorCategory: 'UNAPPROVED',
        error: 'Re-index requires Commander or trusted internal approval. Council cannot authorize maintenance.',
      })
    }

    const document = input.documentId != null
      ? corpus.getById(input.documentId)
      : input.canonicalUrl
        ? corpus.getByCanonicalUrl(input.canonicalUrl)
        : null
    if (!document) {
      return emptyItem({
        ok: false,
        outcome: 'MISSING_DOCUMENT',
        errorCategory: 'MISSING_DOCUMENT',
        error: 'Re-index target is not an existing corpus document.',
      })
    }

    if (!documentNeedsReembed(document, store)) {
      return {
        ok: true,
        outcome: 'SKIPPED_CURRENT',
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        previousStoredHash: previousStoredHash(store, document.id),
        newContentHash: document.contentHash,
        modelId: embedder.info.modelId,
        revision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        chunks: 0,
        embedded: 0,
        error: null,
        errorCategory: null,
      }
    }

    const priorHash = previousStoredHash(store, document.id)
    corpus.recordEvent({
      state: 'REEMBED_STARTED',
      url: document.canonicalUrl,
      documentId: document.id,
      canonicalUrl: document.canonicalUrl,
      contentHash: document.contentHash,
      durationMs: 0,
    })

    if (!embedder.available) {
      corpus.recordEvent({
        state: 'REEMBED_FAILED',
        url: document.canonicalUrl,
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        contentHash: document.contentHash,
        errorCategory: 'SEMANTIC_UNAVAILABLE',
        durationMs: 0,
      })
      return {
        ok: false,
        outcome: 'UNAVAILABLE',
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        previousStoredHash: priorHash,
        newContentHash: document.contentHash,
        modelId: embedder.info.modelId,
        revision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        chunks: 0,
        embedded: 0,
        error: embedder.unavailableReason ?? 'SEMANTIC_UNAVAILABLE',
        errorCategory: 'SEMANTIC_UNAVAILABLE',
      }
    }

    try {
      const indexed = await indexDocumentVectors({ document, store, embedder })
      const stored = store.listEmbeddingsForDocument(document.id)
      const bound = stored.every(row => (
        row.contentHash === document.contentHash
        && row.embeddingModel === embedder.info.modelId
        && row.embeddingRevision === embedder.info.revision
        && row.chunkingVersion === CHUNKING_VERSION
      ))
      if (!bound || indexed.embedded < 1) {
        throw new Error('Replacement vectors did not bind to the current content hash.')
      }
      corpus.recordEvent({
        state: 'REEMBED_COMPLETED',
        url: document.canonicalUrl,
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        contentHash: document.contentHash,
        durationMs: 0,
      })
      return {
        ok: true,
        outcome: 'REEMBEDDED',
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        previousStoredHash: priorHash,
        newContentHash: document.contentHash,
        modelId: embedder.info.modelId,
        revision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        chunks: indexed.chunks,
        embedded: indexed.embedded,
        error: null,
        errorCategory: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      corpus.recordEvent({
        state: 'REEMBED_FAILED',
        url: document.canonicalUrl,
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        contentHash: document.contentHash,
        errorCategory: 'REEMBED_FAILED',
        durationMs: 0,
      })
      return {
        ok: false,
        outcome: 'FAILED',
        documentId: document.id,
        canonicalUrl: document.canonicalUrl,
        previousStoredHash: priorHash,
        newContentHash: document.contentHash,
        modelId: embedder.info.modelId,
        revision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        chunks: 0,
        embedded: 0,
        error: message,
        errorCategory: 'REEMBED_FAILED',
      }
    }
  } finally {
    if (ownsStore) store.close()
    if (ownsCorpus) corpus.close()
  }
}

export async function reembedStaleDocuments(input: {
  approval: CrawlApproval | null
  documentId?: number
  limit?: number
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder?: Embedder
  modelsDir?: string
  excludeDocumentIds?: Iterable<number>
}): Promise<ReembedBatchResult> {
  const started = Date.now()
  const requested = Math.max(0, Math.floor(input.limit ?? MAX_MAINTENANCE_BATCH))
  if (requested > MAX_MAINTENANCE_BATCH) {
    return {
      ok: false,
      error: `Re-index batch exceeds the maximum of ${MAX_MAINTENANCE_BATCH} documents.`,
      errorCategory: 'BATCH_LIMIT',
      requested,
      processed: 0,
      reembedded: 0,
      skippedCurrent: 0,
      failed: 0,
      items: [emptyItem({
        ok: false,
        outcome: 'BATCH_LIMIT',
        errorCategory: 'BATCH_LIMIT',
        error: `Re-index batch exceeds the maximum of ${MAX_MAINTENANCE_BATCH} documents.`,
      })],
      durationMs: Date.now() - started,
    }
  }
  if (!input.approval || !isTrustedCrawlActor(input.approval.actor)) {
    return {
      ok: false,
      error: 'Re-index requires Commander or trusted internal approval. Council cannot authorize maintenance.',
      errorCategory: 'UNAPPROVED',
      requested,
      processed: 0,
      reembedded: 0,
      skippedCurrent: 0,
      failed: 0,
      items: [],
      durationMs: Date.now() - started,
    }
  }

  const corpus = input.corpus ?? new SovereignCorpus()
  const ownsCorpus = !input.corpus
  const store = input.store ?? SqliteVectorStore.openForCorpus(corpus.paths.rootDir)
  const ownsStore = !input.store
  const embedder = input.embedder ?? createQueryEmbedder({ allowDownload: false, modelsDir: input.modelsDir })
  const excluded = new Set(input.excludeDocumentIds ?? [])
  try {
    const targets = input.documentId != null
      ? (excluded.has(input.documentId) ? [] : [input.documentId])
      : listStaleVectorDocuments(corpus, store)
        .map(row => row.documentId)
        .filter(id => !excluded.has(id))
        .slice(0, requested)
    const items: ReembedItemResult[] = []
    for (const documentId of targets) {
      items.push(await reembedStoredDocument({
        documentId,
        approval: input.approval,
        corpus,
        store,
        embedder,
        modelsDir: input.modelsDir,
      }))
    }
    return {
      ok: items.every(item => item.ok || item.outcome === 'SKIPPED_CURRENT' || item.outcome === 'UNAVAILABLE' || item.outcome === 'FAILED')
        && items.every(item => item.outcome !== 'UNAPPROVED' && item.outcome !== 'BATCH_LIMIT'),
      error: null,
      errorCategory: null,
      requested,
      processed: items.length,
      reembedded: items.filter(item => item.outcome === 'REEMBEDDED').length,
      skippedCurrent: items.filter(item => item.outcome === 'SKIPPED_CURRENT').length,
      failed: items.filter(item => !item.ok).length,
      items,
      durationMs: Date.now() - started,
    }
  } finally {
    if (ownsStore) store.close()
    if (ownsCorpus) corpus.close()
  }
}

export function embeddingsBoundToDocument(store: SqliteVectorStore, document: CrawlDocumentRecord, embedder: Embedder): StoredEmbedding[] {
  return store.listEmbeddingsForDocument(document.id).filter(row => (
    row.contentHash === document.contentHash
    && row.embeddingModel === embedder.info.modelId
    && row.embeddingRevision === embedder.info.revision
    && row.chunkingVersion === CHUNKING_VERSION
  ))
}
