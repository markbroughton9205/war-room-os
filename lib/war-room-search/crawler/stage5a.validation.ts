import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { crawlApprovedUrl } from './crawlUrl'
import { SovereignCorpus } from './corpus'
import { startCrawlFixture } from './fixtureServer'
import {
  corpusLifecycleDiagnostics,
  evaluateDocumentFreshness,
  listDueDocuments,
  listDocumentFreshness,
} from './freshness'
import { recrawlDueDocuments, recrawlStoredDocument } from './recrawl'
import { searchLocalCorpus } from './localSearch'
import { MAX_RECRAWL_BATCH, type CrawlApproval, type CrawlApprovalActor, type FreshnessPolicy } from './types'
import { proposeIngestCandidates } from './candidates'
import { createFakeEmbedder } from '../hybrid/embedder'
import { indexCorpusDocuments } from '../hybrid/indexCorpus'
import { searchLocalHybrid } from '../hybrid/retrieve'
import { SqliteVectorStore } from '../hybrid/vectors'
import { seedEvalCorpus } from '../hybrid/eval'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage5a fixture' }
const POLICY: FreshnessPolicy = {
  defaultIntervalHours: 24,
  staleMultiplier: 2,
  domainIntervalHours: { 'due.example': 1 },
}
const NOW = '2026-09-09T18:00:00.000Z'
const HOUR = 3_600_000

function crawlerSrc(): string {
  const dir = path.join(process.cwd(), 'lib', 'war-room-search', 'crawler')
  return ['freshness.ts', 'recrawl.ts', 'lifecycleCli.ts']
    .map(name => {
      try {
        return readFileSync(path.join(dir, name), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

export async function runStage5aValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage5a-'))
  const corpus = new SovereignCorpus(tmp)
  const fixture = await startCrawlFixture()
  const embedder = createFakeEmbedder()

  try {
    const freshDoc = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/doc',
      finalUrl: 'https://fresh.example/doc',
      canonicalUrl: 'https://fresh.example/doc',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Fresh doc',
      description: 'new',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'abc',
      contentText: 'new document freshness unique token WRFRESHDOC',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 12,
    })
    const freshEval = evaluateDocumentFreshness({ document: freshDoc, now: NOW, policy: POLICY })
    cases.push(check('01_new_document_freshness', freshEval.freshness === 'FRESH' && Boolean(freshEval.dueAt), JSON.stringify(freshEval)))
    cases.push(check('02_fresh_document_not_due', freshEval.freshness !== 'DUE' && freshEval.lifecycleStatus === 'FRESH', freshEval.lifecycleStatus))

    const dueDoc = corpus.upsertDocument({
      originalUrl: 'https://fresh.example/due',
      finalUrl: 'https://fresh.example/due',
      canonicalUrl: 'https://fresh.example/due',
      domain: 'fresh.example',
      publisher: 'fresh.example',
      title: 'Due doc',
      description: 'due',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: new Date(Date.parse(NOW) - 30 * HOUR).toISOString(),
      contentHash: 'duehash',
      contentText: 'due document token WRDUEDOC',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 8,
    })
    const dueEval = evaluateDocumentFreshness({ document: dueDoc, now: NOW, policy: POLICY })
    cases.push(check('03_due_document_detected', dueEval.freshness === 'DUE', JSON.stringify(dueEval)))

    const domainDoc = corpus.upsertDocument({
      originalUrl: 'https://due.example/page',
      finalUrl: 'https://due.example/page',
      canonicalUrl: 'https://due.example/page',
      domain: 'due.example',
      publisher: 'due.example',
      title: 'Domain override',
      description: 'domain',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: new Date(Date.parse(NOW) - 1.5 * HOUR).toISOString(),
      contentHash: 'domainhash',
      contentText: 'domain override token WRDOMAINDOC',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 8,
    })
    const domainEval = evaluateDocumentFreshness({ document: domainDoc, now: NOW, policy: POLICY })
    const defaultWouldBeFresh = evaluateDocumentFreshness({
      document: { ...domainDoc, domain: 'fresh.example' },
      now: NOW,
      policy: POLICY,
    })
    cases.push(check(
      '04_per_domain_override',
      domainEval.freshness === 'DUE' && defaultWouldBeFresh.freshness === 'FRESH' && domainEval.intervalHours === 1,
      JSON.stringify({ domain: domainEval, defaulted: defaultWouldBeFresh.freshness }),
    ))

    corpus.patchLifecycleMeta(freshDoc.id, { freshnessIntervalHours: 1 })
    const docOverride = evaluateDocumentFreshness({
      document: { ...freshDoc, lastCrawledAt: new Date(Date.parse(NOW) - 1.5 * HOUR).toISOString() },
      now: NOW,
      policy: POLICY,
      documentOverrideHours: 1,
    })
    cases.push(check('05_per_document_override', docOverride.freshness === 'DUE' && docOverride.intervalHours === 1, JSON.stringify(docOverride)))

    const stable = await crawlApprovedUrl({ url: `${fixture.baseUrl}/stable`, approval: APPROVAL, corpus, now: NOW })
    const changes = await crawlApprovedUrl({ url: `${fixture.baseUrl}/changes`, approval: APPROVAL, corpus, now: NOW })
    const nowBlocked = await crawlApprovedUrl({ url: `${fixture.baseUrl}/now-blocked`, approval: APPROVAL, corpus, now: NOW })
    const transient = await crawlApprovedUrl({ url: `${fixture.baseUrl}/transient-error`, approval: APPROVAL, corpus, now: NOW })
    const notFound = await crawlApprovedUrl({ url: `${fixture.baseUrl}/not-found`, approval: APPROVAL, corpus, now: NOW })
    const gone = await crawlApprovedUrl({ url: `${fixture.baseUrl}/gone`, approval: APPROVAL, corpus, now: NOW })
    const identity = await crawlApprovedUrl({ url: `${fixture.baseUrl}/identity`, approval: APPROVAL, corpus, now: NOW })
    const withLinks = await crawlApprovedUrl({ url: `${fixture.baseUrl}/with-links`, approval: APPROVAL, corpus, now: NOW })
    cases.push(check(
      'ingest_lifecycle_fixture',
      Boolean(stable.ok && changes.ok && nowBlocked.ok && transient.ok && notFound.ok && gone.ok && identity.ok && withLinks.ok),
      JSON.stringify({
        stable: stable.status,
        changes: changes.status,
        nowBlocked: nowBlocked.status,
        transient: transient.status,
        notFound: notFound.status,
        gone: gone.status,
      }),
    ))

    const denylistRecrawl = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      policy: { allowlist: [], denylist: ['127.0.0.1'], crawlDisabled: false },
      now: NOW,
    })
    cases.push(check(
      '06_recrawl_reuses_crawler_policy',
      denylistRecrawl.outcome === 'BLOCKED' && denylistRecrawl.errorCategory === 'DENYLIST' && corpus.getById(stable.document!.id)?.contentText.includes('WRSTABLEOMEGA') === true,
      JSON.stringify({ outcome: denylistRecrawl.outcome, category: denylistRecrawl.errorCategory }),
    ))

    const robotsRecrawl = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const robotEvents = corpus.listEvents(stable.document!.id)
    cases.push(check(
      '07_robots_rechecked',
      robotEvents.some(event => event.state === 'ROBOTS_CHECK') && robotsRecrawl.ok && (robotsRecrawl.outcome === 'UNCHANGED' || robotsRecrawl.outcome === 'CHANGED'),
      JSON.stringify(robotEvents.map(event => event.state)),
    ))

    fixture.setLifecycle({ nowBlocked: true })
    const blockedRecrawl = await recrawlStoredDocument({
      documentId: nowBlocked.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const blockedDoc = corpus.getById(nowBlocked.document!.id)!
    cases.push(check(
      '08_newly_disallowed_robots_blocks_recrawl',
      blockedRecrawl.outcome === 'BLOCKED' && blockedDoc.contentText.includes('WRNOWBLOCKED') && corpus.getLifecycleMeta(blockedDoc.id).lastRecrawlOutcome === 'BLOCKED',
      JSON.stringify({ outcome: blockedRecrawl.outcome, robots: blockedRecrawl.robotsStatus, text: blockedDoc.contentText.slice(0, 80) }),
    ))

    const ssrfRecrawl = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: { actor: 'trusted_internal_test', allowInternalHosts: false },
      corpus,
      now: NOW,
    })
    cases.push(check(
      '09_ssrf_protections_still_apply',
      ssrfRecrawl.outcome === 'BLOCKED' && (ssrfRecrawl.errorCategory === 'SSRF_PRIVATE' || ssrfRecrawl.errorCategory === 'SSRF_INTERNAL_HOST'),
      JSON.stringify({ outcome: ssrfRecrawl.outcome, category: ssrfRecrawl.errorCategory }),
    ))

    const unchanged = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    cases.push(check(
      '10_unchanged_hash_detected',
      unchanged.ok && unchanged.outcome === 'UNCHANGED' && unchanged.previousHash === unchanged.newHash,
      JSON.stringify({ outcome: unchanged.outcome, prev: unchanged.previousHash, next: unchanged.newHash }),
    ))

    await indexCorpusDocuments({ corpus, embedder })
    const beforeChange = changes.document!
    fixture.setLifecycle({ changesVersion: 2 })
    const changed = await recrawlStoredDocument({
      documentId: beforeChange.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const changedDoc = corpus.getById(beforeChange.id)!
    const versions = corpus.listDocumentVersions(beforeChange.id)
    cases.push(check(
      '11_changed_hash_detected',
      changed.ok && changed.outcome === 'CHANGED' && changed.previousHash !== changed.newHash && changedDoc.contentText.includes('WRCHANGEBRAVO'),
      JSON.stringify({ outcome: changed.outcome, prev: changed.previousHash, next: changed.newHash }),
    ))
    cases.push(check(
      '12_previous_hash_lineage_preserved',
      versions.some(row => row.changeStatus === 'CHANGED' && row.previousHash === changed.previousHash && row.newHash === changed.newHash),
      JSON.stringify(versions.map(row => ({ status: row.changeStatus, prev: row.previousHash, next: row.newHash }))),
    ))

    const ftsNew = searchLocalCorpus('WRCHANGEBRAVO', { corpus, limit: 8 })
    const ftsOld = searchLocalCorpus('WRCHANGEALPHA', { corpus, limit: 8 })
    cases.push(check(
      '13_changed_document_updates_fts',
      ftsNew.some(hit => hit.document.id === beforeChange.id) && !ftsOld.some(hit => hit.document.id === beforeChange.id),
      JSON.stringify({ newHits: ftsNew.map(hit => hit.document.title), oldHits: ftsOld.map(hit => hit.document.title) }),
    ))

    const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
    const store = SqliteVectorStore.openForCorpus(tmp)
    const stale = store.listStaleEmbeddings(hashes)
    cases.push(check(
      '14_changed_document_makes_old_embeddings_stale',
      stale.length >= 1,
      JSON.stringify({ stale: stale.length, changedId: beforeChange.id }),
    ))

    const semantic = await searchLocalHybrid('WRCHANGEALPHA unique token', {
      corpusRoot: tmp,
      embedder,
      retrievalMode: 'semantic',
      limit: 8,
    })
    const servedStale = semantic.hits.some(hit => hit.document.id === beforeChange.id && hit.semanticRank != null)
    cases.push(check(
      '15_stale_vectors_not_served',
      !servedStale && semantic.staleEmbeddingCount >= 1,
      JSON.stringify({ stale: semantic.staleEmbeddingCount, hits: semantic.hits.map(hit => hit.document.title), mode: semantic.retrievalMode }),
    ))
    store.close()

    const beforeTransient = transient.document!.contentText
    fixture.setLifecycle({ transientError: true })
    const failed500 = await recrawlStoredDocument({
      documentId: transient.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const after500 = corpus.getById(transient.document!.id)!
    cases.push(check(
      '18_http_500_preserves_last_good_document',
      failed500.outcome === 'FAILED' && after500.contentText === beforeTransient && after500.contentText.includes('WRTRANSIENTOK'),
      JSON.stringify({ outcome: failed500.outcome, status: failed500.httpStatus, hash: after500.contentHash }),
    ))
    cases.push(check(
      '16_failed_recrawl_preserves_last_good_document',
      after500.contentHash === transient.document!.contentHash && after500.lastCrawledAt === transient.document!.lastCrawledAt,
      JSON.stringify({ lastCrawledAt: after500.lastCrawledAt, original: transient.document!.lastCrawledAt }),
    ))

    const hangingFetch: typeof fetch = async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000)
        const onAbort = () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
        }
        if (init?.signal?.aborted) {
          onAbort()
          return
        }
        init?.signal?.addEventListener('abort', onAbort, { once: true })
      })
      return new Response('slow', { status: 200, headers: { 'content-type': 'text/html' } })
    }
    const beforeTimeout = corpus.getById(stable.document!.id)!
    const timedOut = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      fetchImpl: hangingFetch,
      limits: { timeoutMs: 40 },
      now: NOW,
    })
    const afterTimeout = corpus.getById(stable.document!.id)!
    cases.push(check(
      '17_timeout_preserves_last_good_document',
      timedOut.outcome === 'FAILED' && timedOut.errorCategory === 'TIMEOUT' && afterTimeout.contentText === beforeTimeout.contentText,
      JSON.stringify({ outcome: timedOut.outcome, category: timedOut.errorCategory }),
    ))

    fixture.setLifecycle({ notFound: true })
    const missing = await recrawlStoredDocument({
      documentId: notFound.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const after404 = corpus.getById(notFound.document!.id)!
    cases.push(check(
      '19_404_recorded_without_deleting',
      missing.outcome === 'NOT_FOUND' && after404.contentText.includes('WRNOTFOUNDBEFORE') && corpus.getLifecycleMeta(after404.id).sourceAvailability === 'NOT_FOUND',
      JSON.stringify({ outcome: missing.outcome, availability: corpus.getLifecycleMeta(after404.id).sourceAvailability }),
    ))

    fixture.setLifecycle({ gone: true })
    const goneResult = await recrawlStoredDocument({
      documentId: gone.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const after410 = corpus.getById(gone.document!.id)!
    cases.push(check(
      '20_410_recorded_without_deleting',
      goneResult.outcome === 'GONE' && after410.contentText.includes('WRGONEBEFORE') && corpus.getLifecycleMeta(after410.id).sourceAvailability === 'GONE',
      JSON.stringify({ outcome: goneResult.outcome, availability: corpus.getLifecycleMeta(after410.id).sourceAvailability }),
    ))

    const ssrfTarget = corpus.upsertDocument({
      originalUrl: `${fixture.baseUrl}/redirect-ssrf`,
      finalUrl: `${fixture.baseUrl}/redirect-ssrf`,
      canonicalUrl: `${fixture.baseUrl}/redirect-ssrf`,
      domain: '127.0.0.1',
      publisher: '127.0.0.1',
      title: 'Redirect ssrf',
      description: 'ssrf',
      language: 'en',
      publishedAt: NOW,
      author: null,
      lastCrawledAt: NOW,
      contentHash: 'ssrfhash',
      contentText: 'redirect ssrf placeholder WRREDIRECTSSRF',
      httpStatus: 200,
      contentType: 'text/html',
      robotsStatus: 'ROBOTS_ALLOWED',
      crawlStatus: 'INDEXED',
      sourceOrigin: 'WAR_ROOM_CORPUS',
      discoveredVia: null,
      alsoDiscoveredVia: [],
      bytesReceived: 8,
    })
    const redirectSafe = await recrawlStoredDocument({
      documentId: ssrfTarget.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    fixture.setLifecycle({ identityRedirectsTo: '/changes' })
    const identityKeep = identity.document!.contentText
    const identityRecrawl = await recrawlStoredDocument({
      documentId: identity.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const identityAfter = corpus.getById(identity.document!.id)!
    cases.push(check(
      '21_redirect_safety_preserved',
      redirectSafe.outcome === 'BLOCKED' && redirectSafe.errorCategory === 'SSRF_METADATA'
        && identityRecrawl.outcome === 'CANONICAL_CHANGED' && identityAfter.canonicalUrl === identity.document!.canonicalUrl
        && identityAfter.contentText === identityKeep,
      JSON.stringify({
        ssrf: { outcome: redirectSafe.outcome, category: redirectSafe.errorCategory },
        identity: { outcome: identityRecrawl.outcome, canonical: identityAfter.canonicalUrl },
      }),
    ))

    const overLimit = await recrawlDueDocuments({
      approval: APPROVAL,
      corpus,
      limit: MAX_RECRAWL_BATCH + 1,
      now: NOW,
      freshnessPolicy: POLICY,
    })
    cases.push(check(
      '22_recrawl_batch_hard_limit',
      !overLimit.ok && overLimit.errorCategory === 'BATCH_LIMIT' && overLimit.processed === 0,
      JSON.stringify({ ok: overLimit.ok, category: overLimit.errorCategory, requested: overLimit.requested }),
    ))

    const countBefore = corpus.countDocuments()
    const neverHitsBefore = fixture.hits['/never-auto-added'] ?? 0
    await recrawlStoredDocument({
      documentId: withLinks.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const countAfter = corpus.countDocuments()
    cases.push(check(
      '23_new_links_not_followed',
      (fixture.hits['/never-auto-added'] ?? 0) === neverHitsBefore,
      JSON.stringify({ hits: fixture.hits['/never-auto-added'] ?? 0, before: neverHitsBefore }),
    ))
    cases.push(check(
      '24_new_urls_not_auto_added',
      countAfter === countBefore && !corpus.getByCanonicalUrl(`${fixture.baseUrl}/never-auto-added`),
      JSON.stringify({ before: countBefore, after: countAfter }),
    ))

    const proposed = proposeIngestCandidates({
      corpus,
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
    const pendingBefore = pendingId ? corpus.getCandidateById(pendingId)?.status : null
    await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: APPROVAL,
      corpus,
      now: NOW,
    })
    const pendingAfter = pendingId ? corpus.getCandidateById(pendingId)?.status : null
    cases.push(check(
      '25_no_candidate_auto_approval',
      pendingBefore === 'PENDING' && pendingAfter === 'PENDING',
      JSON.stringify({ pendingId, before: pendingBefore, after: pendingAfter, created: proposed.created }),
    ))

    const council = await recrawlStoredDocument({
      documentId: stable.document!.id,
      approval: { actor: 'council' as CrawlApprovalActor, allowInternalHosts: true },
      corpus,
      now: NOW,
    })
    cases.push(check(
      '26_council_cannot_authorize_recrawl',
      council.outcome === 'UNAPPROVED' && council.errorCategory === 'UNAPPROVED',
      JSON.stringify({ outcome: council.outcome, error: council.error }),
    ))

    const diagnostics = corpusLifecycleDiagnostics(corpus, { now: NOW, policy: POLICY })
    cases.push(check(
      '27_lifecycle_diagnostics',
      diagnostics.documentCount >= 1
        && typeof diagnostics.freshCount === 'number'
        && typeof diagnostics.dueCount === 'number'
        && typeof diagnostics.blockedCount === 'number'
        && !JSON.stringify(diagnostics).includes('WRSTABLEOMEGA'),
      JSON.stringify(diagnostics),
    ))

    const dueListed = listDueDocuments(corpus, { now: NOW, policy: POLICY })
    cases.push(check('due_list_uses_last_crawled_at', dueListed.every(row => row.freshness === 'DUE' || row.freshness === 'STALE'), String(dueListed.length)))

    corpus.close()
    const reopened = new SovereignCorpus(tmp)
    const persisted = reopened.getById(changedDoc.id)
    const persistedVersions = reopened.listDocumentVersions(changedDoc.id)
    cases.push(check(
      '28_persistence_across_sqlite_reopen',
      Boolean(persisted && persisted.contentHash === changedDoc.contentHash && persistedVersions.length >= 1),
      JSON.stringify({ hash: persisted?.contentHash, versions: persistedVersions.length }),
    ))

    const src = crawlerSrc() + readFileSync(path.join(process.cwd(), 'lib/war-room-search/crawler/recrawl.ts'), 'utf8')
    cases.push(check(
      '29_no_uncontrolled_daemon',
      !/\bsetInterval\b/.test(src) && !/\bcron\b/i.test(src) && !/\bwhile\s*\(\s*true\s*\)/.test(src) && !/createServer\(\s*\)/.test(src),
      'no setInterval/cron/daemon in Stage 5A lifecycle modules',
    ))

    const evalTmp = mkdtempSync(path.join(os.tmpdir(), 'wr-stage5a-eval-'))
    const evalCorpus = new SovereignCorpus(evalTmp)
    seedEvalCorpus(evalCorpus)
    const rfc = await searchLocalHybrid('ZXQPLORBIT', { corpus: evalCorpus, embedder: createFakeEmbedder(), retrievalMode: 'fts', limit: 8 })
    const mixed = await searchLocalHybrid('reserved DNS names and LIV Golf', { corpus: evalCorpus, embedder: createFakeEmbedder(), retrievalMode: 'fts', limit: 8 })
    const penguin = await searchLocalHybrid('antarctic penguin census 1994', { corpus: evalCorpus, embedder: createFakeEmbedder(), retrievalMode: 'fts', limit: 8 })
    evalCorpus.close()
    cases.push(check(
      '30_stage4_retrieval_remains_functional',
      rfc.hits.some(hit => /ZXQPLORBIT/i.test(hit.document.contentText))
        && mixed.hits.length >= 2
        && mixed.lexicalPlan.planUsed === 'RELAXED'
        && penguin.hits.length === 0,
      JSON.stringify({
        rfc: rfc.hits.map(hit => hit.document.title),
        mixedPlan: mixed.lexicalPlan.planUsed,
        mixed: mixed.hits.map(hit => hit.document.title),
        penguin: penguin.hits.length,
      }),
    ))

    const freshnessList = listDocumentFreshness(reopened, { now: NOW, policy: POLICY })
    cases.push(check('freshness_list_no_page_bodies', freshnessList.every(row => !('contentText' in row)), String(freshnessList.length)))
    reopened.close()
  } finally {
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
  const results = await runStage5aValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 5A validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
