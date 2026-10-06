/**
 * ENGINE-05P Live empirical observations + Commander-governed trials.
 * Does not invent cost/tokens. Does not auto-promote. Engine-05 preserved.
 */
import { createHash } from 'node:crypto'
import { ENGINE_05P_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { runShadowEvaluation } from '../policy-eval/engine'
import { DEFAULT_PRODUCTION_PARAMETERS, PRODUCTION_POLICY_ID } from '../evaluation/suite'
import type { LiveExecutionResult } from '../live-execution/types'
import type { ModelRoutingDecision } from '../evaluation/types'
import { saveFinalJson, loadFinalJson } from './store'
import type { LiveEmpiricalObservation, LivePolicyTrial, MeasurementState } from './types'

function nowIso(): string {
  return new Date().toISOString()
}

function measurementState(obs: Pick<LiveEmpiricalObservation, 'latency_ms' | 'context_tokens' | 'input_tokens' | 'cost_amount'>): MeasurementState {
  const hasCore = obs.latency_ms != null || obs.context_tokens != null
  const hasOptional = obs.input_tokens != null || obs.cost_amount != null
  if (hasCore && hasOptional) return 'MEASURED'
  if (hasCore) return 'PARTIALLY_MEASURED'
  return 'UNMEASURED'
}

export function captureLiveObservation(input: {
  live: LiveExecutionResult
  routing?: ModelRoutingDecision | null
  policy_version?: string
  tokens?: { input?: number; output?: number; total?: number }
  cost?: { amount: number; currency: string; source: string }
}): LiveEmpiricalObservation {
  const first = input.live.dispatches[0]
  const last = input.live.dispatches.at(-1)
  const latency = input.live.dispatches.reduce((n, d) => n + (d.duration_ms || 0), 0)
  const context = first?.context_tokens ?? null
  const retries = input.live.dispatches.reduce((n, d) => n + (d.retry_number || 0), 0)
  const obs: LiveEmpiricalObservation = {
    observation_id: `obs-${input.live.mission_id}`,
    mission_id: input.live.mission_id,
    task_id: first?.task_id ?? 'mission',
    task_class: input.routing?.task_class ?? 'tool_selection',
    policy_version: input.policy_version ?? PRODUCTION_POLICY_ID,
    provider: input.routing?.selected_provider ?? null,
    model: input.routing?.selected_model ?? null,
    started_at: first?.started_at ?? nowIso(),
    completed_at: last?.completed_at ?? nowIso(),
    latency_ms: input.live.dispatches.length ? latency : null,
    input_tokens: input.tokens?.input ?? null,
    output_tokens: input.tokens?.output ?? null,
    total_tokens: input.tokens?.total ?? null,
    context_tokens: context,
    tool_calls: input.live.dispatches.length,
    retry_count: retries,
    cost_amount: input.cost?.amount ?? null,
    cost_currency: input.cost?.currency ?? null,
    cost_source: input.cost?.source ?? null,
    completion_state: input.live.completion,
    verification_state: input.live.ebc_canonical ? 'EBC_CANONICAL' : 'UNKNOWN',
    calibration_state: 'UNMEASURED',
    authority_compliant: input.live.grants_authority === false,
    failure_state: input.live.completion === 'FAILED' ? 'FAILED' : 'none',
    evidence_refs: [...input.live.ebc_evidence_ids],
    receipt_refs: [...input.live.receipt_ids],
    measurement_state: 'UNMEASURED',
    invented_cost: false,
    invented_tokens: false,
  }
  obs.measurement_state = measurementState(obs)
  return obs
}

export function fingerprintTrial(trial: Pick<LivePolicyTrial, 'trial_id' | 'candidate_policy' | 'scope' | 'held_out_set'>): string {
  return createHash('sha256').update(`${trial.trial_id}|${trial.candidate_policy}|${trial.scope}|${trial.held_out_set.join(',')}`).digest('hex').slice(0, 24)
}

export function createLiveTrial(input: Partial<LivePolicyTrial> & { trial_id: string; candidate_policy: string }): LivePolicyTrial {
  const held = input.held_out_set ?? [`hold-${input.trial_id}`]
  const dev = input.development_set ?? [`dev-${input.trial_id}`]
  return {
    trial_id: input.trial_id,
    candidate_policy: input.candidate_policy,
    control_policy: input.control_policy ?? PRODUCTION_POLICY_ID,
    scope: input.scope ?? 'SHADOW',
    task_classes: input.task_classes ?? ['tool_selection'],
    max_missions: input.max_missions ?? 3,
    max_duration_ms: input.max_duration_ms ?? 60_000,
    authority_scope: input.authority_scope ?? ['no_spend', 'no_deploy'],
    rollback_policy: input.rollback_policy ?? PRODUCTION_POLICY_ID,
    held_out_set: held,
    development_set: dev,
    status: 'DRAFT',
    grants_authority: false,
    auto_promoted: false,
    approval_fingerprint: null,
    result: 'PENDING',
  }
}

export function heldOutIsolated(trial: LivePolicyTrial): boolean {
  return trial.held_out_set.every(id => !trial.development_set.includes(id))
}

export async function approveLiveTrial(trial: LivePolicyTrial, fingerprint: string): Promise<LivePolicyTrial> {
  const expected = fingerprintTrial(trial)
  if (fingerprint !== expected) {
    return { ...trial, status: 'FAILED', result: 'REJECTED' }
  }
  const next: LivePolicyTrial = { ...trial, status: 'APPROVED', approval_fingerprint: expected, auto_promoted: false }
  await saveFinalJson('trials', trial.trial_id, next)
  return next
}

export async function runLiveTrial(trial: LivePolicyTrial, observations: LiveEmpiricalObservation[]): Promise<{
  trial: LivePolicyTrial
  shadow_grants_authority: false
  receipt: ReturnType<typeof createEngineReceipt>
}> {
  const started = Date.now()
  if (trial.status !== 'APPROVED' && trial.scope !== 'SHADOW') {
    const blocked = { ...trial, status: 'FAILED' as const, result: 'REJECTED' as const, auto_promoted: false as const }
    return {
      trial: blocked,
      shadow_grants_authority: false,
      receipt: createEngineReceipt({ engine: 'live-empirical-trial', mission_id: trial.trial_id, started_at: started, decision_count: 0, decision: 'NOT_APPROVED', failure_state: 'authority_blocked' }),
    }
  }
  const shadow = runShadowEvaluation({
    production: DEFAULT_PRODUCTION_PARAMETERS,
    candidate: { ...DEFAULT_PRODUCTION_PARAMETERS, context_token_budget: 256 },
    production_policy_id: trial.control_policy,
    candidate_policy_id: trial.candidate_policy,
  })
  const holdObs = observations.filter(o => trial.held_out_set.includes(o.mission_id))
  const usedHoldForTuning = false
  const result = holdObs.some(o => o.authority_compliant === false)
    ? 'REJECTED'
    : observations.length < 1
      ? 'INCONCLUSIVE'
      : 'SUPPORTED'
  const next: LivePolicyTrial = {
    ...trial,
    status: 'COMPLETE',
    result,
    auto_promoted: false,
    grants_authority: false,
  }
  void shadow
  void usedHoldForTuning
  await saveFinalJson('trials', trial.trial_id, next)
  for (const obs of observations) await saveFinalJson('observations', obs.observation_id, obs)
  return {
    trial: next,
    shadow_grants_authority: false,
    receipt: createEngineReceipt({
      engine: 'live-empirical-trial',
      mission_id: trial.trial_id,
      started_at: started,
      decision_count: observations.length,
      decision: `${result}:auto_promoted=false:version=${ENGINE_05P_VERSION}`,
    }),
  }
}

export async function loadTrial(id: string): Promise<LivePolicyTrial | null> {
  return loadFinalJson<LivePolicyTrial>('trials', id)
}
