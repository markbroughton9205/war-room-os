# WRIM-1.1 RECOVERY DESIGN — UPDATED AFTER RECOVERY-010

Date: 2026-08-31  

TEST_ONLY `TEST-WRIM1.1-RECOVERY-001` — FAIL (step 100).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-002` — FAIL (step 25).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-003` — FAIL (step 25, 11/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-004` — FAIL (step 45, 4/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-004` forensics — PASS (diagnosis only).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-005` — FAIL (step 30, 7/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-006` — PASS (50/50 mixed steps, 2/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-007` — PASS (150/150 mixed steps, 3/13).  
Official `WRIM1-RUN-000002` — FAIL (step 100/502, 4/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-008` — FAIL (step 120/250, 4/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-008` forensics — PASS (diagnosis only).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-009` — FAIL (step 75/250, 4/13).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-010` — **PASS** (250/250, 3/13 at end).  
TEST_ONLY `TEST-WRIM1.1-RECOVERY-011` — **FAIL** (step 120/250, 4/13).  

See `docs/WRIM1_1_RECOVERY_010_TOOL_USE_ISOLATION_REPORT.md`.  
See `docs/WRIM1_1_RECOVERY_011_COMPACT_TOOL_INTENT_REPORT.md`.

## What is now fixed and must stay fixed

- Contiguous causal windows (no token shuffle). `y[t]==x[t+1]` proved through 007.  
- EOS at independent source units. No extra BOS/EOS policy.  
- Held-out prompt scan = 0 before train.  
- Behavior response-only mask (6650/6650).  
- WRIM-0 exact load (`max_abs_diff = 0`).  
- Rehearsal token-capped. Leftover preserves **001 relative shares**.  
- Deficit interleave of 2048-token windows; rolling 5/10-step rehearsal ~30%; longest 100% rehearsal run **0**.  
- Packed streams 005 = 006 = 007 (byte-identical).  
- Peak LR **3e-5**, warmup 25, cosine horizon **150** as defined in 006 (007 trained that full horizon; it did not stretch a 50-step cosine).  
- Official 000002 then stretched that cosine to **502** on the capability pack. Recovery-008 isolated that variable.

## What 007 showed

Exact 006 recipe from WRIM-0, duration only: 50 → 150.

- First 50 steps reproduced 006 (collapse/unique/loss/sky exact).  
- Completed 150/150. Early stop did not fire.  
- Collapse 2/13 through 50, 1/13 at 75, **3/13** at 100–150 (near WRIM-0).  
- KL 0.025 at 50 → **0.036 at 150** (flattening). Param L2 2.75 → **5.00** (decelerating).  
- Domain CE gap remains (~4.5 vs ~7.1–7.8). Leftover CE did not explode.  
- Capability: unchanged to slightly regressed. Not smarter.

Interpretation: 50-step stability was not a short-horizon fluke. 150-step mixed endurance holds at 3e-5. Slow drift exists; 005-style collapse does not.

## What 008 showed

Same capability stream as WRIM1-RUN-000002 (byte-identical first 100 steps). Only LR: Recovery-007 cosine through 150, then planned floor hold through 250.

- Step 100: collapse **2/13** vs official **4/13**; LR 1.27e-5 vs 2.84e-5; unique 0.430 vs 0.346. Continued.  
- Early stop **step 120** at **4/13** with the same underscore / `_not_` loop class. Floor hold never reached.  
- Cap-eval 18/86 at 0 and 100 (no family movement).

Interpretation: stretched 502-step cosine made official step-100 worse, but the 150-step Recovery-007 decay **does not** make this capability curriculum stable. Curriculum/objective distribution is now the stronger suspect. LR-horizon hypothesis: **NOT SUFFICIENT**.

## What 009 showed

Same LR as 008. Same supervised families (including 70 code-supervised examples). Only leftover QUALITY_CODE windows replaced 1:1 with WR-CORPUS-0 rehearsal (178,129 tokens). Pack length unchanged. Non-code windows byte-identical.

- QUALITY_CODE leftover batches: **0**.  
- Early stop **step 75** at **4/13** with underscore / `-lab` loops.  
- At step 75, 009 was **worse** than 008 (4/13 vs 1/13; unique 0.313 vs 0.462).  
- Cap-eval only at 0: 18/86.

Interpretation: H1 QUALITY_CODE-as-primary-driver is **NOT SUFFICIENT**. Do not automatically delete code from future training. Remaining suspects after 009: tool_use (H2), CAUSAL/MIXED switching (H3), rehearsal overshoot to 52%, QUALITY_PROSE, or an interaction.

## What 010 showed

Same Recovery-008 mix and LR/optimizer. Only TOOL_USE supervised windows (88 examples, 6,098 target tokens, 23,415 window tokens) replaced 1:1 with WR-CORPUS-0 rehearsal. QUALITY_CODE leftover **retained**. Held-out TOOL eval **unchanged** (10 items).

- TOOL_USE training batches: **0**.  
- Completed **250/250**. Early stop did not fire.  
- Collapse stayed **1–3/13** (3/13 at 120 where 008 hit 4/13 STOP; 1/13 at 75 where 009 hit 4/13 STOP).  
- Residual sky `_not_` / `-lab` traces remain but did not become a 4/13 suite collapse.  
- Cap-eval 18–20/86; TOOL held-out 0/10 throughout.  
- CAUSAL↔MIXED switcher unchanged; observed **158** switches (008 planned 204).

Interpretation: H2 TOOL_USE supervised interaction is **strongly supported** as the variable that had been sufficient to trigger the 008/009 early-stop. **Do not permanently remove tools.** Future work (not authorized) should diversify/phase/reweight tool templates. H3 is **not eliminated**. WRIM1-RUN-000003 is **not** authorized by this PASS.

## Official identity (blocked)

WRIM-1.1 / **WRIM1-RUN-000002** — executed; FAIL. **WRIM1-RUN-000003** — not authorized. Start only from WRIM-0. Never from recovery checkpoints.

## What 011 showed

Same Recovery-010 mix geometry, LR, optimizer, parent WRIM-0, QUALITY_CODE leftover, and CAUSAL↔MIXED switcher. Only the 88 former V1 tool slots received compact V2 (`TOOL=` lines, 1,694 target tokens) plus 5,857 rehearsal pad tokens so pack length stayed 686,070.

- V2 validator 16/16. Leak 0 vs CAP-EVAL-0 and TOOL-EVAL-1. Causal/mask/gradient gates PASS.  
- Through step 50, collapse/unique/loss matched Recovery-010.  
- Early stop **step 120** at **4/13** with underscore-loop corroboration — the Recovery-008 failure step. Recovery-010 was 3/13 there and finished 250.  
- TOOL-EVAL-1 **0/12** at 0/75/100/120. TOOL_V2 train CE declined (7.16 → 6.25 on observed batches) without held-out gain.  
- Batch incidence of tool slots remained **~29%** because window occupancy was preserved.

Interpretation: compact representation **reduces target mass** but is **NOT SUFFICIENT** to restore 010 stability when V2 occupies the same schedule. Do not permanently abandon compact intent; do not automatically start weighting/staging/H3. WRIM1-RUN-000003 is **not** authorized.

## Recovery-011 (executed)

See `docs/WRIM1_1_RECOVERY_011_COMPACT_TOOL_INTENT_REPORT.md`. Variable **A** only. **FAIL**.

## Next (not authorized here)

**Recovery-012 is not authorized. WRIM1-RUN-000003 is not authorized.** Compact-intent **routing** now exists as Modular Intelligence Phase 1 (`docs/WAR_ROOM_MODULAR_INTELLIGENCE_PHASE1.md`) without training a tool adapter. Return 011 results to Commander. STOP.

## Success bar for any later official run

Survive interleaved mixed continued pretrain without suite-wide symbol-loop collapse, at peak LR **no higher than 3e-5** unless a new experiment says otherwise. Do not assume a 502-step stretched cosine is proven. Do not assume a 150-step cosine + floor is enough for the capability pack. Promotion remains a later, separate instruction.
