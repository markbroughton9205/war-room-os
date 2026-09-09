import { SovereignCorpus } from '../crawler/corpus'
import type { CrawlDocumentRecord } from '../crawler/types'
import { CHUNKING_VERSION, type Embedder, type HybridSearchHit, type HybridSearchResult } from './types'
import { createQueryEmbedder } from './embedder'
import { reciprocalRankFusion } from './rrf'
import { SqliteVectorStore, searchVectors } from './vectors'

function ftsSnippet(document: CrawlDocumentRecord, fallback: string | null): string {
  return fallback || document.description || document.contentText.slice(0, 280)
}

export async function searchLocalHybrid(query: string, opts?: {
  limit?: number
  corpusRoot?: string
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder?: Embedder
  modelsDir?: string
}): Promise<HybridSearchResult> {
  const started = Date.now()
  const ownsCorpus = !opts?.corpus
  const ownsStore = !opts?.store
  const corpus = opts?.corpus ?? new SovereignCorpus(opts?.corpusRoot)
  const embedder = opts?.embedder ?? createQueryEmbedder({ modelsDir: opts?.modelsDir, allowDownload: false })
  let store: SqliteVectorStore | null = null
  const limit = Math.max(1, Math.min(20, opts?.limit ?? 8))

  const finish = (
    hits: HybridSearchHit[],
    extra: Pick<HybridSearchResult, 'lexicalHits' | 'semanticHits' | 'semanticAvailable' | 'semanticReason' | 'usedFallback'>,
  ): HybridSearchResult => ({
    query,
    hits,
    durationMs: Date.now() - started,
    ...extra,
  })

  try {
    const lexicalRows = corpus.searchFts(query, limit)
    const lexicalDocs: Array<{ document: CrawlDocumentRecord; rank: number; score: number; snippet: string }> = []
    for (let index = 0; index < lexicalRows.length; index += 1) {
      const row = lexicalRows[index]!
      const document = corpus.getById(row.documentId)
      if (!document) continue
      lexicalDocs.push({
        document,
        rank: index + 1,
        score: typeof row.rank === 'number' ? row.rank : 0,
        snippet: ftsSnippet(document, row.snippet),
      })
    }

    if (!embedder.available) {
      return finish(lexicalDocs.map((row, index) => ({
        document: row.document,
        fusionRank: index + 1,
        fusionScore: 1 / (60 + row.rank),
        lexicalRank: row.rank,
        semanticRank: null,
        lexicalScore: row.score,
        semanticScore: null,
        matchedChunkId: null,
        matchedChunkText: null,
        snippet: row.snippet,
      })), {
        lexicalHits: lexicalDocs.length,
        semanticHits: 0,
        semanticAvailable: false,
        semanticReason: embedder.unavailableReason ?? 'SEMANTIC_UNAVAILABLE',
        usedFallback: 'fts',
      })
    }

    try {
      store = opts?.store ?? SqliteVectorStore.openForCorpus(opts?.corpusRoot ?? corpus.paths.rootDir)
      const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
      const [queryVector] = await embedder.embed([query], 'query')
      const fresh = store.listFreshEmbeddings({
        embeddingModel: embedder.info.modelId,
        embeddingRevision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        documentHashes: hashes,
      })
      const vectorHits = queryVector && fresh.length
        ? searchVectors({ query: queryVector, embeddings: fresh, limit: Math.max(limit * 3, 12) })
        : []

      const bestChunkByDoc = new Map<number, typeof vectorHits[number]>()
      for (const hit of vectorHits) {
        const current = bestChunkByDoc.get(hit.documentId)
        if (!current || hit.score > current.score) bestChunkByDoc.set(hit.documentId, hit)
      }
      const semanticDocs = [...bestChunkByDoc.values()]
        .sort((a, b) => b.score - a.score)
        .map((hit, index) => ({ hit, rank: index + 1 }))

      const fused = reciprocalRankFusion({
        lexical: lexicalDocs.map(row => ({ id: String(row.document.id), rank: row.rank })),
        semantic: semanticDocs.map(row => ({ id: String(row.hit.documentId), rank: row.rank })),
      })

      const lexicalById = new Map(lexicalDocs.map(row => [row.document.id, row]))
      const hits: HybridSearchHit[] = []
      for (const [index, item] of fused.entries()) {
        if (hits.length >= limit) break
        const documentId = Number(item.id)
        const lexical = lexicalById.get(documentId)
        const semantic = semanticDocs.find(row => row.hit.documentId === documentId)
        const document = lexical?.document ?? corpus.getById(documentId)
        if (!document) continue
        const chunk = semantic && store ? store.getChunk(semantic.hit.chunkId) : null
        hits.push({
          document,
          fusionRank: index + 1,
          fusionScore: item.fusionScore,
          lexicalRank: item.ranks.lexical ?? null,
          semanticRank: item.ranks.semantic ?? null,
          lexicalScore: lexical?.score ?? null,
          semanticScore: semantic?.hit.score ?? null,
          matchedChunkId: chunk?.chunkId ?? null,
          matchedChunkText: chunk?.text ?? null,
          snippet: chunk?.text.slice(0, 280) || lexical?.snippet || ftsSnippet(document, null),
        })
      }

      return finish(hits, {
        lexicalHits: lexicalDocs.length,
        semanticHits: semanticDocs.length,
        semanticAvailable: true,
        semanticReason: null,
        usedFallback: 'none',
      })
    } catch (error) {
      return finish(lexicalDocs.map((row, index) => ({
        document: row.document,
        fusionRank: index + 1,
        fusionScore: 1 / (60 + row.rank),
        lexicalRank: row.rank,
        semanticRank: null,
        lexicalScore: row.score,
        semanticScore: null,
        matchedChunkId: null,
        matchedChunkText: null,
        snippet: row.snippet,
      })), {
        lexicalHits: lexicalDocs.length,
        semanticHits: 0,
        semanticAvailable: false,
        semanticReason: error instanceof Error ? error.message : 'VECTOR_INDEX_UNAVAILABLE',
        usedFallback: 'fts_vector_error',
      })
    }
  } finally {
    if (ownsStore) store?.close()
    if (ownsCorpus) corpus.close()
  }
}
