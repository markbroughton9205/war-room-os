# WRIM-1.1 TOOL_USE CURRICULUM FORENSICS

Date: 2026-08-31  
Authorization: Commander READ-ONLY / DESIGN mission. **No training. No Recovery-011 execution. No WRIM1-RUN-000003. No production. No git commit/push.**

Machine evidence:

- `model-lab/manifests/wrim1_1_tool_curriculum/test-design/WRIM-1.1-TOOL-USE-FORENSICS/`
- Generator (unaltered V1): `scripts/wrim1-training/capability_curriculum_lib.py` `_build_tools()`
- Packed examples: `model-lab/manifests/wrim1_1_capability/test-design/WR-CORPUS-1.1-CAPABILITY-CANDIDATE/supervised-examples.jsonl`
- Tokenizer: WR-TOKENIZER-0 `model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json`

## FINAL VERDICT

**WRIM-1.1 TOOL_USE CURRICULUM — REDESIGN READY**

The 88 TOOL_USE examples are **100% synthetic**. They are slot-fills of **five base templates**, not 88 independent tool situations. **54.5%** are the same `sha256` `<tool_call>` JSON skeleton. Held-out TOOL remains **0/10** on WRIM-0 and after training. Recovery-010 removing this family completed 250/250. The supported mechanism is **repeated medium-length JSON tool-call envelopes with hyphenated argument strings**, not live tools and not a proven 19.2M capacity wall.

Companion design: `docs/WRIM1_1_TOOL_USE_CURRICULUM_V2_DESIGN.md`, `docs/WRIM1_1_RECOVERY_011_DESIGN.md`.

---

## PART 1 — EXACT 88-EXAMPLE INVENTORY

Count confirmed **88**. Generated IDs match packed JSONL IDs.

Full input/target text, schema, and hashes: `inventory.json` (not rewritten in place).

Schema on every call/select example is the same three-name block (`sha256`, `lookup_note`, `none`) from `_TOOL_SCHEMA`. Interpretation examples carry a tool-result JSON **in the prompt** (masked).

| # | example_id | provenance | source_identity | tool | keys | target_tok | unit_tok | format | planned_steps_008 |
|---:|---|---|---|---|---|---:|---:|---|---|
| 1 | `wr11cap_cac9890995554d8b9b09` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:000` | sha256 | text | 68 | 280 | tool_call_json | 65 |
| 2 | `wr11cap_bcc3230c83952fdcb323` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:001` | sha256 | text | 69 | 282 | tool_call_json | 65 |
| 3 | `wr11cap_1d804b071333fecf89a3` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:002` | sha256 | text | 70 | 283 | tool_call_json | 66 |
| 4 | `wr11cap_043a1726febc2b972c93` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:003` | sha256 | text | 69 | 281 | tool_call_json | 66,67 |
| 5 | `wr11cap_5ebb230f244f61c4b8af` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:004` | sha256 | text | 66 | 275 | tool_call_json | 67 |
| 6 | `wr11cap_ebc5af25f987f415a4b8` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:005` | sha256 | text | 70 | 283 | tool_call_json | 67 |
| 7 | `wr11cap_bf858c01c61b7e28cf35` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:006` | sha256 | text | 68 | 279 | tool_call_json | 67 |
| 8 | `wr11cap_b5ab62ba04aa6066223b` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:007` | sha256 | text | 68 | 279 | tool_call_json | 68 |
| 9 | `wr11cap_67ddc18d47fa86e40464` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:008` | sha256 | text | 67 | 277 | tool_call_json | 68,69 |
| 10 | `wr11cap_ece1fe290a503f86989e` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:009` | sha256 | text | 69 | 281 | tool_call_json | 69 |
| 11 | `wr11cap_779f507417214dbaa462` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:010` | sha256 | text | 70 | 283 | tool_call_json | 69 |
| 12 | `wr11cap_54f54e30133d36ec9d3d` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:011` | sha256 | text | 72 | 287 | tool_call_json | 70 |
| 13 | `wr11cap_a25df64cf039e1869579` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:012` | sha256 | text | 69 | 281 | tool_call_json | 70 |
| 14 | `wr11cap_8a9906a2a33d78320449` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:013` | sha256 | text | 70 | 283 | tool_call_json | 71 |
| 15 | `wr11cap_145639ea3894c7ad0d81` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:014` | sha256 | text | 70 | 283 | tool_call_json | 71 |
| 16 | `wr11cap_531081305888326f375f` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:015` | sha256 | text | 69 | 281 | tool_call_json | 71 |
| 17 | `wr11cap_3d51d61b4150f2b78d89` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:016` | sha256 | text | 66 | 275 | tool_call_json | 72 |
| 18 | `wr11cap_33740ede55bc9f214cb0` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:017` | sha256 | text | 70 | 283 | tool_call_json | 72 |
| 19 | `wr11cap_7cebc692f6159b408e44` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:018` | sha256 | text | 68 | 279 | tool_call_json | 72,73 |
| 20 | `wr11cap_1cf964f3806b0e31dd06` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:019` | sha256 | text | 68 | 279 | tool_call_json | 73 |
| 21 | `wr11cap_aa1975055d71d1e0eb64` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:020` | sha256 | text | 67 | 277 | tool_call_json | 73 |
| 22 | `wr11cap_7cc21f2f82ad94543e93` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:021` | sha256 | text | 69 | 281 | tool_call_json | 74 |
| 23 | `wr11cap_8e68e76dc856e54d429b` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:022` | sha256 | text | 70 | 283 | tool_call_json | 74 |
| 24 | `wr11cap_475e2e7c0f33ad5bd03d` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:023` | sha256 | text | 72 | 287 | tool_call_json | 75 |
| 25 | `wr11cap_21c2e2b8cb3598c71a5b` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:024` | sha256 | text | 69 | 281 | tool_call_json | 75 |
| 26 | `wr11cap_3c25e9fec415ae11cb6d` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:025` | sha256 | text | 70 | 283 | tool_call_json | 76 |
| 27 | `wr11cap_cb6ccc909fb1adef8b1a` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:026` | sha256 | text | 70 | 283 | tool_call_json | 76 |
| 28 | `wr11cap_8b561232f5c1bc3ed4b3` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:027` | sha256 | text | 69 | 281 | tool_call_json | 76 |
| 29 | `wr11cap_3d80d20473a3bb4c20f4` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:028` | sha256 | text | 66 | 275 | tool_call_json | 76 |
| 30 | `wr11cap_fb1437aa68bbc6faac52` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:029` | sha256 | text | 70 | 283 | tool_call_json | 77 |
| 31 | `wr11cap_3971da79e69955d53682` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:030` | sha256 | text | 69 | 280 | tool_call_json | 78 |
| 32 | `wr11cap_9263f0b846a0dfdcac84` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:031` | sha256 | text | 69 | 280 | tool_call_json | 78 |
| 33 | `wr11cap_a4ce916e88dacbf4eccb` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:032` | sha256 | text | 67 | 277 | tool_call_json | 78 |
| 34 | `wr11cap_a76578d204dd207746f0` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:033` | sha256 | text | 70 | 282 | tool_call_json | 78,79 |
| 35 | `wr11cap_efeb9f4a69b869370f39` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:034` | sha256 | text | 71 | 284 | tool_call_json | 79 |
| 36 | `wr11cap_ad9c9d2cedfd3fe84af7` | SYNTHETIC_CURRICULUM | `synth:tool-select-sha:035` | sha256 | text | 73 | 288 | tool_call_json | 80 |
| 37 | `wr11cap_e657f0f4bde5ac4ca2a5` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:000` | lookup_note | note_id | 71 | 259 | tool_call_json | 80 |
| 38 | `wr11cap_480bd51818ae9262286a` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:001` | lookup_note | note_id | 71 | 259 | tool_call_json | 80 |
| 39 | `wr11cap_80c5461117ed844fd8ac` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:002` | lookup_note | note_id | 73 | 262 | tool_call_json | 80 |
| 40 | `wr11cap_0eff1b17f0f04459b457` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:003` | lookup_note | note_id | 73 | 262 | tool_call_json | 81 |
| 41 | `wr11cap_eca2ce294164f3f8db7e` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:004` | lookup_note | note_id | 73 | 262 | tool_call_json | 82 |
| 42 | `wr11cap_98991b366119f04b47f2` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:005` | lookup_note | note_id | 73 | 262 | tool_call_json | 82 |
| 43 | `wr11cap_6d5c567f6a22157751a7` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:006` | lookup_note | note_id | 73 | 262 | tool_call_json | 82 |
| 44 | `wr11cap_2f6c965bd9e3044373e1` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:007` | lookup_note | note_id | 73 | 262 | tool_call_json | 82 |
| 45 | `wr11cap_b4648405a5c76d45777e` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:008` | lookup_note | note_id | 73 | 262 | tool_call_json | 83 |
| 46 | `wr11cap_062b086e69365fadf383` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:009` | lookup_note | note_id | 73 | 262 | tool_call_json | 84 |
| 47 | `wr11cap_3c57e20277ef838c2f5c` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:010` | lookup_note | note_id | 73 | 262 | tool_call_json | 84 |
| 48 | `wr11cap_61ae7e469093dd89f9c5` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:011` | lookup_note | note_id | 73 | 262 | tool_call_json | 84 |
| 49 | `wr11cap_3fa80c8c21a125fd3ac2` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:012` | lookup_note | note_id | 73 | 262 | tool_call_json | 84 |
| 50 | `wr11cap_f963cf5946a0ad3a20a1` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:013` | lookup_note | note_id | 73 | 262 | tool_call_json | 85 |
| 51 | `wr11cap_46cf8fe53631f066a298` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:014` | lookup_note | note_id | 73 | 262 | tool_call_json | 85 |
| 52 | `wr11cap_31e1175e3cdd8b9d8f80` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:015` | lookup_note | note_id | 73 | 262 | tool_call_json | 86 |
| 53 | `wr11cap_39d2fa6d9a18cb25f8fc` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:016` | lookup_note | note_id | 73 | 262 | tool_call_json | 86 |
| 54 | `wr11cap_e7a19268aa62334c9da5` | SYNTHETIC_CURRICULUM | `synth:tool-lookup:017` | lookup_note | note_id | 73 | 262 | tool_call_json | 86 |
| 55 | `wr11cap_2880dc69b615d0270d82` | SYNTHETIC_CURRICULUM | `synth:tool-none:000` | none | reason | 85 | 313 | tool_call_json | 86 |
| 56 | `wr11cap_e034819ccc64bb8a087e` | SYNTHETIC_CURRICULUM | `synth:tool-none:001` | none | reason | 88 | 311 | tool_call_json | 87 |
| 57 | `wr11cap_c95f296cf0a5c77c38c2` | SYNTHETIC_CURRICULUM | `synth:tool-none:002` | none | reason | 83 | 294 | tool_call_json | 87,88 |
| 58 | `wr11cap_1978619260e499dbbf68` | SYNTHETIC_CURRICULUM | `synth:tool-none:003` | none | reason | 82 | 295 | tool_call_json | 88 |
| 59 | `wr11cap_202bcd7f3c45a127ee64` | SYNTHETIC_CURRICULUM | `synth:tool-none:004` | none | reason | 81 | 300 | tool_call_json | 88 |
| 60 | `wr11cap_9302c1fe7d9030a32287` | SYNTHETIC_CURRICULUM | `synth:tool-none:005` | none | reason | 80 | 291 | tool_call_json | 89 |
| 61 | `wr11cap_c273337d1730c4912a58` | SYNTHETIC_CURRICULUM | `synth:tool-none:006` | none | reason | 83 | 295 | tool_call_json | 89 |
| 62 | `wr11cap_d12f595152786b3bf84a` | SYNTHETIC_CURRICULUM | `synth:tool-none:007` | none | reason | 84 | 301 | tool_call_json | 90 |
| 63 | `wr11cap_9a34a2cc3956d94df283` | SYNTHETIC_CURRICULUM | `synth:tool-none:008` | none | reason | 86 | 300 | tool_call_json | 90 |
| 64 | `wr11cap_c12f3e50714a927fed74` | SYNTHETIC_CURRICULUM | `synth:tool-none:009` | none | reason | 82 | 293 | tool_call_json | 91 |
| 65 | `wr11cap_d1cf4423255b30ea62f0` | GYM_FIXTURE | `synth:tool-fail-redirect:000` | sha256 | text | 63 | 265 | tool_call_json | 91 |
| 66 | `wr11cap_9afb44c63c6fd3d1c83b` | GYM_FIXTURE | `synth:tool-fail-redirect:001` | sha256 | text | 63 | 265 | tool_call_json | 91 |
| 67 | `wr11cap_74667f5c5c6f4ac61fb8` | GYM_FIXTURE | `synth:tool-fail-redirect:002` | sha256 | text | 63 | 265 | tool_call_json | 92 |
| 68 | `wr11cap_ea5e48bbaf30db0acfe2` | GYM_FIXTURE | `synth:tool-fail-redirect:003` | sha256 | text | 64 | 267 | tool_call_json | 92 |
| 69 | `wr11cap_ba4007dacb955ebd22fd` | GYM_FIXTURE | `synth:tool-fail-redirect:004` | sha256 | text | 63 | 265 | tool_call_json | 93 |
| 70 | `wr11cap_5029e10ce15689bd0118` | GYM_FIXTURE | `synth:tool-fail-redirect:005` | sha256 | text | 64 | 267 | tool_call_json | 93 |
| 71 | `wr11cap_b622ac5f370418ba3227` | GYM_FIXTURE | `synth:tool-fail-redirect:006` | sha256 | text | 63 | 265 | tool_call_json | 93,94 |
| 72 | `wr11cap_94d3f07c8d587b4d44c3` | GYM_FIXTURE | `synth:tool-fail-redirect:007` | sha256 | text | 64 | 267 | tool_call_json | 94 |
| 73 | `wr11cap_b25c2ca9a0389aee6aaf` | GYM_FIXTURE | `synth:tool-fail-redirect:008` | sha256 | text | 64 | 267 | tool_call_json | 94 |
| 74 | `wr11cap_258d53eed87ae1396faa` | GYM_FIXTURE | `synth:tool-fail-redirect:009` | sha256 | text | 64 | 267 | tool_call_json | 95 |
| 75 | `wr11cap_0d226b00ff60a0676ea9` | GYM_FIXTURE | `synth:tool-fail-redirect:010` | sha256 | text | 63 | 265 | tool_call_json | 95 |
| 76 | `wr11cap_95bb4167cf0eecb1e1fa` | GYM_FIXTURE | `synth:tool-fail-redirect:011` | sha256 | text | 63 | 265 | tool_call_json | 95 |
| 77 | `wr11cap_867a92bfbe5c33732767` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:000` | interpret | — | 60 | 202 | prose_interpret | 95 |
| 78 | `wr11cap_739529c5981b34fefadd` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:001` | interpret | — | 58 | 198 | prose_interpret | 96 |
| 79 | `wr11cap_962ea95bbbf37a6b1ca0` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:002` | interpret | — | 59 | 201 | prose_interpret | 96 |
| 80 | `wr11cap_34719bc68e9def92a32f` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:003` | interpret | — | 58 | 198 | prose_interpret | 97 |
| 81 | `wr11cap_23afd11206e00b30e87f` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:004` | interpret | — | 57 | 198 | prose_interpret | 97 |
| 82 | `wr11cap_9bb41acd95526235b80a` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:005` | interpret | — | 60 | 203 | prose_interpret | 97 |
| 83 | `wr11cap_2240b251538d0b3af11f` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:006` | interpret | — | 58 | 199 | prose_interpret | 97 |
| 84 | `wr11cap_1dfb2d8ed6102fbe6328` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:007` | interpret | — | 59 | 200 | prose_interpret | 97 |
| 85 | `wr11cap_0b91a0e716592f7485fa` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:008` | interpret | — | 56 | 195 | prose_interpret | 98 |
| 86 | `wr11cap_59ea4ded8b25ea7e525f` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:009` | interpret | — | 60 | 202 | prose_interpret | 98 |
| 87 | `wr11cap_60b91fbfadb57b569cb2` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:010` | interpret | — | 59 | 200 | prose_interpret | 99 |
| 88 | `wr11cap_a79c033d47bc71db7c59` | SYNTHETIC_CURRICULUM | `synth:tool-interpret:011` | interpret | — | 62 | 207 | prose_interpret | 99 |

Packed as **88** Recovery-008/000002 windows (contiguous; not token-shuffled). First tool window reaches planned step **65**; last interpret window step **99**. Steps **100 and 120 have zero TOOL_USE windows**.

---

## PART 2 — PROVENANCE

| Class | Count |
|---|---:|
| REAL TRAJECTORY | **0** |
| SYNTHETIC CURRICULUM | **76** |
| GYM FIXTURE (`GYM_DERIVED_SYNTHETIC`) | **12** |
| DERIVED FROM REPO | **0** |
| OTHER | **0** |

`synthetic_vs_observed` = **synthetic 88 / observed 0**.

The 12 gym fixtures are **inspired by** the Wave 8.1 unsafe-curl gym and are **not** Commander trajectories. They still emit the same `sha256` JSON envelope as the 36 hash clones.

---

## PART 3 — TEMPLATE DIVERSITY

**Unique base template families: 5** (from `source_identity` prefixes):

| Family | n | % of 88 |
|---|---:|---:|
| `synth:tool-select-sha` | 36 | 40.9 |
| `synth:tool-lookup` | 18 | 20.5 |
| `synth:tool-fail-redirect` | 12 | 13.6 |
| `synth:tool-interpret` | 12 | 13.6 |
| `synth:tool-none` | 10 | 11.4 |

Largest cluster **36**. Median family size **12**. **100%** of examples belong to these five slot-fill families.

After light prompt slot-stripping: 14 residual prompt strings (the 10 none-prompts failed to collapse because plant-note wording differs). **88.64%** sit in prompt clusters of size ≥2 even under that weaker merge.

**Exact duplicate inputs:** each of 12 hash phrases appears **3 times** (36 = 12×3). Exact duplicate **targets: 0** (disclaimer ids `T-000`… differ).

**Tool-call skeletons: 4.** Normalized JSON key-order after string-value masking: **1** (`{"tool":"<S>","arguments":{"<S>":"<S>"}}`).

Wrapper: **76** `<tool_call>` + disclaimer; **12** prose interpretation.

---

## PART 4 — TOOL-NAME DISTRIBUTION

| Tool | Examples | % of 88 | Target tokens (approx from lengths) | Mean target |
|---|---:|---:|---:|---:|
| sha256 | 48 | 54.5 | ~3,250 | ~68 |
| lookup_note | 18 | 20.5 | ~1,310 | ~73 |
| none | 10 | 11.4 | ~834 | ~83 |
| (interpret / no call) | 12 | 13.6 | ~706 | ~59 |

**Yes: sha256 dominates.** Fail-redirect is also sha256 (12 of the 48).

---

## PART 5 — ARGUMENT-SCHEMA DISTRIBUTION

| Schema | n |
|---|---:|
| `{text}` | 48 |
| `{note_id}` | 18 |
| `{reason}` | 10 |
| (no args / prose) | 12 |

Measured flags on the 76 JSON argument objects:

| Feature | Count |
|---|---:|
| snake_case keys (`note_id`) | 18 |
| camelCase keys | 0 |
| nested objects | 0 |
| arrays | 0 |
| booleans / nulls / numbers | 0 |
| strings | 76 |
| hyphens in **values** | **76 / 76** |
| underscores in keys | 18 |
| path-like / URLs / repo paths / model-lab strings | **0** |
| IDs/hashes (hex-like) | interpret prefixes live in **prompts**, not JSON args |

Concentration: **hyphenated slogans** (`storage-is-not-learning`) and `NOTE-00x` / `recovery-fixture-00`. Not paths, not URLs.

---

## PART 6 — TOKEN-FREQUENCY (WR-TOKENIZER-0, assistant-span only)

Highest-frequency **target** pieces (share of 6,098):

| Piece | Count | Share |
|---|---:|---:|
| newline | 404 | 6.63% |
| `-` | 238 | 3.90% |
| `.` | 231 | 3.79% |
| `tool` | 228 | 3.74% |
| `":` | 228 | 3.74% |
| ` "` | 228 | 3.74% |
| `"` | 218 | 3.58% |
| `_` | 188 | 3.08% |
| `<` / `call` | 152 | 2.49% |
| `}` | 152 | 2.49% |
| `{` + ` {` | 152 | 2.49% |

Inspected fragments:

- `true` / `false` / `null` / `assistant` / `function` / `args` / `path`: **absent** as exact target tokens.
- Quote-related pieces **12.5%** contained-share.
- `tool` contained-share **4.43%** vs instruction **0.10%**, JSON **0**, code **0**.
- `{` contained-share **2.49%** vs JSON family **0.93%** (JSON objects are longer but less wrapper-repetitive per token).
- `_` exact share: tool **3.08%**, code_supervised **3.41%**, JSON **2.27%**, instruction **0.14%**. Underscore is **not unique to tools** versus code.

Unusually concentrated versus QUALITY/REHEARSAL families: **`tool`/`call`/JSON quotes/`":`/`<tool_call>` envelope**, plus **hyphen** from slogan arguments.

---

## PART 7 — DEGENERATION-TOKEN CONNECTION

Direct strings in TOOL_USE **targets**:

| String | Count in targets |
|---|---:|
| `model-lab` | **0** |
| `_not_` | **0** |
| tokenizer piece `-lab` | **0** |
| literal substring `-lab` | 4 (do not treat as the collapse loop) |
| `_not` | 18 (not the `_not_` loop token sequence) |

**Do not claim TOOL_USE targets contain `model-lab` or `_not_` loops.** Those appeared on the **generation path** in Recovery-008/009 diagnostics, not as supervised labels.

Plausible **indirect** path (hypothesis, not proof): repeated hyphenated identifiers + JSON punctuation + `_` in `lookup_note` / `note_id` while MIXED leftover already carries `model-lab` **code paths**. Recovery-010 shows removing this family was sufficient to avoid 4/13; it does not prove the collapse strings were copied from tool labels.

---

## PART 8 — TARGET LENGTH

TOOL_USE only (not the 008-forensics mixed-window mean 89.5, which mixed other supervised families):

| min | p10 | p25 | median | mean | p75 | p90 | max |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 56 | 60 | 64 | 69 | **69.30** | 73 | 80.3 | 88 |

Buckets: 1–16 **0**; 17–32 **0**; 33–64 **24**; 65–128 **64**; 129+ **0**.

Versus other supervised means: JSON 107, evidence 106, WR 103, instruction 80, tool 69, code 59, correction 53. Tool targets are **not the longest family**. Hazard is **repetition of a medium JSON envelope**, not extreme length vs JSON cards.

---

## PART 9 — STRUCTURAL REPETITION

- Same wrapper tokens: `<tool_call>` … `</tool_call>` then one disclaimer line then EOS — **76/88**.
- Same JSON key order: **tool, arguments, one inner key**.
- Same trailing “Predicted … Do not execute …” class — hash/lookup/none.
- 12×3 exact prompt clones for hash.
- 10 none examples = one sky question with different unused plant notes.

Token-level: top pieces are wrapper/punctuation, not diverse argument language.

---

## PART 10 — MASKING SEMANTICS (CONFIRMED)

```
<|bos|> <|system|> …          mask 0
<|commander|> USER/PROMPT     mask 0
Available tools / schema      mask 0
<|assistant|>                 boundary, mask 0
TOOL TARGET (<tool_call>…)    mask 1  ← gradient
<|eos|>                       mask 1  ← gradient
```

- Prompt tokens (mask 0): **17,317**
- Trainable tool targets (mask 1): **6,098**
- Unit tokens: **23,415**
- `<|assistant|>` present: **88/88**
- Tool JSON **before** assistant: **0**
- EOS in assistant span: **88/88**

`wrap_behavior_tokens`: every id **after** `<|assistant|>` is trainable. Intended tool tokens **do** receive gradient. Recovery-008 `tool-target-proof.json`: 84 units with `<tool_call>` after assistant (12 interpret have no wrapper; 84+4? 76 JSON + 8 correction-family tool_calls live outside this family).

---

## PART 11 — EFFECTIVE OBJECTIVE WEIGHT

| Quantity | Value |
|---|---|
| Tool target / all supervised targets | 6,098 / 44,857 = **13.59%** |
| Tool target / pack loss-origin tokens | 6,098 / 615,044 = **0.99%** |
| Tool **windows** / pack tokens | 23,415 / 686,070 = **3.41%** |
| 008 steps containing any tool window | **35 / 120 = 29.2%** |
| 009 steps containing any tool | **11 / 75** (map `tool_tokens`) |

Loss is mean CE over mask=1, so sparse tool slices do **not** inflate per-token CE. They **do** appear in far more batches than 1–3% token share suggests, always as a minority inside MIXED leftover.

**Yes: batch incidence (29% of 008 steps) exceeds raw token share.** That is the effective-influence gap.

---

## PART 12 — GRADIENT / CE SIGNATURE (LOGS ONLY; NO NEW BACKWARD)

TOOL never dominates a step. No solo TOOL grad sample.

Recovery-008 consumed (dominant class):

| Dominant | n | mean grad | median | max | clips |
|---|---:|---:|---:|---:|---:|
| code | 19 | 1.021 | 0.972 | 1.331 | 8 |
| prose | 44 | 0.904 | 0.886 | 1.289 | 15 |
| wr_corpus_0 | 57 | 0.670 | 0.667 | 0.947 | 0 |

Tool-split 008:

| Slice | n | mean grad | median | max | clips | mean supervised CE |
|---|---:|---:|---:|---:|---:|---:|
| tool_pct ≥ 15 | 14 | **0.878** | 0.917 | 1.092 | 3 | 7.59 |
| tool_pct 0 | 85 | 0.829 | 0.774 | 1.331 | 20 | 7.72 |

Tool-heavy steps are **slightly higher grad**, **not** higher supervised CE. Max grad still on leftover-code steps.

009 tool≥15% (n=3): mean grad 0.779 vs 0.671 on tool=0; one clip at step 67.

---

## PART 13 — RECOVERY-008 TOOL-HEAVY REGION

Tool ≥15% of the 4096-token step (reconstructed from window overlap): **67, 71, 73, 76, 78, 80, 82, 84, 86, 88, 91, 93, 95, 97**.

Steps **90–120**:

- 90: none-template (`synth:tool-none`)
- 91–95: fail-redirect sha256 JSON
- 95–99: interpret prose
- **100: no tool windows** (sky `_not_` diagnostic)
- **120: no tool windows** (4/13 stop)

Batches immediately before step-100 `_not_` (from 008 forensics): 97 MIXED CLIP (here: **5 interpret examples**), 98 REH, 99 MIXED (interpret leftovers in stream, tool windows already consumed). Tool family is in the **onset neighborhood**, not the stop step.

---

## PART 14 — RECOVERY-009 TOOL-HEAVY REGION

Logged ≥15% TOOL: **67, 71, 73** only. Stop **75**.

| Step | tool_pct | grad | clip | objective | examples |
|---:|---:|---:|---|---|---|
| 67 | 22.7% | 1.043 | **True** | MIXED | 4× `synth:tool-select-sha` |
| 71 | 20.7% | 0.786 | False | MIXED | 3× same sha256 skeleton |
| 73 | 19.8% | 0.508 | False | MIXED | 3× same sha256 skeleton |

`-lab` already at 009 steps 40/50 **before** this cluster. Tools remain an amplifier / later trigger, not proven unique onset.

---

## PART 15–16 — CROSS-RUN SUSPECTS

**HIGH-SUSPICION template family:** `synth:tool-select-sha` / skeleton `tool_call|sha256|keys=text` (**36 clones + 12 gym sha256**).

**Repeated position pattern:** steps **67, 71, 73** are tool-heavy in **both** 008 and 009 with the **same packed example IDs** (tool windows were not moved).

Not a single unique example ID as the cause: the **family** repeats.

008 later also feeds lookup/none/interpret (80–99). 009 died before that block. Cross-run intersection is the **early sha256 JSON block**.

---

## PART 17 — INTENDED CAPABILITY (WRIM-1.1)

Not live autonomous execution.

Given a request and bounded schema: decide whether a tool is appropriate and produce/interpret a valid **action representation**.

| ID | Subcapability | In V1 88? |
|---|---|---|
| TOOL-01 | tool vs no-tool | Weak (10 near-duplicate none) |
| TOOL-02 | tool selection | Weak (request names the tool) |
| TOOL-03 | required argument extraction | Slot copy into `text` / `note_id` |
| TOOL-04 | valid structured call | **Over-weighted** full JSON |
| TOOL-05 | result interpretation | 12 prose |
| TOOL-06 | failure handling | 12 curl→sha256 clones |

---

## PART 18 — IS FULL JSON TOO HARD FOR THIS STAGE?

**TASK TOO HARD FOR CURRENT CURRICULUM STAGE — yes (as an initial tool objective).**

**MODEL CAPACITY LIMIT — not declared.** JSON family is even longer and Recovery-010 kept it. 19.2M was not shown to be unable to emit short structured tokens; it was shown that **this** JSON envelope plus mix is a stability trigger and **does not lift 0/10 TOOL**.

Evidence: 0/10 held-out; 0/10 after training; 5 templates; hyphen/JSON concentration; 008/009 vs 010 isolation; tool CE similar to other supervised (~7.6), not a unique CE explosion.

---

## PART 19–25 — (see V2 + Recovery-011 design docs)

Recommended stage: **D (short canonical structured call)** with **A/B/C** mixed in, **not E (full JSON)** for Recovery-011.

---

## EXTRA: CORRECTION-FAMILY TOOL JSON

**8** `correction_failure` examples still contain `<tool_call>` sha256 JSON. Recovery-010 **kept** them and **PASS**ed. Residual n=8 JSON calls are **not sufficient** to reproduce 008/009 collapse. Do not rewrite corrections in Recovery-011 (second variable).

---

## STOP

No optimizer steps. No checkpoints. Original 88 records unmodified.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Read this file, `docs/WRIM1_1_TOOL_USE_CURRICULUM_V2_DESIGN.md`, `docs/WRIM1_1_RECOVERY_011_DESIGN.md`, and `model-lab/manifests/wrim1_1_tool_curriculum/test-design/`.
5. Expected successful output — Forensics complete; Recovery-011 **not** started; TOOL eval still 0/10 on CAP-EVAL-0 until a later authorized run.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.**
8. Safe rollback instruction if needed — Delete only the new `model-lab/manifests/wrim1_1_tool_curriculum/` and `model-lab/eval-only/WRIM-1.1-TOOL-EVAL-1/` design dirs plus these docs if discarding the design. Do not touch WRIM-0 or V1 88 examples.
