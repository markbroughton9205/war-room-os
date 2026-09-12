export function sparseExpertEvolutionAudit() {
  return {
    implemented: false,
    denseBaselineCompatibility:
      'YES — WRIM-G-20M-v1-option-A is a dense decoder-only stack. Attention, RMSNorm, RoPE, and tied embeddings can remain the shared trunk.',
    expertDecompositionFeasibility:
      'FFN is SwiGLU (gate/up/down) per layer. Those three Linear maps are the natural expert shards. Attention should stay dense/shared.',
    routerInsertionPoints:
      'After attn residual, before ffn_norm/ffn. Router would consume post-attn hidden (B,S,256) and select experts. Do not insert inside attention.',
    attentionPreservation: 'Keep q/k/v/o + RoPE unchanged as the hot VRAM path.',
    checkpointConversionImplications:
      'Historical checkpoints are dense. Expert split requires a NEW architecture id and a conversion that tiles FFN weights into expert tensors — not an in-place overwrite of WRIM-0.',
    trainingImplications:
      'Router + expert load balancing is a new training objective. Collapsed WRIM-1 weights must not be the parent. Dense WRIM-0 (or a future stable dense child) is the parent.',
    inferenceImplications:
      'Need NVMe mmap for cold experts, RAM staging for router/cache, VRAM for hottest experts + attention. None of this exists in the current runtime.',
    storageImplications:
      'Expert shards should live outside git under explicit lanes. Do not duplicate 18GB recovery trees.',
    recommendation: 'Do not implement sparse experts until a dense Nebula baseline is stable.',
  }
}

export function openSourceMechanismState() {
  return {
    scanned: 'local repository + recovery dump manifests only. No new code fetched or integrated.',
    mmapNpyShards: {
      present: true,
      license: 'in-repo training scripts (numpy mmap_mode=r)',
      usable: 'YES for token shard reads. NOT expert-weight streaming.',
      paths: [
        'scripts/wrim1-training/materialize_shards.py',
        'scripts/wrim1-training/recover_frozen_corpus.py',
      ],
    },
    sparseExpertRouting: {
      present: false,
      note: 'No MoE router in WRIM0Model. "sparse" in forensic_recovery_008.py refers to supervised-mask density, not experts.',
    },
    cpuGpuPartitioning: {
      present: false,
      note: 'Historical runtime is MLX Metal unified memory. No CUDA partitioner.',
    },
    lowResolutionKvCache: { present: false, note: 'KV cache in WRIM0Model is full-precision per-layer tuples only.' },
    expertPrefetch: { present: false },
    hotColdExpertCache: { present: false },
    frozenCore: {
      present: true,
      path: 'scripts/wrim-modular/frozen_core.py',
      note: 'MLX freeze of WRIM-0 for capability heads. TEST_ONLY comparison cores allowed. Not sparse streaming.',
    },
    claim: 'External mmap/MoE libraries are NOT claimed usable without license/code verification. None were fetched.',
  }
}
