/**
 * Canonical WRIM observability event schema.
 * Adapters consume these events. Training scripts must not call Aim/TB/MLflow directly.
 */
import { UNKNOWN_METRIC } from './labIdentity'

export const WRIM_EVENT_TYPES = [
  'RUN_STARTED',
  'RUN_CONFIG',
  'STEP_COMPLETED',
  'EVAL_COMPLETED',
  'CHECKPOINT_SAVED',
  'STOP_POLICY_DECISION',
  'RUN_STOPPED',
  'RUN_FAILED',
] as const
export type WrimEventType = (typeof WRIM_EVENT_TYPES)[number]

export const PER_STEP_METRIC_KEYS = [
  'pre_clip_gradient_norm',
  'post_clip_gradient_norm',
  'was_clipped',
  'clipping_ratio',
  'lr',
  'train_loss',
  'update_norm',
  'parameter_norm',
  'update_weight_ratio',
  'cumulative_lr_exposure',
  'gpu_allocated_memory',
  'gpu_reserved_memory',
  'dnll',
  'kl',
  'val0',
  'val1',
  'looping',
  'unique128',
  'unique256',
  'coherence',
  'tokens_seen',
  'optimizer_step',
  'gpu_memory',
  'stop_policy_state',
  'ce_stream_loss',
  'retention_term_loss',
  'lambda',
  'stream_position',
  'eval_seed',
  'item_max_dnll',
] as const
export type PerStepMetricKey = (typeof PER_STEP_METRIC_KEYS)[number]

export const PER_CHECKPOINT_METRIC_KEYS = [
  'layerwise_parameter_displacement',
  'embedding_displacement',
  'attention_displacement',
  'mlp_displacement',
  'rmsnorm_displacement',
  'retention_anchor_breakdown',
  'family_specific_nll',
  'family_specific_kl',
  'family_specific_delta_nll',
  'item_max_dnll',
  'looping',
  'unique128',
  'unique256',
  'coherence',
  'generation_samples',
  'generation_sample_ids',
] as const
export type PerCheckpointMetricKey = (typeof PER_CHECKPOINT_METRIC_KEYS)[number]

export type MetricValue = number | boolean | string | null

export type WrimObservabilityEvent = {
  event_type: WrimEventType
  run_id: string
  model_id: string
  parent_hash: string
  stream_sha: string
  recipe_sha: string
  tokenizer_hash: string
  optimizer_step: number | typeof UNKNOWN_METRIC
  tokens_seen: number | typeof UNKNOWN_METRIC
  timestamp: string
  hardware_id: string
  metric_name?: string
  metric_value?: MetricValue
  metric_unit?: string
  metrics?: Record<string, MetricValue>
  metric_units?: Record<string, string>
  import_class?: 'LIVE' | 'IMPORTED_HISTORICAL'
  eval_lane?: 'SOVEREIGN_EVAL' | 'EXTERNAL_STANDARD_EVAL'
  lifecycle_state?: string
  payload_ref?: string
}

export function unknownIfMissing(value: MetricValue | undefined): MetricValue {
  if (value === undefined || value === null || value === '') return UNKNOWN_METRIC
  return value
}
