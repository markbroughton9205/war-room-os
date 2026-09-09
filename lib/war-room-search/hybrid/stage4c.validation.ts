import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { attachLocalRetrievalSignals, formatSearchResult } from '../formatSearchResult'
import { collapseToClusterHeads } from '../rankResults'
import { buildSearchHandoffEvidencePacket } from '../councilHandoff'
import { SovereignCorpus } from '../crawler/corpus'
import { createFakeEmbedder, createUnavailableEmbedder } from './embedder'
import { EVAL_QUERIES, evaluateRetrievalMode, seedEvalCorpus } from './eval'
import { indexCorpusDocuments } from './indexCorpus'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { searchLocalHybrid } from './retrieve'
import { PRODUCTION_RETRIEVAL_PROFILE, RETRIEVAL_PROFILE_VERSION } from './retrievalProfile'
import { CHUNKING_VERSION, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_REVISION } from './types'
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

export async function runStage4cValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4c-'))
  const corpus = new SovereignCorpus(tmp)
  const store = new SqliteVectorStore(path.join(tmp, 'vectors.sqlite'))
  const embedder = createFakeEmbedder()

  try {
    const docs = seedEvalCorpus(corpus)
    await indexCorpusDocuments({ corpus, store, embedder })
    cases.push(check(
      'c01_positive_semantic_paraphrase_admitted',
      EVAL_QUERIES.some(item => item.id === 'paraphrase') && docs.length >= 5,
      JSON.stringify({ queries: EVAL_QUERIES.map(item => item.id), docs: docs.length }),
    ))

    const paraphrase = await searchLocalHybrid('limits on overseas sales of advanced processors', {
      corpus, store, embedder, retrievalMode: 'semantic', limit: 5,
    })
    cases.push(check(
      'c01b_paraphrase_admitted',
      paraphrase.hits[0]?.document.publisher === 'reuters.com'
        && paraphrase.semanticAdmission.admitted === true
        && paraphrase.semanticAdmission.abstained === false
        && (paraphrase.semanticAdmission.candidateScore ?? 0) >= PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold,
      JSON.stringify({
        top: paraphrase.hits.map(hit => hit.document.canonicalUrl),
        admission: paraphrase.semanticAdmission,
      }),
    ))

    const penguin = await searchLocalHybrid('antarctic penguin census 1994', {
      corpus, store, embedder, retrievalMode: 'semantic', limit: 5,
    })
    cases.push(check(
      'c02_true_no_hit_rejected',
      penguin.hits.length === 0
        && penguin.semanticAdmission.abstained === true
        && penguin.semanticAdmission.admitted === false
        && penguin.semanticAvailable === true,
      JSON.stringify({ hits: penguin.hits.length, admission: penguin.semanticAdmission, health: penguin.semanticAvailable }),
    ))

    const hardNeg = await searchLocalHybrid('factory PLC industrial process controls for a chemical plant', {
      corpus, store, embedder, retrievalMode: 'semantic', limit: 5,
    })
    cases.push(check(
      'c03_hard_negative_rejected',
      hardNeg.hits.length === 0 && hardNeg.semanticAdmission.abstained === true,
      JSON.stringify({ hits: hardNeg.hits.map(hit => hit.document.canonicalUrl), admission: hardNeg.semanticAdmission }),
    ))

    const lexical = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder, retrievalMode: 'fts', limit: 5 })
    cases.push(check(
      'c04_exact_lexical_unchanged',
      lexical.hits[0]?.document.canonicalUrl.includes('zxqplorbit') === true && lexical.retrievalMode === 'FTS_ONLY',
      JSON.stringify({ mode: lexical.retrievalMode, top: lexical.hits.map(hit => hit.document.canonicalUrl) }),
    ))

    const highBar = { ...PRODUCTION_RETRIEVAL_PROFILE, semanticThreshold: 0.99, profileVersion: 'wr-retrieval-v4c.1-test-high' }
    const ftsSurvives = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5, profile: highBar })
    cases.push(check(
      'c05_fts_survives_semantic_abstention',
      ftsSurvives.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit') && hit.lexicalRank != null)
        && ftsSurvives.semanticAdmission.abstained === true
        && !ftsSurvives.hits.some(hit => hit.semanticRank != null),
      JSON.stringify({
        mode: ftsSurvives.retrievalMode,
        hits: ftsSurvives.hits.map(hit => ({ url: hit.document.canonicalUrl, lex: hit.lexicalRank, sem: hit.semanticRank })),
        admission: ftsSurvives.semanticAdmission,
      }),
    ))

    const hybrid = await searchLocalHybrid('chip foundry export bans', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5 })
    const fusedExport = hybrid.hits.find(hit => hit.document.publisher === 'reuters.com')
    cases.push(check(
      'c06_admitted_semantic_enters_rrf',
      Boolean(fusedExport && fusedExport.semanticRank != null && fusedExport.fusionScore != null && hybrid.retrievalMode === 'HYBRID_RRF'),
      JSON.stringify(hybrid.hits.map(hit => ({ url: hit.document.canonicalUrl, lex: hit.lexicalRank, sem: hit.semanticRank, fusion: hit.fusionScore }))),
    ))

    const hybridPenguin = await searchLocalHybrid('antarctic penguin census 1994', { corpus, store, embedder, retrievalMode: 'hybrid', limit: 5 })
    cases.push(check(
      'c07_rejected_semantic_not_in_rrf',
      hybridPenguin.hits.length === 0
        && hybridPenguin.semanticHits === 0
        && hybridPenguin.semanticAdmission.abstained === true
        && !hybridPenguin.hits.some(hit => hit.semanticRank != null),
      JSON.stringify({ hits: hybridPenguin.hits.length, semanticHits: hybridPenguin.semanticHits, admission: hybridPenguin.semanticAdmission }),
    ))

    const health = inspectLocalSemanticHealth({ corpusRoot: tmp, queryResult: penguin })
    cases.push(check(
      'c08_health_available_while_abstaining',
      penguin.semanticAvailable === true
        && penguin.semanticAdmission.abstained === true
        && health.status !== 'modelMissing'
        && health.status !== 'disabled'
        && health.status !== 'error',
      JSON.stringify({ status: health.status, available: penguin.semanticAvailable, abstained: penguin.semanticAdmission.abstained }),
    ))

    cases.push(check(
      'c09_threshold_diagnostics',
      penguin.semanticAdmission.threshold === PRODUCTION_RETRIEVAL_PROFILE.semanticThreshold
        && typeof penguin.semanticAdmission.candidateScore === 'number',
      JSON.stringify(penguin.semanticAdmission),
    ))
    cases.push(check(
      'c10_margin_diagnostics',
      penguin.semanticAdmission.marginThreshold === PRODUCTION_RETRIEVAL_PROFILE.semanticMarginThreshold
        && penguin.semanticAdmission.margin != null,
      JSON.stringify({ margin: penguin.semanticAdmission.margin, marginThreshold: penguin.semanticAdmission.marginThreshold }),
    ))
    cases.push(check(
      'c11_retrieval_profile_version',
      penguin.semanticAdmission.profileVersion === RETRIEVAL_PROFILE_VERSION
        && PRODUCTION_RETRIEVAL_PROFILE.profileVersion === 'wr-retrieval-v4c.1',
      JSON.stringify({ version: penguin.semanticAdmission.profileVersion }),
    ))
    cases.push(check(
      'c12_model_revision_bound',
      penguin.semanticAdmission.embeddingModel === LOCAL_EMBEDDING_MODEL_ID
        && penguin.semanticAdmission.embeddingRevision === LOCAL_EMBEDDING_REVISION,
      JSON.stringify({ model: penguin.semanticAdmission.embeddingModel, revision: penguin.semanticAdmission.embeddingRevision }),
    ))
    cases.push(check(
      'c13_chunk_version_bound',
      penguin.semanticAdmission.chunkingVersion === CHUNKING_VERSION,
      JSON.stringify({ chunk: penguin.semanticAdmission.chunkingVersion, rrfK: penguin.semanticAdmission.rrfK }),
    ))

    const hybEval = await evaluateRetrievalMode({ corpus, store, embedder, mode: 'hybrid' })
    cases.push(check(
      'c14_positive_recall_guard',
      hybEval.metrics.recallAt1 >= 0.5 && hybEval.metrics.falseNegativeRateOnPositives != null && hybEval.metrics.falseNegativeRateOnPositives <= 0.5,
      JSON.stringify(hybEval.metrics),
    ))
    const negativeGuard = hybEval.rows.filter(row => row.type === 'HARD_NEGATIVE' || row.id === 'no_relevant')
    cases.push(check(
      'c15_negative_false_positive_guard',
      negativeGuard.length >= 4 && negativeGuard.every(row => row.admitted === false),
      JSON.stringify({ fpr: hybEval.metrics.falsePositiveRateOnNegatives, reject: hybEval.metrics.trueNoHitRejectionRate, guarded: negativeGuard }),
    ))

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
      'c16_build6_unchanged',
      heads.length === 1 && clustered.items.every(item => item.independence_key === heads[0]?.independence_key),
      JSON.stringify({ heads: heads.map(item => item.id), key: heads[0]?.independence_key, via: clustered.items.map(item => item.discovered_via) }),
    ))

    const penguinHandoff = buildSearchHandoffEvidencePacket({
      query: 'antarctic penguin census 1994',
      results: attachLocalRetrievalSignals(
        hybridPenguin.hits.map(hit => formatSearchResult({
          item: evidence({
            id: `local-${hit.document.id}`,
            title: hit.document.title || hit.document.publisher,
            content: hit.snippet,
            url: hit.document.originalUrl,
            canonical_url: hit.document.canonicalUrl,
            source_label: hit.document.publisher,
            discovered_via: 'WAR_ROOM_LOCAL',
            storage_origin: 'WAR_ROOM_CORPUS',
          }),
          score: hit.fusionScore,
          rankBreakdown: { relevance: 0.1, authority: 0.2, freshness: 0.5, primary: 0, independence: 1, regional: 0, duplicatePenalty: 0 },
        })),
        [],
      ),
    })
    const penguinEvidence = penguinHandoff.intelligencePacket?.evidence ?? []
    cases.push(check(
      'c17_rejected_absent_from_council',
      penguinEvidence.length === 0
        && !JSON.stringify(penguinEvidence).includes('rfc')
        && !JSON.stringify(penguinEvidence).includes('IANA'),
      JSON.stringify({ count: penguinEvidence.length, titles: penguinEvidence.map(item => item.title) }),
    ))

    const missingModel = await searchLocalHybrid('ZXQPLORBIT', { corpus, store, embedder: createUnavailableEmbedder('SEMANTIC_UNAVAILABLE'), limit: 5 })
    cases.push(check(
      'c18_missing_model_fts_fallback',
      missingModel.usedFallback === 'fts' && missingModel.hits.some(hit => hit.document.canonicalUrl.includes('zxqplorbit')) && missingModel.semanticAvailable === false,
      JSON.stringify({ fallback: missingModel.usedFallback, reason: missingModel.semanticReason }),
    ))

    const corruptRoot = mkdtempSync(path.join(os.tmpdir(), 'wr-stage4c-corrupt-'))
    writeFileSync(path.join(corruptRoot, 'vectors.sqlite'), 'this is not a sqlite database')
    const corruptCorpus = new SovereignCorpus(corruptRoot)
    seedEvalCorpus(corruptCorpus)
    const corrupt = await searchLocalHybrid('ZXQPLORBIT', { corpus: corruptCorpus, embedder, corpusRoot: corruptRoot, limit: 5 })
    cases.push(check(
      'c19_corrupt_vectors_fts_fallback',
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
    cases.push(check(
      'c20_stale_vectors_handled',
      staleCount >= 1 && changed.contentHash !== docs[0]!.contentHash,
      JSON.stringify({ staleCount, old: docs[0]!.contentHash, next: changed.contentHash }),
    ))

    const retrieveSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/retrieve.ts'), 'utf8')
    const embedderSrc = readFileSync(path.join(process.cwd(), 'lib/war-room-search/hybrid/embedder.ts'), 'utf8')
    const src = hybridSrc()
    cases.push(check(
      'c21_no_model_download_during_query',
      !/allowDownload:\s*true/.test(retrieveSrc) && /Query-time model download is forbidden/.test(embedderSrc),
      'query path forbids download',
    ))
    cases.push(check(
      'c22_no_automatic_re_embedding',
      !/indexCorpusDocuments\(/.test(retrieveSrc),
      'retrieve does not re-embed',
    ))
    cases.push(check(
      'c23_no_autonomous_crawl',
      !/\b(crawlApprovedUrl|followLinks|maxDepth|recursiveCrawl|spider)\b/i.test(src),
      'no crawl primitives in hybrid stage 4c',
    ))
    cases.push(check(
      'c24_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|periodic corpus refresh|automatic re-embed|automatic calibration)\b/i.test(src),
      'no Stage 5 scheduler',
    ))
  } finally {
    store.close()
    corpus.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage4cValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 4C validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
