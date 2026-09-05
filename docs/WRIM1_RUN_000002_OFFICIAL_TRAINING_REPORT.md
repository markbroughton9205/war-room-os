# WRIM1-RUN-000002 — OFFICIAL TRAINING REPORT

Date: 2026-08-31  
Authorization: Commander official training for `WRIM1-RUN-000002` only. Promotion separate. Production forbidden.

## FINAL RUN VERDICT

**WRIM1-RUN-000002 — FAIL**

**WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0**  
**PROMOTION — REJECTED** (not executed)

Training stopped at **step 100 / 502** on the approved 13-probe stability gate: collapsed probes **4/13** vs step-0 **2/13** (`collapsed probes materially exceed step-0`). Checkpoints 0/25/50/100 reload. 0 known eval leakage. No Python/MLX crash. WRIM-0 and production untouched.

---

## 1. Run ID

`WRIM1-RUN-000002`

## 2. Official / test status

**Official candidate training run.** Not TEST_ONLY Recovery. Not promoted. Not production.

Artifacts: `model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002/`  
Runner: `scripts/wrim1-training/run_wrim1_run_000002.py`  
Packer: `scripts/wrim1-training/pack_wrim1_run_000002.py`

## 3. Parent ID + SHA

**WRIM-0**  
`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

Path: `model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors`  
Not a Recovery checkpoint.

## 4. Tokenizer ID + SHA

**WR-TOKENIZER-0**  
`47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 5. Curriculum ID

**WR-CORPUS-1.1-CAPABILITY-CANDIDATE**

## 6. Curriculum artifact hash

Design pack `content_sha256` (unit-permuted design materialization): `4c760d0e4f90b06c2685369da38c5c8b742f1a814f2e19d1b7f2b34ab5a4a974`  
Official **interleaved** train stream SHA-256: `d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291`  
Unique pack tokens: **686,070** (match). Official packing used 2048-token deficit FIFO interleave instead of design-time unit permutation; token multiset unchanged.

## 7. Eval ID

**WRIM-1.1-CAP-EVAL-0**  
`EXCLUDE_FROM_TRAINING=true` (`model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/SUITE_README.txt`)  
13-probe suite used **DIAGNOSTIC_ONLY**. Wave 8.1 not used as proof.

## 8. Eval artifact hash

`suite.json` SHA-256: `f27dd64bcc245e228a8e4f18bfd95fcd7d0ee7c32cfdee5d8d40519fd1c1406d`

## 9. Python executable / version

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Resolved: Homebrew CPython **3.12.14** arm64 (not `/usr/bin/python3`, not CLT 3.9).

## 10. MLX version / device

MLX **0.32.2**. Device **`Device(gpu, 0)`**. Metal available.

## 11. Architecture / parameter count

WRIM-G-20M-v1-option-A. **19,217,152** params. Unchanged.

## 12. Optimizer config

AdamW. β1=0.9 β2=0.95 ε=1e-8 weight decay 0.1 clip 1.0. Fresh optimizer state. Peak LR 3e-5.

## 13. LR schedule

`linear_warmup_cosine_decay`. Warmup **25**. Cosine horizon **502**. Floor **3e-6**. No step exceeded 3e-5. Logged every trained step.

## 14. Total planned steps

**502**

## 15. Total completed steps

**100** (early stop)

## 16. Total tokens seen

**409,600** (100 × 4096). Planned 2,056,192 not reached.

## 17. Interruption / resume history

None. No crash. No resume. Early stop was a stability gate, not a process interrupt.

## 18. Training wall time

Process ~**1338 s**. Inner `elapsed_sec` **950.6 s** (includes step-0 diagnostics + step-0 cap-eval + 100 optimizer steps).

## 19. Checkpoint list

Atomic bundles:

| Step | Model SHA-256 |
|---:|---|
| 0 | `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` (exact WRIM-0 tree) |
| 25 | `7bea570bb18c2bdcd3d37450e94e6ccd30e61ac7460504d1a057a68b2b3eb0a7` |
| 50 | `d70c1633dbd6ef272ee4252005270f2c7d7a2b30a12fbc1930ad23c26dbe6006` |
| 100 | `71198d968f3734ef4f426360efb745b7ef49d589520563fa674a356e960534c5` |

Each bundle includes weights, optimizer, optimizer config, RNG, scheduler, dataset cursor, metrics snapshot, run manifest, identities.

## 20. Final checkpoint SHA

Terminal complete checkpoint (step 100): `71198d968f3734ef4f426360efb745b7ef49d589520563fa674a356e960534c5`

## 21. Packing proof

Contiguous windows; no token permutation. Interleave unit-order-only **passed** (`unit_order_changed=true`, 1444 windows). Global mix: rehearsal **26.2364%** (180,000), prose **30.9091%**, code **25.9637%**, supervised **16.8908%**. Longest 100% rehearsal-only run: **0**.

## 22. Mask proof

Supervised 546 units: 115,883 mask tokens OK, 0 bad. Prompt tokens **71,026**. Supervised target tokens **44,857**. Masked **71,026**. Trainable **615,044**. LM units full-causal **898**.

## 23. Tool-target proof

84 tool units with `<tool_call>` after `<|assistant|>`. Gradient-bearing assistant span **84**. Prompt-span tool JSON **0**. Masked-tool failures **0**.

## 24. Causal target proof

`y[t]==x[t+1]` mismatches **0** (12 batches / 96 rows). Hard gate passed.

## 25. Leakage result

**0** known hits vs WRIM-1.1-CAP-EVAL-0 on the **actual** packed stream (prompt-list + leak_scan). Example-level leak also 0.

## 26. Global mix

See §21. Matches authorized ~26.2% rehearsal / ~212k prose / ~178k code / ~116k supervised units.

## 27. Local mix behavior

First batch mixed rehearsal/prose/code/supervised (50% / 24.8% / 15.9% / 9.3%). Longest dominant-family run in planned 502-step map: 4 steps. No Austen-style binge.

## 28. Source-local CE

Rehearsal CE stayed ~3.9–4.6 when present. Prose/code/supervised CE ~6.7–8.1 early, ~6.7–7.6 by step 100. Supervised not silent (targets receive gradient).

## 29. Train-loss curve

Step 1 mixed-domain losses ~6–8. Step 25 **7.69**. Step 50 **6.35**. Step 100 **5.74** (that batch 50% rehearsal). Loss reduction occurred; insufficient for promotion.

## 30. Validation-loss curve

Step 0 **7.753**. Step 25 **7.530**. Step 50 **7.302**. Step 100 **7.034**. Hardened-corpus val, not CAP-EVAL-0.

## 31. Gradient trend

Finite throughout. Step 100 global grad L2 **0.734**. No pathological explosion vs step-0 class.

## 32. Clip events

**20** clip events (`clip-events.json`). Not the stop cause.

## 33. Collapse trend (13-probe, DIAGNOSTIC_ONLY)

| Step | Collapsed | Unique ratio |
|---:|---:|---:|
| 0 | 2/13 | 0.397 |
| 10 | 2/13 | 0.416 |
| 20–80 | 1/13 | 0.36–0.48 |
| 90 | 2/13 | 0.413 |
| 100 | **4/13** | 0.346 |

Step 100 collapsed probes: `d0-prose-sky`, `d0-hello`, `d0-punct`, `d0-qa-ctx` (underscore / `-lab` / `##` loops). Not Recovery-005’s 7/13, but **≥ step-0 + 2** (design §6A). Unique ratio not below 0.5× WRIM-0.

## 34. Unique-ratio trend

See §33. Mild drop at 100; not the 0.5× kill line.

## 35. Repetition trend

Step 100 sky: ` not been a\n_not__________________________` (underscore run 26). P(".") **0.0026**, P("|") **0.0011**, P("_") **0.0054**. Argmax token ` not` (not `.` / `|` / `_`).

## 36. KL trend

KL(WRIM-0 ∥ candidate): 0 → 0.017 (25) → 0.034 (50) → **0.042** (100). Observational only.

## 37. Parameter-drift trend

Global L2 from WRIM-0 at 100: **5.280**. Relative **0.020**.

## 38. Per-layer drift

Per-layer cosine to WRIM-0 at 100 remains **~0.9997**. Embedding drift present; tied head equals embedding by architecture.

## 39. Step-0 capability scores

**18/86** — matches frozen WRIM-0 baseline exactly by family (LANG 7/8, RETENTION 6/6, INSTRUCT 3/12, WR 1/12, CORRECTION 1/8, JSON/CODE/EVIDENCE/TOOL 0).

## 40–43. Steps 150 / 300 / 400 / 502 capability scores

**Not reached.** Run stopped at 100.

## 44. WRIM-0 vs terminal candidate (step 100, extra inference)

Held-out on WRIM-1.1-CAP-EVAL-0 after checkpoint reload: **19/86**.

| Family | Baseline | Step 100 | Δ |
|---|---|---|---:|
| LANG | 7/8 | 8/8 | +1 |
| INSTRUCT | 3/12 | 3/12 | 0 |
| JSON | 0/10 | 0/10 | 0 |
| CODE | 0/8 | 0/8 | 0 |
| WR | 1/12 | 2/12 | +1 |
| EVIDENCE | 0/12 | 0/12 | 0 |
| TOOL | 0/10 | 0/10 | 0 |
| CORRECTION | 1/8 | 1/8 | 0 |
| RETENTION | 6/6 | 5/6 | −1 (`cap0-ret-06`) |

## 45. P0 improvements

None **meaningful** (+≥2 on n≥8, or JSON 0→≥2). LANG +1 and WR +1 are below the bar.

## 46. P0 / sentinel regressions

RETENTION **6/6 → 5/6**. LANG did not regress.

## 47. P1 improvements / regressions

CODE 0/8, TOOL 0/10. Unchanged.

## 48. Generalization evidence

Insufficient. No P0 family cleared the meaningful-improvement bar. JSON/evidence/tool remain 0.

## 49. Checkpoint reload verification

Steps 0, 25, 50, 100: SHA match after reload. Step 0 tree SHA equals WRIM-0. Step 100 cap-eval used a fresh reload.

## 50. Python / MLX crash status

**No crash.** `crash.crashed=false`. NaN/Inf: false.

## 51. Candidate capability verdict

**WRIM-1.1 CANDIDATE — NOT BETTER THAN WRIM-0**

## 52. Promotion recommendation

**PROMOTION — REJECTED**

## 53. Production status

Untouched. `/Users/markbroughton/WarRoomNode01` not written. WRIM-0 SHA unchanged after the run. WRIM1-RUN-000001 registry mtime unchanged. Active Ra’el weights not renamed.

## 54. Git status

Inspect only. No commit, push, merge, rebase, reset, or clean. Working tree remains dirty (~227 porcelain paths including this run’s artifacts).

## 55. Exact next recommendation

Do **not** deploy. Do **not** promote. Do **not** start WRIM-1.2. Do **not** silently resume 000002 past the fired gate. If Commander wants a full 502-step attempt, that requires a **new named authorization** that either accepts this FAIL as the official 000002 record (recommended) or explicitly amends the collapse stop rule. Scientific takeaway: 3e-5 interleaved capability mix was stable through step 90 (1–2/13) then hit 4/13 at 100 with underscore/`-lab` loops on short probes; acquisition on CAP-EVAL-0 was not demonstrated.

---

## PRE-RUN GATES (all passed before step 1)

1. Python environment  
2. Parent SHA  
3. Tokenizer SHA  
4. Exact WRIM-0 load (`max_abs_diff=0`)  
5. Curriculum identity (686,070 tokens; 0 commander corrections; 0 Terra)  
6. Curriculum validator  
7. Held-out exclusion  
8–9. Packed-stream leak scan **0**  
10. Mask correctness  
11. Tool targets gradient-bearing  
12. Causal `y[t]==x[t+1]`  
13. Contiguous-unit interleave  
14. First-batch source map recorded  
15. Parent is not Recovery  
16. Production path unused  

## Commander / Terra honesty

Commander correction examples: **0** (not fabricated). Terra training observations: **0** (not fabricated).

---

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.** Do not restart production.
4. Verification URLs/routes — **No operator action required.** Evidence is under `model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002/` and `docs/WRIM1_RUN_000002_OFFICIAL_TRAINING_REPORT.md`.
5. Expected successful output — This run is **FAIL** at 100/502. Do not expect an active-model change.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Candidate is not promoted.
8. Safe rollback instruction if needed — **No operator action required.** WRIM-0 and production were not modified. Discarding candidate checkpoints does not affect the active model.
