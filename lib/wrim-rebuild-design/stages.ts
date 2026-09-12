import {
  CONTEXT_LENGTH,
  STAGE0_RUN_ID,
  STAGE1_RUN_ID,
  STAGE2_RUN_ID,
  STAGE3_OFFICIAL_RUN_ID,
} from './identity'

export const BATCH_PLAN = {
  sequenceLength: CONTEXT_LENGTH,
  hardware: 'RTX 5060 Ti 16 GB (16311 MiB measured). Prioritize stability over max utilization.',
  microBatch: 8,
  gradientAccumulation: 1,
  effectiveBatch: 8,
  tokensPerStep: 8 * 512,
  vramNote:
    '19.2M params FP32 ≈ 77 MB weights + AdamW states ≈ 154 MB. Historical Mac batch was 8×512. Candidate after benchmark (not a measured fact): micro-batch 16 if Stage 1 VRAM headroom > 8 GB. Do not raise sequence length in this baseline.',
  contextExpansion: false,
}

export const PRECISION_PLAN = {
  measured: false,
  stage0Required: 'FP32; disable TF32 (matmul/cudnn); highest precision for equivalence vs numpy',
  stage1Default: 'FP32',
  stage2Default: 'FP32',
  stage3Recommendation:
    'After environment setup, measure torch.cuda.is_bf16_supported() and a tiny FP16 matmul. If BF16 is stable on RTX 5060 Ti, Stage 3 MAY use BF16 autocast with FP32 master weights. If BF16 unsupported, stay FP32. Do not claim BF16/FP16 support in this design pass.',
  tf32: 'Off for Stage 0. Record enable/disable in later manifests. Do not silently enable.',
}

export const STAGE_PLAN = {
  stage0: {
    id: STAGE0_RUN_ID,
    kind: 'TEST_ONLY',
    name: 'Nebula equivalence smoke',
    trainingSteps: 0,
    tokens: 0,
    goal: 'Load WRIM-0 model.* into the PyTorch module. Run deterministic probes. Compare to numpy/Mac baseline. No optimizer. No weight write to parent.',
    gate: 'argmax id 126; entropy within tolerance; continuation behavior; finite logits; parent SHA unchanged',
    promotionCandidate: false,
  },
  stage1: {
    id: STAGE1_RUN_ID,
    kind: 'TEST_ONLY',
    name: 'short diagnostic run',
    trainingSteps: 10,
    tokens: 10 * 8 * 512,
    goal: 'Prove forward, backward, AdamW step, checkpoint save, checkpoint reload, finite loss, finite grads, contiguous packing, EOS/BOS present in a packed batch.',
    gate: 'all plumbing checks pass; no NaN; reload hash matches save; packing audit finds EOS between units',
    promotionCandidate: false,
  },
  stage2: {
    id: STAGE2_RUN_ID,
    kind: 'TEST_ONLY',
    name: 'bounded stability run',
    trainingSteps: 50,
    tokens: 50 * 8 * 512,
    evalEvery: 10,
    goal: 'Catch period collapse, repetition, entropy collapse, retention loss, validation degradation before an official run. Recipe = Recovery-006 horizon.',
    gate: 'DIAGNOSTIC-0 collapsed probes ≤ WRIM-0 floor + 1; retention not worse than -1 vs step-0 parent; no period-argmax persistence; val loss finite',
    promotionCandidate: false,
  },
  stage3: {
    id: STAGE3_OFFICIAL_RUN_ID,
    kind: 'OFFICIAL_RUN',
    name: 'official dense rebuild',
    trainingSteps: 1500,
    tokens: 1500 * 8 * 512,
    milestones: [150, 500, 1000, 1500],
    evalEvery: 50,
    goal: 'Learn WR-CORPUS-1 with 30% WR-CORPUS-0 rehearsal from WRIM-0 weights. ~6.14M tokens (~1.6× HARDENED train scale). Early-stop on collapse/retention sentinels. Do not blindly match RUN-000001 1893 steps.',
    requires: ['Stage 0 PASS', 'Stage 1 PASS', 'Stage 2 PASS', 'Commander training authorization', 'historical-corpus grant', 'leakage scan clean'],
    promotionCandidate: 'only after multi-dimension promotion gates vs WRIM-0',
  },
}

export const REPRODUCIBILITY = {
  runtimeSeed: 1337,
  dataOrderSeed: 20260912,
  packingSeed: 20260912,
  evalSeed: 42,
  cudnnBenchmark: false,
  tf32Stage0: false,
  deterministicAlgorithms: 'attempt for Stage 0; record RuntimeError ops that refuse determinism',
  bitPerfectCrossGpu: false,
  note: 'Do not promise bit-perfect CUDA determinism across GPUs, drivers, or PyTorch builds. Stage 0 requires behavioral match (argmax/entropy/continuation), not bitwise logits vs Mac MLX.',
}
