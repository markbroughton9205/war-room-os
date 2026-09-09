import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import { SovereignCorpus } from './corpus'
import { extractHtml, extractPlainText } from './extract'
import { fetchBoundedPage, type FetchImpl } from './fetchPage'
import { evaluateCrawlDestination, readDomainPolicy, type LookupFn } from './policy'
import {
  evaluateRobotsForPath,
  robotsStatusFromFetchFailure,
  robotsStatusUnknown,
} from './robots'
import {
  WAR_ROOM_BOT_USER_AGENT,
  WAR_ROOM_STORAGE_ORIGIN,
  type CrawlApproval,
  type CrawlEventRecord,
  type CrawlResult,
  type DomainPolicy,
  type RobotsStatus,
} from './types'

export type CrawlUrlInput = {
  url: string
  approval: CrawlApproval | null
  discoveredVia?: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia?: EvidenceDiscoveryProvider[]
  corpus?: SovereignCorpus
  corpusRoot?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  now?: string
}

function robotsUrlFor(target: string): string | null {
  try {
    const parsed = new URL(target)
    return `${parsed.origin}/robots.txt`
  } catch {
    return null
  }
}

export async function checkRobots(args: {
  url: string
  approval: CrawlApproval
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
}): Promise<{ status: RobotsStatus; detail: string }> {
  const robotsUrl = robotsUrlFor(args.url)
  if (!robotsUrl) return { status: 'ROBOTS_UNKNOWN', detail: 'unparseable' }
  const fetched = await fetchBoundedPage({
    url: robotsUrl,
    approval: args.approval,
    fetchImpl: args.fetchImpl,
    lookup: args.lookup,
    policy: args.policy,
    limits: { timeoutMs: 8_000, maxBytes: 64_000, maxRedirects: 2 },
    userAgent: WAR_ROOM_BOT_USER_AGENT,
  })
  if (!fetched.ok) {
    if (fetched.status === 404 || fetched.errorCategory === 'HTTP_STATUS' && fetched.status === 404) {
      return { status: robotsStatusUnknown().status, detail: 'robots_missing' }
    }
    if (fetched.errorCategory === 'FETCH_ERROR' || fetched.errorCategory === 'TIMEOUT') {
      return { status: robotsStatusFromFetchFailure().status, detail: fetched.error }
    }
    if (fetched.status && fetched.status >= 500) {
      return { status: robotsStatusFromFetchFailure().status, detail: `robots_http_${fetched.status}` }
    }
    if (fetched.status === 404) return { status: 'ROBOTS_UNKNOWN', detail: 'robots_missing' }
    return { status: robotsStatusFromFetchFailure().status, detail: fetched.error }
  }
  let pathname = '/'
  try {
    pathname = new URL(args.url).pathname || '/'
  } catch {
    pathname = '/'
  }
  const decision = evaluateRobotsForPath(fetched.body, pathname, WAR_ROOM_BOT_USER_AGENT)
  return { status: decision.status, detail: decision.matchedPath ?? 'no_rule' }
}

export async function crawlApprovedUrl(input: CrawlUrlInput): Promise<CrawlResult> {
  const started = Date.now()
  const events: CrawlEventRecord[] = []
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const ownsCorpus = !input.corpus
  const policy = input.policy ?? readDomainPolicy()
  const now = input.now ?? new Date().toISOString()

  const push = (event: Parameters<SovereignCorpus['recordEvent']>[0]) => {
    const recorded = corpus.recordEvent({ ...event, durationMs: event.durationMs ?? Date.now() - started })
    events.push(recorded)
    return recorded
  }

  try {
    push({ state: 'QUEUED', url: input.url, durationMs: 0 })

    if (!input.approval) {
      push({
        state: 'BLOCKED_POLICY',
        url: input.url,
        errorCategory: 'UNAPPROVED',
        durationMs: Date.now() - started,
      })
      return {
        ok: false,
        status: 'BLOCKED_POLICY',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: null,
        errorCategory: 'UNAPPROVED',
        error: 'Crawl requires Commander or trusted internal approval.',
        durationMs: Date.now() - started,
        events,
      }
    }

    const destination = await evaluateCrawlDestination({
      url: input.url,
      approval: input.approval,
      policy,
      lookup: input.lookup,
    })
    if (!destination.allowed) {
      push({
        state: 'BLOCKED_POLICY',
        url: input.url,
        errorCategory: destination.category,
        durationMs: Date.now() - started,
      })
      return {
        ok: false,
        status: 'BLOCKED_POLICY',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: null,
        errorCategory: destination.category,
        error: destination.reason,
        durationMs: Date.now() - started,
        events,
      }
    }

    push({ state: 'ROBOTS_CHECK', url: input.url, durationMs: Date.now() - started })
    const robots = await checkRobots({
      url: input.url,
      approval: input.approval,
      fetchImpl: input.fetchImpl,
      lookup: input.lookup,
      policy,
    })
    if (robots.status === 'ROBOTS_DISALLOWED' || robots.status === 'ROBOTS_FETCH_ERROR') {
      push({
        state: 'BLOCKED_ROBOTS',
        url: input.url,
        robotsStatus: robots.status,
        errorCategory: robots.status,
        durationMs: Date.now() - started,
      })
      return {
        ok: false,
        status: 'BLOCKED_ROBOTS',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: robots.status,
        errorCategory: robots.status,
        error: robots.status === 'ROBOTS_FETCH_ERROR'
          ? `robots.txt could not be fetched (${robots.detail}); conservative refusal.`
          : 'robots.txt disallows WarRoomBot for this path.',
        durationMs: Date.now() - started,
        events,
      }
    }

    push({ state: 'FETCHING', url: input.url, robotsStatus: robots.status, durationMs: Date.now() - started })
    const fetched = await fetchBoundedPage({
      url: input.url,
      approval: input.approval,
      fetchImpl: input.fetchImpl,
      lookup: input.lookup,
      policy,
    })
    if (!fetched.ok) {
      push({
        state: 'FAILED',
        url: input.url,
        httpStatus: fetched.status,
        bytesReceived: fetched.bytesReceived,
        contentType: fetched.contentType,
        errorCategory: fetched.errorCategory,
        robotsStatus: robots.status,
        durationMs: Date.now() - started,
      })
      return {
        ok: false,
        status: 'FAILED',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: robots.status,
        errorCategory: fetched.errorCategory,
        error: fetched.error,
        durationMs: Date.now() - started,
        events,
      }
    }

    push({
      state: 'FETCHED',
      url: fetched.finalUrl,
      httpStatus: fetched.status,
      bytesReceived: fetched.bytesReceived,
      contentType: fetched.contentType,
      robotsStatus: robots.status,
      durationMs: Date.now() - started,
    })
    push({ state: 'EXTRACTING', url: fetched.finalUrl, durationMs: Date.now() - started })

    const extracted = fetched.acceptedKind === 'plain' ? extractPlainText(fetched.body) : extractHtml(fetched.body)
    const canonicalUrl = canonicalizeUrl(extracted.canonicalDeclared)
      ?? canonicalizeUrl(fetched.finalUrl)
      ?? canonicalizeUrl(input.url)
    if (!canonicalUrl) {
      return {
        ok: false,
        status: 'FAILED',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: robots.status,
        errorCategory: 'CANONICAL_URL',
        error: 'Could not canonicalize the fetched URL.',
        durationMs: Date.now() - started,
        events,
      }
    }

    const hashSource = [extracted.title, extracted.description, extracted.text].filter(Boolean).join('\n')
    const contentHash = hashEvidenceContent(hashSource)
    if (!contentHash) {
      return {
        ok: false,
        status: 'FAILED',
        document: null,
        duplicateOfDocumentId: null,
        robotsStatus: robots.status,
        errorCategory: 'EMPTY_CONTENT',
        error: 'Extracted content was empty; refusing to index.',
        durationMs: Date.now() - started,
        events,
      }
    }

    const domain = hostnameFromUrl(canonicalUrl) ?? hostnameFromUrl(fetched.finalUrl) ?? 'unknown'
    const existingByUrl = corpus.getByCanonicalUrl(canonicalUrl)
    const existingByHash = corpus.findByContentHash(contentHash, canonicalUrl)
    const crawlStatus = existingByUrl ? 'DUPLICATE_URL' : existingByHash ? 'DUPLICATE_CONTENT' : 'INDEXED'
    const also = [...new Set([
      ...(input.alsoDiscoveredVia ?? []),
      ...(existingByUrl?.alsoDiscoveredVia ?? []),
      ...(existingByUrl?.discoveredVia ? [existingByUrl.discoveredVia] : []),
    ])].filter((value): value is EvidenceDiscoveryProvider => Boolean(value) && value !== (input.discoveredVia ?? existingByUrl?.discoveredVia))

    const document = corpus.upsertDocument({
      originalUrl: input.url,
      finalUrl: fetched.finalUrl,
      canonicalUrl,
      domain,
      publisher: domain,
      title: extracted.title,
      description: extracted.description,
      language: extracted.language,
      publishedAt: extracted.publishedAt,
      author: extracted.author,
      lastCrawledAt: now,
      contentHash,
      contentText: extracted.text,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      robotsStatus: robots.status,
      crawlStatus,
      sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
      discoveredVia: input.discoveredVia ?? existingByUrl?.discoveredVia ?? null,
      alsoDiscoveredVia: also,
      bytesReceived: fetched.bytesReceived,
    })

    push({
      state: crawlStatus,
      url: fetched.finalUrl,
      canonicalUrl,
      documentId: document.id,
      httpStatus: fetched.status,
      bytesReceived: fetched.bytesReceived,
      contentType: fetched.contentType,
      contentHash,
      robotsStatus: robots.status,
      durationMs: Date.now() - started,
    })

    return {
      ok: true,
      status: crawlStatus,
      document,
      duplicateOfDocumentId: existingByHash && !existingByUrl ? existingByHash.id : existingByUrl && crawlStatus === 'DUPLICATE_URL' ? existingByUrl.id : null,
      robotsStatus: robots.status,
      errorCategory: null,
      error: null,
      durationMs: Date.now() - started,
      events,
    }
  } finally {
    if (ownsCorpus) corpus.close()
  }
}
