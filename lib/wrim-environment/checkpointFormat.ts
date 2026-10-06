/**
 * WRIM checkpoint format identities.
 * No symbol named WRIM_CHECKPOINT_FORMAT existed. V1 documents the live Nebula split.
 * V2 is the future weights+manifest format. Historical files are never overwritten.
 */
export const WRIM_CHECKPOINT_FORMAT_V1 = 'WRIM_CHECKPOINT_SPLIT_V1' as const
export const WRIM_CHECKPOINT_FORMAT_V2 = 'WRIM_CHECKPOINT_FORMAT_V2' as const

export const WRIM_CHECKPOINT_V1 = {
  id: WRIM_CHECKPOINT_FORMAT_V1,
  files: {
    weights: 'model.safetensors',
    optimizer: 'optimizer.safetensors (optional; absent on P2 steps 5-50)',
    meta: 'meta.json',
    rng: 'rng.json',
    scheduler: 'scheduler.json',
  },
  notes: 'Existing Nebula run layout. Historical WRIM-0 uses a combined model.* + opt.* safetensors file.',
} as const

export const WRIM_CHECKPOINT_V2 = {
  id: WRIM_CHECKPOINT_FORMAT_V2,
  files: {
    weights: 'model.safetensors',
    optimizer: 'optimizer.pt (PyTorch; not safetensors unless tensors-only)',
    rng: 'rng.json',
    scheduler: 'scheduler.json',
    manifest: 'checkpoint-manifest.json',
  },
  manifest_fields: [
    'format',
    'run_id',
    'optimizer_step',
    'tokens_seen',
    'weights_sha256',
    'tensors_sha256',
    'dtype_shape',
    'parent_hash',
    'recipe_sha',
    'stream_sha',
    'tokenizer_hash',
  ],
  rules: {
    no_destructive_historical_conversion: true,
    preserve_historical_readability: true,
    retain_sha256: true,
    verify_load_save_equality: true,
    separate_weights_from_optimizer_rng: true,
  },
} as const
