import { corpusLifecycleDiagnostics, listDocumentFreshness, listDueDocuments, readFreshnessPolicy } from './freshness'
import { recrawlDueDocuments, recrawlStoredDocument } from './recrawl'
import { isTrustedCrawlActor } from './candidates'
import { MAX_RECRAWL_BATCH, type CrawlApproval, type CrawlApprovalActor } from './types'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find(value => value.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function usage(): never {
  console.error([
    'Usage: pnpm run sovereign-search:lifecycle -- <command>',
    '  --list-freshness',
    '  --list-due',
    '  --diagnostics',
    '  --recrawl=<documentId> --approved-by=commander|trusted_internal_test [--allow-internal]',
    '  --recrawl-due --limit=N --approved-by=commander|trusted_internal_test [--allow-internal]',
  ].join('\n'))
  process.exit(1)
}

const actor = (arg('approved-by') ?? '') as CrawlApprovalActor
const approval: CrawlApproval | null = isTrustedCrawlActor(actor)
  ? { actor, allowInternalHosts: flag('allow-internal'), note: 'cli-lifecycle' }
  : null

if (flag('list-freshness')) {
  const { SovereignCorpus } = await import('./corpus')
  const corpus = new SovereignCorpus()
  try {
    console.log(JSON.stringify({
      policy: readFreshnessPolicy(),
      documents: listDocumentFreshness(corpus).map(row => ({
        documentId: row.documentId,
        canonicalUrl: row.canonicalUrl,
        domain: row.domain,
        lastCrawledAt: row.lastCrawledAt,
        intervalHours: row.intervalHours,
        dueAt: row.dueAt,
        freshness: row.freshness,
        lifecycleStatus: row.lifecycleStatus,
        sourceAvailability: row.sourceAvailability,
        lastRecrawlOutcome: row.lastRecrawlOutcome,
        contentHash: row.contentHash,
      })),
    }, null, 2))
  } finally {
    corpus.close()
  }
} else if (flag('list-due')) {
  const { SovereignCorpus } = await import('./corpus')
  const corpus = new SovereignCorpus()
  try {
    console.log(JSON.stringify({
      due: listDueDocuments(corpus).map(row => ({
        documentId: row.documentId,
        canonicalUrl: row.canonicalUrl,
        lastCrawledAt: row.lastCrawledAt,
        dueAt: row.dueAt,
        freshness: row.freshness,
        lifecycleStatus: row.lifecycleStatus,
      })),
    }, null, 2))
  } finally {
    corpus.close()
  }
} else if (flag('diagnostics')) {
  const { SovereignCorpus } = await import('./corpus')
  const corpus = new SovereignCorpus()
  try {
    console.log(JSON.stringify(corpusLifecycleDiagnostics(corpus), null, 2))
  } finally {
    corpus.close()
  }
} else if (arg('recrawl')) {
  if (!approval) {
    console.error('Refusing: --approved-by must be commander or trusted_internal_test. Council cannot authorize recrawl.')
    process.exit(1)
  }
  const documentId = Number(arg('recrawl'))
  if (!Number.isInteger(documentId) || documentId < 1) {
    console.error('Refusing: --recrawl must be a positive document id.')
    process.exit(1)
  }
  const result = await recrawlStoredDocument({ documentId, approval })
  console.log(JSON.stringify({
    ok: result.ok,
    outcome: result.outcome,
    documentId: result.documentId,
    canonicalUrl: result.canonicalUrl,
    previousHash: result.previousHash,
    newHash: result.newHash,
    canonicalChanged: result.canonicalChanged,
    robotsStatus: result.robotsStatus,
    httpStatus: result.httpStatus,
    staleEmbeddingCount: result.staleEmbeddingCount,
    error: result.error,
  }, null, 2))
  if (!result.ok) process.exit(1)
} else if (flag('recrawl-due')) {
  if (!approval) {
    console.error('Refusing: --approved-by must be commander or trusted_internal_test. Council cannot authorize recrawl.')
    process.exit(1)
  }
  const limit = Number(arg('limit') ?? MAX_RECRAWL_BATCH)
  const result = await recrawlDueDocuments({ approval, limit })
  console.log(JSON.stringify({
    ok: result.ok,
    error: result.error,
    errorCategory: result.errorCategory,
    requested: result.requested,
    processed: result.processed,
    items: result.items.map(item => ({
      ok: item.ok,
      outcome: item.outcome,
      documentId: item.documentId,
      canonicalUrl: item.canonicalUrl,
      previousHash: item.previousHash,
      newHash: item.newHash,
      error: item.error,
    })),
  }, null, 2))
  if (!result.ok) process.exit(1)
} else {
  usage()
}
