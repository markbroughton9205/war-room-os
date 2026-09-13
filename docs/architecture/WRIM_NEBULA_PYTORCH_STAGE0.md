# WRIM Nebula PyTorch environment + Stage 0 + Stage 1 + Stage 2

Status: **READY** / **STAGE0_VERIFIED** / **STAGE1_VERIFIED** / **STAGE2_STOPPED_BY_SENTINEL**  
Next authorized pass: `STAGE2_STOPPED_BY_SENTINEL_REVIEW`  
`READY_FOR_STAGE3_TRAINING_AUTHORIZATION = NO`

Dedicated venv: `%LOCALAPPDATA%\War Room OS\venvs\wrim-pytorch\`  
Wheel: official stable `torch==2.13.0+cu130` (Windows cp313). Driver CUDA UMD 13.4. RTX 5060 Ti `sm_120` is in `torch.cuda.get_arch_list()`. No CUDA Toolkit. No nightly.

## Stage 0

Loaded WRIM-0 `model.*` only (164 tensors, 330 `opt.*` ignored), reference attention (not SDPA), tied embeddings, CPU then CUDA FP32 with TF32 off. Parent checkpoint was not modified. No backward. No optimizer.

## Stage 1 (`WRIM1-NEBULA-DIAG-000001`)

Commander-authorized TEST_ONLY plumbing diagnostic. Exactly 10 AdamW steps, then STOP.

- Parent: WRIM-0 `checkpoint-final.safetensors` read-only (`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`)
- Corrected packing: contiguous unit pack + deficit interleave, BOS=1 / EOS=2 wrap, no per-token shuffle, TOOL_USE excluded, leakage scan clean
- Fresh AdamW β=(0.9, 0.95) wd=0.1 clip=1.0, peak LR 3e-5, warmup 25 (step 10 LR = 1.2e-5). Historical MLX `opt.*` not resumed
- Batch 8 × 512 FP32, 40,960 tokens
- Finite loss and grads on every step
- Diagnostic checkpoint saved under `%LOCALAPPDATA%\War Room OS\data\wrim-checkpoints\test-only\WRIM1-NEBULA-DIAG-000001\`
- Reload hash matched save; logits max diff 0; smoke prompt still argmax id 126
- Parent SHA unchanged. No Train button. Not a promotion candidate. Ra'el not created.

## Stage 2 (`WRIM1-NEBULA-STAB-000001`)

Commander-authorized TEST_ONLY stability run. Started from WRIM-0 parent weights (not Stage 1, not collapsed WRIM-1). Fresh AdamW. Ratio-controlled contiguous packing hit 30.0002% WR-CORPUS-0 rehearsal (±5pp tolerance).

Stopped at optimizer step 30 / 122,880 tokens by the retention sentinel (`6/6` → `5/6` vs step-0). Eval intervals completed at 0/10/20/30. Steps 40 and 50 were not reached. Checkpoint saved under `%LOCALAPPDATA%\War Room OS\data\wrim-checkpoints\test-only\WRIM1-NEBULA-STAB-000001\`. Reload hash matched; post-reload logits/entropy finite.

Verdict: **STAGE2_STOPPED_BY_SENTINEL**. Do not promote. Do not start Stage 3 / `WRIM1-RUN-000003`. Qwen remains the local runtime model.
