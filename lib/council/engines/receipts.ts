import type { EngineFailureState, EngineId, EngineReceipt } from './types'
import {
  ENGINE_01_POLICY_VERSION, ENGINE_01_VERSION,
  ENGINE_02_POLICY_VERSION, ENGINE_02_VERSION,
  ENGINE_03_POLICY_VERSION, ENGINE_03_VERSION,
  ENGINE_04_POLICY_VERSION, ENGINE_04_VERSION,
  ENGINE_05_POLICY_VERSION, ENGINE_05_VERSION,
  ENGINE_05P_VERSION, ENGINE_06_VERSION, ENGINE_07_VERSION, ENGINE_08_VERSION,
  ENGINE_09_VERSION, ENGINE_10_VERSION, ENGINE_11_VERSION, ENGINE_12_VERSION,
} from './types'

const ENGINE_VERSION: Partial<Record<EngineId, EngineReceipt['version']>> = {
  'live-empirical-trial': ENGINE_05P_VERSION,
  'world-model': ENGINE_06_VERSION,
  deliberation: ENGINE_07_VERSION,
  'mission-portfolio': ENGINE_08_VERSION,
  'watch-condition': ENGINE_09_VERSION,
  'trust-boundary': ENGINE_10_VERSION,
  'approval-broker': ENGINE_11_VERSION,
  'council-graduation': ENGINE_12_VERSION,
  'capability-benchmark': ENGINE_05_VERSION,
  'policy-evaluation': ENGINE_05_VERSION,
  'model-provider-routing': ENGINE_05_VERSION,
  'counterfactual-mission': ENGINE_05_VERSION,
  'policy-promotion': ENGINE_05_VERSION,
  'long-horizon-mission': ENGINE_04_VERSION,
  'mission-checkpoint': ENGINE_04_VERSION,
  'memory-retrieval': ENGINE_04_VERSION,
  'temporal-world-state': ENGINE_04_VERSION,
  'live-execution': ENGINE_03_VERSION,
  'war-room-dispatch': ENGINE_03_VERSION,
  'parallel-wave': ENGINE_03_VERSION,
  'execution-governor': ENGINE_03_VERSION,
  'tool-selection': ENGINE_02_VERSION,
  'hierarchical-planning': ENGINE_02_VERSION,
  'context-compiler': ENGINE_02_VERSION,
  'failure-diagnosis': ENGINE_02_VERSION,
}

const POLICY: Record<string, string> = {
  [ENGINE_05P_VERSION]: 'live-observation+bounded-trial.v1',
  [ENGINE_06_VERSION]: 'world-model+entity+causal.v1',
  [ENGINE_07_VERSION]: 'deliberation+adjudication+decision-quality.v1',
  [ENGINE_08_VERSION]: 'portfolio+priority+resource.v1',
  [ENGINE_09_VERSION]: 'watch+change-detection.v1',
  [ENGINE_10_VERSION]: 'trust-boundary+information-defense.v1',
  [ENGINE_11_VERSION]: 'explanation+approval-broker+manifest.v1',
  [ENGINE_12_VERSION]: 'graduation+soak+freeze.v1',
  [ENGINE_05_VERSION]: ENGINE_05_POLICY_VERSION,
  [ENGINE_04_VERSION]: 'long-horizon+checkpoint+memory-retrieval+temporal-world.v1',
  [ENGINE_03_VERSION]: 'dispatch+live-execution+wave+governor.v1',
  [ENGINE_02_VERSION]: 'toolValue+atlas+contextPacket+receipts+adaptive.v1',
  [ENGINE_01_VERSION]: ENGINE_01_POLICY_VERSION,
}

export function createEngineReceipt(input: {
  engine: EngineId
  mission_id: string
  task_id?: string
  input_refs?: readonly string[]
  output_refs?: readonly string[]
  started_at: number
  decision_count: number
  decision?: string
  failure_state?: EngineFailureState
  version?: EngineReceipt['version']
  policy_version?: string
}): EngineReceipt {
  const version = input.version ?? ENGINE_VERSION[input.engine] ?? ENGINE_01_VERSION
  return {
    engine: input.engine,
    version,
    policy_version: input.policy_version ?? POLICY[version] ?? ENGINE_01_POLICY_VERSION,
    mission_id: input.mission_id,
    task_id: input.task_id,
    input_refs: [...(input.input_refs ?? [])],
    output_refs: [...(input.output_refs ?? [])],
    duration_ms: Math.max(0, Date.now() - input.started_at),
    decision_count: input.decision_count,
    decision: input.decision,
    failure_state: input.failure_state ?? 'none',
  }
}
