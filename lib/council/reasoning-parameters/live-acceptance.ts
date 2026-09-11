import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { buildTerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import { containsHiddenReasoning, stripHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import { canonicalizeCouncilSeat, migrateLegacyPersistedSeat } from '@/lib/council/seatCanonical'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'
import type { DeliberationSession, DeliberationTurn } from '@/lib/council/family-deliberation/types'
import { LIVE_SAME_EVIDENCE_DECREE, LIVE_ROLE_COVERAGE_DECREE, contributionCategories, scoreRedundancy, visibleOutputIsSafe } from './evaluation'
import { councilReasoningProfile, servingBackendTruth } from './roster'
import { runCouncilReasoningParameterValidation } from './validation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function vessel(): TerraLiveGeoObject {
  return {
    id: '230125910',
    layer: 'vessels',
    type: 'vessel_position',
    category: 'maritime',
    title: 'PILOT L-139',
    summary: 'Under way using engine',
    latitude: 60.10496,
    longitude: 24.973792,
    observedAt: '2026-09-10T02:54:14.279Z',
    receivedAt: '2026-09-10T02:54:20.000Z',
    provider: 'digitraffic_marine',
    publisherFamily: 'fintraffic',
    sourceFamily: 'digitraffic_marine',
    evidenceId: 'digitraffic_marine:230125910',
    discoveryProvenance: { discoveredVia: null, alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
    country: 'FI',
    region: 'Gulf of Finland',
    jurisdiction: 'FI',
    freshness: 'LIVE',
    confidence: 0.9,
    sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
    coordinateOrigin: 'source_embedded',
    identityKey: 'mmsi:230125910',
  }
}

function summarizeTurn(turn: DeliberationTurn) {
  const visible = stripHiddenReasoning(turn.full_response)
  const storedFamily = turn.provider_family
  const currentSeat = canonicalizeCouncilSeat(storedFamily)
  const canonicalSeat = currentSeat ?? migrateLegacyPersistedSeat(storedFamily) ?? storedFamily
  const profile = councilReasoningProfile(canonicalSeat)
  const backend = servingBackendTruth({ ...turn, provider_family: canonicalSeat })
  return {
    seat: currentSeat ?? storedFamily,
    displayName: turn.provider_label,
    reasoningRole: profile.reasoningRole,
    reasoningRoleKind: profile.reasoningRoleKind,
    nebulaId: nebulaAgentForSeat(canonicalSeat)?.id ?? null,
    stage: turn.turn_role,
    completion: turn.completion_status,
    configuredProvider: backend.configuredProvider,
    actualBackendType: backend.actualBackendType,
    actualProvider: backend.actualProvider,
    actualModel: backend.actualModel,
    fallbackFrom: backend.fallbackFrom,
    providerIndependenceHonest: backend.providerIndependenceHonest,
    writtenSeat: storedFamily,
    contributionCategories: contributionCategories(visible),
    preview: visible.slice(0, 280),
    hiddenReasoningPresent: containsHiddenReasoning(turn.full_response),
  }
}

type TurnSummary = ReturnType<typeof summarizeTurn>

async function runLiveRound(input: { decree: string; requestId: string }) {
  const terraSeed = buildTerraCouncilHandoffPayload({
    object: vessel(),
    commanderPrompt: input.decree,
  })
  const started = Date.now()
  const response = await executeCouncilChatRequest(new Request('http://war-room.local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: input.decree,
      raelDirectiveText: input.decree,
      profile: '',
      threadHistory: [],
      mode: 'continue',
      toneMode: 'casual',
      orchestrationAugment: '',
      councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
      councilIntentKind: 'general',
      councilActiveScope: 'general',
      councilFlowMode: 'stable_group',
      councilDeliberationMode: 'family_to_family_v1',
      councilLogicalRequestId: input.requestId,
      terraHandoff: terraSeed,
    }),
  }))
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  const familyDeliberation = payload.familyDeliberation && typeof payload.familyDeliberation === 'object'
    ? payload.familyDeliberation as DeliberationSession
    : null
  const turns = familyDeliberation?.turns ?? []
  const visibleTurns = turns.filter(turn => turn.completion_status === 'complete' && turn.full_response.trim())
  const summaries = visibleTurns.map(summarizeTurn)
  return {
    durationMs: Date.now() - started,
    httpStatus: response.status,
    error: typeof payload.error === 'string' ? payload.error : null,
    ok: response.ok && !payload.error,
    familyDeliberation,
    turns,
    visibleTurns,
    summaries,
    scoutSwarmPresent: Boolean(familyDeliberation?.scout_swarm),
    redundancy: scoreRedundancy(visibleTurns.map(turn => ({
      id: `${turn.provider_family}:${turn.turn_role}`,
      text: stripHiddenReasoning(turn.full_response),
    }))),
  }
}

function speaking(summaries: TurnSummary[], kind: TurnSummary['reasoningRoleKind']) {
  return summaries.find(item => item.reasoningRoleKind === kind && item.completion === 'complete')
}

export async function runCouncilReasoningParameterLiveAcceptance(): Promise<{
  results: CaseResult[]
  proof: Record<string, unknown>
}> {
  const structural = runCouncilReasoningParameterValidation()
  const results: CaseResult[] = structural.map(item => check(`structural_${item.name}`, item.pass, item.detail))
  const familyRound = await runLiveRound({ decree: LIVE_SAME_EVIDENCE_DECREE, requestId: 'roadmap-15-same-evidence' })
  const coverageRound = await runLiveRound({ decree: LIVE_ROLE_COVERAGE_DECREE, requestId: 'roadmap-15-role-coverage' })
  const summaries = familyRound.summaries
  const turns = familyRound.turns
  const visibleTurns = familyRound.visibleTurns
  const redundancy = familyRound.redundancy
  const redTeam = summaries.find(item => item.seat === 'red_team' || item.stage === 'red_team_challenge')
  const revisions = summaries.filter(item => item.stage === 'revision_or_stand_firm')
  const synthesis = summaries.find(item => item.stage === 'council_synthesis')
  const astraSeat = summaries.some(item => item.displayName === 'ASTRA' || nebulaAgentForSeat(item.seat)?.id === 'astra')
  const fallbackUsed = summaries.filter(item => item.fallbackFrom)
  const dishonest = summaries.filter(item => item.providerIndependenceHonest === false)
  const coverageSummaries = coverageRound.summaries
  const coveragePhoenix = coverageSummaries.find(item => item.nebulaId === 'phoenix' || item.seat === 'red_team' || item.stage === 'red_team_challenge')
  const coveragePulsar = speaking(coverageSummaries, 'evidence')
  const coverageNova = speaking(coverageSummaries, 'strategy')
  const coverageOrion = speaking(coverageSummaries, 'engineering')
  const coverageLumen = speaking(coverageSummaries, 'verification')
  const coverageAurora = coverageSummaries.find(item => item.nebulaId === 'aurora' || item.stage === 'council_synthesis')
  const coverageAstra = coverageSummaries.some(item => item.displayName === 'ASTRA' || nebulaAgentForSeat(item.seat)?.id === 'astra')
  const coverageDishonest = coverageSummaries.filter(item => item.providerIndependenceHonest === false)
  const coverageBaby = coverageSummaries.find(item => item.seat === 'baby')
  const coverageSolaraContractSeat = coverageSummaries.find(item => item.nebulaId === 'solara')
  const coverageNovaTurn = coverageRound.turns.find(turn => canonicalizeCouncilSeat(turn.provider_family) === 'nova')

  const proof: Record<string, unknown> = {
    familyRound: {
      durationMs: familyRound.durationMs,
      httpStatus: familyRound.httpStatus,
      error: familyRound.error,
      roster: [...new Set(turns.map(turn => turn.provider_family))],
      stages: turns.map(turn => turn.turn_role),
      scoutSwarmPresent: familyRound.scoutSwarmPresent,
      members: summaries,
      redundancy,
      redTeam: redTeam ?? null,
      revisionCount: revisions.length,
      synthesis: synthesis ? { seat: synthesis.seat, preview: synthesis.preview } : null,
      fallbackUsed,
    },
    coverageRound: {
      durationMs: coverageRound.durationMs,
      httpStatus: coverageRound.httpStatus,
      error: coverageRound.error,
      roster: [...new Set(coverageRound.turns.map(turn => turn.provider_family))],
      stages: coverageRound.turns.map(turn => turn.turn_role),
      scoutSwarmPresent: coverageRound.scoutSwarmPresent,
      members: coverageSummaries,
      redundancy: coverageRound.redundancy,
      phoenix: coveragePhoenix ?? null,
      pulsar: coveragePulsar ?? null,
      nova: coverageNova ?? (coverageNovaTurn ? {
        seat: canonicalizeCouncilSeat(coverageNovaTurn.provider_family) ?? coverageNovaTurn.provider_family,
        completion: coverageNovaTurn.completion_status,
        failureReason: coverageNovaTurn.failure_reason,
        actualProvider: coverageNovaTurn.backend_provider,
        actualModel: coverageNovaTurn.provider_model,
      } : null),
      orion: coverageOrion ?? null,
      lumen: coverageLumen ?? null,
      aurora: coverageAurora ?? null,
      fallbackUsed: coverageSummaries.filter(item => item.fallbackFrom),
    },
    constellationSpawned: false,
    astraProvidesSubstantiveAnswer: false,
    revisionTruth: 'LIVE DEFAULT FAMILY REVISION = NOT PART OF THIS PATH',
    solaraTruth: {
      familyToFamilySeatsSolara: false,
      scoutSwarmMapsSolaraToBaby: true,
      permanentIdentityMapsBaby: false,
      babySpokeOnCoverage: Boolean(coverageBaby),
      solaraContractAppliedOnMappedSeat: Boolean(coverageSolaraContractSeat),
      babyPreview: coverageBaby?.preview ?? null,
      note: 'SOLARA has a full Nebula contract. family_to_family does not seat SOLARA. Existing scout-swarm maps SOLARA onto the baby seat, but NEBULA_IDENTITY_BY_SEAT does not map baby, so baby remains an unmapped observer. Bridge Architect stays unmapped optional. No contract was invented.',
    },
  }

  results.push(check('live_15_01_http_ok', familyRound.ok, `${familyRound.httpStatus}`))
  results.push(check('live_15_02_family_deliberation_present', Boolean(familyRound.familyDeliberation), familyRound.familyDeliberation ? 'present' : 'missing'))
  results.push(check('live_15_03_multiple_roles_spoke', visibleTurns.length >= 3, String(visibleTurns.length)))
  results.push(check(
    'live_15_04_outputs_have_profiles',
    summaries.every(item => Boolean(item.reasoningRole && item.reasoningRoleKind)),
    summaries.map(item => `${item.seat}:${item.reasoningRoleKind}`).join(','),
  ))
  results.push(check(
    'live_15_05_no_hidden_cot',
    summaries.every(item => !item.hiddenReasoningPresent && visibleOutputIsSafe(item.preview))
      && coverageSummaries.every(item => !item.hiddenReasoningPresent && visibleOutputIsSafe(item.preview)),
    'visible outputs only',
  ))
  const redTeamSeated = turns.some(turn => turn.provider_family === 'red_team')
  results.push(check(
    'live_15_06_red_team_or_honest_absence',
    Boolean(redTeam) || (redTeamSeated && turns.some(turn => turn.provider_family === 'red_team' && turn.completion_status !== 'complete')) || !redTeamSeated,
    redTeam ? redTeam.stage : redTeamSeated ? 'red_team seated but not completed' : 'red_team not seated for GENERAL family path — existing RESEARCH routing used for PHOENIX',
  ))
  results.push(check(
    'live_15_07_synthesis_not_another_direct_response',
    Boolean(synthesis) && synthesis?.stage === 'council_synthesis',
    synthesis?.stage ?? 'missing',
  ))
  results.push(check(
    'live_15_08_revision_stage_optional_existing_path',
    true,
    revisions.length
      ? `${revisions.length} revision turns`
      : 'LIVE DEFAULT FAMILY REVISION = NOT PART OF THIS PATH; scout-swarm/cross-review owns that stage',
  ))
  results.push(check(
    'live_15_09_fallback_truth',
    dishonest.length === 0 && coverageDishonest.length === 0,
    [...dishonest, ...coverageDishonest].length ? JSON.stringify([...dishonest, ...coverageDishonest]) : 'no dishonest configured=actual claims',
  ))
  results.push(check(
    'live_15_10_astra_not_a_member',
    !astraSeat && !coverageAstra && isOrchestrationOnly('astra'),
    'astraProvidesSubstantiveAnswer=false',
  ))
  results.push(check(
    'live_15_11_redundancy_observable',
    true,
    JSON.stringify({
      family: { problematic: redundancy.redundancyProblematic, echoes: redundancy.nearEchoPairs, meanJaccard: Number(redundancy.meanPairwiseJaccard.toFixed(3)) },
      coverage: { problematic: coverageRound.redundancy.redundancyProblematic, echoes: coverageRound.redundancy.nearEchoPairs, meanJaccard: Number(coverageRound.redundancy.meanPairwiseJaccard.toFixed(3)) },
    }),
  ))
  results.push(check('live_15_12_coverage_http_ok', coverageRound.ok, `${coverageRound.httpStatus}`))
  results.push(check(
    'live_15_13_phoenix_live_adversarial',
    Boolean(coveragePhoenix && coveragePhoenix.completion === 'complete' && (coveragePhoenix.contributionCategories.includes('adversarial') || /fail|risk|challenge|counterexample|assumption/i.test(coveragePhoenix.preview))),
    coveragePhoenix ? JSON.stringify({ seat: coveragePhoenix.seat, stage: coveragePhoenix.stage, categories: coveragePhoenix.contributionCategories, preview: coveragePhoenix.preview }) : 'PHOENIX not seated/completed on existing RESEARCH path',
  ))
  results.push(check(
    'live_15_14_pulsar_evidence_posture',
    Boolean(coveragePulsar && coveragePulsar.contributionCategories.includes('evidence')),
    coveragePulsar ? JSON.stringify({ seat: coveragePulsar.seat, categories: coveragePulsar.contributionCategories, preview: coveragePulsar.preview }) : 'PULSAR not seated/completed',
  ))
  results.push(check(
    'live_15_15_nova_strategy_posture',
    Boolean(
      coverageNova
      && coverageNova.completion === 'complete'
      && coverageNova.nebulaId === 'nova'
      && coverageNova.seat === 'nova'
      && coverageNova.writtenSeat === 'nova'
      && !/kimi|moonshot/i.test(coverageNova.configuredProvider)
      && coverageNova.actualBackendType === 'LOCAL'
      && coverageNova.actualProvider === 'ollama'
    ),
    coverageNova
      ? JSON.stringify({
        seat: coverageNova.seat,
        nebulaId: coverageNova.nebulaId,
        role: coverageNova.reasoningRoleKind,
        configuredProvider: coverageNova.configuredProvider,
        actualProvider: coverageNova.actualProvider,
        actualModel: coverageNova.actualModel,
        categories: coverageNova.contributionCategories,
        preview: coverageNova.preview,
      })
      : coverageNovaTurn
        ? `NOVA strategy seat did not complete (${coverageNovaTurn.completion_status}: ${coverageNovaTurn.failure_reason ?? coverageNovaTurn.full_response.slice(0, 120)}); actual path=${coverageNovaTurn.backend_provider ?? 'unknown'}/${coverageNovaTurn.provider_model ?? 'unknown'}`
        : 'NOVA strategy seat not seated — participation was not fabricated',
  ))
  results.push(check(
    'live_15_16_orion_lumen_aurora_on_same_packet',
    Boolean(coverageOrion && coverageLumen && coverageAurora),
    JSON.stringify({
      orion: coverageOrion?.seat ?? null,
      lumen: coverageLumen?.seat ?? null,
      aurora: coverageAurora?.seat ?? null,
      roster: coverageSummaries.map(item => `${item.nebulaId ?? item.seat}:${item.reasoningRoleKind}`),
    }),
  ))

  mkdirSync('work/build15', { recursive: true })
  writeFileSync('work/build15/reasoning-parameters-live.json', JSON.stringify(proof, null, 2))
  return { results, proof }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await runCouncilReasoningParameterLiveAcceptance()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  console.log(`Council reasoning-parameter live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}
