import { SovereignCorpus } from './corpus'
import { resolveHybridPaths } from '../hybrid/modelStore'
import { SqliteVectorStore } from '../hybrid/vectors'
import {
  DEFAULT_FRESHNESS_INTERVAL_HOURS,
  DEFAULT_FRESHNESS_STALE_MULTIPLIER,
  MIN_FRESHNESS_INTERVAL_HOURS,
  type CorpusLifecycleDiagnostics,
  type CrawlDocumentRecord,
  type DocumentFreshness,
  type FreshnessPolicy,
  type FreshnessState,
  type LifecycleStatus,
  type RecrawlOutcome,
} from './types'

export type FreshnessEnv = Record<string, string | undefined>

function clampIntervalHours(value: number): number {
  if (!Number.isFinite(value) || value < MIN_FRESHNESS_INTERVAL_HOURS) return DEFAULT_FRESHNESS_INTERVAL_HOURS
  return Math.min(Math.floor(value), 24 * 365 * 5)
}

function parsePositiveHours(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < MIN_FRESHNESS_INTERVAL_HOURS) return fallback
  return clampIntervalHours(parsed)
}

function parseDomainIntervals(raw: string | undefined): Record<string, number> {
  if (!raw?.trim()) return {}
  const out: Record<string, number> = {}
  for (const part of raw.split(',')) {
    const [hostRaw, hoursRaw] = part.split(':')
    const host = hostRaw?.trim().toLowerCase().replace(/^www\./, '')
    const hours = Number(hoursRaw)
    if (!host || !Number.isFinite(hours) || hours < MIN_FRESHNESS_INTERVAL_HOURS) continue
    out[host] = clampIntervalHours(hours)
  }
  return out
}

export function readFreshnessPolicy(env: FreshnessEnv = process.env): FreshnessPolicy {
  return {
    defaultIntervalHours: parsePositiveHours(env.WAR_ROOM_FRESHNESS_DEFAULT_INTERVAL_HOURS, DEFAULT_FRESHNESS_INTERVAL_HOURS),
    staleMultiplier: Math.max(1, parsePositiveHours(env.WAR_ROOM_FRESHNESS_STALE_MULTIPLIER, DEFAULT_FRESHNESS_STALE_MULTIPLIER)),
    domainIntervalHours: parseDomainIntervals(env.WAR_ROOM_FRESHNESS_DOMAIN_INTERVALS),
  }
}

export function intervalHoursForDocument(
  document: Pick<CrawlDocumentRecord, 'domain'>,
  policy: FreshnessPolicy,
  documentOverrideHours?: number | null,
): number {
  if (typeof documentOverrideHours === 'number' && documentOverrideHours >= MIN_FRESHNESS_INTERVAL_HOURS) {
    return clampIntervalHours(documentOverrideHours)
  }
  const domain = document.domain.toLowerCase().replace(/^www\./, '')
  return policy.domainIntervalHours[domain] ?? policy.defaultIntervalHours
}

function addHours(iso: string, hours: number): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + hours * 3_600_000).toISOString()
}

function freshnessFromTimes(nowMs: number, dueAt: string | null, staleAt: string | null): FreshnessState {
  if (!dueAt || !staleAt) return 'UNKNOWN'
  const dueMs = Date.parse(dueAt)
  const staleMs = Date.parse(staleAt)
  if (!Number.isFinite(dueMs) || !Number.isFinite(staleMs)) return 'UNKNOWN'
  if (nowMs < dueMs) return 'FRESH'
  if (nowMs < staleMs) return 'DUE'
  return 'STALE'
}

function overlayLifecycle(freshness: FreshnessState, lastOutcome: RecrawlOutcome | null): LifecycleStatus {
  if (lastOutcome === 'BLOCKED') return 'RECRAWL_BLOCKED'
  if (lastOutcome === 'FAILED') return 'RECRAWL_FAILED'
  return freshness
}

export function evaluateDocumentFreshness(input: {
  document: CrawlDocumentRecord
  now?: string
  policy?: FreshnessPolicy
  documentOverrideHours?: number | null
  lastRecrawlOutcome?: RecrawlOutcome | null
  sourceAvailability?: DocumentFreshness['sourceAvailability']
}): DocumentFreshness {
  const nowIso = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const policy = input.policy ?? readFreshnessPolicy()
  const intervalHours = intervalHoursForDocument(input.document, policy, input.documentOverrideHours)
  const dueAt = addHours(input.document.lastCrawledAt, intervalHours)
  const staleAt = addHours(input.document.lastCrawledAt, intervalHours * policy.staleMultiplier)
  const freshness = Number.isFinite(nowMs)
    ? freshnessFromTimes(nowMs, dueAt, staleAt)
    : 'UNKNOWN'
  const lastRecrawlOutcome = input.lastRecrawlOutcome ?? null
  return {
    documentId: input.document.id,
    canonicalUrl: input.document.canonicalUrl,
    domain: input.document.domain,
    lastCrawledAt: input.document.lastCrawledAt,
    intervalHours,
    dueAt,
    staleAt,
    freshness,
    lifecycleStatus: overlayLifecycle(freshness, lastRecrawlOutcome),
    sourceAvailability: input.sourceAvailability ?? 'AVAILABLE',
    lastRecrawlOutcome,
    contentHash: input.document.contentHash,
  }
}

export function listDocumentFreshness(corpus: SovereignCorpus, opts?: {
  now?: string
  policy?: FreshnessPolicy
}): DocumentFreshness[] {
  const policy = opts?.policy ?? readFreshnessPolicy()
  const now = opts?.now ?? new Date().toISOString()
  return corpus.listDocuments().map(document => {
    const meta = corpus.getLifecycleMeta(document.id)
    return evaluateDocumentFreshness({
      document,
      now,
      policy,
      documentOverrideHours: meta.freshnessIntervalHours,
      lastRecrawlOutcome: meta.lastRecrawlOutcome,
      sourceAvailability: meta.sourceAvailability,
    })
  })
}

export function listDueDocuments(corpus: SovereignCorpus, opts?: {
  now?: string
  policy?: FreshnessPolicy
  includeStale?: boolean
}): DocumentFreshness[] {
  const includeStale = opts?.includeStale !== false
  return listDocumentFreshness(corpus, opts).filter(row => {
    if (row.freshness === 'DUE') return true
    if (includeStale && row.freshness === 'STALE') return true
    return false
  }).sort((a, b) => a.lastCrawledAt.localeCompare(b.lastCrawledAt))
}

export function corpusLifecycleDiagnostics(corpus: SovereignCorpus, opts?: {
  now?: string
  policy?: FreshnessPolicy
}): CorpusLifecycleDiagnostics {
  const rows = listDocumentFreshness(corpus, opts)
  const latest = corpus.latestRecrawlRun()
  let lastSuccessfulRecrawlAt: string | null = latest?.finishedAt ?? null
  const successful = rows
    .map(row => corpus.getLifecycleMeta(row.documentId))
    .filter(meta => meta.lastRecrawlOutcome === 'UNCHANGED' || meta.lastRecrawlOutcome === 'CHANGED')
    .map(meta => meta.lastRecrawlAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  if (successful.length) lastSuccessfulRecrawlAt = successful[successful.length - 1] ?? lastSuccessfulRecrawlAt

  const changedCount = rows.reduce((n, row) => {
    const versions = corpus.listDocumentVersions(row.documentId)
    return n + versions.filter(version => version.changeStatus === 'CHANGED').length
  }, 0)
  const unchangedCount = rows.reduce((n, row) => {
    const versions = corpus.listDocumentVersions(row.documentId)
    return n + versions.filter(version => version.changeStatus === 'UNCHANGED').length
  }, 0)

  const latestMaintenance = corpus.latestMaintenanceRun()
  const latestSuccessfulMaintenance = corpus.latestSuccessfulMaintenanceRun()
  const lock = corpus.inspectMaintenanceLock(undefined, opts?.now)
  const hashes = new Map(corpus.listDocuments().map(doc => [doc.id, doc.contentHash]))
  let staleVectorDocumentCount = 0
  const paths = resolveHybridPaths({ corpusRoot: corpus.paths.rootDir })
  const opened = SqliteVectorStore.tryOpen(paths.vectorDbPath)
  if (opened !== 'missing' && opened !== 'corrupt') {
    try {
      staleVectorDocumentCount = opened.listStaleDocumentIds(hashes).length
    } finally {
      opened.close()
    }
  }

  return {
    documentCount: rows.length,
    freshCount: rows.filter(row => row.freshness === 'FRESH').length,
    dueCount: rows.filter(row => row.freshness === 'DUE').length,
    staleCount: rows.filter(row => row.freshness === 'STALE').length,
    unknownCount: rows.filter(row => row.freshness === 'UNKNOWN').length,
    blockedCount: rows.filter(row => row.lifecycleStatus === 'RECRAWL_BLOCKED').length,
    failedCount: rows.filter(row => row.lifecycleStatus === 'RECRAWL_FAILED').length,
    notFoundCount: rows.filter(row => row.sourceAvailability === 'NOT_FOUND').length,
    goneCount: rows.filter(row => row.sourceAvailability === 'GONE').length,
    changedCount,
    unchangedCount,
    lastRecrawlRunAt: latest?.finishedAt ?? null,
    lastSuccessfulRecrawlAt,
    staleVectorDocumentCount,
    lastMaintenanceRunAt: latestMaintenance?.finishedAt ?? latestMaintenance?.startedAt ?? null,
    lastSuccessfulMaintenanceRunAt: latestSuccessfulMaintenance?.finishedAt ?? null,
    lastMaintenanceStatus: latestMaintenance?.status ?? null,
    documentsRecrawled: latestMaintenance?.recrawled ?? 0,
    documentsReembedded: latestMaintenance?.reembedded ?? 0,
    reembedFailures: latestMaintenance?.reembedFailures ?? 0,
    maintenanceLockStatus: lock.status,
    maintenanceLockExpiresAt: lock.expiresAt,
  }
}
