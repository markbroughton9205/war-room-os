# WRIM-1.1 CAPABILITY CURRICULUM REVIEW

Date: 2026-08-31  
Mission: WRIM-1.1 capability curriculum + clean held-out eval. **NO TRAINING.**

Authoritative repo: `/Users/markbroughton/Developer/war-room-os`

---

## Verdict

# WRIM-1.1 CAPABILITY CURRICULUM — READY

READY means there is enough **curriculum signal** and **clean evaluation infrastructure** to design or authorize the next official candidate **rationally**.

READY does **not** authorize training.  
`WRIM1-RUN-000002` — **NOT AUTHORIZED**  
Recovery-008 — **NOT STARTED**  
Production — **UNTOUCHED**  
Git — **no commit/push this mission**

---

## 1. Capability registry

CAP-01 … CAP-10 as in `docs/WRIM1_1_CAPABILITY_CURRICULUM_DESIGN.md`. No AGI/smarter labels. No extra IDs.

## 2. Priorities

- **P0:** CAP-01, CAP-02, CAP-03, CAP-05, CAP-06, CAP-07, CAP-10  
- **P1:** CAP-04, CAP-08 (understanding, not live tools)  
- **P2:** CAP-09 (Commander corrections = 0)

## 3. Current (pre-this-mission) signal deficiencies

Confirmed from official candidate review: 31 behaviors / 339 targets / 17 `pass`; 3 gyms / 16 masked tool tokens; 0 Commander corrections; 0 Terra; Wave 8.1 dirty; 13 probes = stability only.

## 4. Proposed composition (materialized TEST/DESIGN pack)

686,070 unique tokens: 180k rehearsal (26.2%) + 212k quality prose + 178k quality code + 116k supervised units. Dump JSON leftover **excluded** by filter.

## 5. Trainable target accounting

Prompt **71,026** / target **44,857** (WR-TOKENIZER-0). Family table in the design doc.

## 6–10. Category target tokens

| Category | Examples | Target tokens |
|---|---:|---:|
| Behavior / instruction | 147 | 11,718 |
| Tool-use | 88 | 6,098 |
| JSON | 84 | 9,003 |
| War Room concepts | 45 | 4,623 |
| Evidence/uncertainty | 64 | 6,758 |
| Correction (synthetic) | 48 | 2,556 |
| Code supervised | 70 | 4,101 |

## 11. Rehearsal

**25% budget / 180k tokens (26.2% of actual pack).** DESIGN HYPOTHESIS. 007’s 30% remains the stability inheritance option if Commander forbids mix change.

## 12. Prose

Inclusion/exclusion rules in the design doc. Original artifacts not deleted.

## 13. Code

Quality-filtered leftover + 70 complete-function drills. Locks/minified/migrations/hash dumps deprioritized.

## 14. Total candidate token budget

**686,070 unique packed tokens.** Not 400k, not 5M, not two WRIM-1 epochs.

## 15. Planned exposures

**3.0** unique-pack epochs → **502** steps × 4,096 = **2,056,192** tokens seen (~3.00 epochs of 686,070). Supervised targets seen ≈ 44,857 × 3 ≈ **134.6k**.

## 16. Clean eval identity

**WRIM-1.1-CAP-EVAL-0** at `model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/`.

## 17. Eval family counts

86 items: LANG 8, INSTRUCT 12, JSON 10, CODE 8, WR 12, EVIDENCE 12, TOOL 10, CORRECTION 8, RETENTION 6.

## 18. Leakage protections

Exact / normalized / substring / template / near-dup. **0 known hits** vs this curriculum. Packer excludes `eval-only`. Training blocked if later scan > 0.

## 19. Deterministic scoring

JSON parse/schema; code compile/exec; CLASS=; tool_call JSON; instruction contains/forbid/regex; language diagnostics. No single aggregate as the official grade.

## 20. WRIM-0 baseline status

**RECORDED.** 18/86 overall. JSON 0/10, CODE 0/8, EVIDENCE 0/12, TOOL 0/10. LANG 7/8, RETENTION 6/6. Checkpoint SHA unchanged. Inference-only.

## 21. Capability delta gates

≥1 P0 meaningful lift; no catastrophic collapse; 0 leakage; reload; no unacceptable P0 regression; loss/KL/completion insufficient. Schema on disk.

## 22. Memorization / generalization

Independent eval wording; leak 0; L2/L3 applied items.

## 23. Provenance

Per-item source_type, identity, synthetic vs observed, generated_by, family, train/eval flag.

## 24. Synthetic / real labeling

Synthetic curriculum labeled. Commander corrections **not** claimed. Gym-derived tool-failure redirects labeled synthetic.

## 25. Curriculum validator

**14/14 passed** (`validator.json`). Derived evidence, not hardcoded `ready=true`.

## 26. Proposed official duration

**502 steps**, cosine horizon **502**, warmup **25**. Calculated from pack × 3.0 / 4096.

## 27. Proposed LR

Peak **3e-5**, floor **~3e-6**, AdamW 0.9/0.95, WD 0.1. **Do not raise.** No LR experiment this mission.

## 28. Official design changes

`docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md` now points at this curriculum, WRIM-1.1-CAP-EVAL-0, WRIM-0 baseline, 502-step budget, 3e-5, capability gates. Still **not execute**.

## 29. Missing evidence

1. 25% vs 30% rehearsal is **not** TEST_ONLY-proven.  
2. Whether 3e-5 × 502 steps **acquires** P0 skills is unknown until a future authorized run.  
3. 19.2M capacity bottleneck: **INSUFFICIENT EVIDENCE**.  
4. Commander corrections still 0; P2 correction gains optional.  
5. Terra still 0; not a WRIM-1.1 target.  
6. Interleave of this **new** mix not re-run (would be training). Official execute should keep 2048-token deficit interleave from 005–007.  
7. Quality leftover is still code-heavy in the **inventory** (2.85M code vs 0.67M prose available); the **pack** is not code-dominated.

## 30. Readiness verdict

**WRIM-1.1 CAPABILITY CURRICULUM — READY** (design/eval infrastructure).  
Official training remains **LOCKED** until a separate Commander authorization names `WRIM1-RUN-000002`.
