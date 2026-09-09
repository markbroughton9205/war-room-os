import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { collapseToClusterHeads } from '../rankResults'
import { crawlApprovedUrl } from './crawlUrl'
import { crawlApprovedBatch, parseBatchInputJson, MAX_SOVEREIGN_BATCH_URLS } from './batchCrawl'
import { SovereignCorpus } from './corpus'
import { startCrawlFixture } from './fixtureServer'
import { MAX_SOVEREIGN_BATCH_URLS as MAX_FROM_TYPES, type CrawlApproval, type CrawlDocumentRecord } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage3b fixture' }
const NOW = '2026-09-09T05:30:00.000Z'

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: overrides.source_id ?? 'fixture',
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

class ExplodingCorpus extends SovereignCorpus {
  private upserts = 0
  constructor(rootDir: string, private readonly explodeOn: number) {
    super(rootDir)
  }
  override upsertDocument(input: Parameters<SovereignCorpus['upsertDocument']>[0]): CrawlDocumentRecord {
    this.upserts += 1
    if (this.upserts >= this.explodeOn) throw new Error('SQLITE_IOERR disk I/O error')
    return super.upsertDocument(input)
  }
}

export async function runBatchCrawlValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const fixture = await startCrawlFixture()
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-sovereign-batch-'))

  try {
    const corpus = new SovereignCorpus(tmp)
    const multi = await crawlApprovedBatch({
      urls: [
        { url: `${fixture.baseUrl}/allowed`, discoveredVia: 'SEARXNG' },
        { url: `${fixture.baseUrl}/plain`, discoveredVia: 'COMMANDER' },
      ],
      approval: APPROVAL,
      corpus,
    })
    cases.push(check(
      'batch_01_multi_url_success',
      multi.ok && multi.summary.indexed === 2 && multi.summary.requested === 2 && multi.summary.processed === 2 && multi.items.every(item => item.status === 'INDEXED'),
      JSON.stringify(multi.summary),
    ))

    const mixedCorpus = new SovereignCorpus(path.join(tmp, 'mixed'))
    const mixed = await crawlApprovedBatch({
      urls: [
        { url: `${fixture.baseUrl}/allowed` },
        { url: `${fixture.baseUrl}/blocked` },
        { url: `${fixture.baseUrl}/server-error` },
        { url: `${fixture.baseUrl}/unsupported` },
        { url: `${fixture.baseUrl}/empty` },
      ],
      approval: APPROVAL,
      corpus: mixedCorpus,
    })
    const mixedStatuses = mixed.items.map(item => item.status)
    cases.push(check(
      'batch_02_mixed_allowed_disallowed',
      mixedStatuses.includes('INDEXED') && mixedStatuses.includes('BLOCKED_ROBOTS') && mixed.summary.blockedRobots === 1 && mixed.summary.indexed === 1,
      mixedStatuses.join(','),
    ))
    cases.push(check(
      'batch_03_one_failure_does_not_abort',
      mixed.ok && mixed.summary.processed === 5 && mixed.items[0]?.status === 'INDEXED' && mixed.items[2]?.status === 'FETCH_FAILED' && mixed.items[3]?.status === 'UNSUPPORTED_TYPE' && mixed.items[4]?.status === 'EXTRACT_FAILED',
      JSON.stringify(mixed.summary) + ' ' + mixedStatuses.join(','),
    ))

    const over = await crawlApprovedBatch({
      urls: Array.from({ length: MAX_SOVEREIGN_BATCH_URLS + 1 }, (_, index) => ({ url: `${fixture.baseUrl}/allowed?n=${index}` })),
      approval: APPROVAL,
      corpus: mixedCorpus,
    })
    cases.push(check(
      'batch_04_maximum_limit',
      !over.ok && over.errorCategory === 'BATCH_LIMIT' && over.summary.requested === MAX_SOVEREIGN_BATCH_URLS + 1 && over.summary.processed === 0 && over.items.length === 0 && MAX_FROM_TYPES === 25,
      JSON.stringify({ ...over.summary, error: over.error, cap: MAX_SOVEREIGN_BATCH_URLS }),
    ))

    const dupUrlCorpus = new SovereignCorpus(path.join(tmp, 'dup-url'))
    const dupUrl = await crawlApprovedBatch({
      urls: [
        { url: `${fixture.baseUrl}/allowed` },
        { url: `${fixture.baseUrl}/allowed` },
      ],
      approval: APPROVAL,
      corpus: dupUrlCorpus,
    })
    cases.push(check(
      'batch_05_duplicate_canonical_within_batch',
      dupUrl.items[0]?.status === 'INDEXED' && dupUrl.items[1]?.status === 'DUPLICATE_URL' && dupUrl.items[0]?.documentId === dupUrl.items[1]?.documentId && dupUrlCorpus.countDocuments() === 1,
      JSON.stringify(dupUrl.items.map(item => ({ status: item.status, id: item.documentId, canonical: item.canonicalUrl }))),
    ))

    const dupContentCorpus = new SovereignCorpus(path.join(tmp, 'dup-content'))
    const dupContent = await crawlApprovedBatch({
      urls: [
        { url: `${fixture.baseUrl}/duplicate-a` },
        { url: `${fixture.baseUrl}/duplicate-b` },
      ],
      approval: APPROVAL,
      corpus: dupContentCorpus,
    })
    cases.push(check(
      'batch_06_duplicate_content_within_batch',
      dupContent.items[0]?.status === 'INDEXED' && dupContent.items[1]?.status === 'DUPLICATE_CONTENT' && dupContent.items[0]?.contentHash === dupContent.items[1]?.contentHash && dupContent.items[0]?.canonicalUrl !== dupContent.items[1]?.canonicalUrl,
      JSON.stringify(dupContent.items.map(item => ({ status: item.status, hash: item.contentHash, canonical: item.canonicalUrl }))),
    ))

    const existing = await crawlApprovedUrl({ url: `${fixture.baseUrl}/plain`, approval: APPROVAL, corpus: dupUrlCorpus })
    const already = await crawlApprovedBatch({
      urls: [{ url: `${fixture.baseUrl}/plain`, discoveredVia: 'GOOGLE' }],
      approval: APPROVAL,
      corpus: dupUrlCorpus,
    })
    cases.push(check(
      'batch_07_already_indexed_url',
      existing.status === 'INDEXED' && already.items[0]?.status === 'DUPLICATE_URL' && already.items[0]?.documentId === existing.document?.id,
      `${existing.status}/${already.items[0]?.status}/${already.items[0]?.documentId}`,
    ))

    cases.push(check(
      'batch_08_provenance_per_url',
      multi.items[0]?.discoveredVia === 'SEARXNG' && multi.items[1]?.discoveredVia === 'COMMANDER' && multi.items[0]?.publisher !== 'WAR_ROOM_LOCAL',
      JSON.stringify(multi.items.map(item => ({ via: item.discoveredVia, publisher: item.publisher }))),
    ))

    const boomRoot = path.join(tmp, 'boom')
    const boom = new ExplodingCorpus(boomRoot, 2)
    const storage = await crawlApprovedBatch({
      urls: [
        { url: `${fixture.baseUrl}/allowed` },
        { url: `${fixture.baseUrl}/plain` },
        { url: `${fixture.baseUrl}/duplicate-a` },
      ],
      approval: APPROVAL,
      corpus: boom,
    })
    boom.close()
    const boomReopen = new SovereignCorpus(boomRoot)
    cases.push(check(
      'batch_09_storage_failure_aborts_remaining',
      !storage.ok && storage.errorCategory === 'STORAGE_FAILED' && storage.items[0]?.status === 'INDEXED' && storage.items[1]?.status === 'FETCH_FAILED' && storage.items[2]?.status === 'FETCH_FAILED' && storage.items[2]?.errorCategory === 'STORAGE_FAILED' && boomReopen.countDocuments() === 1,
      JSON.stringify({ summary: storage.summary, items: storage.items.map(item => ({ status: item.status, err: item.errorCategory })), count: boomReopen.countDocuments() }),
    ))
    boomReopen.close()

    cases.push(check(
      'batch_10_summary_counts',
      mixed.summary.requested === 5 && mixed.summary.processed === 5 && mixed.summary.indexed === 1 && mixed.summary.blockedRobots === 1 && mixed.summary.failed === 3 && mixed.summary.duplicateUrl === 0 && mixed.summary.durationMs >= 0,
      JSON.stringify(mixed.summary),
    ))

    const live = evidence({
      id: 'g-allowed',
      title: 'Chip export controls widen',
      content: 'Governments expand semiconductor export rules in East Asia.',
      url: mixed.items[0]?.canonicalUrl ?? `${fixture.baseUrl}/allowed`,
      source_id: 'google_web_search',
      source_label: mixed.items[0]?.publisher ?? '127.0.0.1',
      discovered_via: 'GOOGLE',
    })
    const local = evidence({
      id: 'local-allowed',
      title: 'Chip export controls widen',
      content: 'Governments expand semiconductor export rules in East Asia.',
      url: mixed.items[0]?.canonicalUrl ?? `${fixture.baseUrl}/allowed`,
      source_id: 'war_room_local',
      source_label: mixed.items[0]?.publisher ?? '127.0.0.1',
      discovered_via: 'WAR_ROOM_LOCAL',
      storage_origin: 'WAR_ROOM_CORPUS',
    })
    const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(stampDiscoveryProvenance([live, local]), {
      region: null,
      queryLanguage: 'en',
      fallbackUsed: false,
      fallbackReason: null,
    }))
    const collapsed = collapseToClusterHeads(clustered.items)
    cases.push(check(
      'batch_11_build6_after_batch',
      collapsed.heads.length === 1 && clustered.items.every(item => item.semantic_cluster_id === collapsed.heads[0]?.semantic_cluster_id),
      JSON.stringify({ heads: collapsed.heads.map(item => item.id), also: collapsed.heads[0]?.also_discovered_via }),
    ))

    const linkCorpus = new SovereignCorpus(path.join(tmp, 'links'))
    const links = await crawlApprovedBatch({
      urls: [{ url: `${fixture.baseUrl}/with-links`, discoveredVia: 'COMMANDER' }],
      approval: APPROVAL,
      corpus: linkCorpus,
    })
    const allowedAfterLinks = linkCorpus.getByCanonicalUrl(`https://127.0.0.1:${fixture.port}/allowed`)
    cases.push(check(
      'batch_12_no_recursive_link_following',
      links.items[0]?.status === 'INDEXED' && linkCorpus.countDocuments() === 1 && !allowedAfterLinks,
      JSON.stringify({ status: links.items[0]?.status, count: linkCorpus.countDocuments(), extra: allowedAfterLinks?.canonicalUrl ?? null }),
    ))
    linkCorpus.close()
    dupUrlCorpus.close()
    dupContentCorpus.close()
    mixedCorpus.close()
    corpus.close()

    const crawlerDir = path.join(process.cwd(), 'lib', 'war-room-search', 'crawler')
    const files = readdirSync(crawlerDir).filter(name => name.endsWith('.ts') && !name.includes('.validation.'))
    const blob = files.map(name => readFileSync(path.join(crawlerDir, name), 'utf8')).join('\n')
    cases.push(check(
      'batch_13_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler|sitemap)\b/i.test(blob),
      'no scheduler/sitemap in crawler',
    ))
    cases.push(check(
      'batch_14_no_stage4_vectors',
      !/\b(embedding|bge-?m3|vector database|semantic rerank|pgvector)\b/i.test(blob),
      'no Stage 4 terms in crawler',
    ))

    const parsed = parseBatchInputJson(JSON.stringify({
      urls: [
        { url: 'https://example.com', discoveredVia: 'COMMANDER' },
        'https://example.org',
      ],
    }))
    cases.push(check(
      'batch_15_json_input_shape',
      parsed.urls.length === 2 && parsed.urls[0]?.discoveredVia === 'COMMANDER' && parsed.urls[1]?.url === 'https://example.org' && !parsed.error,
      JSON.stringify(parsed),
    ))
  } finally {
    await fixture.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBatchCrawlValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign batch crawl validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
