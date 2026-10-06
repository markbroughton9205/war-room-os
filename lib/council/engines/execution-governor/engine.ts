import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { createEngineReceipt } from '../receipts'
import type { AuthorityGate, AuthorityGateClass, ExecutionBudget, ExecutionGovernorState } from './types'

const DEFAULT_BUDGET: ExecutionBudget = {
  max_tool_calls: 12,
  max_retries: 1,
  max_ms: 120_000,
  max_local_model: 1,
}

export function createGovernor(mission_id: string, budget?: Partial<ExecutionBudget>, spent?: Partial<Pick<ExecutionGovernorState, 'tool_calls' | 'retry_count' | 'latency_ms' | 'local_model_calls' | 'external_calls'>>): ExecutionGovernorState {
  const started = Date.now()
  const resolved = { ...DEFAULT_BUDGET, ...budget, max_local_model: 1 as const }
  return {
    tool_calls: spent?.tool_calls ?? 0,
    retry_count: spent?.retry_count ?? 0,
    latency_ms: spent?.latency_ms ?? 0,
    local_model_calls: spent?.local_model_calls ?? 0,
    external_calls: spent?.external_calls ?? 0,
    stopped: false,
    stop_reason: null,
    budget: resolved,
    receipt: createEngineReceipt({
      engine: 'execution-governor',
      mission_id,
      input_refs: [`calls:${resolved.max_tool_calls}`, `retries:${resolved.max_retries}`],
      output_refs: ['READY'],
      started_at: started,
      decision_count: 0,
      decision: 'READY',
    }),
  }
}

export function classifyAuthorityGate(tool: string): AuthorityGate {
  const cap = lookupCapability(tool)
  if (!cap) {
    return { class: 'PROHIBITED', execute: false, reason: 'capability is not in the registry' }
  }
  if (cap.financial || cap.production_mutation || cap.secret_access) {
    return { class: 'PROHIBITED', execute: false, reason: 'existing policy forbids this capability' }
  }
  if (cap.approval_required) {
    return { class: 'COMMANDER_REQUIRED', execute: false, reason: 'Commander approval required; execution waits' }
  }
  if (!cap.council_executable) {
    return { class: 'PROHIBITED', execute: false, reason: 'capability exists but is not Council-executable' }
  }
  if (cap.read_or_write === 'read') {
    return {
      class: cap.local_or_external === 'external' ? 'AUTO_ALLOWED' : 'READ_ONLY',
      execute: true,
      reason: 'read-only within existing authority',
    }
  }
  return { class: 'COMMANDER_REQUIRED', execute: false, reason: 'write path requires Commander authorization' }
}

/** Spec 7: no engine may upgrade COMMANDER_REQUIRED to AUTO_ALLOWED because a task "seems safe". */
export function maybeUpgradeAuthority(gate: AuthorityGate, _seemsSafe: boolean): AuthorityGate {
  void _seemsSafe
  if (gate.class === 'COMMANDER_REQUIRED' || gate.class === 'PROHIBITED') return gate
  return gate
}

export function governorAllowsDispatch(state: ExecutionGovernorState, kind: 'new' | 'retry' = 'new'): { ok: boolean; reason: string } {
  if (state.stopped) return { ok: false, reason: state.stop_reason || 'governor stopped' }
  if (state.tool_calls >= state.budget.max_tool_calls) return { ok: false, reason: 'mission tool-call budget reached' }
  if (kind === 'retry' && state.retry_count >= state.budget.max_retries) return { ok: false, reason: 'retry budget reached' }
  if (state.latency_ms >= state.budget.max_ms) return { ok: false, reason: 'mission time budget reached' }
  return { ok: true, reason: 'within budget' }
}

export function recordDispatch(state: ExecutionGovernorState, input: {
  duration_ms: number
  retry: boolean
  local_model: boolean
  external: boolean
  mission_id: string
}): ExecutionGovernorState {
  const tool_calls = state.tool_calls + 1
  const retry_count = state.retry_count + (input.retry ? 1 : 0)
  const latency_ms = state.latency_ms + input.duration_ms
  const local_model_calls = state.local_model_calls + (input.local_model ? 1 : 0)
  const external_calls = state.external_calls + (input.external ? 1 : 0)
  const hit = tool_calls >= state.budget.max_tool_calls || latency_ms >= state.budget.max_ms
  return {
    ...state,
    tool_calls,
    retry_count,
    latency_ms,
    local_model_calls,
    external_calls,
    stopped: hit,
    stop_reason: hit ? 'mission budget reached' : state.stop_reason,
    receipt: createEngineReceipt({
      engine: 'execution-governor',
      mission_id: input.mission_id,
      input_refs: state.receipt.input_refs,
      output_refs: [`calls:${tool_calls}`, `retries:${retry_count}`],
      started_at: Date.now() - latency_ms,
      decision_count: tool_calls,
      decision: hit ? 'STOP' : 'CONTINUE',
      failure_state: hit ? 'budget_exhausted' : 'none',
    }),
  }
}

export function stopGovernor(state: ExecutionGovernorState, reason: string, mission_id: string): ExecutionGovernorState {
  return {
    ...state,
    stopped: true,
    stop_reason: reason,
    receipt: createEngineReceipt({
      engine: 'execution-governor',
      mission_id,
      input_refs: state.receipt.input_refs,
      output_refs: [reason],
      started_at: Date.now(),
      decision_count: state.tool_calls,
      decision: 'STOP',
    }),
  }
}

export function authorityClassFromGate(gate: AuthorityGate): AuthorityGateClass {
  return gate.class
}
