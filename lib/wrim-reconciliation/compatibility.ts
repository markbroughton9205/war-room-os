export type CompatibilityClass =
  | 'LOADABLE_AS_IS'
  | 'LOADABLE_AFTER_CONVERSION'
  | 'ARCHITECTURE_COMPATIBLE_BUT_RUNTIME_INCOMPATIBLE'
  | 'INCOMPATIBLE'
  | 'CORRUPT'
  | 'UNKNOWN'

export type CheckpointCompatibility = {
  id: string
  class: CompatibilityClass
  reason: string
  convert: string | null
}

export function classifyCheckpointCompatibility(opts: {
  wrim0HashMatch: boolean
  wrim0Embedding: number[] | null
  wrim1Embedding: number[] | null
  wrim0HasLmHead: boolean
  wrim1HasLmHead: boolean
  mlxPresent: boolean
  torchPresent: boolean
}): CheckpointCompatibility[] {
  const shapesMatch =
    Array.isArray(opts.wrim0Embedding) &&
    Array.isArray(opts.wrim1Embedding) &&
    opts.wrim0Embedding.join(',') === opts.wrim1Embedding.join(',')
  const wrim0: CheckpointCompatibility = {
    id: 'WRIM-0 checkpoint-final',
    class: opts.wrim0HashMatch
      ? opts.torchPresent
        ? 'LOADABLE_AFTER_CONVERSION'
        : 'ARCHITECTURE_COMPATIBLE_BUT_RUNTIME_INCOMPATIBLE'
      : 'CORRUPT',
    reason: opts.wrim0HashMatch
      ? 'Safetensors F32 model.* tensors are framework-neutral. Training/eval code is MLX. Nebula has no MLX; PyTorch is absent unless installed later. Isolated numpy inspection/forward does not require converting the file.'
      : 'Hash mismatch — do not load.',
    convert: 'PyTorch (or numpy) reimplementation of WRIM0Model; load model.* only; discard opt.* MLX AdamW state. Do not overwrite the original file.',
  }
  const wrim1: CheckpointCompatibility = {
    id: 'WRIM1-RUN-000001 checkpoint-step-001893',
    class: shapesMatch ? 'ARCHITECTURE_COMPATIBLE_BUT_RUNTIME_INCOMPATIBLE' : 'UNKNOWN',
    reason:
      'Same G-20M architecture; model.safetensors uses unprefixed keys vs WRIM-0 model.* prefix. Collapsed / not promoted. MLX optimizer.safetensors is not a CUDA AdamW blob.',
    convert: 'Optional key-prefix adapter only. Do not convert in this pass. Do not resume optimizer. Do not promote.',
  }
  const wrim1b: CheckpointCompatibility = {
    id: 'WRIM1-RUN-000002 checkpoint-step-000100',
    class: 'ARCHITECTURE_COMPATIBLE_BUT_RUNTIME_INCOMPATIBLE',
    reason: 'Same architecture; FAIL vs WRIM-0; not promoted. Runtime is MLX/Mac.',
    convert: 'Do not convert. Do not resume.',
  }
  const recovery: CheckpointCompatibility = {
    id: 'WRIM-1.1 recovery TEST_ONLY checkpoints',
    class: 'ARCHITECTURE_COMPATIBLE_BUT_RUNTIME_INCOMPATIBLE',
    reason: 'TEST_ONLY. Not official lineage. Same tensor family. Must not enter active runtime.',
    convert: 'Do not convert. Do not copy 18GB into AppData.',
  }
  return [wrim0, wrim1, wrim1b, recovery]
}

export const MLX_MAC_DEPENDENCIES = {
  tensorHandling: 'mlx.core / mlx.nn / mlx.utils.tree_flatten; mx.fast.rms_norm; mx.fast.scaled_dot_product_attention; nn.RoPE',
  optimizerState: 'MLX AdamW state tree saved as safetensors with opt.* (WRIM-0 combined file) or optimizer.safetensors (WRIM-1 split). Not PyTorch optimizer state_dict.',
  metalAssumptions: 'Device(gpu, 0) Metal; mx.set_cache_limit(256MB); mx.set_memory_limit(3GB); per-step mx.clear_cache(). M1 8GB unsafe at ctx=1024 batch=8.',
  macAbsolutePaths: '/Users/markbroughton/Developer/war-room-os, .venv-wrim Homebrew CPython 3.12.14, CLT python 3.9.6 for WRIM-0',
  pythonEnvironment: 'Mac: Python 3.9.6 (WRIM-0) / 3.12.14 (later runs); mlx 0.29.3 then 0.32.2; safetensors.numpy',
  checkpointSerialization: 'safetensors via safetensors.numpy save_file/load_file — tensor payload is F32 numpy, not pickle',
  dtypeAssumptions: 'fp32 end-to-end. No bf16/fp16 in historical WRIM training.',
  weightsFrameworkNeutral: true,
  optimizerFrameworkSpecific: true,
}
