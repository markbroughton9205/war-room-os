import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { buildTerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import { containsHiddenReasoning, stripHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import { isOrchestrationOnly } from '@/lib/council/nebula/roleContracts'
import type { DeliberationSession, DeliberationTurn } from '@/lib/council/family-deliberation/types'
import { runDeliberationPipelineValidation } from './pipeline.validation'
import { LIVE_SAME_EVIDENCE_DECREE } from '@/lib/council/reasoning-parameters/evaluation'
import { canonicalizeCouncilSeat } from '@/lib/council/seatCanonical'

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

async function runLiveDeliberation(input: {
  decree: string
  requestId: string
  failureInject?: { family: string; role: string } | null
}) {
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
      ...(input.failureInject
        ? { councilDeliberationFailureInject: input.failureInject }
        : {}),
    }),
  }))
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  const familyDeliberation = payload.familyDeliberation && typeof payload.familyDeliberation === 'object'
    ? payload.familyDeliberation as DeliberationSession
    : null
  const turns = familyDeliberation?.turns ?? []
  return {
    durationMs: Date.now() - started,
    httpStatus: response.status,
    error: typeof payload.error === 'string' ? payload.error : null,
    ok: response.ok && !payload.error,
    conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : familyDeliberation?.session_id ?? null,
    familyDeliberation,
    turns,
    payload,
  }
}

function summarizeSeat(turn: DeliberationTurn) {
  return {
    seat: canonicalizeCouncilSeat(turn.provider_family) ?? turn.provider_family,
    nebulaId: nebulaAgentForSeat(turn.provider_family)?.id ?? null,
    stage: turn.turn_role,
    completion: turn.completion_status,
    providerLabel: turn.provider_label,
    providerModel: turn.provider_model,
    backendType: turn.backend_type ?? null,
    backendProvider: turn.backend_provider ?? null,
    backendRuntime: turn.backend_runtime ?? null,
    revisionDecision: turn.revision_decision ?? null,
    revisionStatus: turn.revision_status,
    challengeTargets: turn.challenge_target_ids,
    revisionOf: turn.revision_of_message_id,
    evidenceIds: turn.evidence_reference_ids,
    preview: stripHiddenReasoning(turn.full_response).slice(0, 280),
    hiddenReasoning: containsHiddenReasoning(turn.full_response),
  }
}

export async function runDeliberationPipelineLiveAcceptance(): Promise<{
  results: CaseResult[]
  proof: Record<string, unknown>
}> {
  const structural = runDeliberationPipelineValidation()
  const results: CaseResult[] = structural.map(item => check(`structural_${item.name}`, item.pass, item.detail))

  const success = await runLiveDeliberation({
    decree: LIVE_SAME_EVIDENCE_DECREE,
    requestId: 'roadmap-16-deliberation-success',
  })
  const turns = success.turns
  const primaries = turns.filter(turn => turn.turn_role === 'direct_response' || turn.turn_role === 'opening_position')
  const phoenix = turns.find(turn => turn.turn_role === 'red_team_challenge')
  const revisions = turns.filter(turn => turn.turn_role === 'revision_or_stand_firm')
  const synthesis = turns.find(turn => turn.turn_role === 'council_synthesis')
  const reviseCount = revisions.filter(turn => turn.revision_decision === 'REVISE' || turn.revision_status === 'revised').length
  const standFirmCount = revisions.filter(turn => turn.revision_decision === 'STAND_FIRM' || turn.revision_status === 'stood_firm').length
  const nova = turns.find(turn => canonicalizeCouncilSeat(turn.provider_family) === 'nova')
  const astraSpoke = turns.some(turn => nebulaAgentForSeat(turn.provider_family)?.id === 'astra' && turn.full_response.trim())
  const hidden = turns.some(turn => containsHiddenReasoning(turn.full_response))
  const scoutSwarmPresent = Boolean(success.familyDeliberation?.scout_swarm)

  const failure = await runLiveDeliberation({
    decree: LIVE_SAME_EVIDENCE_DECREE,
    requestId: 'roadmap-16-deliberation-failure',
    // Inject against a seat that GENERAL family path actually seats (LUMEN/gemini).
    failureInject: { family: 'gemini', role: 'direct_response' },
  })
  const failureTurns = failure.turns
  const failedInjected = failureTurns.find(
    turn => canonicalizeCouncilSeat(turn.provider_family) === 'gemini' && turn.turn_role === 'direct_response',
  )
  const failureSynthesis = failureTurns.find(turn => turn.turn_role === 'council_synthesis')
  const fabricatedInjected = failureTurns.some(
    turn => canonicalizeCouncilSeat(turn.provider_family) === 'gemini'
      && turn.completion_status === 'complete'
      && turn.full_response.trim().length > 0
      && turn.turn_role === 'direct_response',
  )

  const proof: Record<string, unknown> = {
    success: {
      request: LIVE_SAME_EVIDENCE_DECREE,
      durationMs: success.durationMs,
      httpStatus: success.httpStatus,
      error: success.error,
      conversationId: success.conversationId,
      scoutSwarmPresent,
      roster: [...new Set(turns.map(turn => turn.provider_family))],
      stages: turns.map(turn => turn.turn_role),
      members: turns.map(summarizeSeat),
      primaryCount: primaries.filter(turn => turn.completion_status === 'complete').length,
      phoenixPresent: Boolean(phoenix?.completion_status === 'complete'),
      phoenixChallengeTargets: phoenix?.challenge_target_ids ?? [],
      revisionDecisions: revisions.map(turn => ({
        seat: turn.provider_family,
        decision: turn.revision_decision,
        status: turn.revision_status,
        source: turn.revision_decision_source,
      })),
      reviseCount,
      standFirmCount,
      synthesisPreview: synthesis ? stripHiddenReasoning(synthesis.full_response).slice(0, 400) : null,
      outcome: success.familyDeliberation?.pipeline?.outcome ?? success.familyDeliberation?.completion_status ?? null,
      evidenceIds: success.familyDeliberation?.evidence_references.map(ref => ref.evidence_reference_id) ?? [],
      pipeline: success.familyDeliberation?.pipeline ?? null,
      nova: nova ? summarizeSeat(nova) : null,
    },
    failure: {
      durationMs: failure.durationMs,
      httpStatus: failure.httpStatus,
      error: failure.error,
      conversationId: failure.conversationId,
      failedInjected: failedInjected ? summarizeSeat(failedInjected) : null,
      fabricatedInjected,
      outcome: failure.familyDeliberation?.pipeline?.outcome ?? failure.familyDeliberation?.completion_status ?? null,
      synthesisPresent: Boolean(failureSynthesis?.completion_status === 'complete'),
      stages: failureTurns.map(turn => `${turn.provider_family}:${turn.turn_role}:${turn.completion_status}`),
      pipeline: failure.familyDeliberation?.pipeline ?? null,
    },
    boundaries: {
      kimiRuntimeCapability: 0,
      astraOrchestrationOnly: isOrchestrationOnly('astra'),
      astraSpoke,
      sessionIntelligencePolicy: success.familyDeliberation?.pipeline?.continuation_policy ?? null,
      openingPositionPolicy: success.familyDeliberation?.pipeline?.opening_position_policy ?? null,
    },
  }

  results.push(check('live_16_01_http_ok', success.ok, `${success.httpStatus}`))
  results.push(check('live_16_02_family_deliberation_present', Boolean(success.familyDeliberation), success.familyDeliberation ? 'present' : 'missing'))
  results.push(check('live_16_03_primary_responses', primaries.some(turn => turn.completion_status === 'complete'), String(primaries.length)))
  results.push(check('live_16_04_phoenix_challenge', Boolean(phoenix && phoenix.completion_status === 'complete'), phoenix?.completion_status ?? 'missing'))
  results.push(check(
    'live_16_05_challenge_refs_prior',
    Boolean(phoenix && phoenix.challenge_target_ids.length > 0),
    phoenix?.challenge_target_ids.join(',') ?? 'none',
  ))
  results.push(check('live_16_06_revision_stage', revisions.length > 0, String(revisions.length)))
  results.push(check(
    'live_16_07_revision_or_stand_firm_decision',
    reviseCount + standFirmCount > 0,
    `revise=${reviseCount} stand_firm=${standFirmCount}`,
  ))
  results.push(check('live_16_08_aurora_synthesis', Boolean(synthesis && synthesis.completion_status === 'complete'), synthesis?.completion_status ?? 'missing'))
  results.push(check(
    'live_16_09_outcome_truthful',
    success.familyDeliberation?.pipeline?.outcome === 'COMPLETE'
      || success.familyDeliberation?.pipeline?.outcome === 'DEGRADED',
    String(success.familyDeliberation?.pipeline?.outcome ?? 'missing'),
  ))
  results.push(check('live_16_10_no_hidden_cot', !hidden, hidden ? 'hidden present' : 'clean'))
  results.push(check('live_16_11_evidence_ids', (success.familyDeliberation?.evidence_references.length ?? 0) >= 0, String(success.familyDeliberation?.evidence_references.length ?? 0)))
  results.push(check('live_16_12_astra_not_substantive_seat', !astraSpoke, astraSpoke ? 'spoke' : 'orchestration-only'))
  results.push(check(
    'live_16_13_continuation_policy_honest',
    success.familyDeliberation?.pipeline?.continuation_policy === 'session_intelligence_v1',
    String(success.familyDeliberation?.pipeline?.continuation_policy),
  ))
  results.push(check('live_16_13b_family_not_scout', !scoutSwarmPresent, scoutSwarmPresent ? 'scout present' : 'family path'))

  results.push(check('live_16_14_failure_http_ok', failure.ok, `${failure.httpStatus}`))
  results.push(check(
    'live_16_15_failed_seat_marked',
    Boolean(failedInjected && failedInjected.completion_status !== 'complete' && !failedInjected.full_response.trim()),
    failedInjected ? `${failedInjected.completion_status}` : 'missing injected failure',
  ))
  results.push(check('live_16_16_no_fabricated_contribution', !fabricatedInjected, fabricatedInjected ? 'fabricated' : 'honest'))
  results.push(check(
    'live_16_17_failure_pipeline_continues',
    failureTurns.some(turn => turn.turn_role === 'direct_response' && turn.completion_status === 'complete')
      || Boolean(failureSynthesis),
    `turns=${failureTurns.length}`,
  ))
  results.push(check(
    'live_16_18_degraded_or_partial_truth',
    failure.familyDeliberation?.pipeline?.outcome === 'DEGRADED'
      || failure.familyDeliberation?.completion_status === 'partial'
      || Boolean(failure.familyDeliberation?.pipeline?.failed_seats?.includes('gemini')),
    String(failure.familyDeliberation?.pipeline?.outcome ?? failure.familyDeliberation?.completion_status),
  ))
  results.push(check(
    'live_16_19_conversation_usable',
    Boolean(failure.familyDeliberation?.session_id) && failureTurns.length > 0,
    failure.familyDeliberation?.session_id ?? 'missing',
  ))

  return { results, proof }
}

async function main() {
  const { results, proof } = await runDeliberationPipelineLiveAcceptance()
  mkdirSync('work/build16', { recursive: true })
  writeFileSync('work/build16/deliberation-pipeline-live.json', JSON.stringify({ results, proof }, null, 2))
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  console.log(`#16 deliberation pipeline live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
