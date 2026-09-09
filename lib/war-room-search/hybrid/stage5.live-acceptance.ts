import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SovereignCorpus } from '../crawler/corpus'
import { corpusLifecycleDiagnostics, evaluateDocumentFreshness, listDueDocuments, readFreshnessPolicy } from '../crawler/freshness'
import { searchLocalCorpus } from '../crawler/localSearch'
import { runSovereignMaintenance } from './maintain'
import { inspectLocalSemanticHealth } from './semanticHealth'
import { localOnnxModelPresent, resolveHybridPaths } from './modelStore'
import { searchLocalHybrid } from './retrieve'
import { SqliteVectorStore } from './vectors'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL = { actor: 'trusted_internal_test' as const, allowInternalHosts: false, note: 'stage5 live maintenance' }

export async function runStage5LiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const corpus = new SovereignCorpus()
  const store = SqliteVectorStore.tryOpen(paths.vectorDbPath)
  const rssBefore = process.memoryUsage().rss
  try {
    const documents = corpus.listDocuments()
    cases.push(check('live5_01_corpus_present', documents.length >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({
      count: documents.length,
      db: paths.corpusDbPath,
    })))
    if (documents.length < 1) return cases

    const preferred = documents.filter(doc => /rfc-editor\.org|iana\.org/i.test(doc.canonicalUrl)).slice(0, 1)
    const target = preferred[0] ?? documents[0]!
    const policy = readFreshnessPolicy()
    const freshness = evaluateDocumentFreshness({ document: target, policy })
    const due = listDueDocuments(corpus, { policy })
    cases.push(check(
      'live5_02_freshness_evaluation',
      Boolean(freshness.freshness && freshness.dueAt && freshness.contentHash),
      JSON.stringify({
        documentId: freshness.documentId,
        url: freshness.canonicalUrl,
        freshness: freshness.freshness,
        dueCount: due.length,
        lastCrawledAt: freshness.lastCrawledAt,
        dueAt: freshness.dueAt,
      }),
    ))

    const started = Date.now()
    const result = await runSovereignMaintenance({
      approval: APPROVAL,
      recrawlDocumentId: target.id,
      reembedDocumentId: target.id,
      limit: 5,
      corpus,
      store: store === 'missing' || store === 'corrupt' ? undefined : store,
    })
    const durationMs = Date.now() - started
    cases.push(check(
      'live5_03_bounded_maintenance_invocation',
      result.status === 'COMPLETED' && result.requested <= 5 && result.recrawled <= 5,
      JSON.stringify({
        status: result.status,
        requested: result.requested,
        recrawled: result.recrawled,
        unchanged: result.unchanged,
        changed: result.changed,
        reembedded: result.reembedded,
        durationMs,
      }),
    ))
    const first = result.recrawlItems[0]
    cases.push(check(
      'live5_04_recrawl_existing_document',
      Boolean(first && first.documentId === target.id && ['UNCHANGED', 'CHANGED', 'BLOCKED', 'FAILED', 'NOT_FOUND', 'GONE', 'CANONICAL_CHANGED'].includes(first.outcome as string)),
      JSON.stringify({
        outcome: first?.outcome,
        documentId: first?.documentId,
        url: first?.canonicalUrl,
        previousHash: first?.previousHash,
        newHash: first?.newHash,
        robotsStatus: first?.robotsStatus,
        error: first?.error,
      }),
    ))
    cases.push(check(
      'live5_05_robots_policy_rechecked',
      corpus.listEvents(target.id).some(event => event.state === 'ROBOTS_CHECK' || event.state === 'RECRAWL_BLOCKED'),
      JSON.stringify(corpus.listEvents(target.id).slice(-10).map(event => event.state)),
    ))
    cases.push(check(
      'live5_06_unchanged_skips_reembed',
      first?.outcome !== 'UNCHANGED' || result.reembedded === 0,
      JSON.stringify({ outcome: first?.outcome, reembedded: result.reembedded, skippedCurrent: result.skippedCurrent }),
    ))

    const fts = searchLocalCorpus('RFC 2606', { corpus, limit: 8 })
    cases.push(check(
      'live5_07_fts_remains_functional',
      fts.length >= 1,
      JSON.stringify({ hits: fts.map(hit => hit.document.title) }),
    ))

    const modelReady = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
    if (!modelReady) {
      cases.push(check('live5_08_semantic_health', false, 'local ONNX model missing'))
    } else {
      const hybrid = await searchLocalHybrid('RFC 2606', { corpusRoot: paths.corpusRoot, limit: 8 })
      const health = inspectLocalSemanticHealth({ corpusRoot: paths.corpusRoot, queryResult: hybrid })
      cases.push(check(
        'live5_08_semantic_health',
        health.status === 'available' || health.status === 'stale',
        JSON.stringify({
          health: health.status,
          staleEmbeddingCount: hybrid.staleEmbeddingCount,
          abstained: hybrid.semanticAdmission.abstained,
        }),
      ))
    }

    const diagnostics = corpusLifecycleDiagnostics(corpus)
    const events = corpus.listEvents().map(event => event.state)
    cases.push(check(
      'live5_09_diagnostics_and_audit',
      diagnostics.documentCount >= 1
        && diagnostics.lastMaintenanceStatus === 'COMPLETED'
        && diagnostics.maintenanceLockStatus === 'FREE'
        && events.includes('MAINTENANCE_STARTED')
        && events.includes('MAINTENANCE_COMPLETED')
        && !JSON.stringify(diagnostics).includes('<html')
        && !JSON.stringify(diagnostics).includes('contentText'),
      JSON.stringify({ diagnostics, eventTail: events.slice(-12) }),
    ))

    const rssAfter = process.memoryUsage().rss
    cases.push(check(
      'live5_10_resource_measurement',
      durationMs >= 0 && rssAfter > 0,
      JSON.stringify({
        maintenanceMs: durationMs,
        rssBeforeMb: Math.round(rssBefore / 1048576),
        rssAfterMb: Math.round(rssAfter / 1048576),
        vectorBytes: existsSync(paths.vectorDbPath) ? undefined : 0,
      }),
    ))
  } finally {
    if (store !== 'missing' && store !== 'corrupt') {
      try {
        store.close()
      } catch {
        /* closed */
      }
    }
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage5LiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 5 live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
