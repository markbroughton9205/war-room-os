# WR-TOOL EXP-005 DESIGN

Identity: `WR-TOOL-EXP-005-DESIGN`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-EXP-005-DESIGN/`

Frozen WRIM-0 + LoRA r=2 α=2 on attn.q/v all 18 layers + Linear(256→6). Expected trainable **38406** (36864+1542). Rank not increased.

Train: V5 n=156. Checkpoint: EVAL-5 validation macro F1. Final: EVAL-5 test once. EVAL-4 secondary after freeze.

Recipe: AdamW 5e-4, batch 4, max 18 / min 4 / patience 5, clip 1.0, seed 20260831. Class weights `w_c = N/(K·n_c)` computed from frozen train **before** `optimizer.step`.

Gates stored in V5 `baselines.json` before training. No promotion. No production. No WRIM-0 write.

Dry-run proofs (in the training run, before the first logged epoch after restore): WRIM-0 SHA exact, core trainable 0, core not in optimizer, V5/EVAL-5 hashes exact, EVAL-4 frozen, class map exact, LoRA sites exact, head 1542, forward+loss+metrics+checkpoint path, active modules empty.
