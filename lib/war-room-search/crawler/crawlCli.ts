import { crawlApprovedUrl } from './crawlUrl'
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
const actor = (arg('approved-by') ?? '') as CrawlApprovalActor
if (!url) {
  console.error('Usage: pnpm run crawl:approved-url -- --url=https://example.com --approved-by=commander|trusted_internal_test [--allow-internal] [--discovered-via=SEARXNG]')
  process.exit(1)
}
if (actor !== 'commander' && actor !== 'trusted_internal_test') {
  console.error('Refusing: --approved-by must be commander or trusted_internal_test.')
  process.exit(1)
}

const approval: CrawlApproval = {
  actor,
  allowInternalHosts: flag('allow-internal'),
  note: 'cli',
}

const result = await crawlApprovedUrl({
  url,
  approval,
  discoveredVia: arg('discovered-via') === 'SEARXNG' || arg('discovered-via') === 'GOOGLE' || arg('discovered-via') === 'TAVILY' || arg('discovered-via') === 'RSS' || arg('discovered-via') === 'WAR_ROOM_LOCAL'
    ? arg('discovered-via') as 'SEARXNG'
    : null,
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
