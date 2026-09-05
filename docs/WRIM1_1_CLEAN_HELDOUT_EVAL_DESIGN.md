# WRIM-1.1 CLEAN HELD-OUT EVAL DESIGN

Date: 2026-08-31  
Status: **EVAL-ONLY — EXCLUDE_FROM_TRAINING=true — NOT WAVE 8.1**

Identity: **`WRIM-1.1-CAP-EVAL-0`**

Path (do not ingest): `model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/`

Wave 8.1 `held-out-eval-suite.json` is **contaminated** (eval-spec strings in hardened train shards) and **must not** be reused as official capability proof. The 13-probe suite remains **`DIAGNOSTIC_ONLY` / `held_out: false`** for collapse/stability.

This document does **not** paste eval prompts (they must not enter `docs/` corpus ingest).

---

## 1. Separation

| Rule | Implementation |
|---|---|
| Not in training shards | Suite is not under `model-lab/corpora/` |
| Not in training reports as prompt copies | Prompts live only under `eval-only/` |
| Packer exclusion | `contiguous_pack.py` markers: `eval-only`, `WRIM-1.1-CAP-EVAL-0`, `EXCLUDE_FROM_TRAINING` |
| Every item | `EXCLUDE_FROM_TRAINING=true`, `held_out=true`, `kind=CAPABILITY_HELDOUT` |
| Independent generation | Train builders and eval lists use different names, IDs, schemas, and stems |

Training **must not start** if known eval leakage > 0.

---

## 2. Leakage defense

Scanner: `capability_curriculum_lib.leak_scan` (run at materialize).

Checks:

- exact prompt match
- normalized prompt match (NFKC, casefold, whitespace)
- full response match against train targets
- substring collisions for distinctive phrases ≥40 characters
- template/argument collisions for long distinctive tool strings
- near-duplicate Jaccard after boilerplate stoplist (shared distinctive tokens)

Last materialize vs this curriculum pack: **known_eval_leakage = 0**.

Future official packing must re-scan the **byte train stream of that run**, including leftover LM, against `eval-only/WRIM-1.1-CAP-EVAL-0/prompt-list.json`.

---

## 3. Families and counts (86 items)

| Family | n | Capability | Scorer class |
|---|---:|---|---|
| EVAL-LANG | 8 | CAP-01, CAP-10 | language-diagnostics |
| EVAL-INSTRUCT | 12 | CAP-02 | exact-contains / regex / forbid-tokens |
| EVAL-JSON | 10 | CAP-03 | json-schema (parse, keys, types, json_only) |
| EVAL-CODE | 8 | CAP-04 | python-syntax / python-exec |
| EVAL-WR | 12 | CAP-05 | exact-contains on paraphrases |
| EVAL-EVIDENCE | 12 | CAP-06, CAP-07 | class-label (`CLASS=`) |
| EVAL-TOOL | 10 | CAP-08 | tool-call (name + args) |
| EVAL-CORRECTION | 8 | CAP-09 | mixed deterministic |
| EVAL-RETENTION | 6 | CAP-01, CAP-10 | language-diagnostics |

Levels: **1 direct / 2 paraphrased / 3 applied-compositional** are mixed inside families. A model that only recites train definitions should fail L2/L3.

---

## 4. Deterministic scoring

Do **not** hide judgments behind one aggregate number. Report per-family pass/fail plus artifacts.

| Family | Metrics |
|---|---|
| JSON | parseable; required keys; value types; no extra prose when JSON-only |
| Code | `compile`; optional `exec` of tiny tests; expected return |
| WR / evidence | expected class or required substrings |
| Tool | expected tool / no-tool; argument field match |
| Instruction | bounded rubric (contains / forbid / regex) |
| Language / retention | unique-word ratio, collapse flags, length; keep 13-probe **separate** |

Implementation: `scripts/wrim1-training/capability_curriculum_lib.py` `score_output`.

---

## 5. WRIM-0 baseline (recorded, inference-only)

Command:

```text
.venv-wrim/bin/python scripts/wrim1-training/run_wrim0_cap_eval_baseline.py
```

Loads WRIM-0 `checkpoint-final.safetensors` SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`. **0 optimizer steps.** Checkpoint hash unchanged after run.

Artifact: `model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/wrim0-baseline.json`

Frozen result (greedy, 64 new tokens, seed 0):

| Family | pass/n |
|---|---|
| EVAL-LANG | 7/8 |
| EVAL-INSTRUCT | 3/12 |
| EVAL-JSON | 0/10 |
| EVAL-CODE | 0/8 |
| EVAL-WR | 1/12 |
| EVAL-EVIDENCE | 0/12 |
| EVAL-TOOL | 0/10 |
| EVAL-CORRECTION | 1/8 |
| EVAL-RETENTION | 6/6 |
| **Total** | **18/86** |

This is the baseline a candidate must beat on **at least one P0 family** without unacceptable P0 regression.

Language/retention already “work” as a small literary LM. JSON, code, evidence classes, and tool_call understanding are the honest acquisition gaps.

---

## 6. Better-than-WRIM-0 gates

Required:

1. No catastrophic collapse (13-probe still WRIM-0 class, not 7/13; unique-ratio above 0.5× parent kill line; no suite-wide `.` / `|` loops).
2. 0 known held-out leakage on the **actual** train stream.
3. Checkpoint reloads; eval rerun matches.
4. ≥1 **P0** capability shows meaningful held-out improvement vs this baseline.
5. Other P0 families: no unacceptable regression (schema: relative pass-rate drop ≥30% when baseline > 0).
6. Gains reproducible from the same checkpoint.
7. Training loss reduction alone does **not** qualify.
8. KL or parameter L2 alone does **not** qualify.
9. Completing N steps alone does **not** qualify.

Do **not** require every capability to improve. Do **not** require P1/P2.

**Meaningful improvement (design):** +≥2 deterministic item passes on a P0 family with n≥8, **or** JSON parseable count from 0 to ≥2.

Delta schema: `model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/delta-report-schema.json`.

---

## 7. Generalization

Train vs eval: different proper nouns, function names, JSON keys, tool phrases, and incident cards. Leak scanner reported **0** near-duplicates after stoplist. Code train stems (`drill_*` helpers) are not copies of the held-out function names.

---

## 8. Collapse diagnostic stays separate

`WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED` (13 probes): stability only. Never merge its meaning with WRIM-1.1-CAP-EVAL-0.

---

## 9. Official eval command (future candidate; do not run training)

1. Confirm leak scan 0 on packed stream vs `prompt-list.json`.
2. Run the same greedy protocol as the WRIM-0 baseline on the candidate checkpoint.
3. Emit a delta report (baseline vs candidate) per family and per P0 capability.
4. Run 13 probes as DIAGNOSTIC_ONLY.

`evaluate_wrim1.py` still points at Wave 8.1; **do not** use it as proof. A future official eval runner should consume `WRIM-1.1-CAP-EVAL-0` only after Commander authorizes an official run.
