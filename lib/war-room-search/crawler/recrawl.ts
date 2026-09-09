import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import { isTrustedCrawlActor } from './candidates'
import { SovereignCorpus } from './corpus'
import { checkRobots } from './crawlUrl'
import { extractHtml, extractPlainText } from './extract'
import { fetchBoundedPage, type FetchImpl } from './fetchPage'
import { listDueDocuments, readFreshnessPolicy } from './freshness'
import { evaluateCrawlDestination, readDomainPolicy, type LookupFn } from './policy'
import { resolveHybridPaths } from '../hybrid/modelStore'
import { SqliteVectorStore } from '../hybrid/vectors'
import {
  MAX_RECRAWL_BATCH,
  WAR_ROOM_STORAGE_ORIGIN,
  type CrawlApproval,
  type CrawlDocumentRecord,
  type CrawlLimits,
  type DocumentFreshness,
  type DomainPolicy,
  type FreshnessPolicy,
  type RecrawlOutcome,
  type RobotsStatus,
  type SourceAvailability,
} from './types'

export type RecrawlResult = {
  ok: boolean
  outcome: RecrawlOutcome | 'UNAPPROVED' | 'MISSING_DOCUMENT'
  documentId: number | null
  canonicalUrl: string | null
  previousHash: string | null
  newHash: string | null
  observedCanonicalUrl: string | null
  canonicalChanged: boolean
  robotsStatus: RobotsStatus | null
  httpStatus: number | null
  errorCategory: string | null
  error: string | null
  staleEmbeddingCount: number | null
  durationMs: number
  document: CrawlDocumentRecord | null
}

export type RecrawlDueResult = {
  ok: boolean
  error: string | null
  errorCategory: string | null
  requested: number
  processed: number
  items: RecrawlResult[]
  durationMs: number
}

function emptyResult(partial: Partial<RecrawlResult> & Pick<RecrawlResult, 'ok' | 'outcome' | 'durationMs'>): RecrawlResult {
  return {
    documentId: null,
    canonicalUrl: null,
    previousHash: null,
    newHash: null,
    observedCanonicalUrl: null,
    canonicalChanged: false,
    robotsStatus: null,
    httpStatus: null,
    errorCategory: null,
    error: null,
    staleEmbeddingCount: null,
    document: null,
    ...partial,
  }
}

function countStaleEmbeddings(corpus: SovereignCorpus, documentId: number): number | null {
  const paths = resolveHybridPaths({ corpusRoot: corpus.paths.rootDir })
  const opened = SqliteVectorStore.tryOpen(paths.vectorDbPath)
  if (opened === 'missing' || opened === 'corrupt') return null
  try {
    const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
    return opened.listStaleEmbeddings(hashes).filter(row => {
      const chunk = opened.getChunk(row.chunkId)
      return chunk?.documentId === documentId
    }).length
  } finally {
    opened.close()
  }
}

function classifyHttpFailure(status: number | null): RecrawlOutcome | null {
  if (status === 404) return 'NOT_FOUND'
  if (status === 410) return 'GONE'
  return null
}

export async function recrawlStoredDocument(input: {
  documentId?: number
  canonicalUrl?: string
  approval: CrawlApproval | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  freshnessPolicy?: FreshnessPolicy
  now?: string
  limits?: Partial<CrawlLimits>
  recordRun?: boolean
}): Promise<RecrawlResult> {
  const started = Date.now()
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const ownsCorpus = !input.corpus
  const policy = input.policy ?? readDomainPolicy()
  const now = input.now ?? new Date().toISOString()
  const recordRun = input.recordRun !== false

  try {
    if (!input.approval || !isTrustedCrawlActor(input.approval.actor)) {
      corpus.recordEvent({
        state: 'BLOCKED_POLICY',
        url: input.canonicalUrl ?? String(input.documentId ?? ''),
        errorCategory: 'UNAPPROVED',
        durationMs: Date.now() - started,
      })
      return (emptyResult({
        ok: false,
        outcome: 'UNAPPROVED',
        errorCategory: 'UNAPPROVED',
        error: 'Recrawl requires Commander or trusted internal approval. Council cannot authorize recrawl.',
        durationMs: Date.now() - started,
      }))
    }

    const existing = input.documentId != null
      ? corpus.getById(input.documentId)
      : input.canonicalUrl
        ? corpus.getByCanonicalUrl(input.canonicalUrl)
        : null
    if (!existing) {
      return (emptyResult({
        ok: false,
        outcome: 'MISSING_DOCUMENT',
        errorCategory: 'MISSING_DOCUMENT',
        error: 'Recrawl target is not an existing corpus document.',
        durationMs: Date.now() - started,
      }))
    }

    const fetchUrl = existing.originalUrl || existing.canonicalUrl
    const previousHash = existing.contentHash
    const previousText = existing.contentText
    const previousTitle = existing.title
    const previousDescription = existing.description
    const previousStatus = existing.crawlStatus
    const previousHttp = existing.httpStatus

    corpus.recordEvent({
      state: 'RECRAWL_STARTED',
      url: fetchUrl,
      documentId: existing.id,
      canonicalUrl: existing.canonicalUrl,
      contentHash: previousHash,
      durationMs: Date.now() - started,
    })

    const persistFailure = (args: {
      outcome: RecrawlOutcome
      eventState: 'RECRAWL_BLOCKED' | 'RECRAWL_FAILED' | 'SOURCE_NOT_FOUND' | 'SOURCE_GONE'
      robotsStatus: RobotsStatus | null
      httpStatus: number | null
      errorCategory: string
      error: string
      sourceAvailability?: SourceAvailability
      observedCanonicalUrl?: string | null
    }): RecrawlResult => {
      const currentMeta = corpus.getLifecycleMeta(existing.id)
      const observed = args.observedCanonicalUrl ?? existing.canonicalUrl
      const canonicalShift = Boolean(observed && observed !== existing.canonicalUrl)
      corpus.patchLifecycleMeta(existing.id, {
        lastRecrawlAt: now,
        lastRecrawlOutcome: args.outcome,
        previousContentHash: previousHash,
        sourceAvailability: args.sourceAvailability ?? currentMeta.sourceAvailability,
        lastErrorCategory: args.errorCategory,
        lastObservedCanonicalUrl: observed,
        canonicalChanged: canonicalShift,
      })
      corpus.insertDocumentVersion({
        documentId: existing.id,
        canonicalUrl: existing.canonicalUrl,
        previousHash,
        newHash: null,
        changeStatus: args.outcome,
        httpStatus: args.httpStatus,
        robotsStatus: args.robotsStatus,
        observedCanonicalUrl: observed,
        canonicalChanged: canonicalShift,
        createdAt: now,
      })
      corpus.recordEvent({
        state: args.eventState,
        url: fetchUrl,
        documentId: existing.id,
        canonicalUrl: existing.canonicalUrl,
        httpStatus: args.httpStatus,
        contentHash: previousHash,
        robotsStatus: args.robotsStatus,
        errorCategory: args.errorCategory,
        durationMs: Date.now() - started,
      })
      return emptyResult({
        ok: false,
        outcome: args.outcome,
        documentId: existing.id,
        canonicalUrl: existing.canonicalUrl,
        previousHash,
        newHash: null,
        observedCanonicalUrl: observed,
        canonicalChanged: canonicalShift,
        robotsStatus: args.robotsStatus,
        httpStatus: args.httpStatus,
        errorCategory: args.errorCategory,
        error: args.error,
        durationMs: Date.now() - started,
        document: corpus.getById(existing.id),
      })
    }

    const destination = await evaluateCrawlDestination({
      url: fetchUrl,
      approval: input.approval,
      policy,
      lookup: input.lookup,
    })
    if (!destination.allowed) {
      return (persistFailure({
        outcome: 'BLOCKED',
        eventState: 'RECRAWL_BLOCKED',
        robotsStatus: null,
        httpStatus: null,
        errorCategory: destination.category,
        error: destination.reason,
      }))
    }

    corpus.recordEvent({
      state: 'ROBOTS_CHECK',
      url: fetchUrl,
      documentId: existing.id,
      canonicalUrl: existing.canonicalUrl,
      durationMs: Date.now() - started,
    })
    const robots = await checkRobots({
      url: fetchUrl,
      approval: input.approval,
      fetchImpl: input.fetchImpl,
      lookup: input.lookup,
      policy,
    })
    if (robots.status === 'ROBOTS_DISALLOWED' || robots.status === 'ROBOTS_FETCH_ERROR') {
      return (persistFailure({
        outcome: 'BLOCKED',
        eventState: 'RECRAWL_BLOCKED',
        robotsStatus: robots.status,
        httpStatus: null,
        errorCategory: robots.status,
        error: robots.status === 'ROBOTS_FETCH_ERROR'
          ? `robots.txt could not be fetched (${robots.detail}); conservative refusal.`
          : 'robots.txt disallows WarRoomBot for this path.',
      }))
    }

    corpus.recordEvent({
      state: 'FETCHING',
      url: fetchUrl,
      documentId: existing.id,
      robotsStatus: robots.status,
      durationMs: Date.now() - started,
    })
    const fetched = await fetchBoundedPage({
      url: fetchUrl,
      approval: input.approval,
      fetchImpl: input.fetchImpl,
      lookup: input.lookup,
      policy,
      limits: input.limits,
    })
    if (!fetched.ok) {
      const policyBlocked = /^(SSRF_|DENYLIST|ALLOWLIST|CRAWL_DISABLED|UNAPPROVED|SCHEME|USERINFO)/.test(fetched.errorCategory)
      if (policyBlocked) {
        return persistFailure({
          outcome: 'BLOCKED',
          eventState: 'RECRAWL_BLOCKED',
          robotsStatus: robots.status,
          httpStatus: fetched.status,
          errorCategory: fetched.errorCategory,
          error: fetched.error,
        })
      }
      const gone = classifyHttpFailure(fetched.status)
      if (gone === 'NOT_FOUND') {
        return (persistFailure({
          outcome: 'NOT_FOUND',
          eventState: 'SOURCE_NOT_FOUND',
          robotsStatus: robots.status,
          httpStatus: fetched.status,
          errorCategory: fetched.errorCategory,
          error: fetched.error,
          sourceAvailability: 'NOT_FOUND',
        }))
      }
      if (gone === 'GONE') {
        return (persistFailure({
          outcome: 'GONE',
          eventState: 'SOURCE_GONE',
          robotsStatus: robots.status,
          httpStatus: fetched.status,
          errorCategory: fetched.errorCategory,
          error: fetched.error,
          sourceAvailability: 'GONE',
        }))
      }
      return (persistFailure({
        outcome: 'FAILED',
        eventState: 'RECRAWL_FAILED',
        robotsStatus: robots.status,
        httpStatus: fetched.status,
        errorCategory: fetched.errorCategory,
        error: fetched.error,
      }))
    }

    const extracted = fetched.acceptedKind === 'plain' ? extractPlainText(fetched.body) : extractHtml(fetched.body)
    const observedCanonical = canonicalizeUrl(extracted.canonicalDeclared)
      ?? canonicalizeUrl(fetched.finalUrl)
      ?? canonicalizeUrl(fetchUrl)
    const canonicalChanged = Boolean(observedCanonical && observedCanonical !== existing.canonicalUrl)
    if (canonicalChanged) {
      return persistFailure({
        outcome: 'CANONICAL_CHANGED',
        eventState: 'RECRAWL_FAILED',
        robotsStatus: robots.status,
        httpStatus: fetched.status,
        errorCategory: 'CANONICAL_CHANGED',
        error: `Redirect/canonical changed to ${observedCanonical}; stored identity ${existing.canonicalUrl} was preserved.`,
        observedCanonicalUrl: observedCanonical,
      })
    }

    const hashSource = [extracted.title, extracted.description, extracted.text].filter(Boolean).join('\n')
    const contentHash = hashEvidenceContent(hashSource)
    if (!contentHash) {
      return (persistFailure({
        outcome: 'FAILED',
        eventState: 'RECRAWL_FAILED',
        robotsStatus: robots.status,
        httpStatus: fetched.status,
        errorCategory: 'EMPTY_CONTENT',
        error: 'Extracted content was empty; preserving last known good document.',
      }))
    }

    const unchanged = contentHash === previousHash
    const outcome: RecrawlOutcome = unchanged ? 'UNCHANGED' : 'CHANGED'

    await corpus.withTransaction(() => {
      if (unchanged) {
        corpus.upsertDocument({
          originalUrl: existing.originalUrl,
          finalUrl: fetched.finalUrl,
          canonicalUrl: existing.canonicalUrl,
          domain: existing.domain,
          publisher: existing.publisher,
          title: existing.title,
          description: existing.description,
          language: existing.language,
          publishedAt: existing.publishedAt,
          author: existing.author,
          lastCrawledAt: now,
          contentHash: previousHash,
          contentText: previousText,
          httpStatus: fetched.status,
          contentType: fetched.contentType,
          robotsStatus: robots.status,
          crawlStatus: previousStatus === 'INDEXED' ? 'INDEXED' : existing.crawlStatus,
          sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
          discoveredVia: existing.discoveredVia,
          alsoDiscoveredVia: existing.alsoDiscoveredVia,
          bytesReceived: fetched.bytesReceived,
          firstSeenAt: existing.firstSeenAt,
        })
      } else {
        corpus.upsertDocument({
          originalUrl: existing.originalUrl,
          finalUrl: fetched.finalUrl,
          canonicalUrl: existing.canonicalUrl,
          domain: existing.domain,
          publisher: existing.publisher,
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
          crawlStatus: 'INDEXED',
          sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
          discoveredVia: existing.discoveredVia,
          alsoDiscoveredVia: existing.alsoDiscoveredVia,
          bytesReceived: fetched.bytesReceived,
          firstSeenAt: existing.firstSeenAt,
        })
      }
      corpus.patchLifecycleMeta(existing.id, {
        lastRecrawlAt: now,
        lastRecrawlOutcome: outcome,
        previousContentHash: previousHash,
        lastChangeAt: unchanged ? corpus.getLifecycleMeta(existing.id).lastChangeAt : now,
        sourceAvailability: 'AVAILABLE',
        lastObservedCanonicalUrl: observedCanonical,
        canonicalChanged: false,
        lastErrorCategory: null,
      })
      corpus.insertDocumentVersion({
        documentId: existing.id,
        canonicalUrl: existing.canonicalUrl,
        previousHash,
        newHash: contentHash,
        changeStatus: outcome,
        httpStatus: fetched.status,
        robotsStatus: robots.status,
        observedCanonicalUrl: observedCanonical,
        canonicalChanged: false,
        createdAt: now,
      })
      corpus.recordEvent({
        state: unchanged ? 'RECRAWL_UNCHANGED' : 'RECRAWL_CHANGED',
        url: fetched.finalUrl,
        documentId: existing.id,
        canonicalUrl: existing.canonicalUrl,
        httpStatus: fetched.status,
        bytesReceived: fetched.bytesReceived,
        contentType: fetched.contentType,
        contentHash,
        robotsStatus: robots.status,
        durationMs: Date.now() - started,
      })
    })

    const updated = corpus.getById(existing.id)!
    if (unchanged && updated.contentText !== previousText) {
      throw new Error('Unchanged recrawl mutated stored content.')
    }
    if (!unchanged && updated.contentHash === previousHash) {
      throw new Error('Changed recrawl failed to persist new content hash.')
    }
    void previousTitle
    void previousDescription
    void previousHttp

    if (recordRun) {
      corpus.insertRecrawlRun({
        startedAt: now,
        finishedAt: now,
        requested: 1,
        processed: 1,
        changed: outcome === 'CHANGED' ? 1 : 0,
        unchanged: outcome === 'UNCHANGED' ? 1 : 0,
        blocked: 0,
        failed: 0,
        notFound: 0,
        gone: 0,
        actor: input.approval.actor,
      })
    }

    return {
      ok: true,
      outcome,
      documentId: existing.id,
      canonicalUrl: existing.canonicalUrl,
      previousHash,
      newHash: contentHash,
      observedCanonicalUrl: observedCanonical,
      canonicalChanged: false,
      robotsStatus: robots.status,
      httpStatus: fetched.status,
      errorCategory: null,
      error: null,
      staleEmbeddingCount: unchanged ? 0 : countStaleEmbeddings(corpus, existing.id),
      durationMs: Date.now() - started,
      document: updated,
    }
  } finally {
    if (ownsCorpus) {
      try {
        corpus.close()
      } catch {
        /* already closed */
      }
    }
  }
}

export async function recrawlDueDocuments(input: {
  approval: CrawlApproval | null
  limit?: number
  corpus?: SovereignCorpus
  corpusRoot?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  freshnessPolicy?: FreshnessPolicy
  now?: string
  limits?: Partial<CrawlLimits>
}): Promise<RecrawlDueResult> {
  const started = Date.now()
  const requested = Math.max(0, Math.floor(input.limit ?? MAX_RECRAWL_BATCH))
  if (requested > MAX_RECRAWL_BATCH) {
    return {
      ok: false,
      error: `Recrawl batch exceeds the maximum of ${MAX_RECRAWL_BATCH} documents.`,
      errorCategory: 'BATCH_LIMIT',
      requested,
      processed: 0,
      items: [],
      durationMs: Date.now() - started,
    }
  }
  if (!input.approval || !isTrustedCrawlActor(input.approval.actor)) {
    return {
      ok: false,
      error: 'Recrawl requires Commander or trusted internal approval. Council cannot authorize recrawl.',
      errorCategory: 'UNAPPROVED',
      requested,
      processed: 0,
      items: [],
      durationMs: Date.now() - started,
    }
  }

  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const ownsCorpus = !input.corpus
  const freshnessPolicy = input.freshnessPolicy ?? readFreshnessPolicy()
  const now = input.now ?? new Date().toISOString()
  const due: DocumentFreshness[] = listDueDocuments(corpus, { now, policy: freshnessPolicy }).slice(0, requested)
  const items: RecrawlResult[] = []
  try {
    for (const row of due) {
      items.push(await recrawlStoredDocument({
        documentId: row.documentId,
        approval: input.approval,
        corpus,
        fetchImpl: input.fetchImpl,
        lookup: input.lookup,
        policy: input.policy,
        freshnessPolicy,
        now,
        limits: input.limits,
        recordRun: false,
      }))
    }
    const finishedAt = new Date().toISOString()
    corpus.insertRecrawlRun({
      startedAt: new Date(started).toISOString(),
      finishedAt,
      requested,
      processed: items.length,
      changed: items.filter(item => item.outcome === 'CHANGED').length,
      unchanged: items.filter(item => item.outcome === 'UNCHANGED').length,
      blocked: items.filter(item => item.outcome === 'BLOCKED').length,
      failed: items.filter(item => item.outcome === 'FAILED' || item.outcome === 'CANONICAL_CHANGED').length,
      notFound: items.filter(item => item.outcome === 'NOT_FOUND').length,
      gone: items.filter(item => item.outcome === 'GONE').length,
      actor: input.approval.actor,
    })
    return {
      ok: true,
      error: null,
      errorCategory: null,
      requested,
      processed: items.length,
      items,
      durationMs: Date.now() - started,
    }
  } finally {
    if (ownsCorpus) corpus.close()
  }
}
