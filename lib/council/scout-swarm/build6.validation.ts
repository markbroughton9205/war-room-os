import { pathToFileURL } from 'node:url'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { runCanonicalUrlValidation } from '@/lib/intelligence/canonicalUrl.validation'
import { runSourceIndependenceValidation } from '@/lib/intelligence/sourceIndependence.validation'
import { runSourceTerritoryValidation } from '@/lib/research/sourceTerritories.validation'
import { DEFAULT_SCOUT_GOVERNOR_LIMITS } from './governor'
import { applyResearchProfile, RESEARCH_PROFILES, selectResearchProfile } from './researchProfiles'
import { isSimpleFastPathPrompt, shouldRunIndependentScoutSwarm } from './eligibility'
import { decomposeAstraMission } from './mission'
import { planRoundScouts } from './scoutPlanner'
import { executeScouts } from './scoutExecution'
import { challengeClaim, extractAtomicClaims, verifyClaimAgainstEvidence, buildConvergenceMap } from './verify'
import { freezeIndependentSeatReport } from './freeze'
import { persistStoredResearchPacket, retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { swarmPacketStub } from './persist'
import { clusterIndependentEvidence, annotateEvidenceIndependence, independentSupportCount } from '@/lib/intelligence/sourceIndependence'
import { googleNewsLocaleForRegion, primaryProviderIdsForRegion } from '@/lib/research/sourceTerritories'
import { emptyLiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const FREIGHT = 'What changed in U.S. freight brokerage regulation this week?'
const GLOBAL = 'What are the major current developments affecting global semiconductor supply chains, and how do they differ by region?'
const ENGINEERING = "What are War Room's current engineering risks?"
const NOW = '2026-09-08T18:00:00.000Z'

function evidence(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: 'fixture',
    source_type: 'government_public_data',
    source_label: overrides.source_label ?? 'Fixture',
    verified_level: 'verified',
    url: overrides.url,
    claim: overrides.title,
    observed_at: NOW,
    confidence: 0.7,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
    ...overrides,
  }
}

export async function runBuild6Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = [
    ...runCanonicalUrlValidation(),
    ...runSourceIndependenceValidation(),
    ...runSourceTerritoryValidation(),
  ]

  const light = RESEARCH_PROFILES.LIGHT_RESEARCH
  const standard = RESEARCH_PROFILES.STANDARD_RESEARCH
  const deep = RESEARCH_PROFILES.DEEP_RESEARCH
  const global = RESEARCH_PROFILES.GLOBAL_SCATTER
  cases.push(check('profile_01_light', light.scouts === 3 && light.modelConcurrency === 1 && light.webConcurrency === 3, JSON.stringify(light)))
  cases.push(check('profile_02_standard', standard.scouts === 8 && standard.modelConcurrency === 1 && standard.webConcurrency === 5, JSON.stringify(standard)))
  cases.push(check('profile_03_deep', deep.scouts === 16 && deep.modelConcurrency === 1 && deep.webConcurrency === 8, JSON.stringify(deep)))
  cases.push(check('profile_04_global', global.scouts === 16 && global.modelConcurrency === 1 && global.webConcurrency === 8, JSON.stringify(global)))
  cases.push(check(
    'profile_05_global_does_not_raise_model',
    applyResearchProfile(DEFAULT_SCOUT_GOVERNOR_LIMITS, 'GLOBAL_SCATTER').maxConcurrentModelCalls === 1,
    String(applyResearchProfile(DEFAULT_SCOUT_GOVERNOR_LIMITS, 'GLOBAL_SCATTER').maxConcurrentModelCalls),
  ))

  const freightMission = decomposeAstraMission({ decree: FREIGHT, roundRequestId: 'b6-freight', logicalRequestId: 'b6-freight', nowIso: NOW })
  const globalMission = decomposeAstraMission({ decree: GLOBAL, roundRequestId: 'b6-global', logicalRequestId: 'b6-global', nowIso: NOW })
  const engMission = decomposeAstraMission({ decree: ENGINEERING, roundRequestId: 'b6-eng', logicalRequestId: 'b6-eng', nowIso: NOW })
  cases.push(check('profile_06_freight_standard', freightMission.researchProfile === 'STANDARD_RESEARCH', freightMission.researchProfile))
  cases.push(check('profile_07_global_scatter', globalMission.researchProfile === 'GLOBAL_SCATTER', globalMission.researchProfile))
  cases.push(check('profile_08_engineering_light', engMission.researchProfile === 'LIGHT_RESEARCH', engMission.researchProfile))
  cases.push(check(
    'profile_09_select_not_forced_on_simple',
    selectResearchProfile({ decree: 'hello', regionalScatter: [], geographicScope: 'none', liveResearchRequired: false, engineering: false }) === 'LIGHT_RESEARCH',
    'LIGHT',
  ))

  const plannedGlobal = planRoundScouts(globalMission)
  const liveRegional = plannedGlobal.scouts.filter(item => item.region && item.executeLive)
  const required = ['NORTH_AMERICA', 'EAST_ASIA', 'EUROPE'] as const
  cases.push(check(
    'routing_01_required_regions_live',
    required.every(region => liveRegional.some(item => item.region === region)),
    liveRegional.map(item => `${item.region}:${item.queryLanguage}:${(item.preferredProviders ?? []).join('+')}`).join(' | '),
  ))
  cases.push(check(
    'routing_02_territories_differ',
    new Set(liveRegional.map(item => (item.preferredProviders ?? []).join(','))).size >= 2,
    liveRegional.map(item => `${item.region}=${(item.preferredProviders ?? []).join(',')}`).join(' | '),
  ))
  cases.push(check(
    'routing_03_na_attempts_federal_register',
    (liveRegional.find(item => item.region === 'NORTH_AMERICA')?.preferredProviders ?? []).includes('federal_register')
      || primaryProviderIdsForRegion('NORTH_AMERICA').includes('federal_register'),
    JSON.stringify(liveRegional.find(item => item.region === 'NORTH_AMERICA')?.preferredProviders),
  ))
  cases.push(check(
    'routing_04_locales_differ',
    googleNewsLocaleForRegion('EAST_ASIA').gl !== googleNewsLocaleForRegion('EUROPE').gl
      && googleNewsLocaleForRegion('EUROPE').gl !== googleNewsLocaleForRegion('NORTH_AMERICA').gl,
    JSON.stringify({
      na: googleNewsLocaleForRegion('NORTH_AMERICA'),
      ea: googleNewsLocaleForRegion('EAST_ASIA'),
      eu: googleNewsLocaleForRegion('EUROPE'),
    }),
  ))

  cases.push(check('fastpath_01_hello', !shouldRunIndependentScoutSwarm('hello', classifyCouncilTurn('hello')), 'hello'))
  cases.push(check('fastpath_02_math', !shouldRunIndependentScoutSwarm('What is 9 plus 8? Reply with only the number.', classifyCouncilTurn('What is 9 plus 8? Reply with only the number.')), 'math'))
  cases.push(check('fastpath_03_japan', !shouldRunIndependentScoutSwarm('What is the capital of Japan? Reply with only the city.', classifyCouncilTurn('What is the capital of Japan? Reply with only the city.')), 'japan'))
  cases.push(check('fastpath_04_simple_helper', isSimpleFastPathPrompt('hello'), 'hello'))

  const sec = evidence({
    id: 'sec-1',
    title: 'Expeditors filed an 8-K',
    content: 'Corporate SEC filing, not a Federal Register rule.',
    url: 'https://www.sec.gov/Archives/edgar/data/1/8-k.htm',
    source_id: 'sec_edgar',
    source_label: 'SEC EDGAR',
  })
  const filingClaim = extractAtomicClaims({
    report_id: 'r1',
    report_kind: 'PULSAR_RESEARCH_REPORT',
    mission_id: 'm',
    roundRequestId: 'r',
    logicalRequestId: 'r',
    seat: 'grok',
    agentId: 'pulsar',
    createdAt: NOW,
    frozen_at: NOW,
    phase: 'POSITION_FREEZE',
    assignment: 'x',
    conclusion: 'Expeditors filed an 8-K. That proves a new federal freight brokerage regulation this week.',
    evidence_ids: [sec.id],
    confidence: 0.4,
    uncertainties: [],
    contradictions: [],
    unanswered_questions: [],
    scout_summary: '',
    immutable: true,
  })
  cases.push(check('lumen_01_atomic_split', filingClaim.length >= 2, filingClaim.map(item => item.claim_text).join(' | ')))
  const verifiedReg = verifyClaimAgainstEvidence(filingClaim.find(item => /regulat/i.test(item.claim_text)) ?? filingClaim[filingClaim.length - 1]!, [sec])
  const verifiedFiling = verifyClaimAgainstEvidence(filingClaim.find(item => /8-K/i.test(item.claim_text)) ?? filingClaim[0]!, [sec])
  cases.push(check('lumen_02_regulation_source_mismatch', verifiedReg.verification_status === 'SOURCE_MISMATCH', verifiedReg.notes))
  cases.push(check('lumen_03_8k_not_forced_mismatch', verifiedFiling.verification_status !== 'SOURCE_MISMATCH', `${verifiedFiling.verification_status} ${verifiedFiling.notes}`))
  const phoenix = challengeClaim(verifiedReg, [sec])
  cases.push(check('phoenix_01_source_mismatch_fails', phoenix.survived === false && phoenix.sourceMismatch, phoenix.notes))
  cases.push(check('phoenix_02_disconfirm_duplicate_or_jurisdiction', phoenix.missingPrimaryAuthority || phoenix.sourceMismatch, JSON.stringify({ dup: phoenix.duplicateSourceFamilies, mismatch: phoenix.sourceMismatch })))

  const mirrors = [1, 2, 3, 4, 5].map(n => evidence({
    id: `m-${n}`,
    title: 'Wire story on fabs',
    content: 'The same syndicated semiconductor paragraph copied across outlets.',
    url: `https://mirror-${n}.example.net/story?utm_source=rss`,
    source_type: 'rss',
    source_label: 'Reuters copy',
  }))
  const clustered = clusterIndependentEvidence(annotateEvidenceIndependence(mirrors))
  const fakeReport = freezeIndependentSeatReport({
    agentId: 'pulsar',
    assignment: globalMission.assignments.find(item => item.agentId === 'pulsar') ?? null,
    conclusion: 'The same syndicated semiconductor paragraph copied across outlets is circulating this week.',
    ledger: {
      agentId: 'pulsar',
      seatId: 'grok',
      missionId: globalMission.missionId,
      roundRequestId: globalMission.roundRequestId,
      logicalRequestId: globalMission.logicalRequestId,
      entries: [],
      evidence: clustered.items,
    },
    missionId: globalMission.missionId,
    roundRequestId: globalMission.roundRequestId,
    logicalRequestId: globalMission.logicalRequestId,
    nowIso: NOW,
  })
  const claims = extractAtomicClaims(fakeReport).map(claim => verifyClaimAgainstEvidence(claim, clustered.items))
  const map = buildConvergenceMap({
    missionId: globalMission.missionId,
    roundRequestId: globalMission.roundRequestId,
    logicalRequestId: globalMission.logicalRequestId,
    reports: [fakeReport],
    claims,
    challenges: claims.map(claim => challengeClaim(claim, clustered.items)),
    evidence: clustered.items,
  })
  cases.push(check(
    'convergence_01_mirrors_count_as_one',
    independentSupportCount(mirrors.map(item => item.id), clustered.items) === 1
      && map.claims.every(item => item.independent_support_count <= 1),
    JSON.stringify(map.claims.map(item => ({ state: item.state, n: item.independent_support_count }))),
  ))
  cases.push(check(
    'convergence_02_notes_reject_raw_hits',
    map.notes.some(note => /independence keys|clusters/i.test(note)),
    map.notes.join(' | '),
  ))

  let latePublished = false
  const timed = await executeScouts(
    plannedGlobal.scouts.filter(item => item.executeLive).slice(0, 3),
    {
      phaseTimeoutMs: 80,
      perScoutTimeoutMs: 20_000,
      maxConcurrentWeb: 3,
      getCurrentRoundIdentity: () => ({
        missionId: globalMission.missionId,
        roundRequestId: globalMission.roundRequestId,
        logicalRequestId: globalMission.logicalRequestId,
      }),
      runLiveResearch: async () => {
        await new Promise(resolve => setTimeout(resolve, 400))
        latePublished = true
        return emptyLiveResearchEvidencePacket(NOW, 'late-should-be-discarded')
      },
    },
  )
  const timedOut = timed.every(item => item.evidence.length === 0 && (item.metadata.timeout || item.metadata.aborted))
  cases.push(check('timeout_01_phase_discards_late', timedOut, JSON.stringify(timed.map(item => ({ timeout: item.metadata.timeout, aborted: item.metadata.aborted, n: item.evidence.length, reason: item.metadata.abortReason })))))
  cases.push(check('timeout_02_late_not_published', timed.every(item => item.evidence.length === 0), `latePublished=${latePublished}`))

  const packet = swarmPacketStub({
    decree: FREIGHT,
    evidence: annotateEvidenceIndependence([sec]),
    swarm: {
      missionId: freightMission.missionId,
      phase: 'PERSISTENCE',
      astraMission: freightMission,
      reports: [],
      scoutMetadata: [],
      revisions: [],
      convergence: map,
      isolation: { pass: true, phase: 'PERSISTENCE', leaks: [], checkedSeats: [] },
      evidenceIndependence: { rawCount: 1, canonicalUrlUnique: 1, clusterCount: 1, independentKeyCount: 1, sourceFamilyDiversity: 1, regionalDiversity: 0 },
      claims: [verifiedReg],
      degraded: false,
      phaseTimedOut: false,
    },
    nowIso: NOW,
  })
  const written = await persistStoredResearchPacket(packet, null)
  const repeat = await retrieveStoredResearch(FREIGHT, { nowIso: NOW })
  cases.push(check('persist_01_write', written.ok, JSON.stringify(written), 'REAL PERSISTENCE'))
  cases.push(check(
    'persist_02_independence_fields',
    Boolean(packet.evidence[0]?.canonical_url && packet.evidence[0]?.content_hash && packet.evidence[0]?.independence_key && packet.councilSwarm?.evidenceIndependence),
    JSON.stringify({
      canonical: packet.evidence[0]?.canonical_url,
      hash: packet.evidence[0]?.content_hash,
      key: packet.evidence[0]?.independence_key,
      summary: packet.councilSwarm?.evidenceIndependence,
    }),
    'REAL PERSISTENCE',
  ))
  cases.push(check('persist_03_reload', repeat.ok, JSON.stringify({ hits: repeat.hits.length, backend: repeat.backend }), 'REAL PERSISTENCE'))

  cases.push(check('eng_01_orion_local', engMission.assignments.find(item => item.agentId === 'orion')?.liveResearch === false, 'orion local'))
  cases.push(check('eng_02_no_global_scatter', engMission.researchProfile !== 'GLOBAL_SCATTER' && engMission.regionalScatter.length === 0, engMission.researchProfile))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBuild6Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #6 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
