# WRIM reconciliation — #23

**Roadmap:** #22 CLOSED · **#23:** ACTIVE  
**Reconciliation:** COMPLETE  
**Recommendation:** `B_REBUILD_WRIM_1_FROM_WRIM_0`  
**Dense baseline required:** YES  
**Training:** NOT_RUNNING · authorization OFF · no Train button  
**Production WRIM:** NOT_IMPLEMENTED  
**Ra'el:** NOT_IMPLEMENTED

This pass recovered, audited, and classified the Mac-era WRIM lineage on Nebula Genesis. It did **not** train, convert-and-overwrite checkpoints, start sparse experts, or create Ra'el.

## WRIM-0

| Field | Value |
|---|---|
| Identity | WRIM-0 |
| Status | TRAINED_RESEARCH_ARTIFACT |
| File SHA-256 | `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` |
| Weight-tree SHA | `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` |
| Architecture | WRIM-G-20M-v1-option-A |
| Params | 19,217,152 |
| Shape | d_model=256, n_layers=18, n_heads=4, head_dim=64, d_ff=768, ctx=512, vocab=15126 |
| Design | decoder-only, pre-RMSNorm, RoPE (non-traditional), SwiGLU, tied embeddings, no bias, dropout=0 |
| Tokenizer | WR-TOKENIZER-0 (`47ed32ce…`) |
| Corpus | WR-CORPUS-0 / WRM-001 (`12f7777c…`) |
| Step / tokens | 500 / 2,048,000 |
| Framework | Apple MLX fp32 AdamW; weights in safetensors F32 (framework-neutral payload) + MLX `opt.*` state |

Historical eval (Genesis, not invented): train EMA loss 4.5181; val loss 8.7304; val ppl 6,188; greedy `"The"` collapses to tokenizer-runs; JSON invalid; not a capability claim.

## WRIM-1

- **RUN-000001:** 1893/1893 steps, 7,753,728 tokens, **COLLAPSED**, promotion **REJECTED**. Confirmed cause: per-token shuffle packing.
- **RUN-000002:** 100/502 steps, 409,600 tokens, official candidate **FAIL vs WRIM-0**, not promoted. Packing was already contiguous; tool-use / capability mix is the stronger suspect (Recovery-010 isolation).

## Recovery TEST_ONLY

001–011 remain TEST_ONLY. Reusable: contiguous packing, unit EOS, LR **3e-5**, interleaved rehearsal, tool-use isolation (010). Dead ends: 002/003/009 as recipes. Do not copy the ~13.8GB recovery weight tree into AppData.

## Continuation

**B.** Rebuild WRIM-1 training from WRIM-0 parent with recovered packing/LR/mix lessons. Not A (genesis-only continue), not C (new architecture before dense baseline), not D (lineage is usable).

## Nebula

Measured: AMD Ryzen 7 7700X, ~31 GiB RAM, RTX 5060 Ti **16311 MiB**, NVMe 1 TB with ~459 GB free, NVIDIA driver CUDA UMD 13.4. Python 3.13.15 + numpy present. PyTorch / MLX / CUDA toolkit **not** installed this pass.

Isolated numpy smoke may load `model.*` tensors read-only. It does not replace Qwen. MLX training scripts are Mac-runtime-incompatible.

## Surfaces

- `GET /api/wrim-reconciliation/status`
- `GET /api/local/wrim-reconciliation/status`
- WR-CORPUS page WRIM panel (`/wr-corpus`)
- `pnpm run validate:wrim-reconciliation`

Do not train. Do not promote collapsed checkpoints. Do not call WRIM-0 Ra'el.
