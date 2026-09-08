import { pathToFileURL } from 'node:url'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { emptyLiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { persistStoredResearchPacket, retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { planIntelligenceQuery } from '@/lib/intelligence/queryPlanner'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import {
  allSwarmPhasesAreAuditable,
  advanceSwarmPhase,
  createSwarmPhaseState,
  discoveryMustPrecedeFreeze,
  freezeMustPrecedeCrossReview,
  synthesisMustFollowVerification,
} from './phases'
import { assertDiscoveryIsolation } from './isolation'
import { admitScout, createScoutGovernor, DEFAULT_SCOUT_GOVERNOR_LIMITS, isCurrentRoundIdentity, scoutCannotSpawnSwarm } from './governor'
import { isClosedFormKnowledgeQuestion, isSimpleFastPathPrompt, shouldRunIndependentScoutSwarm } from './eligibility'
import { astraDidNotAnswerSubstance, decomposeAstraMission, freezeAstraMissionReport } from './mission'
import { planRoundScouts, scoutQueriesAreIndependent, scoutsAreEphemeral } from './scoutPlanner'
import { appendLedgerEvidence, createPrivateSeatLedger } from './ledgers'
import { allRequiredReportsFrozen, freezeIndependentSeatReport, reportIsImmutable, reviseWithoutRewriting } from './freeze'
import { buildConvergenceMap, challengeClaim, extractAtomicClaims, verifyClaimAgainstEvidence } from './verify'
import { buildIndependentDiscoveryPrompt, targetedCrossReviewPacket } from './prompts'
import { runIndependentScoutSwarm } from './runtime'
import { extractSwarmFromStoredPacket, swarmPacketStub } from './persist'
import type { ScoutPlan } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const FREIGHT = 'What changed in U.S. freight brokerage regulation this week?'
const GLOBAL = 'What are the major current developments affecting global semiconductor supply chains, and how do they differ by region?'
const ENGINEERING = "What are War Room's current engineering risks?"
const NOW = '2026-09-07T20:00:00.000Z'

function secFilingItem(): IntelligenceEvidenceItem {
  return {
    id: 'sec-1',
    source_id: 'sec_edgar',
    source_type: 'government_public_data',
    source_label: 'SEC EDGAR',
    verified_level: 'verified',
    title: 'Broker 8-K discloses insurance expense',
    url: 'https://efts.sec.gov/LATEST/search-index',
    claim: 'Company filed an 8-K.',
    content: 'Corporate SEC filing, not a Federal Register rule.',
    observed_at: NOW,
    confidence: 0.8,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.9,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
  }
}

function fakeScout(overrides: Partial<ScoutPlan>): ScoutPlan {
  return {
    scoutId: 'scout-pulsar-PRIMARY_SOURCE-1-round1',
    scoutType: 'PRIMARY_SOURCE',
    seatId: 'grok',
    agentId: 'pulsar',
    missionId: 'mission-r1',
    roundRequestId: 'r1',
    logicalRequestId: 'r1',
    query: 'federal register freight broker',
    assignment: 'gather',
    sourceTerritory: 'government_regulator',
    spawnDepth: 1,
    languageAccess: 'native',
    preferLocalTruth: false,
    executeLive: true,
    ...overrides,
  }
}

export async function runScoutSwarmValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  const phase = createSwarmPhaseState(NOW)
  const afterDiscovery = advanceSwarmPhase(phase, 'INDEPENDENT_DISCOVERY', NOW)
  const afterFreeze = advanceSwarmPhase(afterDiscovery, 'POSITION_FREEZE', NOW)
  const afterReview = advanceSwarmPhase(afterFreeze, 'CROSS_REVIEW', NOW)
  const afterVerify = advanceSwarmPhase(afterReview, 'VERIFICATION', NOW)
  const afterSynth = advanceSwarmPhase(afterVerify, 'SYNTHESIS', NOW)
  cases.push(check('phase_01_order_auditable', allSwarmPhasesAreAuditable(), 'seven named phases'))
  cases.push(check('phase_02_discovery_before_freeze', discoveryMustPrecedeFreeze(afterFreeze.history), afterFreeze.history.map(item => item.phase).join('>')))
  cases.push(check('phase_03_freeze_before_cross_review', freezeMustPrecedeCrossReview(afterReview.history), afterReview.history.map(item => item.phase).join('>')))
  cases.push(check('phase_04_verify_before_synthesis', synthesisMustFollowVerification(afterSynth.history), afterSynth.history.map(item => item.phase).join('>')))
  let illegal = false
  try {
    advanceSwarmPhase(afterDiscovery, 'SYNTHESIS', NOW)
  } catch {
    illegal = true
  }
  cases.push(check('phase_05_illegal_skip_fails', illegal, 'cannot jump discovery to synthesis'))

  const pulsarDraft = 'ORION_SECRET_DRAFT_TOKEN says brokers must refile by Friday.'
  const isolation = assertDiscoveryIsolation({
    phase: 'INDEPENDENT_DISCOVERY',
    prompt: `Commander: ${FREIGHT}\n${pulsarDraft}`,
    ownerAgentId: 'lumen',
    otherDrafts: [{ agentId: 'orion', text: pulsarDraft }],
  })
  cases.push(check('isolation_01_detects_orion_draft_in_lumen_prompt', isolation.pass === false && isolation.leaks.some(item => item.includes('orion')), isolation.leaks.join(',')))
  const clean = assertDiscoveryIsolation({
    phase: 'INDEPENDENT_DISCOVERY',
    prompt: `Commander: ${FREIGHT}\nASTRA assignment for LUMEN only: verify whether a regulation actually changed.`,
    ownerAgentId: 'lumen',
    otherDrafts: [{ agentId: 'orion', text: pulsarDraft }],
  })
  cases.push(check('isolation_02_clean_lumen_prompt_passes', clean.pass, JSON.stringify(clean)))

  const freightClassified = classifyCouncilTurn(FREIGHT)
  const helloClassified = classifyCouncilTurn('hello')
  const mathClassified = classifyCouncilTurn('What is 9 plus 8? Reply with only the number.')
  const japanClassified = classifyCouncilTurn('What is the capital of Japan? Reply with only the city.')
  cases.push(check('fastpath_01_hello', isSimpleFastPathPrompt('hello', helloClassified) && !shouldRunIndependentScoutSwarm('hello', helloClassified), helloClassified.intent, 'STRUCTURAL'))
  cases.push(check('fastpath_02_math', isClosedFormKnowledgeQuestion('What is 9 plus 8? Reply with only the number.') && !shouldRunIndependentScoutSwarm('What is 9 plus 8? Reply with only the number.', mathClassified), mathClassified.intent, 'STRUCTURAL'))
  cases.push(check('fastpath_03_japan', isClosedFormKnowledgeQuestion('What is the capital of Japan? Reply with only the city.') && !shouldRunIndependentScoutSwarm('What is the capital of Japan? Reply with only the city.', japanClassified), japanClassified.intent, 'STRUCTURAL'))
  cases.push(check('fastpath_04_freight_is_swarm', shouldRunIndependentScoutSwarm(FREIGHT, freightClassified), JSON.stringify(freightClassified), 'STRUCTURAL'))

  const freightMission = decomposeAstraMission({ decree: FREIGHT, roundRequestId: 'round-freight', logicalRequestId: 'round-freight', nowIso: NOW })
  const astraReport = freezeAstraMissionReport(freightMission)
  cases.push(check('astra_01_no_substantive_answer_flag', astraDidNotAnswerSubstance(freightMission, astraReport), freightMission.notes.join('|'), 'STRUCTURAL'))
  cases.push(check('astra_02_distinct_assignments', new Set(freightMission.assignments.map(item => item.objective)).size === freightMission.assignments.length, String(freightMission.assignments.length), 'STRUCTURAL'))
  cases.push(check('astra_03_freight_roster', ['pulsar', 'orion', 'lumen', 'phoenix', 'nova', 'solara', 'aurora'].every(id => freightMission.selectedPermanentSeats.includes(id as typeof freightMission.selectedPermanentSeats[number])), freightMission.selectedPermanentSeats.join(','), 'STRUCTURAL'))
  cases.push(check('astra_04_aurora_no_discovery', freightMission.assignments.find(item => item.agentId === 'aurora')?.scoutTypes.length === 0, 'aurora scouts empty', 'STRUCTURAL'))
  cases.push(check('astra_05_assignment_has_no_other_conclusion', freightMission.assignments.every(item => !/PULSAR found|ORION concluded/i.test(item.objective)), 'no leaked conclusions', 'STRUCTURAL'))

  const globalMission = decomposeAstraMission({ decree: GLOBAL, roundRequestId: 'round-global', logicalRequestId: 'round-global', nowIso: NOW })
  cases.push(check('region_01_scatter_used', globalMission.regionalScatter.length >= 3, globalMission.regionalScatter.join(','), 'STRUCTURAL'))
  cases.push(check('region_02_not_every_region', globalMission.regionalScatter.length < 8, String(globalMission.regionalScatter.length), 'STRUCTURAL'))

  const engMission = decomposeAstraMission({ decree: ENGINEERING, roundRequestId: 'round-eng', logicalRequestId: 'round-eng', nowIso: NOW })
  cases.push(check('eng_01_orion_local', engMission.assignments.find(item => item.agentId === 'orion')?.liveResearch === false, JSON.stringify(engMission.assignments.find(item => item.agentId === 'orion')), 'STRUCTURAL'))
  cases.push(check('eng_02_pulsar_not_generic_web', !engMission.selectedPermanentSeats.includes('pulsar') || engMission.assignments.find(item => item.agentId === 'pulsar')?.liveResearch === true, engMission.selectedPermanentSeats.join(','), 'STRUCTURAL'))

  const planned = planRoundScouts(freightMission, DEFAULT_SCOUT_GOVERNOR_LIMITS)
  cases.push(check('scout_01_bounded_total', planned.scouts.length <= DEFAULT_SCOUT_GOVERNOR_LIMITS.maxTotalScoutsPerRound, String(planned.scouts.length), 'STRUCTURAL'))
  cases.push(check('scout_02_independent_queries', scoutQueriesAreIndependent(planned.scouts), planned.scouts.map(item => item.query).slice(0, 4).join(' | '), 'STRUCTURAL'))
  cases.push(check('scout_03_ephemeral', scoutsAreEphemeral(planned.scouts), String(planned.scouts.length), 'STRUCTURAL'))
  cases.push(check('scout_04_depth_one', planned.scouts.every(scoutCannotSpawnSwarm), 'spawnDepth=1', 'STRUCTURAL'))
  const overGovernor = createScoutGovernor({ ...DEFAULT_SCOUT_GOVERNOR_LIMITS, maxTotalScoutsPerRound: 1, maxScoutsPerSeat: 1 })
  admitScout(overGovernor, fakeScout({}))
  const rejected = admitScout(overGovernor, fakeScout({ scoutId: 'scout-2', query: 'other' }))
  cases.push(check('scout_05_fanout_cap', rejected.ok === false, rejected.reason ?? '', 'STRUCTURAL'))
  const recursive = admitScout(createScoutGovernor(), fakeScout({ spawnDepth: 1, scoutId: 'ok' }))
  cases.push(check('scout_06_admit_depth_one', recursive.ok, 'depth 1 admitted', 'STRUCTURAL'))

  const ledger = createPrivateSeatLedger(fakeScout({}))
  const { ledger: filled } = appendLedgerEvidence(ledger, fakeScout({}), [secFilingItem()], { missionId: 'mission-r1', roundRequestId: 'r1', logicalRequestId: 'r1' })
  cases.push(check('ledger_01_private_evidence', filled.evidence.length === 1 && filled.entries[0]?.scoutId.startsWith('scout-'), filled.entries[0]?.scoutId ?? '', 'STRUCTURAL'))
  const stale = appendLedgerEvidence(filled, fakeScout({ roundRequestId: 'old' }), [secFilingItem()], { missionId: 'mission-r1', roundRequestId: 'r1', logicalRequestId: 'r1' })
  cases.push(check('stale_01_discarded', stale.discarded && stale.ledger.evidence.length === 1, String(stale.ledger.evidence.length), 'STRUCTURAL'))
  cases.push(check('stale_02_identity_mismatch', !isCurrentRoundIdentity({ missionId: 'a', roundRequestId: '1', logicalRequestId: '1' }, { missionId: 'a', roundRequestId: '2', logicalRequestId: '1' }), 'round mismatch', 'STRUCTURAL'))

  const pulsarAssignment = freightMission.assignments.find(item => item.agentId === 'pulsar')!
  const built = buildIndependentDiscoveryPrompt({
    role: 'direct_response',
    commanderMessage: FREIGHT,
    assignment: pulsarAssignment,
    ledger: filled,
    identityId: 'pulsar',
    evidenceReferences: [],
    otherDrafts: [{ agentId: 'orion', text: pulsarDraft }],
  })
  cases.push(check('prompt_01_pulsar_excludes_orion_draft', built.isolationPass && !built.prompt.includes('ORION_SECRET_DRAFT_TOKEN'), built.leaks.join(','), 'STRUCTURAL'))
  cases.push(check('prompt_02_includes_own_assignment', built.prompt.includes(pulsarAssignment.objective), 'assignment present', 'STRUCTURAL'))

  const frozen = freezeIndependentSeatReport({
    agentId: 'pulsar',
    assignment: pulsarAssignment,
    conclusion: 'No Federal Register rule change was found this week.',
    ledger: filled,
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
    nowIso: NOW,
  })
  const rewritten = reviseWithoutRewriting(frozen, 'later revision')
  cases.push(check('freeze_01_immutable', reportIsImmutable(frozen) && rewritten.original.conclusion === frozen.conclusion, frozen.report_id, 'STRUCTURAL'))
  cases.push(check('freeze_02_required_set', allRequiredReportsFrozen(['pulsar'], [frozen]), 'pulsar frozen', 'STRUCTURAL'))

  const claim = extractAtomicClaims({
    ...frozen,
    conclusion: 'Federal regulation of freight brokers changed this week.',
  })[0]!
  const verified = verifyClaimAgainstEvidence(claim, [secFilingItem()])
  cases.push(check('lumen_01_sec_is_source_mismatch', verified.verification_status === 'SOURCE_MISMATCH', verified.notes, 'STRUCTURAL'))
  const phoenix = challengeClaim(verified, [secFilingItem()])
  cases.push(check('phoenix_01_alternate_explanation', /corporate disclosure|SEC/i.test(phoenix.alternateExplanation) && phoenix.survived === false, phoenix.alternateExplanation, 'STRUCTURAL'))

  const orionFrozen = freezeIndependentSeatReport({
    agentId: 'orion',
    assignment: freightMission.assignments.find(item => item.agentId === 'orion') ?? null,
    conclusion: 'No Federal Register rule change was found this week.',
    ledger: filled,
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
    nowIso: NOW,
  })
  const lumenFrozen = freezeIndependentSeatReport({
    agentId: 'lumen',
    assignment: freightMission.assignments.find(item => item.agentId === 'lumen') ?? null,
    conclusion: 'No authoritative regulator source proves a new federal rule this week.',
    ledger: filled,
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
    nowIso: NOW,
  })
  const claims = [verified, verifyClaimAgainstEvidence(extractAtomicClaims(lumenFrozen)[0]!, [secFilingItem()])]
  const map = buildConvergenceMap({
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
    reports: [frozen, orionFrozen, lumenFrozen],
    claims,
    challenges: [phoenix],
    evidence: [secFilingItem()],
  })
  cases.push(check('convergence_01_rejects_filing_as_regulation', map.claims.some(item => item.state === 'REJECTED' || item.lumen_status === 'SOURCE_MISMATCH'), map.claims.map(item => item.state).join(','), 'STRUCTURAL'))
  const reviewPacket = targetedCrossReviewPacket({ reviewer: 'lumen', reports: [frozen, orionFrozen], claims })
  cases.push(check('cross_01_after_freeze_only', reviewPacket.includes('frozen claims') && reviewPacket.includes('omit scout transcripts'), reviewPacket.slice(0, 90), 'STRUCTURAL'))

  const round = await runIndependentScoutSwarm({
    plan: decomposeAstraMission({ decree: 'What is 9 plus 8?', roundRequestId: 'should-not-matter', logicalRequestId: 'should-not-matter', nowIso: NOW }),
    getCurrentRoundIdentity: () => ({ missionId: 'mission-should-not-matter', roundRequestId: 'should-not-matter', logicalRequestId: 'should-not-matter' }),
    invokeSeat: async args => ({ status: 'complete', content: `${args.agentId} isolated answer` }),
    runLiveResearch: async () => emptyLiveResearchEvidencePacket(NOW, 'must not be needed for closed form if planner still runs'),
  })
  cases.push(check('runtime_01_isolation_pass', round.isolation.pass, round.isolation.leaks.join(','), 'INTEGRATION'))
  cases.push(check('runtime_02_reports_frozen', round.reports.some(item => item.report_kind === 'PULSAR_RESEARCH_REPORT') && round.reports.some(item => item.report_kind === 'AURORA_FINAL_SYNTHESIS'), round.reports.map(item => item.report_kind).join(','), 'INTEGRATION'))
  cases.push(check('runtime_03_discovery_prompts_isolated', Object.values(round.discoveryPrompts).every(prompt => !prompt.includes('isolated answer') || prompt.includes('ASTRA assignment')), 'no peer draft in discovery', 'INTEGRATION'))
  cases.push(check('aurora_01_receives_frozen_input', /FROZEN INDEPENDENT REPORTS/i.test(round.auroraPrompt), 'aurora prompt has frozen reports', 'INTEGRATION'))
  cases.push(check('aurora_02_no_discovery_scouts', (round.scouts.filter(item => item.agentId === 'aurora').length === 0), String(round.scouts.filter(item => item.agentId === 'aurora').length), 'INTEGRATION'))

  const freightRound = await runIndependentScoutSwarm({
    plan: freightMission,
    getCurrentRoundIdentity: () => ({ missionId: freightMission.missionId, roundRequestId: freightMission.roundRequestId, logicalRequestId: freightMission.logicalRequestId }),
    invokeSeat: async args => ({
      status: 'complete',
      content: args.agentId === 'lumen'
        ? 'No authoritative Federal Register or FMCSA source proves a new federal freight-brokerage regulation this week. An SEC filing is not a regulation change.'
        : args.agentId === 'phoenix'
          ? 'Alternate explanation: corporate 8-K language can be mistaken for a rule change.'
          : args.agentId === 'aurora'
            ? 'Current answer: no proven federal regulation change this week. Independent seats converged on the absence of an authoritative rule source. SEC filings did not win.'
            : `${args.agentId} independent finding: no proven federal regulation change this week.`,
    }),
    runLiveResearch: async query => ({
      ...emptyLiveResearchEvidencePacket(NOW),
      usedLiveResearch: true,
      findings: `live result for ${query}`,
      intelligencePacket: {
        id: 'intel-freight-fixture',
        decree: FREIGHT,
        timestamp: NOW,
        query_plan: planIntelligenceQuery(FREIGHT),
        sources_used: ['sec_edgar'],
        findings: [],
        evidence: [secFilingItem()],
        confidence_summary: { overall: 'emerging', score: 0.4, verified_count: 0, corroborated_count: 1, emerging_count: 0, weak_signal_count: 0, contradictory_count: 0, unsupported_count: 0 },
        contradictions: [],
        weak_signals: [],
        unsupported_claims: [],
        source_failures: [],
        freshness: 'live',
        gaps: [],
        red_team_verification: { status: 'caution', warnings: [], unsupported_claims: [], stale_evidence: [], contradiction_chains: [], manipulated_narrative_risks: [], contextual_restraint_flags: [], weak_source_overreliance: false, operational_truth_blocks: [] },
      },
    }),
  })
  cases.push(check('freight_01_isolation', freightRound.isolation.pass, freightRound.isolation.leaks.join(','), 'INTEGRATION'))
  cases.push(check('freight_02_lumen_source_mismatch_or_unsupported', freightRound.claims.some(item => item.verification_status === 'SOURCE_MISMATCH' || item.verification_status === 'UNSUPPORTED'), freightRound.claims.map(item => item.verification_status).join(','), 'INTEGRATION'))
  cases.push(check('freight_03_phoenix_alternate', freightRound.challenges.some(item => /corporate|SEC/i.test(item.alternateExplanation)), freightRound.challenges[0]?.alternateExplanation ?? '', 'INTEGRATION'))
  cases.push(check('freight_04_aurora_no_new_rule', /no proven federal regulation change|no authoritative/i.test(freightRound.reports.find(item => item.agentId === 'aurora')?.conclusion ?? ''), freightRound.reports.find(item => item.agentId === 'aurora')?.conclusion.slice(0, 180) ?? '', 'INTEGRATION'))

  const packet = swarmPacketStub({
    decree: FREIGHT,
    evidence: [secFilingItem()],
    swarm: freightRound.persistence,
    nowIso: NOW,
  })
  const written = await persistStoredResearchPacket(packet, null)
  const repeat = await retrieveStoredResearch(FREIGHT, { nowIso: NOW })
  cases.push(check('persist_01_write', written.ok, JSON.stringify(written), 'REAL PERSISTENCE'))
  cases.push(check('persist_02_repeat_has_seat_reports', repeat.hits.some(hit => extractSwarmFromStoredPacket(hit.packet)?.reports.some(report => report.agentId === 'pulsar')), String(repeat.hits.length), 'REAL PERSISTENCE'))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runScoutSwarmValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #5 scout swarm validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
