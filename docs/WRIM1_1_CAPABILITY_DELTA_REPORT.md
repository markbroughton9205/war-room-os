# WRIM-1.1 CAPABILITY DELTA REPORT

Date: 2026-08-31  
Suite: **WRIM-1.1-CAP-EVAL-0** only  
Collapse suite: **WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED** (stability, not promotion proof)  
Wave 8.1 held-out: **not used**

Parent: WRIM-0 baseline **18/86** (`wrim0-baseline.json`)  
Candidate checkpoint evaluated: step **100** SHA `71198d968f3734ef4f426360efb745b7ef49d589520563fa674a356e960534c5`  
Planned evals at 150/300/400/502: **not taken** (training stopped).

Leakage: **0** known hits on the actual packed train stream.

---

## Overall

| Checkpoint | Pass | vs WRIM-0 |
|---|---:|---|
| WRIM-0 / step 0 | 18/86 | — |
| Step 100 (reload) | 19/86 | +1 |

+1 total is **not** a P0 meaningful improvement.

## Family deltas (step 100 vs frozen WRIM-0)

| Family | Priority | Baseline | Candidate | Δ | Pass examples (candidate) | Regressions |
|---|---|---|---|---:|---|---|
| LANG | P0 | 7/8 | 8/8 | +1 | cap0-lang-01…08 | none |
| INSTRUCT | P0 | 3/12 | 3/12 | 0 | cap0-ins-04, 09, 10 | none |
| JSON | P0 | 0/10 | 0/10 | 0 | — | none |
| WR | P0 | 1/12 | 2/12 | +1 | cap0-wr-02, cap0-wr-08 | none |
| EVIDENCE | P0 | 0/12 | 0/12 | 0 | — | none |
| CODE | P1 | 0/8 | 0/8 | 0 | — | none |
| TOOL | P1 | 0/10 | 0/10 | 0 | — | none |
| CORRECTION | P2 | 1/8 | 1/8 | 0 | cap0-cor-07 | none |
| RETENTION | sentinel | 6/6 | 5/6 | −1 | cap0-ret-01…05 | **cap0-ret-06** |

## Meaningful-improvement test

Definition: +≥2 item passes on a P0 family with n≥8, **or** JSON parseable from 0 to ≥2.

- P0 meaningful improvements: **none**
- JSON still 0/10
- EVIDENCE still 0/12
- INSTRUCT still 3/12

## P0 regressions

LANG improved by 1 (not a regression).  
RETENTION dropped **cap0-ret-06** (`language-poor`, unique-word ratio 0.346). That is an unacceptable sentinel regression relative to WRIM-0’s 6/6 even though the −1 item is <30% relative drop.

## Generalization

No evidence that new supervised mass transferred to clean held-out JSON, tool-call format, or evidence/uncertainty labels. LANG/WR ticks are within noise of a 19.2M model.

## Collapse context (not capability)

13-probe at step 100: **4/13** (step 0 was 2/13). Unique ratio 0.346 vs 0.397. Not 7/13 Recovery-005 class. Training stopped on design gate step-0+2.

## Reproducibility

Step 100 cap-eval was run from a **fresh checkpoint reload** (`eval_wrim1_run_000002_checkpoint.py`). Training-loop live cap-eval at 150+ never ran.

---

## NEXT STEPS FOR OPERATOR

**No operator action required.** This is an evidence report. Do not change production or the active model.
