# WRIM-1 COLLAPSE ROOT-CAUSE REPORT — WRIM1-RUN-000001

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Official training: **not re-run**. Weights of WRIM1-RUN-000001 were **not** altered.

## BINARY VERDICT

**WRIM-1 COLLAPSE DIAGNOSIS — PASS**

Grounded enough to design the next experiment. Collapse is **not** a decoding-only bug of the eval runner.

---

## 1. Experiment identity

`WRIM1-RUN-000001`. Parent WRIM-0. Option A ~19.2M. 1893 steps, 7,753,728 tokens seen.

## 2. Preserved checkpoints

All 10 complete official checkpoints remain under `model-lab/manifests/wrim1_checkpoints/`. Marker: `model-lab/manifests/wave9/WRIM1-RUN-000001-preserve.json`.

## 3. Promotion rejection

Unchanged: `PROMOTION_REJECTED`.

## 4. Observed collapse

Held-out and diagnostic greedy decoding: prompt (in full decode) then long `.` / `:` runs. Same-runner diagnostics: `model-lab/manifests/wave9/test-only/collapse-diagnosis/`.

## 5. Same-runner WRIM-0 baseline

`load_parent_wrim0_weights` + `evaluate_wrim1.generate`-equivalent greedy path.

Prompt `The sky is` (greedy 32):

- WRIM-0: ` a\n}_tokenizer_tokenizer…` (weak, **not** period-argmax)
- WRIM-0 temperature 0.8: ` so to lose.\n\nMrs. Collins was no just d` (word-like)
- WRIM-1 step 200+: greedy `................................` ; temp 0.8 still punctuation/code soup, not WRIM-0 prose

**CONFIRMED:** failure is in trained WRIM-1 weights / training procedure, not a unique eval decoder.

WRIM-0 still fails 2/8 diagnostic probes (underscore/`tokenizer` runs). That is Genesis-weak LM, **not** the WRIM-1 period mode.

## 6. Checkpoint diagnostic matrix

Suite `WRIM-RECOVERY-DIAGNOSTIC-0` (8 probes, not held-out). Collapsed = max consecutive token run ≥ max(6, n/3).

| Checkpoint | SHA prefix | collapsed |
|---|---|---|
| WRIM-0 reconstructed | d1affa59… | **2/8** |
| 200 | 68cecc17… | **8/8** |
| 400–1893 | (all official) | **8/8** |

## 7–9. Last healthy / first degraded / first collapsed

- **LAST_HEALTHY_CHECKPOINT:** WRIM-0 only. **No healthy WRIM-1 checkpoint.**
- **FIRST_DEGRADED:** WRIM-0 (2/8), qualitatively different from period collapse.
- **FIRST_COLLAPSED:** **checkpoint-step-000200** (first official WRIM-1 snapshot; 8/8).

Damage is in the **first 200 steps**. Later steps do not recover greedy behavior.

## 10. Raw logit comparison

Prompt `The sky is`, greedy next-token:

| Model | argmax | P(`.`) | entropy | finite |
|---|---|---|---|---|
| WRIM-0 | ` a` (p≈0.077) | 0.0010 | 6.03 | yes |
| WRIM-1 @200 | `.` (p≈0.030) | 0.030 | 6.56 | yes |
| WRIM-1 @1893 | `.` (p≈0.026) | 0.026 | 6.51 | yes |

No NaN/Inf. Entropy stays high: this is **mode shift to punctuation/code tokens**, not a single-dirac collapse. Greedy then self-feeds `.` and runs.

## 11. Greedy vs sampling

Collapse of **greedy** is robust at every WRIM-1 checkpoint. Temperature 0.8 does **not** restore WRIM-0-like prose; it samples code/punct soup. **Not** a greedy-only decoder bug.

## 12. Tokenizer round-trip

WR-TOKENIZER-0: prose/JSON/code round-trip OK (leading space). Tab → `<|unk|>` (id 3). Period id **20**. Special tokens 0–8 distinct. **Not** the period-run cause.

## 13–14. Special tokens / EOS/PAD/BOS

pad=0, bos=1, eos=2, unk=3. No PAD==EOS alias.

Train shard `train.npy`: **30 BOS, 30 EOS** in 3,874,900 tokens (`eos_frac` 7.7e-6, ~129k tokens/EOS). Those 30 are essentially **behavior examples** that contain `<|eos|>` in rendered text. **Chunks are concatenated with no BOS/EOS wrapper** (`recover_frozen_corpus.py` `token_ids[split].extend(ids)`).

WRIM-0 shards wrap **every document** with BOS/EOS (`prepare_wrim0_shards.py`).

## 15–16. Weight tying / output head

Architecture: `logits = x @ tok_emb.weight.T`. No `lm_head` key in loaded trees. Tied by construction. **Not** a serialization untie.

## 17–18. Parameter drift

L2 vs WRIM-0 grows smoothly: 131 (@200) → 707 (@1893). No single-step explosion after 200. Embedding RMS **rises** 0.11→0.38; attention/MLP/norm RMS **fall**. Drift is **global and gradual** after an already-broken step-200 state.

## 19–20. Loss / validation curves

Attempt 2: start loss **8.73** → min **6.48** → end **6.59**. Val diagnostic ~6.42→6.39. Loss **falls while greedy generation is already collapsed**. Validation uses the **same shuffled packed CE**, so it cannot select a useful checkpoint.

## 21–22. Learning rate / optimizer

Peak LR **0.003**, warmup 50, cosine to 10% floor (end ~3e-4). Same **peak** as Genesis **from-scratch** training (`train_wrim0.py --peak-lr 3e-3`).

Continued training from a **finished** WRIM-0 with that peak is aggressive (**POSSIBLE** contributor) but **not sufficient** alone: WRIM-0 used the same LR on **contiguous** windows and produced word-like greedy argmax.

Optimizer: **fresh AdamW** after parent load (not inherited Genesis opt state). Intentional in `trainer_core.py`. Clip 1.0, betas (0.9, 0.95), wd 0.1, fp32, batch 8, ctx 512.

## 23. Gradients

Metrics do not log grad norms. No official backward was run. Exploding-loss guard (`loss>50`) never fired. **POSSIBLE** / not measured.

## 24–26. Objective / masking / prompt echo

Causal CE on **all** positions; no response-only mask. Behavior text is `renderTrainingText` (bos/system/commander/assistant/eos). Behavior is **0.16%** of train tokens (28 train-split examples / 6022 tokens). Full-token loss on them is **not** the main mass. Eval “prompt echo” is partly **decode-of-full-sequence** (same as WRIM-0). WRIM-1 continuation is dots, not copied commander blocks.

## 27. Behavior examples

31 examples. ~2 epochs. Token share **0.16%**. Too small to teach protocols; not the period-mode driver.

## 28–32. Corpus token distribution (train JSONL token_count)

| Bucket | tokens | % |
|---|---|---|
| code | 3,005,261 | **77.56%** |
| prose/docs | 678,766 | 17.52% |
| json | 184,851 | 4.77% |
| behavior | 6,022 | 0.16% |

**STRONGLY_SUPPORTED** as a **contributing** bias (greedy top-k after 200 is `. : _ \n , ( )`). **Not** sufficient: WRIM-0 period rate is **higher** (2.86% vs WRIM-1 2.50%).

## 33. Punctuation frequency

`.` is **not** more common in WRIM-1 shards than WR-CORPUS-0. Period-run is **not** “`.` overrepresented in the frozen corpus.”

## 34. Duplication / boilerplate

Wave 8.1 dedup passed its rules. Repo still has repeated imports/headers. **POSSIBLE** near-dup bias; not isolated as primary.

## 35. Data order

**CONFIRMED defect:** `epoch_stream` does `data[rng.permutation(data.size)]` — **per-token permutation** of the entire 1D stream, then 512-token windows. Config string `epoch_permutation_then_sequential_cursor` does **not** match WRIM-0 packing.

WRIM-0 `get_batch`: random **start offsets into a contiguous document stream**.

After shuffle, a 20k-token prefix keeps only ~13% of original adjacent pairs.

This trains next-token prediction on **almost unrelated neighbors**. The learnable signal is **unigram/punctuation/code-token frequency**. Greedy argmax becomes `.` / `:` / `_`.

Validation uses the same `next_batch` → **same broken objective**.

## 36. WR-CORPUS-0 rehearsal

**Not included** as a distinct mix. WRIM-1 shards are WR-CORPUS-1-HARDENED only. Forgetting of WRIM-0 prose prior is expected under token-shuffled code-heavy CE.

## 37–38. Parent load / step-0 reconstruction

`load_parent_wrim0_weights` strict load, 164 tensors, parent SHA verified. Reconstructed WRIM-0 on the **same generate path** is **not** period-greedy. Parent load **worked**.

## 39. Shard integrity

IDs in `[0, 15124]`, vocab 15126. No OOB. UNK count 16146 (tabs/etc.).

## 40–42. Sequence boundaries / EOS / packing

Chunks concatenated with **no** EOS between files. Packed windows after **token shuffle**. Loss **crosses random token pairs**, not documents.

## 43–44. Validation / checkpoint selection

Lowest val@1893 is CE on shuffled windows. **Insufficient** for selection. Future: val CE **on contiguous** windows + frozen diagnostic suite (not held-out).

## 45–46. Held-out contamination / eval-infra self-reference

Fingerprint leakage gate passed. Train JSONL still contains exact held-out prompt strings inside `lib/wrim1-dataset/heldOut.ts`, `eval.ts`, `behavior.ts`, Genesis/eval reports. Class: **EVAL_INFRA_EXCLUDE_FROM_TRAIN**. Does not explain period-argmax (those files are a tiny fraction). **Does** invalidate clean generalization claims.

## 47–49. Root causes

**#1 CONFIRMED — token-level shuffle packing** (`dataset_cursor.epoch_stream`). Destroys locality; matches step-200 punct mode vs WRIM-0 word mode on the same generator.

**#2 STRONGLY_SUPPORTED — no BOS/EOS between 11k chunks** vs WRIM-0 per-document wrap.

**#3 STRONGLY_SUPPORTED — 77.6% code tokens** after the packing bug, so the shuffled unigram mode is punctuation/syntax.

**#4 POSSIBLE — continued-pretrain LR 3e-3** from a finished parent (speeds destruction; not the packing bug).

**#5 POSSIBLE — no WR-CORPUS-0 rehearsal.**

**#6 CONFIRMED (eval integrity) — eval-infra prompt leakage.** Not the collapse mechanism.

**RULED_OUT:** eval-only decoder; PAD=EOS; NaN logits; broken tying; parent not loaded; period more frequent than WR-CORPUS-0; architecture/tokenizer change required.

## 50. Recovery recommendation

Do **not** continue from any WRIM-1 cadence checkpoint.

Start from **WRIM-0**. Fix packing to **contiguous** windows (WRIM-0 `get_batch` semantics). Wrap documents/chunks with BOS/EOS. Exclude eval infra by **content fingerprint**, not filename only. Lower continued-pretrain LR. Optional WR-CORPUS-0 rehearsal. Tiny TEST_ONLY packing ablation before another 1893-step official run.

See `docs/WRIM1_1_RECOVERY_DESIGN.md`.
