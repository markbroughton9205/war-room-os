# WRIM Frozen Core Architecture

Date: 2026-08-31  
Official core: **WRIM-0**  
Checkpoint file SHA: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Tokenizer (WR-TOKENIZER-0) SHA: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`  
Architecture: WRIM-G-20M-v1-option-A (`d_model=256`, `n_layers=18`, `n_heads=4`, `head_dim=64`, `d_ff=768`, tied embeddings, SwiGLU, RoPE).

## Why freeze

Recovery-001–011 showed full-weight updates under tool supervision destabilize language. Phase 1 isolates the known-good core so capability training cannot rewrite it.

## Implementation

Class: `FrozenWRIMCore` in `scripts/wrim-modular/frozen_core.py`.

Load path: Genesis sidecar + `load_checkpoint` for `checkpoint-final`. Optimizer blobs that exist inside the Genesis safetensors file are **discarded** — the frozen core never carries optimizer state.

Isolation mechanism (MLX, not a fake boolean):

1. `model.freeze(recurse=True)` which records parameter keys in `Module._no_grad`.
2. Proof: `model.trainable_parameters()` leaf count **must be 0**.
3. Future optimizers are constructed only from capability `trainable_parameters()`.
4. `mlx.nn.value_and_grad` differentiates only those trainable leaves.

Measured:

| Quantity | Value |
|---|---|
| `core_total_parameters` | 19,217,152 |
| `core_trainable_parameters` | 0 |
| Weight-tree SHA (numpy leaves) | `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` |
| `max_abs_diff` after dummy attach/detach/save/load + synthetic opt step | 0 |

File SHA `d1affa…` hashes the **Genesis checkpoint file** (model + optimizer tensors). The weight-tree SHA hashes **model leaves only** after load. Both are recorded; they are different objects.

## Hidden states

`WRIM0Model.forward_hidden` returns post-`norm_f` hidden (before tied projection). Capability heads attach to the last-token slice `hidden[:, -1, :]`. `__call__` is unchanged for existing trainers.

## Inference

`FrozenWRIMCore.logits` / `forward_hidden` use the frozen module. Freeze does not disable forward.

## TEST_ONLY comparison cores

`load_test_only_comparison_core` can load Recovery-010 `checkpoint-step-000250` with `lineage_role=TEST_ONLY_COMPARISON`. It does not write ACTIVE runtime and does not change WRIM-0 lineage. Recovery-010 `model.safetensors` SHA is **not** the WRIM-0 Genesis file SHA (different packaging). Promotable checkpoints are refused.

## ACTIVE runtime

Default:

- ACTIVE CORE: WRIM-0  
- ACTIVE MODULES: []  
- composed id: `composed:WRIM-0+[]`

Persisted under `model-lab/manifests/modular-intelligence/` when written. Phase 1 proofs use in-memory composition unless saving test-only dummy artifacts.
