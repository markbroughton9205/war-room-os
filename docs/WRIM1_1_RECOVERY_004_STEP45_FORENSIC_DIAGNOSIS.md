# WRIM-1.1 RECOVERY-004 — STEP-45 FORENSIC DIAGNOSIS

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: **no commit, no push**  
Training: **not run**. Recovery-005 / WRIM1-RUN-000002: **not launched**.

TEST_ONLY forensic artifacts (new, separate from Recovery-004):  
`model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45/`

Recovery-001/002/003/004 checkpoints and metrics were **not overwritten**.

## BINARY VERDICT

**WRIM-1.1 RECOVERY-004 FORENSIC DIAGNOSIS — PASS**

This PASS means the forensic mission produced enough evidence to name the next highest-information TEST_ONLY experiment. It does **not** mean Recovery-004 passed.

---

## 1. Forensic mission status

Complete. Phases 1–24 executed against recorded artifacts plus read-only rematerialization of the packed stream (byte-identical to saved `train.npy` / `train-mask.npy`) and eval-only replay of selected batches against **checkpoint-step-000025** (no optimizer step; live weights `max_abs_diff = 0` vs that file).

## 2. Artifacts available

Under `TEST-WRIM1.1-RECOVERY-004/`:

- `metrics.jsonl` — per-step train loss, LR, global grad L2, timestamps (steps 1–45)
- `experiment-summary.json` — `grad_instrumentation` per step (global + per-layer L2), light/full diagnostics, KL/drift rows, early-stop
- Full checkpoints **0 / 10 / 25** (model + AdamW + scheduler + dataset cursor + RNG)
- Light diagnostics **5, 15, 20, 30, 35, 40, 45** (generation, entropy, P(.), P(|), P(_), param drift vs WRIM-0, KL)
- Full diagnostics **0, 10, 25**
- Packed `train.npy` / `train-mask.npy` (399,999 tokens)
- `data-mix-report.json`, causal/unit-mask audits
- WRIM-0 load proof (`max_abs_diff = 0`)

Forensic reconstruction additionally wrote batch composition, unit spans, redacted snippets, optimizer-moment stats (step 0 vs 25), eval-only replay, and crash/runtime notes.

## 3. Artifacts missing (do not invent)

| Requested | Status |
|---|---|
| Full weight checkpoints at 35, 40, 45 | **Missing.** Light JSON only. Cannot fresh-load those steps. |
| Optimizer / scheduler tensors at 35–45 | **Missing.** Last AdamW snapshot is step **25**. |
| Explicit clip flag / pre-clip vs post-clip tensors | **Not logged.** Inferable: clip when `global_grad_l2 > 1.0` (formula `min(1, 1/(g+1e-6))`). |
| Historical per-token / per-sequence loss | **Not logged.** Eval-only computed on step-25 weights. |
| Per-head gradients historically | **Not logged.** Eval-only Q/K/V/O/MLP on step-25. |
| Per-step `\|\|Δθ\|\|` for 41–45 | **Not measurable** without consecutive weight files. |
| Dataset cursor at 45 | **Missing** (early stop; last cursor file is step 25). Reconstructable: offset = `step × 4096`. |
| Per-source KL probes (code/JSON/prose/rehearsal) | **Not recorded.** Only frozen 1008-position WR-CORPUS-0 KL. |

## 4. Exact step where loss first becomes abnormal

**Step 42.**

Steps 25–41 stay in **4.20–4.50**. Step 41 = **4.351**. Step 42 = **5.818**. That is the first step more than ~3σ above the 25–41 band and the first mixed (non-100% rehearsal) batch after a 27-step Austen block.

## 5. Step-by-step train loss 25–45

| Step | train loss |
|---:|---:|
| 25 | 4.259 |
| 26 | 4.425 |
| 27 | 4.319 |
| 28 | 4.421 |
| 29 | 4.302 |
| 30 | 4.265 |
| 31 | 4.339 |
| 32 | 4.380 |
| 33 | 4.204 |
| 34 | 4.256 |
| 35 | 4.305 |
| 36 | 4.493 |
| 37 | 4.472 |
| 38 | 4.423 |
| 39 | 4.358 |
| 40 | 4.505 |
| 41 | 4.351 |
| **42** | **5.818** |
| **43** | **7.515** (peak) |
| 44 | 7.307 |
| 45 | 7.055 (early stop) |

Not one isolated blip: **three consecutive high-loss leftover batches** after the rehearsal unit ends. Loss is still falling slowly 43→45 (`7.51 → 7.06`) when the collapse gate fires. Early stop **prevented** observing whether generation would recover.

Val loss at 45 is **7.154** (still below step-0 val **7.753**). Train/val gap at 35 is Austen-easy train vs leftover val.

## 6. LR 25–45

Logged LR **matches** `lr_at_step(step-1, total=150, peak=3e-4, warmup=25, floor=0.1)` exactly.

| Step | LR |
|---:|---:|
| 25 | **3.000e-4** (first peak; warmup complete) |
| 26 | 3.000e-4 |
| 35 | 2.966e-4 |
| 40 | 2.917e-4 |
| 42 | 2.892e-4 |
| 45 | 2.849e-4 |

Failure is **17 steps after peak**, on a smooth cosine (horizon 150). No scheduler discontinuity or LR jump. Peak LR **coincides with the middle of the Austen binge**, not with step 42.

## 7. Gradient norms 25–45 (historical, pre-clip)

| Step | global L2 | tok_emb | layers.0 |
|---:|---:|---:|---:|
| 25–41 | 0.38–0.53 | ~0.30–0.40 | ~0.20–0.33 |
| **42** | **0.913** | **0.765** | **0.426** |
| **43** | **1.226** | **0.949** | **0.657** |
| 44 | 1.073 | 0.836 | 0.588 |
| 45 | 0.983 | 0.854 | 0.426 |

Finite throughout. Not a 50× spike. Magnitude returns to the **same class as steps 1–13 leftover batches** (global ~1.3–1.8). Embedding carries most mass, as at step 1.

Eval-only grads on **step-25 weights** for the same batches: 35→0.48, 41→0.48, 42→0.89, 43→1.17. The hard leftover batch is high-grad even **before** steps 26–45 updates. Historical 43 ≈ replay 43.

## 8. Clipping events

Clip threshold **1.0**. Inferred `clip_applied` iff `global_grad_l2 > 1.0`.

- Steps 25–42, 45: **no clip**
- **Step 43: yes** (pre 1.226 → post ≈ 1.0)
- **Step 44: yes** (pre 1.073 → post ≈ 1.0)

Not “every bad batch clipped”: **42 is already abnormal (loss 5.82, grad 0.91) without clip.** Clip is a consequence of leftover-batch grads, not the initiator.

## 9. Local batch composition 25–45

Rematerialized packing **equals** saved stream (`train_equal: true`, `mask_equal: true`).

| Steps | rehearsal % | leftover |
|---|---:|---|
| 25–41 | **100% WR-CORPUS-0** | none |
| 42 | 47.0% rehearsal / 33.0% prose / 20.0% JSON | first leftover after binge |
| 43 | 0% / prose 35.2 / code 57.9 / behavior 6.9 | leftover |
| 44 | 0% / prose 46.4 / code 47.3 / behavior 6.3 | leftover |
| 45 | 0% / prose 44.2 / code 36.6 / JSON 12.7 / behavior 6.5 | leftover |

Global mix (30% rehearsal) is **not** the local mix. Two WR-CORPUS-0 units; one is a **115,060-token truncated document** (`7180f321-8186-424a-b995-f3298b29d5c2:prefix115060` — Pride and Prejudice). Unit shuffle does not split that document. Result: **~28 consecutive training steps of one novel**.

Steps 1–13 are leftover (loss 7.3–8.3). Step 14 enters rehearsal. Steps 15–41 stay in the novel.

## 10. Local rehearsal percentage

| Window | rehearsal % |
|---|---:|
| 25–30 | **100** |
| 31–35 | **100** |
| 36–40 | **100** |
| 41–45 | **29.4** (41 = 100%; 42 = 47%; 43–45 = 0) |
| 1–45 overall | 62.4 (front-loaded leftover + mid-run Austen blob) |

This is **not** a rehearsal drought *before* failure. It is the opposite: a **rehearsal flood**, then an abrupt **exit**.

Read-only peek at Recovery-001 `train.npy` (not modified): steps **25, 40, 45, 50** still decode as Austen; leftover code appears by **step 80**. 001 rehearsal was **176,935 tokens** (~43 steps if contiguous). 004 rehearsal is **120,000 tokens** (~29 steps). Same packing family explains why 001 still looked healthy at 50 while 004 left the novel at 42.

## 11. Source IDs around failure

- 38–41: only `7180f321-8186-424a-b995-f3298b29d5c2:prefix115060`
- 42: that unit **ends**; then `lineage:docs` (World Bank / source-registry markdown tables) and `lineage:model-lab/manifests` JSON (event hashes)
- 43: `docs`, `lib/research-engine` (`ukOns.ts`), `lib/income-workers/registry.ts`, `lib/council/execution-gate/behaviorValidation.ts`, `lib/research-engine/security/redact.ts`, earth-knowledge markdown, behavior `w81ex_e76637312fec6af52af440ae`
- 44–45: more docs tables, council validation TS, `hybridAnalysis.ts`, behavior examples, `nativeBuilder.validation.ts`, `wave5/training-dataset-manifest.json`

Causal mismatches: **0** on reconstructed batches 1–45 (`y[t]==x[t+1]`).

## 12. Decoded batch findings (redacted)

Healthy 30–35: literary dialogue (Elizabeth, Longbourn, Wickham). No pipe tables, no minified TS.

Step 42: markdown pipes, World Bank API notes, registry tables (`| Total substantive sources... |`), JSON `eventHash` blobs.

Steps 43–45: TypeScript (`import`, `assert.equal`), markdown separator tables, `<|unk|>` in paths/currency, behavior chat wrappers (`<|system|>`, `<|commander|>`), Wave 5 JSON manifests. No secrets found; PEM/API-key regex did not fire. `<|unk|>` is tokenizer coverage, not a key leak.

## 13. Per-sequence loss (eval-only, step-25 weights)

Austen sequences (35/41): per-seq CE **~4.0–4.6**, tight.

Step 42 replay batch loss **5.86** (historical 5.82). Step 43 **7.51** (historical **7.515**). Step 45 **7.20** vs historical 7.06 (weights differ: replay is step 25, history is step 45).

The loss jump is **already explained by batch identity** at the last full checkpoint. It is not a unique numerical blow-up that only exists after steps 26–42.

## 14. Highest-loss tokens / patterns

Top eval-only contributors on failure batches (step-25 weights):

- `{` in **code** (step 43, losses ~18.8, 18.2)
- `+` in **code** (~17.3)
- rare/fragment BPE in **prose** tables (`cial`, `ident`) at step 42 (~17)

**Not** concentrated on EOS/BOS as the top ranks. High loss sits on **code punctuation and table/JSON subwords** after a long literary context.

## 15. EOS / boundary findings

Steps 15–41: **0 EOS in the 8×512 windows** (interior of one huge unit).  
Step 42: 4 EOS (document end + leftover starts).  
Steps 43–45: 8–9 EOS/batch, typical leftover packing.

Causal-target bug: **ruled out** (0 mismatches). Mask zeros appear when behavior units enter (43–45: 251–277 masked tokens/batch). Step 42 has **0 masked tokens** (no behavior) but is already the first abnormal loss step.

## 16. JSON findings

JSON is **20% of step 42** (event-hash JSON + tables). Present at the **first** abnormal step. Not present in 25–41. **Possible contributor to the transition batch**, not a standalone 8.62% global-mix story. Step 45 JSON ~13% after collapse is already underway.

## 17. Behavior findings

**0% behavior on step 42** (first abnormal loss). Behavior **6–7%** on 43–45 (response-only mask; unit audit 6650/6650). Do **not** blame behavior as the trigger. It arrives **after** the rehearsal→leftover cut.

## 18. Code findings

**0% code on 25–42.** Step 43 is **57.9% code** and is the **peak-loss** step. Highest per-token losses are code `{` / `+`. Code is the bulk of the **post-cut leftover**, strongly associated with peak CE, not with the Austen-healthy window.

## 19. Optimizer-state findings

- Step 0 bundle: only `learning_rate` + `step` (fresh AdamW, no moments yet).
- Step 25: 164 `m` + 164 `v`, all **finite**. mean `|m|` 1.12e-5, max `|m|` 0.011; mean `v` 2.42e-8, max `v` 6.98e-4. No NaN, no empty moments.
- Steps 35–45 optimizer: **not saved**.
- Bias correction at step 25: `1-β1^t ≈ 0.928`, `1-β2^t ≈ 0.723`. At step 42: `≈ 0.988` / `0.884`. Not a cold-start reset at failure.
- **Cold Adam at step 0 is by design**; failure is not at step 0.

Specialization of moments to **27 Austen steps at ~3e-4** is **possible** as an amplifier when leftover returns; **not independently proven** without 35/45 optimizer files.

## 20. Update-magnitude findings

Cannot compute `\|\|θ_t - θ_{t-1}\|\|` for 41–45. Proxy vs WRIM-0 (logged):

| Step | global L2 from WRIM-0 | relative |
|---:|---:|---:|
| 25 | 7.34 | 0.0278 |
| 35 | 9.45 | 0.0358 |
| 40 | 10.12 | 0.0384 |
| 45 | 10.78 | 0.0409 |

Smooth. No evidence of a one-step parameter explosion. Cosine to WRIM-0 stays **≥ 0.9989** at 45.

## 21. Global parameter drift

Smooth L2/relative increase. KL 0.057 (25) → 0.073 (35) → 0.070 (40) → 0.077 (45). Language collapse at 45 occurs **while parent KL remains modest**. Implication: **token-level parent agreement on frozen WR-CORPUS-0 windows is a weak detector of leftover-domain generation failure.**

## 22. Per-layer drift (vs WRIM-0, from light/full JSON)

At 45, lowest cosine: `layers.1` **0.99893**; `layers.12/13` ~0.9990. All layers ≥ 0.9989. `norm_f` ~1.0. No single-layer cosine collapse. L2 drift is largest in **tok_emb**, then mid/late layers (~2.0 at 45 vs ~1.4 at 25). Rank-by-relative-change is **embedding-led, not one rogue block**.

## 23. Embedding drift

Tied embeddings. L2 from WRIM-0: 4.38 (25) → 5.81 (35) → 6.34 (40) → **7.01 (45)**. Cosine 0.99972 → 0.99951 → 0.99942 → **0.99930**. Largest absolute component; still globally aligned.

## 24. Output-head drift

Tied to `tok_emb`. Same numbers. No separate `lm_head` tensor.

## 25. KL trend

| Step | mean KL(WRIM-0 ‖ current) on 1008 positions |
|---:|---:|
| 0 | 0 |
| 10 | 0.049 |
| 25 | 0.057 |
| 35 | 0.073 |
| 40 | 0.070 |
| 45 | 0.077 |

Smooth; **slight dip 35→40**. Collapse is **not** a KL explosion. Per-source KL: **not measured**.

## 26. Entropy trend

6.21 (25) → 6.15 (30) → 6.08 (35) → 6.00 (40) → **6.41 (45)**. Finite. Rise at 45 is modest, **after** the loss spike. Argmax stays `" not"` (id 206) at 25/35/40/45 — **not** `|` / `.` / `_` on the frozen logit probe.

## 27. Repetition trend

| Step | hello continuation (abbrev.) | collapse |
|---|---|---|
| 25 | `-s::` / Alice-ish | 1/13 |
| 30–40 | `::::` then Queen/literary | 0–1/13 |
| 45 | `-Cs) \| \| \| …` | **4/13** |

Colon runs exist **during the healthy unique-ratio window**. Pipe loop and `B`-runs **appear at 45**, after leftover re-entry. Behavioral collapse is **not fully sudden at 42**, but the **hard gate** ( +2 collapsed probes vs step 0) trips at 45. Unique ratio 0.663 (35) → 0.620 (40) → 0.514 (45).

## 28. Step-35 vs step-45

Step 35: 0/13, unique 0.663, loss 4.31, **100% Austen**, grad 0.426, no clip, KL 0.073.  
Step 45: 4/13, unique 0.514, loss 7.06, **0% rehearsal leftover mix**, grad 0.983, KL 0.077.

What changed after 35: **five more Austen steps**, then **cut into War Room markdown/code/JSON/behavior**. Global cosine still ~0.999. The health at 35 is **in-distribution WRIM-0 prose**, not proven leftover robustness.

## 29. Checkpoint replay

- Step 25 full reload: 13-probe **1/13**, unique **0.591307…** matches historical diagnostic exactly. Weights unused after eval-only (`max_abs = 0`).
- Steps 35/40/45: **cannot replay from tensors**. Historical light JSON is the record. Step 35 remains the **best logged** 13-probe point.

## 30. Python crash finding

macOS IPS `Python-2026-08-30-233008.ips`: **23:30:06 -0400**, **~4 minutes before** training step 1 (`03:34:56Z` = 23:34:56 -0400). PID **46424**, parent **zsh**, **CommandLineTools Python 3.9.6**, lifetime **~1 s**. `EXC_CRASH` / `SIGABRT` / `NSRangeException` in **`mlx::core::metal::Device` constructor** (empty Metal device array). Same class of abort as a sandboxed `import mlx`.

Training job: tmp dirs `*-46862`, **255 s** continuous metrics, **no** NaN/Inf, **completed** through early-stop 45.

**Classification: unrelated / unknown for model failure. Not training-process death.**

Other IPS the same day (18:09–22:44) are the same 3.9.6 + mlx Device abort pattern.

## 31. Memory-pressure finding

No OOM line in metrics. No jetsam in the 23:30 IPS. Configured MLX caps 3 GiB / 256 MiB cache. No SIGKILL of PID 46862. **Insufficient evidence of training OOM.** Do not infer from the popup alone.

## 32. Root-cause classification

| Factor | Class |
|---|---|
| Insufficient global rehearsal % as unique cause | **POSSIBLE** (001 had 38.79% / 176,935 tok and stayed in Austen through 50) but **confounded by locality** |
| Local rehearsal drought before failure | **RULED OUT** (100% through 41) |
| Source-family clustering / giant-unit packing | **STRONGLY SUPPORTED** |
| Specific bad batch / corpus-boundary transition | **STRONGLY SUPPORTED** (step 42 cut; 43 leftover peak) |
| Code batch | **STRONGLY SUPPORTED** as peak-loss domain (43), not as 25–41 cause |
| JSON batch | **POSSIBLE** co-trigger on step 42 (20%), not 25–41 |
| Behavior batch | **RULED OUT** as trigger (0% on 42) |
| EOS / document boundary | **POSSIBLE** co-factor (EOS reappears at 42); not a causal-target bug |
| Causal target bug | **RULED OUT** |
| Mask bug | **RULED OUT** for the first spike (no mask on 42); behavior mask still correct at unit audit |
| LR peak / scheduler jump | **RULED OUT** as a discontinuity at 42; peak sits **inside** Austen |
| Gradient spike | **STRONGLY SUPPORTED** as **correlated** with leftover batches; **not** an independent explosion |
| Optimizer-moment instability / corruption | **INSUFFICIENT EVIDENCE** at 45; step-25 moments healthy; specialization **POSSIBLE** |
| Weight decay | **INSUFFICIENT EVIDENCE** (unchanged; no isolated ablation) |
| Embedding / output-head drift | **POSSIBLE** slow (largest L2) but **not** a cosine collapse |
| Specific layer drift | **RULED OUT** as unique cosine failure |
| Numerical instability (NaN/Inf) | **RULED OUT** |
| Runtime / Python crash | **RULED OUT** as training interrupt |
| Memory pressure | **INSUFFICIENT EVIDENCE** / **unrelated** to logged run |
| Model capacity (20M vs leftover code/tables) | **POSSIBLE** background; leftover CE ~7.5 even at step 25 |
| Trainer/runtime checkpoint corruption | **RULED OUT** for this run (continuous, reloadable 25) |

## 33. Most likely explanation

**Document-scale rehearsal packing + unit shuffle produced a ~28-step contiguous Pride and Prejudice binge (steps 14–41), which is WRIM-0’s native distribution. Probe health at 35 is that binge. Step 42 is the first leftover window after the truncated novel ends. Train loss and grad return to leftover-domain values (~7.5 CE, grad ≳1). Generation then shows leftover+Austen interference (`|` loops, `B` runs). Global 30% rehearsal did not interleave; it arrived as one 115k-token unit.**

This is outcome **A + C in reverse** (boundary event + clustering), not a mysterious LR cliff.

001 surviving 50 is consistent with a **longer** Austen unit (176,935 tokens) still in-stream at step 50. 001 later failed at 100 once leftover dominated again.

## 34. What is ruled out

Causal shuffle, mask bug as the 42 trigger, behavior as the 42 trigger, local rehearsal drought, scheduler discontinuity, NaN/Inf, training-process crash/OOM, single-layer cosine collapse, KL explosion, “clip every bad batch” as the start of failure.

## 35. Exact next TEST_ONLY recommendation

**Do not raise rehearsal % as the first follow-up.** That would likely only **lengthen the Austen binge** (001 already did).

**Highest-information next variable: rehearsal locality / unit grain.**

TEST_ONLY proposal (not authorized here):

- Keep Recovery-004 mix targets: **30% token-capped rehearsal**, 001-relative leftover, peak **3e-4**, warmup 25, cosine horizon 150, 50 steps, same seed **except packing**.
- Change **one** thing: split WR-CORPUS-0 rehearsal into **contiguous windows ≤ 512 (or ≤ 2048) tokens** (preserve token order inside windows; EOS at window ends), **then** `permute_unit_order` with leftover units.
- Prove local rehearsal % in every 5-step window is near 30% ± a stated band (not 100% then 0%).
- Instrument per-batch source %.
- Still TEST_ONLY; do not overwrite 001–004.

That is a **shuffle/rehearsal-distribution** test (Commander option C), not an optimizer test yet.

If that run stays healthy through leftover **and** 50 steps, rehearsal **share** can be re-tested. If it still dies at leftover, then optimizer/LR/capacity.

## 36. Whether Recovery-005 is ready for Commander authorization

**No.** Recovery-005 is **not** authorized and **should not** start until Commander accepts the interleave design (or explicitly chooses a different single variable). Official WRIM1-RUN-000002 remains **not ready**.

---

## FINAL VERDICT

**WRIM-1.1 RECOVERY-004 FORENSIC DIAGNOSIS — PASS**

NO TRAINING  
NO RECOVERY-005  
NO WRIM1-RUN-000002  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — none (no UI). Read `docs/WRIM1_1_RECOVERY_004_STEP45_FORENSIC_DIAGNOSIS.md` and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45/`.
5. Expected successful output — forensic PASS document; Recovery-004 still FAIL.
6. Feature flags enabled/disabled — none.
7. What should visibly change in UI — nothing.
8. Safe rollback — delete only the `TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45/` directory and this diagnosis doc if needed. Do **not** delete Recovery-001–004.
