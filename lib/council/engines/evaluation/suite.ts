import { ENGINE_04_POLICY_VERSION, ENGINE_05_POLICY_VERSION } from '../types'
import type { BenchmarkCase, BenchmarkSuite, PolicyParameters } from './types'
import { ENGINE05_SUITE_VERSION } from './types'

export const PRODUCTION_POLICY_ID = 'production-engine-04' as const
export const PRODUCTION_POLICY_VERSION = ENGINE_04_POLICY_VERSION

export const DEFAULT_PRODUCTION_PARAMETERS: PolicyParameters = Object.freeze({
  prefer_independent_primary: true,
  max_parallel: 3,
  context_token_budget: 512,
  retry_transient: true,
  memory_first: true,
  privacy: 'CLOUD_OK',
  routing_task_specific: true,
})

function c(
  case_id: string,
  task_class: BenchmarkCase['task_class'],
  partition: BenchmarkCase['partition'],
  extra?: Partial<BenchmarkCase>,
): BenchmarkCase {
  return {
    case_id,
    task_class,
    input: extra?.input ?? { prompt: case_id },
    expected_constraints: extra?.expected_constraints ?? ['fixture'],
    required_evidence: extra?.required_evidence ?? [],
    authority_constraints: extra?.authority_constraints ?? ['no_spend', 'no_deploy'],
    freshness_requirement: extra?.freshness_requirement ?? null,
    evaluation_method: extra?.evaluation_method ?? 'DETERMINISTIC_ENGINE',
    baseline_refs: extra?.baseline_refs ?? [PRODUCTION_POLICY_ID],
    ground_truth_refs: extra?.ground_truth_refs ?? [],
    difficulty: extra?.difficulty ?? 'LOW',
    tags: extra?.tags ?? [task_class],
    partition,
  }
}

export const ENGINE05_CORE_SUITE: BenchmarkSuite = Object.freeze({
  suite_id: 'engine05-core',
  version: ENGINE05_SUITE_VERSION,
  cases: [
    c('dev-research', 'research_discovery', 'development', { required_evidence: ['primary_source'] }),
    c('dev-authority', 'source_authority', 'development'),
    c('dev-freshness', 'freshness', 'development', { freshness_requirement: 'current_live_window' }),
    c('dev-verify', 'claim_verification', 'development', { required_evidence: ['evidence_ref'] }),
    c('dev-contradiction', 'contradiction_handling', 'development'),
    c('dev-tools', 'tool_selection', 'development'),
    c('dev-plan', 'planning', 'development'),
    c('dev-parallel', 'parallel_execution', 'development'),
    c('dev-context', 'context_compilation', 'development'),
    c('dev-fail', 'failure_diagnosis', 'development'),
    c('dev-restart', 'restart_recovery', 'development'),
    c('dev-memory', 'memory_retrieval', 'development'),
    c('dev-temporal', 'temporal_reasoning', 'development'),
    c('dev-route', 'provider_model_reasoning', 'development'),
    c('dev-struct', 'structured_output', 'development'),
    c('dev-code', 'code_reasoning', 'development'),
    c('val-tools', 'tool_selection', 'validation'),
    c('val-context', 'context_compilation', 'validation'),
    c('val-route', 'provider_model_reasoning', 'validation'),
    c('hold-tools', 'tool_selection', 'held_out'),
    c('hold-verify', 'claim_verification', 'held_out'),
    c('hold-privacy', 'provider_model_reasoning', 'held_out', { authority_constraints: ['privacy_local'] }),
  ],
})

export function casesFor(suite: BenchmarkSuite, partition: BenchmarkCase['partition']): BenchmarkCase[] {
  return suite.cases.filter(row => row.partition === partition)
}

export function productionPolicyHash(): string {
  return `${PRODUCTION_POLICY_ID}:${PRODUCTION_POLICY_VERSION}:${ENGINE_05_POLICY_VERSION}`
}
