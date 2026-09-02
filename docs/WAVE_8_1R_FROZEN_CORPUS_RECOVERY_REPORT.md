# WAVE 8.1R — FROZEN CORPUS BYTE RECOVERY + IMMUTABLE SHARD MATERIALIZATION

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: inspect only. No commit, push, merge, rebase, reset, stash, or clean.

## FINAL VERDICT

**WAVE 8.1R — PASS**

FROZEN WRIM-1 CORPUS BYTES — RECOVERED AND MATERIALIZED  
WRIM1-RUN-000001 — READY FOR NEW COMMANDER AUTHORIZATION  
WRIM-1 TRAINING — NOT STARTED  
WRIM-1 CANDIDATE — NOT CREATED  
PRODUCTION — UNCHANGED

---

## 1. FAILED TRAINING START PRESERVED

Yes. Original artifacts were not overwritten:

- `model-lab/manifests/wave9/WRIM1-RUN-000001-preflight.json` still records **FAIL** / `corpus_bytes_reconstructable`
- `docs/WRIM1_RUN_000001_TRAINING_REPORT.md` still records 0 steps / no checkpoints
- Copies: `model-lab/manifests/wave8_1_recovery/preserved-failed-start/`
- Prior Commander authorization was received but **not** persisted to `AUTHORIZED`. History: `model-lab/manifests/wave8_1_recovery/authorization-attempt-history.json`
- No `WRIM1_COMMANDER_AUTHORIZATION_TOKEN` was created in this mission

The first official attempt remains FAIL, 0 steps, no WRIM-1 checkpoints.

## 2–3. FROZEN CORPUS ID / HASH

- ID: `WR-CORPUS-1-HARDENED-CANDIDATE`
- Logical identity hash (unchanged): `76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27`
- Wave 8.1 `corpus-manifest.json` was not mutated
- Materialized bundle hash (new artifact identity): `d1fa97f0873c18895cede5c4720912c4a6bb3801f3327b06b9c6ec438f91061e`

## 4–8. CHUNK INVENTORY (REPO TRUTH)

| Metric | Count |
|---|---|
| TOTAL_FROZEN_CHUNKS | **11,164** |
| MATCH_CURRENT_WORKTREE (JS UTF-16 offsets) | **11,150** |
| MISMATCH_CURRENT_WORKTREE | **14** |
| DRIFTED PATH COUNT | **5** |

The original official failure reported **575** mismatches. That number was produced by **Python Unicode code-point slicing** against offsets that Wave 8.1 created with **JavaScript UTF-16 `String.slice`**. It is not the recovered-byte inventory.

True current-worktree hash mismatches (JS-equivalent offsets): 14 chunks across 5 paths.

## 9–14. RECOVERY SOURCES (HASH MATCH IS AUTHORITY)

Chosen source (first exact `contentHash` match):

| Source | Chunks |
|---|---|
| current_worktree | 11,150 |
| git_index | 0 |
| git_head | 0 |
| git_historical | 0 |
| existing_artifact (`wave81-tokenize-*.json` local tokenizer payload) | 14 |
| other | 0 |
| UNRECOVERABLE | **0** |

Git HEAD/index were inspected as candidates. They were not selected when the live worktree already reproduced the frozen hash (including `app/api/chat/execute.ts` and `app/page.tsx`). No current source file was checked out, restored, or overwritten.

## 15. EXECUTE.TS RECOVERY RESULT

**PASS.** All frozen `app/api/chat/execute.ts` chunks match current worktree bytes when sliced with UTF-16 offsets. Official shards store those exact bytes. Live-file reconstruction is no longer the official loader.

## 16. PAGE.TSX RECOVERY RESULT

**PASS.** Frozen `app/page.tsx` chunks recovered from current worktree via UTF-16 offsets. File was not reverted.

## 17. AFRICA REGISTRY RECOVERY RESULT

**PASS.** `docs/research/earth-knowledge/AFRICA_REGISTRY_RECONCILIATION.md` chunks recovered from current worktree via UTF-16 offsets. File was not reverted.

## 18. BEHAVIOR PAYLOAD RESULT

**PASS.** 31 examples in `model-lab/manifests/wave8_1/behavior-examples.json` verified by `renderedHash`. Copied into materialized JSONL as `kind=behavior_example`.

## 19–22. SHARDS

Source JSONL (3):

| Shard | SHA-256 | Records |
|---|---|---|
| train/shard-00000.jsonl | `0dd54a78fdb098d9b20a86e7698456ddfef9ee3a20bd424fde0ee1b03d14e068` | 8477 |
| validation/shard-00000.jsonl | `1d57f8c7821132f3789812d9504300f4c8085f8ec6ea4eccd2ceddb4eab9b668` | 1853 |
| test/shard-00000.jsonl | `655d51f040a8018b0d9790d7d83c69ae1159c19917183718470e59bb97249a90` | 865 |

Token NPY mmap shards (3), tokenizer `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`:

| Shard | SHA-256 | Tokens |
|---|---|---|
| tokens/train.npy | `59dc20879a6e884e19b9e75c0235cec32d4135a547d58d744637b9a5f713ac0f` | 3,874,900 |
| tokens/validation.npy | `8383801b3ca5859fd02e14be40f156e00ce2ac06fa508f06b50ce0ddbb7718a0` | 836,935 |
| tokens/test.npy | `950301a68d271411674bb7c2215392558088327bd896338edaf065b782c755ec` | 310,725 |

Location: `model-lab/corpora/WR-CORPUS-1-HARDENED/`

## 23. MATERIALIZED BUNDLE HASH

`d1fa97f0873c18895cede5c4720912c4a6bb3801f3327b06b9c6ec438f91061e`

## 24–27. TOKEN COUNTS / SPLIT

| Split | Frozen chunks | Tokens |
|---|---|---|
| train | 8449 | **3,874,900** |
| validation | 1853 | **836,935** |
| test | 862 | **310,725** |
| total | 11164 | **5,022,560** |

Exact frozen split membership. No reshuffle.

## 28–30. LEAKAGE / HELD-OUT / DRIFT

- Leakage re-run on recovered bytes: **PASS** (near-dup 0, lineage cross-split 0, held-out collisions 0)
- Held-out isolation: **PASS**
- Worktree drift independence: **PASS** (`source_worktree_drift` informational; `corpus_materialized_integrity` PASS)

## 31–36. FAIL-CLOSED TESTS (TEST_ONLY COPIES)

| Test | Result |
|---|---|
| Byte corruption | FAIL closed |
| Token corruption | FAIL closed |
| Wrong tokenizer | FAIL closed |
| Missing shard | FAIL closed |
| Split tamper | FAIL closed |

Official shards were not corrupted.

## 37–41. TRAINER / PREFLIGHT / AUTH / TRAINING

- Official trainer data source: **immutable materialized shards** (`np.load(..., mmap_mode="r")`). Live-repo reconstruction raises.
- Official readiness preflight: **PASS** (`model-lab/manifests/wave8_1_recovery/readiness-preflight.json` and updated `model-lab/manifests/wave9/preflight.json`). Failed-start file `WRIM1-RUN-000001-preflight.json` left as FAIL history.
- Authorization: `AWAITING_COMMANDER_AUTHORIZATION` / `TRAINING_AUTHORIZED=false`
- Training: `NOT_STARTED` / 0 steps
- Official checkpoint count: **0** (no `model-lab/manifests/wrim1_checkpoints/**/model.safetensors`)

`WRIM1-RUN-000001.json` gained a **companion** `materialized_corpus` locator. `corpus_sha256` and other identity-protected fields were not changed.

## 42–45. UNTOUCHED SURFACES

- WRIM-0: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` (untouched)
- WR-TOKENIZER-0: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7` (untouched)
- Production `/Users/markbroughton/WarRoomNode01`: not touched
- Git: no commit/push/merge/rebase/reset/clean

## 46–48. REGRESSIONS / STATIC

| Check | Result |
|---|---|
| Wave 8.1 TS validator | **28/28 PASS** |
| Wave 8.1R Python | **17/17 PASS** |
| Wave 8.1R TS | **22/22 PASS** |
| Wave 9 TS validator | **40/40 PASS** (`prove_wave9.py` not re-run: it overwrites run/auth identity) |
| `pnpm exec tsc --noEmit` | PASS |
| targeted ESLint (`wave81r.validation.ts`, `run-wave81-hardening.mjs`) | PASS |
| `git diff --check` | PASS |
| `pnpm run build` | PASS (existing NFT trace warnings unrelated) |

## 49. REMAINING BLOCKERS

1. A **new** Commander instruction is required to persist `AUTHORIZED` and start `WRIM1-RUN-000001`.
2. Do not treat the failed first attempt as a completed run identity.

## 50. FINAL VERDICT

**WAVE 8.1R — PASS**
