# WRIM-1.1 OFFICIAL CANDIDATE TRAINING DESIGN

Date: 2026-08-31  
Status: **EXECUTED — WRIM1-RUN-000002 FAIL (stopped step 100/502). Not promoted.**  
Post-000002 isolation: **TEST-WRIM1.1-RECOVERY-008 FAIL** (stopped step 120/250). Design-only update below. **WRIM1-RUN-000003 is not authorized.**

This document does **not** create `WRIM1-RUN-000002`. It does **not** promote. It does **not** touch production.

Capability curriculum: `docs/WRIM1_1_CAPABILITY_CURRICULUM_DESIGN.md`  
Clean eval: `docs/WRIM1_1_CLEAN_HELDOUT_EVAL_DESIGN.md`  
Review: `docs/WRIM1_1_CAPABILITY_CURRICULUM_REVIEW.md`  
Prior capability-gate audit (stability mix): `docs/WRIM1_1_OFFICIAL_CANDIDATE_CAPABILITY_REVIEW.md`

TEST/DESIGN identities (not official lineage until later Commander authorization):

- `WR-CORPUS-1.1-CAPABILITY-CANDIDATE`
- `WRIM-1.1-CAP-EVAL-0`

---

## Changelog (design document only)

| When | Change | Why |
|---|---|---|
| 2026-08-31 (post Recovery-007) | Initial stability recipe (LR 3e-5, 30% interleaved mix, 13-probe collapse gates, duration unspecified) | Endurance PASS; official execute still blocked |
| 2026-08-31 (capability gate review) | Status → REVISION REQUIRED. Honest 400k mix could not answer acquisition. | Stability ≠ acquisition |
| 2026-08-31 (capability curriculum mission) | Replaced 400k/339-target/Wave-8.1-eval plan with capability curriculum + WRIM-1.1-CAP-EVAL-0 + 502-step budget. Trainer unmodified. No training. | Commander required a scientifically defensible acquisition design |
| 2026-08-31 (post Recovery-008) | DESIGN ONLY. Do not keep cosine horizon = 502 as a proven-stable 3e-5 exposure. Recovery-007 150-step decay + floor is **not** a sufficient drop-in for this pack. | 008 used the exact 000002 stream; healthier at step 100 (2/13 vs 4/13) then the same loop collapse at 120 |

No Recovery trainer was launched. No production change.

---

## 0. Capability learning objective

WRIM-1.1 should become a **stronger small native War Room language model** than WRIM-0, measured on **WRIM-1.1-CAP-EVAL-0**, without Recovery-005-style collapse.

**P0 (must be in the advertised objective):** coherent language (CAP-01, CAP-10), instruction→response (CAP-02), structured JSON (CAP-03), War Room concepts (CAP-05), evidence/uncertainty (CAP-06, CAP-07).

**P1 (trained, not required to improve for candidate success):** simple code (CAP-04), tool-use **understanding** (CAP-08). Not live execution.

**P2:** correction (CAP-09). Commander corrections = **0**.

**Not claimed:** AGI, Council imitation, Terra, autonomous tools, “smarter” anecdotes.

### Operational definition: WRIM-1.1 IS BETTER THAN WRIM-0

All required:

1. No catastrophic collapse (13-probe remains WRIM-0 class, not 7/13; unique-ratio above 0.5× WRIM-0 kill; no suite-wide `.` / `|` loops).
2. **0** known held-out leakage vs WRIM-1.1-CAP-EVAL-0 on the **actual** packed stream.
3. Checkpoint reloads; eval reproducible.
4. ≥1 **P0** family shows **meaningful** held-out improvement vs the frozen WRIM-0 baseline (`wrim0-baseline.json`: **18/86**, JSON **0/10**, evidence **0/12**, instruct **3/12**, WR **1/12**).
5. Other P0 families do not show unacceptable regression.
6. Gains from the same checkpoint, re-eval.
7–9. Loss, KL/L2, and “run finished” are **not** sufficient.

Meaningful improvement: +≥2 item passes on a P0 family with n≥8, **or** JSON parseable from 0 to ≥2.

Wave 8.1 suite is **forbidden** as proof.

---

## 1. What is proposed (still not authorized)

A later official continued-pretrain of WRIM-0 under identity **WRIM1-RUN-000002**, only after a separate Commander authorization that names that run id.

Parent: WRIM-0 SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Tokenizer: WR-TOKENIZER-0 SHA `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`  
Never start from WRIM-1 or Recovery-001–007 checkpoints.

Data: TEST/DESIGN pack `WR-CORPUS-1.1-CAPABILITY-CANDIDATE` (686,070 unique tokens) **or** a Commander-approved rematerialization with leak scan 0.

## 2. Official LR

Peak **3e-5**. Warmup **25**. AdamW β1=0.9 β2=0.95 ε=1e-8 WD=0.1 clip=1.0. Floor **3e-6**. Do not return to 3e-4. Do **not** raise peak LR.

Scheduler (historical 000002 choice): `linear_warmup_cosine_decay` with **`total_steps` = official length (502)**.

**Recovery-008 result (design constraint, not a new run):** that 502-step stretch kept LR near 3e-5 at official step 100 and is implicated in earlier collapse. A 150-step Recovery-007 cosine + 3e-6 floor on the **same** pack still collapsed at step 120. A later official schedule must not assume either “3e-5 is always stable” or “just copy 007’s horizon.” Do not auto-start WRIM1-RUN-000003.

## 3. Official duration (calculated)

| Quantity | Value |
|---|---|
| Unique pack tokens | **686,070** |
| Tokens per step | **4,096** |
| Planned unique-pack epochs | **3.0** |
| Official steps | **502** = round(686070 × 3 / 4096) |
| Tokens seen | **2,056,192** |
| Cosine horizon | **502** |

Not 150 (stability only). Not 1893 (collapsed WRIM-1 length on a different recipe).

## 4. Data / packing

- Rehearsal: **180,000** WR-CORPUS-0 tokens (**25% design budget**; **26.2%** of this pack). DESIGN HYPOTHESIS vs 007’s 30%. Commander may force 30% without discarding supervised units.
- Interleaving: **2048-token** contiguous windows, deficit FIFO (Recovery-005/007 inheritance).
- Context 512, batch 8.
- Supervised: response-only mask after `<|assistant|>`; tool JSON **in** the assistant span.
- Causal `y[t]==x[t+1]`.
- Leak hits vs WRIM-1.1-CAP-EVAL-0 must be **0** before step 1.

Supervised **targets** in this pack: **44,857** (not 339). Tool targets: **6,098** (not 16).

Code leftover in pack ~26% after quality filter. Available inventory is still code-heavy; do not enlarge the pack by dumping migrations/hash tables.

## 5. Checkpoint cadence

Minimum: 0, every 50 official steps, plus final. Retain 0, ~25%, 50%, 75%, final. Save before diagnostic-triggered stop.

## 6. Evaluation gates

### 6A. Collapse diagnostics (not capability)

Frozen original 13 probes. `DIAGNOSTIC_ONLY` / `held_out: false`.

Stop / do not promote if: collapse ≥ 6/13 or collapse ≥ step-0 + 2; unique-ratio < 0.5 × WRIM-0 with degradation; suite-wide loops; NaN/Inf; leak hits; crash.

### 6B. Capability held-out (now exists)

Suite: **WRIM-1.1-CAP-EVAL-0**. WRIM-0 baseline **recorded**. Do not reuse Wave 8.1.

## 7. Promotion rules

Training PASS ≠ promotion. Separate Commander instruction after integrity + uncontaminated held-out + §0. WRIM-1 promotion remains **REJECTED**.

## 8. Environment

`.venv-wrim` only. Python 3.12.x / MLX / `Device(gpu, 0)`.

## 9. What this design does not do

- Does not authorize `WRIM1-RUN-000003`
- Does not change production `/Users/markbroughton/WarRoomNode01`
- Does not raise peak LR
- Does not launch Recovery-009
- Does not redesign architecture (19.2M capacity: INSUFFICIENT EVIDENCE)
- Does not automatically change rehearsal % or supervised mix

## 10. Open Commander choices before execute

1. Do **not** reuse 000002’s cosine=502 without a new isolation result. Recovery-008 failed to prove 150+floor on this pack.  
2. Treat capability curriculum / objective distribution as the primary open scientific question. Do not auto-redesign it here.  
3. Confirm WRIM-1.1-CAP-EVAL-0 as the only capability proof suite.  
4. Authorize any later official run **by a new name** (`WRIM1-RUN-000003` or later) — currently **not** authorized.

Until that authorization, **do not train**.
