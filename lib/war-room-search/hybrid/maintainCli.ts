import { isTrustedCrawlActor } from '../crawler/candidates'
import { corpusLifecycleDiagnostics } from '../crawler/freshness'
import { SovereignCorpus } from '../crawler/corpus'
import { MAX_MAINTENANCE_BATCH, type CrawlApproval, type CrawlApprovalActor } from '../crawler/types'
import { runSovereignMaintenance } from './maintain'

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
    'Usage: pnpm run sovereign-search:maintain -- <flags>',
    '  --approved-by=commander|trusted_internal_test',
    '  --recrawl-due',
    '  --recrawl=<documentId>',
    '  --reembed-stale',
    '  --reembed=<documentId>',
    '  --limit=N',
    '  --diagnostics',
    '  [--allow-internal]',
  ].join('\n'))
  process.exit(1)
}

const actor = (arg('approved-by') ?? '') as CrawlApprovalActor
const approval: CrawlApproval | null = isTrustedCrawlActor(actor)
  ? { actor, allowInternalHosts: flag('allow-internal'), note: 'cli-maintain' }
  : null

if (flag('diagnostics') && !flag('recrawl-due') && !flag('reembed-stale') && !arg('recrawl') && !arg('reembed')) {
  const corpus = new SovereignCorpus()
  try {
    console.log(JSON.stringify(corpusLifecycleDiagnostics(corpus), null, 2))
  } finally {
    corpus.close()
  }
} else if (flag('recrawl-due') || flag('reembed-stale') || arg('recrawl') || arg('reembed')) {
  if (!approval) {
    console.error('Refusing: --approved-by must be commander or trusted_internal_test. Council cannot authorize maintenance.')
    process.exit(1)
  }
  const recrawlRaw = arg('recrawl')
  const reembedRaw = arg('reembed')
  const recrawlDocumentId = recrawlRaw ? Number(recrawlRaw) : undefined
  const reembedDocumentId = reembedRaw ? Number(reembedRaw) : undefined
  if (recrawlRaw && (!Number.isInteger(recrawlDocumentId) || recrawlDocumentId! < 1)) {
    console.error('Refusing: --recrawl must be a positive document id.')
    process.exit(1)
  }
  if (reembedRaw && (!Number.isInteger(reembedDocumentId) || reembedDocumentId! < 1)) {
    console.error('Refusing: --reembed must be a positive document id.')
    process.exit(1)
  }
  const limit = Number(arg('limit') ?? MAX_MAINTENANCE_BATCH)
  const result = await runSovereignMaintenance({
    approval,
    recrawlDue: flag('recrawl-due'),
    recrawlDocumentId,
    reembedStale: flag('reembed-stale'),
    reembedDocumentId,
    limit,
  })
  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    recoveredExpiredLock: result.recoveredExpiredLock,
    requested: result.requested,
    recrawled: result.recrawled,
    changed: result.changed,
    unchanged: result.unchanged,
    blocked: result.blocked,
    failed: result.failed,
    reembedded: result.reembedded,
    reembedFailures: result.reembedFailures,
    skippedCurrent: result.skippedCurrent,
    staleVectorDocuments: result.staleVectorDocuments,
    error: result.error,
    diagnostics: result.diagnostics,
  }, null, 2))
  if (!result.ok) process.exit(1)
} else {
  usage()
}
