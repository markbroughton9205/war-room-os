import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_SCOUT_GOVERNOR_LIMITS } from '@/lib/council/scout-swarm/governor'
import { RESEARCH_PROFILES } from '@/lib/council/scout-swarm/researchProfiles'
import { proposeIngestCandidates } from '../crawler/candidates'
import { SovereignCorpus } from '../crawler/corpus'
import { crawlApprovedUrl } from '../crawler/crawlUrl'
import { startCrawlFixture } from '../crawler/fixtureServer'
import { corpusLifecycleDiagnostics } from '../crawler/freshness'
import { searchLocalCorpus } from '../crawler/localSearch'
import { recrawlStoredDocument } from '../crawler/recrawl'
import { MAX_MAINTENANCE_BATCH, type CrawlApproval, type CrawlApprovalActor } from '../crawler/types'
import { createFakeEmbedder, createUnavailableEmbedder } from './embedder'
import { seedEvalCorpus } from './eval'
import { indexCorpusDocuments } from './indexCorpus'
import { runSovereignMaintenance } from './maintain'
import { documentNeedsReembed, listStaleVectorDocuments, reembedStaleDocuments, reembedStoredDocument } from './reembed'
import { searchLocalHybrid } from './retrieve'
import { UNGATED_RETRIEVAL_PROFILE } from './retrievalProfile'
import { CHUNKING_VERSION } from './types'
import { SqliteVectorStore } from './vectors'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage5 fixture' }
const NOW = '2026-09-09T18:00:00.000Z'
const RSS_BEFORE = process.memoryUsage().rss

function hybridMaintainSrc(): string {
  const dir = path.join(process.cwd(), 'lib', 'war-room-search', 'hybrid')
  return ['reembed.ts', 'maintain.ts', 'maintainCli.ts', 'indexCorpus.ts']
    .map(name => {
      try {
        return readFileSync(path.join(dir, name), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

function createFailingEmbedder() {
  const base = createFakeEmbedder()
  return {
    ...base,
    async embed() {
      throw new Error('REEMBED_FAILED')
    },
  }
}

export async function runStage5Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage5-'))
  const corpus = new SovereignCorpus(tmp)
  const store = SqliteVectorStore.openForCorpus(tmp)
  const embedder = createFakeEmbedder()
  const fixture = await startCrawlFixture()

  try {
    const current = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/current',
      finalUrl: 'https://fresh.example/current',
      canonicalUrl: 'https://fresh.example/current',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Current doc',
      description: 'current',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'hash-current',
      contentText: 'current vector token WRCURRENTVEC',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 12,
    })
    const staleSeed = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/stale',
      finalUrl: 'https://fresh.example/stale',
      canonicalUrl: 'https://fresh.example/stale',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Stale doc',
      description: 'stale',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'hash-stale-v1',
      contentText: 'stale vector token WRSTALEV1',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 12,
    })
    await indexCorpusDocuments({ corpus, store, embedder })
    corpus.upsertDocument({
      ...staleSeed,
      firstSeenAt: staleSeed.firstSeenAt,
      contentHash: 'hash-stale-v2',
      contentText: 'stale vector token WRSTALEV2 rebuilt body',
    })
    const staleAfter = corpus.getById(staleSeed.id)!
    const staleList = listStaleVectorDocuments(corpus, store)
    cases.push(check(
      '01_stale_document_detected_for_reembed',
      documentNeedsReembed(staleAfter, store) && staleList.some(row => row.documentId === staleSeed.id),
      JSON.stringify(staleList),
    ))
    cases.push(check(
      '02_current_document_skipped',
      !documentNeedsReembed(current, store) && !staleList.some(row => row.documentId === current.id),
      JSON.stringify({ currentNeeds: documentNeedsReembed(current, store), staleIds: staleList.map(row => row.documentId) }),
    ))

    const skippedCurrent = await reembedStoredDocument({
      documentId: current.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder,
    })
    cases.push(check(
      '02b_current_reembed_skips',
      skippedCurrent.ok && skippedCurrent.outcome === 'SKIPPED_CURRENT' && skippedCurrent.embedded === 0,
      JSON.stringify(skippedCurrent),
    ))

    const single = await reembedStoredDocument({
      documentId: staleSeed.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder,
    })
    const singleStored = store.listEmbeddingsForDocument(staleSeed.id)
    cases.push(check(
      '03_single_document_reembed',
      single.ok && single.outcome === 'REEMBEDDED' && singleStored.every(row => row.contentHash === 'hash-stale-v2'),
      JSON.stringify({ outcome: single.outcome, hashes: singleStored.map(row => row.contentHash) }),
    ))

    const extraStale: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const row = corpus.upsertDocument({
        originalUrl: `https://fresh.example/batch-${i}`,
        finalUrl: `https://fresh.example/batch-${i}`,
        canonicalUrl: `https://fresh.example/batch-${i}`,
        domain: 'fresh.example',
        publisher: 'fresh.example',
        title: `Batch ${i}`,
        description: 'batch',
        language: 'en',
        publishedAt: NOW,
        author: null,
        lastCrawledAt: NOW,
        contentHash: `batch-v1-${i}`,
        contentText: `batch v1 token WRBATCHV1${i}`,
        httpStatus: 200,
        contentType: 'text/html',
        robotsStatus: 'ROBOTS_ALLOWED',
        crawlStatus: 'INDEXED',
        sourceOrigin: 'WAR_ROOM_CORPUS',
        discoveredVia: null,
        alsoDiscoveredVia: [],
        bytesReceived: 8,
      })
      extraStale.push(row.id)
    }
    await indexCorpusDocuments({ corpus, store, embedder })
    for (const id of extraStale) {
      const existing = corpus.getById(id)!
      corpus.upsertDocument({
        ...existing,
        firstSeenAt: existing.firstSeenAt,
        contentHash: `batch-v2-${id}`,
        contentText: `batch v2 token WRBATCHV2${id}`,
      })
    }
    const batch = await reembedStaleDocuments({
      approval: APPROVAL,
      limit: 3,
      corpus,
      store,
      embedder,
    })
    cases.push(check(
      '04_stale_batch_reembed',
      batch.reembedded === 3 && batch.items.every(item => item.outcome === 'REEMBEDDED'),
      JSON.stringify({ reembedded: batch.reembedded, processed: batch.processed }),
    ))

    const over = await reembedStaleDocuments({
      approval: APPROVAL,
      limit: MAX_MAINTENANCE_BATCH + 1,
      corpus,
      store,
      embedder,
    })
    const overMaintain = await runSovereignMaintenance({
      approval: APPROVAL,
      reembedStale: true,
      limit: MAX_MAINTENANCE_BATCH + 1,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '05_hard_batch_cap',
      !over.ok && over.errorCategory === 'BATCH_LIMIT' && overMaintain.status === 'BATCH_LIMIT' && overMaintain.reembedded === 0,
      JSON.stringify({ reembed: over.errorCategory, maintain: overMaintain.status }),
    ))

    const missingModelDoc = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/missing-model',
      finalUrl: 'https://fresh.example/missing-model',
      canonicalUrl: 'https://fresh.example/missing-model',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Missing model',
      description: 'missing',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'missing-v1',
      contentText: 'missing model token WRMISSINGV1',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 8,
    })
    await indexCorpusDocuments({ corpus, store, embedder })
    corpus.upsertDocument({
      ...missingModelDoc,
      firstSeenAt: missingModelDoc.firstSeenAt,
      contentHash: 'missing-v2',
      contentText: 'missing model token WRMISSINGV2',
    })
    const unavailable = createUnavailableEmbedder('SEMANTIC_UNAVAILABLE')
    const blockedModel = await reembedStoredDocument({
      documentId: missingModelDoc.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder: unavailable,
    })
    const stillStale = documentNeedsReembed(corpus.getById(missingModelDoc.id)!, store)
    cases.push(check(
      '06_missing_model_blocks_reembed_safely',
      !blockedModel.ok && blockedModel.outcome === 'UNAVAILABLE' && stillStale,
      JSON.stringify({ outcome: blockedModel.outcome, stillStale }),
    ))

    const emptyModels = mkdtempSync(path.join(os.tmpdir(), 'wr-stage5-models-'))
    const previousFetch = globalThis.fetch
    let fetchCount = 0
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1
      return previousFetch(...args)
    }) as typeof fetch
    try {
      const noDownload = await reembedStoredDocument({
        documentId: missingModelDoc.id,
        approval: APPROVAL,
        corpus,
        store,
        modelsDir: emptyModels,
      })
      cases.push(check(
        '07_no_automatic_model_download',
        fetchCount === 0 && noDownload.outcome === 'UNAVAILABLE',
        JSON.stringify({ fetchCount, outcome: noDownload.outcome, error: noDownload.error }),
      ))
    } finally {
      globalThis.fetch = previousFetch
    }

    const changes = await crawlApprovedUrl({ url: `${fixture.baseUrl}/changes`, approval: APPROVAL, corpus, now: NOW })
    const stable = await crawlApprovedUrl({ url: `${fixture.baseUrl}/stable`, approval: APPROVAL, corpus, now: NOW })
    const nowBlocked = await crawlApprovedUrl({ url: `${fixture.baseUrl}/now-blocked`, approval: APPROVAL, corpus, now: NOW })
    const transient = await crawlApprovedUrl({ url: `${fixture.baseUrl}/transient-error`, approval: APPROVAL, corpus, now: NOW })
    const notFound = await crawlApprovedUrl({ url: `${fixture.baseUrl}/not-found`, approval: APPROVAL, corpus, now: NOW })
    const gone = await crawlApprovedUrl({ url: `${fixture.baseUrl}/gone`, approval: APPROVAL, corpus, now: NOW })
    const withLinks = await crawlApprovedUrl({ url: `${fixture.baseUrl}/with-links`, approval: APPROVAL, corpus, now: NOW })
    cases.push(check(
      'fixture_ingest',
      Boolean(changes.ok && stable.ok && nowBlocked.ok && transient.ok && notFound.ok && gone.ok && withLinks.ok),
      JSON.stringify({ changes: changes.status, stable: stable.status }),
    ))
    await indexCorpusDocuments({ corpus, store, embedder })

    fixture.setLifecycle({ changesVersion: 2 })
    const changed = await recrawlStoredDocument({
      documentId: changes.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const changedDoc = corpus.getById(changes.document!.id)!
    const semanticOld = await searchLocalHybrid('WRCHANGEALPHA unique token', {
      corpus,
      store,
      embedder,
      retrievalMode: 'semantic',
      limit: 8,
    })
    const servedOld = semanticOld.hits.some(hit => hit.document.id === changedDoc.id && hit.semanticRank != null)
    cases.push(check(
      '08_old_vectors_withheld_after_content_change',
      changed.outcome === 'CHANGED' && !servedOld && semanticOld.staleEmbeddingCount >= 1,
      JSON.stringify({ outcome: changed.outcome, stale: semanticOld.staleEmbeddingCount, servedOld }),
    ))

    const rebuilt = await reembedStoredDocument({
      documentId: changedDoc.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder,
    })
    const rebuiltRows = store.listEmbeddingsForDocument(changedDoc.id)
    cases.push(check(
      '09_replacement_vectors_use_current_content_hash',
      rebuilt.ok && rebuiltRows.length >= 1 && rebuiltRows.every(row => row.contentHash === changedDoc.contentHash),
      JSON.stringify({ outcome: rebuilt.outcome, hashes: rebuiltRows.map(row => row.contentHash), current: changedDoc.contentHash }),
    ))
    cases.push(check(
      '10_replacement_vector_model_metadata_correct',
      rebuiltRows.every(row => row.embeddingModel === embedder.info.modelId && row.embeddingRevision === embedder.info.revision),
      JSON.stringify(rebuiltRows.map(row => ({ model: row.embeddingModel, rev: row.embeddingRevision }))),
    ))
    cases.push(check(
      '11_replacement_chunk_version_correct',
      rebuiltRows.every(row => row.chunkingVersion === CHUNKING_VERSION) && rebuilt.chunkingVersion === CHUNKING_VERSION,
      JSON.stringify({ version: rebuilt.chunkingVersion, rows: rebuiltRows.map(row => row.chunkingVersion) }),
    ))
    const semanticNew = await searchLocalHybrid('WRCHANGEBRAVO', {
      corpus,
      store,
      embedder,
      retrievalMode: 'semantic',
      profile: UNGATED_RETRIEVAL_PROFILE,
      limit: 8,
    })
    const ftsNew = searchLocalCorpus('WRCHANGEBRAVO', { corpus, limit: 8 })
    cases.push(check(
      '15_changed_recrawl_can_reembed',
      semanticNew.hits.some(hit => hit.document.id === changedDoc.id)
        && ftsNew.some(hit => hit.document.id === changedDoc.id)
        && !documentNeedsReembed(changedDoc, store),
      JSON.stringify({ hits: semanticNew.hits.map(hit => hit.document.title), fts: ftsNew.map(hit => hit.document.title), stale: documentNeedsReembed(changedDoc, store) }),
    ))

    const failDoc = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/fail-reembed',
      finalUrl: 'https://fresh.example/fail-reembed',
      canonicalUrl: 'https://fresh.example/fail-reembed',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Fail reembed',
      description: 'fail',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'fail-v1',
      contentText: 'fail reembed unique token WRFAILV1',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 8,
    })
    await indexCorpusDocuments({ corpus, store, embedder })
    corpus.upsertDocument({
      ...failDoc,
      firstSeenAt: failDoc.firstSeenAt,
      contentHash: 'fail-v2',
      contentText: 'fail reembed unique token WRFAILV2 should stay in FTS',
    })
    const failAfter = corpus.getById(failDoc.id)!
    const failedReembed = await reembedStoredDocument({
      documentId: failDoc.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder: createFailingEmbedder(),
    })
    const ftsAfterFail = searchLocalCorpus('WRFAILV2', { corpus, limit: 8 })
    const staleAfterFail = documentNeedsReembed(failAfter, store)
    const semanticFail = await searchLocalHybrid('WRFAILV1 unique token', {
      corpus,
      store,
      embedder,
      retrievalMode: 'semantic',
      limit: 8,
    })
    const restoredStale = semanticFail.hits.some(hit => hit.document.id === failDoc.id && hit.semanticRank != null)
    cases.push(check(
      '12_failed_reembed_preserves_fts',
      failedReembed.outcome === 'FAILED' && ftsAfterFail.some(hit => hit.document.id === failDoc.id),
      JSON.stringify({ outcome: failedReembed.outcome, fts: ftsAfterFail.map(hit => hit.document.title) }),
    ))
    cases.push(check(
      '13_failed_reembed_does_not_restore_stale_vectors',
      staleAfterFail && !restoredStale,
      JSON.stringify({ staleAfterFail, restoredStale, staleCount: semanticFail.staleEmbeddingCount }),
    ))

    const unchanged = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const skipUnchanged = await reembedStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      store,
      embedder,
    })
    cases.push(check(
      '14_unchanged_recrawl_does_not_reembed',
      unchanged.outcome === 'UNCHANGED' && skipUnchanged.outcome === 'SKIPPED_CURRENT' && skipUnchanged.embedded === 0,
      JSON.stringify({ recrawl: unchanged.outcome, reembed: skipUnchanged.outcome, embedded: skipUnchanged.embedded }),
    ))

    fixture.setLifecycle({ nowBlocked: true })
    const blocked = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: nowBlocked.document!.id,
      reembedDocumentId: nowBlocked.document!.id,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '16_blocked_recrawl_does_not_reembed',
      blocked.blocked >= 1
        && blocked.reembedded === 0
        && (blocked.reembed?.items[0]?.outcome === 'SKIPPED_CURRENT' || blocked.reembed?.processed === 0)
        && corpus.getById(nowBlocked.document!.id)?.contentText.includes('WRNOWBLOCKED') === true,
      JSON.stringify({ blocked: blocked.blocked, reembedded: blocked.reembedded, reembed: blocked.reembed?.items[0]?.outcome }),
    ))

    fixture.setLifecycle({ transientError: true })
    const failedRecrawl = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: transient.document!.id,
      reembedDocumentId: transient.document!.id,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '17_failed_recrawl_does_not_reembed',
      failedRecrawl.failed >= 1
        && failedRecrawl.reembedded === 0
        && corpus.getById(transient.document!.id)?.contentText.includes('WRTRANSIENTOK') === true,
      JSON.stringify({ failed: failedRecrawl.failed, reembedded: failedRecrawl.reembedded, reembed: failedRecrawl.reembed?.items[0]?.outcome }),
    ))

    fixture.setLifecycle({ notFound: true, gone: true })
    const missing = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: notFound.document!.id,
      reembedDocumentId: notFound.document!.id,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    const goneRun = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: gone.document!.id,
      reembedDocumentId: gone.document!.id,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '18_404_410_do_not_trigger_inappropriate_reembed',
      missing.notFound >= 1 && goneRun.gone >= 1 && missing.reembedded === 0 && goneRun.reembedded === 0
        && corpus.getById(notFound.document!.id)?.contentText.includes('WRNOTFOUNDBEFORE') === true
        && corpus.getById(gone.document!.id)?.contentText.includes('WRGONEBEFORE') === true,
      JSON.stringify({
        missing: { notFound: missing.notFound, reembedded: missing.reembedded, reembed: missing.reembed?.items[0]?.outcome },
        gone: { gone: goneRun.gone, reembedded: goneRun.reembedded, reembed: goneRun.reembed?.items[0]?.outcome },
      }),
    ))

    const bounded = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDue: true,
      reembedStale: true,
      limit: 2,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '19_maintenance_run_bounded',
      bounded.requested === 2 && bounded.recrawled <= 2 && bounded.status === 'COMPLETED',
      JSON.stringify({ requested: bounded.requested, recrawled: bounded.recrawled, status: bounded.status }),
    ))

    const locked = corpus.tryAcquireMaintenanceLock({ now: NOW, leaseMs: 60_000 })
    const overlapping = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDue: true,
      reembedStale: true,
      limit: 1,
      corpus,
      store,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '20_overlapping_maintenance_run_blocked',
      locked.acquired && overlapping.status === 'SKIPPED_LOCKED' && overlapping.recrawled === 0 && overlapping.reembedded === 0,
      JSON.stringify({ lock: locked.status, overlap: overlapping.status }),
    ))
    corpus.releaseMaintenanceLock()

    corpus.tryAcquireMaintenanceLock({ now: '2020-01-01T00:00:00.000Z', leaseMs: 1000 })
    const recovered = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: stable.document!.id,
      corpus,
      store,
      embedder,
      now: NOW,
      leaseMs: 60_000,
    })
    cases.push(check(
      '21_expired_lock_recoverable',
      recovered.recoveredExpiredLock && recovered.status === 'COMPLETED',
      JSON.stringify({ recovered: recovered.recoveredExpiredLock, status: recovered.status }),
    ))

    store.close()
    corpus.close()
    const reopened = new SovereignCorpus(tmp)
    const persisted = reopened.latestSuccessfulMaintenanceRun()
    const events = reopened.listEvents()
    const diagnostics = corpusLifecycleDiagnostics(reopened, { now: NOW })
    cases.push(check(
      '22_maintenance_diagnostics_persist',
      Boolean(persisted && persisted.status === 'COMPLETED')
        && diagnostics.lastMaintenanceStatus === 'COMPLETED'
        && typeof diagnostics.staleVectorDocumentCount === 'number'
        && diagnostics.maintenanceLockStatus === 'FREE'
        && !JSON.stringify(diagnostics).includes('WRSTABLEOMEGA'),
      JSON.stringify(diagnostics),
    ))
    cases.push(check(
      '23_maintenance_audit_events',
      events.some(event => event.state === 'MAINTENANCE_STARTED')
        && events.some(event => event.state === 'MAINTENANCE_COMPLETED')
        && events.some(event => event.state === 'MAINTENANCE_SKIPPED_LOCKED')
        && events.some(event => event.state === 'REEMBED_STARTED')
        && events.some(event => event.state === 'REEMBED_COMPLETED')
        && events.some(event => event.state === 'REEMBED_FAILED'),
      JSON.stringify([...new Set(events.map(event => event.state))]),
    ))

    const countBefore = reopened.countDocuments()
    const neverHitsBefore = fixture.hits['/never-auto-added'] ?? 0
    const reopenedStore = SqliteVectorStore.openForCorpus(tmp)
    await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: withLinks.document!.id,
      reembedStale: true,
      corpus: reopened,
      store: reopenedStore,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '24_no_new_urls_added',
      reopened.countDocuments() === countBefore && !reopened.getByCanonicalUrl(`${fixture.baseUrl}/never-auto-added`),
      JSON.stringify({ before: countBefore, after: reopened.countDocuments() }),
    ))
    const proposed = proposeIngestCandidates({
      corpus: reopened,
      now: NOW,
      results: [{
        url: `${fixture.baseUrl}/never-auto-added`,
        title: 'Should stay pending',
        snippet: 'candidate',
        publisher: '127.0.0.1',
        discoveredVia: 'SEARXNG',
      }],
    })
    const pendingId = proposed.items[0]?.candidate?.id
    const pendingBefore = pendingId ? reopened.getCandidateById(pendingId)?.status : null
    await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: stable.document!.id,
      corpus: reopened,
      store: reopenedStore,
      embedder,
      now: NOW,
    })
    const pendingAfter = pendingId ? reopened.getCandidateById(pendingId)?.status : null
    cases.push(check(
      '25_no_candidate_auto_approval',
      pendingBefore === 'PENDING' && pendingAfter === 'PENDING',
      JSON.stringify({ pendingId, before: pendingBefore, after: pendingAfter }),
    ))
    cases.push(check(
      '26_no_link_traversal',
      (fixture.hits['/never-auto-added'] ?? 0) === neverHitsBefore,
      JSON.stringify({ hits: fixture.hits['/never-auto-added'] ?? 0, before: neverHitsBefore }),
    ))

    const src = hybridMaintainSrc()
    const hybridDir = path.join(process.cwd(), 'lib', 'war-room-search', 'hybrid')
    const hybridBlob = readdirSync(hybridDir)
      .filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.includes('.live-'))
      .map(name => readFileSync(path.join(hybridDir, name), 'utf8'))
      .join('\n')
    cases.push(check(
      '27_no_scheduler_daemon',
      !/\bsetInterval\b/.test(src)
        && !/\bcron\b/i.test(src)
        && !/\bwhile\s*\(\s*true\s*\)/.test(src)
        && !/prepareLocalEmbeddingModel/.test(src)
        && !/allowDownload:\s*true/.test(src)
        && !/\b(recrawl daemon|autonomous scheduler|periodic corpus refresh|automatic re-embed)\b/i.test(hybridBlob),
      'operator command only; no in-process daemon',
    ))

    let searchDuring = false
    await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: stable.document!.id,
      corpus: reopened,
      store: reopenedStore,
      embedder,
      now: NOW,
      onLocked: () => {
        const hits = searchLocalCorpus('WRSTABLEOMEGA', { corpus: reopened, limit: 8 })
        searchDuring = hits.some(hit => /WRSTABLEOMEGA/.test(hit.document.contentText))
      },
    })
    cases.push(check(
      '28_search_remains_usable_during_maintenance',
      searchDuring,
      JSON.stringify({ searchDuring }),
    ))

    cases.push(check(
      '29_build6_unchanged',
      DEFAULT_SCOUT_GOVERNOR_LIMITS.maxConcurrentModelCalls === 1
        && DEFAULT_SCOUT_GOVERNOR_LIMITS.maxTotalScoutsPerRound === 16
        && RESEARCH_PROFILES.LIGHT_RESEARCH.scouts === 3
        && RESEARCH_PROFILES.STANDARD_RESEARCH.scouts === 8
        && RESEARCH_PROFILES.DEEP_RESEARCH.scouts === 16,
      JSON.stringify({
        model: DEFAULT_SCOUT_GOVERNOR_LIMITS.maxConcurrentModelCalls,
        scouts: DEFAULT_SCOUT_GOVERNOR_LIMITS.maxTotalScoutsPerRound,
        light: RESEARCH_PROFILES.LIGHT_RESEARCH.scouts,
      }),
    ))

    const council = await runSovereignMaintenance({
      approval: { actor: 'council' as CrawlApprovalActor, allowInternalHosts: true },
      recrawlDue: true,
      reembedStale: true,
      corpus: reopened,
      store: reopenedStore,
      embedder,
      now: NOW,
    })
    cases.push(check(
      '30_council_authority_unchanged',
      council.status === 'UNAPPROVED' && council.recrawled === 0 && council.reembedded === 0,
      JSON.stringify({ status: council.status, error: council.error }),
    ))

    const evalTmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage5-eval-'))
    const evalCorpus = new SovereignCorpus(evalTmp)
    const evalStore = SqliteVectorStore.openForCorpus(evalTmp)
    seedEvalCorpus(evalCorpus)
    await indexCorpusDocuments({ corpus: evalCorpus, store: evalStore, embedder })
    const rfc = await searchLocalHybrid('ZXQPLORBIT', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const dns = await searchLocalHybrid('reserved DNS names', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const liv = await searchLocalHybrid('LIV Golf', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const mixed = await searchLocalHybrid('reserved DNS names and LIV Golf', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const paraphrase = await searchLocalHybrid('cash trouble for a gulf-backed breakaway golf circuit', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const penguin = await searchLocalHybrid('antarctic penguin census 1994', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    const biology = await searchLocalHybrid('protein domains in eukaryotic genomes', { corpus: evalCorpus, store: evalStore, embedder, limit: 8 })
    evalStore.close()
    evalCorpus.close()
    cases.push(check(
      '31_stage4_retrieval_regressions',
      rfc.hits.some(hit => /ZXQPLORBIT/i.test(hit.document.contentText))
        && dns.hits.length >= 1
        && liv.hits.some(hit => /LIV Golf/i.test(hit.document.title ?? ''))
        && mixed.hits.length >= 2
        && mixed.lexicalPlan.planUsed === 'RELAXED'
        && paraphrase.hits.some(hit => /LIV Golf/i.test(hit.document.title ?? ''))
        && penguin.hits.length === 0
        && biology.hits.length === 0,
      JSON.stringify({
        rfc: rfc.hits.map(hit => hit.document.title),
        dns: dns.hits.map(hit => hit.document.title),
        liv: liv.hits.map(hit => hit.document.title),
        mixed: mixed.hits.map(hit => hit.document.title),
        mixedPlan: mixed.lexicalPlan.planUsed,
        paraphrase: paraphrase.hits.map(hit => hit.document.title),
        penguin: penguin.hits.length,
        biology: biology.hits.length,
      }),
    ))

    reopenedStore.close()
    reopened.close()
    const rssAfter = process.memoryUsage().rss
    cases.push(check(
      'resource_measurement_recorded',
      rssAfter > 0 && RSS_BEFORE > 0,
      JSON.stringify({ rssBeforeMb: Math.round(RSS_BEFORE / 1048576), rssAfterMb: Math.round(rssAfter / 1048576) }),
    ))
  } finally {
    try {
      store.close()
    } catch {
      /* closed */
    }
    try {
      corpus.close()
    } catch {
      /* closed */
    }
    await fixture.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage5Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 5 finalization: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
