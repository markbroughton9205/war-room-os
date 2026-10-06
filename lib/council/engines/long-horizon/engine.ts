/**
 * LongHorizonMissionEngine — durable mission coordinator.
 * Does not execute tools, verify evidence, or replace CouncilExecutive.
 */
import { createEngineReceipt } from '../receipts'
import type { EngineReceipt } from '../types'
import {
  LONG_HORIZON_MISSION_SCHEMA,
  TERMINAL_MISSION_STATES,
  type LongHorizonMission,
  type MissionBudgetState,
  type MissionPhase,
  type MissionState,
  type PendingApproval,
} from './types'
import { loadMission, saveMission, findLatestActiveByConversation } from './store'
import { fingerprintAction } from '../checkpoint/fingerprint'

const DEFAULT_BUDGET: MissionBudgetState = {
  tool_calls_used: 0,
  tool_calls_max: 12,
  retry_count: 0,
  retry_max: 1,
  wall_ms_used: 0,
  wall_ms_max: 120_000,
  local_model_calls: 0,
  local_model_max: 1,
  external_calls: 0,
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 240)
}

function defaultPhases(mission_id: string): MissionPhase[] {
  const kinds = ['DISCOVER', 'COLLECT', 'VERIFY', 'SYNTHESIZE'] as const
  return kinds.map((kind, i) => ({
    phase_id: `phase-${kind.toLowerCase()}`,
    mission_id,
    kind,
    objective: kind,
    dependencies: i ? [`phase-${kinds[i - 1].toLowerCase()}`] : [],
    task_refs: [],
    status: 'CREATED',
    started_at: null,
    completed_at: null,
    checkpoint_ref: null,
    completion_condition: kind,
    authority_requirement: 'NONE',
  }))
}

export function parseEngine04Command(text: string): 'pause' | 'resume' | 'cancel' | 'approve' | 'decline' | null {
  const trimmed = text.trim()
  if (/^approve$/i.test(trimmed) || /\bapprove (?:this |the )?(?:action|mission|request|gated task)\b/i.test(text)) return 'approve'
  if (/^decline$/i.test(trimmed) || /\bdecline (?:this |the )?(?:action|mission|request|gated task)\b/i.test(text)) return 'decline'
  if (/\bpause this mission\b/i.test(text)) return 'pause'
  if (/\bresume this mission\b/i.test(text)) return 'resume'
  if (/\bcancel this mission\b/i.test(text)) return 'cancel'
  return null
}

export function isTerminal(state: MissionState): boolean {
  return (TERMINAL_MISSION_STATES as readonly string[]).includes(state)
}

export async function createLongHorizonMission(input: {
  mission_id: string
  objective: string
  mission_type?: string
  conversation_id?: string | null
  session_id?: string | null
  commander_request_id?: string | null
  parent_mission_id?: string | null
  runtime?: string | null
}): Promise<{ mission: LongHorizonMission; receipt: EngineReceipt }> {
  const started = Date.now()
  const ts = nowIso()
  const mission: LongHorizonMission = {
    schema: LONG_HORIZON_MISSION_SCHEMA,
    mission_id: input.mission_id,
    parent_mission_id: input.parent_mission_id ?? null,
    commander_request_id: input.commander_request_id ?? null,
    conversation_id: input.conversation_id ?? null,
    session_id: input.session_id ?? null,
    mission_type: input.mission_type ?? 'COUNCIL',
    objective: input.objective,
    normalized_objective: normalize(input.objective),
    created_at: ts,
    updated_at: ts,
    started_at: ts,
    paused_at: null,
    resumed_at: null,
    completed_at: null,
    mission_state: 'PLANNING',
    completion_state: null,
    plan_ref: null,
    ebc_ref: null,
    ebc_evidence_ids: [],
    question_graph: [],
    hypotheses: [],
    current_phase_id: 'phase-discover',
    phases: defaultPhases(input.mission_id),
    current_task_ids: [],
    completed_task_ids: [],
    blocked_task_ids: [],
    failed_task_ids: [],
    cancelled_task_ids: [],
    completed_dispatch_ids: [],
    execution_wave_refs: [],
    checkpoint_refs: [],
    authority_state: 'NONE',
    pending_approval_refs: [],
    budget_state: { ...DEFAULT_BUDGET },
    memory_context_refs: [],
    temporal_context_refs: [],
    last_known_runtime: input.runtime ?? null,
    runtime_generation: input.runtime ?? null,
    resume_cursor: 'phase-discover',
    failure_state: null,
    diagnosis_refs: [],
    terminal_reason: null,
    plan_snapshot: null,
    grants_authority: false,
    ebc_canonical: true,
    hidden_cot: false,
  }
  await saveMission(mission)
  return {
    mission,
    receipt: createEngineReceipt({
      engine: 'long-horizon-mission',
      mission_id: mission.mission_id,
      started_at: started,
      decision_count: 1,
      decision: 'CREATED',
    }),
  }
}

export async function loadOrCreateLongHorizonMission(input: Parameters<typeof createLongHorizonMission>[0]): Promise<LongHorizonMission> {
  const existing = await loadMission(input.mission_id)
  if (existing) return existing
  return (await createLongHorizonMission(input)).mission
}

export async function advanceMission(mission: LongHorizonMission, next: MissionState, extra: Partial<LongHorizonMission> = {}): Promise<LongHorizonMission> {
  const updated: LongHorizonMission = {
    ...mission,
    ...extra,
    mission_state: next,
    updated_at: nowIso(),
    completed_at: isTerminal(next) ? nowIso() : mission.completed_at,
    terminal_reason: extra.terminal_reason ?? (isTerminal(next) ? next : mission.terminal_reason),
  }
  await saveMission(updated)
  return updated
}

export async function pauseMission(mission: LongHorizonMission, _reason = 'commander pause'): Promise<LongHorizonMission> {
  void _reason
  return advanceMission(mission, 'PAUSED', { paused_at: nowIso() })
}

export async function cancelMission(mission: LongHorizonMission, reason = 'commander cancel'): Promise<LongHorizonMission> {
  return advanceMission(mission, 'CANCELLED', { terminal_reason: reason, cancelled_task_ids: [...mission.current_task_ids, ...mission.cancelled_task_ids] })
}

export async function completeMission(mission: LongHorizonMission, completion: 'COMPLETED' | 'PARTIALLY_COMPLETED', reason: string): Promise<LongHorizonMission> {
  return advanceMission(mission, completion, { completion_state: completion, terminal_reason: reason })
}

export function recordCompletedWork(mission: LongHorizonMission, input: {
  task_ids?: string[]
  dispatch_ids?: string[]
  wave_ids?: string[]
  evidence_ids?: string[]
  budget?: Partial<MissionBudgetState>
}): LongHorizonMission {
  return {
    ...mission,
    completed_task_ids: [...new Set([...mission.completed_task_ids, ...(input.task_ids ?? [])])],
    completed_dispatch_ids: [...new Set([...mission.completed_dispatch_ids, ...(input.dispatch_ids ?? [])])],
    execution_wave_refs: [...new Set([...mission.execution_wave_refs, ...(input.wave_ids ?? [])])],
    ebc_evidence_ids: [...new Set([...mission.ebc_evidence_ids, ...(input.evidence_ids ?? [])])],
    current_task_ids: mission.current_task_ids.filter(id => !(input.task_ids ?? []).includes(id)),
    budget_state: { ...mission.budget_state, ...input.budget },
    updated_at: nowIso(),
  }
}

export function queueAuthorityWait(mission: LongHorizonMission, input: { task_id: string; action: string }): LongHorizonMission {
  const approval: PendingApproval = {
    approval_id: `appr-${input.task_id}`,
    mission_id: mission.mission_id,
    task_id: input.task_id,
    action: input.action,
    action_fingerprint: fingerprintAction(input.action, input.task_id),
    authority: 'COMMANDER',
    state: 'PENDING',
    created_at: nowIso(),
  }
  return {
    ...mission,
    mission_state: 'WAITING_AUTHORITY',
    authority_state: 'WAITING_AUTHORITY',
    pending_approval_refs: [...mission.pending_approval_refs.filter(row => row.task_id !== input.task_id), approval],
    blocked_task_ids: [...new Set([...mission.blocked_task_ids, input.task_id])],
    resume_cursor: input.task_id,
    updated_at: nowIso(),
  }
}

export function applyAuthorityDecision(mission: LongHorizonMission, decision: 'approve' | 'decline', fingerprint: string): LongHorizonMission {
  const pending = mission.pending_approval_refs.find(row => row.state === 'PENDING')
  if (!pending) return mission
  if (pending.action_fingerprint !== fingerprint) {
    return { ...mission, failure_state: 'authority fingerprint mismatch', updated_at: nowIso() }
  }
  const next: PendingApproval = { ...pending, state: decision === 'approve' ? 'APPROVED' : 'DECLINED' }
  return {
    ...mission,
    pending_approval_refs: mission.pending_approval_refs.map(row => row.approval_id === pending.approval_id ? next : row),
    authority_state: decision === 'approve' ? 'APPROVED' : 'DECLINED',
    mission_state: decision === 'approve' ? 'RESUMING' : 'PARTIALLY_COMPLETED',
    terminal_reason: decision === 'decline' ? 'Commander declined' : mission.terminal_reason,
    blocked_task_ids: decision === 'approve' ? mission.blocked_task_ids.filter(id => id !== pending.task_id) : mission.blocked_task_ids,
    updated_at: nowIso(),
  }
}

export async function resolveMissionForCommand(input: {
  mission_id?: string
  conversation_id?: string | null
  session_id?: string | null
}): Promise<LongHorizonMission | null> {
  if (input.mission_id) return loadMission(input.mission_id)
  return findLatestActiveByConversation(input.conversation_id ?? null, input.session_id ?? null)
}

export function commanderMissionStatus(mission: LongHorizonMission): string {
  const pending = mission.pending_approval_refs.find(row => row.state === 'PENDING')
  const lines = [
    `Mission ${mission.mission_id} is ${mission.mission_state}.`,
    `Phase: ${mission.current_phase_id ?? 'none'}.`,
    `Completed tasks: ${mission.completed_task_ids.length}. Remaining: ${mission.current_task_ids.length}.`,
  ]
  if (mission.mission_state === 'PAUSED') lines.push('Paused. Resume is available.')
  if (pending) lines.push(`Commander approval required for ${pending.action}.`)
  if (mission.mission_state === 'WAITING_AUTHORITY') lines.push('Waiting for Commander approval. Nothing executed past the gate.')
  return lines.join(' ')
}
