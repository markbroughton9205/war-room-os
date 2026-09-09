import { existsSync, statSync } from 'node:fs'
import { SovereignCorpus } from '../crawler/corpus'
import type { CrawlDocumentRecord } from '../crawler/types'
import {
  CHUNKING_VERSION,
  type Embedder,
  type HybridRetrievalMode,
  type HybridSearchHit,
  type HybridSearchResult,
  type LocalRetrievalMode,
  type LocalSemanticAdmission,
} from './types'
import { admitSemanticCandidates } from './admission'
import { getSharedQueryEmbedder } from './embedder'
import { PRODUCTION_RETRIEVAL_PROFILE, type RetrievalProfile } from './retrievalProfile'
import { reciprocalRankFusion } from './rrf'
import { resolveHybridPaths } from './modelStore'
import { SqliteVectorStore, searchVectors } from './vectors'
import { emptyLexicalPlan, type LocalLexicalPlan } from '../crawler/lexicalPlan'

function ftsSnippet(document: CrawlDocumentRecord, fallback: string | null): string {
  return fallback || document.description || document.contentText.slice(0, 280)
}

function lexicalHitsFromCorpus(corpus: SovereignCorpus, query: string, limit: number): {
  lexicalDocs: Array<{ document: CrawlDocumentRecord; rank: number; score: number; snippet: string }>
  plan: LocalLexicalPlan
} {
  const planned = corpus.searchFtsWithPlan(query, limit)
  const lexicalDocs: Array<{ document: CrawlDocumentRecord; rank: number; score: number; snippet: string }> = []
  const seen = new Set<number>()
  for (let index = 0; index < planned.rows.length; index += 1) {
    const row = planned.rows[index]!
    if (seen.has(row.documentId)) continue
    seen.add(row.documentId)
    const document = corpus.getById(row.documentId)
    if (!document) continue
    lexicalDocs.push({
      document,
      rank: lexicalDocs.length + 1,
      score: typeof row.rank === 'number' ? row.rank : 0,
      snippet: ftsSnippet(document, row.snippet),
    })
  }
  return { lexicalDocs, plan: planned.plan }
}

function emptyAdmission(profile: RetrievalProfile, extras?: Partial<LocalSemanticAdmission>): LocalSemanticAdmission {
  return {
    candidateScore: null,
    secondScore: null,
    margin: null,
    threshold: profile.semanticThreshold,
    marginThreshold: profile.semanticMarginThreshold,
    admitted: false,
    abstained: false,
    strategy: profile.semanticAdmissionStrategy,
    profileVersion: profile.profileVersion,
    embeddingModel: profile.embeddingModel,
    embeddingRevision: profile.embeddingRevision,
    chunkingVersion: profile.chunkingVersion,
    rrfK: profile.rrfK,
    ...extras,
  }
}

function ftsHits(lexicalDocs: Array<{ document: CrawlDocumentRecord; rank: number; score: number; snippet: string }>): HybridSearchHit[] {
  return lexicalDocs.map((row, index) => ({
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
  }))
}

export async function searchLocalHybrid(query: string, opts?: {
  limit?: number
  corpusRoot?: string
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder?: Embedder
  modelsDir?: string
  retrievalMode?: HybridRetrievalMode
  profile?: RetrievalProfile
}): Promise<HybridSearchResult> {
  const started = Date.now()
  const ownsCorpus = !opts?.corpus
  const ownsStore = !opts?.store
  const corpus = opts?.corpus ?? new SovereignCorpus(opts?.corpusRoot)
  const retrievalMode = opts?.retrievalMode ?? 'hybrid'
  const profile = opts?.profile ?? PRODUCTION_RETRIEVAL_PROFILE
  const embedder = retrievalMode === 'fts'
    ? null
    : (opts?.embedder ?? getSharedQueryEmbedder({ modelsDir: opts?.modelsDir }))
  let store: SqliteVectorStore | null = null
  const limit = Math.max(1, Math.min(20, opts?.limit ?? 8))
  const paths = resolveHybridPaths({ corpusRoot: opts?.corpusRoot ?? corpus.paths.rootDir, modelsDir: opts?.modelsDir })
  const vectorIndexBytes = existsSync(paths.vectorDbPath) ? statSync(paths.vectorDbPath).size : 0

  const finish = (
    hits: HybridSearchHit[],
    extra: Pick<HybridSearchResult, 'lexicalHits' | 'semanticHits' | 'semanticAvailable' | 'semanticReason' | 'usedFallback' | 'retrievalMode'> & Partial<Pick<HybridSearchResult, 'staleEmbeddingCount' | 'indexedDocumentCount' | 'indexedChunkCount' | 'semanticQueryMs' | 'dimensionMismatchCount' | 'semanticCandidates' | 'semanticAdmission' | 'lexicalPlan'>>,
  ): HybridSearchResult => ({
    query,
    hits,
    durationMs: Date.now() - started,
    staleEmbeddingCount: extra.staleEmbeddingCount ?? 0,
    indexedDocumentCount: extra.indexedDocumentCount ?? 0,
    indexedChunkCount: extra.indexedChunkCount ?? 0,
    vectorIndexBytes,
    semanticQueryMs: extra.semanticQueryMs ?? null,
    dimensionMismatchCount: extra.dimensionMismatchCount ?? 0,
    semanticCandidates: extra.semanticCandidates ?? 0,
    semanticAdmission: extra.semanticAdmission ?? emptyAdmission(profile),
    lexicalPlan: extra.lexicalPlan ?? emptyLexicalPlan(),
    ...extra,
  })

  try {
    const lexical = retrievalMode === 'semantic'
      ? { lexicalDocs: [] as Array<{ document: CrawlDocumentRecord; rank: number; score: number; snippet: string }>, plan: emptyLexicalPlan() }
      : lexicalHitsFromCorpus(corpus, query, limit)
    const lexicalDocs = lexical.lexicalDocs
    const lexicalPlan = lexical.plan

    if (!embedder || !embedder.available) {
      const mode: LocalRetrievalMode = retrievalMode === 'fts' ? 'FTS_ONLY' : 'FTS_FALLBACK'
      return finish(ftsHits(lexicalDocs), {
        lexicalHits: lexicalDocs.length,
        semanticHits: 0,
        semanticAvailable: false,
        semanticReason: embedder?.unavailableReason ?? (retrievalMode === 'fts' ? 'FTS_ONLY' : 'SEMANTIC_UNAVAILABLE'),
        usedFallback: retrievalMode === 'fts' ? 'none' : 'fts',
        retrievalMode: mode,
        lexicalPlan,
      })
    }

    try {
      if (opts?.store) {
        store = opts.store
      } else {
        const opened = SqliteVectorStore.tryOpen(paths.vectorDbPath)
        if (opened === 'missing') {
          return finish(ftsHits(lexicalDocs), {
            lexicalHits: lexicalDocs.length,
            semanticHits: 0,
            semanticAvailable: false,
            semanticReason: 'VECTOR_INDEX_MISSING',
            usedFallback: 'fts',
            retrievalMode: 'FTS_FALLBACK',
            lexicalPlan,
          })
        }
        if (opened === 'corrupt') {
          return finish(ftsHits(lexicalDocs), {
            lexicalHits: lexicalDocs.length,
            semanticHits: 0,
            semanticAvailable: false,
            semanticReason: 'VECTOR_INDEX_CORRUPT',
            usedFallback: 'fts_vector_error',
            retrievalMode: 'FTS_FALLBACK',
            lexicalPlan,
          })
        }
        store = opened
      }

      const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
      const staleEmbeddingCount = store.listStaleEmbeddings(hashes).length
      const indexedChunkCount = store.countChunks()
      const indexedDocumentCount = store.countIndexedDocuments()
      const embedStarted = Date.now()
      const [queryVector] = await embedder.embed([query], 'query')
      const semanticQueryMs = Date.now() - embedStarted
      const fresh = store.listFreshEmbeddings({
        embeddingModel: embedder.info.modelId,
        embeddingRevision: embedder.info.revision,
        chunkingVersion: CHUNKING_VERSION,
        documentHashes: hashes,
      })
      const vectorSearch = queryVector && fresh.length
        ? searchVectors({ query: queryVector, embeddings: fresh, limit: Math.max(limit * 3, 12) })
        : { hits: [], dimensionMismatchCount: 0 }
      const vectorHits = vectorSearch.hits

      const bestChunkByDoc = new Map<number, typeof vectorHits[number]>()
      for (const hit of vectorHits) {
        const current = bestChunkByDoc.get(hit.documentId)
        if (!current || hit.score > current.score) bestChunkByDoc.set(hit.documentId, hit)
      }
      const semanticCandidates = [...bestChunkByDoc.values()]
        .sort((a, b) => b.score - a.score)
        .map(hit => ({ hit, documentId: hit.documentId, score: hit.score }))
      const decision = admitSemanticCandidates(semanticCandidates, profile)
      const semanticDocs = decision.admitted.map((row, index) => ({ hit: row.hit, rank: index + 1 }))
      const admission: LocalSemanticAdmission = {
        candidateScore: decision.candidateScore,
        secondScore: decision.secondScore,
        margin: decision.margin,
        threshold: decision.threshold,
        marginThreshold: decision.marginThreshold,
        admitted: decision.admitted.length > 0,
        abstained: decision.abstained,
        strategy: decision.strategy,
        profileVersion: profile.profileVersion,
        embeddingModel: profile.embeddingModel,
        embeddingRevision: profile.embeddingRevision,
        chunkingVersion: profile.chunkingVersion,
        rrfK: profile.rrfK,
      }

      const fused = reciprocalRankFusion({
        ...(retrievalMode === 'semantic' ? {} : { lexical: lexicalDocs.map(row => ({ id: String(row.document.id), rank: row.rank })) }),
        ...(semanticDocs.length ? { semantic: semanticDocs.map(row => ({ id: String(row.hit.documentId), rank: row.rank })) } : {}),
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

      const mode: LocalRetrievalMode = retrievalMode === 'semantic'
        ? 'SEMANTIC_ONLY'
        : retrievalMode === 'fts'
          ? 'FTS_ONLY'
          : semanticDocs.length && lexicalDocs.length
            ? 'HYBRID_RRF'
            : semanticDocs.length
              ? 'HYBRID_RRF'
              : lexicalDocs.length
                ? 'FTS_ONLY'
                : 'HYBRID_RRF'

      return finish(hits, {
        lexicalHits: lexicalDocs.length,
        semanticHits: semanticDocs.length,
        semanticCandidates: semanticCandidates.length,
        semanticAvailable: true,
        semanticReason: null,
        usedFallback: 'none',
        retrievalMode: mode,
        staleEmbeddingCount,
        indexedDocumentCount,
        indexedChunkCount,
        semanticQueryMs,
        dimensionMismatchCount: vectorSearch.dimensionMismatchCount,
        semanticAdmission: admission,
        lexicalPlan,
      })
    } catch (error) {
      return finish(ftsHits(lexicalDocs), {
        lexicalHits: lexicalDocs.length,
        semanticHits: 0,
        semanticAvailable: false,
        semanticReason: error instanceof Error ? error.message : 'VECTOR_INDEX_UNAVAILABLE',
        usedFallback: 'fts_vector_error',
        retrievalMode: 'FTS_FALLBACK',
        lexicalPlan,
      })
    }
  } finally {
    if (ownsStore) store?.close()
    if (ownsCorpus) corpus.close()
  }
}

export function hitToLocalRetrievalSignals(hit: HybridSearchHit, mode: LocalRetrievalMode) {
  return {
    lexicalRank: hit.lexicalRank,
    lexicalScore: hit.lexicalScore,
    semanticRank: hit.semanticRank,
    semanticScore: hit.semanticScore,
    fusionRank: hit.fusionRank,
    fusionScore: hit.fusionScore,
    matchedChunkId: hit.matchedChunkId,
    mode,
  }
}
