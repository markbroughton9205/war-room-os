import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import { federatedSearch } from '../federatedSearch'
import type { FederatedSearchResponse, SearchRequest, SearchResult } from '../types'
import { crawlApprovedBatch } from './batchCrawl'
import { SovereignCorpus } from './corpus'
import type { FetchImpl } from './fetchPage'
import type { LookupFn } from './policy'
import {
  MAX_SOVEREIGN_BATCH_URLS,
  type BatchUrlResult,
  type CrawlApproval,
  type CrawlApprovalActor,
  type DomainPolicy,
  type IngestCandidateActor,
  type IngestCandidateRecord,
  type IngestCandidateStatus,
} from './types'

export const REJECTED_RECENT_MS = 7 * 24 * 60 * 60 * 1000
export const PENDING_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000

const APPROVAL_ACTORS = new Set<CrawlApprovalActor>(['commander', 'trusted_internal_test'])

export type CandidateDiscoveryInput = {
  url: string | null
  canonicalUrl?: string | null
  title?: string | null
  snippet?: string | null
  publisher?: string | null
  displayDomain?: string | null
  discoveredVia?: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia?: EvidenceDiscoveryProvider[] | null
  observedAt?: string | null
}

export type ProposeCandidateAction =
  | 'CREATED'
  | 'MERGED'
  | 'ALREADY_INDEXED'
  | 'ALREADY_APPROVED'
  | 'REJECTED_RECENT'
  | 'SKIPPED'

export type ProposeCandidateItem = {
  action: ProposeCandidateAction
  candidate: IngestCandidateRecord | null
  url: string
  canonicalCandidateUrl: string | null
  error?: string
}

export type ProposeCandidatesResult = {
  queryContext: string | null
  created: number
  merged: number
  alreadyIndexed: number
  skipped: number
  items: ProposeCandidateItem[]
}

export type CandidateMutationResult = {
  ok: boolean
  error: string | null
  candidates: IngestCandidateRecord[]
}

export type CandidateIngestItem = {
  candidateId: number
  status: IngestCandidateStatus
  crawlStatus: string | null
  documentId: number | null
  canonicalUrl: string | null
  discoveredVia: EvidenceDiscoveryProvider | null
  alsoDiscoveredVia: EvidenceDiscoveryProvider[]
  error: string | null
}

export type CandidateIngestResult = {
  ok: boolean
  error: string | null
  items: CandidateIngestItem[]
}

function uniqueProviders(
  primary: EvidenceDiscoveryProvider | null,
  extras: Array<EvidenceDiscoveryProvider | null | undefined>,
): { discoveredVia: EvidenceDiscoveryProvider | null; alsoDiscoveredVia: EvidenceDiscoveryProvider[] } {
  const also: EvidenceDiscoveryProvider[] = []
  for (const value of extras) {
    if (!value || value === primary) continue
    if (!also.includes(value)) also.push(value)
  }
  return { discoveredVia: primary, alsoDiscoveredVia: also }
}

function mergeProvenance(
  existing: IngestCandidateRecord,
  incoming: CandidateDiscoveryInput,
): { discoveredVia: EvidenceDiscoveryProvider | null; alsoDiscoveredVia: EvidenceDiscoveryProvider[] } {
  const extras = [
    existing.discoveredVia,
    ...existing.alsoDiscoveredVia,
    incoming.discoveredVia ?? null,
    ...(incoming.alsoDiscoveredVia ?? []),
  ]
  const primary = existing.discoveredVia ?? incoming.discoveredVia ?? null
  return uniqueProviders(primary, extras)
}

export function isTrustedCrawlActor(actor: string | null | undefined): actor is CrawlApprovalActor {
  return Boolean(actor && APPROVAL_ACTORS.has(actor as CrawlApprovalActor))
}

function expireIfNeeded(corpus: SovereignCorpus, candidate: IngestCandidateRecord, nowMs: number): IngestCandidateRecord {
  if (candidate.status !== 'PENDING') return candidate
  const discovered = Date.parse(candidate.discoveredAt)
  if (!Number.isFinite(discovered) || nowMs - discovered < PENDING_EXPIRE_MS) return candidate
  const updated = corpus.updateCandidate(candidate.id, {
    status: 'EXPIRED',
    ingestStatus: 'EXPIRED',
    updatedAt: new Date(nowMs).toISOString(),
  })
  corpus.recordCandidateEvent({
    candidateId: candidate.id,
    eventType: 'EXPIRED',
    detail: 'Pending candidate expired without Commander approval.',
    createdAt: updated.updatedAt,
  })
  return updated
}

function recentlyRejected(candidate: IngestCandidateRecord, nowMs: number): boolean {
  if (candidate.status !== 'REJECTED' || !candidate.rejectedAt) return false
  const at = Date.parse(candidate.rejectedAt)
  return Number.isFinite(at) && nowMs - at < REJECTED_RECENT_MS
}

export function proposeIngestCandidates(input: {
  results: Array<CandidateDiscoveryInput | SearchResult>
  queryContext?: string | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
}): ProposeCandidatesResult {
  const owns = !input.corpus
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const now = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const items: ProposeCandidateItem[] = []
  try {
    for (const result of input.results) {
      const url = (result.url ?? '').trim()
      if (!url) {
        items.push({ action: 'SKIPPED', candidate: null, url: '', canonicalCandidateUrl: null, error: 'Discovery result had no URL.' })
        continue
      }
      const canonical = canonicalizeUrl(result.canonicalUrl ?? url) ?? canonicalizeUrl(url)
      if (!canonical) {
        items.push({ action: 'SKIPPED', candidate: null, url, canonicalCandidateUrl: null, error: 'Could not canonicalize discovery URL.' })
        continue
      }
      const incoming: CandidateDiscoveryInput = {
        url,
        canonicalUrl: canonical,
        title: result.title ?? null,
        snippet: result.snippet ?? null,
        publisher: result.publisher ?? result.displayDomain ?? hostnameFromUrl(canonical),
        displayDomain: result.displayDomain ?? hostnameFromUrl(canonical),
        discoveredVia: result.discoveredVia ?? null,
        alsoDiscoveredVia: result.alsoDiscoveredVia ?? null,
        observedAt: result.observedAt ?? now,
      }
      const existing = corpus.getCandidateByCanonicalUrl(canonical)
      const indexed = corpus.getByCanonicalUrl(canonical)
      if (existing) {
        const current = expireIfNeeded(corpus, existing, nowMs)
        if (recentlyRejected(current, nowMs)) {
          items.push({ action: 'REJECTED_RECENT', candidate: current, url, canonicalCandidateUrl: canonical })
          continue
        }
        if (current.status === 'APPROVED') {
          const provenance = mergeProvenance(current, incoming)
          const updated = corpus.updateCandidate(current.id, {
            ...provenance,
            title: current.title ?? incoming.title ?? null,
            snippet: current.snippet ?? incoming.snippet ?? null,
            updatedAt: now,
          })
          corpus.recordCandidateEvent({ candidateId: updated.id, eventType: 'PROVENANCE_MERGED', createdAt: now })
          items.push({ action: 'ALREADY_APPROVED', candidate: updated, url, canonicalCandidateUrl: canonical })
          continue
        }
        if (current.status === 'ALREADY_INDEXED' || current.status === 'INGESTED' || indexed) {
          const provenance = mergeProvenance(current, incoming)
          const updated = corpus.updateCandidate(current.id, {
            ...provenance,
            status: indexed ? 'ALREADY_INDEXED' : current.status,
            documentId: current.documentId ?? indexed?.id ?? null,
            ingestStatus: 'ALREADY_INDEXED',
            updatedAt: now,
          })
          corpus.recordCandidateEvent({
            candidateId: updated.id,
            eventType: 'ALREADY_INDEXED',
            createdAt: now,
            detail: indexed ? `document:${indexed.id}` : null,
          })
          items.push({ action: 'ALREADY_INDEXED', candidate: updated, url, canonicalCandidateUrl: canonical })
          continue
        }
        if (current.status === 'REJECTED' || current.status === 'EXPIRED' || current.status === 'FAILED') {
          const provenance = mergeProvenance(current, incoming)
          const updated = corpus.updateCandidate(current.id, {
            ...provenance,
            status: 'PENDING',
            ingestStatus: null,
            rejectedBy: current.rejectedBy,
            rejectedAt: current.rejectedAt,
            title: incoming.title ?? current.title,
            snippet: incoming.snippet ?? current.snippet,
            queryContext: input.queryContext ?? current.queryContext,
            discoveredAt: incoming.observedAt ?? now,
            updatedAt: now,
          })
          corpus.recordCandidateEvent({ candidateId: updated.id, eventType: 'CREATED', createdAt: now, detail: 'reproposed' })
          items.push({ action: 'CREATED', candidate: updated, url, canonicalCandidateUrl: canonical })
          continue
        }
        const provenance = mergeProvenance(current, incoming)
        const updated = corpus.updateCandidate(current.id, {
          ...provenance,
          title: current.title ?? incoming.title ?? null,
          snippet: current.snippet ?? incoming.snippet ?? null,
          queryContext: current.queryContext ?? input.queryContext ?? null,
          updatedAt: now,
        })
        corpus.recordCandidateEvent({ candidateId: updated.id, eventType: 'PROVENANCE_MERGED', createdAt: now })
        items.push({ action: 'MERGED', candidate: updated, url, canonicalCandidateUrl: canonical })
        continue
      }

      const provenance = uniqueProviders(incoming.discoveredVia ?? null, incoming.alsoDiscoveredVia ?? [])
      const status: IngestCandidateStatus = indexed ? 'ALREADY_INDEXED' : 'PENDING'
      const created = corpus.insertCandidate({
        url,
        canonicalCandidateUrl: canonical,
        title: incoming.title ?? null,
        snippet: incoming.snippet ?? null,
        publisher: incoming.publisher ?? hostnameFromUrl(canonical),
        domain: hostnameFromUrl(canonical),
        discoveredVia: provenance.discoveredVia,
        alsoDiscoveredVia: provenance.alsoDiscoveredVia,
        discoveredAt: incoming.observedAt ?? now,
        queryContext: input.queryContext ?? null,
        status,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        ingestStatus: indexed ? 'ALREADY_INDEXED' : null,
        documentId: indexed?.id ?? null,
        councilRecommendation: null,
        councilRecommendedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      corpus.recordCandidateEvent({
        candidateId: created.id,
        eventType: indexed ? 'ALREADY_INDEXED' : 'CREATED',
        createdAt: now,
        detail: JSON.stringify({ queryContext: input.queryContext ?? null, discoveredVia: created.discoveredVia }),
      })
      items.push({
        action: indexed ? 'ALREADY_INDEXED' : 'CREATED',
        candidate: created,
        url,
        canonicalCandidateUrl: canonical,
      })
    }
  } finally {
    if (owns) corpus.close()
  }

  return {
    queryContext: input.queryContext ?? null,
    created: items.filter(item => item.action === 'CREATED').length,
    merged: items.filter(item => item.action === 'MERGED').length,
    alreadyIndexed: items.filter(item => item.action === 'ALREADY_INDEXED').length,
    skipped: items.filter(item => item.action === 'SKIPPED' || item.action === 'REJECTED_RECENT').length,
    items,
  }
}

export function listIngestCandidates(input?: {
  status?: IngestCandidateStatus | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
}): IngestCandidateRecord[] {
  const owns = !input?.corpus
  const corpus = input?.corpus ?? new SovereignCorpus(input?.corpusRoot)
  const nowMs = Date.parse(input?.now ?? new Date().toISOString())
  try {
    return corpus.listCandidates(input?.status).map(candidate => expireIfNeeded(corpus, candidate, nowMs))
      .filter(candidate => !input?.status || candidate.status === input.status)
  } finally {
    if (owns) corpus.close()
  }
}

export function approveIngestCandidates(input: {
  ids: number[]
  actor: string
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
}): CandidateMutationResult {
  if (!isTrustedCrawlActor(input.actor)) {
    return { ok: false, error: 'Only Commander or trusted internal test may approve ingest candidates.', candidates: [] }
  }
  if (input.ids.length > MAX_SOVEREIGN_BATCH_URLS) {
    return { ok: false, error: `Approval batch exceeds the maximum of ${MAX_SOVEREIGN_BATCH_URLS} candidates.`, candidates: [] }
  }
  const owns = !input.corpus
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const now = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const candidates: IngestCandidateRecord[] = []
  try {
    for (const id of input.ids) {
      const current = corpus.getCandidateById(id)
      if (!current) return { ok: false, error: `Unknown ingest candidate ${id}.`, candidates }
      const live = expireIfNeeded(corpus, current, nowMs)
      if (live.status === 'EXPIRED') return { ok: false, error: `Candidate ${id} expired and cannot be approved.`, candidates }
      if (live.status === 'REJECTED') return { ok: false, error: `Rejected candidate ${id} cannot be approved in this flow.`, candidates }
      if (live.status === 'ALREADY_INDEXED' || live.status === 'INGESTED') {
        candidates.push(live)
        continue
      }
      const updated = corpus.updateCandidate(id, {
        status: 'APPROVED',
        approvedBy: input.actor,
        approvedAt: now,
        updatedAt: now,
      })
      corpus.recordCandidateEvent({ candidateId: id, eventType: 'APPROVED', actor: input.actor, createdAt: now })
      candidates.push(updated)
    }
    return { ok: true, error: null, candidates }
  } finally {
    if (owns) corpus.close()
  }
}

export function rejectIngestCandidates(input: {
  ids: number[]
  actor: string
  reason?: string | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
}): CandidateMutationResult {
  if (!isTrustedCrawlActor(input.actor)) {
    return { ok: false, error: 'Only Commander or trusted internal test may reject ingest candidates.', candidates: [] }
  }
  const owns = !input.corpus
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const now = input.now ?? new Date().toISOString()
  const candidates: IngestCandidateRecord[] = []
  try {
    for (const id of input.ids) {
      const current = corpus.getCandidateById(id)
      if (!current) return { ok: false, error: `Unknown ingest candidate ${id}.`, candidates }
      if (current.status === 'INGESTED' || current.status === 'ALREADY_INDEXED') {
        return { ok: false, error: `Candidate ${id} is already in the corpus and cannot be rejected for crawl.`, candidates }
      }
      const updated = corpus.updateCandidate(id, {
        status: 'REJECTED',
        rejectedBy: input.actor,
        rejectedAt: now,
        ingestStatus: 'REJECTED',
        updatedAt: now,
      })
      corpus.recordCandidateEvent({
        candidateId: id,
        eventType: 'REJECTED',
        actor: input.actor,
        createdAt: now,
        detail: input.reason ?? null,
      })
      candidates.push(updated)
    }
    return { ok: true, error: null, candidates }
  } finally {
    if (owns) corpus.close()
  }
}

export function recommendIngestCandidate(input: {
  id: number
  actor: IngestCandidateActor
  note?: string | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
}): CandidateMutationResult {
  const owns = !input.corpus
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const now = input.now ?? new Date().toISOString()
  try {
    const current = corpus.getCandidateById(input.id)
    if (!current) return { ok: false, error: `Unknown ingest candidate ${input.id}.`, candidates: [] }
    const updated = corpus.updateCandidate(input.id, {
      councilRecommendation: input.note ?? 'recommend_ingest',
      councilRecommendedAt: now,
      updatedAt: now,
    })
    corpus.recordCandidateEvent({
      candidateId: input.id,
      eventType: 'RECOMMENDED',
      actor: input.actor,
      createdAt: now,
      detail: input.note ?? 'recommend_ingest',
    })
    return { ok: true, error: null, candidates: [updated] }
  } finally {
    if (owns) corpus.close()
  }
}

function ingestStatusFromCrawl(result: BatchUrlResult, alreadyIndexed: boolean): IngestCandidateStatus {
  if (alreadyIndexed || result.status === 'DUPLICATE_URL') return 'ALREADY_INDEXED'
  if (result.status === 'INDEXED' || result.status === 'DUPLICATE_CONTENT') return 'INGESTED'
  return 'FAILED'
}

export async function ingestApprovedCandidates(input: {
  ids: number[]
  approval: CrawlApproval | null
  corpus?: SovereignCorpus
  corpusRoot?: string
  fetchImpl?: FetchImpl
  lookup?: LookupFn
  policy?: DomainPolicy
  now?: string
}): Promise<CandidateIngestResult> {
  const actor = input.approval?.actor ?? null
  if (!isTrustedCrawlActor(actor)) {
    return { ok: false, error: 'Ingest requires Commander or trusted internal approval.', items: [] }
  }
  if (input.ids.length > MAX_SOVEREIGN_BATCH_URLS) {
    return { ok: false, error: `Ingest batch exceeds the maximum of ${MAX_SOVEREIGN_BATCH_URLS} candidates.`, items: [] }
  }
  const owns = !input.corpus
  const corpus = input.corpus ?? new SovereignCorpus(input.corpusRoot)
  const now = input.now ?? new Date().toISOString()
  const items: CandidateIngestItem[] = []
  try {
    const crawlInputs: Array<{ candidate: IngestCandidateRecord }> = []
    for (const id of input.ids) {
      const candidate = corpus.getCandidateById(id)
      if (!candidate) {
        items.push({
          candidateId: id, status: 'FAILED', crawlStatus: null, documentId: null,
          canonicalUrl: null, discoveredVia: null, alsoDiscoveredVia: [], error: 'Unknown candidate.',
        })
        continue
      }
      if (candidate.status === 'REJECTED' || candidate.status === 'EXPIRED') {
        items.push({
          candidateId: id, status: candidate.status, crawlStatus: null, documentId: candidate.documentId,
          canonicalUrl: candidate.canonicalCandidateUrl, discoveredVia: candidate.discoveredVia,
          alsoDiscoveredVia: candidate.alsoDiscoveredVia,
          error: candidate.status === 'REJECTED' ? 'Rejected candidates cannot be ingested.' : 'Expired candidates cannot be ingested.',
        })
        continue
      }
      if (candidate.status === 'PENDING') {
        items.push({
          candidateId: id, status: 'PENDING', crawlStatus: null, documentId: candidate.documentId,
          canonicalUrl: candidate.canonicalCandidateUrl, discoveredVia: candidate.discoveredVia,
          alsoDiscoveredVia: candidate.alsoDiscoveredVia, error: 'Candidate is not Commander-approved.',
        })
        continue
      }
      const indexed = corpus.getByCanonicalUrl(candidate.canonicalCandidateUrl)
      if (candidate.status === 'ALREADY_INDEXED' || candidate.status === 'INGESTED' || indexed) {
        const updated = corpus.updateCandidate(id, {
          status: 'ALREADY_INDEXED',
          ingestStatus: 'ALREADY_INDEXED',
          documentId: candidate.documentId ?? indexed?.id ?? null,
          updatedAt: now,
        })
        corpus.recordCandidateEvent({
          candidateId: id,
          eventType: 'ALREADY_INDEXED',
          actor,
          createdAt: now,
          detail: indexed ? `document:${indexed.id}` : null,
        })
        items.push({
          candidateId: id,
          status: updated.status,
          crawlStatus: 'ALREADY_INDEXED',
          documentId: updated.documentId,
          canonicalUrl: updated.canonicalCandidateUrl,
          discoveredVia: updated.discoveredVia,
          alsoDiscoveredVia: updated.alsoDiscoveredVia,
          error: null,
        })
        continue
      }
      if (candidate.status !== 'APPROVED') {
        items.push({
          candidateId: id, status: candidate.status, crawlStatus: null, documentId: candidate.documentId,
          canonicalUrl: candidate.canonicalCandidateUrl, discoveredVia: candidate.discoveredVia,
          alsoDiscoveredVia: candidate.alsoDiscoveredVia, error: `Candidate status ${candidate.status} cannot ingest.`,
        })
        continue
      }
      crawlInputs.push({ candidate })
    }

    if (!crawlInputs.length) {
      return { ok: items.every(item => !item.error || item.status === 'ALREADY_INDEXED'), error: null, items }
    }

    for (const entry of crawlInputs) {
      corpus.updateCandidate(entry.candidate.id, { ingestStatus: 'INGESTING', updatedAt: now })
      corpus.recordCandidateEvent({ candidateId: entry.candidate.id, eventType: 'INGEST_STARTED', actor, createdAt: now })
    }

    const batch = await crawlApprovedBatch({
      urls: crawlInputs.map(entry => ({
        url: entry.candidate.url,
        discoveredVia: entry.candidate.discoveredVia,
        alsoDiscoveredVia: entry.candidate.alsoDiscoveredVia,
      })),
      approval: input.approval,
      corpus,
      fetchImpl: input.fetchImpl,
      lookup: input.lookup,
      policy: input.policy,
      now,
    })

    for (let index = 0; index < crawlInputs.length; index += 1) {
      const candidate = crawlInputs[index]!.candidate
      const crawl = batch.items[index]
      if (!crawl) {
        corpus.updateCandidate(candidate.id, { status: 'FAILED', ingestStatus: 'FAILED', updatedAt: now })
        corpus.recordCandidateEvent({ candidateId: candidate.id, eventType: 'FAILED', actor, createdAt: now, detail: 'Missing batch result.' })
        items.push({
          candidateId: candidate.id, status: 'FAILED', crawlStatus: null, documentId: null,
          canonicalUrl: candidate.canonicalCandidateUrl, discoveredVia: candidate.discoveredVia,
          alsoDiscoveredVia: candidate.alsoDiscoveredVia, error: 'Missing batch result.',
        })
        continue
      }
      const status = ingestStatusFromCrawl(crawl, false)
      const updated = corpus.updateCandidate(candidate.id, {
        status,
        ingestStatus: crawl.status,
        documentId: crawl.documentId,
        updatedAt: now,
      })
      corpus.recordCandidateEvent({
        candidateId: candidate.id,
        eventType: status === 'FAILED' ? 'FAILED' : status === 'ALREADY_INDEXED' ? 'ALREADY_INDEXED' : 'INGESTED',
        actor,
        createdAt: now,
        detail: crawl.error,
      })
      items.push({
        candidateId: candidate.id,
        status: updated.status,
        crawlStatus: crawl.status,
        documentId: updated.documentId,
        canonicalUrl: crawl.canonicalUrl ?? updated.canonicalCandidateUrl,
        discoveredVia: crawl.discoveredVia ?? updated.discoveredVia,
        alsoDiscoveredVia: updated.alsoDiscoveredVia,
        error: crawl.error,
      })
    }

    const blocked = items.some(item => item.status === 'REJECTED' || (item.status === 'PENDING' && item.error))
    return { ok: batch.ok && !blocked, error: batch.error, items }
  } finally {
    if (owns) corpus.close()
  }
}

export async function discoverIngestCandidates(input: {
  request: SearchRequest
  selectIndexes?: number[]
  corpus?: SovereignCorpus
  corpusRoot?: string
  now?: string
  searchImpl?: (request: SearchRequest) => Promise<FederatedSearchResponse>
}): Promise<{
  search: FederatedSearchResponse
  proposed: ProposeCandidatesResult
  candidateError: string | null
}> {
  const search = await (input.searchImpl ?? federatedSearch)(input.request)
  try {
    const selected = input.selectIndexes?.length
      ? input.selectIndexes.map(index => search.results[index]).filter((item): item is SearchResult => Boolean(item))
      : search.results
    const proposed = proposeIngestCandidates({
      results: selected,
      queryContext: search.query,
      corpus: input.corpus,
      corpusRoot: input.corpusRoot,
      now: input.now,
    })
    return { search, proposed, candidateError: null }
  } catch (error) {
    return {
      search,
      proposed: { queryContext: search.query, created: 0, merged: 0, alreadyIndexed: 0, skipped: 0, items: [] },
      candidateError: error instanceof Error ? error.message : 'Candidate creation failed.',
    }
  }
}
