# WRIM-1 Nebula rebuild training design

Status: **COMPLETE (plan only)**  
Decision: `READY_FOR_NEBULA_ENVIRONMENT_SETUP`  
Next authorized pass: `NEBULA_PYTORCH_CUDA_ENVIRONMENT_SETUP`

This document is the Commander-facing design for a stable dense WRIM-1 rebuild from WRIM-0 on Nebula Genesis. It does **not** authorize installation, checkpoint conversion, training, optimizer execution, new weights, promotion, or Ra'el.

## Parent

- Model: **WRIM-0**
- File: `checkpoint-final.safetensors` (Mac dump, read-only)
- SHA-256: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`
- Do not initialize from collapsed WRIM-1. Do not average rejected checkpoints.

## Tokenizer

- **WR-TOKENIZER-0**
- SHA-256: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`
- Frozen vocab / merges / special IDs. Do not train WR-TOKENIZER-1 in this lane.

## Architecture

Preserve **WRIM-G-20M-v1-option-A**: decoder-only, d_model 256, 18 layers, 4 heads × 64, SwiGLU d_ff 768, pre-RMSNorm, RoPE θ=10000 traditional=false, context 512, vocab 15126, tied embeddings, dropout 0, no bias, 19,217,152 parameters. No MoE / sparse experts in this baseline.

## PyTorch port (designed, not installed)

Load `model.*` F32 tensors; ignore `opt.*`. Logits = `hidden @ tok_emb.weight.T`. RoPE matches the isolated numpy smoke (`traditional=False` rotate-half). Exact mapping: 164 tensors (`lib/wrim-rebuild-design/weightMapping.ts`).

Planned stack (execute later): Python 3.13.15 venv under AppData; `torch` from `https://download.pytorch.org/whl/cu130` (cu128 fallback); `safetensors`; `tokenizers` from Stage 1. Do **not** install CUDA toolkit, torchvision, torchaudio, or accelerate unless a later measured failure requires it.

## Training recipe (evidence-backed)

| Item | Choice | Why |
| --- | --- | --- |
| Optimizer | Fresh AdamW β=(0.9, 0.95) ε=1e-8 wd=0.1 clip=1.0 | Do not resume MLX state |
| Peak LR | **3e-5** (warmup 25, cosine to 3e-6) | 3e-3 collapsed; 3e-4 still collapsed; Recovery-006/007/010 held at 3e-5 |
| Packing | Contiguous unit pack + deficit interleave | Per-token shuffle is the confirmed RUN-000001 cause |
| BOS/EOS | BOS=1 and EOS=2 on every unit | Restores WRIM-0 document wrap |
| Mix | 30% WR-CORPUS-0 + WR-CORPUS-1 prose/code/json/behavior | Recovery-006 recipe; TOOL_USE excluded (010) |
| Context | 512 | Controlled reproduction |
| Batch | micro 8, accum 1, seq 512 | Historical + 16 GB stability first |

## Stages (not started)

0. `WRIM1-NEBULA-EQ-000001` — 0 steps, equivalence smoke (argmax id 126, entropy ≈ 6.033)
1. `WRIM1-NEBULA-DIAG-000001` — 10 steps plumbing
2. `WRIM1-NEBULA-STAB-000001` — 50 steps stability (Recovery-006 horizon)
3. `WRIM1-RUN-000003` — 1500 steps official **only if** 0–2 pass

Loss is insufficient. Period-collapse sentinel and WRIM-0 retention gate can STOP a run while loss is still falling.

## Checkpoints

`%LOCALAPPDATA%\War Room OS\data\wrim-checkpoints\` lanes: official / experiments / test-only / rejected / promoted. Never git. Never copy the Mac recovery tree. STOP if free disk < 32 GB (WARN < 64 GB).

## Qwen / Ra'el / sparse

Qwen remains `THIRD_PARTY_MODEL_RUNNING_LOCALLY`. Ra'el is not created. Sparse-expert / NVMe streaming is a later architecture lane.

## What this pass did not do

No pip install. No conversion. No training. No push. No deploy.
