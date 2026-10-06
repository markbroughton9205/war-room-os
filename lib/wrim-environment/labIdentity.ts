/**
 * #23 WRIM sovereign model laboratory — bounded roles inside the existing WRIM environment.
 * Not WRIMLab2. TRAINING_AUTHORIZATION remains OFF. No promotion authority.
 */
import { WRIM_LAB_BIND, WRIM_LAB_PORTS } from './labPorts'

export const WRIM_SOVEREIGN_LAB_ID = 'WRIM-SOVEREIGN-MODEL-LAB' as const
export const WRIM_SOVEREIGN_LAB_RUNTIME = 'wrim-sovereign-lab-v1' as const
export const OBSERVABILITY_STANDARD = 'OBSERVABILITY_STANDARD' as const
export const OBSERVABILITY_DIAGNOSTIC = 'OBSERVABILITY_DIAGNOSTIC' as const
export const IMPORT_CLASS_HISTORICAL = 'IMPORTED_HISTORICAL' as const
export const UNKNOWN_METRIC = 'UNKNOWN' as const
export const SOVEREIGN_EVAL_LANE = 'SOVEREIGN_EVAL' as const
export const EXTERNAL_STANDARD_EVAL_LANE = 'EXTERNAL_STANDARD_EVAL' as const

export const WRIM_LAB_ROLES = {
  aim: 'PRIMARY_WRIM_EXPERIMENT_EXPLORER',
  tensorboard: 'LOW_LEVEL_LIVE_TRAINING_CURVES_HISTOGRAMS',
  pytorch_profiler: 'ON_DEMAND_TRAINING_PERFORMANCE_MEMORY',
  dvc: 'LARGE_ARTIFACT_DATA_LINEAGE',
  safetensors: 'SAFE_FUTURE_WRIM_WEIGHT_SERIALIZATION',
  duckdb: 'LOCAL_WRIM_ANALYTICS_WAREHOUSE',
  lm_eval_harness: 'EXTERNAL_STANDARDIZED_BENCHMARK_LANE',
  mlflow: 'WRIM_RUN_MODEL_LIFECYCLE_REGISTRY',
  prometheus: 'LONG_RUN_MACHINE_SERVICE_TELEMETRY',
} as const

export const MLFLOW_LIFECYCLE_STATES = [
  'DIAGNOSTIC',
  'REJECTED',
  'STOPPED_BY_POLICY',
  'ANALYSIS_ONLY',
  'PROMOTION_CANDIDATE',
  'PRODUCTION',
] as const
export type MlflowLifecycleState = (typeof MLFLOW_LIFECYCLE_STATES)[number]

export const WRIM_LAB_CANNOT = {
  aim: 'NOT_AUTHORITY',
  tensorboard: 'NOT_AUTHORITY',
  mlflow: 'NOT_PROMOTION_AUTHORITY',
  lm_eval_harness: 'CANNOT_PROMOTE_MODEL',
  prometheus: 'CANNOT_CONTROL_TRAINING',
  dvc: 'CANNOT_DELETE_ORIGINALS',
  safetensors: 'CANNOT_OVERWRITE_HISTORICAL',
} as const

export const PROFILE_STEPS_DEFAULT = { min: 2, max: 4 } as const
export const HISTOGRAM_CADENCE_STEPS = 50 as const

export const VERIFIED_TOOLS = {
  aim: {
    official_repository: 'https://github.com/aimhubio/aim',
    latest_release: 'v3.29.1',
    license: 'Apache-2.0',
    windows_badge: 'Linux|macOS official; Windows attempted locally',
    telemetry: 'removed in 3.29',
    local_only: true,
  },
  tensorboard: {
    official_repository: 'https://github.com/tensorflow/tensorboard',
    latest_release: '2.21.0',
    license: 'Apache-2.0',
    windows: true,
    telemetry: 'none required; bind localhost',
    local_only: true,
  },
  pytorch: {
    official_repository: 'https://github.com/pytorch/pytorch',
    installed: '2.13.0+cu130',
    license: 'BSD-style (PyTorch LICENSE)',
    profiler: 'torch.profiler on-demand',
    local_only: true,
  },
  dvc: {
    official_repository: 'https://github.com/iterative/dvc',
    latest_release: '3.67.1',
    license: 'Apache-2.0',
    telemetry: 'anonymized analytics DEFAULT ON; disable DVC_NO_ANALYTICS=1 and core.analytics=false',
    local_only: true,
  },
  safetensors: {
    official_repository: 'https://github.com/huggingface/safetensors',
    installed: '0.8.0',
    license: 'Apache-2.0',
    local_only: true,
  },
  duckdb: {
    official_repository: 'https://github.com/duckdb/duckdb',
    latest_release: '1.5.5',
    license: 'MIT',
    motherduck: 'MUST_REMAIN_DISABLED',
    local_only: true,
  },
  lm_eval_harness: {
    official_repository: 'https://github.com/EleutherAI/lm-evaluation-harness',
    latest_release: 'v0.4.13',
    license: 'MIT',
    role: 'EXTERNAL_COMPARISON_ONLY',
    local_only: true,
  },
  mlflow: {
    official_repository: 'https://github.com/mlflow/mlflow',
    latest_release: '3.15.0',
    license: 'Apache-2.0',
    telemetry: 'DEFAULT ON since 3.2.0; disable MLFLOW_DISABLE_TELEMETRY=true and DO_NOT_TRACK=true',
    local_only: true,
  },
  prometheus: {
    official_repository: 'https://github.com/prometheus/prometheus',
    latest_release: 'v3.14.0',
    license: 'Apache-2.0',
    windows_binary: true,
    local_only: true,
  },
} as const

export const LM_HARNESS_STARTER_TASKS = [
  {
    task: 'wikitext',
    why: 'Perplexity-style external comparison historically used for small LMs.',
    expected_for_19m: 'HIGH_PERPLEXITY_NOT_COMPETITIVE',
  },
  {
    task: 'lambada_openai',
    why: 'Documents the capability gap; a 19.2M decoder is expected near chance.',
    expected_for_19m: 'NEAR_CHANCE',
  },
] as const

export const LM_HARNESS_EXCLUDED_THIS_PASS = [
  'mmlu',
  'hellaswag',
  'gsm8k',
  'bigbench',
  'arc_challenge',
] as const

export { WRIM_LAB_BIND, WRIM_LAB_PORTS }
