/**
 * Council ENGINE-01 shared contracts.
 * Typed engine layer under existing Council. Not a second Council.
 */
export const ENGINE_01_VERSION = 'council-engine-01.v1' as const
export const ENGINE_01_POLICY_VERSION = 'researchPolicy+researchDiscovery+ebc-verify.v1' as const

export const ENGINE_02_VERSION = 'council-engine-02.v1' as const
export const ENGINE_02_POLICY_VERSION = 'toolValue+atlas+contextPacket+receipts+adaptive.v1' as const

export const ENGINE_03_VERSION = 'council-engine-03.v1' as const
export const ENGINE_03_POLICY_VERSION = 'dispatch+live-execution+wave+governor.v1' as const

export const ENGINE_04_VERSION = 'council-engine-04.v1' as const
export const ENGINE_04_POLICY_VERSION = 'long-horizon+checkpoint+memory-retrieval+temporal-world.v1' as const

export const ENGINE_05_VERSION = 'council-engine-05.v1' as const
export const ENGINE_05_POLICY_VERSION = 'benchmark+policy-eval+routing+counterfactual+promotion.v1' as const

export const ENGINE_05P_VERSION = 'council-engine-05p.v1' as const
export const ENGINE_06_VERSION = 'council-engine-06.v1' as const
export const ENGINE_07_VERSION = 'council-engine-07.v1' as const
export const ENGINE_08_VERSION = 'council-engine-08.v1' as const
export const ENGINE_09_VERSION = 'council-engine-09.v1' as const
export const ENGINE_10_VERSION = 'council-engine-10.v1' as const
export const ENGINE_11_VERSION = 'council-engine-11.v1' as const
export const ENGINE_12_VERSION = 'council-engine-12.v1' as const
export const ENGINE_COMPLETE_VERSION = 'council-complete.v1' as const

export const ENGINE_IDS = [
  'research-discovery',
  'source-authority',
  'evidence-binding',
  'calibration',
  'tool-selection',
  'hierarchical-planning',
  'context-compiler',
  'failure-diagnosis',
  'live-execution',
  'war-room-dispatch',
  'parallel-wave',
  'execution-governor',
  'long-horizon-mission',
  'mission-checkpoint',
  'memory-retrieval',
  'temporal-world-state',
  'capability-benchmark',
  'policy-evaluation',
  'model-provider-routing',
  'counterfactual-mission',
  'policy-promotion',
  'live-empirical-trial',
  'world-model',
  'deliberation',
  'mission-portfolio',
  'watch-condition',
  'trust-boundary',
  'approval-broker',
  'council-graduation',
] as const
export type EngineId = (typeof ENGINE_IDS)[number]

export type EngineFailureState =
  | 'none'
  | 'input_invalid'
  | 'no_candidates'
  | 'no_usable_evidence'
  | 'conflict_open'
  | 'no_tool_required'
  | 'tool_unhealthy'
  | 'budget_exhausted'
  | 'authority_blocked'
  | 'uncertain_diagnosis'
  | 'waiting_authority'
  | 'dispatch_failed'
  | 'skipped'

export type EngineReceipt = {
  engine: EngineId
  version:
    | typeof ENGINE_01_VERSION
    | typeof ENGINE_02_VERSION
    | typeof ENGINE_03_VERSION
    | typeof ENGINE_04_VERSION
    | typeof ENGINE_05_VERSION
    | typeof ENGINE_05P_VERSION
    | typeof ENGINE_06_VERSION
    | typeof ENGINE_07_VERSION
    | typeof ENGINE_08_VERSION
    | typeof ENGINE_09_VERSION
    | typeof ENGINE_10_VERSION
    | typeof ENGINE_11_VERSION
    | typeof ENGINE_12_VERSION
  policy_version: string
  mission_id: string
  task_id?: string
  input_refs: string[]
  output_refs: string[]
  duration_ms: number
  decision_count: number
  decision?: string
  failure_state: EngineFailureState
}

export type StopConditionState =
  | 'CONTINUE'
  | 'EVIDENCE_REQUIREMENT_SATISFIED'
  | 'CANDIDATE_BUDGET_EXHAUSTED'
  | 'NO_INFORMATION_GAIN'
  | 'PRIMARY_PLUS_CORROBORATION'
  | 'TOOL_BUDGET_EXHAUSTED'

export type ToolEconomyHints = {
  expected_information_gain_hint: 'high' | 'moderate' | 'low' | 'none'
  remaining_evidence_gap: string[]
  stop_condition_state: StopConditionState
}
