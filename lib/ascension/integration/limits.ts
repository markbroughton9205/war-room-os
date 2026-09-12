/**
 * #22 Phase 14 — Cross-agent loop / duration bounds.
 * No uncontrolled agent loops. No recursive Council deliberation.
 */
export const CROSS_AGENT_LOOP_LIMITS = Object.freeze({
  max_handoffs: 8,
  max_mission_steps: 8,
  max_validation_revisions: 1,
  max_workflow_ms: 45_000,
  max_agent_spawn: 0,
} as const)

export function assertWithinHandoffLimit(count: number): { ok: true } | { ok: false; reason: string } {
  if (count > CROSS_AGENT_LOOP_LIMITS.max_handoffs) {
    return { ok: false, reason: `Handoff count ${count} exceeds max ${CROSS_AGENT_LOOP_LIMITS.max_handoffs}.` }
  }
  return { ok: true }
}

export function assertWithinMissionStepLimit(count: number): { ok: true } | { ok: false; reason: string } {
  if (count > CROSS_AGENT_LOOP_LIMITS.max_mission_steps) {
    return { ok: false, reason: `Mission step count ${count} exceeds max ${CROSS_AGENT_LOOP_LIMITS.max_mission_steps}.` }
  }
  return { ok: true }
}

export function assertWithinRevisionLimit(count: number): { ok: true } | { ok: false; reason: string } {
  if (count > CROSS_AGENT_LOOP_LIMITS.max_validation_revisions) {
    return { ok: false, reason: `Revision count ${count} exceeds max ${CROSS_AGENT_LOOP_LIMITS.max_validation_revisions}.` }
  }
  return { ok: true }
}

export function assertWithinWorkflowDuration(startedMs: number, nowMs = Date.now()): { ok: true } | { ok: false; reason: string } {
  const elapsed = nowMs - startedMs
  if (elapsed > CROSS_AGENT_LOOP_LIMITS.max_workflow_ms) {
    return { ok: false, reason: `Workflow duration ${elapsed}ms exceeds max ${CROSS_AGENT_LOOP_LIMITS.max_workflow_ms}ms.` }
  }
  return { ok: true }
}
