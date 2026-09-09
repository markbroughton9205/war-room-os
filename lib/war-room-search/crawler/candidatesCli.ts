import { readFileSync } from 'node:fs'
import {
  approveIngestCandidates,
  discoverIngestCandidates,
  ingestApprovedCandidates,
  isTrustedCrawlActor,
  listIngestCandidates,
  proposeIngestCandidates,
  recommendIngestCandidate,
  rejectIngestCandidates,
} from './candidates'
import { isEvidenceDiscoveryProvider } from '../discoveryProvider'
import type { CrawlApprovalActor, IngestCandidateActor, IngestCandidateStatus } from './types'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find(value => value.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function parseIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(part => Number(part.trim())).filter(id => Number.isInteger(id) && id > 0)
}

function parseIndexes(raw: string | undefined): number[] | undefined {
  if (!raw?.trim()) return undefined
  return raw.split(',').map(part => Number(part.trim())).filter(index => Number.isInteger(index) && index >= 0)
}

function usage(): never {
  console.error([
    'Usage: pnpm run sovereign-search:candidates -- <command>',
    '  --discover --query="..." [--select-index=0,1] [--limit=8]',
    '  --from-results=results.json --query-context="..."',
    '  --list [--status=PENDING]',
    '  --approve=1,2 --approved-by=commander',
    '  --reject=3 --approved-by=commander',
    '  --recommend=1 --actor=council',
    '  --ingest=1,2 --approved-by=commander [--allow-internal]',
  ].join('\n'))
  process.exit(1)
}

const actor = (arg('approved-by') ?? arg('actor') ?? '') as IngestCandidateActor
const query = arg('query')
const selectIndexes = parseIndexes(arg('select-index'))
const status = arg('status') as IngestCandidateStatus | undefined

if (flag('discover')) {
  if (!query) usage()
  const limit = Number(arg('limit') ?? 8)
  const result = await discoverIngestCandidates({
    request: { query: query!, options: { limit: Number.isFinite(limit) ? limit : 8 } },
    selectIndexes,
  })
  console.log(JSON.stringify({
    query: result.search.query,
    resultCount: result.search.resultCount,
    candidateError: result.candidateError,
    proposed: {
      created: result.proposed.created,
      merged: result.proposed.merged,
      alreadyIndexed: result.proposed.alreadyIndexed,
      skipped: result.proposed.skipped,
      items: result.proposed.items.map(item => ({
        action: item.action,
        candidateId: item.candidate?.id ?? null,
        url: item.url,
        canonicalCandidateUrl: item.canonicalCandidateUrl,
        status: item.candidate?.status ?? null,
        discoveredVia: item.candidate?.discoveredVia ?? null,
        alsoDiscoveredVia: item.candidate?.alsoDiscoveredVia ?? [],
      })),
    },
    discovery: result.search.results.map((item, index) => ({
      index,
      title: item.title,
      url: item.url,
      canonicalUrl: item.canonicalUrl,
      publisher: item.publisher,
      discoveredVia: item.discoveredVia,
      alsoDiscoveredVia: item.alsoDiscoveredVia,
    })),
  }, null, 2))
} else if (arg('from-results')) {
  const raw = readFileSync(arg('from-results')!, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  const results = Array.isArray(parsed) ? parsed : (parsed as { results?: unknown }).results
  if (!Array.isArray(results)) {
    console.error('Refusing: --from-results must be a JSON array or { "results": [...] }.')
    process.exit(1)
  }
  const proposed = proposeIngestCandidates({
    queryContext: arg('query-context') ?? null,
    results: results.map(entry => {
      const record = entry as { url?: string; canonicalUrl?: string; title?: string; snippet?: string; publisher?: string; discoveredVia?: unknown; alsoDiscoveredVia?: unknown }
      return {
        url: record.url ?? null,
        canonicalUrl: record.canonicalUrl ?? null,
        title: record.title ?? null,
        snippet: record.snippet ?? null,
        publisher: record.publisher ?? null,
        discoveredVia: isEvidenceDiscoveryProvider(record.discoveredVia) ? record.discoveredVia : null,
        alsoDiscoveredVia: Array.isArray(record.alsoDiscoveredVia) ? record.alsoDiscoveredVia.filter(isEvidenceDiscoveryProvider) : null,
      }
    }),
  })
  console.log(JSON.stringify(proposed, null, 2))
} else if (flag('list')) {
  const candidates = listIngestCandidates({ status: status ?? null })
  console.log(JSON.stringify(candidates.map(candidate => ({
    candidateId: candidate.id,
    url: candidate.url,
    canonicalCandidateUrl: candidate.canonicalCandidateUrl,
    title: candidate.title,
    publisher: candidate.publisher,
    discoveredVia: candidate.discoveredVia,
    alsoDiscoveredVia: candidate.alsoDiscoveredVia,
    status: candidate.status,
    approvedBy: candidate.approvedBy,
    approvedAt: candidate.approvedAt,
    rejectedBy: candidate.rejectedBy,
    rejectedAt: candidate.rejectedAt,
    documentId: candidate.documentId,
    queryContext: candidate.queryContext,
  })), null, 2))
} else if (arg('approve')) {
  const result = approveIngestCandidates({ ids: parseIds(arg('approve')), actor })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
} else if (arg('reject')) {
  const result = rejectIngestCandidates({ ids: parseIds(arg('reject')), actor, reason: arg('reason') ?? null })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
} else if (arg('recommend')) {
  const result = recommendIngestCandidate({
    id: parseIds(arg('recommend'))[0] ?? 0,
    actor: actor || 'council',
    note: arg('note') ?? 'recommend_ingest',
  })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
} else if (arg('ingest')) {
  if (!isTrustedCrawlActor(actor)) {
    console.error('Refusing: --approved-by must be commander or trusted_internal_test.')
    process.exit(1)
  }
  const approval = {
    actor: actor as CrawlApprovalActor,
    allowInternalHosts: flag('allow-internal'),
    note: 'stage3c-cli',
  }
  const result = await ingestApprovedCandidates({ ids: parseIds(arg('ingest')), approval })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
} else {
  usage()
}
