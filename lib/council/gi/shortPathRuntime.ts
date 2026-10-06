import { OUTPUT_ENVELOPE_SCHEMA, type AuthorityDecision, type GiEscalation, type GiTurnTelemetry, type OutputEnvelopeV1, type PublicToolTrace, type ShortPathCompleter, type ShortPathRuntimeRequest } from './types'
import { evaluateAuthority } from './authorityMatrix'
import { extractTurnText } from './multimodalEnvelope'
import { canShowListening } from './captureTruth'
import { classifyCouncilPath } from './pathClassifier'
import { qualityShortPathCompleter } from './qualityCompleter'
import { createModelBackedShortPathCompleter, shortPathPlacementTruth } from './shortPathCompleter'
import { classifyToolNeed } from './toolNeed'
import { resolveFollowUpText } from './conversationContext'

const defaultCompleter: ShortPathCompleter = createModelBackedShortPathCompleter(qualityShortPathCompleter)

export function shouldEscalateFromShortPath(text: string, priorTurns: readonly string[] = []): { escalate: boolean; reason: string } {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return { escalate: false, reason: '' }
  const classified = classifyCouncilPath({ text: raw, prior_turns: [...priorTurns] })
  if (classified.path !== 'SHORT_PATH') {
    return { escalate: true, reason: `Runtime observed classifier path ${classified.path}: ${classified.reason}` }
  }
  if (!classified.escalation_allowed) return { escalate: false, reason: '' }
  const tool = classifyToolNeed(raw)
  if (tool.need === 'BROWSER_SEARCH' || tool.need === 'SYSTEM_PROBE' || tool.need === 'FOUNDRY') {
    return { escalate: true, reason: `SHORT_PATH cannot own ${tool.need}.` }
  }
  if (/\b(investigate this|council (?:should |to )?investigate|double-check with sources)\b/i.test(raw)) {
    return { escalate: true, reason: 'Commander asked Council to investigate.' }
  }
  return { escalate: false, reason: '' }
}

function simpleArithmetic(text: string): string | null {
  const match = text.replace(/×/g, '*').replace(/x/gi, '*').match(/(\d+)\s*([+*/-])\s*(\d+)/)
  if (!match) return null
  const a = Number(match[1])
  const b = Number(match[3])
  const op = match[2]
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (op === '+') return String(a + b)
  if (op === '-') return String(a - b)
  if (op === '*') return String(a * b)
  if (op === '/' && b !== 0) return String(a / b)
  return null
}

export async function runShortPathRuntime(
  request: ShortPathRuntimeRequest,
  completer: ShortPathCompleter = defaultCompleter,
): Promise<OutputEnvelopeV1> {
  if (request.path !== 'SHORT_PATH') {
    throw new Error('ShortPathRuntime requires path SHORT_PATH')
  }
  const started = Date.now()
  const text = extractTurnText(request.envelope)
  const prior = request.envelope.context.prior_turns ?? []
  const escalate = shouldEscalateFromShortPath(text, prior)
  const authority_decisions: AuthorityDecision[] = []
  const tool_trace_public: PublicToolTrace[] = []

  if (escalate.escalate) {
    const escalation: GiEscalation = {
      from: 'SHORT_PATH',
      to: classifyCouncilPath({ text, prior_turns: prior }).path === 'HANDOFF' ? 'HANDOFF' : 'AGENT_PATH',
      reason: escalate.reason,
      observed: true,
      at: new Date().toISOString(),
    }
    const telemetry: GiTurnTelemetry = {
      schema_version: 'war-room.gi-turn-telemetry.v1',
      turn_id: request.envelope.turn_id,
      path: 'SHORT_PATH',
      classifier_reason: escalate.reason,
      latency_ms: Date.now() - started,
      model_placement: request.model_route.placement,
      tool_count: 0,
      seats_used: [],
      escalation,
      capture_truth: request.envelope.capture_truth,
    }
    return {
      schema_version: OUTPUT_ENVELOPE_SCHEMA,
      output_id: `out_${request.envelope.turn_id}`,
      in_reply_to: request.envelope.turn_id,
      path: 'SHORT_PATH',
      path_used: 'SHORT_PATH',
      completion_state: 'ESCALATED',
      advisory: true,
      body: {
        summary: 'This needs a specialist path rather than a short reply. I am keeping this room and session and escalating.',
        unknowns: [],
        risks: [escalate.reason],
      },
      artifacts: [],
      tool_trace_public: [],
      seats_used: [],
      capture_truth: request.envelope.capture_truth,
      authority_decisions: [],
      next_actions: [{ label: 'Continue on AGENT_PATH / existing EBC with the same session', requires_commander: false }],
      placement: request.model_route.placement,
      escalation,
      telemetry,
    }
  }

  const classified = classifyCouncilPath({ text, prior_turns: prior })
  if (classified.clarifying_question) {
    return {
      schema_version: OUTPUT_ENVELOPE_SCHEMA,
      output_id: `out_${request.envelope.turn_id}`,
      in_reply_to: request.envelope.turn_id,
      path: 'SHORT_PATH',
      path_used: 'SHORT_PATH',
      completion_state: 'NEEDS_CLARIFICATION',
      advisory: true,
      body: { summary: classified.clarifying_question, unknowns: classified.ambiguities, risks: [] },
      artifacts: [],
      tool_trace_public: [],
      seats_used: [],
      capture_truth: request.envelope.capture_truth,
      authority_decisions: [],
      next_actions: [{ label: 'Answer the clarifying question', requires_commander: true }],
      placement: 'NONE',
      telemetry: {
        schema_version: 'war-room.gi-turn-telemetry.v1',
        turn_id: request.envelope.turn_id,
        path: 'SHORT_PATH',
        classifier_reason: classified.reason,
        latency_ms: Date.now() - started,
        model_placement: 'NONE',
        tool_count: 0,
        seats_used: [],
        capture_truth: request.envelope.capture_truth,
      },
    }
  }

  for (const tool_id of ['email.send', 'council.git.push', 'computer_use.os', 'foundry.handoff']) {
    const decision = evaluateAuthority({ tool_id, path: 'SHORT_PATH', capability_available: true })
    if (decision.decision !== 'auto') authority_decisions.push(decision)
  }

  let summary = ''
  let placement = request.model_route.placement
  let modelInvoked = false
  let modelFamily = ''
  let fallback = ''
  let ttft: number | null = null
  const calc = request.allow_tools && request.tool_allowlist.includes('council.calc.simple')
    ? simpleArithmetic(text)
    : null
  if (calc) {
    const decision = evaluateAuthority({ tool_id: 'council.calc.simple', path: 'SHORT_PATH', capability_available: true })
    authority_decisions.push(decision)
    if (decision.decision === 'auto') {
      tool_trace_public.push({ step: 1, label: 'simple calculation', ok: true })
      summary = calc
      placement = 'NONE'
    }
  }
  if (!summary) {
    const completed = await completer({
      text,
      envelope: request.envelope,
      prior_turns: prior,
    })
    summary = completed.text
    placement = shortPathPlacementTruth(completed)
    modelInvoked = completed.model_invoked
    modelFamily = completed.provider_family ?? ''
    fallback = completed.fallback ?? ''
    ttft = completed.ttft_ms ?? null
  }

  if (canShowListening(request.envelope) === false && /listening/i.test(summary)) {
    summary = summary.replace(/listening/ig, 'not capturing audio')
  }

  const follow = resolveFollowUpText(text, prior)
  const telemetry: GiTurnTelemetry = {
    schema_version: 'war-room.gi-turn-telemetry.v1',
    turn_id: request.envelope.turn_id,
    path: 'SHORT_PATH',
    classifier_reason: classified.reason,
    latency_ms: Date.now() - started,
    model_placement: placement,
    tool_count: tool_trace_public.length,
    seats_used: [],
    capture_truth: request.envelope.capture_truth,
    model_family: modelFamily || undefined,
    fallback: fallback || undefined,
    ttft_ms: ttft,
  }

  return {
    schema_version: OUTPUT_ENVELOPE_SCHEMA,
    output_id: `out_${request.envelope.turn_id}`,
    in_reply_to: request.envelope.turn_id,
    path: 'SHORT_PATH',
    path_used: 'SHORT_PATH',
    completion_state: 'UNVERIFIED',
    advisory: true,
    body: {
      summary,
      unknowns: modelInvoked ? [] : [],
      risks: [],
    },
    artifacts: [],
    tool_trace_public,
    seats_used: [],
    capture_truth: request.envelope.capture_truth,
    authority_decisions,
    next_actions: follow.preserved_session ? [] : [],
    placement,
    telemetry,
  }
}
