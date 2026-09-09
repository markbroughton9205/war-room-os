import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { attachLocalRetrievalSignals, formatSearchResult } from '../formatSearchResult'
import { collapseToClusterHeads, rankSearchResults } from '../rankResults'
import { buildSearchHandoffEvidencePacket } from '../councilHandoff'
import { normalizeSearchRequest } from '../searchQuery'
import { SovereignCorpus } from '../crawler/corpus'
import { createFakeEmbedder, createUnavailableEmbedder, getSharedQueryEmbedder, resetSharedQueryEmbedder, sharedQueryEmbedderInstanceCount, textsForEmbedding } from './embedder'
import { EVAL_QUERIES, evaluateRetrievalMode, meanReciprocalRank, recallAtK, seedEvalCorpus } from './eval'
import { indexCorpusDocuments } from './indexCorpus'
import { inspectLocalSemanticHealth, resourceGuardrails } from './semanticHealth'
import { searchLocalHybrid } from './retrieve'
import { ANN_RECONSIDER_CHUNKS, LOCAL_QUERY_PREFIX } from './types'
import { SqliteVectorStore } from './vectors'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

function hybridSrc(): string {
  const dir = path.join(process.cwd(), 'lib', 'war-room-search', 'hybrid')
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.includes('.live-'))
    .map(name => readFileSync(path.join(dir, name), 'utf8'))
    .join('\n')
}

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: overrides.source_id ?? 'war_room_local',
    source_type: overrides.source_type ?? 'search',
    source_label: overrides.source_label ?? 'reuters.com',
    verified_level: 'semi_verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: '2026-09-09T18:00:00.000Z',
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'recent',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'STORED_RESEARCH',
    ...overrides,
  }
}

export async function runStage4bValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4b-'))
  const corpus = new SovereignCorpus(tmp)
  const store = new SqliteVectorStore(path.join(tmp, 'vectors.sqlite'))
  const embedder = createFakeEmbedder()

  try {
    const docs = seedEvalCorpus(corpus)
    cases.push(check(
      'e01_evaluation_dataset_loads',
      EVAL_QUERIES.some(item => item.id === 'exact_lexical')
        && EVAL_QUERIES.some(item => item.id === 'paraphrase')
        && EVAL_QUERIES.some(item => item.type === 'NO_RELEVANT_DOCUMENT')
        && docs.length >= 4
        && EVAL_QUERIES.every(item => item.query && item.type),
      JSON.stringify({ queries: EVAL_QUERIES.map(item => item.id), docs: docs.map(doc => doc.canonicalUrl) }),
    ))

    await indexCorpusDocuments({ corpus, store, embedder })

    const lexical = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'e02_exact_lexical_retrieval',
      lexical.hits[0]?.document.canonicalUrl.includes('zxqplorbit') === true && lexical.retrievalMode === 'FTS_ONLY',
      JSON.stringify({ mode: lexical.retrievalMode, top: lexical.hits.map(hit => hit.document.canonicalUrl) }),
    ))

    const paraphrase = await searchLocalHybrid('limits on overseas sales of advanced processors', {
      corpus, store, embedder, retrievalMode: 'semantic', limit: 5,
    })
    cases.push(check(
      'e03_paraphrase_semantic_retrieval',
      paraphrase.hits[0]?.document.publisher === 'reuters.com' && paraphrase.retrievalMode === 'SEMANTIC_ONLY',
      JSON.stringify({ mode: paraphrase.retrievalMode, top: paraphrase.hits.map(hit => ({ url: hit.document.canonicalUrl, sem: hit.semanticRank, score: hit.semanticScore })) }),
    ))

    const hybrid = await searchLocalHybrid('chip foundry export bans', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5 })
    cases.push(check(
      'e04_hybrid_ranking',
      hybrid.retrievalMode === 'HYBRID_RRF' && hybrid.hits.some(hit => hit.document.publisher === 'reuters.com' && (hit.lexicalRank != null || hit.semanticRank != null) && hit.fusionScore != null),
      JSON.stringify(hybrid.hits.map(hit => ({ url: hit.document.canonicalUrl, lex: hit.lexicalRank, sem: hit.semanticRank, fusion: hit.fusionScore }))),
    ))

    const ftsEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'fts' })
    const semEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'semantic' })
    const hybEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'hybrid' })
    cases.push(check(
      'e05_recall_at_1',
      Number.isFinite(ftsEval.metrics.recallAt1) && Number.isFinite(semEval.metrics.recallAt1) && Number.isFinite(hybEval.metrics.recallAt1),
      JSON.stringify({ fts: ftsEval.metrics, semantic: semEval.metrics, hybrid: hybEval.metrics }),
    ))
    cases.push(check(
      'e06_recall_at_3',
      hybEval.metrics.recallAt3 >= hybEval.metrics.recallAt1 && recallAtK([1, 2, null], 3) === 2 / 3,
      JSON.stringify({ hybridRecallAt3: hybEval.metrics.recallAt3, formula: recallAtK([1, 2, null], 3) }),
    ))
    cases.push(check(
      'e07_mrr',
      Math.abs(meanReciprocalRank([1, 2, null]) - (1 + 0.5 + 0) / 3) < 1e-9 && Number.isFinite(hybEval.metrics.mrr),
      JSON.stringify({ formula: meanReciprocalRank([1, 2, null]), hybridMrr: hybEval.metrics.mrr }),
    ))

    const formatted = formatSearchResult({
      item: evidence({
        id: 'local-1',
        title: docs[0]!.title || 'Chip export controls widen',
        content: docs[0]!.contentText,
        url: docs[0]!.originalUrl,
        canonical_url: docs[0]!.canonicalUrl,
        source_label: docs[0]!.publisher,
        storage_origin: 'WAR_ROOM_CORPUS',
        discovered_via: 'WAR_ROOM_LOCAL',
      }),
      score: 0.42,
      rankBreakdown: { relevance: 0.4, authority: 0.55, freshness: 0.82, primary: 0.15, independence: 1, regional: 0.4, duplicatePenalty: 0 },
    })
    const attached = attachLocalRetrievalSignals([formatted], [{
      canonicalUrl: docs[0]!.canonicalUrl,
      url: docs[0]!.originalUrl,
      localRetrievalSignals: {
        lexicalRank: 2,
        lexicalScore: 12.5,
        semanticRank: 1,
        semanticScore: 0.81,
        fusionRank: 1,
        fusionScore: 0.032,
        matchedChunkId: 'chk_test',
        mode: 'HYBRID_RRF',
      },
    }])
    cases.push(check(
      'e08_retrieval_diagnostics_propagation',
      attached[0]?.localRetrievalSignals?.semanticRank === 1
        && attached[0]?.localRetrievalSignals?.fusionScore === 0.032
        && attached[0]?.rankBreakdown.authority === 0.55
        && attached[0]?.localRetrievalSignals.semanticScore !== attached[0]?.rankBreakdown.relevance
        && attached[0]?.localRetrievalSignals.fusionScore !== attached[0]?.score,
      JSON.stringify({ signals: attached[0]?.localRetrievalSignals, rankBreakdown: attached[0]?.rankBreakdown, federatedScore: attached[0]?.score }),
    ))

    const ranked = rankSearchResults('chip export', [formatted.evidence], normalizeSearchRequest({ query: 'chip export' }))
    cases.push(check(
      'e09_federated_rank_remains_separate',
      ranked[0]?.rankBreakdown != null
        && ranked[0]?.localRetrievalSignals === null
        && !('semanticScore' in ranked[0]!.rankBreakdown)
        && !('fusionScore' in ranked[0]!.rankBreakdown)
        && ranked[0]?.score !== 0.81,
      JSON.stringify({ rankBreakdown: ranked[0]?.rankBreakdown, signals: ranked[0]?.localRetrievalSignals, score: ranked[0]?.score }),
    ))

    const healthAvailable = inspectLocalSemanticHealth({
      corpusRoot: tmp,
      queryResult: hybrid,
    })
    cases.push(check(
      'e10_semantic_health_available',
      (healthAvailable.status === 'available' || healthAvailable.status === 'stale')
        && healthAvailable.modelId != null
        && healthAvailable.indexedChunkCount != null
        && healthAvailable.chunkVersion != null
        && typeof healthAvailable.bruteForceWarning === 'boolean',
      JSON.stringify(healthAvailable),
    ))

    const missingModel = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: createUnavailableEmbedder('SEMANTIC_UNAVAILABLE'), limit: 5 })
    cases.push(check(
      'e11_model_missing_fallback',
      missingModel.usedFallback === 'fts' && missingModel.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')) && missingModel.semanticAvailable === false,
      JSON.stringify({ fallback: missingModel.usedFallback, reason: missingModel.semanticReason, count: missingModel.hits.length }),
    ))

    const missingRoot = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4b-missing-'))
    const missingCorpus = new SovereignCorpus(missingRoot)
    seedEvalCorpus(missingCorpus)
    const missingIndex = await searchLocalHybrid('ZXQPLORBIT', { corpus: missingCorpus, embedder, corpusRoot: missingRoot, limit: 5 })
    cases.push(check(
      'e12_vector_index_missing_fallback',
      missingIndex.usedFallback === 'fts' && missingIndex.semanticReason === 'VECTOR_INDEX_MISSING' && missingIndex.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify({ fallback: missingIndex.usedFallback, reason: missingIndex.semanticReason }),
    ))
    missingCorpus.close()

    const corruptRoot = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4b-corrupt-'))
    writeFileSync(path.join(corruptRoot, 'vectors.sqlite'), 'this is not a sqlite database')
    const corruptCorpus = new SovereignCorpus(corruptRoot)
    seedEvalCorpus(corruptCorpus)
    const corrupt = await searchLocalHybrid('ZXQPLORBIT', { corpus: corruptCorpus, embedder, corpusRoot: corruptRoot, limit: 5 })
    cases.push(check(
      'e13_corrupt_index_fallback',
      corrupt.usedFallback === 'fts_vector_error' && corrupt.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify({ fallback: corrupt.usedFallback, reason: corrupt.semanticReason }),
    ))
    corruptCorpus.close()

    const changed = corpus.upsertDocument({
      ...docs[0]!,
      contentText: `${docs[0]!.contentText}\n\nUpdated chip-export body.`,
      contentHash: `${docs[0]!.contentHash}ff`,
      lastCrawledAt: '2026-09-09T19:00:00.000Z',
    })
    const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
    const staleCount = store.listStaleEmbeddings(hashes).length
    const staleHealth = inspectLocalSemanticHealth({
      corpusRoot: tmp,
      queryResult: { ...hybrid, staleEmbeddingCount: staleCount, indexedChunkCount: store.countChunks(), indexedDocumentCount: store.countIndexedDocuments(), vectorIndexBytes: 1, semanticAvailable: true, semanticReason: null, usedFallback: 'none', semanticQueryMs: 12 },
    })
    cases.push(check(
      'e14_stale_count_observable',
      staleCount >= 1 && (staleHealth.status === 'stale' || (staleHealth.staleEmbeddingCount ?? 0) >= 1) && changed.contentHash !== docs[0]!.contentHash,
      JSON.stringify({ staleCount, status: staleHealth.status, reason: staleHealth.reason }),
    ))

    const mismatchEmbedder = createFakeEmbedder({ dimensions: 8, revision: embedder.info.revision })
    const mismatch = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: mismatchEmbedder, limit: 5 })
    cases.push(check(
      'e15_dimension_mismatch_handled',
      mismatch.dimensionMismatchCount >= 1 || mismatch.semanticHits === 0,
      JSON.stringify({ mismatchCount: mismatch.dimensionMismatchCount, semanticHits: mismatch.semanticHits, fallback: mismatch.usedFallback, hits: mismatch.hits.length }),
    ))
    cases.push(check(
      'e15b_dimension_mismatch_preserves_fts',
      mismatch.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit') && hit.lexicalRank != null),
      JSON.stringify({ mismatchHits: mismatch.hits.map(hit => ({ url: hit.document.canonicalUrl, lex: hit.lexicalRank })) }),
    ))

    const revisionEmbedder = createFakeEmbedder({ revision: 'test-v2' })
    const revisioned = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: revisionEmbedder, limit: 5 })
    cases.push(check(
      'e16_model_revision_mismatch_handled',
      revisioned.semanticHits === 0 && revisioned.hits.some(hit => hit.lexicalRank != null && hit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify({ semanticHits: revisioned.semanticHits, fallback: revisioned.usedFallback, lexicalHits: revisioned.lexicalHits, top: revisioned.hits.map(hit => hit.document.canonicalUrl) }),
    ))

    cases.push(check(
      'e17_query_prefix_behavior',
      textsForEmbedding(['hello world'], 'query')[0] === `${LOCAL_QUERY_PREFIX}hello world`
        && textsForEmbedding(['hello world'], 'document')[0] === 'hello world'
        && !textsForEmbedding(['passage text'], 'document')[0]!.startsWith(LOCAL_QUERY_PREFIX),
      JSON.stringify({ query: textsForEmbedding(['hello world'], 'query'), document: textsForEmbedding(['hello world'], 'document') }),
    ))

    resetSharedQueryEmbedder()
    const first = getSharedQueryEmbedder({ modelsDir: path.join(tmp, 'no-models') })
    const second = getSharedQueryEmbedder({ modelsDir: path.join(tmp, 'no-models') })
    cases.push(check(
      'e18_model_singleton_cache_bounded',
      first === second && sharedQueryEmbedderInstanceCount() === 1,
      JSON.stringify({ same: first === second, count: sharedQueryEmbedderInstanceCount(), available: first.available }),
    ))
    resetSharedQueryEmbedder()

    const live = evidence({
      id: 'g-reuters',
      title: docs[0]!.title || 'Chip export controls widen',
      content: docs[0]!.contentText,
      url: 'https://www.reuters.com/world/asia/chip-export-2026?utm_source=google',
      canonical_url: canonicalizeUrl('https://www.reuters.com/world/asia/chip-export-2026') || docs[0]!.canonicalUrl,
      source_id: 'google_web_search',
      source_label: 'reuters.com',
      origin_type: 'LIVE_WEB',
      discovered_via: 'GOOGLE',
    })
    const local = evidence({
      id: 'wr-reuters',
      title: docs[0]!.title || 'Chip export controls widen',
      content: docs[0]!.contentText,
      url: docs[0]!.originalUrl,
      canonical_url: docs[0]!.canonicalUrl,
      source_label: docs[0]!.publisher,
      discovered_via: 'WAR_ROOM_LOCAL',
      storage_origin: 'WAR_ROOM_CORPUS',
      content_hash: docs[0]!.contentHash,
    })
    const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(stampDiscoveryProvenance([live, local]), {
      region: null,
      queryLanguage: 'en',
      fallbackUsed: false,
      fallbackReason: null,
    }))
    const { heads } = collapseToClusterHeads(clustered.items)
    cases.push(check(
      'e19_build6_unchanged',
      heads.length === 1 && clustered.items.every(item => item.independence_key === heads[0]?.independence_key),
      JSON.stringify({ heads: heads.map(item => item.id), key: heads[0]?.independence_key, via: clustered.items.map(item => item.discovered_via) }),
    ))

    const handoff = buildSearchHandoffEvidencePacket({
      query: 'chip export',
      results: attachLocalRetrievalSignals([
        formatSearchResult({
          item: local,
          score: 0.5,
          rankBreakdown: { relevance: 0.4, authority: 0.55, freshness: 0.8, primary: 0.15, independence: 1, regional: 0.4, duplicatePenalty: 0 },
        }),
      ], [{
        canonicalUrl: local.canonical_url!,
        localRetrievalSignals: {
          lexicalRank: 1, lexicalScore: 1, semanticRank: 1, semanticScore: 0.9, fusionRank: 1, fusionScore: 0.03, matchedChunkId: 'chk', mode: 'HYBRID_RRF',
        },
      }]),
    })
    const packetItem = handoff.intelligencePacket?.evidence[0]
    cases.push(check(
      'e20_council_evidence_unchanged',
      Boolean(packetItem?.canonical_url && packetItem.source_label === 'reuters.com' && packetItem.storage_origin === 'WAR_ROOM_CORPUS' && packetItem.discovered_via === 'WAR_ROOM_LOCAL')
        && (handoff.honestyNotes?.some(note => /not publishers or independent evidence sources/i.test(note)) === true)
        && packetItem?.source_label !== 'HYBRID_RRF'
        && packetItem?.source_id !== 'semantic',
      JSON.stringify({
        canonical: packetItem?.canonical_url,
        publisher: packetItem?.source_label,
        family: packetItem?.source_family,
        storage: packetItem?.storage_origin,
        via: packetItem?.discovered_via,
        notes: handoff.honestyNotes?.slice(-2),
      }),
    ))

    const src = hybridSrc()
    const retrieveSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/retrieve.ts'), 'utf8')
    const embedderSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/embedder.ts'), 'utf8')
    cases.push(check(
      'e21_no_automatic_model_download',
      !/allowDownload:\s*true/.test(retrieveSrc)
        && !/prepareLocalEmbeddingModel/.test(retrieveSrc)
        && /Query-time model download is forbidden/.test(embedderSrc)
        && /allowDownload: false/.test(embedderSrc),
      'query path forbids download; prepare remains an explicit CLI',
    ))
    cases.push(check(
      'e22_no_automatic_re_embedding',
      !/indexCorpusDocuments\(/.test(readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/retrieve.ts'), 'utf8')),
      'retrieve does not re-embed',
    ))
    cases.push(check(
      'e23_no_autonomous_crawl',
      !/\b(crawlApprovedUrl|followLinks|maxDepth|recursiveCrawl|spider)\b/i.test(src),
      'no crawl primitives in hybrid stage 4b',
    ))
    cases.push(check(
      'e24_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|periodic corpus refresh|automatic re-embed)\b/i.test(src),
      'no Stage 5 scheduler',
    ))

    const throwing = createFakeEmbedder()
    throwing.embed = async () => {
      throw new Error('SEMANTIC_INFERENCE_EXCEPTION')
    }
    const exploded = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: throwing, limit: 5 })
    cases.push(check(
      'e25_inference_exception_preserves_fts',
      exploded.usedFallback === 'fts_vector_error' && exploded.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify({ fallback: exploded.usedFallback, reason: exploded.semanticReason }),
    ))

    const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4b-empty-'))
    const emptyCorpus = new SovereignCorpus(emptyRoot)
    const empty = await searchLocalHybrid('anything', { corpus: emptyCorpus, embedder: createUnavailableEmbedder(), corpusRoot: emptyRoot, limit: 5 })
    cases.push(check(
      'e26_empty_corpus_healthy',
      empty.hits.length === 0 && empty.usedFallback === 'fts',
      JSON.stringify({ hits: empty.hits.length, fallback: empty.usedFallback }),
    ))
    emptyCorpus.close()

    const guard = resourceGuardrails({ indexedChunkCount: 20, vectorIndexBytes: 98_304 })
    cases.push(check(
      'e27_scaling_threshold_documented',
      ANN_RECONSIDER_CHUNKS === 50_000 && guard.annReconsider === false && guard.bruteForceWarning === false,
      JSON.stringify({ ...guard, annChunks: ANN_RECONSIDER_CHUNKS }),
    ))
  } finally {
    store.close()
    corpus.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage4bValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4B validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
