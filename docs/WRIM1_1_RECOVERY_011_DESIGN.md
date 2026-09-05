# WRIM-1.1 RECOVERY-011 — DESIGN (EXECUTED 2026-08-31)

Date: 2026-08-31  
Later authorization executed TEST_ONLY Recovery-011. Result: **FAIL**. See `docs/WRIM1_1_RECOVERY_011_COMPACT_TOOL_INTENT_REPORT.md`. This file remains the pre-run design record.

Control: **TEST-WRIM1.1-RECOVERY-010** (PASS, 250/250, TOOL_USE removed).  
Parent: **WRIM-0** (not Recovery-008/009/010 weights).  
Forensics: `docs/WRIM1_1_TOOL_USE_CURRICULUM_FORENSICS.md`  
Curriculum: `docs/WRIM1_1_TOOL_USE_CURRICULUM_V2_DESIGN.md`

Proposed identity (when later authorized): `TEST-WRIM1.1-RECOVERY-011`  
Markers: `TEST_ONLY=true`, `NOT_PROMOTABLE=true`, `NOT_OFFICIAL_WRIM_LINEAGE=true`, `NOT_PRODUCTION=true`

---

## 1. Single primary variable

**A. Replace long TOOL_USE JSON targets with compact canonical tool-intent targets.**

Not B (staging-only without representation change).  
Not C (down-weight JSON in place).  
Not D (separate tool phase).

Bounded format change is **inherent** to A (compact `TOOL=` lines instead of `<tool_call>` JSON). Example **count stays 88**. Pack **length stays 686,070** via rehearsal pad in the same 88 window slots.

---

## 2. Control comparison (must hold)

| Knob | Recovery-010 | Recovery-011 (proposed) |
|---|---|---|
| Parent | WRIM-0 | **same** |
| Tokenizer | WR-TOKENIZER-0 | **same** |
| LR | Recovery-008 cosine 150 + floor 3e-6 | **same** |
| Optimizer | AdamW β1=0.9 β2=0.95 ε=1e-8 WD=0.1 clip=1.0 | **same** |
| ctx / batch | 512 / 8 | **same** |
| QUALITY_CODE leftover | retained | **retained** |
| QUALITY_PROSE | retained | **retained** |
| Other supervised families | retained (incl. 8 correction tool_call JSON) | **retained unchanged** |
| Rehearsal | +23,415 vs 008 (full tool window replace) | 008 mix + **pad only** inside tool windows |
| CAUSAL↔MIXED switcher | unchanged algorithm (158 switches in 010) | **unchanged** |
| CAP-EVAL-0 | 86 items incl. 10 TOOL JSON | **unchanged** (control) |
| Leak scan | 0 vs CAP-EVAL-0 | must be 0 vs CAP-EVAL-0 **and** TOOL-EVAL-1 |
| Collapse gate | `collapse_gate_008` | **same** |
| Planned steps | 250 | **250** |
| TOOL_USE representation | **absent** | **compact V2** in the 88 slots |

010 remains the **no-tool stability control**. 011 asks: can a **safer tool representation** re-enter without 008/009 4/13 stops?

---

## 3. What is packed

1. Materialize Recovery-008 / official 000002 interleaved units (byte recipe, not 009 mix).
2. For each of 88 `origin=tool_use` windows: replace tokens with one V2 compact example (response-only mask after `<|assistant|>`) plus **WR-CORPUS-0 unused rehearsal** so `n_tokens` equals the 008 window.
3. Do not re-interleave (same rule as 010).
4. Prove: non-tool windows byte-identical to 008; stream length 686,070; causal `y[t]==x[t+1]`; mask proof; leak 0.

V2 target mass **1,694** tokens (**DESIGN HYPOTHESIS** share ~4.2% of supervised targets if only targets are counted; window pad is rehearsal, not extra tool gradient).

---

## 4. Objective switching

**Leave CAUSAL↔MIXED unchanged.** Recovery-010 passed with 158 switches. Representation must be isolated first. H3 remains a later candidate if 011 still collapses.

---

## 5. Optimizer / architecture / capacity

- Optimizer: **hold**. No new backward during this design mission; 011 if authorized uses the same AdamW.
- Architecture / 19.2M: **not implicated** as a unique TOOL failure mode. Do not scale the model to “fix JSON.”
- Tokenizer: **no change**.

---

## 6. Metrics

Inference-only on the same schedule as 010:

- 13-probe collapse (early stop identical).
- CAP-EVAL-0 including TOOL JSON **10** (expect possible continued 0/10 — do not rewrite gold).
- **WRIM-1.1-TOOL-EVAL-1** compact suite (the acquisition metric for this variable).
- Family CE / grad logs as in 008/010.

Success vs 010 (stability): complete 250 without 4/13.  
Success vs 010 (tools): TOOL-EVAL-1 lift without collapse. CAP-EVAL-0 TOOL JSON is **not** the 011 pass bar.

---

## 7. Explicitly out of scope

- Starting this run.
- WRIM1-RUN-000003.
- Promotion.
- Changing production.
- Combining C/D/H3 into this ID.

---

## 8. Exact next recommendation

**STOP.** Recovery-011 executed and **FAIL**ed. Do not start Recovery-012 or WRIM1-RUN-000003.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** See the Recovery-011 report.
5. Expected successful output — Experiment completed as FAIL at step 120.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.**
8. Safe rollback instruction if needed — Keep Recovery-010. Discard 011 artifacts only if Commander rejects the record.
