import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { annotateEvidenceIndependence, clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { stampDiscoveryProvenance } from '../discoveryProvider'
import { collapseToClusterHeads } from '../rankResults'
import { federatedSearch } from '../federatedSearch'
import { formatSearchResult } from '../formatSearchResult'
import { runWarRoomLocalSearch } from '../providers/warRoomLocal'
import { crawlApprovedUrl } from './crawlUrl'
import { searchLocalCorpus } from './localSearch'
import { SovereignCorpus } from './corpus'
import { startCrawlFixture } from './fixtureServer'
import type { CrawlApproval } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage3a fixture' }
const NOW = '2026-09-08T18:00:00.000Z'

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

export async function runLocalIndexValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-local-index-'))
  const fixture = await startCrawlFixture()
  const corpus = new SovereignCorpus(tmp)

  try {
    const crawled = await crawlApprovedUrl({
      url: `${fixture.baseUrl}/allowed`,
      approval: APPROVAL,
      corpus,
      discoveredVia: 'SEARXNG',
      alsoDiscoveredVia: ['GOOGLE'],
    })
    cases.push(check('sqlite_01_insert', Boolean(crawled.document?.id && crawled.document.contentHash), String(crawled.document?.id)))

    const recrawl = await crawlApprovedUrl({ url: `${fixture.baseUrl}/allowed`, approval: APPROVAL, corpus })
    cases.push(check('sqlite_02_update_recrawl', recrawl.status === 'DUPLICATE_URL' && recrawl.document?.id === crawled.document?.id, recrawl.status))

    const hits = searchLocalCorpus('semiconductor export', { corpus, limit: 8 })
    cases.push(check(
      'fts_01_lexical_hit',
      hits.length >= 1 && hits[0]!.document.canonicalUrl === crawled.document?.canonicalUrl && hits[0]!.snippet.length > 0,
      JSON.stringify({ count: hits.length, snip: hits[0]?.snippet, url: hits[0]?.document.canonicalUrl }),
    ))

    const leg = await runWarRoomLocalSearch('semiconductor', { pageSize: 8, corpusRoot: tmp })
    cases.push(check('norm_01_local_result', leg.ok && leg.results[0]?.publisher.includes('127.0.0.1') && leg.results[0]?.storageOrigin === 'WAR_ROOM_CORPUS', JSON.stringify(leg.results[0])))
    cases.push(check(
      'prov_01_discovery_preserved',
      leg.results[0]?.discoveredVia === 'WAR_ROOM_LOCAL' && (leg.results[0]?.alsoDiscoveredVia.includes('SEARXNG') || crawled.document?.discoveredVia === 'SEARXNG'),
      JSON.stringify({ discovered: leg.results[0]?.discoveredVia, also: leg.results[0]?.alsoDiscoveredVia, crawlDiscovered: crawled.document?.discoveredVia }),
    ))
    cases.push(check(
      'prov_02_publisher_not_war_room',
      Boolean(leg.results[0] && !/war room/i.test(leg.results[0].publisher) && leg.results[0].domain.includes('127.0.0.1')),
      JSON.stringify({ publisher: leg.results[0]?.publisher, domain: leg.results[0]?.domain }),
    ))

    const live = evidence({
      id: 'g-reuters',
      title: crawled.document?.title || 'Chip export controls widen',
      content: 'Governments expand semiconductor export rules in East Asia.',
      url: crawled.document?.canonicalUrl,
      source_id: 'google_web_search',
      source_label: crawled.document?.publisher,
      discovered_via: 'GOOGLE',
    })
    const local = evidence({
      id: 'local-1',
      title: crawled.document?.title || 'Chip export controls widen',
      content: crawled.document?.contentText || 'semiconductor export',
      url: crawled.document?.canonicalUrl,
      source_id: 'war_room_local',
      source_label: crawled.document?.publisher,
      discovered_via: 'WAR_ROOM_LOCAL',
      storage_origin: 'WAR_ROOM_CORPUS',
      content_hash: crawled.document?.contentHash,
    })
    const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(stampDiscoveryProvenance([live, local]), {
      region: null,
      queryLanguage: 'en',
      fallbackUsed: false,
      fallbackReason: null,
    }))
    const { heads, alsoReportedBy } = collapseToClusterHeads(clustered.items)
    cases.push(check(
      'build6_01_local_live_same_url_collapses',
      heads.length === 1 && clustered.items.every(item => item.semantic_cluster_id === heads[0]?.semantic_cluster_id),
      JSON.stringify({ heads: heads.map(item => item.id), also: [...alsoReportedBy.entries()] }),
    ))
    const formatted = formatSearchResult({ item: heads[0]!, score: 1, rankBreakdown: { relevance: 1, authority: 0, freshness: 0, primary: 0, independence: 1, regional: 0, duplicatePenalty: 0 } })
    cases.push(check(
      'norm_02_search_result_shape',
      formatted.canonicalUrl === crawled.document?.canonicalUrl && Boolean(formatted.publisher?.includes('127.0.0.1')),
      JSON.stringify({ canonical: formatted.canonicalUrl, publisher: formatted.publisher, storage: formatted.storageOrigin, discovered: formatted.discoveredVia }),
    ))

    corpus.close()
    const reopened = new SovereignCorpus(tmp)
    const persisted = searchLocalCorpus('semiconductor', { corpus: reopened, limit: 4 })
    cases.push(check('persist_01_reopen_sqlite', persisted.length >= 1 && persisted[0]!.document.contentHash === crawled.document?.contentHash, String(persisted.length)))
    reopened.close()

    const previous = process.env.WAR_ROOM_SOVEREIGN_SEARCH_DIR
    const badPath = path.join(tmp, 'not-a-directory')
    writeFileSync(badPath, 'not sqlite')
    process.env.WAR_ROOM_SOVEREIGN_SEARCH_DIR = badPath
    try {
      const failedLeg = await runWarRoomLocalSearch('semiconductor', { corpusRoot: badPath })
      cases.push(check('fail_01_local_degrades', !failedLeg.ok && failedLeg.warningCode === 'WAR_ROOM_LOCAL_UNAVAILABLE', JSON.stringify(failedLeg)))
      const aborted = await federatedSearch({ query: 'semiconductor policy' }, { signal: AbortSignal.abort() })
      cases.push(check(
        'fail_02_federated_survives_local',
        aborted.aborted === true && typeof aborted.sourceSummary.warRoomLocalOk === 'boolean' && typeof aborted.sourceSummary.searxngOk === 'boolean',
        JSON.stringify(aborted.sourceSummary),
      ))
    } finally {
      if (previous === undefined) delete process.env.WAR_ROOM_SOVEREIGN_SEARCH_DIR
      else process.env.WAR_ROOM_SOVEREIGN_SEARCH_DIR = previous
    }

    const crawlerDir = path.join(process.cwd(), 'lib', 'war-room-search', 'crawler')
    const files = readdirSync(crawlerDir).filter(name => name.endsWith('.ts') && !name.includes('.validation.') && !name.endsWith('Cli.ts'))
    const blob = files.map(name => readFileSync(path.join(crawlerDir, name), 'utf8')).join('\n')
    cases.push(check(
      'stage4_01_no_embeddings',
      !/\b(embedding|bge-?m3|vector database|semantic rerank|pgvector)\b/i.test(blob),
      'no Stage 4 terms in crawler',
    ))
    cases.push(check(
      'stage5_01_no_scheduler',
      !/\b(cron|setInterval|recrawl daemon|autonomous scheduler)\b/i.test(blob),
      'no Stage 5 scheduler in crawler',
    ))
  } finally {
    await fixture.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runLocalIndexValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Local index validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
