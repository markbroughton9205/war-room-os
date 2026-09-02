import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

export type NormalizedRuntimeTrajectory = {
  trajectory_id: string
  request_text: string
  decision: string
  tool_id: string | null
  arguments: Record<string, string>
  router_validation_status: string | null
  result_status: string | null
  source_type: string
  review_state: 'NORMALIZED'
  raw_review_state: 'RAW'
  EXCLUDE_FROM_TRAINING: true
  auto_curriculum: false
  auto_verified: false
  family_id: string
  insertion_point: string
}

export function normalizeCapturedRuntimeTrajectory(
  raw: CapturedRuntimeTrajectory,
): NormalizedRuntimeTrajectory {
  const tool = raw.selected_tool ?? 'none'
  return {
    trajectory_id: raw.trajectory_id,
    request_text: raw.request,
    decision: raw.decision,
    tool_id: raw.selected_tool,
    arguments: raw.arguments,
    router_validation_status: raw.router_validation_status,
    result_status: raw.tool_result_status,
    source_type: raw.source_type,
    review_state: 'NORMALIZED',
    raw_review_state: 'RAW',
    EXCLUDE_FROM_TRAINING: true,
    auto_curriculum: false,
    auto_verified: false,
    family_id: `fam.runtime.${raw.decision === 'NO_TOOL' ? 'no_tool' : tool}.${raw.trajectory_id.slice(-8)}`,
    insertion_point: raw.insertion_point,
  }
}
