import { WRIM0_CHECKPOINT_SHA, WRIM0_ID, WR_TOKENIZER_0_SHA, type CapabilityModuleRecord, type CapabilityModuleType } from './types'

export function buildCapabilityModuleRecord(args: {
  capability_id: string
  module_id: string
  module_type: CapabilityModuleType
  version?: string
  eval_identity?: string | null
  training_dataset_identity?: string | null
  artifact_hash?: string | null
  test_only?: boolean
}): CapabilityModuleRecord {
  return {
    capability_id: args.capability_id,
    module_id: args.module_id,
    version: args.version ?? '1.0.0',
    module_type: args.module_type,
    base_model_id: WRIM0_ID,
    base_checkpoint_sha: WRIM0_CHECKPOINT_SHA,
    tokenizer_sha: WR_TOKENIZER_0_SHA,
    artifact_hash: args.artifact_hash ?? null,
    training_dataset_identity: args.training_dataset_identity ?? null,
    held_out_eval_identity: args.eval_identity ?? null,
    status: 'DESIGN',
    metrics: {},
    promotion_history: [],
    compatibility: {
      architecture_id: 'WRIM-G-20M-v1-option-A',
      d_model: 256,
      n_layers: 18,
    },
    test_only: args.test_only ?? true,
  }
}

export function supportedModuleTypes(): CapabilityModuleType[] {
  return ['LORA', 'ADAPTER', 'CLASSIFIER_HEAD', 'ROUTER_HEAD']
}
