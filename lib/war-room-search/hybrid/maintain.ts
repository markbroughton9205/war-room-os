import { isTrustedCrawlActor } from '../crawler/candidates'
import { SovereignCorpus } from '../crawler/corpus'
import { corpusLifecycleDiagnostics } from '../crawler/freshness'
import { recrawlDueDocuments, recrawlStoredDocument, type RecrawlResult } from '../crawler/recrawl'
import {
  DEFAULT_MAINTENANCE_LEASE_MS,
  MAINTENANCE_LOCK_NAME,
  MAX_MAINTENANCE_BATCH,
  type CrawlApproval,
  type CorpusLifecycleDiagnostics,
  type DomainPolicy,
  type FreshnessPolicy,
  type RecrawlOutcome,
} from '../crawler/types'
import type { FetchImpl } from '../crawler/fetchPage'
import type { LookupFn } from '../crawler/policy'
import { createQueryEmbedder } from './embedder'
import { reembedStaleDocuments, type ReembedBatchResult } from './reembed'
import type { Embedder } from './types'
import { SqliteVectorStore } from './vectors'

const RECRAWL_EXCLUDES_REEMBED = new Set<RecrawlOutcome | 'UNAPPROVED' | 'MISSING_DOCUMENT'>([
  'UNCHANGED',
  'BLOCKED',
  'FAILED',
  'NOT_FOUND',
  'GONE',
  'CANONICAL_CHANGED',
  'UNAPPROVED',
  'MISSING_DOCUMENT',
])

export type MaintenanceRunInput = {
  approval: CrawlApproval | null
  recrawlDue?: boolean
  recrawlDocumentId?: number
  reembedStale?: boolean
  reembedDocumentId?: number
  limit?: number
  now?: string
  leaseMs?: number
  corpus?: SovereignCorpus
  store?: SqliteVectorStore
  embedder?: Embedder
  modelsDir?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  freshnessPolicy?: FreshnessPolicy
  onLocked?: (ctx: { corpus: SovereignCorpus; store: SqliteVectorStore }) => Promise<void> | void
}

export type MaintenanceRunResult = {
  ok: boolean
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED_LOCKED' | 'UNAPPROVED' | 'BATCH_LIMIT'
  recoveredExpiredLock: boolean
  requested: number
  recrawled: number
  changed: number
  unchanged: number
  blocked: number
  failed: number
  notFound: number
  gone: number
  reembedded: number
  reembedFailures: number
  skippedCurrent: number
  staleVectorDocuments: number
  lockStatus: 'FREE' | 'HELD' | 'EXPIRED'
  diagnostics: CorpusLifecycleDiagnostics | null
  recrawlItems: RecrawlResult[]
  reembed: ReembedBatchResult | null
  error: string | null
  errorCategory: string | null
  durationMs: number
  searchUsable: boolean
}

function emptyMaintenance(partial: Partial<MaintenanceRunResult> & Pick<MaintenanceRunResult, 'ok' | 'status' | 'durationMs'>): MaintenanceRunResult {
  return {
    recoveredExpiredLock: false,
    requested: 0,
    recrawled: 0,
    changed: 0,
    unchanged: 0,
    blocked: 0,
    failed: 0,
    notFound: 0,
    gone: 0,
    reembedded: 0,
    reembedFailures: 0,
    skippedCurrent: 0,
    staleVectorDocuments: 0,
    lockStatus: 'FREE',
    diagnostics: null,
    recrawlItems: [],
    reembed: null,
    error: null,
    errorCategory: null,
    searchUsable: true,
    ...partial,
  }
}

export async function runSovereignMaintenance(input: MaintenanceRunInput): Promise<MaintenanceRunResult> {
  const started = Date.now()
  const requested = Math.max(0, Math.floor(input.limit ?? MAX_MAINTENANCE_BATCH))
  if (requested > MAX_MAINTENANCE_BATCH) {
    return emptyMaintenance({
      ok: false,
      status: 'BATCH_LIMIT',
      requested,
      error: `Maintenance batch exceeds the maximum of ${MAX_MAINTENANCE_BATCH} documents.`,
      errorCategory: 'BATCH_LIMIT',
      durationMs: Date.now() - started,
    })
  }
  if (!input.approval || !isTrustedCrawlActor(input.approval.actor)) {
    return emptyMaintenance({
      ok: false,
      status: 'UNAPPROVED',
      requested,
      error: 'Maintenance requires Commander or trusted internal approval. Council cannot authorize recrawl or re-index.',
      errorCategory: 'UNAPPROVED',
      durationMs: Date.now() - started,
    })
  }

  const corpus = input.corpus ?? new SovereignCorpus()
  const ownsCorpus = !input.corpus
  const store = input.store ?? SqliteVectorStore.openForCorpus(corpus.paths.rootDir)
  const ownsStore = !input.store
  const now = input.now ?? new Date().toISOString()
  const leaseMs = input.leaseMs ?? DEFAULT_MAINTENANCE_LEASE_MS
  const recrawlEnabled = Boolean(input.recrawlDue || input.recrawlDocumentId != null)
  const reembedEnabled = Boolean(input.reembedStale || input.reembedDocumentId != null)
  let lockHeld = false

  try {
    const acquired = corpus.tryAcquireMaintenanceLock({ now, leaseMs, ownerPid: process.pid })
    if (!acquired.acquired) {
      corpus.recordEvent({
        state: 'MAINTENANCE_SKIPPED_LOCKED',
        url: MAINTENANCE_LOCK_NAME,
        errorCategory: 'LOCKED',
        durationMs: Date.now() - started,
      })
      const skipped = corpus.insertMaintenanceRun({
        startedAt: now,
        finishedAt: now,
        status: 'SKIPPED_LOCKED',
        actor: input.approval.actor,
        recrawlEnabled,
        reembedEnabled,
        requested,
        recrawled: 0,
        changed: 0,
        unchanged: 0,
        blocked: 0,
        failed: 0,
        notFound: 0,
        gone: 0,
        reembedded: 0,
        reembedFailures: 0,
        skippedCurrent: 0,
        staleVectorDocuments: 0,
        error: 'Another maintenance process holds the lock.',
        recoveredExpiredLock: false,
        leaseExpiresAt: acquired.lock?.leaseExpiresAt ?? null,
      })
      void skipped
      return emptyMaintenance({
        ok: false,
        status: 'SKIPPED_LOCKED',
        requested,
        lockStatus: acquired.status,
        diagnostics: corpusLifecycleDiagnostics(corpus, { now, policy: input.freshnessPolicy }),
        error: 'Another maintenance process holds the lock.',
        errorCategory: 'LOCKED',
        durationMs: Date.now() - started,
      })
    }
    lockHeld = true

    const run = corpus.insertMaintenanceRun({
      startedAt: now,
      finishedAt: null,
      status: 'RUNNING',
      actor: input.approval.actor,
      recrawlEnabled,
      reembedEnabled,
      requested,
      recrawled: 0,
      changed: 0,
      unchanged: 0,
      blocked: 0,
      failed: 0,
      notFound: 0,
      gone: 0,
      reembedded: 0,
      reembedFailures: 0,
      skippedCurrent: 0,
      staleVectorDocuments: 0,
      error: null,
      recoveredExpiredLock: acquired.recovered,
      leaseExpiresAt: acquired.lock?.leaseExpiresAt ?? null,
    })
    corpus.attachMaintenanceLockRun(MAINTENANCE_LOCK_NAME, run.id, now, leaseMs)
    corpus.recordEvent({
      state: 'MAINTENANCE_STARTED',
      url: MAINTENANCE_LOCK_NAME,
      errorCategory: acquired.recovered ? 'LOCK_RECOVERED' : null,
      durationMs: Date.now() - started,
    })

    if (input.onLocked) {
      await input.onLocked({ corpus, store })
    }

    const recrawlItems: RecrawlResult[] = []
    if (input.recrawlDocumentId != null) {
      corpus.renewMaintenanceLock(MAINTENANCE_LOCK_NAME, new Date().toISOString(), leaseMs)
      recrawlItems.push(await recrawlStoredDocument({
        documentId: input.recrawlDocumentId,
        approval: input.approval,
        corpus,
        fetchImpl: input.fetchImpl,
        lookup: input.lookup,
        policy: input.policy,
        freshnessPolicy: input.freshnessPolicy,
        now,
        recordRun: true,
      }))
    } else if (input.recrawlDue) {
      corpus.renewMaintenanceLock(MAINTENANCE_LOCK_NAME, new Date().toISOString(), leaseMs)
      const due = await recrawlDueDocuments({
        approval: input.approval,
        limit: requested,
        corpus,
        fetchImpl: input.fetchImpl,
        lookup: input.lookup,
        policy: input.policy,
        freshnessPolicy: input.freshnessPolicy,
        now,
      })
      recrawlItems.push(...due.items)
    }

    const excludeFromReembed = recrawlItems
      .filter(item => item.documentId != null && RECRAWL_EXCLUDES_REEMBED.has(item.outcome))
      .map(item => item.documentId!)

    let reembed: ReembedBatchResult | null = null
    if (reembedEnabled) {
      const embedder = input.embedder ?? createQueryEmbedder({ allowDownload: false, modelsDir: input.modelsDir })
      corpus.renewMaintenanceLock(MAINTENANCE_LOCK_NAME, new Date().toISOString(), leaseMs)
      reembed = await reembedStaleDocuments({
        approval: input.approval,
        documentId: input.reembedDocumentId,
        limit: requested,
        corpus,
        store,
        embedder,
        modelsDir: input.modelsDir,
        excludeDocumentIds: excludeFromReembed,
      })
    }

    const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
    const staleVectorDocuments = store.listStaleDocumentIds(hashes).length
    const finishedAt = new Date().toISOString()
    const recrawled = recrawlItems.length
    const changed = recrawlItems.filter(item => item.outcome === 'CHANGED').length
    const unchanged = recrawlItems.filter(item => item.outcome === 'UNCHANGED').length
    const blocked = recrawlItems.filter(item => item.outcome === 'BLOCKED').length
    const failed = recrawlItems.filter(item => item.outcome === 'FAILED' || item.outcome === 'CANONICAL_CHANGED').length
    const notFound = recrawlItems.filter(item => item.outcome === 'NOT_FOUND').length
    const gone = recrawlItems.filter(item => item.outcome === 'GONE').length
    const reembedded = reembed?.reembedded ?? 0
    const reembedFailures = reembed?.failed ?? 0
    const skippedCurrent = reembed?.skippedCurrent ?? 0
    const runFailed = recrawlItems.some(item => item.outcome === 'UNAPPROVED') || reembed?.errorCategory === 'UNAPPROVED'
    const status = runFailed ? 'FAILED' : 'COMPLETED'
    corpus.updateMaintenanceRun(run.id, {
      finishedAt,
      status,
      recrawled,
      changed,
      unchanged,
      blocked,
      failed,
      notFound,
      gone,
      reembedded,
      reembedFailures,
      skippedCurrent,
      staleVectorDocuments,
      error: runFailed ? (reembed?.error ?? 'Maintenance run failed.') : null,
      leaseExpiresAt: corpus.getMaintenanceLock()?.leaseExpiresAt ?? null,
    })
    corpus.recordEvent({
      state: status === 'COMPLETED' ? 'MAINTENANCE_COMPLETED' : 'MAINTENANCE_FAILED',
      url: MAINTENANCE_LOCK_NAME,
      errorCategory: runFailed ? 'MAINTENANCE_FAILED' : null,
      durationMs: Date.now() - started,
    })
    const diagnostics = corpusLifecycleDiagnostics(corpus, { now, policy: input.freshnessPolicy })
    return {
      ok: status === 'COMPLETED',
      status,
      recoveredExpiredLock: acquired.recovered,
      requested,
      recrawled,
      changed,
      unchanged,
      blocked,
      failed,
      notFound,
      gone,
      reembedded,
      reembedFailures,
      skippedCurrent,
      staleVectorDocuments,
      lockStatus: 'HELD',
      diagnostics,
      recrawlItems,
      reembed,
      error: runFailed ? (reembed?.error ?? 'Maintenance run failed.') : null,
      errorCategory: runFailed ? 'MAINTENANCE_FAILED' : null,
      durationMs: Date.now() - started,
      searchUsable: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    corpus.recordEvent({
      state: 'MAINTENANCE_FAILED',
      url: MAINTENANCE_LOCK_NAME,
      errorCategory: 'MAINTENANCE_FAILED',
      durationMs: Date.now() - started,
    })
    return emptyMaintenance({
      ok: false,
      status: 'FAILED',
      requested,
      diagnostics: corpusLifecycleDiagnostics(corpus, { now, policy: input.freshnessPolicy }),
      error: message,
      errorCategory: 'MAINTENANCE_FAILED',
      durationMs: Date.now() - started,
    })
  } finally {
    if (lockHeld) {
      try {
        corpus.releaseMaintenanceLock()
      } catch {
        /* lock already released */
      }
    }
    if (ownsStore) store.close()
    if (ownsCorpus) corpus.close()
  }
}
