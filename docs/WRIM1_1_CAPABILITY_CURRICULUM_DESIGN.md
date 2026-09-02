# WRIM-1.1 CAPABILITY CURRICULUM DESIGN

Date: 2026-08-31  
Status: **TEST / DESIGN ONLY — NOT OFFICIAL LINEAGE — NOT AUTHORIZED TO TRAIN**

Identities:

- Curriculum candidate: `WR-CORPUS-1.1-CAPABILITY-CANDIDATE`
- Held-out eval: `WRIM-1.1-CAP-EVAL-0` (see `docs/WRIM1_1_CLEAN_HELDOUT_EVAL_DESIGN.md`)
- Review packet: `docs/WRIM1_1_CAPABILITY_CURRICULUM_REVIEW.md`

This document does **not** start `WRIM1-RUN-000002` or Recovery-008. It does not promote. It does not change production.

Materialized (TEST/DESIGN):

- `model-lab/manifests/wrim1_1_capability/test-design/WR-CORPUS-1.1-CAPABILITY-CANDIDATE/`
- Eval lives **outside** corpus-ingest paths: `model-lab/eval-only/WRIM-1.1-CAP-EVAL-0/` with `EXCLUDE_FROM_TRAINING=true`

Does not overwrite: WR-CORPUS-0, WR-TOKENIZER-0, WR-CORPUS-1-HARDENED-CANDIDATE, Recovery-001–007 artifacts.

---

## 1. Capability registry

Vague labels (AGI, smarter, better reasoning) are not targets. Each capability is observable.

| ID | Name | Priority | Training signal | Evaluation | Success | Regression |
|---|---|---|---|---|---|---|
| CAP-01 | Natural-language continuation | P0 | WR-CORPUS-0 rehearsal + quality prose | EVAL-LANG / EVAL-RETENTION diagnostics | Coherent held-out prose vs WRIM-0 | Collapse / unique-ratio crash |
| CAP-02 | Instruction → direct response | P0 | Supervised instruction, diverse targets after `<\|assistant\|>` | EVAL-INSTRUCT | Pass-count lift vs WRIM-0 | `pass`/`ack` habit or empty punct |
| CAP-03 | Structured JSON generation | P0 | Instruction → bounded JSON objects | EVAL-JSON parse/keys/types/json-only | Parseable schema matches | Unparseable + language collapse |
| CAP-04 | Simple code generation | P1 | Complete small functions + quality-filtered code LM | EVAL-CODE syntax/exec | Any exec lift vs WRIM-0 | Non-code loops |
| CAP-05 | War Room native concepts | P0 | Applied COMMANDER/COUNCIL/MISSION/… examples | EVAL-WR paraphrases | Paraphrase/application lift | Definition recitation only |
| CAP-06 | Evidence / provenance | P0 | SOURCE/PROVENANCE/CONFIDENCE scenarios | EVAL-EVIDENCE | Class + provenance behavior | Invented citations |
| CAP-07 | OBSERVED / INFERENCE / UNKNOWN / NO_COVERAGE | P0 | CLASS= scenario cards | EVAL-EVIDENCE exact class | L2/L3 class lift | Always one label |
| CAP-08 | Tool-use **understanding** | P1 | `<tool_call>` **after** assistant marker | EVAL-TOOL | Tool/arg match lift; **not** live competence | External curl invention |
| CAP-09 | Failure / correction | P2 | Synthetic system-failure only | EVAL-CORRECTION | Optional | Fake Commander quotes |
| CAP-10 | Longer coherent completion | P0 | Interleaved coherent prose, not report dumps | EVAL-LANG + **separate** 13-probe diagnostic | No unique-ratio crash | 13-probe ≥6/13 |

No extra capabilities were added beyond this bounded set. Terra remains **0 training observations**. Commander corrections remain **0**.

---

## 2. Priority (19.2M cannot learn everything)

**P0 — native War Room LM:** CAP-01, CAP-02, CAP-03, CAP-05, CAP-06, CAP-07, CAP-10.

**P1 — useful but not required for first official candidate claim:** CAP-04 (code), CAP-08 (tool **understanding** only).

**P2:** CAP-09 (no real Commander corrections exist).

Principle: become a stronger small **native War Room language model** before imitating the entire Council. Live tool execution is **not** a WRIM-1.1 target.

---

## 3. Capability → training-signal matrix (current vs proposed)

Wave 8.1 / Recovery pack (measured earlier):

| Family | Examples | Trainable **target** tokens | Weakness |
|---|---:|---:|---|
| Behavior | 31 | 339 (~0.085% of 400k) | 17/31 targets `pass` |
| Tool-use | 3 gym | 16 (JSON **before** assistant → masked) | Teaches `pass` after a dump |
| Commander correction | 0 | 0 | None exist — **not fabricated** |
| Terra | 0 | 0 | None |

Proposed TEST/DESIGN supervised set (WR-TOKENIZER-0, after assistant boundary):

| Family | Examples | Prompt tokens | **Target** tokens | Source | Synthetic OK? | Real WR examples? |
|---|---:|---:|---:|---|---|---|
| instruction_response | 147 | 12,257 | **11,718** | SYNTHETIC_CURRICULUM | yes, labeled | doctrine exists; not copied as eval |
| structured_json | 84 | 11,425 | **9,003** | synthetic bounded cards | yes | not hash-dump shards |
| tool_use | 88 | 17,317 | **6,098** | synthetic + gym-derived **synthetic** | yes | 3 old gyms audited, not reused as-is |
| war_room_concepts | 45 | 5,764 | **4,623** | synthetic applied scenes | yes | terms from lineage/doctrine |
| evidence_uncertainty | 64 | 10,741 | **6,758** | synthetic scenarios | yes | research gym patterns, new wording |
| correction_failure | 48 | 5,804 | **2,556** | SYNTHETIC_SYSTEM_FAILURE | yes | **not** Commander corrections |
| code_supervised | 70 | 7,718 | **4,101** | synthetic complete functions | yes | plus quality leftover LM |
| **Total supervised** | **546** | **71,026** | **44,857** | | | |

Commander correction count: **0**. Terra: **0**.

---

## 4. Rebuilt behavior curriculum

Diverse targets by design: factual sentences, explanations, structured JSON, CLASS= labels, tool_call JSON, status paragraphs, numbered plans, correction withdrawals.

Forbidden as a default habit unless contextually correct: `pass`, `PASS`, `confirmed`, `acknowledged`.

Validator: `habit_pass_targets = 0` on the materialized set.

---

## 5. Trainable target accounting (gradient-bearing)

Do not cite file percentages as if they were targets.

| Category | Prompt (mask 0) | Target (mask 1) |
|---|---:|---:|
| Instruction | 12,257 | 11,718 |
| JSON generation | 11,425 | 9,003 |
| Tool (call + interpret) | 17,317 | 6,098 |
| WR concepts | 5,764 | 4,623 |
| Evidence/uncertainty | 10,741 | 6,758 |
| Correction (synthetic) | 5,804 | 2,556 |
| Code supervised | 7,718 | 4,101 |

Tool JSON is **inside** the assistant span (`<tool_call>…</tool_call>` after `<|assistant|>`). Old `<|tool|>` pre-assistant dumps are **not** used. No new tokenizer specials.

---

## 6. Tool-use curriculum (understanding only)

Audit of the **3** Wave 8.1 gym trajectories: they taught (1) sha256 of a doctrine phrase, (2) a second sha256, (3) refuse curl — but the JSON sat **before** `<|assistant|>`, so the trained target was essentially `pass`.

New curriculum teaches:

- tool selection (sha256 / lookup_note / none)
- argument construction
- result interpretation (prefix as OBSERVED)
- no-tool-needed
- do-not-repeat rejected curl (synthetic)

**Not authorized:** live execution, autonomous tool competence.

---

## 7. Structured JSON vs hash dumps

Leftover JSON **metadata dumps** are **deprioritized** in the quality filter (`prefer_supervised_json`). Supervised cards are instruction → one object with bounded keys. Eval scores parse, required keys, types, JSON-only (no wrapping prose).

---

## 8. War Room native concepts

Taught as **applied** scenes (checkpoint file ≠ promotion), not a dump of every repo constant: COMMANDER, COUNCIL, MISSION, APPROVAL, SOURCE, PROVENANCE, CONFIDENCE, OBSERVED, INFERENCE, UNKNOWN, NO_COVERAGE, checkpoint, training, evaluation, promotion.

Held-out uses **paraphrases** (EVAL-WR), not train wording.

---

## 9. Evidence / uncertainty

Train and eval use scenarios (conflict, missing coverage, unlabeled inference), not “what does UNKNOWN mean?” as the only form. Gold class is **not** written into the user prompt.

---

## 10. Correction / failure

| Kind | Count |
|---|---|
| Actual operator / Commander correction | **0** |
| System failure evidence (gym-inspired synthetic) | included, labeled `GYM_DERIVED_SYNTHETIC` / `SYNTHETIC_SYSTEM_FAILURE` |
| Synthetic correction | 48 examples |

Do not label synthetic data as Commander experience.

---

## 11. Natural language rehearsal

Recovery-006/007 used **~30%** WR-CORPUS-0 for **stability**. That is **not** automatically kept.

**Recommendation: 25% rehearsal budget** (180,000 WR-CORPUS-0 tokens in this pack; **26.2%** of the actual 686,070-token stream because leftover undershot the 720k design target).

Justification (DESIGN HYPOTHESIS, not a new TEST_ONLY):

- 100% rehearsal hid leftover collapse (Recovery-004 forensics).
- 30% interleaved at 3e-5 survived 150 mixed steps (007).
- Official acquisition needs P0 **target** mass; 5–8 points of mix vs 007 are allocated to supervised units (115,883 unit tokens / 44,857 targets).
- Full WR-CORPUS-0 unique is 317,338; 180k is a contiguous clean prefix (Alice-class eval-infra docs dropped).

If Commander requires **zero mix-risk** vs 007, keep 30% rehearsal **and still pack this supervised set**. Do not train to decide that in this mission.

---

## 12. Prose quality — inclusion / exclusion

**Include:** coherent sentences, educational briefings, constitution-style doctrine **rephrased** into applied cards, complete functions.

**Exclude from leftover LM (rules, originals not deleted):** package locks, minified bundles, Phase SQL migrations, hash-dense manifests, Wave eval-spec / takeover report boilerplate, `eval-only/` paths, Wave 8.1 held-out prompt strings.

Original hardened shards and Recovery artifacts remain on disk.

---

## 13. Code curriculum

**Prefer:** complete functions, small modules, clear helpers, War Room-native snippets.

**Deprioritize:** generated bundles, locks, minified, huge migrations, hash dumps, repeated scaffolding.

Code remains a capability (P1). Quality leftover code still occupies ~178k pack tokens for LM continuation.

---

## 14. Size target (not 400k / 5M / 2 epochs by habit)

Materialized unique pack: **686,070** tokens (design target was 720,000).

| Slice | Tokens | Share of pack |
|---|---:|---:|
| WR-CORPUS-0 rehearsal | 180,000 | 26.2% |
| Quality prose leftover | 212,058 | 30.9% |
| Quality code leftover | 178,129 | 26.0% |
| Supervised units (all families) | 115,883 | 16.9% |
| Dump JSON leftover | 0 | quality filter |

**Why exposure matters:** 44,857 supervised **targets** are 6.5% of the pack (vs 0.085% behavior targets before). At 3 unique-pack epochs that is ~134k target-token presentations vs Recovery-007’s ~521.

---

## 15. Minimum signal floors (DESIGN FLOOR = engineering hypothesis)

| Floor | Value | Actual | Note |
|---|---:|---:|---|
| Instruction targets | 11,000 | 11,718 | Initial 12,000 trimmed after WR-TOKENIZER-0 density; still ~35× 339 |
| JSON targets | 6,000 | 9,003 | |
| Tool targets | 4,000 | 6,098 | vs 16 |
| WR concept targets | 4,000 | 4,623 | |
| Evidence targets | 4,000 | 6,758 | |
| Correction targets | 2,000 | 2,556 | synthetic only |
| Code supervised | 4,000 | 4,101 | |
| Total supervised targets | 36,000 | 44,857 | |

These are **not** proven learning thresholds. They exist to forbid presenting 16-token tool sets as capability training.

---

## 16. Provenance and synthetic policy

Every supervised item has `source_type`, `source_identity`, license/ownership, `synthetic_vs_observed`, `generated_by`, capability family, train designation.

Synthetic is allowed when labeled, deterministic/auditable, not masquerading as Commander experience, quality-checked, and not duplicated into held-out eval.

---

## 17. Tool masking fix (representation only)

Conceptual (repo-equivalent, **existing** specials only):

```
<|commander|>
request
<|assistant|>
<tool_call>
{"tool":"sha256","arguments":{"text":"..."}}
</tool_call>
<|eos|>
```

`wrap_behavior_tokens` already grants loss after `<|assistant|>`. No live execution. No tokenizer special added.

---

## 18. Official duration / LR / capacity (design numbers)

See also `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md`.

- Tokens/step: **4,096** (batch 8 × context 512)
- Unique pack: **686,070**
- Planned unique epochs: **3.0**
- Official steps: **502** = round(686070 × 3 / 4096)
- Cosine horizon: **502** (warmup **25**, floor 10% of peak)
- Peak LR: **3e-5** (Recovery-007 safe boundary; **do not raise**)
- Architecture: **unchanged 19.2M** — capacity bottleneck: INSUFFICIENT EVIDENCE

502 is not 150 and not 1893.

---

## 19. Validator

`scripts/wrim1-training/materialize_capability_curriculum.py` → `validator.json`.

Last run: **14/14 derived checks**, including target accounting, floors, leak=0, mask, tool position, JSON parse, honest Commander-correction 0.

---

## 20. Readiness

Curriculum + eval infrastructure is sufficient to **design/authorize** a later official candidate **rationally**. This is **not** training authorization.
