import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { collapseToClusterHeads } from '../rankResults'
import { crawlApprovedUrl } from '../crawler/crawlUrl'
import { searchLocalCorpus } from '../crawler/localSearch'
import { SovereignCorpus } from '../crawler/corpus'
import { WAR_ROOM_STORAGE_ORIGIN } from '../crawler/types'
import { chunkDocument, chunkText } from './chunk'
import { createFakeEmbedder, createQueryEmbedder, createUnavailableEmbedder } from './embedder'
import { indexCorpusDocuments } from './indexCorpus'
import { resolveHybridPaths } from './modelStore'
import { searchLocalHybrid } from './retrieve'
import { UNGATED_RETRIEVAL_PROFILE } from './retrievalProfile'
import { CHUNKING_VERSION } from './types'
import { SqliteVectorStore } from './vectors'
import type { CrawlDocumentRecord } from '../crawler/types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const NOW = '2026-09-09T15:00:00.000Z'
const EXPORT_TEXT = 'Governments expanded semiconductor export restrictions on selling advanced processors abroad for foundry equipment.'
const LEXICAL_TEXT = 'ZXQPLORBIT calibration token appears in this otherwise unrelated weather note about rainfall totals.'
const FREIGHT_TEXT = 'Freight brokerage compliance for trucking companies remains a separate logistics topic.'

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: overrides.source_id ?? 'fixture',
    source_type: overrides.source_type ?? 'search',
    source_label: overrides.source_label ?? 'Fixture',
    verified_level: 'semi_verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: NOW,
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

function contentHash(text: string): string {
  return hashEvidenceContent(text) ?? createHash('sha256').update(text).digest('hex')
}

function seed(corpus: SovereignCorpus, input: { url: string; title: string; text: string; publisher?: string }): CrawlDocumentRecord {
  const canonical = canonicalizeUrl(input.url) || input.url
  return corpus.upsertDocument({
    originalUrl: input.url,
    finalUrl: input.url,
    canonicalUrl: canonical,
    domain: hostnameFromUrl(input.url) || 'example.com',
    publisher: input.publisher || hostnameFromUrl(input.url) || 'example.com',
    title: input.title,
    description: input.text.slice(0, 160),
    language: 'en',
    publishedAt: '2026-09-01T00:00:00.000Z',
    author: null,
    lastCrawledAt: NOW,
    contentHash: contentHash(input.text),
    contentText: input.text,
    httpStatus: 200,
    contentType: 'text/html',
    robotsStatus: 'ROBOTS_ALLOWED',
    crawlStatus: 'INDEXED',
    sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
    discoveredVia: 'COMMANDER',
    alsoDiscoveredVia: ['SEARXNG'],
    bytesReceived: input.text.length,
  })
}

function hybridSrc(): string {
  const dir = path.join(process.cwd(), 'lib', 'war-room-search', 'hybrid')
  return readdirSync(dir).filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.includes('.live-')).map(name => readFileSync(path.join(dir, name), 'utf8')).join('\n')
}

export async function runHybridRetrievalValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-hybrid-'))
  const corpus = new SovereignCorpus(tmp)
  const store = new SqliteVectorStore(path.join(tmp, 'vectors.sqlite'))
  const embedder = createFakeEmbedder()

  try {
    const longBody = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}. ${EXPORT_TEXT} Additional context about lithography tools and dual-use packaging rules.`).join('\n\n')
    const exportDoc = seed(corpus, {
      url: 'https://www.reuters.com/world/asia/chip-export-2026',
      title: 'Chip export controls widen',
      text: longBody,
      publisher: 'reuters.com',
    })
    const lexicalDoc = seed(corpus, {
      url: 'https://weather.example/zxqplorbit',
      title: 'Rainfall note',
      text: LEXICAL_TEXT,
      publisher: 'weather.example',
    })
    seed(corpus, {
      url: 'https://freight.example/brokerage',
      title: 'Freight brokerage',
      text: FREIGHT_TEXT,
      publisher: 'freight.example',
    })

    const chunks = chunkDocument(exportDoc)
    cases.push(check(
      'h01_deterministic_chunking',
      chunks.length >= 2 && JSON.stringify(chunkText(longBody)) === JSON.stringify(chunkText(longBody)) && chunks.every((chunk, index) => chunk.chunkOrdinal === index),
      JSON.stringify({ count: chunks.length, ordinals: chunks.map(chunk => chunk.chunkOrdinal) }),
    ))
    cases.push(check(
      'h02_chunk_lineage',
      chunks.every(chunk => (
        chunk.documentId === exportDoc.id
        && chunk.canonicalUrl === exportDoc.canonicalUrl
        && chunk.publisher === 'reuters.com'
        && chunk.contentHash === exportDoc.contentHash
        && chunk.chunkingVersion === CHUNKING_VERSION
        && chunk.charEnd > chunk.charStart
      )) && new Set(chunks.map(chunk => chunk.chunkId)).size === chunks.length,
      JSON.stringify(chunks.map(chunk => ({ id: chunk.chunkId, doc: chunk.documentId, start: chunk.charStart, end: chunk.charEnd }))),
    ))

    await indexCorpusDocuments({ corpus, store, embedder })
    const stored = store.getEmbedding(chunks[0]!.chunkId)
    cases.push(check(
      'h03_embedding_metadata_version',
      Boolean(stored
        && stored.embeddingModel === embedder.info.modelId
        && stored.embeddingRevision === embedder.info.revision
        && stored.dimensions === embedder.info.dimensions
        && stored.chunkingVersion === CHUNKING_VERSION
        && stored.contentHash === exportDoc.contentHash
        && stored.createdAt),
      JSON.stringify(stored && { model: stored.embeddingModel, rev: stored.embeddingRevision, dims: stored.dimensions, hash: stored.contentHash, chunking: stored.chunkingVersion }),
    ))

    const semanticQuery = 'limits on overseas sales of advanced processors'
    const semantic = await searchLocalHybrid(semanticQuery, { corpus, store, embedder, limit: 8, profile: UNGATED_RETRIEVAL_PROFILE })
    cases.push(check(
      'h04_semantic_retrieval',
      semantic.semanticAvailable
        && semantic.hits.some(hit => hit.document.id === exportDoc.id && hit.semanticRank === 1)
        && semantic.hits.find(hit => hit.document.id === exportDoc.id)?.semanticScore != null,
      JSON.stringify(semantic.hits.map(hit => ({ id: hit.document.id, pub: hit.document.publisher, sem: hit.semanticRank, lex: hit.lexicalRank, score: hit.semanticScore }))),
    ))

    const lexicalUnchanged = searchLocalCorpus('zxqplorbit', { corpus, limit: 8 })
    cases.push(check(
      'h05_lexical_retrieval_unchanged',
      lexicalUnchanged.length >= 1 && lexicalUnchanged[0]!.document.id === lexicalDoc.id,
      JSON.stringify({ count: lexicalUnchanged.length, id: lexicalUnchanged[0]?.document.id, url: lexicalUnchanged[0]?.document.canonicalUrl }),
    ))

    const bothQuery = 'semiconductor export'
    const both = await searchLocalHybrid(bothQuery, { corpus, store, embedder, limit: 8, profile: UNGATED_RETRIEVAL_PROFILE })
    const fusedExport = both.hits.find(hit => hit.document.id === exportDoc.id)
    cases.push(check(
      'h06_hybrid_fusion',
      Boolean(fusedExport && fusedExport.lexicalRank != null && fusedExport.semanticRank != null && fusedExport.fusionScore != null && fusedExport.matchedChunkId)
        && both.hits.filter(hit => hit.document.id === exportDoc.id).length === 1,
      JSON.stringify(fusedExport && { lex: fusedExport.lexicalRank, sem: fusedExport.semanticRank, fusion: fusedExport.fusionScore, chunk: fusedExport.matchedChunkId }),
    ))

    const semanticOnly = await searchLocalHybrid(semanticQuery, { corpus, store, embedder, limit: 8, profile: UNGATED_RETRIEVAL_PROFILE })
    const semanticExport = semanticOnly.hits.find(hit => hit.document.id === exportDoc.id)
    cases.push(check(
      'h07_semantic_only_relevant',
      Boolean(semanticExport && semanticExport.semanticRank === 1 && (semanticExport.lexicalRank == null || semanticOnly.lexicalHits === 0 || !semanticOnly.hits.some(hit => hit.document.id === exportDoc.id && hit.lexicalRank === 1 && hit.semanticRank == null))),
      JSON.stringify({ lexicalHits: semanticOnly.lexicalHits, semanticHits: semanticOnly.semanticHits, hit: semanticExport && { lex: semanticExport.lexicalRank, sem: semanticExport.semanticRank } }),
    ))
    const lexicalOnly = await searchLocalHybrid('zxqplorbit', { corpus, store, embedder, limit: 8, profile: UNGATED_RETRIEVAL_PROFILE })
    const lexicalHit = lexicalOnly.hits.find(hit => hit.document.id === lexicalDoc.id)
    cases.push(check(
      'h08_lexical_only_relevant',
      Boolean(lexicalHit && lexicalHit.lexicalRank === 1 && lexicalHit.document.canonicalUrl.includes('zxqplorbit')),
      JSON.stringify(lexicalHit && { lex: lexicalHit.lexicalRank, sem: lexicalHit.semanticRank, url: lexicalHit.document.canonicalUrl }),
    ))
    cases.push(check(
      'h09_same_document_collapses',
      both.hits.filter(hit => hit.document.canonicalUrl === exportDoc.canonicalUrl).length === 1
        && fusedExport?.lexicalRank != null
        && fusedExport?.semanticRank != null,
      JSON.stringify({ count: both.hits.filter(hit => hit.document.id === exportDoc.id).length, lex: fusedExport?.lexicalRank, sem: fusedExport?.semanticRank }),
    ))
    cases.push(check(
      'h10_publisher_provenance_preserved',
      semanticExport?.document.publisher === 'reuters.com'
        && semanticExport.document.canonicalUrl === exportDoc.canonicalUrl
        && semanticExport.document.contentHash === exportDoc.contentHash
        && semanticExport.document.sourceOrigin === 'WAR_ROOM_CORPUS',
      JSON.stringify(semanticExport && { publisher: semanticExport.document.publisher, url: semanticExport.document.canonicalUrl, origin: semanticExport.document.sourceOrigin }),
    ))

    const live = evidence({
      id: 'g-reuters',
      title: exportDoc.title || 'Chip export controls widen',
      content: EXPORT_TEXT,
      url: exportDoc.canonicalUrl,
      source_id: 'google_web_search',
      source_label: exportDoc.publisher,
      discovered_via: 'GOOGLE',
      origin_type: 'LIVE_WEB',
    })
    const local = evidence({
      id: 'local-hybrid',
      title: exportDoc.title || 'Chip export controls widen',
      content: fusedExport?.snippet || EXPORT_TEXT,
      url: exportDoc.canonicalUrl,
      source_id: 'war_room_local',
      source_label: exportDoc.publisher,
      discovered_via: 'WAR_ROOM_LOCAL',
      storage_origin: 'WAR_ROOM_CORPUS',
      content_hash: exportDoc.contentHash,
    })
    const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(stampDiscoveryProvenance([live, local]), {
      region: null,
      queryLanguage: 'en',
      fallbackUsed: false,
      fallbackReason: null,
    }))
    const { heads } = collapseToClusterHeads(clustered.items)
    cases.push(check(
      'h11_build6_source_identity',
      heads.length === 1 && clustered.items.every(item => item.independence_key === heads[0]?.independence_key),
      JSON.stringify({ heads: heads.map(item => item.id), key: heads[0]?.independence_key, via: clustered.items.map(item => item.discovered_via) }),
    ))

    const missing = await searchLocalHybrid('zxqplorbit', { corpus, store, embedder: createUnavailableEmbedder(), limit: 8 })
    cases.push(check(
      'h12_missing_model_fts_fallback',
      missing.usedFallback === 'fts'
        && missing.semanticAvailable === false
        && missing.hits.some(hit => hit.document.id === lexicalDoc.id && hit.lexicalRank === 1),
      JSON.stringify({ fallback: missing.usedFallback, available: missing.semanticAvailable, reason: missing.semanticReason, ids: missing.hits.map(hit => hit.document.id) }),
    ))

    const corruptRoot = mkdtempSync(path.join(os.tmpdir(), 'wr-hybrid-corrupt-'))
    writeFileSync(path.join(corruptRoot, 'vectors.sqlite'), 'this is not a sqlite database')
    const corruptCorpus = new SovereignCorpus(corruptRoot)
    seed(corruptCorpus, { url: 'https://weather.example/zxqplorbit', title: 'Rainfall note', text: LEXICAL_TEXT, publisher: 'weather.example' })
    const corrupt = await searchLocalHybrid('zxqplorbit', { corpus: corruptCorpus, embedder, corpusRoot: corruptRoot, limit: 8 })
    cases.push(check(
      'h13_corrupt_index_fts_fallback',
      corrupt.usedFallback === 'fts_vector_error' && corrupt.hits.some(hit => hit.document.contentText.includes('ZXQPLORBIT')),
      JSON.stringify({ fallback: corrupt.usedFallback, reason: corrupt.semanticReason, count: corrupt.hits.length }),
    ))
    corruptCorpus.close()

    const changed = corpus.upsertDocument({
      ...exportDoc,
      contentText: `${longBody}\n\nUpdated body with a new content hash.`,
      contentHash: contentHash(`${longBody}\n\nUpdated body with a new content hash.`),
      lastCrawledAt: '2026-09-09T16:00:00.000Z',
    })
    const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
    const stale = store.listStaleEmbeddings(hashes)
    const fresh = store.listFreshEmbeddings({
      embeddingModel: embedder.info.modelId,
      embeddingRevision: embedder.info.revision,
      chunkingVersion: CHUNKING_VERSION,
      documentHashes: hashes,
    })
    cases.push(check(
      'h14_content_change_marks_stale',
      stale.some(row => row.contentHash === exportDoc.contentHash) && !fresh.some(row => row.documentId === changed.id && row.contentHash === exportDoc.contentHash),
      JSON.stringify({ stale: stale.length, fresh: fresh.length, oldHash: exportDoc.contentHash, newHash: changed.contentHash }),
    ))

    const otherModel = createFakeEmbedder({ revision: 'test-v2' })
    const versioned = store.listFreshEmbeddings({
      embeddingModel: otherModel.info.modelId,
      embeddingRevision: otherModel.info.revision,
      chunkingVersion: CHUNKING_VERSION,
      documentHashes: hashes,
    })
    cases.push(check(
      'h15_model_version_change_detectable',
      versioned.length === 0 && stored?.embeddingRevision === 'test-v1' && otherModel.info.revision === 'test-v2',
      JSON.stringify({ versioned: versioned.length, storedRev: stored?.embeddingRevision, queryRev: otherModel.info.revision }),
    ))

    const emptyModels = mkdtempSync(path.join(os.tmpdir(), 'wr-hybrid-models-'))
    const previousFetch = globalThis.fetch
    let fetchCount = 0
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1
      return previousFetch(...args)
    }) as typeof fetch
    try {
      const queryEmbedder = createQueryEmbedder({ modelsDir: emptyModels, allowDownload: false })
      const noDownload = await searchLocalHybrid('zxqplorbit', { corpus, store, embedder: queryEmbedder, limit: 4 })
      let downloadBlocked = false
      try {
        createQueryEmbedder({ modelsDir: emptyModels, allowDownload: true })
      } catch (error) {
        downloadBlocked = /download is forbidden/i.test(error instanceof Error ? error.message : '')
      }
      cases.push(check(
        'h16_no_automatic_model_download',
        fetchCount === 0 && queryEmbedder.available === false && noDownload.usedFallback === 'fts' && downloadBlocked,
        JSON.stringify({ fetchCount, available: queryEmbedder.available, fallback: noDownload.usedFallback, downloadBlocked }),
      ))
    } finally {
      globalThis.fetch = previousFetch
    }

    const ignore = execSync('git check-ignore -v .war-room/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx', { encoding: 'utf8' }).trim()
    const gitignore = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    cases.push(check(
      'h17_model_files_not_tracked',
      /\.war-room\//.test(gitignore) && /gitignore:.*\.war-room\//.test(ignore) && resolveHybridPaths().modelsDir.includes(`${path.sep}.war-room${path.sep}models`),
      JSON.stringify({ ignore, modelsDir: resolveHybridPaths().modelsDir }),
    ))

    const src = hybridSrc()
    cases.push(check(
      'h18_no_stage5_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|periodic corpus refresh|automatic re-embed)\b/i.test(src),
      'no Stage 5 scheduler in hybrid retrieval',
    ))
    cases.push(check(
      'h19_no_autonomous_crawling',
      !/\b(crawlApprovedUrl|followLinks|maxDepth|recursiveCrawl|spider)\b/i.test(src),
      'no autonomous crawl primitives in hybrid retrieval',
    ))

    const denied = await crawlApprovedUrl({
      url: 'https://example.com/stage4a-should-not-crawl',
      approval: null as unknown as { actor: 'commander' },
    })
    cases.push(check(
      'h20_stage3_governance_intact',
      denied.status === 'BLOCKED_POLICY' && denied.errorCategory === 'UNAPPROVED',
      JSON.stringify({ status: denied.status, error: denied.error, category: denied.errorCategory }),
    ))
  } finally {
    store.close()
    corpus.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runHybridRetrievalValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign hybrid retrieval validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
