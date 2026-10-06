/**
 * WRIM observability bus contract.
 * Python implements fan-out. TypeScript records the adapter set and isolation rule:
 * one backend failure must not stop WRIM instrumentation.
 */
export const WRIM_OBSERVABILITY_ADAPTERS = [
  'aim',
  'tensorboard',
  'mlflow',
  'duckdb',
  'prometheus',
] as const

export const WRIM_DIAGNOSTIC_ADAPTERS = ['pytorch_profiler'] as const
export const WRIM_ARTIFACT_LAYERS = ['dvc', 'safetensors'] as const
export const WRIM_EVAL_ADAPTERS = ['sovereign_wrim_eval', 'lm_eval_harness'] as const

export const OBSERVABILITY_FANOUT_RULE =
  'Each adapter is invoked independently. Failures are recorded. Remaining adapters continue.' as const

export function adapterIsolationOk(src: string): boolean {
  return src.includes('continue') && (src.includes('adapter_error') || src.includes('AdapterError') || src.includes('except Exception'))
}
