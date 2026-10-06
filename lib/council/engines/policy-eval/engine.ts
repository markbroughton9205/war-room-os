/**
 * ENGINE-05B PolicyEvaluationEngine
 * Evaluates policy candidates without promoting them. Shadow grants no authority.
 */
import { ENGINE_05_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { selectTool } from '../tool-selection/engine'
import { compileContext } from '../context-compiler/engine'
import { runCapabilityBenchmark } from '../benchmark/engine'
import { hashCanonical, savePolicy, savePolicyEval } from '../evaluation/store'
import { casesFor, ENGINE05_CORE_SUITE, PRODUCTION_POLICY_ID } from '../evaluation/suite'
import { sampleIsAnecdote } from '../evaluation/principles'
import type {
  EmpiricalPolicyCandidate,
  PolicyEvaluationResult,
  PolicyHypothesis,
  PolicyParameters,
  ShadowEvaluation,
} from '../evaluation/types'
import { EMPIRICAL_POLICY_SCHEMA } from '../evaluation/types'

export function requireHypothesis(h: PolicyHypothesis): { ok: boolean; reason: string } {
  if (!h.proposed_change) return { ok: false, reason: 'missing proposed_change' }
  if (!h.why_might_help) return { ok: false, reason: 'missing why_might_help' }
  if (!h.metric_should_improve.length) return { ok: false, reason: 'missing metric_should_improve' }
  if (!h.must_not_regress.length) return { ok: false, reason: 'missing must_not_regress' }
  if (!h.falsifier) return { ok: false, reason: 'missing falsifier' }
  return { ok: true, reason: 'ok' }
}

export function createPolicyCandidate(input: {
  policy_id: string
  policy_family: EmpiricalPolicyCandidate['policy_family']
  version: string
  source: string
  hypothesis: PolicyHypothesis
  changed_parameters: PolicyParameters
  baseline_policy?: string
  evaluation_suite?: string
}): EmpiricalPolicyCandidate {
  const hyp = requireHypothesis(input.hypothesis)
  if (!hyp.ok) throw new Error(hyp.reason)
  return {
    schema: EMPIRICAL_POLICY_SCHEMA,
    policy_id: input.policy_id,
    policy_family: input.policy_family,
    version: input.version,
    created_at: new Date().toISOString(),
    source: input.source,
    hypothesis: input.hypothesis,
    changed_parameters: input.changed_parameters,
    baseline_policy: input.baseline_policy ?? PRODUCTION_POLICY_ID,
    evaluation_suite: input.evaluation_suite ?? ENGINE05_CORE_SUITE.suite_id,
    status: 'DRAFT',
    applies_automatically: false,
    grants_authority: false,
    trains_wrim: false,
    approval_fingerprint: null,
    rollback_target: null,
  }
}

export function runShadowEvaluation(input: {
  production: PolicyParameters
  candidate: PolicyParameters
  production_policy_id: string
  candidate_policy_id: string
}): ShadowEvaluation {
  const prodTool = selectTool({
    mission_id: 'shadow-prod',
    objective: 'shadow production',
    remaining_evidence_gap: ['runtime health of 3847'],
    available_tools: ['system.health', 'research.web'],
  })
  const candTool = selectTool({
    mission_id: 'shadow-cand',
    objective: 'shadow candidate',
    remaining_evidence_gap: input.candidate.prefer_independent_primary
      ? ['independent primary evidence for claim']
      : ['runtime health of 3847'],
    available_tools: ['system.health', 'research.web'],
  })
  const prodCtx = compileContext({
    mission_id: 'shadow-prod',
    role: 'AURORA',
    objective: 'shadow production',
    task_objective: 'compile',
    token_budget: input.production.context_token_budget,
    verified_facts: [{ text: 'fact', evidence_ref: 'e1', state: 'VERIFIED', mission_id: 'shadow-prod' }],
  })
  const candCtx = compileContext({
    mission_id: 'shadow-cand',
    role: 'AURORA',
    objective: 'shadow candidate',
    task_objective: 'compile',
    token_budget: input.candidate.context_token_budget,
    verified_facts: [{ text: 'fact', evidence_ref: 'e1', state: 'VERIFIED', mission_id: 'shadow-cand' }],
  })
  return {
    production_policy_id: input.production_policy_id,
    candidate_policy_id: input.candidate_policy_id,
    grants_authority: false,
    production_controls_execution: true,
    compared: {
      selected_tools: { production: [prodTool.selected_tool ?? 'none'], candidate: [candTool.selected_tool ?? 'none'] },
      plan: { production: `max_parallel=${input.production.max_parallel}`, candidate: `max_parallel=${input.candidate.max_parallel}` },
      context_tokens: { production: prodCtx.tokens_used, candidate: candCtx.tokens_used },
      expected_work: { production: ['production_execute'], candidate: ['shadow_score_only'] },
    },
    counterfactual_estimates_kind: 'ESTIMATED',
  }
}

function passRate(run: { cases: { correctness_signal: string }[] }): number {
  const scored = run.cases.filter(c => c.correctness_signal === 'PASS' || c.correctness_signal === 'FAIL')
  if (!scored.length) return 0
  return scored.filter(c => c.correctness_signal === 'PASS').length / scored.length
}

function authorityViolations(run: { cases: { authority_violations: number }[] }): number {
  return run.cases.reduce((n, c) => n + c.authority_violations, 0)
}

export async function evaluatePolicy(input: {
  mission_id: string
  candidate: EmpiricalPolicyCandidate
  baseline_params: PolicyParameters | null
  persist?: boolean
}): Promise<PolicyEvaluationResult> {
  const started = Date.now()
  const hyp = requireHypothesis(input.candidate.hypothesis)
  if (!hyp.ok) {
    const blocked: PolicyEvaluationResult = {
      schema: 'war-room.policy-evaluation.v1',
      evaluation_id: `peval-${input.mission_id}-${started}`,
      candidate: { ...input.candidate, status: 'REJECTED' },
      baseline_policy: input.baseline_params ? input.candidate.baseline_policy : 'BASELINE_UNAVAILABLE',
      suite_id: ENGINE05_CORE_SUITE.suite_id,
      development: null,
      validation: null,
      held_out: null,
      shadow: null,
      comparable_ab: false,
      sample_count: 0,
      overfit: false,
      authority_regression: false,
      truth_regression: false,
      safety_regression: false,
      result: 'REJECTED',
      limitations: [hyp.reason],
      grants_authority: false,
      auto_promoted: false,
      receipt: createEngineReceipt({
        engine: 'policy-evaluation',
        mission_id: input.mission_id,
        started_at: started,
        decision_count: 0,
        decision: 'REJECTED_NO_HYPOTHESIS',
        failure_state: 'input_invalid',
      }),
    }
    return blocked
  }

  const baselineId = input.baseline_params ? input.candidate.baseline_policy : 'BASELINE_UNAVAILABLE' as const
  const development = await runCapabilityBenchmark({
    mission_id: `${input.mission_id}-dev`,
    candidate_policy_id: input.candidate.policy_id,
    candidate_params: input.candidate.changed_parameters,
    baseline_policy_id: baselineId,
    baseline_params: input.baseline_params,
    partition: 'development',
    persist: input.persist,
  })
  const validation = await runCapabilityBenchmark({
    mission_id: `${input.mission_id}-val`,
    candidate_policy_id: input.candidate.policy_id,
    candidate_params: input.candidate.changed_parameters,
    baseline_policy_id: baselineId,
    baseline_params: input.baseline_params,
    partition: 'validation',
    persist: input.persist,
  })
  const held_out = await runCapabilityBenchmark({
    mission_id: `${input.mission_id}-hold`,
    candidate_policy_id: input.candidate.policy_id,
    candidate_params: input.candidate.changed_parameters,
    baseline_policy_id: baselineId,
    baseline_params: input.baseline_params,
    partition: 'held_out',
    persist: input.persist,
  })

  let baselineDev = null as typeof development | null
  let baselineHold = null as typeof held_out | null
  if (input.baseline_params) {
    baselineDev = await runCapabilityBenchmark({
      mission_id: `${input.mission_id}-base-dev`,
      candidate_policy_id: PRODUCTION_POLICY_ID,
      candidate_params: input.baseline_params,
      baseline_policy_id: PRODUCTION_POLICY_ID,
      baseline_params: input.baseline_params,
      partition: 'development',
      persist: input.persist,
    })
    baselineHold = await runCapabilityBenchmark({
      mission_id: `${input.mission_id}-base-hold`,
      candidate_policy_id: PRODUCTION_POLICY_ID,
      candidate_params: input.baseline_params,
      baseline_policy_id: PRODUCTION_POLICY_ID,
      baseline_params: input.baseline_params,
      partition: 'held_out',
      persist: input.persist,
    })
  }

  const shadow = runShadowEvaluation({
    production: input.baseline_params ?? input.candidate.changed_parameters,
    candidate: input.candidate.changed_parameters,
    production_policy_id: String(baselineId),
    candidate_policy_id: input.candidate.policy_id,
  })

  const sample_count = development.cases.length + validation.cases.length + held_out.cases.length
  const authority_regression = authorityViolations(development) + authorityViolations(validation) + authorityViolations(held_out) > 0
  const truth_regression = [...development.cases, ...validation.cases, ...held_out.cases].some(c =>
    c.evidence_sufficiency === 'MISSING' || c.verification_state === 'FAKE_VERIFIED',
  )
  const safety_regression = authority_regression
  const holdPrivacyFail = held_out.cases.some(c => c.case_id === 'hold-privacy' && c.correctness_signal === 'FAIL')
  const baselineHoldPrivacyPass = baselineHold?.cases.some(c => c.case_id === 'hold-privacy' && c.correctness_signal === 'PASS') ?? false
  const overfit = Boolean(
    baselineDev && baselineHold
    && passRate(development) >= passRate(baselineDev)
    && passRate(held_out) < passRate(baselineHold) - 0.05,
  ) || (holdPrivacyFail && baselineHoldPrivacyPass)

  const comparable_ab = casesFor(ENGINE05_CORE_SUITE, 'development').every(c => c.evaluation_method === 'DETERMINISTIC_ENGINE' || c.evaluation_method === 'FIXTURE')
  const anecdote = sampleIsAnecdote(sample_count, false)

  let result: PolicyEvaluationResult['result'] = 'INCONCLUSIVE'
  if (authority_regression || truth_regression || safety_regression || overfit) result = 'REJECTED'
  else if (anecdote || baselineId === 'BASELINE_UNAVAILABLE') result = 'MORE_EVIDENCE_REQUIRED'
  else if (passRate(development) >= 0.8 && passRate(held_out) >= 0.8) result = 'SUPPORTED'

  const candidate: EmpiricalPolicyCandidate = {
    ...input.candidate,
    status: result === 'SUPPORTED' ? 'SUPPORTED' : result === 'REJECTED' ? 'REJECTED' : 'INCONCLUSIVE',
  }

  const evaluation: PolicyEvaluationResult = {
    schema: 'war-room.policy-evaluation.v1',
    evaluation_id: `peval-${input.mission_id}-${started}`,
    candidate,
    baseline_policy: baselineId,
    suite_id: ENGINE05_CORE_SUITE.suite_id,
    development,
    validation,
    held_out,
    shadow,
    comparable_ab,
    sample_count,
    overfit,
    authority_regression,
    truth_regression,
    safety_regression,
    result,
    limitations: [
      overfit ? 'POLICY_OVERFIT' : '',
      baselineId === 'BASELINE_UNAVAILABLE' ? 'BASELINE_UNAVAILABLE' : '',
      'no_fake_significance',
      `suite_hash=${development.binding.suite_hash}`,
      `policy_hash=${hashCanonical(input.candidate.changed_parameters)}`,
    ].filter(Boolean),
    grants_authority: false,
    auto_promoted: false,
    receipt: createEngineReceipt({
      engine: 'policy-evaluation',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: sample_count,
      decision: result,
      output_refs: [evaluationIdSafe(started, input.mission_id)],
    }),
  }
  if (input.persist !== false) {
    await savePolicy(candidate)
    await savePolicyEval(evaluation)
  }
  return evaluation
}

function evaluationIdSafe(started: number, mission: string): string {
  return `peval-${mission}-${started}`
}

export function heldOutIsolated(evalResult: PolicyEvaluationResult): boolean {
  const held = new Set((evalResult.held_out?.cases ?? []).map(c => c.case_id))
  const dev = new Set((evalResult.development?.cases ?? []).map(c => c.case_id))
  for (const id of held) if (dev.has(id)) return false
  return true
}
