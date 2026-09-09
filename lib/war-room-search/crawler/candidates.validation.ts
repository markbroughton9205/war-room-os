import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { emptySearchSourceSummary, type FederatedSearchResponse, type SearchResult } from '../types'
import { formatSearchResult } from '../formatSearchResult'
import { crawlApprovedUrl } from './crawlUrl'
import {
  approveIngestCandidates,
  discoverIngestCandidates,
  ingestApprovedCandidates,
  listIngestCandidates,
  proposeIngestCandidates,
  recommendIngestCandidate,
  rejectIngestCandidates,
} from './candidates'
import { SovereignCorpus } from './corpus'
import { startCrawlFixture } from './fixtureServer'
import { MAX_SOVEREIGN_BATCH_URLS, type CrawlApproval, type IngestCandidateRecord } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage3c fixture' }
const NOW = '2026-09-09T12:00:00.000Z'
const EMPTY_BREAKDOWN = {
  relevance: 0, authority: 0, freshness: 0, primary: 0, independence: 0, regional: 0, duplicatePenalty: 0,
}

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: overrides.source_id ?? 'searxng',
    source_type: overrides.source_type ?? 'search',
    source_label: overrides.source_label ?? 'Fixture',
    verified_level: 'semi_verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: NOW,
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'recent',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
    ...overrides,
  }
}

function resultFromEvidence(item: IntelligenceEvidenceItem): SearchResult {
  return formatSearchResult({ item, score: 0.5, rankBreakdown: EMPTY_BREAKDOWN })
}

function fakeSearch(results: SearchResult[], query = 'stage3c fixture'): FederatedSearchResponse {
  return {
    query,
    tookMs: 4,
    resultCount: results.length,
    rawCount: results.length,
    deduplicatedCount: results.length,
    results,
    sourceSummary: emptySearchSourceSummary({ publicRssOk: true }),
    fallbackUsed: false,
    warnings: [],
    aborted: false,
    timedOut: false,
    profile: 'STANDARD_RESEARCH',
  }
}

class ExplodingCandidateCorpus extends SovereignCorpus {
  override insertCandidate(): IngestCandidateRecord {
    throw new Error('candidate store unavailable')
  }
}

export async function runIngestCandidateValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const fixture = await startCrawlFixture()
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-sovereign-3c-'))
  const crawlerDir = path.join(process.cwd(), 'lib', 'war-room-search', 'crawler')

  try {
    const corpus = new SovereignCorpus(tmp)
    const allowed = `${fixture.baseUrl}/allowed`
    const blocked = `${fixture.baseUrl}/blocked`
    let fetches = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      fetches += 1
      return originalFetch(input, init)
    }) as typeof fetch

    const created = proposeIngestCandidates({
      corpus,
      now: NOW,
      queryContext: 'semiconductor export controls',
      results: [{
        url: allowed,
        title: 'Chip export controls widen',
        snippet: 'Governments expand semiconductor export rules.',
        publisher: '127.0.0.1',
        discoveredVia: 'SEARXNG',
        alsoDiscoveredVia: ['GOOGLE'],
        observedAt: NOW,
      }],
    })
    globalThis.fetch = originalFetch
    cases.push(check(
      'c01_discovery_creates_pending',
      created.created === 1 && created.items[0]?.candidate?.status === 'PENDING' && created.items[0]?.candidate?.discoveredVia === 'SEARXNG',
      JSON.stringify({ created: created.created, status: created.items[0]?.candidate?.status, via: created.items[0]?.candidate?.discoveredVia }),
    ))
    cases.push(check(
      'c02_candidate_creation_no_fetch',
      fetches === 0 && corpus.countDocuments() === 0,
      JSON.stringify({ fetches, documents: corpus.countDocuments() }),
    ))

    const merged = proposeIngestCandidates({
      corpus,
      now: NOW,
      queryContext: 'semiconductor export controls',
      results: [{
        url: allowed,
        title: 'Chip export controls widen',
        snippet: 'Same canonical from Tavily.',
        publisher: '127.0.0.1',
        discoveredVia: 'TAVILY',
        observedAt: NOW,
      }],
    })
    const mergedCandidate = merged.items[0]?.candidate
    cases.push(check(
      'c03_multi_provider_merges_provenance',
      merged.merged === 1 && merged.created === 0 && corpus.listCandidates().length === 1
        && mergedCandidate?.discoveredVia === 'SEARXNG'
        && Boolean(mergedCandidate?.alsoDiscoveredVia.includes('TAVILY'))
        && Boolean(mergedCandidate?.alsoDiscoveredVia.includes('GOOGLE')),
      JSON.stringify({ merged: merged.merged, via: mergedCandidate?.discoveredVia, also: mergedCandidate?.alsoDiscoveredVia, count: corpus.listCandidates().length }),
    ))
    cases.push(check(
      'c04_duplicate_pending_not_created',
      corpus.listCandidates('PENDING').length === 1 && merged.items[0]?.action === 'MERGED',
      JSON.stringify(corpus.listCandidates().map(item => ({ id: item.id, status: item.status }))),
    ))

    await crawlApprovedUrl({ url: `${fixture.baseUrl}/plain`, approval: APPROVAL, corpus })
    const already = proposeIngestCandidates({
      corpus,
      now: NOW,
      results: [{ url: `${fixture.baseUrl}/plain`, title: 'Plain', discoveredVia: 'RSS' }],
    })
    cases.push(check(
      'c05_already_indexed_detected',
      already.alreadyIndexed === 1 && already.items[0]?.candidate?.status === 'ALREADY_INDEXED' && Boolean(already.items[0]?.candidate?.documentId),
      JSON.stringify({ action: already.items[0]?.action, status: already.items[0]?.candidate?.status, documentId: already.items[0]?.candidate?.documentId }),
    ))

    const pendingId = created.items[0]!.candidate!.id
    const approved = approveIngestCandidates({ ids: [pendingId], actor: 'commander', corpus, now: NOW })
    cases.push(check(
      'c06_commander_approval',
      approved.ok && approved.candidates[0]?.status === 'APPROVED' && approved.candidates[0]?.approvedBy === 'commander',
      JSON.stringify(approved.candidates[0]),
    ))

    const councilApprove = approveIngestCandidates({ ids: [pendingId], actor: 'council', corpus, now: NOW })
    cases.push(check(
      'c07_non_commander_approval_rejected',
      !councilApprove.ok && /Only Commander/i.test(councilApprove.error ?? ''),
      councilApprove.error ?? '',
    ))

    const rejectTarget = proposeIngestCandidates({
      corpus,
      now: NOW,
      results: [{ url: blocked, title: 'Blocked', discoveredVia: 'SEARXNG' }],
    }).items[0]!.candidate!
    rejectIngestCandidates({ ids: [rejectTarget.id], actor: 'commander', corpus, now: NOW })
    const rejectedIngest = await ingestApprovedCandidates({
      ids: [rejectTarget.id],
      approval: { actor: 'commander', allowInternalHosts: true },
      corpus,
    })
    cases.push(check(
      'c08_rejected_cannot_ingest',
      rejectedIngest.items[0]?.status === 'REJECTED' && corpus.countDocuments() === 1,
      JSON.stringify({ ingest: rejectedIngest.items[0], documents: corpus.countDocuments() }),
    ))

    const ingested = await ingestApprovedCandidates({
      ids: [pendingId],
      approval: { actor: 'commander', allowInternalHosts: true },
      corpus,
    })
    const stored = corpus.getById(ingested.items[0]?.documentId ?? -1)
    cases.push(check(
      'c09_approved_enters_stage3b',
      ingested.items[0]?.status === 'INGESTED' && stored?.crawlStatus === 'INDEXED' && stored.canonicalUrl.includes('/allowed'),
      JSON.stringify({ ingest: ingested.items[0], crawl: stored?.crawlStatus, url: stored?.canonicalUrl }),
    ))
    cases.push(check(
      'c11_ingest_preserves_provenance',
      stored?.discoveredVia === 'SEARXNG' && Boolean(stored?.alsoDiscoveredVia.includes('TAVILY')),
      JSON.stringify({ via: stored?.discoveredVia, also: stored?.alsoDiscoveredVia }),
    ))

    const extraIds: number[] = []
    for (let i = 0; i < 26; i += 1) {
      extraIds.push(proposeIngestCandidates({
        corpus,
        now: NOW,
        results: [{ url: `https://example.com/stage3c/${i}`, title: `Cap ${i}`, discoveredVia: 'COMMANDER' }],
      }).items[0]!.candidate!.id)
    }
    const overCap = approveIngestCandidates({ ids: extraIds, actor: 'commander', corpus, now: NOW })
    cases.push(check(
      'c10_batch_approval_max_25',
      !overCap.ok && extraIds.length === 26 && MAX_SOVEREIGN_BATCH_URLS === 25 && /maximum of 25/i.test(overCap.error ?? ''),
      JSON.stringify({ count: extraIds.length, error: overCap.error, cap: MAX_SOVEREIGN_BATCH_URLS }),
    ))

    const boomDir = path.join(tmp, 'boom')
    const boom = new ExplodingCandidateCorpus(boomDir)
    const searchResults = [resultFromEvidence(evidence({
      id: 'live-1',
      title: 'Live discovery still works',
      content: 'Federated search continues.',
      url: 'https://example.org/live',
      discovered_via: 'SEARXNG',
      source_label: 'example.org',
    }))]
    const isolated = await discoverIngestCandidates({
      request: { query: 'live discovery isolation' },
      corpus: boom,
      searchImpl: async () => fakeSearch(searchResults, 'live discovery isolation'),
    })
    cases.push(check(
      'c12_candidate_failure_does_not_break_search',
      isolated.search.resultCount === 1 && isolated.search.results[0]?.url === 'https://example.org/live' && Boolean(isolated.candidateError),
      JSON.stringify({ count: isolated.search.resultCount, error: isolated.candidateError }),
    ))
    boom.close()

    const recommendId = extraIds[0]!
    const recommended = recommendIngestCandidate({
      id: recommendId,
      actor: 'council',
      note: 'Council ranks this relevant.',
      corpus,
      now: NOW,
    })
    const councilIngest = await ingestApprovedCandidates({
      ids: [recommendId],
      approval: { actor: 'commander', allowInternalHosts: true },
      corpus,
    })
    cases.push(check(
      'c13_council_cannot_authorize_crawl',
      recommended.ok && recommended.candidates[0]?.status === 'PENDING'
        && recommended.candidates[0]?.councilRecommendation === 'Council ranks this relevant.'
        && councilIngest.items[0]?.status === 'PENDING'
        && !corpus.getByCanonicalUrl('https://example.com/stage3c/0'),
      JSON.stringify({ rec: recommended.candidates[0]?.status, ingest: councilIngest.items[0], doc: Boolean(corpus.getByCanonicalUrl('https://example.com/stage3c/0')) }),
    ))

    const events = corpus.listCandidateEvents(pendingId)
    cases.push(check(
      'c14_audit_timestamps_persist',
      events.some(event => event.eventType === 'CREATED')
        && events.some(event => event.eventType === 'APPROVED' && event.actor === 'commander')
        && events.some(event => event.eventType === 'INGESTED')
        && events.every(event => Boolean(event.createdAt)),
      JSON.stringify(events.map(event => ({ type: event.eventType, actor: event.actor, at: event.createdAt }))),
    ))

    corpus.close()
    const reopened = new SovereignCorpus(tmp)
    const persisted = reopened.getCandidateById(pendingId)
    cases.push(check(
      'c15_restart_persistence',
      persisted?.status === 'INGESTED' && persisted.documentId === stored?.id && persisted.queryContext === 'semiconductor export controls',
      JSON.stringify(persisted),
    ))
    reopened.close()

    const srcFiles = readdirSync(crawlerDir).filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.endsWith('Cli.ts'))
    const src = srcFiles.map(name => readFileSync(path.join(crawlerDir, name), 'utf8')).join('\n')
    cases.push(check(
      'c16_no_recursive_crawl',
      !/\b(followLinks|maxDepth|recursiveCrawl|spider)\b/i.test(src),
      'no recursive crawl primitives',
    ))
    cases.push(check(
      'c17_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|sitemap)\b/i.test(src),
      'no scheduler/recrawl daemon',
    ))
    cases.push(check(
      'c18_no_stage4_vectors',
      !/\b(embedding|bge-?m3|vector database|semantic rerank|pgvector)\b/i.test(src),
      'no Stage 4 terms in crawler',
    ))

    const listed = listIngestCandidates({ corpusRoot: tmp, status: 'REJECTED' })
    cases.push(check(
      'c19_list_rejected_uncrawled',
      listed.length >= 1 && listed.every(item => item.status === 'REJECTED') && !corpusHasUrl(tmp, blocked),
      JSON.stringify(listed.map(item => ({ id: item.id, status: item.status, url: item.url }))),
    ))
  } finally {
    await fixture.close()
  }

  return cases
}

function corpusHasUrl(root: string, url: string): boolean {
  const corpus = new SovereignCorpus(root)
  try {
    const canonical = canonicalizeUrl(url) ?? url
    return Boolean(corpus.getByCanonicalUrl(canonical) || corpus.getByCanonicalUrl(url))
  } finally {
    corpus.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runIngestCandidateValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign ingest-candidate validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
