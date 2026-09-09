import { readFileSync } from 'node:fs'
import { crawlApprovedUrl } from './crawlUrl'
import { crawlApprovedBatch, parseBatchInputJson } from './batchCrawl'
import { isEvidenceDiscoveryProvider } from '../discoveryProvider'
import type { CrawlApproval, CrawlApprovalActor } from './types'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find(value => value.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const url = arg('url')
const inputPath = arg('input')
const actor = (arg('approved-by') ?? '') as CrawlApprovalActor

if (!url && !inputPath) {
  console.error('Usage: pnpm run sovereign-search:crawl -- --approved-by=commander|trusted_internal_test (--url=https://example.com | --input=batch.json) [--allow-internal] [--discovered-via=SEARXNG|GOOGLE|TAVILY|RSS|COMMANDER]')
  process.exit(1)
}
if (url && inputPath) {
  console.error('Refusing: provide either --url or --input, not both.')
  process.exit(1)
}
if (actor !== 'commander' && actor !== 'trusted_internal_test') {
  console.error('Refusing: --approved-by must be commander or trusted_internal_test.')
  process.exit(1)
}
if (inputPath && /^https?:\/\//i.test(inputPath)) {
  console.error('Refusing: --input must be a local operator file, not a URL.')
  process.exit(1)
}

const approval: CrawlApproval = {
  actor,
  allowInternalHosts: flag('allow-internal'),
  note: 'cli',
}

const discoveredViaArg = arg('discovered-via')
const discoveredVia = discoveredViaArg
  ? (isEvidenceDiscoveryProvider(discoveredViaArg) ? discoveredViaArg : null)
  : null
if (discoveredViaArg && !discoveredVia) {
  console.error('Refusing: --discovered-via must be a known discovery provider.')
  process.exit(1)
}

if (inputPath) {
  let raw: string
  try {
    raw = readFileSync(inputPath, 'utf8')
  } catch (error) {
    console.error(`Refusing: could not read --input file (${error instanceof Error ? error.message : 'read failed'}).`)
    process.exit(1)
  }
  const parsed = parseBatchInputJson(raw)
  if (parsed.error) {
    console.error(`Refusing: ${parsed.error}`)
    process.exit(1)
  }
  const result = await crawlApprovedBatch({
    urls: parsed.urls,
    approval,
  })
  console.log(JSON.stringify({
    ok: result.ok,
    error: result.error,
    errorCategory: result.errorCategory,
    summary: result.summary,
    items: result.items.map(item => ({
      url: item.url,
      status: item.status,
      documentId: item.documentId,
      canonicalUrl: item.canonicalUrl,
      publisher: item.publisher,
      contentHash: item.contentHash,
      discoveredVia: item.discoveredVia,
      robotsStatus: item.robotsStatus,
      error: item.error,
    })),
  }, null, 2))
  if (result.errorCategory === 'BATCH_LIMIT' || result.errorCategory === 'STORAGE_FAILED') process.exit(1)
} else {
  const result = await crawlApprovedUrl({
    url: url!,
    approval,
    discoveredVia,
  })
  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    robotsStatus: result.robotsStatus,
    error: result.error,
    documentId: result.document?.id ?? null,
    canonicalUrl: result.document?.canonicalUrl ?? null,
    publisher: result.document?.publisher ?? null,
    contentHash: result.document?.contentHash ?? null,
    storageOrigin: result.document?.sourceOrigin ?? null,
  }, null, 2))
  if (!result.ok) process.exit(1)
}
