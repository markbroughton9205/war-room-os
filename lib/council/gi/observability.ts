import { GI_TURN_TELEMETRY_SCHEMA, type CaptureTruth, type CouncilPath, type GiEscalation, type GiTurnTelemetry, type HandoffTarget, type ModelPlacement } from './types'

export function buildGiTurnTelemetry(input: {
  turn_id: string
  path: CouncilPath
  classifier_reason: string
  started_at: number
  model_placement: ModelPlacement
  tool_count: number
  seats_used?: string[]
  handoff_type?: HandoffTarget
  escalation?: GiEscalation
  capture_truth: CaptureTruth
}): GiTurnTelemetry {
  return {
    schema_version: GI_TURN_TELEMETRY_SCHEMA,
    turn_id: input.turn_id,
    path: input.path,
    classifier_reason: input.classifier_reason,
    latency_ms: Math.max(0, Date.now() - input.started_at),
    model_placement: input.model_placement,
    tool_count: input.tool_count,
    seats_used: input.seats_used ?? [],
    handoff_type: input.handoff_type,
    escalation: input.escalation,
    capture_truth: input.capture_truth,
  }
}
