# WRIM-1.1 TOOL_USE CURRICULUM V2 — DESIGN ONLY

Date: 2026-08-31  
Status: **DESIGN consumed by TEST_ONLY Recovery-011; NOT_OFFICIAL=true**  
Recovery-011 trained a **copy** of these 88 compact examples inside `WR-CORPUS-1.1-RECOVERY-011-COMPACT-TOOL`. This design directory was **not** rewritten in place. Does **not** overwrite `WRIM-1.1-CAP-EVAL-0`. Original 88 V1 examples remain unmodified.

Identity: `WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN`  
Materialized: `model-lab/manifests/wrim1_1_tool_curriculum/test-design/WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN/`  
Successor eval: `WRIM-1.1-TOOL-EVAL-1` at `model-lab/eval-only/WRIM-1.1-TOOL-EVAL-1/` (`EXCLUDE_FROM_TRAINING=true`)  
Lineage: derived from V1 family design, **not** an in-place edit.

Tokenizer: **unchanged** WR-TOKENIZER-0.

---

## 1. Why V1 fails as a first tool curriculum

See `docs/WRIM1_1_TOOL_USE_CURRICULUM_FORENSICS.md`. Short form:

- 88 synthetic slot-fills of **5** templates.
- **54.5%** `sha256` `<tool_call>` JSON.
- 10 none-examples are one sky question.
- Almost no genuine two-tool selection.
- Eval expects the same verbose JSON; WRIM-0 and trained checkpoints **0/10**.
- Recovery-010: removing the family restored 250-step stability.

V2 changes **representation + semantic diversity**, not model size, LR, or objective switching.

---

## 2. Intended capability (unchanged doctrine)

Not live execution.

Subcapabilities for this stage:

| ID | In Recovery-011 V2? |
|---|---|
| TOOL-01 tool vs no-tool | **Yes** (32 none, including missing-arg) |
| TOOL-02 selection | **Yes** (20 distractor items) |
| TOOL-03 required args | **Yes** (`text`, `note_id`) |
| TOOL-04 structured call | **Yes, compact** — not full JSON |
| TOOL-05 result interpretation | **Deferred** (V1 interpret 12 dropped from this stage) |
| TOOL-06 failure / missing | **Light** (8 gym-derived redirects + 8 missing-arg → none) |

---

## 3. Compact model-internal representation

Canonical target (parseable, bounded):

```
TOOL=sha256
text=storage-is-not-learning
```

```
TOOL=lookup_note
note_id=NOTE-L000
```

```
TOOL=none
```

```
TOOL=none
WHY=missing_required_arg
```

Rules:

- First line `TOOL=<name>` where name ∈ {sha256, lookup_note, none}.
- Further lines `key=value` (no JSON, no `<tool_call>`).
- Deterministic parser: `scripts/wrim1-training/forensic_tool_use_curriculum.py` `parse_compact`.

Measured V2 targets (WR-TOKENIZER-0): **min 9, mean 19.25, max 27** vs V1 mean **69.30**.

---

## 4. Runtime translation architecture

**Separate model intent from provider JSON.**

```
WRIM compact intent
    → War Room Tool Router (future; not in this mission)
        → validate name + required fields
        → map to actual API/JSON/tool schema
        → execute only under existing Commander gates
```

WRIM-1.1 does not need to emit every verbose API byte. Compact form **reduces template noise** while remaining convertible. V1 tools (`sha256`, `lookup_note`, `none`) stay **labeled synthetic abstract schemas**, not claimed War Room production tools.

---

## 5. Curriculum composition (88 examples — matched to V1 count)

| Slice | n | Notes |
|---:|---:|---|
| sha256 compact (paraphrased prompts) | 16 | doctrine phrases; not 36 clones |
| lookup_note paraphrases | 12 | `NOTE-L000`… not V1 `NOTE-000` / eval `NOTE-ZX` |
| none / no-tool (diverse) | 24 | greetings, arithmetic, policy, missing weather, etc. |
| two-tool distractors | 20 | both schemas listed; correct choice determined |
| gym-derived fail-redirect | 8 | labeled `GYM_DERIVED_SYNTHETIC` |
| missing required arg → none | 8 | `WHY=missing_required_arg` |
| **Total** | **88** | |

Provenance: SYNTHETIC_CURRICULUM 80, GYM_FIXTURE 8, REAL TRAJECTORY **0**.

Tool-name balance: sha256 **34 (38.6%)**, none **32 (36.4%)**, lookup_note **22 (25.0%)**. Max share **≤ 55%** (validator).

V1 none count was **10/88 (11%)** — too few and not diverse. V2 none **32/88**.

---

## 6. Token budget (DESIGN HYPOTHESIS)

| | V1 TOOL_USE | V2 compact |
|---|---:|---:|
| Examples | 88 | 88 |
| Target tokens | 6,098 | **1,694** |
| Mean target | 69.30 | **19.25** |
| Unit tokens (prompt+target) | 23,415 | 17,558 |
| % of V1 tool targets | 100 | **27.8** |
| % of supervised targets if swapped | 13.59 | **4.19** |

Floors/ceilings below are **DESIGN HYPOTHESIS**, not empirical:

- Floor: ≥ 1,200 tool target tokens (enough for 88 short calls).
- Ceiling: ≤ 2,500 tool target tokens for Recovery-011 (stay well under 6,098).
- Do **not** restore 6,098 JSON tokens in this isolation.

Pack-length comparability (Recovery-011): place each V2 unit in the corresponding V1 tool **window slot** and **pad with WR-CORPUS-0 rehearsal** so window token counts stay identical (686,070 pack). Isolates representation, not pack geometry.

---

## 7. Held-out eval

**Do not overwrite WRIM-1.1-CAP-EVAL-0.** Those 10 TOOL items still expect `<tool_call>` JSON and remain the **control** suite (likely still 0/10 under compact training — that is informative, not a silent rewrite).

Successor: **WRIM-1.1-TOOL-EVAL-1** (12 items, `EXCLUDE_FROM_TRAINING=true`):

| ID | Family | What it tests | Difficulty | Expects full JSON? |
|---|---|---|---|---|
| tool1-dec-01 | TOOL_DECISION | greeting → none | easy | no |
| tool1-dec-02 | TOOL_DECISION | checkpoint language → none | easy | no |
| tool1-dec-03 | TOOL_DECISION | refuse live execute → none | hard | no |
| tool1-sel-01 | TOOL_SELECTION | phrase vs note distractor → sha256 | medium | no |
| tool1-sel-02 | TOOL_SELECTION | note vs hash → lookup | medium | no |
| tool1-sel-03 | TOOL_SELECTION | ignore unused note id | hard | no |
| tool1-arg-01 | TOOL_ARGS | hash `heldout-digest-oak` | medium | no |
| tool1-arg-02 | TOOL_ARGS | lookup NOTE-EV-44 | medium | no |
| tool1-call-01 | TOOL_CALL | compact call only | hard | no |
| tool1-call-02 | TOOL_CALL | compact lookup | hard | no |
| tool1-fail-01 | TOOL_FAILURE | after reject, hash local | hard | no |
| tool1-miss-01 | TOOL_FAILURE | missing note_id → none+WHY | medium | no |

CAP-EVAL-0 TOOL audit (unchanged content):

| ID | Tests | Level | Expects JSON wrapper | Aligns to |
|---|---|---:|---|---|
| cap0-tool-01 | hash harbor-quay-lamp | 1 | yes | TOOL-04 |
| cap0-tool-02 | lookup NOTE-ZX-11 | 1 | yes | TOOL-04 |
| cap0-tool-03 | none / fictional county | 2 | yes (tool=none) | TOOL-01 |
| cap0-tool-04 | after curl, hash | 2 | yes | TOOL-06 |
| cap0-tool-05 | hash composition-token | 3 | yes | TOOL-04 |
| cap0-tool-06 | lookup NOTE-QQ-02 | 1 | yes | TOOL-04 |
| cap0-tool-07 | hello → none | 3 | yes | TOOL-01 |
| cap0-tool-08 | hash eval-not-train | 2 | yes | TOOL-04 |
| cap0-tool-09 | stay-local sha256 | 1 | yes | TOOL-06 |
| cap0-tool-10 | lookup NOTE-AA-99 | 3 | yes | TOOL-04 |

Baseline **0/10** is consistent with **output-complexity mismatch** (full JSON + XML wrapper) plus no tool skill on WRIM-0 — not proof the questions are unanswerable in a simpler dialect.

---

## 8. Validator (derived evidence, no hardcoded PASS)

Script: `scripts/wrim1-training/forensic_tool_use_curriculum.py` `validate_v2`.

Run result: **16/16 checks passed**, `fail_count=0`.

| Check | Evidence (summary) |
|---|---|
| unique example ids | 88 unique |
| template diversity | 71 unique prompt templates; 3 target skeletons; largest prompt cluster 8 |
| target token counts | 1694; mean 19.25; max 27; min 9 |
| mask correctness | 0 bad |
| parseability | 0 bad compact parses |
| no `<tool_call>` / no JSON object targets | 0 hits |
| tool/no-tool coverage | none 32/88 |
| tool-name balance | max share 0.386 |
| argument coverage | text, note_id, WHY |
| near-duplicate non-none responses | 0 groups |
| leak vs TOOL-EVAL-1 | 0 |
| leak vs CAP-EVAL-0 | 0 |
| provenance | 0 real trajectories |
| V1 ids not reused | 0 overlap |
| DESIGN_ONLY / NOT_TRAINED / NOT_OFFICIAL | all true |

Gold self-score of V2 targets against their own expected dicts: **88/88**.

---

## 9. What V2 deliberately does not do

- Does not change CAUSAL↔MIXED switching.
- Does not change tokenizer specials.
- Does not add live War Room tools.
- Does not rewrite V1 JSONL.
- Does not start Recovery-012 or official training.

## Recovery-011 consumption (2026-08-31)

TEST_ONLY `TEST-WRIM1.1-RECOVERY-011` used this V2 curriculum as the sole tool family. Result: **FAIL** at step 120 (4/13). TOOL-EVAL-1 **0/12**. Compact dialect remains the intended model-side interface for a future Tool Router, but it is **not** a proven stable first curriculum at 010’s window schedule. See `docs/WRIM1_1_RECOVERY_011_COMPACT_TOOL_INTENT_REPORT.md`.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Inspect `WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN/validator.json` (`passed: true`) and `eval-only/WRIM-1.1-TOOL-EVAL-1/suite.json`.
5. Expected successful output — V2 design artifacts plus Recovery-011 FAIL record. No official checkpoint.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.**
8. Safe rollback instruction if needed — Remove the V2 design directory and TOOL-EVAL-1 eval-only directory. Leave V1 capability candidate untouched.
