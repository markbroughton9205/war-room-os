# WAVE 8 — WRIM-1 DATASET BUILD

Date: 2026-08-30  
Verdict: **WAVE 8 — PASS**

Training was **not** started. Wave 9 was **not** started. Production was **not** modified. WR-CORPUS-0 was **not** mutated.

## 1. Repo truth

Authoritative development repo: `/Users/markbroughton/Developer/war-room-os`  
Production worktree `/Users/markbroughton/WarRoomNode01` untouched.  
Parent checkpoint: WRIM-0 `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Tokenizer: WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 2. Prior Wave 8 deficiency

The previous fail-closed inventory was correct: 317,338 unique WR-CORPUS-0 train tokens already consumed by WRIM-0, 5+1 documents, 8 Wave 5 engineering records, no new corpus, no serious multi-domain held-out suite. The old “50 engineering records” floor is **not** used as magical proof. This pass expands data honestly and re-applies an explicit gate.

## 3. Corpus source inventory

Inventoried Commander-owned docs, source, SQL, manifests, and WR-CORPUS-0 public-domain intake. Skipped secrets, binaries, checkpoints, generated Wave 8 outputs, `_to_delete_*`, `node_modules`. Internet-fetched Research Engine text is **not** assumed trainable.

## 4. Eligible / ineligible counts

| Class | Count |
|---|---|
| ELIGIBLE | 2183 |
| REQUIRES_REVIEW | 14 |
| INELIGIBLE | 180 |
| TEST_ONLY (file inventory) | 0 |
| EVAL_ONLY (file inventory) | 0 |

Eval-only items live in the held-out suite (10 items) plus 2 Terra eval specifications, not as filesystem classes. Gym Terra fixtures remain test-only and are not positive training evidence.

## 5. New corpus version

`WR-CORPUS-1-CANDIDATE`  
content hash `36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e`  
immutable, predecessor WR-CORPUS-0. Manifest: `model-lab/manifests/wave8/corpus-manifest.json`

## 6. Unique source token count

Unique **new** source tokens (estimate, UTF-8 bytes / 3.5, not epoch-multiplied): **3,550,621**  
Unique inherited WR-CORPUS-0 overlapping hashes: **385,526**  
Unique source tokens total in candidate mix: **3,936,147**

These are **not** Hugging Face BPE token counts of the full dump. Category BPE efficiency is in §26.

## 7. Repeated training-token estimate (separate)

WRIM-0 already consumed **2,048,000** training tokens (epoch reuse over ~317k unique).  
WR-CORPUS-1-CANDIDATE assumed epochs = 3 → training tokens after reuse ≈ **10,651,863** on **new** unique tokens only. Epoch reuse is not used to inflate unique corpus size.

## 8. Document / record counts

Candidate documents admitted to positive LM/code mix: **2179** (after exact/near dedup).

## 9. Data-format distribution (documents)

| Format | Documents |
|---|---|
| code | 2040 |
| language_modeling | 111 |
| structured_json | 28 |

All twelve canonical example formats exist as contracts (`lib/wrim1-dataset/types.ts`). Instruction/tool/research/contradiction/temporal/spatial/correction/memory formats are carried by example records and the held-out suite, not only as unlabeled files.

## 10. Capability distribution (document tags)

code, tool-use, language, architecture, policy, evaluation-protocol, structured-output, literary-english, schema-reasoning (see corpus manifest). Evidence capabilities additionally include artifact-verification, api-contract, error-recovery, typescript, lint, retrieval.

## 11. Evidence-source distribution

Engineering/tool bundle: 16 `code_operator` + 2 `tool_use` (18 records). `tool_use` maps to `tool_use_result`, not coding.

## 12. Quality tiers

Positive document mix is **Tier A** (Commander-owned or public-domain inherited with provenance). Contested/single-source research examples are **Tier C** and are **not** silently admitted as positive truth (`failure_curriculum`). Verified research example is Tier A.

## 13. Dedup results

exact duplicates dropped: **1**  
near-duplicates dropped: **3**

## 14. Leakage / contamination results

Held-out isolation: **passed** (0 collisions of eval input hashes into train document hashes). Lineage-stable 80/10/10 split. Eval suite excluded from corpus builder after assignment.

## 15. Commander correction examples

**0** admitted. No complete before/correction/after provenance records were found that were safe, compact, and non-secret. None were fabricated.

## 16. Research Engine examples

3 gym-derived process examples: contested contradiction (PASS process, not verified), single-source candidate (not auto-verified), corroborated+verifierConfirmed (verified, positive). Live provider dumps were not treated as trainable.

## 17. World Learning examples

6 durable session-linked examples (retrieve, connect, compare, explain, update, recognize-uncertainty) from a bounded constitution excerpt. Claim status remains **candidate**. Storage is not treated as verified learning. Not a live Supabase crawl.

## 18. Terra examples

**0** real geographic training observations (none fabricated). **2** eval-only temporal/coverage items. Gym coordinates stay test-only.

## 19. Engineering / tool examples

18 records, **17 pass / 1 fail**, **18** distinct lineages, **11** validator types. Fail is uncontrolled-tool recovery (curriculum, not positive proof). Diversity includes repo inspection, code navigation, schema reasoning, artifact hashes, API contract presence, type-source checks, SQL additive migration check, secret/CoT scan, bounded sha256 tool-use.

This is still a **small** engineering set versus the unlabeled code corpus. It materially exceeds the prior 8-record pool without chore spam. It is **not** Native Builder historical backlog (that directory remains empty).

## 20. Train count / tokens

Documents: **1625**  
Estimated unique tokens: **2,561,409**

## 21. Validation count / tokens

Documents: **257**  
Estimated unique tokens: **555,763**

## 22. Test count / tokens

Documents: **297**  
Estimated unique tokens: **818,975**

## 23. Held-out eval domains / counts

10 items: language, code, research, evidence grounding, tool-use protocol, structured output, retrieval/context, contradiction handling, temporal reasoning, memory/project continuity.

## 24. WRIM-0 supported baseline results

From recorded Genesis `wrim0_eval_results.json` (not re-scored as zero):

- `eval-language-alice` SUPPORTED, status `recorded_genesis_eval`, score **null** (completion logged, not a capability grade), outputSha256 `f4e0140877383925ae877ff272ff37d9936242836ff6fb7e0a5aeb3fdd5fdfa2`
- `eval-json-schema` SUPPORTED, **score 0** (Genesis `validJson: false` on the JSON probe), outputSha256 `55c3fb321a940ee5bcb65f041c99749bcdab4cd6f7317ecffb797082b2399a99`

## 25. Unsupported eval categories

code, research, evidence grounding, tool-use, retrieval, contradiction, temporal, memory: `unsupported_by_current_wrim0_runtime`, **score null** (not converted to 0).

MMLU/GSM8K/ARC/HellaSwag are **not** claimed.

## 26. Tokenizer analysis

WR-TOKENIZER-0 via Hugging Face `tokenizers` on category samples (chars/token; higher = more compression):

| Category | chars/token |
|---|---|
| english | 4.41 |
| code | 2.98 |
| json | 1.87 |
| urls | 2.13 |
| coordinates | 1.38 |
| numbers | 1.70 |
| scientific | 3.77 |
| legal_policy | 5.61 |
| multilingual | 2.02 |

JSON, URLs, coordinates, and numbers tokenize poorly relative to English — expected for a literary+tiny-code Genesis vocab.

## 27. Tokenizer decision

**Retain WR-TOKENIZER-0.** No replacement trained. No overwrite. A future tokenizer must be a new immutable artifact in a distinct namespace after measured improvement.

## 28. WRIM-1 architecture options

| Option | Params | ctx | Hardware | Selected |
|---|---|---|---|---|
| A | 19,217,152 | 512 | Apple M1 8GB (this host) | **yes** (candidate if Commander later authorizes Wave 9) |
| B | ~31,000,000 | 512 | M1 unmeasured at this width | no |
| C | ~120,000,000 | 2048 | RTX 5080 / CUDA **not present** | no |

## 29. Selected candidate config

**Option A** — same WRIM-0 width, better data. Not launched.

## 30. M1 memory estimate

Option A peak **3.28–3.43 GB** (Genesis **measured**, not the planning formula). ctx=1024 remains unsafe on 8GB.

## 31. M1 disk estimate

Checkpoint ~**73.4 MiB** fp32 (`parameterCount * 4`). Resume copies ×3 still small vs corpus/shards. WRIM-0 shards already on disk.

## 32. Estimated wall time

Option A: **~3.29–4.28 hours** for 2601 steps, scaled from Genesis 500 steps / ~38 minutes. Planning-only.

## 33. Checkpoint / resume requirements

Parent WRIM-0 final must remain immutable. Wave 9 trainer still **does not exist**. No training process, no resume state.

## 34. Remaining deficiencies (do not block this Wave 8 dataset gate)

- Unique token counts are byte-based estimates, not full-corpus BPE counts.
- Engineering evidence is 17 passes — larger than 8, still small vs unlabeled code.
- Zero Commander-correction supervised pairs.
- Zero real Terra observations in training.
- WRIM-0 cannot score most held-out domains.
- Native Builder historical evidence directory still empty.
- Option B memory is unmeasured.

## 35. Production status

Untouched. No Node01 edits, no production migrations, no deploy.

## 36. Training status

**NOT STARTED.** WRIM-1 training is **not** authorized and was **not** launched.

## 37. FINAL VERDICT

**WAVE 8 — PASS**

Deterministic validator: TOTAL=23 EXPECTED=23 PASS=23 FAIL=0  
Gate file: `model-lab/manifests/wave8/wave8-gate.json`

Wave 8.1 successor (does not mutate this package): `WR-CORPUS-1-HARDENED-CANDIDATE` — see `docs/WAVE_8_1_TRAINING_READINESS_HARDENING_REPORT.md`.

STOP. Do not start WRIM-1. Do not start Wave 9 until the Commander reviews the hardened package.
