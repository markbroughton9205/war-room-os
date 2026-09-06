import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCouncilRound, transitionCouncilRound, canTransitionCouncilRound, roundDoesNotInheritPriorState, terminalStatusFromHealth } from './roundState'
import { classifyAstraIntent, createCouncilRoundPlan, selectAgentsForIntent } from './roundFlow'
import { createRoundBlackboard, upsertCompletedFinding, blackboardSummariesForPrompt, chatMustNotRenderStructuredOutput } from './blackboard'
import { extractVisibleModelText, stripHiddenReasoning, containsHiddenReasoning } from './thinkingStrip'
import { looksLikeStructuredDump, presentAgentMessage, containsLegacyFamilyLanguage, containsFrontierSpeakerIdentity } from './presentation'
import { nebulaCommanderEventLabel, isHiddenFromCommanderTimeline, containsLegacyFamilyEventLanguage } from './visibleEvents'
import { classifyCouncilTurn, shouldRunFamilyDeliberation } from '@/lib/council/session-orchestration/turnIntent'

export type StreamingRuntimeCheck = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): StreamingRuntimeCheck {
  return { name, pass, detail }
}

export function runCouncilStreamingRuntimeValidation(): StreamingRuntimeCheck[] {
  const statusPlan = createCouncilRoundPlan({
    roundId: 'round-status-1',
    commanderMessage: 'Council, give me a short status summary of War Room.',
  })
  const roundA = createCouncilRound({ roundId: 'round-status-1', requestId: 'req-1', plan: statusPlan })
  const roundB = createCouncilRound({ roundId: 'round-status-2', requestId: 'req-2', plan: statusPlan })
  const planned = transitionCouncilRound(roundA, 'PLANNING')
  const executing = transitionCouncilRound(planned, 'EXECUTING')
  const synthesizing = transitionCouncilRound(executing, 'SYNTHESIZING')
  const complete = transitionCouncilRound(synthesizing, 'COMPLETE')

  const phoenixDump = presentAgentMessage({
    agentId: 'phoenix',
    raw: JSON.stringify({
      failureModes: [{ failureModes: 'stale waiting state', likelihood: 'high', impact: 'high', mitigation: 'terminal status' }],
      likelihood: 'high',
      impact: 'high',
      mitigation: 'Force terminal COMPLETE',
      strongestCounterexample: 'healthy local path labeled degraded',
      recoveryPlan: 'Stream events immediately',
      rejectionConditions: ['raw JSON in chat'],
    }),
  })

  const thinking = extractVisibleModelText({
    response: 'War Room is online.',
    thinking: '内部推理 should stay hidden',
  })
  const tagged = stripHiddenReasoning('<think>scratch 中文推理</think>\nORION reports local routing is healthy.')

  return [
    check('round_state_machine_legal_path', complete.status === 'COMPLETE' && !canTransitionCouncilRound('COMPLETE', 'EXECUTING'), complete.status),
    check('fresh_round_does_not_inherit', roundDoesNotInheritPriorState(roundB) && roundA.roundId !== roundB.roundId, `${roundA.roundId} vs ${roundB.roundId}`),
    check('astra_status_check_minimum_set', statusPlan.intent === 'STATUS_CHECK' && statusPlan.participatingAgentIds.join(',') === 'orion,lumen,aurora' && !statusPlan.participatingAgentIds.includes('astra'), statusPlan.participatingAgentIds.join(',')),
    check('astra_no_model_required_for_status', classifyAstraIntent(statusPlan.commanderMessage) === 'STATUS_CHECK' && selectAgentsForIntent('STATUS_CHECK').length === 3, statusPlan.intent),
    check('structured_output_not_dumped', !looksLikeStructuredDump(phoenixDump.prose) && !phoenixDump.prose.includes('failureModes') && Boolean(phoenixDump.structuredOutput), phoenixDump.prose.slice(0, 160)),
    check('thinking_separated', thinking.visible === 'War Room is online.' && thinking.thinking?.includes('内部') === true && !containsHiddenReasoning(thinking.visible), thinking.visible),
    check('think_tags_stripped', !tagged.includes('<think') && tagged.includes('ORION reports'), tagged),
    check('legacy_family_labels_not_used', nebulaCommanderEventLabel({ eventType: 'request_selection_resolved', family: null, payload: {} }) === 'Participants Selected' && !containsLegacyFamilyEventLanguage('Participants Selected'), 'Participants Selected'),
    check('text_delta_hidden_from_timeline', isHiddenFromCommanderTimeline({ eventType: 'diagnostic_recorded', payload: { diagnostic: { category: 'provider', code: 'TEXT_DELTA', safeMessage: 'delta' } }, diagnostic: { category: 'provider', code: 'TEXT_DELTA', safeMessage: 'delta' } }), 'TEXT_DELTA hidden'),
    check('terminal_health_mapping', terminalStatusFromHealth({ status: 'complete', degraded: true } as never) === 'COMPLETE_DEGRADED' || terminalStatusFromHealth({
      roundId: 'x',
      participatingSeats: ['claude'],
      successfulSeats: ['claude'],
      failures: [{ seatId: 'gemini', agentId: 'lumen', status: 'FAILED', errorCode: 'failed', safeMessage: 'gap' }],
      synthesizerSeat: 'chatgpt',
      synthesizerIdentity: 'AURORA',
      synthesisAvailable: true,
      synthesisReady: true,
      status: 'complete',
      requested: 2,
      completed: 1,
      failed: 1,
      timedOut: 0,
      fallbackCount: 0,
      evidenceCoverage: 'partial',
      unresolvedContradictions: 0,
      degraded: true,
    }) === 'COMPLETE_DEGRADED', 'COMPLETE_DEGRADED'),
    check('no_frontier_in_presented_status', !containsFrontierSpeakerIdentity(phoenixDump.prose) && !containsLegacyFamilyLanguage(phoenixDump.prose), phoenixDump.prose.slice(0, 80)),
    check(
      'status_check_runs_nebula_group_round',
      shouldRunFamilyDeliberation(classifyCouncilTurn('Council, give me a short status summary of War Room.')),
      'STATUS_CHECK must still create a live Group round',
    ),
    check(
      'isolation_runtime_health_stays_status_check',
      classifyAstraIntent('Council, verify this is a fresh Council round and give me one sentence on current runtime health.') === 'STATUS_CHECK'
        && shouldRunFamilyDeliberation(classifyCouncilTurn('Council, verify this is a fresh Council round and give me one sentence on current runtime health.')),
      'fresh-round runtime health must not be stolen by research/verification',
    ),
    check(
      'local_first_floor_does_not_require_cloud_keys',
      executeBypassesCloudFloorForLocalRouting(),
      'callCouncilProvider must not drop ASTRA seats for missing frontier keys under LOCAL_FIRST',
    ),
  ]
}

function executeBypassesCloudFloorForLocalRouting(): boolean {
  const source = readFileSync(join(process.cwd(), 'app/api/chat/execute.ts'), 'utf8')
  return source.includes('localRoutingBypassesCloudFloorGate')
    && /!familyIsFloorEligible\(family\) && family !== 'kimi' && !localRoutingBypassesCloudFloorGate\(\)/.test(source)
    && source.includes('Agent eligibility comes from the ASTRA/Nebula plan')
}

export function runCouncilRoundIsolationValidation(): StreamingRuntimeCheck[] {
  const first = createCouncilRoundPlan({ roundId: 'r1', commanderMessage: 'Council, give me a short status summary of War Room.' })
  const second = createCouncilRoundPlan({
    roundId: 'r2',
    commanderMessage: 'Council, verify this is a fresh Council round and give me one sentence on current runtime health.',
  })
  const a = createCouncilRound({ roundId: first.roundId, requestId: 'req-a', plan: first })
  const b = createCouncilRound({ roundId: second.roundId, requestId: 'req-b', plan: second })
  const boardA = upsertCompletedFinding(createRoundBlackboard(a.roundId), {
    agentId: 'orion',
    roundId: a.roundId,
    raw: 'Local routing is LOCAL_FIRST.',
    provenance: { backendType: 'LOCAL', provider: 'ollama', runtime: 'http://localhost:11434', model: 'huihui_ai/qwen3-abliterated:14b', fallbackFrom: null },
    startedAt: new Date().toISOString(),
  })
  let isolated = true
  try {
    upsertCompletedFinding(createRoundBlackboard(b.roundId), {
      agentId: 'orion',
      roundId: a.roundId,
      raw: 'stale',
      provenance: { backendType: null, provider: null, runtime: null, model: null, fallbackFrom: null },
      startedAt: new Date().toISOString(),
    })
    isolated = false
  } catch {
    isolated = true
  }
  return [
    check('new_round_id_per_turn', a.roundId !== b.roundId && a.requestId !== b.requestId, `${a.roundId}/${b.roundId}`),
    check('blackboard_rejects_cross_round_write', isolated, 'cross-round write blocked'),
    check('new_round_has_empty_findings', b.findings.length === 0 && b.roundHealth === null && b.inheritedPriorRound === false, String(b.findings.length)),
    check('prior_findings_not_copied', blackboardSummariesForPrompt(boardA).length === 1 && blackboardSummariesForPrompt(createRoundBlackboard(b.roundId)).length === 0, 'isolated boards'),
    check(
      'isolation_second_prompt_keeps_status_agents',
      second.intent === 'STATUS_CHECK' && second.participatingAgentIds.join(',') === 'orion,lumen,aurora',
      `${second.intent}:${second.participatingAgentIds.join(',')}`,
    ),
  ]
}

export function runCouncilNaturalPresentationValidation(): StreamingRuntimeCheck[] {
  const pulsar = presentAgentMessage({
    agentId: 'pulsar',
    raw: '{"evidencePackets":[{"packetId":"p1","claim":"Ollama is reachable","source":"probe","provenance":"live","primary":true}],"missingEvidence":[],"contradictorySignals":[],"searchCoverageNotes":"local probe only"}',
  })
  const lumen = presentAgentMessage({
    agentId: 'lumen',
    raw: '{"claims":[{"claim":"Production is serving the current release","verdict":"supported","evidenceIds":["sha"],"confidence":0.7}],"verdict":"supported","evidenceIds":["sha"],"confidence":0.7,"staleSources":[],"missingTests":[]}',
  })
  const chat = chatMustNotRenderStructuredOutput({
    agentId: 'phoenix',
    roundId: 'r',
    status: 'completed',
    summary: pulsar.prose,
    structuredOutput: pulsar.structuredOutput,
    provenance: { backendType: 'LOCAL', provider: 'ollama', runtime: 'ollama', model: 'qwen', fallbackFrom: null },
    confidence: 0.7,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    metrics: { ttftMs: 12, tokensPerSecond: 40, totalMs: 800 },
  })
  return [
    check('pulsar_prose_not_schema', !chat.includes('evidencePackets') && !pulsar.prose.includes('{'), pulsar.prose),
    check('lumen_prose_not_schema', !lumen.prose.includes('evidenceIds') && lumen.prose.length > 0, lumen.prose),
    check('speaker_is_nebula', pulsar.speaker === 'PULSAR' && lumen.speaker === 'LUMEN', `${pulsar.speaker}/${lumen.speaker}`),
    check('legacy_family_language_absent', !containsLegacyFamilyLanguage('Council Round Created') && !containsLegacyFamilyLanguage('Agent Started'), 'clean labels'),
  ]
}
