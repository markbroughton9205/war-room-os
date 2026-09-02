# WRIM-1.1 OFFICIAL CANDIDATE — CAPABILITY ACQUISITION GATE REVIEW

Date: 2026-08-31  
Mission: Commander design review + evidence audit. **No training. No WRIM1-RUN-000002. No Recovery-008. No production. No commit/push.**

Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Primary design (as found, then revised as a document only): `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md`

Evidence roots used:

- `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md` (pre-revision text)
- `docs/WRIM1_1_RECOVERY_007_LOW_LR_ENDURANCE_REPORT.md`
- `docs/WRIM1_1_RECOVERY_006_LOW_LR_INTERLEAVED_REPORT.md`
- `docs/WRIM1_1_RECOVERY_005_INTERLEAVED_REHEARSAL_REPORT.md`
- `docs/WRIM1_1_RECOVERY_004_STEP45_FORENSIC_DIAGNOSIS.md`
- `docs/WRIM1_1_RECOVERY_DESIGN.md`
- `docs/WAR_ROOM_AGI_MASTER_TAKEOVER_REPORT.md`
- Recovery-007 artifacts under `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007/`
- Wave 8.1 corpus / eval / tokenizer manifests
- Materialized shards `model-lab/corpora/WR-CORPUS-1-HARDENED/`
- `model-lab/manifests/wave8_1/behavior-examples.json`
- Packer `scripts/wrim1-training/contiguous_pack.py` (mask + leak scan)

## FINAL VERDICT

**WRIM-1.1 OFFICIAL CANDIDATE DESIGN — REVISION REQUIRED**

Decision letter: **B. DESIGN NEEDS REVISION**

The pre-revision design is a **stability recipe**. Recovery-006/007 already answered that recipe’s question (bounded mixed training at peak LR 3e-5 does not 005-collapse). It is **not** scientifically capable of answering:

> Can stable continued training actually make WRIM-1.1 better than WRIM-0?

WRIM1-RUN-000002 remains **NOT AUTHORIZED**. Recovery-007 remains **TEST_ONLY**. Active model and production are unchanged.

---

## 1. Current official candidate design summary

Extracted from the design document **as it existed at the start of this review** (not inferred from prior prompts).

| Field | What the design currently proposed |
|---|---|
| Training objective | **Not stated as a capability objective.** Implied: continued pretrain of WRIM-0 under a later identity WRIM1-RUN-000002. Success bar in recovery design: survive mixed CPT without suite-wide symbol-loop collapse. |
| Parent / tokenizer | WRIM-0 SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`. WR-TOKENIZER-0 SHA `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`. Never start from WRIM-1 or Recovery-001–007. |
| Dataset | Reuse Recovery-005/006/007 interleaved packed stream (byte-identical in 006/007). Target **400,000** tokens; packed **399,999**. |
| Data mix | ~**30.0001%** WR-CORPUS-0 rehearsal / **34.11%** prose / **25.61%** code / **8.62%** JSON / **1.66%** behavior. |
| Rehearsal | 30% token-capped WR-CORPUS-0; contiguous prefix; deficit FIFO interleave of 2048-token windows. |
| Prose / code / JSON | As mix table. Leftover preserves Recovery-001 relative PCJ shares. |
| Behavior examples | All 31 clean examples; response-only mask. |
| Tool-use examples | Not named as a separate mix family. They sit inside the 31 behavior units (3 `tool_use` format examples). |
| Total tokens | Packed unique stream 399,999. Official **tokens-seen / epochs / steps: not specified.** Comment: official WRIM-1 was 1893 steps; copying that is a Commander decision, not a recovery result. |
| LR | Peak **3e-5**, warmup **25**, floor **3e-6** (10% of peak). Scheduler `linear_warmup_cosine_decay`. Horizon: Commander must pick official-length cosine vs keep total_steps=150 (floor for a long run). Do not return to 3e-4. |
| Optimizer | AdamW β1=0.9 β2=0.95 ε=1e-8 WD=0.1 clip=1.0 |
| Context / batch | 512 / 8 |
| Checkpoint cadence | 0, every 50 official steps, plus final; retain 0, 25%, 50%, 75%, final; save before diagnostic-triggered stop. |
| Evaluations | Frozen original **13 probes** at 0 and retained checkpoints. Observational KL and param L2. No universal KL kill. |
| Stopping rules | collapse ≥ 6/13 or ≥ step-0 + 2; unique-token ratio < 0.5× WRIM-0 (~0.198) with behavioral degradation; suite-wide `\|` / `.` / letter loops; NaN/Inf, causal mismatch, leak hits, crash. |
| Promotion criteria | Training PASS ≠ promotion. Separate Commander instruction after integrity + held-out eval; 13-probe collapse still near WRIM-0 (2/13 class, not 7/13); no anecdotal “smarter”; WRIM-1 promotion remains REJECTED. |
| Environment | `.venv-wrim`, Python 3.12.14, MLX 0.32.2, `Device(gpu, 0)`. |

Open Commander choices already listed in the design: official step count; cosine horizon; packed-stream size if duration ≫ 150; whether further TEST_ONLY is required.

**Audit conclusion on this table:** mix, LR family, packing, and collapse gates are specified. **Learning objective, duration, capability metrics, and a clean promotion eval are not.**

---

## 2. Capability objectives

Vague goals (“better intelligence”, “more knowledge”) are rejected.

Translation of **what the packed Recovery mix can actually present**, versus whether learning is expectable and whether a held-out eval exists.

| # | Proposed capability | TRAINING EVIDENCE EXISTS | ENOUGH EVIDENCE TO EXPECT LEARNING | HELD-OUT EVALUATION EXISTS |
|---|---|---|---|---|
| 1 | Coherent natural-language continuation | **YES** — rehearsal literary English (WR-CORPUS-0 prefix) + docs/markdown prose (136,429 tokens in pack) | **UNKNOWN** — prose is present, but Recovery-007 leftover CE stayed ~7.1 and unique-ratio declined; 150 steps showed no NL gain vs WRIM-0 | **PARTIAL** — 13-probe continuations are **diagnostics**, not a held-out grade. Wave 8.1 Alice is **contaminated as a promotion suite** (see §11). |
| 2 | Instruction / response behavior | **YES** — 31 rendered examples | **NO** — only **339** response-target tokens in the entire pack (0.085% of 399,999). 17/31 targets are the string `pass` | **NO** clean capability scorer. 13-probe QA/instr items measure collapse, not instruction success. Wave 8.1 instruction-like items are mostly UNSUPPORTED + contaminated. |
| 3 | Structured JSON generation | **YES** — 34,470 JSON-family tokens in pack | **UNKNOWN** — JSON CE highest of leftover families (~7.8 mean). WRIM-0 and Recovery-007 both `json_valid: false` on `{"ok":` | **PARTIAL** — diagnostic JSON + Wave 8.1 `json-validity` exist; Wave 8.1 prompt leaked into hardened shards; recovery pack leak count **0** for that string, but the suite is still the contaminated promotion artifact. |
| 4 | Code understanding / generation | **YES** — 102,450 code tokens in pack (and 2.99M available if pack is enlarged) | **UNKNOWN** — code CE ~7.5; diagnostic `function add` remains tokenizer-loop / non-code at step 150 | **NO** supported held-out code scorer (`w81-eval-code-protocol` is UNSUPPORTED). |
| 5 | War Room terminology and concepts | **YES** — constitution/docs in prose; some behavior text | **UNKNOWN** — not isolated in mix; no dedicated metric | **NO** clean retrieval eval (Wave 8.1 retrieval item contaminated / UNSUPPORTED). |
| 6 | Tool-use pattern understanding | **YES (tiny)** — **3** gym trajectories in behavior examples | **NO** — trajectories sit **before** `<|assistant|>` and are **loss-masked**; only **16** tool-use **target** tokens, all essentially `pass` | **NO** (Wave 8.1 tool protocol UNSUPPORTED + contaminated). |
| 7 | Evidence / provenance concepts | **YES (tiny)** — research/world-learning behavior strings | **NO** — few examples; targets are templated claimStatus lines | **NO** clean held-out. |
| 8 | Uncertainty / observed-vs-inference | **YES (tiny)** — research gym responses (contested / candidate / insufficient) | **NO** — four short templates; not a distribution | **NO** clean held-out. |
| 9 | Longer coherent completion | **YES** — long prose/code windows exist | **NO / UNKNOWN** — 32-token diagnostic gens; unique-ratio **fell** 0.397 → 0.310 over 150 steps | **NO** dedicated long-form held-out. |
| 10 | Other strongly represented | **YES** — TypeScript repo LM, SQL migrations, hash-heavy manifests, Austen rehearsal | **UNKNOWN** for “engineering LM”; **YES** for remaining in-distribution Austen (rehearsal CE ~4.4) | Austen-in-distribution is **not** a new-capability eval. |

**Implication:** the mix can teach **in-distribution English continuation (rehearsal)** and can **expose** code/JSON/prose OOD tokens. It cannot, at current behavior/tool target mass, be expected to move instruction-following or tool-use in a measurable way.

---

## 3. Actual corpus composition

Two layers must not be conflated.

### 3A. Official-candidate **packed train stream** (Recovery-005=006=007)

This is what the design says to reuse.

| Category | Tokens | % of 399,999 | Units (post-split windows) | Notes |
|---|---:|---:|---:|---|
| WR-CORPUS-0 rehearsal | 120,000 | 30.0001 | 60 (from 4 clean rehearsal docs; 1 truncated) | Pride-and-Prejudice-class literary prefix, not the full 317,338 unique WR-CORPUS-0 train tokens |
| New prose | 136,429 | 34.11 | 275 | Docs/markdown after eval-infra exclusion |
| Code | 102,450 | 25.61 | 226 | Downsampled from **2,995,634** available cleaned code tokens |
| JSON | 34,470 | 8.62 | 52 | From **183,567** available |
| Behavior (full units) | 6,650 | 1.66 | 31 | See §5: most of this is **masked prompt** |
| Behavior **targets** | **339** | **0.085** | 31 | Response tokens after `<|assistant|>` |
| Tool-use **targets** | **16** | **0.004** | 3 | Subset of behavior targets |
| Commander-correction | 0 | 0 | 0 | `buildCommanderCorrectionExamples81()` returns `[]` |
| Terra observation (train) | 0 | 0 | 0 | Terra examples are eval-only by gate |
| Other | 0 | 0 | 0 | `available_cleaned_tokens.other = 0` |
| **Total packed** | **399,999** | 100 | 644 | Target 400,000; 1 token unfilled. EOS 585 / 1.46 per 1K |

Val stream in the same pack: **840,182** tokens (1675 units) — not the training mix.

Hardened train shard (not the pack): **8,477** records, **3,874,900** tokens. Recovery packing **excluded 68** eval-infra records (heldOut/eval/behavior source, reports, etc.).

### 3B. Full hardened candidate (if pack is enlarged without rebalancing)

Wave 8.1 `formatDistribution` (documents, not packed tokens): code **2054** / language_modeling **111** / structured_json **29** / instruction_response **18** / tool_use **3** / other small formats.

Available cleaned tokens reported by Recovery-007 mix gate: prose **671,712** / code **2,995,634** / JSON **183,567**.

**Percentages of available leftover (no rehearsal):** code **77.7%**, prose **17.4%**, JSON **4.8%**.  
The **packed** mix is **not** that distribution; it **caps** code at 25.61%. Enlarging the pack **while keeping family percents** still samples more of each family, but available code remains the large reservoir.

---

## 4. Code-dominance findings

**Is code disproportionately dominating the actual packed learning signal?**

**No, not in the 400k official-candidate pack.** Code is **25.61%**, below prose (34.11%) and below rehearsal (30%). That is a deliberate leftover of Recovery-001 relative shares after a 30% rehearsal cap.

**Is the underlying hardened inventory code-dominated?** **Yes.** ~78% of available cleaned leftover tokens are code. Train-shard extensions: `.ts` 5532, `.tsx` 580, `.mjs` 162 vs `.md` 1182, `.txt` 307, `.json` 289, `.sql` 424. Top dirs: `lib/research-engine`, `lib/council`. Hash-dense JSON manifests: **156** train records. SQL migrations: **356** quality-flag hits. Report-ish paths: **380**. Lockfiles in shard: **0**. `node_modules`: **0**.

**Does that match what WRIM-1.1 is supposed to become?** The design never defined what WRIM-1.1 is supposed to become beyond “continued pretrain without collapse.” If the intent is a **War Room operator model**, a 25.61% code / 1.66% behavior pack with **0.085%** instruction targets is a **language-model continuation diet**, not an operator-behavior diet. This review does **not** arbitrarily reduce code; it records the measurement.

---

## 5. Behavior-signal findings

| Quantity | Value |
|---|---|
| Behavior examples | **31** (all admitted; `behavior_all_clean_examples: true`) |
| Behavior unit tokens | **6,650** (1.66% of pack) |
| Prompt / context tokens (loss mask 0) | **6,311** (94.9% of behavior units) |
| Response-target tokens (loss mask 1) | **339** (**0.085%** of packed train tokens) |
| Prompt masked? | **YES** — `wrap_behavior_tokens`: loss only on positions **after** `<|assistant|>` |
| Response variety | 13 unique response strings; **17× `pass`**, 1× `fail`, 3× `completed_verified`, plus templated research/world-learning lines |
| Formats | 18 instruction_response, 3 tool_use, 2 contradiction_handling, 3 source_grounded_research, 1 retrieval_grounded, 4 project_memory_continuity |

**Is there enough behavior data to expect measurable instruction-following change?** **No.** At Recovery-007 duration, estimated behavior-**target** tokens seen ≈ **521** (mix × 614,400 tokens seen). That is smaller than a single 512-token row. Targets are mostly a single token-word `pass`.

Causal-batch note (not a packer fail): `behavior_mask_positions_ok` 2649 vs `bad` 935 on **windowed batches** is a packing-window statistic; unit-level audit is **6650/6650** OK.

---

## 6. Tool-use-signal findings

Do not count TypeScript that mentions tools as trajectories.

| Class | Count in candidate training evidence |
|---|---|
| Real / gym trajectories with `select_tool` / `execute_tool` (or bounded sha256) | **3** in `behavior-examples.json` (`format: tool_use`) |
| Synthetic fixtures | Those 3 are AGI-gym bounded fixtures, not live Commander sessions |
| Metadata / test harness / `app/api/commander/trajectory/route.ts` / SQL | Present in **hardened shards** as ordinary source; **excluded or bucketed as code**, not as tool-use supervision |
| Ordinary source mentioning tools | Many files; **not** counted as trajectories |

**Can the corpus realistically teach tool-use behavior?** **No**, under the current mask. Tool JSON is in `<|tool|>` **before** `<|assistant|>`, so it is **not a generation target**. The model is trained to emit `pass` after a tool dump, not to emit tool calls. Packed tool-use **target** tokens: **16**. Estimated tokens seen over 150 steps: ~**25**.

Commander-correction tokens: **0**. Terra training observations: **0**.

---

## 7. Rehearsal assessment

Recovery-006/007 used **30.0001%** WR-CORPUS-0 because Recovery-004 forensics showed **100% rehearsal blocks** (Austen) created false health, and Recovery-005 interleaved that 30% globally. **30% was chosen for stability testing. It is not proven optimal for capability acquisition.**

| Consideration | Evidence |
|---|---|
| Retention benefit | Rehearsal CE ~**4.41** last-50 vs leftover ~**7.1–7.4**. Parent literary mode is retained better than new domains are learned. Collapse stayed near WRIM-0 (2→3/13). |
| New-data learning budget | 30% of every step is **already-seen WRIM-0 domain**. Over 150 steps that is ~184k rehearsal tokens seen vs ~430k leftover. |
| WRIM-0’s small original corpus | Unique WR-CORPUS-0 train tokens **317,338**; WRIM-0 already saw **2,048,000** tokens (500×8×512). Rehearsal here is a **120k prefix**, not a full replay of WR-CORPUS-0. |
| Recovery-007 stability | Holds at 30% + 3e-5 for 150 mixed steps. |
| Limited 150-step evidence | Unique-ratio still drifted down. Cannot claim 30% is the acquisition optimum. |

**Recommendation (do not change automatically):** **Keep 30% for any first official candidate that still uses this family**, because lowering rehearsal is a **new experimental variable** (Recovery-002/003 at 15% + higher LR failed for other reasons). Treat 30% as **stability inheritance**, not an acquisition optimum. If Commander later wants more new-domain budget, that is a **TEST_ONLY mix experiment**, not a silent official change.

---

## 8. LR assessment

Recovery-007 facts at peak **3e-5**, floor **~3e-6**, warmup 25, cosine horizon **150**:

| Metric | Step 0 | Step 50 | Step 150 |
|---|---|---|---|
| KL (WRIM-0 → current, 1008 pos) | 0 | 0.0253 | **0.0357** |
| Param L2 from WRIM-0 | 0 | 2.75 | **5.00** |
| Relative drift | 0 | — | **0.019** |
| Min layer cosine | 1.0 | — | **0.99973** (layers.1) |
| Val CE | 7.753 | 7.340 | **7.101** |
| Collapse | 2/13 | 2/13 | **3/13** |
| Unique ratio | 0.397 | 0.337 | **0.310** |
| Capability vs WRIM-0 | baseline | unchanged | **unchanged to slightly regressed** |

Gradients finite; 37 mild clips at 1.0; no explosion.

**3e-5 is a useful *stability* LR. It is not shown to be a useful *acquisition* LR at 150 steps.** Weight movement is small (relative 1.9%). KL flattened as cosine hit the floor. Val CE improved modestly without capability gain.

**Do not increase LR in the official design.** 3e-4 on this mix is lethal (Recovery-005). Another **TEST_ONLY LR raise is not required before rewriting the design**, because the blocking gap is **objective + eval + duration**, not “we must try 1e-4 next.” A later LR experiment is only justified **after** clean capability probes exist so a raise can be judged on capability, not collapse alone.

Classification: **safe LR, acquisition-unproven.** Official cosine must not silently sit at 3e-6 for most of a long run (design already warned). That is a duration/horizon specification, not a new peak LR.

---

## 9. Source-local loss assessment

Recovery-007 mean CE (steps 1–150) / last-50:

| Family | Mean CE 1–150 | Last 50 |
|---|---:|---:|
| rehearsal (WR-CORPUS-0) | 4.49 | 4.41 |
| behavior | 7.18 | 6.71 |
| prose | 7.33 | 7.10 |
| code | 7.52 | 7.29 |
| JSON | 7.80 | 7.36 |

Gap ~**4.4 vs 7.1–7.8** remains. Leftover CE drifted **down** slightly in the second 100 steps (not a blow-up).

**What the evidence supports (no guess beyond this):**

- **In-distribution vs OOD:** rehearsal is WRIM-0’s literary domain; leftover is repo/docs/JSON/behavior. High leftover CE is consistent with **domain mismatch + novelty**, not with a failed optimizer (loss is finite and slowly improving).
- **JSON highest:** matches tokenizer fragmentation (JSON ~1.72–1.87 chars/token vs literary txt ~4.33).
- **Insufficient training:** 150 steps / ~1.54 epochs of a 400k pack is a **short** CPT; cannot separate “needs more steps” from “this 19M model cannot fit leftover.”
- **Poor corpus quality:** contributes for hash-dense JSON and migration SQL **if those tokens are sampled**; the pack only takes 18.8% of available JSON and 3.4% of available code, so quality drag is **partially** gated by selection, not fully characterized per sampled file.
- **Not evidenced as the unique cause:** a single “tokenization inefficiency” or “capacity limit” story.

---

## 10. Tokenizer fitness

WR-TOKENIZER-0 remains official. **No successor trained.** Vocab 15,126. UNK id: **none** in this tokenizer; behavior sample OOV count **0**.

Comparative efficiency (this audit’s shard samples, plus Wave 8.1 analysis):

| Domain | Measure | Value |
|---|---|---|
| WR-CORPUS-0-like `.txt` (this audit) | chars/token | **4.33** |
| Wave 8.1 “english” sample | chars/token | 4.41 |
| New prose `.md` (this audit) | chars/token | **2.86** |
| Wave 8.1 natural_language | chars/token | 2.68 |
| Code `.ts` (this audit) | chars/token | **2.44** |
| JSON (this audit / Wave 8.1) | chars/token | **1.72 / 1.75** |
| Behavior rendered (this audit) | chars/token | **2.60** |
| Coordinates (Wave 8.1) | chars/token | **1.38** |
| Pathological (Wave 8.1) | — | JSON, numbers, coordinates |

Fragmentation is **worse on JSON/code than on Austen**. That inflates JSON/code token counts versus information content and helps explain high JSON CE. It does **not** by itself justify WR-TOKENIZER-1.

---

## 11. Held-out contamination audit

### 11A. Wave 8.1 promotion suite (10 items)

Source: `model-lab/manifests/wave8_1/held-out-eval-suite.json`.  
Official WRIM-1 recheck: `held-out-contamination-recheck.json` — **substring hits in hardened train shards: yes.**

| evalId | Purpose | Source | Prompt in hardened train? | Equivalent boilerplate in train? | Contamination | Scorer |
|---|---|---|---|---|---|---|
| w81-eval-language-alice | Literary continue | heldOut.ts / Alice lineage | **YES** (Alice string in shards; Alice doc dropped from mix but prompt appears in eval-spec source) | Literary WR-CORPUS-0 style | **DIRTY as promotion proof** | unsupported-runtime / qualitative |
| w81-eval-code-protocol | TS function | heldOut | **YES** (`heldOutChecksum` in leak list) | TS function boilerplate **YES** | **DIRTY** | unsupported-runtime |
| w81-eval-json-schema | Complete JSON | heldOut | **YES** (`{"trainingStarted":`) | JSON manifests **YES** | **DIRTY** | json-validity |
| w81-eval-tool-protocol | Refuse curl | heldOut | **YES** | tool_use format **YES** | **DIRTY** | tool-call-structure (UNSUPPORTED) |
| w81-eval-research-conflict | Rho/Sigma contested | heldOut | **YES** | research templates **YES** | **DIRTY** | contradiction-preserved (UNSUPPORTED) |
| w81-eval-evidence-grounding | Empty provenance | heldOut | **YES** | provenance JSON **YES** | **DIRTY** | citation-evidence-match (UNSUPPORTED) |
| w81-eval-retrieval | Constitution phrase | heldOut | **YES** | constitution in **prose train** | **DIRTY** / near-duplicate doctrine | retrieval-target-match (UNSUPPORTED) |
| w81-eval-contradiction | Crest M/N | heldOut | **YES** | similar research items | **DIRTY** | claim-status (UNSUPPORTED) |
| w81-eval-temporal | Terra stale | heldOut / behavior.ts eval-only text | **YES** | Terra eval strings | **DIRTY** | temporal-order (UNSUPPORTED) |
| w81-eval-memory | training not started | heldOut | **YES** | wave8.1 docs | **DIRTY** | exact-string (UNSUPPORTED) |

**Required: 0 known train/test prompt leakage for a suite used as proof.** Wave 8.1 **fails** that as a promotion instrument.

Recovery-007 packed stream: `held_out_leak_count: 0` against `HELD_OUT_PROMPT_STRINGS` because eval-infra records were **excluded** from the 400k pack. That makes the **pack** clean vs those strings. It does **not** rehabilitate Wave 8.1 as an official capability gate (Commander instruction: do not reuse the contaminated evaluation as proof). Eight of ten items are **UNSUPPORTED** by WRIM-0 runtime anyway, so they cannot currently measure acquisition.

### 11B. Frozen 13-probe diagnostic suite

Source: `WRIM-RECOVERY-DIAGNOSTIC-0.json` + five experiment extensions (`d0-echo` … `d0-instr`).  
Declared: `kind: DIAGNOSTIC_ONLY`, **`held_out: false`**.

| id | Purpose | Deterministic scoring | Leak vs train shard |
|---|---|---|---|
| d0-prose-sky / once / hello / punct | Continuation / punctuation | Collapse heuristics (unique ratio, max run, symbol runs) | Generic English; `Wait` substring hits are **not** a prompt-identity leak |
| d0-json | JSON formatting | `json_valid` boolean | `{"ok":` not in W81 leak list |
| d0-seq / d0-code | Sequence / short code | collapse heuristics | Generic |
| d0-qa / d0-qa-ctx / d0-instr / d0-echo / d0-repeat / d0-eos | QA / echo / EOS | collapse / echo stats | Diagnostic only |

**These 13 items are a collapse watch, not a capability held-out.** Using them as the official “evaluation gate” cannot answer “better than WRIM-0” except as **non-collapse**.

**Readiness rule:** until a **new** capability suite is specified, leak-scanned against the **actual packed tokens**, stored off the ingest path, and scored with deterministic methods WRIM can run, **the design is not ready.**

---

## 12. Capability delta matrix

Do not fabricate metrics. **MISSING** means no trustworthy numeric capability score.

| Capability | WRIM-0 baseline (Recovery-007 step 0 = parent) | Recovery-007 step 150 | Desired improvement (proposed) | Regression boundary | Training evidence for improvement | Held-out |
|---|---|---|---|---|---|---|
| Natural-language coherence | Some short English (e.g. “Once upon a time…”); sky/hello already weak | Sky still collapsed (`_not__…`); “Once upon a time” still generic English | Fewer collapsed NL probes; unique-ratio not below ~0.30 without NL recovery | Unique-ratio &lt; 0.5× WRIM-0 (~0.198) or collapse ≥ step-0+2 | Prose + rehearsal | 13-probe diagnostic only |
| Repetition / collapse | **2/13**; unique **0.397**; underscore runs already present | **3/13**; unique **0.310**; isolated QA `B` run; no 005 `\|` loops | Collapse ≤ 2/13 class; no suite-wide symbol loop | ≥6/13 or ≥ step-0+2; 005-style loops | Mix + 3e-5 | Frozen 13 |
| Next-token language quality | Val CE **7.753**; top token ` a` | Val CE **7.101**; top token ` not` | Val CE down **and** NL probes not worse | Val CE explosion; argmax `.` / `\|` | Packed LM | Val is **in-mix**, not held-out capability |
| JSON | `json_valid: false`; WRIM-0 Wave 8.1 JSON historically invalid | `json_valid: false`; JSON still tokenizer-loop | Parseable object on a **clean** JSON probe | Collapse-to-dots (WRIM-1 mode) | 34k JSON tokens | Wave 8.1 **unusable**; diagnostic `{"ok":` only |
| Code | Diagnostic `function add` already tokenizer-heavy | Still `-lab` / tokenizer runs | **MISSING** supported code score | Collapse | 102k code tokens | UNSUPPORTED |
| Instruction behavior | QA/instr probes not following; short Alice-like English elsewhere | QA shows `B` run; instr drifted to Alice dialogue | **MISSING** | Collapse | 339 target tokens | NO |
| War Room concept knowledge | **MISSING** | **MISSING** | **MISSING** | — | Docs in prose | NO |
| Tool-use understanding | **MISSING** / UNSUPPORTED | **MISSING** | **MISSING** | — | 16 target tokens | NO |
| Uncertainty / provenance | **MISSING** | **MISSING** | **MISSING** | — | Few templates | NO |
| KL / L2 | 0 / 0 | 0.036 / 5.00 | Observational only; **not** a pass | Not a kill number | Optimizer | N/A |

---

## 13. Operational definition of “better than WRIM-0”

**WRIM-1.1 IS BETTER THAN WRIM-0** if and only if all of the following hold on a **reproducible checkpoint**, using an **uncontaminated** held-out set that was leak-scanned against that run’s **actual train tokens**:

1. **At least one explicitly trained capability** shows a **deterministic** improvement vs the same WRIM-0 checkpoint protocol (examples that this corpus could support if evals existed: valid JSON completion; non-collapsed literary/prose continuation quality vs parent on **new** prompts; instruction exact-match on **held-out paraphrases**, not train clones). Improvement may not be a loss-only or KL-only claim.
2. **No catastrophic language regression:** freeze-13 collapse remains in the WRIM-0 class (not 7/13); unique-ratio stays above the 0.5× WRIM-0 kill; no suite-wide `.` / `\|` / letter loops.
3. **Stable repetition metrics** vs parent (underscore/`tokenizer` runs that already exist at WRIM-0 are disclosed, not newly dominant).
4. **0 known train/test prompt leakage** for every item used as proof.
5. **Reload identity:** checkpoint SHA verified; eval rerun from fresh load.

**Not sufficient:** train completed; val CE fell; KL small; L2 non-zero; no crash; 150/150 steps; “looks slightly English.”

Percent thresholds are **not** invented here (no evidence for “+10% JSON”). The JSON bar is **validity vs invalid**, which both parent and Recovery-007 fail.

---

## 14. Memorization vs generalization protections

| Control | Status |
|---|---|
| Wave 8.1 fingerprint/lineage leakage.passed | True on corpus-manifest; **insufficient** (substring leak of eval specs) |
| Recovery pack substring scan vs W81 prompts | **0 hits** |
| Behavior vs eval lineage collisions | 0 reported on WRIM-1 recheck |
| Near-duplicate held-out for behavior/JSON/tool-use | **Not built.** Wave 8.1 items are too close to train specs / constitution doctrine |
| Dedup of train chunks | Hardened pipeline exists; **not re-verified as capability-eval dedup** in this mission |
| Instruction paraphrases | **Missing.** Many train responses are identical `pass` |

**A candidate that memorizes 31 `pass` strings cannot be distinguished from instruction-following without held-out paraphrases and non-`pass` targets.**

---

## 15. Official training token-budget analysis

Recovery-007: **150 steps × 8 × 512 = 614,400 tokens seen** ≈ **1.54 epochs** of the 399,999 pack.

| Plan | Tokens seen | Epochs of 400k pack | Notes |
|---|---:|---:|---|
| Recovery-007 (done) | 614,400 | ~1.54 | No capability gain; LR at floor by step 150 |
| Copy official WRIM-1 1893 steps | 7,753,728 | ~19.4 | Would **recycle the same 400k** ~19 times unless the pack is enlarged; scientifically unjustified at 3e-5 without evals |
| Unspecified official duration | **MISSING** | **MISSING** | Design as found |

Tokens per step: **4,096**.

**150 steps is not a justified official acquisition budget.** Val CE was flattening; KL flattening; capability flat/slightly worse. **1893 is not justified either** — it is the collapsed WRIM-1 length at a different LR, on a **different** (full-shard, shuffled) recipe.

A scientifically honest official budget must state: (1) packed unique tokens, (2) steps, (3) cosine horizon = that step count, (4) epochs over the pack, (5) that leftover families actually receive more than a rounding-error of **target** tokens. Until those are filled, the design cannot claim to test acquisition.

---

## 16. Category exposure counts

Approximate tokens **seen** over Recovery-007 (mix × 614,400), not unique tokens:

| Category | Pack % | Tokens seen @150 | Unique pack tokens | Exposures of unique pack (epochs) |
|---|---:|---:|---:|---:|
| Rehearsal | 30.00 | ~184,320 | 120,000 | ~1.54 |
| Prose | 34.11 | ~209,600 | 136,429 | ~1.54 |
| Code | 25.61 | ~157,300 | 102,450 | ~1.54 |
| JSON | 8.62 | ~53,000 | 34,470 | ~1.54 |
| Behavior units | 1.66 | ~10,200 | 6,650 | ~1.54 |
| Behavior **targets** | 0.085 | ~**521** | 339 | ~1.54 |
| Tool-use **targets** | 0.004 | ~**25** | 16 | ~1.54 |

Small categories do **not** receive enough optimization exposure to expect a held-out instruction or tool-use delta.

---

## 17. Corpus-quality findings

Inspected train-shard structure and samples (no deletions).

| Issue | Finding |
|---|---|
| Truncated fragments | 10 “tiny_chunk” records (&lt;40 chars) |
| Hash dumps | **156** hash-dense records (e.g. `audit-segment-boundaries.json` eventHash tables) |
| Generated status / reports | 380 report-ish paths; takeover/eval reports **excluded** from recovery pack (68 eval-infra) |
| Duplicated boilerplate | TS/React and SQL phase files; behavior `pass` templates |
| Test fixture noise | Gym trajectories inside 31 examples; eval-spec source excluded from pack |
| Massive tables | Hash ledgers in manifests |
| Minified / package locks | 0 lockfiles; 0 node_modules in shard |
| SQL migrations | 424 `.sql` records; 356 flagged migration-like |
| Irrelevant metadata | Wave manifests, hashes, capability tag lists |

These **do** consume meaningful token budget **in the full hardened train set**. In the **400k pack**, code/JSON are subsampled, so the official candidate’s quality risk is **lower than WRIM-1’s 3.87M train**, but **not quantified per sampled unit** in Recovery-007 beyond family CE.

---

## 18. Capacity assessment

Architecture: **19,217,152** parameters (Recovery-007 load proof).

| Hypothesis | Evidence |
|---|---|
| Recipe/LR caused collapse | **Strong** — 3e-4 interleaved mix FAIL (005); 3e-5 PASS (006/007) |
| 19M cannot fit leftover CE ~7 | **Not isolated** — leftover CE slowly fell; no plateau proving capacity |
| 19M cannot acquire new JSON/code | **Not isolated** — 150 steps, tiny LR, tiny behavior targets |
| WRIM-0 already uses capacity for Austen | Parent is a literary LM; rehearsal CE 4.4 shows that niche is represented |

**EVIDENCE OF CAPACITY LIMIT: INSUFFICIENT EVIDENCE**

Do not recommend a larger model from this audit.

---

## 19. Missing evidence

1. Official **step count**, **cosine horizon**, and **packed unique token** size locked together.
2. **Uncontaminated capability held-out** with WRIM-supported scorers, leak-scanned on the actual stream, **not** stored in ingestible `docs/` or `lib/wrim1-dataset/heldOut.ts` clones.
3. Behavior/tool **target** mass sufficient to justify instruction/tool claims — or an honest drop of those claims.
4. Per-family **held-out CE** (not only train source-local CE).
5. Proof that 30% rehearsal is optimal for acquisition (not required to keep 30% for stability).
6. Proof that 3e-5 acquires capability at a longer horizon (not required to raise LR now).
7. Code/JSON **quality-weighted** token census of the **selected** 400k units (paths exist on `PackedUnit` but were not dumped in the mix report).
8. Near-duplicate audit between any new eval items and the 31 behavior strings.

---

## 20. Design changes, if any

`docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md` **was revised as a design document only** (changelog in that file). Trainer code was **not** modified. No training. No checkpoints. No lineage change.

Summary of document changes:

- Status set to **REVISION REQUIRED — NOT READY TO EXECUTE**.
- Added an explicit **capability learning objective** and the operational definition of better-than-WRIM-0.
- Recorded actual token/target counts (including 339 behavior targets / 16 tool-use targets).
- Classified 3e-5 as **stability-proven, acquisition-unproven**; duration still required before execute.
- Forbidden reuse of Wave 8.1 as promotion proof; required a new leak-scanned capability suite; kept 13 probes as **collapse diagnostics only**.
- Kept 30% rehearsal as inherited stability, not an acquisition optimum.
- Restated WRIM1-RUN-000002 **locked**.

---

## 21. Exact recommendation

**B. DESIGN NEEDS REVISION** (this packet).

Do **not** launch WRIM1-RUN-000002.  
Do **not** launch Recovery-008.  
Do **not** raise LR.  
Do **not** change mix percents in the same breath as first official execute.  
Do **not** promote Recovery-007.

Next human work (still not training):

1. Accept or amend the revised design’s capability objective (honestly: **LM continuation + JSON exposure**, not tool-use/instruction mastery).
2. Specify duration + pack size + cosine horizon **together**, or keep the run unauthorized.
3. Commission a **new** capability eval artifact that is eval-only, leak-scanned, and not ingested.

**Not C:** a new TEST_ONLY is not the highest-leverage next step until the design can **measure** acquisition. Recovery-007 already gave stability. Running another 150-step collapse watch would not answer “smarter.”

**Not A:** missing objective, missing duration, unusable promotion eval, negligible behavior/tool targets.

---

## 22. Official-run readiness

| Gate | Status |
|---|---|
| Stability at 3e-5 interleaved 150 steps | PASS (TEST_ONLY) |
| Measurable capability objective in design (pre-revision) | FAIL |
| Sufficient learning signal for claimed operator skills | FAIL |
| Clean held-out capability proof | FAIL |
| Justified official token budget | FAIL (unspecified) |
| WRIM1-RUN-000002 | **NOT AUTHORIZED** |
| Production `/Users/markbroughton/WarRoomNode01` | **UNTOUCHED** |
| Git | **No commit/push this mission** |

---

# WRIM-1.1 OFFICIAL CANDIDATE DESIGN — REVISION REQUIRED

WRIM1-RUN-000002 — NOT AUTHORIZED  
RECOVERY-007 — TEST_ONLY (not promoted)  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.** Do not change production env.
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.** Do not restart production. Do not start training.
4. Verification URLs/routes — none. Read this file and the revised `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md`. Recovery-007 artifacts remain under `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007/`.
5. Expected successful output — Commander review complete; verdict **REVISION REQUIRED**; official run still locked.
6. Feature flags enabled/disabled — none.
7. What should visibly change in UI — nothing.
8. Safe rollback instruction if needed — delete only this review markdown and revert the design-doc changelog if Commander rejects the revision. Do **not** delete Recovery-001–007. Do not change production weights.
