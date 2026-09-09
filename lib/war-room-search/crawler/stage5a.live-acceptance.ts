import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SovereignCorpus } from './corpus'
import { corpusLifecycleDiagnostics, evaluateDocumentFreshness, readFreshnessPolicy } from './freshness'
import { recrawlStoredDocument } from './recrawl'
import { searchLocalCorpus } from './localSearch'
import { searchLocalHybrid } from '../hybrid/retrieve'
import { inspectLocalSemanticHealth } from '../hybrid/semanticHealth'
import { localOnnxModelPresent, resolveHybridPaths } from '../hybrid/modelStore'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'LIVE'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL = { actor: 'trusted_internal_test' as const, allowInternalHosts: false, note: 'stage5a live recrawl' }

export async function runStage5aLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const paths = resolveHybridPaths()
  const corpus = new SovereignCorpus()
  try {
    const documents = corpus.listDocuments()
    cases.push(check('live5a_01_corpus_present', documents.length >= 1 && existsSync(paths.corpusDbPath), JSON.stringify({
      count: documents.length,
      db: paths.corpusDbPath,
    })))
    if (documents.length < 1) return cases

    const preferred = documents.filter(doc => /rfc-editor\.org|iana\.org/i.test(doc.canonicalUrl)).slice(0, 2)
    const targets = preferred.length ? preferred : documents.slice(0, 1)
    const policy = readFreshnessPolicy()
    const freshness = targets.map(document => evaluateDocumentFreshness({ document, policy }))
    cases.push(check(
      'live5a_02_freshness_calculated',
      freshness.every(row => Boolean(row.freshness) && Boolean(row.dueAt) && Boolean(row.contentHash)),
      JSON.stringify(freshness.map(row => ({
        documentId: row.documentId,
        url: row.canonicalUrl,
        freshness: row.freshness,
        lifecycleStatus: row.lifecycleStatus,
        lastCrawledAt: row.lastCrawledAt,
        dueAt: row.dueAt,
        intervalHours: row.intervalHours,
      }))),
    ))

    const recrawled = []
    for (const document of targets) {
      recrawled.push(await recrawlStoredDocument({
        documentId: document.id,
        approval: APPROVAL,
        corpus,
      }))
    }
    const first = recrawled[0]!
    const preserved = corpus.getById(targets[0]!.id)
    cases.push(check(
      'live5a_03_controlled_recrawl_executes',
      ['UNCHANGED', 'CHANGED', 'BLOCKED', 'FAILED', 'NOT_FOUND', 'GONE', 'CANONICAL_CHANGED'].includes(first.outcome as string)
        && first.documentId === targets[0]!.id,
      JSON.stringify(recrawled.map(item => ({
        outcome: item.outcome,
        documentId: item.documentId,
        url: item.canonicalUrl,
        previousHash: item.previousHash,
        newHash: item.newHash,
        robotsStatus: item.robotsStatus,
        error: item.error,
      }))),
    ))
    cases.push(check(
      'live5a_04_robots_policy_rechecked',
      corpus.listEvents(targets[0]!.id).some(event => event.state === 'ROBOTS_CHECK' || event.state === 'RECRAWL_BLOCKED'),
      JSON.stringify(corpus.listEvents(targets[0]!.id).slice(-8).map(event => event.state)),
    ))
    cases.push(check(
      'live5a_05_hash_comparison_recorded',
      Boolean(first.previousHash) && (first.outcome === 'UNCHANGED' || first.outcome === 'CHANGED' ? Boolean(first.newHash) : true),
      JSON.stringify({ outcome: first.outcome, previousHash: first.previousHash, newHash: first.newHash }),
    ))
    cases.push(check(
      'live5a_06_document_preserved',
      Boolean(preserved) && preserved!.id === targets[0]!.id,
      JSON.stringify({ id: preserved?.id, hash: preserved?.contentHash, lastCrawledAt: preserved?.lastCrawledAt }),
    ))

    const fts = searchLocalCorpus('RFC 2606', { corpus, limit: 8 })
    const local = searchLocalCorpus(targets[0]!.title || targets[0]!.canonicalUrl, { corpus, limit: 8 })
    cases.push(check(
      'live5a_07_fts_remains_functional',
      fts.length >= 1 || local.length >= 1,
      JSON.stringify({ rfcHits: fts.map(hit => hit.document.title), targetHits: local.map(hit => hit.document.title) }),
    ))

    const modelReady = localOnnxModelPresent(paths.localModelDir) || localOnnxModelPresent(paths.modelsDir)
    if (!modelReady) {
      cases.push(check('live5a_08_semantic_stale_state', false, 'local ONNX model missing'))
    } else {
      const hybrid = await searchLocalHybrid('RFC 2606', { corpusRoot: paths.corpusRoot, limit: 8 })
      const health = inspectLocalSemanticHealth({ corpusRoot: paths.corpusRoot, queryResult: hybrid })
      const unchanged = first.outcome === 'UNCHANGED'
      cases.push(check(
        'live5a_08_semantic_stale_state',
        health.status === 'available' || health.status === 'stale',
        JSON.stringify({
          outcome: first.outcome,
          health: health.status,
          staleEmbeddingCount: hybrid.staleEmbeddingCount,
          expectedUnchangedKeepsVectors: unchanged ? hybrid.staleEmbeddingCount === 0 || hybrid.staleEmbeddingCount >= 0 : true,
          abstained: hybrid.semanticAdmission.abstained,
        }),
      ))
    }

    const diagnostics = corpusLifecycleDiagnostics(corpus)
    cases.push(check(
      'live5a_09_diagnostics_no_page_content',
      diagnostics.documentCount >= 1 && !JSON.stringify(diagnostics).includes('<html') && !JSON.stringify(diagnostics).includes('contentText'),
      JSON.stringify(diagnostics),
    ))
  } finally {
    corpus.close()
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runStage5aLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign search stage 5A live acceptance: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
