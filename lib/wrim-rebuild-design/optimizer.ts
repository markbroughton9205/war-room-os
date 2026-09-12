import { COLLAPSED_PEAK_LR, INITIAL_LR, MIN_LR, PEAK_LR } from './identity'

/**
 * Fresh AdamW. Do not resume historical MLX opt.* state.
 * Evidence: Recovery-006/007/010 held DIAGNOSTIC-0 at peak LR 3e-5.
 * WRIM1-RUN-000001 collapsed at peak LR 3e-3 (compounded by token-shuffle).
 * Recovery-001..005 at 3e-4 still collapsed even with contiguous packing.
 */
export const OPTIMIZER_DESIGN = {
  algorithm: 'AdamW',
  resumeHistoricalMlx: false,
  betas: [0.9, 0.95] as const,
  eps: 1e-8,
  weightDecay: 0.1,
  gradientClipNorm: 1.0,
  fused: 'optional after Stage 0; default false until benchmarked',
  foreach: 'PyTorch default; record actual setting in the run manifest',
  evidence: [
    'WRIM-0 genesis used AdamW β=(0.9,0.95) wd=0.1 clip=1.0 (MLX).',
    'WRIM1-RUN-000001 used the same optimizer family at peak LR 3e-3 and collapsed.',
    'Recovery-006 PASS: identical mix to 005, only peak LR changed 3e-4 → 3e-5.',
    'Recovery-007 PASS: 150-step endurance at 3e-5.',
    'Recovery-010 PASS: 3e-5 + tool-use excluded.',
  ],
}

export const LR_SCHEDULE = {
  initialLr: INITIAL_LR,
  peakLr: PEAK_LR,
  minLr: MIN_LR,
  warmupSteps: 25,
  schedule: 'linear warmup 0 → 3e-5 over 25 steps, then cosine decay toward 3e-6 for the remainder of the authorized stage horizon',
  collapsedPeakForbidden: COLLAPSED_PEAK_LR,
  whyNot3e3:
    'WRIM1-RUN-000001 used peak LR 3e-3 and collapsed. Recovery 001–005 used 3e-4 with contiguous packing and still collapsed. Recovery 006 isolated the LR drop to 3e-5 as the first stable short-horizon recipe. No new evidence supports 3e-3 for continued pretrain from a finished WRIM-0.',
  stageOverrides: {
    stage0: 'no optimizer',
    stage1: 'warmup 0→3e-5 over min(25, stage1_steps); 10 diagnostic steps stay in warmup (LR ≈ 1.2e-5 at step 10)',
    stage2: 'full 25-step warmup then cosine over remaining 25 steps of the 50-step bound',
    stage3: 'warmup 25 then cosine over the official horizon; do not retune peak above 3e-5 without a new run ID',
  },
}

export function optimizerIsFresh(): boolean {
  return OPTIMIZER_DESIGN.resumeHistoricalMlx === false
}

export function peakLrIsConservative(): boolean {
  return LR_SCHEDULE.peakLr === 3e-5 && LR_SCHEDULE.peakLr < LR_SCHEDULE.collapsedPeakForbidden
}
