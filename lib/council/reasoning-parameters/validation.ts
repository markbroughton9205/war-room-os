import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { NEBULA_AGENT_IDS } from '@/lib/council/nebula/identity'
import { isFinalCouncilSynthesizer, isOrchestrationOnly, NEBULA_ROLE_CONTRACTS } from '@/lib/council/nebula/roleContracts'
import { OUTPUT_CONTRACTS } from '@/lib/council/nebula/outputContracts'
import { fixturesAreDifferentiated } from '@/lib/council/nebula/differentiation'
import { allPermanentAgentsShareGenesisGeneral, NEBULA_SHARED_PARAMETER_CLASS } from '@/lib/council/nebula/modelProfile'
import { buildDeliberationPrompt, providerModelForFamily } from '@/lib/council/family-deliberation/runtime'
import { SEAT_ANTI_ECHO } from '@/lib/council/seatDistinctness'
import { containsHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { classifyCouncilTurn, shouldRunFamilyDeliberation } from '@/lib/council/session-orchestration/turnIntent'
import { classifyAstraIntent } from '@/lib/council/nebula/roundFlow'
import { decomposeAstraMission } from '@/lib/council/scout-swarm/mission'
import { shouldRunIndependentScoutSwarm } from '@/lib/council/scout-swarm/eligibility'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { ENGINE_REGISTRY } from '@/lib/engine-control/registry'
import { ALL_PROVIDER_FAMILIES } from '@/lib/council/providerDirectCall'
import { detectDirectInvocation } from '@/lib/council/directInvocation'
import { parseCouncilCommand } from '@/lib/council/commandParser'
import {
  canonicalizeCouncilSeat,
  detectUninstalledKimiMoonshotCommand,
  KIMI_MOONSHOT_NOT_INSTALLED_MESSAGE,
  migrateLegacyPersistedSeat,
} from '@/lib/council/seatCanonical'
import { SOURCE_CONNECTIONS } from '@/lib/opportunity-agents/sources/registry'
import { B_PARAMETER_IS_NOT, B_PARAMETER_MEANING, B_PARAMETER_PARAMETERS } from './definition'
import {
  activeDeliberationProfiles,
  babyObserverProfile,
  localSharedBrainClass,
  providerIsDistinctFromRole,
  servingBackendTruth,
  synthesizerSeat,
} from './roster'
import {
  EVALUATION_FIXTURES,
  LIVE_SAME_EVIDENCE_DECREE,
  LIVE_ROLE_COVERAGE_DECREE,
  contractsAreStructurallyDistinct,
  independenceUnchanged,
  promptForRole,
  sameEvidencePacket,
  sameEvidenceReachesMembers,
  scoreRedundancy,
  stageInstructionsDiffer,
  visibleOutputIsSafe,
} from './evaluation'

export type ReasoningParameterCase = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): ReasoningParameterCase {
  return { name, pass, detail }
}

function independenceFixture(): IntelligenceEvidenceItem {
  return {
    id: '15-indep-1',
    source_id: 'digitraffic_marine',
    source_type: 'direct_fetch',
    source_label: 'Digitraffic Marine',
    verified_level: 'verified',
    title: 'PILOT L-139 AIS position',
    url: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
    claim: 'Vessel observed at 60.10496,24.973792',
    content: 'LIVE AIS position from Digitraffic Marine.',
    observed_at: '2026-09-10T02:54:14.279Z',
    confidence: 0.8,
    confidence_tier: 'corroborated',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.9,
    contradiction_flags: [],
    evidence_density: 0.4,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'TERRA',
  }
}

export function runCouncilReasoningParameterValidation(): ReasoningParameterCase[] {
  const cases: ReasoningParameterCase[] = []
  const profiles = activeDeliberationProfiles()
  const baby = babyObserverProfile()
  const fingerprints = NEBULA_AGENT_IDS.map(id => JSON.stringify({
    id,
    ...NEBULA_ROLE_CONTRACTS[id],
  }))

  cases.push(check(
    '15_01_b_parameter_means_role_contracts',
    B_PARAMETER_MEANING === 'war_room_reasoning_role_contract'
      && B_PARAMETER_PARAMETERS.includes('evidencePosture')
      && B_PARAMETER_IS_NOT.some(item => item.includes('billion-parameter')),
    B_PARAMETER_MEANING,
  ))
  cases.push(check(
    '15_02_each_live_seat_has_explicit_profile',
    profiles.length === 6 && profiles.every(profile => Boolean(profile.contract && profile.nebulaAgentId && profile.reasoningRole)),
    profiles.map(profile => `${profile.seat}:${profile.displayName}`).join(','),
  ))
  cases.push(check(
    '15_03_provider_distinct_from_role',
    profiles.every(providerIsDistinctFromRole) && baby.reasoningRoleKind === 'observation',
    profiles.map(profile => `${profile.seat}/${profile.configuredProvider}/${profile.displayName}`).join(' | '),
  ))
  cases.push(check(
    '15_04_stage_instructions_preserved',
    stageInstructionsDiffer(),
    'direct/revision/challenge/synthesis',
  ))
  cases.push(check(
    '15_05_same_evidence_reaches_members',
    sameEvidencePacket() && sameEvidenceReachesMembers(),
    EVALUATION_FIXTURES.map(item => item.id).join(','),
  ))
  cases.push(check(
    '15_06_role_contracts_differ_structurally',
    NEBULA_AGENT_IDS.every((id, index) => NEBULA_AGENT_IDS.slice(index + 1).every(other => contractsAreStructurallyDistinct(id, other))),
    String(new Set(fingerprints).size),
  ))
  const phoenixPrompt = promptForRole({
    fixture: EVALUATION_FIXTURES[4]!,
    role: 'red_team_challenge',
    identityId: 'phoenix',
  })
  cases.push(check(
    '15_07_red_team_adversarial',
    NEBULA_ROLE_CONTRACTS.phoenix.evidencePosture === 'failure_discovery'
      && phoenixPrompt.includes('Turn role: challenge')
      && phoenixPrompt.includes('You are PHOENIX')
      && SEAT_ANTI_ECHO.phoenix.toLowerCase().includes('adversarial'),
    NEBULA_ROLE_CONTRACTS.phoenix.failureBias,
  ))
  const synthesisPrompt = promptForRole({
    fixture: EVALUATION_FIXTURES[5]!,
    role: 'council_synthesis',
    identityId: 'aurora',
  })
  cases.push(check(
    '15_08_synthesis_is_synthesis',
    isFinalCouncilSynthesizer('aurora')
      && synthesizerSeat() === 'chatgpt'
      && synthesisPrompt.includes('Turn role: council synthesis')
      && !synthesisPrompt.includes('Turn role: direct response'),
    'aurora/chatgpt',
  ))
  const revisionPrompt = promptForRole({
    fixture: EVALUATION_FIXTURES[0]!,
    role: 'revision_or_stand_firm',
    identityId: 'orion',
  })
  cases.push(check(
    '15_09_revision_changes_task_contract',
    revisionPrompt.includes('Turn role: revision or stand firm')
      && !revisionPrompt.includes('Turn role: direct response')
      && revisionPrompt.includes(EVALUATION_FIXTURES[0]!.evidence[0]!.evidence_reference_id),
    'revision_or_stand_firm',
  ))
  cases.push(check(
    '15_10_fallback_truth_helper',
    servingBackendTruth({
      provider_family: 'claude',
      provider_model: 'huihui_ai/qwen3-abliterated:14b',
      backend_type: 'LOCAL',
      backend_provider: 'ollama',
      backend_runtime: 'ollama',
      fallback_from: 'EXTERNAL',
    }).providerIndependenceHonest
      && servingBackendTruth({
        provider_family: 'claude',
        provider_model: providerModelForFamily('claude'),
        backend_type: 'LOCAL',
        backend_provider: 'ollama',
        backend_runtime: 'ollama',
        fallback_from: null,
      }).providerIndependenceHonest === false,
    'local serving must not be reported as the configured cloud default',
  ))
  cases.push(check(
    '15_11_unavailable_member_not_fabricated',
    buildDeliberationPrompt({
      role: 'council_synthesis',
      commanderMessage: LIVE_SAME_EVIDENCE_DECREE,
      evidenceReferences: EVALUATION_FIXTURES[0]!.evidence,
      priorTurns: [],
      identityId: 'aurora',
    }).includes('Prior family messages: none.')
      && !buildDeliberationPrompt({
        role: 'council_synthesis',
        commanderMessage: LIVE_SAME_EVIDENCE_DECREE,
        evidenceReferences: EVALUATION_FIXTURES[0]!.evidence,
        priorTurns: [],
        identityId: 'aurora',
      }).includes('PULSAR')
      && !buildDeliberationPrompt({
        role: 'council_synthesis',
        commanderMessage: LIVE_SAME_EVIDENCE_DECREE,
        evidenceReferences: EVALUATION_FIXTURES[0]!.evidence,
        priorTurns: [],
        identityId: 'aurora',
      }).includes('ORION'),
    'missing seats stay missing',
  ))
  cases.push(check(
    '15_12_evidence_independence_unchanged',
    independenceUnchanged([independenceFixture()]),
    'annotateEvidenceIndependence still keys items',
  ))
  cases.push(check(
    '15_13_astra_orchestration_only',
    isOrchestrationOnly('astra')
      && !isOrchestrationOnly('aurora')
      && NEBULA_ROLE_CONTRACTS.astra.failureBias === 'do_not_answer_the_mission_as_a_council_seat'
      && !profiles.some(profile => profile.nebulaAgentId === 'astra'),
    'astra not a live deliberation seat',
  ))
  cases.push(check(
    '15_14_no_hidden_chain_of_thought',
    visibleOutputIsSafe('Observed AIS facts only.')
      && containsHiddenReasoning('<think>hidden private reasoning</think>Visible answer')
      && !containsHiddenReasoning('Visible answer'),
    'thinkingStrip remains the CoT boundary',
  ))
  const distinctFixtureOutputs = [
    { id: 'orion', text: 'Engineering risk: the runtime interface for AIS freshness is LIVE only for this fetch; do not treat bulletin text as a data model.' },
    { id: 'lumen', text: 'Verification: the drydock bulletin is unsupported by the Terra AIS item; the 0.0 kn track is supported as observed, not as a settled voyage plan.' },
    { id: 'phoenix', text: 'Challenge: "under way using engine" at 0.0 kn may be a stale navStatus. Strongest counterexample is the bulletin; recovery is to wait for a second LIVE fix.' },
    { id: 'aurora', text: 'Takeaway: observed position is LIVE; the drydock claim did not survive verification. Dissent remains on whether navStatus is meaningful at zero speed.' },
  ]
  const paraphraseOutputs = [
    { id: 'a', text: 'The vessel is currently at the reported coordinates and appears operational based on the packet.' },
    { id: 'b', text: 'The vessel is currently at the reported coordinates and appears operational based on the packet.' },
  ]
  const distinctRedundancy = scoreRedundancy(distinctFixtureOutputs)
  const paraphraseRedundancy = scoreRedundancy(paraphraseOutputs)
  cases.push(check(
    '15_15_observable_role_distinctions',
    !distinctRedundancy.redundancyProblematic
      && paraphraseRedundancy.redundancyProblematic
      && fixturesAreDifferentiated(),
    JSON.stringify({
      distinctEchoes: distinctRedundancy.nearEchoPairs.length,
      paraphraseEchoes: paraphraseRedundancy.nearEchoPairs.length,
    }),
  ))
  cases.push(check(
    '15_16_shared_local_brain_is_not_role_uniqueness',
    allPermanentAgentsShareGenesisGeneral()
      && localSharedBrainClass() === '14B'
      && NEBULA_SHARED_PARAMETER_CLASS === '14B'
      && OUTPUT_CONTRACTS.orion.contractId !== OUTPUT_CONTRACTS.lumen.contractId,
    'shared 14B local class; roles remain contracts',
  ))
  const liveClassified = classifyCouncilTurn(LIVE_SAME_EVIDENCE_DECREE)
  cases.push(check(
    '15_17_live_decree_stays_same_evidence_family_path',
    shouldRunFamilyDeliberation(liveClassified)
      && !shouldRunIndependentScoutSwarm(LIVE_SAME_EVIDENCE_DECREE, liveClassified),
    JSON.stringify(liveClassified),
  ))
  const coverageIntent = classifyAstraIntent(LIVE_ROLE_COVERAGE_DECREE)
  const coverageMission = decomposeAstraMission({
    decree: LIVE_ROLE_COVERAGE_DECREE,
    roundRequestId: 'roadmap-15-role-coverage',
    logicalRequestId: 'roadmap-15-role-coverage',
  })
  cases.push(check(
    '15_17b_existing_research_intent_seats_pulsar_phoenix_nova',
    coverageIntent === 'RESEARCH'
      && ['pulsar', 'orion', 'lumen', 'phoenix', 'nova', 'aurora'].every(id => coverageMission.selectedPermanentSeats.includes(id as typeof coverageMission.selectedPermanentSeats[number]))
      && !coverageMission.selectedPermanentSeats.includes('astra' as never)
      && coverageMission.astraProvidesSubstantiveAnswer === false,
    JSON.stringify({ coverageIntent, seats: coverageMission.selectedPermanentSeats }),
  ))
  cases.push(check(
    '15_18_baby_is_observer_not_nebula_contract',
    baby.liveSeatMapped === false && baby.contract === null && baby.reasoningRoleKind === 'observation',
    baby.notes,
  ))
  const executeSource = readFileSync(new URL('../../../app/api/chat/execute.ts', import.meta.url), 'utf8')
  const novaRoster = COUNCIL_ROSTER.find(entry => entry.id === 'nova')
  const novaDirect = detectDirectInvocation('nova status')
  const kimiDirect = detectDirectInvocation('kimi')
  const moonshotDirect = detectDirectInvocation('moonshot')
  const kimiParsed = parseCouncilCommand('kimi')
  const moonshotParsed = parseCouncilCommand('moonshot')
  const novaParsed = parseCouncilCommand('nova')
  cases.push(check(
    '15_19_nova_canonical_seat_and_local_provider',
    novaRoster?.id === 'nova'
      && novaRoster.provider === 'Local'
      && novaRoster.engineId === null
      && !COUNCIL_ROSTER.some(entry => (entry.id as string) === 'kimi' || /kimi|moonshot/i.test(entry.provider)),
    JSON.stringify({ id: novaRoster?.id, provider: novaRoster?.provider, engineId: novaRoster?.engineId }),
  ))
  cases.push(check(
    '15_20_nova_executes_through_invoke_council_seat',
    executeSource.includes('invokeCouncilSeat')
      && !executeSource.includes('isKimiConfigured')
      && !executeSource.includes('completeKimiChat'),
    'execute.ts uses invokeCouncilSeat; no Kimi adapter imports',
  ))
  cases.push(check(
    '15_21_direct_nova_works_kimi_moonshot_do_not',
    novaDirect.invoked === true && novaDirect.family === 'nova'
      && novaParsed.directInvocation === true && novaParsed.targetFamilies[0] === 'nova'
      && kimiDirect.invoked === false && kimiDirect.family !== 'nova'
      && moonshotDirect.invoked === false && moonshotDirect.family !== 'nova'
      && detectUninstalledKimiMoonshotCommand('kimi')
      && detectUninstalledKimiMoonshotCommand('moonshot')
      && kimiParsed.uninstalledProviderNotice === KIMI_MOONSHOT_NOT_INSTALLED_MESSAGE
      && moonshotParsed.uninstalledProviderNotice === KIMI_MOONSHOT_NOT_INSTALLED_MESSAGE
      && canonicalizeCouncilSeat('kimi') === null
      && canonicalizeCouncilSeat('moonshot') === null
      && canonicalizeCouncilSeat('nova') === 'nova',
    JSON.stringify({
      nova: novaDirect,
      kimi: { invoked: kimiDirect.invoked, family: kimiDirect.family, notice: kimiParsed.uninstalledProviderNotice },
      moonshot: { invoked: moonshotDirect.invoked, family: moonshotDirect.family },
    }),
  ))
  cases.push(check(
    '15_22_registries_do_not_advertise_kimi',
    !ENGINE_REGISTRY.some(entry => (entry.id as string) === 'kimi' || /kimi|moonshot/i.test(entry.displayName))
      && !(ALL_PROVIDER_FAMILIES as string[]).includes('kimi')
      && !SOURCE_CONNECTIONS.some(source => source.id === 'kimi'),
    JSON.stringify({
      engines: ENGINE_REGISTRY.map(entry => entry.id),
      directFamilies: ALL_PROVIDER_FAMILIES,
      sources: SOURCE_CONNECTIONS.filter(source => source.category === 'ai_provider').map(source => source.id),
    }),
  ))
  cases.push(check(
    '15_23_legacy_kimi_family_still_resolves_for_history',
    migrateLegacyPersistedSeat('kimi') === 'nova'
      && migrateLegacyPersistedSeat('Kimi Family') === 'nova'
      && migrateLegacyPersistedSeat('moonshot') === 'nova',
    'legacy persisted seat ids map to nova on read only',
  ))
  cases.push(check(
    '15_24_kimi_wave_research_corpus_remains',
    existsSync('docs/research/earth-knowledge/KIMI_WAVE_REPORTS_PRESERVATION_MANIFEST.md')
      && existsSync('lib/intelligence/kimiWaves'),
    'KIMI_WAVE research files retained',
  ))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilReasoningParameterValidation()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  console.log(`Council reasoning-parameter validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}
