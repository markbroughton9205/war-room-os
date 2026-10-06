import { isGiEng01ShortPathEnabled } from './featureFlag'
import { classifyCouncilPath } from './pathClassifier'
import { commanderTurnFromText } from './multimodalEnvelope'
import { runShortPathRuntime } from './shortPathRuntime'
import { createTypedHandoff } from './handoff'
import { toCommanderFacing } from './responseLayer'
import { routeAgentPath } from './agentPath'
import { buildGiTurnTelemetry } from './observability'
import { OUTPUT_ENVELOPE_SCHEMA, type OutputEnvelopeV1 } from './types'

export type GiFrontDoorChatPayload = {
  councilSingleResponse: string
  results: []
  giPath: 'SHORT_PATH' | 'HANDOFF'
  giEnvelope: ReturnType<typeof toCommanderFacing>
  giTelemetry: ReturnType<typeof buildGiTurnTelemetry>
  giHandoff?: OutputEnvelopeV1['handoff']
  mode: 'gi_short_path' | 'gi_handoff'
  hardStop: true
  showContinue: false
  familyDeliberation?: undefined
}

export async function maybeHandleGiFrontDoor(input: {
  text: string
  conversationId?: string | null
  roomId?: string
  sessionId?: string
  priorTurns?: string[]
  env?: NodeJS.Dict<string>
}): Promise<GiFrontDoorChatPayload | null> {
  if (!isGiEng01ShortPathEnabled(input.env)) return null
  const classified = classifyCouncilPath({ text: input.text, prior_turns: input.priorTurns ?? [] })
  if (classified.path === 'AGENT_PATH') return null

  const envelope = commanderTurnFromText({
    text: input.text,
    room_id: input.roomId || input.conversationId || 'council-room',
    session_id: input.sessionId || input.conversationId || 'ephemeral-session',
    conversation_id: input.conversationId,
  })
  envelope.context.prior_turns = input.priorTurns ?? []

  if (classified.path === 'HANDOFF') {
    const handoff = createTypedHandoff({
      text: input.text,
      room_id: envelope.room_id,
      session_id: envelope.session_id,
      target: classified.handoff_target ?? 'FOUNDRY',
    })
    const facing = toCommanderFacing({
      schema_version: OUTPUT_ENVELOPE_SCHEMA,
      output_id: `out_${envelope.turn_id}`,
      in_reply_to: envelope.turn_id,
      path: 'HANDOFF',
      path_used: 'HANDOFF',
      completion_state: 'HANDED_OFF',
      advisory: true,
      body: {
        summary: classified.handoff_target === 'FOUNDRY'
          ? 'This is an engineering change. I prepared a Foundry handoff and did not mutate the repo.'
          : `This belongs to ${classified.handoff_target}. Handoff prepared; that module was not executed.`,
        unknowns: [],
        risks: ['No execution from Council GI-ENG-01.'],
      },
      artifacts: [],
      tool_trace_public: [],
      seats_used: [],
      capture_truth: envelope.capture_truth,
      authority_decisions: [],
      next_actions: [{ label: 'Commander may authorize the owning module later', requires_commander: true }],
      placement: 'NONE',
      handoff,
    })
    return {
      councilSingleResponse: facing.text,
      results: [],
      giPath: 'HANDOFF',
      giEnvelope: facing,
      giTelemetry: buildGiTurnTelemetry({
        turn_id: envelope.turn_id,
        path: 'HANDOFF',
        classifier_reason: classified.reason,
        started_at: Date.now(),
        model_placement: 'NONE',
        tool_count: 0,
        seats_used: [],
        handoff_type: classified.handoff_target,
        capture_truth: envelope.capture_truth,
      }),
      giHandoff: handoff,
      mode: 'gi_handoff',
      hardStop: true,
      showContinue: false,
    }
  }

  const output = await runShortPathRuntime({
    envelope,
    path: 'SHORT_PATH',
    allow_tools: true,
    tool_allowlist: ['council.calc.simple'],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  })
  if (output.escalation) return null
  const facing = toCommanderFacing(output)
  return {
    councilSingleResponse: facing.text,
    results: [],
    giPath: 'SHORT_PATH',
    giEnvelope: facing,
    giTelemetry: output.telemetry ?? buildGiTurnTelemetry({
      turn_id: envelope.turn_id,
      path: 'SHORT_PATH',
      classifier_reason: classified.reason,
      started_at: Date.now(),
      model_placement: output.placement,
      tool_count: output.tool_trace_public.length,
      seats_used: [],
      capture_truth: envelope.capture_truth,
    }),
    mode: 'gi_short_path',
    hardStop: true,
    showContinue: false,
  }
}

export function giAgentPathPreservesEbc(text: string): boolean {
  const classified = classifyCouncilPath(text)
  if (classified.path !== 'AGENT_PATH') return false
  return routeAgentPath(text, classified).existing_module === 'evidence-board-council'
}
