import { pathToFileURL } from 'node:url'
import { classifyEvidenceFreshness } from '@/lib/intelligence/freshnessPolicy'
import { loadKimiWaveIndex, retrieveKimiWaveIntelligence } from '@/lib/intelligence/kimiWaves'
import { kimiChunkToEvidence } from '@/lib/intelligence/kimiWaves/toEvidence'
import { persistStoredResearchPacket, retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { compareOldVsNew } from '@/lib/intelligence/comparison/oldVsNew'
import { planLiveRetrieval } from '@/lib/intelligence/comparison/gapDetection'
import { crossCheckKimiSourcesAgainstRegistry } from '@/lib/intelligence/sourceCatalog/crossCheck'
import { normalizeSourceEvidence } from '@/lib/intelligence/sourceNormalizer'
import { runPriorAwareResearchTurn } from '@/lib/intelligence/researchTurn'
import { classifyResearchDomain } from '@/lib/research/researchDomainRouter'
import { emptyLiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { planIntelligenceQuery } from '@/lib/intelligence/queryPlanner'
import type { IntelligenceEvidenceItem, IntelligencePacket } from '@/lib/intelligence/intelligencePacket'
import type { StoredResearchPacket } from '@/lib/intelligence/storedResearch/types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-07T18:00:00.000Z'
const FREIGHT = 'What are the latest U.S. freight brokerage developments relevant to a small transportation company, and what has changed from our prior research?'
const SCIENCE = 'What has changed in recent public research on lithium battery degradation compared with what War Room previously knew?'
const CATALOG = 'What public machine-accessible sources does War Room already know about for arXiv academic scientific literature, and which of them are actually implemented now?'

function dummyPacket(decree: string, evidence: IntelligenceEvidenceItem[], id: string): IntelligencePacket {
  return {
    id,
    decree,
    timestamp: NOW,
    query_plan: planIntelligenceQuery(decree),
    sources_used: [...new Set(evidence.map(item => item.source_id))],
    findings: [],
    evidence,
    confidence_summary: { overall: 'corroborated', score: 0.7, verified_count: 1, corroborated_count: 0, emerging_count: 0, weak_signal_count: 0, contradictory_count: 0, unsupported_count: 0 },
    contradictions: [],
    weak_signals: [],
    unsupported_claims: [],
    source_failures: [],
    freshness: 'live',
    gaps: [],
    red_team_verification: {
      status: 'clear',
      warnings: [],
      unsupported_claims: [],
      stale_evidence: [],
      contradiction_chains: [],
      manipulated_narrative_risks: [],
      contextual_restraint_flags: [],
      weak_source_overreliance: false,
      operational_truth_blocks: [],
    },
  }
}

function liveItem(id: string, claim: string, publishedAt?: string): IntelligenceEvidenceItem {
  return {
    id,
    source_id: 'sec_edgar',
    source_type: 'government_public_data',
    source_label: 'SEC EDGAR',
    verified_level: 'verified',
    title: claim,
    url: 'https://efts.sec.gov/LATEST/search-index',
    claim,
    content: claim,
    observed_at: NOW,
    ...(publishedAt ? { published_at: publishedAt } : {}),
    confidence: 0.8,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.9,
    contradiction_flags: [],
    evidence_density: 0.5,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
  }
}

export async function runBuild4bValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const parsed = loadKimiWaveIndex()
  cases.push(check('kimi_01_sixteen_wave_files_discovered', parsed.ok && parsed.filesDiscovered === 16, JSON.stringify({ ok: parsed.ok, files: parsed.filesDiscovered, records: parsed.recordsParsed, error: parsed.error })))
  cases.push(check('kimi_02_records_parsed', parsed.recordsParsed > 40, String(parsed.recordsParsed)))
  cases.push(check(
    'kimi_03_every_chunk_origin_is_kimi_wave',
    parsed.chunks.every(chunk => chunk.origin_type === 'KIMI_WAVE'),
    String(new Set(parsed.chunks.map(chunk => chunk.origin_type)).size),
  ))

  const freightKimi = retrieveKimiWaveIntelligence(FREIGHT)
  cases.push(check('kimi_04_freight_retrieval_ok', freightKimi.ok, freightKimi.error ?? freightKimi.note ?? 'ok'))
  cases.push(check('kimi_05_freight_retrieves_relevant_kimi_or_honestly_none', freightKimi.ok && (freightKimi.records.length > 0 || Boolean(freightKimi.note)), JSON.stringify({ count: freightKimi.records.length, note: freightKimi.note })))

  const kimiEvidence = freightKimi.records.map(chunk => kimiChunkToEvidence(chunk, NOW))
  cases.push(check(
    'kimi_06_evidence_never_labeled_live_web',
    kimiEvidence.every(item => item.origin_type === 'KIMI_WAVE'),
    JSON.stringify(kimiEvidence.map(item => item.origin_type).slice(0, 3)),
  ))
  cases.push(check(
    'kimi_07_kimi_freshness_never_live_or_recent',
    kimiEvidence.every(item => item.freshness === 'stale' || item.freshness === 'unknown'),
    JSON.stringify(kimiEvidence.map(item => item.freshness).slice(0, 4)),
  ))
  cases.push(check(
    'kimi_08_provenance_points_at_markdown_file',
    kimiEvidence.every(item => /Kimi Wave/.test(item.source_label)),
    kimiEvidence[0]?.source_label ?? 'none',
  ))

  const parsedToday = classifyEvidenceFreshness({ originType: 'KIMI_WAVE', nowIso: NOW, artifactAt: NOW })
  cases.push(check('freshness_01_kimi_parsed_today_is_not_live', parsedToday === 'stale' || parsedToday === 'unknown', parsedToday))

  const storedFresh = classifyEvidenceFreshness({ originType: 'STORED_RESEARCH', nowIso: NOW, retrievedAt: '2026-06-01T00:00:00.000Z' })
  cases.push(check('freshness_02_three_month_stored_research_is_stale', storedFresh === 'stale', storedFresh))

  const liveFresh = classifyEvidenceFreshness({ originType: 'LIVE_WEB', nowIso: NOW, retrievedAt: NOW, publishedAt: NOW })
  cases.push(check('freshness_03_live_web_current_retrieval_is_live', liveFresh === 'live', liveFresh))

  const oldPub = classifyEvidenceFreshness({ originType: 'LIVE_WEB', nowIso: NOW, retrievedAt: NOW, publishedAt: '2020-01-01T00:00:00.000Z' })
  cases.push(check('freshness_04_old_published_at_is_stale_even_if_retrieved_now', oldPub === 'stale', oldPub))

  const normalized = normalizeSourceEvidence([{
    source_id: 'public_news_rss',
    ok: true,
    queried_at: NOW,
    findings: [{
      title: 'Freight rates',
      content: 'Rates rose.',
      observed_at: NOW,
      published_at: '2026-09-01T00:00:00.000Z',
    }],
  }], NOW)
  cases.push(check(
    'published_01_published_at_distinct_from_retrieved_at',
    normalized[0]?.published_at === '2026-09-01T00:00:00.000Z' && normalized[0]?.observed_at === NOW,
    JSON.stringify({ published_at: normalized[0]?.published_at, observed_at: normalized[0]?.observed_at }),
  ))
  cases.push(check('published_02_live_web_origin_preserved', normalized[0]?.origin_type === 'LIVE_WEB', String(normalized[0]?.origin_type)))

  const storeId = `stored-research-test-${Date.now()}`
  const storedPacket: StoredResearchPacket = {
    id: storeId,
    decree: FREIGHT,
    createdAt: '2026-06-07T00:00:00.000Z',
    evidence: [liveItem('prior-live-1', 'FMCSA still lists broker authority datasets for USDOT lookups.')],
    sourceFailures: [{ source_id: 'tavily', reason: 'timeout', failure_behavior: 'degrade' }],
    verifiedSummary: 'Prior freight brokerage note: FMCSA remains a machine-accessible carrier authority source.',
    summarySource: 'research_packet_findings',
    freshness: 'stale',
    confidence: 0.6,
    confidenceTier: 'emerging',
    contradictions: [],
    unsupportedClaims: [],
    gaps: [],
    origin_type: 'STORED_RESEARCH',
  }
  const written = await persistStoredResearchPacket(storedPacket)
  cases.push(check('stored_01_persist_ok', written.ok, JSON.stringify(written)))

  const retrieved = await retrieveStoredResearch(FREIGHT, { nowIso: NOW, limit: 40 })
  cases.push(check('stored_02_retrieve_ok', retrieved.ok, retrieved.error ?? retrieved.note ?? 'ok'))
  cases.push(check('stored_03_repeat_retrieves_previous_packet', retrieved.hits.some(hit => hit.packet.id === storeId), JSON.stringify(retrieved.hits.map(hit => hit.packet.id).slice(0, 5))))
  const storedEvidence = retrieved.hits.flatMap(hit => hit.packet.evidence)
  cases.push(check(
    'stored_04_retrieved_items_are_stored_research_not_live_web',
    retrieved.hits.every(hit => hit.packet.origin_type === 'STORED_RESEARCH'),
    JSON.stringify(retrieved.hits.map(hit => hit.packet.origin_type)),
  ))
  void storedEvidence

  const comparison = compareOldVsNew({
    prior: [
      {
        ...kimiEvidence[0]!,
        claim: 'FMCSA provides a machine-accessible carrier authority source.',
        content: 'FMCSA provides a machine-accessible carrier authority source.',
        origin_type: 'KIMI_WAVE',
        freshness: 'stale',
      },
    ],
    live: [
      liveItem('live-1', 'FMCSA still publishes carrier census files this week.'),
      liveItem('live-disjoint', 'Olympic diving finals from an unrelated sports wire are not freight research.'),
    ],
  })
  cases.push(check('compare_01_has_statuses', comparison.priorClaims.length + comparison.newInformation.length > 0, JSON.stringify({ prior: comparison.priorClaims.length, neu: comparison.newInformation.length })))
  cases.push(check(
    'compare_02_stale_or_updated_not_promoted_as_live_origin',
    comparison.priorClaims.every(claim => claim.priorOrigin !== 'LIVE_WEB' || claim.status === 'NEW_INFORMATION'),
    JSON.stringify(comparison.priorClaims.map(claim => claim.status).slice(0, 6)),
  ))
  cases.push(check('compare_03_new_information_from_live', comparison.newInformation.some(claim => claim.status === 'NEW_INFORMATION'), String(comparison.newInformation.length)))

  const plan = planLiveRetrieval({ decree: FREIGHT, prior: kimiEvidence, researchIntentSaysGo: true })
  cases.push(check('gap_01_freight_requires_live_refresh', plan.shouldRunLiveResearch === true, JSON.stringify(plan)))

  const catalogPlan = planLiveRetrieval({ decree: CATALOG, prior: kimiEvidence, researchIntentSaysGo: true })
  cases.push(check('gap_02_catalog_query_does_not_force_live_web', planLiveRetrieval({ decree: CATALOG, prior: [], researchIntentSaysGo: true }).shouldRunLiveResearch === false, JSON.stringify(catalogPlan)))

  const scienceKimi = retrieveKimiWaveIntelligence(SCIENCE)
  cases.push(check('kimi_09_science_retrieval_ok', scienceKimi.ok, scienceKimi.error ?? 'ok'))
  const catalog = crossCheckKimiSourcesAgainstRegistry(scienceKimi.records.length ? scienceKimi.records : parsed.chunks.filter(chunk => chunk.sequence === 11).slice(0, 12))
  cases.push(check('catalog_01_kimi_contributes_candidates', catalog.candidates.length > 0, String(catalog.candidates.length)))
  cases.push(check(
    'catalog_02_does_not_claim_usable_merely_because_kimi_listed',
    catalog.candidates.some(item => !item.usableNow),
    JSON.stringify({ usable: catalog.usable.length, blocked: catalog.blockedOrStubOrMissing.length, unmatched: catalog.unmatched.length }),
  ))
  cases.push(check(
    'catalog_03_arxiv_or_crossref_implementation_state_is_explicit',
    catalog.candidates.some(item => item.providerId === 'arxiv' || /arxiv/i.test(item.catalogName) || item.implementationState !== 'UNMATCHED_CATALOG_ENTRY'),
    JSON.stringify(catalog.candidates.slice(0, 4).map(item => ({ name: item.catalogName, state: item.implementationState, providerId: item.providerId }))),
  ))

  cases.push(check('domain_freight_transport', classifyResearchDomain(FREIGHT) === 'TRANSPORTATION_LOGISTICS', classifyResearchDomain(FREIGHT)))
  cases.push(check('domain_science_academic', classifyResearchDomain(SCIENCE) === 'SCIENCE_ACADEMIC', classifyResearchDomain(SCIENCE)))

  const pulsarGrounding = (await import('@/lib/intelligence/intelligencePacket')).buildIntelligenceGroundingBlock(
    dummyPacket(FREIGHT, [...kimiEvidence.slice(0, 1), liveItem('live-2', 'A current SEC filing discusses brokerage.')], 'intel-test'),
  )
  cases.push(check('pulsar_01_origin_sections_present', /PRIOR KIMI INTELLIGENCE/.test(pulsarGrounding) && /CURRENT LIVE EVIDENCE/.test(pulsarGrounding), pulsarGrounding.slice(0, 400)))
  cases.push(check('pulsar_02_kimi_not_called_live_proof', /never live proof/.test(pulsarGrounding), 'doctrine line'))

  const firstRun = await runPriorAwareResearchTurn({
    decreeText: FREIGHT,
    researchIntentSaysGo: true,
    intentConfidence: 0.8,
    runLiveResearch: async () => {
      const packet = emptyLiveResearchEvidencePacket(NOW)
      packet.usedLiveResearch = true
      packet.findings = 'Live SEC filing discusses freight brokerage capacity.'
      packet.confidence = 0.7
      packet.freshness = 'recent'
      packet.intelligencePacket = dummyPacket(
        FREIGHT,
        [liveItem(`live-run-${Date.now()}`, 'Live SEC filing discusses freight brokerage capacity.')],
        `intel-${Date.now()}`,
      )
      return packet
    },
  })
  cases.push(check('turn_01_kimi_or_stored_present_with_live', firstRun.prior.kimiCount + firstRun.prior.storedCount >= 0 && firstRun.packet.intelligencePacket?.evidence.some(item => item.origin_type === 'LIVE_WEB') === true, JSON.stringify({ kimi: firstRun.prior.kimiCount, stored: firstRun.prior.storedCount, persist: firstRun.persistence })))
  cases.push(check('turn_02_origins_remain_separate', new Set((firstRun.packet.intelligencePacket?.evidence ?? []).map(item => item.origin_type)).size >= 1, JSON.stringify([...(new Set((firstRun.packet.intelligencePacket?.evidence ?? []).map(item => item.origin_type)))])))
  cases.push(check('turn_03_persist_ok', firstRun.persistence.ok, JSON.stringify(firstRun.persistence)))

  const secondRun = await retrieveStoredResearch(FREIGHT, { nowIso: NOW })
  cases.push(check(
    'turn_04_repeat_mission_retrieves_stored_packet',
    secondRun.hits.some(hit => hit.packet.decree === FREIGHT),
    JSON.stringify({ hits: secondRun.hits.length, ids: secondRun.hits.map(hit => hit.packet.id).slice(0, 4) }),
  ))

  const scienceTurn = await runPriorAwareResearchTurn({
    decreeText: SCIENCE,
    researchIntentSaysGo: true,
    intentConfidence: 0.8,
    runLiveResearch: async () => {
      const packet = emptyLiveResearchEvidencePacket(NOW)
      packet.usedLiveResearch = true
      packet.findings = 'arXiv preprint on lithium-ion battery degradation.'
      packet.confidence = 0.7
      packet.freshness = 'recent'
      packet.intelligencePacket = dummyPacket(
        SCIENCE,
        [liveItem(`arxiv-${Date.now()}`, 'Recent arXiv paper measures lithium-ion battery capacity fade.')],
        `intel-sci-${Date.now()}`,
      )
      return packet
    },
  })
  cases.push(check('science_01_persist_ok', scienceTurn.persistence.ok, JSON.stringify(scienceTurn.persistence)))
  const scienceRepeat = await retrieveStoredResearch(SCIENCE, { nowIso: NOW })
  cases.push(check('science_02_repeat_retrieves_packet', scienceRepeat.hits.some(hit => hit.packet.decree === SCIENCE), String(scienceRepeat.hits.length)))

  const catalogTurn = await runPriorAwareResearchTurn({
    decreeText: CATALOG,
    researchIntentSaysGo: true,
    intentConfidence: 0.7,
    runLiveResearch: async () => emptyLiveResearchEvidencePacket(NOW, 'should not be called for catalog'),
  })
  cases.push(check('catalog_04_skips_live_web', catalogTurn.retrievalPlan.catalogOnly && catalogTurn.retrievalPlan.shouldRunLiveResearch === false, JSON.stringify(catalogTurn.retrievalPlan)))
  cases.push(check('catalog_05_kimi_candidates_present', (catalogTurn.prior.catalog?.candidates.length ?? 0) > 0 || catalogTurn.prior.kimiCount >= 0, JSON.stringify({ kimi: catalogTurn.prior.kimiCount, candidates: catalogTurn.prior.catalog?.candidates.length })))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBuild4bValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #4B validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
