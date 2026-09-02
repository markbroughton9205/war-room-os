# WAVE 8.1 — TRAINING-READINESS HARDENING

Date: 2026-08-30  
Verdict: **WAVE 8.1 — PASS**

WRIM-1 training was **not** started. Wave 9 was **not** started. Production `/Users/markbroughton/WarRoomNode01` was **not** modified. WR-CORPUS-0, WR-CORPUS-1-CANDIDATE, WR-TOKENIZER-0, and WRIM-0 were **not** overwritten.

---

## 1. REPO TRUTH

Authoritative development repo: `/Users/markbroughton/Developer/war-room-os`  
Production worktree: `/Users/markbroughton/WarRoomNode01`  
Wave 8 builder (`lib/wrim1-dataset/corpus.ts`, `gate.ts`, `eval.ts` leakage of eval-prompt hashes only) still exists and still rebuilds `WR-CORPUS-1-CANDIDATE` in memory. Wave 8.1 is a **successor pipeline** (`hardenedCorpus.ts`, `gate81.ts`, `behavior.ts`, `leakage.ts`, `chunking.ts`, `tokenize.ts`) that does not mutate `model-lab/manifests/wave8/*`.

## 2. WAVE 8 PACKAGE BASELINE

On-disk Wave 8 package (unchanged):

- Identity: `WR-CORPUS-1-CANDIDATE`
- Hash: `36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e`
- Documents: 2179 (train 1625 / val 257 / test 297)
- Unique new source tokens: **3,550,621** — UTF-8 bytes/3.5 estimate, not WR-TOKENIZER-0
- Engineering/tool bundle: 18 records, 17 pass / 1 fail
- Commander corrections: 0
- Real Terra training observations: 0
- Wave 8 validator: 23/23 PASS (re-run this mission)

## 3. WAVE 8 REVIEW DEFECTS VERIFIED

All seven audit findings were confirmed in code, then addressed in the successor (not by lowering Wave 8’s historical gate):

1. **Leakage too weak** — `eval.ts` `leakageCheck` hashes eval prompts and compares them to whole-file hashes. Fixed in `leakage.ts` (chunk hashes, normalized hashes, n-gram fingerprints, SimHash, lineage cross-split, held-out isolation).
2. **tool-use inflated by file type** — `sources.ts` tagged `.(ts|tsx|js)` as `['code','tool-use']`. Wave 8 classify left unchanged. Hardened taxonomy strips `tool-use` from static source.
3. **Behavior not materialized** — Wave 8 `examples` existed in the builder object but the published `corpus-manifest.json` omitted example payloads. Wave 8.1 writes `behavior-examples.json` with rendered training text + hash.
4. **Engineering diversity weak** — Wave 8 missions were mostly file-exists / JSON-key / hash chores. Wave 8.1 classifies 11 families and admits Wave 4.2 + Wave 5 real missions plus bounded live inspections.
5. **Hardcoded gate booleans** — Wave 8 `productionUntouched: true` and `trainingNotStarted: true` are type-level constants. Wave 8.1 computes `verified | not_checked | unknown`.
6. **Option B/C estimates unreliable** — Wave 8 called `estimateM1TrainingPlan` for 31M/120M. Wave 8.1 labels B/C `SPECULATIVE` / `NOT PRESENT` / `NOT BENCHMARKED` with null wall-clock.
7. **Token accounting misleading** — Wave 8 `inventory.corpusTrainTokens` is still 317,338 (WR-CORPUS-0). Hardened inventory uses WR-TOKENIZER-0 counts of the candidate splits.

## 4. REAL TOKEN COUNTS

Tokenizer: WR-TOKENIZER-0 via Hugging Face `tokenizers` (`scripts/count-wr-tokenizer-0.py`). Byte/3.5 remains a secondary diagnostic only (`byteEstimateTrain`).

| Metric | Value |
|---|---|
| NEW train source tokens (BPE, chunks + rendered examples) | **3,874,900** |
| NEW validation tokens | **836,935** |
| NEW test tokens | **310,725** |
| TOTAL candidate tokens | **5,022,560** |
| WR-CORPUS-0 unique train tokens (historical, not mixed in) | **317,338** |
| WRIM-0 training tokens after epoch reuse (historical) | **2,048,000** |
| Projected hardened training tokens after 2 epochs | **7,749,800** |

These four families are not interchangeable.

## 5. CHUNKING

Deterministic windows of 1400 characters, break on newlines when possible, **no overlap**. Metadata: source id, source hash, document id, chunk id, parent lineage, offset range, content hash, normalized hash, capability tags, format, split, tokenizer token count.

All chunks from one source lineage share one split.

Chunks: **11,164** (train 8449 / val 1853 / test 862).

## 6. EXACT DEDUP

Dropped before admission: **34** exact chunk duplicates, **2** normalized-text duplicates.

## 7. NEAR-DUP DETECTION

Normalized-hash identity plus token-trigram fingerprints (minimum 8 trigrams; short chunks are not compared) plus 64-bit SimHash Hamming ≤ 2, only across **different lineages and different splits**.

Near-duplicate cross-split pairs: **0**.

## 8. CONTENT-LEVEL LEAKAGE

Passed. Held-out collisions: **0**. Prompt-hash-only comparison is no longer the Wave 8.1 gate.

## 9. SOURCE-LINEAGE LEAKAGE

Passed. No source/task/claim/tool/repair/correction lineage appears in train and also in val/test.

## 10. HELD-OUT ISOLATION

Held-out suite is built **before** corpus admission (`buildHeldOutSuite81`). Lineage set and fingerprints are exclusions, not after-the-fact tests. Alice intake is `lineage:heldout:language:alice` and is **not** admitted to the hardened train mix.

## 11. EVIDENCE TAXONOMY

Static TS/JS → `code` only. Separate tags: `engineering_evidence`, `tool_use`, `research`, `world_learning`, `terra`, `commander_correction`, `structured_output`, `retrieval`, `language_modeling`.

## 12. CODE DATA

Format `code`: **2054** documents. Capability `code` dominates the raw mix (~12% of files sit under `lib/research-engine`). Mixing weights exist so this does not silently become 100% of training exposure.

## 13. REAL TOOL-USE DATA

**3** `tool_use` examples with observable `select_tool` / `execute_tool` (or bounded `sha256`) actions and results. Two pass (distinct sha256 phrases). One fail (uncontrolled `curl`) as recovery curriculum. Static source files are not counted.

## 14. ENGINEERING EVIDENCE

All 11 families present:

| Family | Count |
|---|---|
| repo_navigation | 2 |
| diagnosis | 1 |
| repair | 1 |
| test_construction | 3 |
| schema_reasoning | 1 |
| build_reasoning | 2 |
| type_lint_repair | 4 |
| artifact_verification | 3 |
| api_reasoning | 1 |
| tool_selection | 2 |
| error_recovery | 1 |

Includes Wave 4.2 TSC-style missions, Wave 5 typescript/eslint/build/gates/regression, plus live route/schema/alias inspections. `choreHeavy=false` (artifact-verification share ≤ 40%). This is still a **small** engineering set versus unlabeled code. It is not Native Builder historical backlog.

## 15. RESEARCH ENGINE EXAMPLES

4 gym-derived process examples:

- conflict → `contested`, teach uncertainty (positive process, not a verified claim)
- single-source → `candidate`, failure_curriculum / not established truth
- corroborated + verifierConfirmed → `verified`, Tier A positive
- insufficient evidence → not asserted as truth

Live provider dumps are not treated as trainable.

## 16. WORLD LEARNING EXAMPLES

6 session-linked examples (retrieve, connect, compare, explain, update, recognize_uncertainty) from a bounded constitution excerpt. Claim status remains **candidate**. Storage is not treated as verified learning.

## 17. TERRA DATA

Real Terra training observations: **0**. Eval-only temporal + coverage specs: **2**. Gym coordinates remain test-only. Fixtures were not promoted.

## 18. COMMANDER CORRECTIONS

**0**. No complete before/correction/after provenance that was safe and useful. None fabricated.

## 19. BEHAVIOR EXAMPLE FORMAT

Structured records in `model-lab/manifests/wave8_1/behavior-examples.json`:

`example_id`, `format`, `input`, `context_refs`, `evidence_refs`, `toolActions`, `toolResults`, `response`, `validator`, `outcome`, `capability_tags`, `source_lineage`, `provenance`, plus `renderedTrainingText` / `renderedHash`.

No hidden chain-of-thought fields.

## 20. MATERIALIZED BEHAVIOR EXAMPLES

**31** examples physically written with `<|assistant|>` training text. Not metadata-only.

## 21. TRAINING SERIALIZATION

Deterministic blocks: `<|bos|>`, `<|system|>`, `<|commander|>`, optional `<|evidence|>` / `<|tool|>`, `<|assistant|>`, `<|eos|>`. Compatible with WR-TOKENIZER-0 special tokens. Structured record + rendered text + SHA-256.

## 22. QUALITY TIERS

Positive LM/code documents: Commander-owned or public-domain inherited → Tier A. Contested/single-source research is not silent positive truth. Tier C examples are `failure_curriculum` only.

## 23. RIGHTS / PROVENANCE

Each example carries source owner, license name, source ref, retrieval time, content hash, transformation lineage. Unclassified local material remains `REQUIRES_REVIEW` (16) and is not auto-admitted. Publicly reachable internet text is still not assumed trainable.

## 24. HARDENED CORPUS ID

`WR-CORPUS-1-HARDENED-CANDIDATE`

## 25. HARDENED CORPUS HASH

`76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27`

## 26. PREDECESSOR CORPUS HASH

`WR-CORPUS-1-CANDIDATE`  
`36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e`

## 27. TRAIN DOCS / EXAMPLES / TOKENS

Documents **1634** · chunks **8449** · examples **28** · tokens **3,874,900**

## 28. VALIDATION DOCS / EXAMPLES / TOKENS

Documents **490** · chunks **1853** · examples **0** · tokens **836,935**

(Behavior lineages mostly hashed into train/test; unlabeled val is source files.)

## 29. TEST DOCS / EXAMPLES / TOKENS

Documents **70** · chunks **862** · examples **3** · tokens **310,725**

## 30. TOTAL UNIQUE TOKENS

**5,022,560** WR-TOKENIZER-0 tokens in the candidate (train+val+test). Not epoch-multiplied.

## 31. DOMAIN DISTRIBUTION

Raw documents: code-heavy, then natural_language (docs/literary), then json. Alice held out of this mix. Pride and Prejudice remains the largest single source file.

## 32. CAPABILITY DISTRIBUTION

Top capability: `code`. Behavior tags (`tool_use`, `world_learning`, `research`, `engineering_evidence`) are present and small. See corpus manifest `capabilityDistribution`.

## 33. TRAINING MIX

Planning exposure weights (sum 1.00), not capability claims:

| Category | Weight | Rationale |
|---|---|---|
| code | 0.45 | majority of eligible files; still capped so it cannot be the entire epoch |
| language_modeling | 0.20 | docs + literary remainder |
| behavior_instruction | 0.15 | upsample 31 materialized examples |
| tool_use | 0.08 | 3 real trajectories |
| research_evidence | 0.07 | process + uncertainty |
| structured_output | 0.05 | JSON manifests |

## 34. OVERREPRESENTATION ANALYSIS

- Top source file: `model-lab/raw_intake/pride_and_prejudice.txt`
- Top domain: `code`
- Top directory: `lib/research-engine` (~12% of documents)
- Top capability: `code`

## 35. HELD-OUT DOMAINS

10: language, code, structured_output, tool_use, research, evidence_grounding, retrieval_context, contradiction_handling, temporal_reasoning, memory_project_continuity. Terra remains eval/test-only.

## 36. HELD-OUT ITEM COUNT

**10** frozen items (`model-lab/manifests/wave8_1/held-out-eval-suite.json`).

## 37. HELD-OUT SCORERS

`json-validity`, `tool-call-structure`, `contradiction-preserved`, `claim-status`, `citation-evidence-match`, `temporal-order`, `retrieval-target-match`, `exact-string`, plus `unsupported-runtime` where WRIM-0 cannot score the task. Not reduced to a model-judge.

## 38. WRIM-0 BASELINE

Live read-only generation from `checkpoint-final` (weights SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`). No weights written.

| Eval | Support | Status | Score |
|---|---|---|---|
| language Alice | SUPPORTED | live_wrim0_heldout_run | null (not a capability grade) |
| JSON `{"trainingStarted":` | SUPPORTED | live_wrim0_heldout_run | **0** (invalid JSON) |
| other 8 domains | UNSUPPORTED | unsupported_by_current_wrim0_runtime | **null** (not converted to 0) |

MMLU/GSM8K/ARC/HellaSwag are not claimed.

## 39. TOKENIZER ANALYSIS

Measured chars/token on hardened samples: natural language ~2.68, code ~2.51, JSON ~1.75, URLs ~2.13, numbers ~1.70, coordinates **1.38**, science ~3.77, legal ~5.82, tool protocol ~2.33.

Pathological fragmentation (<2 chars/token): JSON, numbers, coordinates.

## 40. TOKENIZER DECISION

**KEEP_WR_TOKENIZER_0**  
No `WR-TOKENIZER-1` trained. No overwrite. `EVALUATE_WR_TOKENIZER_1` remains a future distinct namespace if Commander later authorizes a measured tokenizer experiment.

## 41. TRAINING TOKEN PLAN

Unique train tokens **3,874,900**. Epochs **2** (chosen from corpus scale: ≥2M unique → 2 epochs; not copied from Genesis 6.5). Training tokens **7,749,800**. Steps **1893**. Batch **8**. Seq length **512**.

## 42. OPTION A M1 CONFIG

~19,217,152 params, ctx 512, Apple M1 8GB, selected for current hardware.

## 43. M1 RUNTIME ESTIMATE

Class: **DERIVED** from Genesis 500 steps / ~38 minutes (MEASURED step cadence), applied to 1893 steps.

- best: **2.40 h**
- expected: **2.76 h**
- high: **3.12 h**

Option B/C wall-clock: **null** (NOT BENCHMARKED / NOT PRESENT).

## 44. M1 RAM / SWAP ESTIMATE

Peak RAM **3.28–3.43 GB** — **MEASURED** on WRIM-0 Genesis at ctx=512. ctx=1024 remains unsafe on 8GB. Unified memory on this host: 8,589,934,592 bytes.

## 45. DISK / CHECKPOINT ESTIMATE

Option A checkpoint ≈ **73.4 MiB** fp32 (`parameterCount * 4`). Resume copies ×3 still small versus shards/corpus.

## 46. PHASE 56B LOCAL DB RESULT

Isolated PostgreSQL 16 + PostgREST + loopback `/rest/v1` proxy. **6/6 PASS**: anon blocked; existing `code_operator_result` still inserts; `tool_use_result` admitted; gym `objective_evaluated` / `objective_satisfied` columns present; both evidence kinds persisted; service_role reads gym. Disposable instance destroyed. Production not touched.

## 47. REAL GATE CHECKS

`productionUntouched`: **verified** (this mission wrote only the development repo / `model-lab/manifests/wave8_1`; Node01 exists with pre-existing porcelain, not used as a write target).  
`trainingNotStarted`: **verified** (no `wrim1_checkpoints` or `wave9` dir; no WRIM-1 run manifest; WRIM-0 final remains parent).  
Not hardcoded `true` constants.

## 48. DETERMINISTIC VALIDATION COUNTS

Wave 8.1: **TOTAL=28 EXPECTED=28 PASS=28 FAIL=0**  
Wave 8 regression: **23/23**  
Phase 56B live: **6/6**

## 49. TSC / ESLINT / BUILD / DIFF

- `pnpm exec tsc --noEmit` — PASS
- targeted ESLint `lib/wrim1-dataset` — PASS (`--max-warnings 0`)
- `git diff --check` — PASS
- `pnpm run build` — PASS (exit 0; existing next.config NFT trace warnings unchanged)

## 50. PRODUCTION STATUS

Untouched. No Node01 edits, no production migrations, no deploy.

## 51. TRAINING STATUS

**NOT STARTED.** No WRIM-1 process, no WRIM-1 checkpoint, no Wave 9 trainer.

## 52. EXACT REMAINING BLOCKERS

Wave 8.1 **gate** blockers: **none**.

Residual facts that still matter before any Commander training authorization (not used to hide a FAIL):

1. Tool-use trajectories are real but few (3).
2. Engineering set is diverse across families but still small versus 2000+ code files.
3. Zero Commander-correction pairs; zero real Terra observations.
4. WRIM-0 cannot score 8/10 held-out domains (null, not zero).
5. Wave 9 trainer still does not exist.
6. Native Builder historical evidence directory remains empty.
7. JSON/coordinate tokenizer fragmentation remains; tokenizer was **kept**, not replaced.

## 53. FINAL VERDICT

**WAVE 8.1 — PASS**

Successor corpus `WR-CORPUS-1-HARDENED-CANDIDATE` hash `76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27`.

STOP. Do not start Wave 9. Do not start WRIM-1 training.

---

## NEXT STEPS FOR OPERATOR

1. **Required environment changes** — No operator action required for Wave 8.1 packaging. No new secrets.
2. **Required SQL/migrations** — None on production. Phase 56B was proven only on a disposable local Postgres. Do not apply `supabase/war_room_phase56b_tool_use_evidence_source.sql` to production.
3. **Restart requirements** — No operator action required.
4. **Verification URLs/routes** — No new UI route. Inspect `model-lab/manifests/wave8_1/wave81-gate.json` and `docs/WAVE_8_1_TRAINING_READINESS_HARDENING_REPORT.md`.
5. **Expected successful output** — `gate.passed: true`, `trainingStarted: false`, `wave9Started: false`.
6. **Feature flags enabled/disabled** — None changed.
7. **What should visibly change in UI** — Nothing. This is a dataset package.
8. **Safe rollback** — Delete `model-lab/manifests/wave8_1/` and Wave 8.1 library files if the Commander rejects the package. Leave `model-lab/manifests/wave8/` and WRIM-0 artifacts in place.
