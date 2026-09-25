/**
 * Foundry-native typed agent events for Commander live progress.
 * Event names and streaming callback shape adapted from kkkhs/ClawdCode
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md. Foundry remains the event authority.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export const FOUNDRY_AGENT_EVENT_TYPES = [
  'AGENT_STARTED',
  'THINKING',
  'CONTENT',
  'TOOL_REQUEST',
  'TOOL_STARTED',
  'TOOL_RESULT',
  'REPLAN',
  'TEST',
  'ERROR',
  'COMPLETE',
  'MISSION_CONTRACT_DRAFTED',
  'MISSION_CONTRACT_SEALED',
  'ACCEPTANCE_CONTRACT_SEALED',
  'ACCEPTANCE_EVIDENCE_RECORDED',
  'CRITERION_PASSED',
  'CRITERION_FAILED',
  'VERDICT_STARTED',
  'VERDICT_PASS',
  'VERDICT_FAIL',
  'VERDICT_BLOCKED',
  'COMPLETION_REFUSED',
  'EXECUTION_APPROVAL_CREATED',
  'EXECUTION_APPROVAL_SUPERSEDED',
  'EXECUTION_APPROVAL_REVOKED',
  'REAPPROVAL_REQUIRED',
  'REAPPROVAL_COMPLETED',
  'VERDICT_INVALIDATED',
  'PROJECT_READY_INVALIDATED',
  'STAGNATION_DETECTED',
  'REPLAN_PROPOSED',
  'REPLAN_APPLIED',
  'REPLAN_REFUSED',
  'REPLAN_REAPPROVAL_REQUIRED',
  'TASK_PLAN_REPLACED',
  'DAG_REWIRED',
  'MISSION_BLOCKED_STAGNATION',
  'EDITOR_CONTEXT_ATTACHED',
  'AI_EDIT_PROPOSED',
  'AI_EDIT_ACCEPTED',
  'AI_EDIT_REJECTED',
  'AI_EDIT_STALE',
  'AI_EDIT_APPLIED',
  'AI_EDIT_FAILED',
  'SCM_STAGE',
  'SCM_UNSTAGE',
  'SCM_COMMIT_REQUESTED',
  'SCM_COMMIT_REFUSED',
  'SCM_COMMIT_APPROVED',
  'SCM_COMMIT_COMPLETED',
  'SCM_PUSH_REQUESTED',
  'SCM_PUSH_REFUSED',
  'SCM_PUSH_APPROVED',
  'SCM_PUSH_COMPLETED',
  'DEBUG_CONTEXT_ATTACHED',
  'DEBUG_EXPLAIN_REQUESTED',
  'DEBUG_FIX_PROPOSED',
  'TEST_RUN_OBSERVED',
  'TEST_FAILURE_ATTACHED',
  'TEST_EXPLAIN_REQUESTED',
  'TEST_FIX_PROPOSED',
  'TEST_FIX_VERIFIED',
  'ADAPTER_ACTIVATED',
  'ADAPTER_DAP_SESSION_OBSERVED',
  'EXTENSION_REVIEWED',
  'EXTENSION_APPROVED',
  'EXTENSION_INSTALLED',
  'EXTENSION_UPDATED',
  'EXTENSION_DISABLED',
  'EXTENSION_ENABLED',
  'EXTENSION_REMOVED',
  'EXTENSION_QUARANTINED',
  'RESOURCE_BUDGET_CREATED',
  'RESOURCE_USAGE_RECORDED',
  'RESOURCE_SOFT_LIMIT',
  'RESOURCE_HARD_LIMIT',
  'RESOURCE_BUDGET_EXHAUSTED',
  'RESOURCE_BUDGET_EXTENDED',
  'RESOURCE_EXECUTION_PAUSED',
  'RESOURCE_EXECUTION_RESUMED',
  'MISSION_RUNTIME_STARTED',
  'MISSION_RUNTIME_HEARTBEAT',
  'MISSION_RUNTIME_CHECKPOINTED',
  'MISSION_RUNTIME_WAITING',
  'MISSION_RUNTIME_SLEEPING',
  'MISSION_RUNTIME_WAKE_SCHEDULED',
  'MISSION_RUNTIME_WAKING',
  'MISSION_RUNTIME_RECOVERING',
  'MISSION_RUNTIME_RECOVERED',
  'MISSION_RUNTIME_PAUSED',
  'MISSION_RUNTIME_RESUMED',
  'MISSION_RUNTIME_OWNER_TAKEOVER',
  'MISSION_RUNTIME_BLOCKED',
  'MISSION_RUNTIME_TERMINATED',
  'UNATTENDED_AUTHORIZED',
  'UNATTENDED_STARTED',
  'UNATTENDED_PAUSED',
  'UNATTENDED_RESUMED',
  'UNATTENDED_REVOKED',
  'UNATTENDED_STOPPED',
  'UNATTENDED_NEEDS_COMMANDER',
  'UNATTENDED_BLOCKED',
  'UNATTENDED_COMPLETE',
  'UNATTENDED_EXPIRED',
  'UNATTENDED_ACTION_STARTED',
  'UNATTENDED_ACTION_COMPLETED',
] as const

export type FoundryAgentEventType = (typeof FOUNDRY_AGENT_EVENT_TYPES)[number]

export type FoundryAgentEvent = {
  eventId: string
  at: string
  type: FoundryAgentEventType
  missionId: string
  text: string
  tool?: string
  ok?: boolean
  loopCount?: number
  metadata?: Record<string, string | number | boolean | null>
}

const MAX_EVENTS = 80

export function createFoundryAgentEvent(
  mission: Pick<FoundryMissionRecord, 'missionId' | 'loopCount'>,
  type: FoundryAgentEventType,
  text: string,
  extra?: Partial<Pick<FoundryAgentEvent, 'tool' | 'ok' | 'metadata'>>,
): FoundryAgentEvent {
  return {
    eventId: randomUUID(),
    at: new Date().toISOString(),
    type,
    missionId: mission.missionId,
    text: String(text ?? '').slice(0, 2_000),
    tool: extra?.tool,
    ok: extra?.ok,
    loopCount: mission.loopCount,
    metadata: extra?.metadata,
  }
}

export function appendFoundryAgentEvent(
  mission: FoundryMissionRecord,
  type: FoundryAgentEventType,
  text: string,
  extra?: Partial<Pick<FoundryAgentEvent, 'tool' | 'ok' | 'metadata'>>,
): FoundryAgentEvent {
  const event = createFoundryAgentEvent(mission, type, text, extra)
  const next = [...(mission.agentEvents ?? []), event]
  mission.agentEvents = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
  return event
}

export function latestFoundryAgentEvent(mission: Pick<FoundryMissionRecord, 'agentEvents'>): FoundryAgentEvent | null {
  return mission.agentEvents?.at(-1) ?? null
}

export function foundryAgentEventsForCommander(mission: Pick<FoundryMissionRecord, 'agentEvents'>): FoundryAgentEvent[] {
  return (mission.agentEvents ?? []).slice(-24)
}
