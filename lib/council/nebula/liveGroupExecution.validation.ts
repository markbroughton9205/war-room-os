import {
  appendDeliberationTurn,
  createDeliberationSession,
  deriveFamilyDeliberationRoundOutcome,
  familyDisplayName,
  type DeliberationSession,
} from '@/lib/council/family-deliberation'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { NEBULA_AGENT_IDS } from './identity'

/**
 * Structural regression for the REAL live Group/deliberation entrypoint: builds a
 * DeliberationSession with the same createDeliberationSession/appendDeliberationTurn helpers
 * app/api/chat/execute.ts uses, then calls deriveFamilyDeliberationRoundOutcome — the exact
 * function execute.ts's family_to_family_deliberation branch calls to build its API response.
 * This is a structural/fixture regression test, not a live browser or live-model proof — see
 * liveGroupExecution.live-validation.ts for the real-Ollama companion check.
 */

export type LiveGroupExecutionValidationResult = { name: string; pass: boolean; detail: string }

const FRONTIER_NAME_PATTERN = /\b(chatgpt|openai|claude|anthropic|grok|xai|gemini|google\s*gemini|kimi|moonshot|red\s*team)\b/i
const REPORT_CARD_MARKERS = /Agent:|Claims:|Evidence references:|Recommended action:/

function baseSession(missionId: string): DeliberationSession {
  return createDeliberationSession({
    sessionId: `fixture-session-${missionId}`,
    roundId: `fixture-round-${missionId}`,
    missionId,
    missionVersion: 1,
    commanderMessage: "Council, give me a short status summary of War Room.",
  })
}

function addTurn(
  session: DeliberationSession,
  family: CouncilOrchestrationFamily,
  role: 'opening_position' | 'direct_response' | 'council_synthesis',
  speakingOrder: number,
  outcome: 'complete' | 'failed' | 'timed_out' | 'unavailable',
): void {
  const complete = outcome === 'complete'
  appendDeliberationTurn(session, {
    family,
    role,
    speakingOrder,
    inputMessageIds: [session.commander_message_id],
    providerResult: {
      family,
      providerLabel: familyDisplayName(family),
      providerModel: complete ? 'huihui_ai/qwen3-abliterated:14b' : null,
      content: complete ? `${familyDisplayName(family)} take: War Room is up and routing locally.` : '',
      status: outcome,
      failureReason: complete ? null : `simulated ${outcome} for regression fixture`,
      backendType: complete ? 'LOCAL' : null,
      backendProvider: complete ? 'ollama' : null,
    },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  })
}

function checkFullSuccessUsesNebulaIdentitiesOnly(): LiveGroupExecutionValidationResult {
  const session = baseSession('full-success')
  addTurn(session, 'grok', 'opening_position', 1, 'complete')
  addTurn(session, 'claude', 'direct_response', 2, 'complete')
  addTurn(session, 'chatgpt', 'council_synthesis', 3, 'complete')
  session.synthesis_turn_id = session.turns[2]!.turn_id
  const { results, roundHealth } = deriveFamilyDeliberationRoundOutcome(session)
  const families = results.map(r => r.family)
  const noFrontier = results.every(r => !FRONTIER_NAME_PATTERN.test(r.family) && !FRONTIER_NAME_PATTERN.test(r.content))
  const noSystemCards = !families.includes('SYSTEM')
  const auroraPresent = families.includes('AURORA')
  const pass = results.length === 3 && noFrontier && noSystemCards && auroraPresent
    && !roundHealth.degraded && roundHealth.synthesisAvailable && roundHealth.synthesizerIdentity === 'AURORA'
  return {
    name: 'full_success_round_uses_nebula_identities_only',
    pass,
    detail: `families=${families.join(',')} degraded=${roundHealth.degraded} synthesisAvailable=${roundHealth.synthesisAvailable}`,
  }
}

function checkPartialFailureRoutesToRoundHealthNotSystemCard(): LiveGroupExecutionValidationResult {
  const session = baseSession('partial-failure')
  addTurn(session, 'claude', 'opening_position', 1, 'failed')
  addTurn(session, 'grok', 'direct_response', 2, 'complete')
  addTurn(session, 'chatgpt', 'council_synthesis', 3, 'complete')
  session.synthesis_turn_id = session.turns[2]!.turn_id
  const { results, roundHealth } = deriveFamilyDeliberationRoundOutcome(session)
  const families = results.map(r => r.family)
  const noSystemCards = !families.includes('SYSTEM')
  const noRawReportText = results.every(r => !REPORT_CARD_MARKERS.test(r.content) || r.family !== 'SYSTEM')
  const failureInHealth = roundHealth.failures.some(f => f.seatId === 'claude' && f.agentId === 'orion')
  // Synthesis (AURORA) still succeeded despite ORION's failure, so the round is honestly
  // reported as 'complete' (a usable answer exists) while still flagged degraded — see
  // lib/council/nebula/round.ts:projectRoundHealth's status derivation.
  const pass = results.length === 2 && noSystemCards && noRawReportText && roundHealth.degraded
    && failureInHealth && roundHealth.status === 'complete' && roundHealth.synthesisAvailable
  return {
    name: 'partial_failure_routes_to_roundhealth_not_system_card',
    pass,
    detail: `families=${families.join(',')} failures=${roundHealth.failures.map(f => f.agentId ?? f.seatId).join(',')} status=${roundHealth.status}`,
  }
}

function checkFullFailureGetsOneCompactNoticeNotRawReports(): LiveGroupExecutionValidationResult {
  const session = baseSession('full-failure')
  addTurn(session, 'claude', 'opening_position', 1, 'failed')
  addTurn(session, 'grok', 'direct_response', 2, 'unavailable')
  addTurn(session, 'chatgpt', 'council_synthesis', 3, 'failed')
  const { results, roundHealth } = deriveFamilyDeliberationRoundOutcome(session)
  const systemEntries = results.filter(r => r.family === 'SYSTEM')
  const exactlyOneCompactNotice = systemEntries.length === 1
    && !REPORT_CARD_MARKERS.test(systemEntries[0]!.content)
    && systemEntries[0]!.content.length < 400
  const namesAgents = /ORION|PULSAR|AURORA/.test(systemEntries[0]?.content ?? '')
  const noFrontierInNotice = !FRONTIER_NAME_PATTERN.test(systemEntries[0]?.content ?? '')
  const pass = results.length === 1 && exactlyOneCompactNotice && namesAgents && noFrontierInNotice
    && roundHealth.status === 'failed' && roundHealth.degraded && !roundHealth.synthesisAvailable
  return {
    name: 'full_failure_gets_one_compact_notice_not_raw_reports',
    pass,
    detail: `resultsCount=${results.length} notice=${JSON.stringify(systemEntries[0]?.content ?? null)}`,
  }
}

function checkAllPermanentAgentIdentitiesResolvable(): LiveGroupExecutionValidationResult {
  const seats: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini', 'kimi', 'red_team']
  const labels = seats.map(seat => familyDisplayName(seat))
  const allNebula = labels.every(label => NEBULA_AGENT_IDS.some(id => id.toUpperCase() === label))
  return {
    name: 'mapped_seats_resolve_to_permanent_nebula_identities',
    pass: allNebula,
    detail: seats.map((seat, i) => `${seat}=${labels[i]}`).join(', '),
  }
}

export function runLiveGroupExecutionValidation(): LiveGroupExecutionValidationResult[] {
  return [
    checkAllPermanentAgentIdentitiesResolvable(),
    checkFullSuccessUsesNebulaIdentitiesOnly(),
    checkPartialFailureRoutesToRoundHealthNotSystemCard(),
    checkFullFailureGetsOneCompactNoticeNotRawReports(),
  ]
}
