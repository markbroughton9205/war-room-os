import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import { isEvidenceDiscoveryProvider } from '../discoveryProvider'
import { crawlApprovedUrl } from './crawlUrl'
import { SovereignCorpus } from './corpus'
import type { LookupFn } from './policy'
import type { FetchImpl } from './fetchPage'
import {
  MAX_SOVEREIGN_BATCH_URLS,
  type BatchCrawlResult,
  type BatchCrawlSummary,
  type BatchItemStatus,
  type BatchUrlInput,
  type BatchUrlResult,
  type CrawlApproval,
  type CrawlResult,
  type DomainPolicy,
} from './types'

export { MAX_SOVEREIGN_BATCH_URLS }

const MAX_INPUT_JSON_BYTES = 256_000

function emptySummary(requested: number, durationMs = 0): BatchCrawlSummary {
  return {
    requested,
    processed: 0,
    indexed: 0,
    duplicateUrl: 0,
    duplicateContent: 0,
    blockedRobots: 0,
    blockedPolicy: 0,
    failed: 0,
    durationMs,
  }
}

function tally(items: BatchUrlResult[], requested: number, durationMs: number): BatchCrawlSummary {
  const summary = emptySummary(requested, durationMs)
  summary.processed = items.length
  for (const item of items) {
    if (item.status === 'INDEXED') summary.indexed += 1
    else if (item.status === 'DUPLICATE_URL') summary.duplicateUrl += 1
    else if (item.status === 'DUPLICATE_CONTENT') summary.duplicateContent += 1
    else if (item.status === 'BLOCKED_ROBOTS') summary.blockedRobots += 1
    else if (item.status === 'BLOCKED_POLICY') summary.blockedPolicy += 1
    else summary.failed += 1
  }
  return summary
}

export function batchStatusFromCrawl(result: CrawlResult): BatchItemStatus {
  if (result.status === 'INDEXED') return 'INDEXED'
  if (result.status === 'DUPLICATE_URL') return 'DUPLICATE_URL'
  if (result.status === 'DUPLICATE_CONTENT') return 'DUPLICATE_CONTENT'
  if (result.status === 'BLOCKED_ROBOTS') return 'BLOCKED_ROBOTS'
  if (result.status === 'BLOCKED_POLICY') return 'BLOCKED_POLICY'
  if (result.errorCategory === 'UNSUPPORTED_CONTENT_TYPE') return 'UNSUPPORTED_TYPE'
  if (result.errorCategory === 'EMPTY_CONTENT' || result.errorCategory === 'CANONICAL_URL') return 'EXTRACT_FAILED'
  return 'FETCH_FAILED'
}

function isFatalStorageError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /SQLITE_|SQLITE |disk I\/O|database is locked|readonly database|ENOSPC|EIO|EDQUOT|disk full/i.test(message)
}

function itemFromCrawl(url: string, discoveredVia: EvidenceDiscoveryProvider | null, result: CrawlResult): BatchUrlResult {
  const status = batchStatusFromCrawl(result)
  return {
    url,
    status,
    ok: result.ok,
    documentId: result.document?.id ?? result.duplicateOfDocumentId,
    canonicalUrl: result.document?.canonicalUrl ?? null,
    publisher: result.document?.publisher ?? null,
    contentHash: result.document?.contentHash ?? null,
    discoveredVia: result.document?.discoveredVia ?? discoveredVia,
    robotsStatus: result.robotsStatus,
    errorCategory: result.errorCategory,
    error: result.error,
    durationMs: result.durationMs,
  }
}

function failedItem(url: string, discoveredVia: EvidenceDiscoveryProvider | null, status: BatchItemStatus, errorCategory: string, error: string): BatchUrlResult {
  return {
    url,
    status,
    ok: false,
    documentId: null,
    canonicalUrl: null,
    publisher: null,
    contentHash: null,
    discoveredVia,
    robotsStatus: null,
    errorCategory,
    error,
    durationMs: 0,
  }
}

function asUrlInput(value: unknown): BatchUrlInput | { error: string } {
  if (typeof value === 'string') {
    const url = value.trim()
    if (!url) return { error: 'Empty URL in batch input.' }
    return { url, discoveredVia: null }
  }
  if (!value || typeof value !== 'object') return { error: 'Each batch entry must be a URL string or { url, discoveredVia }.' }
  const record = value as { url?: unknown; discoveredVia?: unknown; alsoDiscoveredVia?: unknown }
  if (typeof record.url !== 'string' || !record.url.trim()) return { error: 'Batch entry is missing a url string.' }
  if (record.discoveredVia != null && !isEvidenceDiscoveryProvider(record.discoveredVia)) {
    return { error: `Invalid discoveredVia for ${record.url.trim()}.` }
  }
  const also = Array.isArray(record.alsoDiscoveredVia)
    ? record.alsoDiscoveredVia.filter(isEvidenceDiscoveryProvider)
    : undefined
  return {
    url: record.url.trim(),
    discoveredVia: record.discoveredVia == null ? null : record.discoveredVia,
    alsoDiscoveredVia: also,
  }
}

export function parseBatchInputJson(raw: string): { urls: BatchUrlInput[]; error?: string } {
  if (raw.length > MAX_INPUT_JSON_BYTES) {
    return { urls: [], error: `Batch input exceeds ${MAX_INPUT_JSON_BYTES} bytes.` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { urls: [], error: 'Batch input is not valid JSON.' }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { urls?: unknown }).urls)
      ? (parsed as { urls: unknown[] }).urls
      : null
  if (!list) return { urls: [], error: 'Batch input must be a JSON array of URLs or { "urls": [...] }.' }
  const urls: BatchUrlInput[] = []
  for (const entry of list) {
    const mapped = asUrlInput(entry)
    if ('error' in mapped) return { urls: [], error: mapped.error }
    urls.push(mapped)
  }
  return { urls }
}

export type CrawlApprovedBatchInput = {
  urls: BatchUrlInput[]
  approval: CrawlApproval | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  now?: string
}

export async function crawlApprovedBatch(input: CrawlApprovedBatchInput): Promise<BatchCrawlResult> {
  const started = Date.now()
  const requested = input.urls.length
  if (requested > MAX_SOVEREIGN_BATCH_URLS) {
    return {
      ok: false,
      error: `Batch exceeds the maximum of ${MAX_SOVEREIGN_BATCH_URLS} URLs.`,
      errorCategory: 'BATCH_LIMIT',
      items: [],
      summary: emptySummary(requested, Date.now() - started),
    }
  }

  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const ownsCorpus = !input.corpus
  const items: BatchUrlResult[] = []
  let abortedRemaining: string | null = null

  try {
    for (let index = 0; index < input.urls.length; index += 1) {
      const entry = input.urls[index]!
      if (abortedRemaining) {
        items.push(failedItem(entry.url, entry.discoveredVia ?? null, 'FETCH_FAILED', 'STORAGE_FAILED', abortedRemaining))
        continue
      }
      try {
        const result = await corpus.withTransaction(() => crawlApprovedUrl({
          url: entry.url,
          approval: input.approval,
          discoveredVia: entry.discoveredVia ?? null,
          alsoDiscoveredVia: entry.alsoDiscoveredVia,
          corpus,
          fetchImpl: input.fetchImpl,
          lookup: input.lookup,
          policy: input.policy,
          now: input.now,
        }))
        items.push(itemFromCrawl(entry.url, entry.discoveredVia ?? null, result))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Storage failure.'
        const fatal = isFatalStorageError(error)
        items.push(failedItem(
          entry.url,
          entry.discoveredVia ?? null,
          'FETCH_FAILED',
          fatal ? 'STORAGE_FAILED' : 'FETCH_ERROR',
          message,
        ))
        if (fatal) {
          abortedRemaining = `Shared storage failure: ${message}`
        }
      }
    }
  } finally {
    if (ownsCorpus) corpus.close()
  }

  const summary = tally(items, requested, Date.now() - started)
  return {
    ok: !abortedRemaining,
    error: abortedRemaining,
    errorCategory: abortedRemaining ? 'STORAGE_FAILED' : null,
    items,
    summary,
  }
}
