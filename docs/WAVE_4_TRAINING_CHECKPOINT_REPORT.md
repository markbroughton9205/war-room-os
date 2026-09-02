# WAR ROOM AGI — Wave 4 Training & Checkpoint Improvement Loop

Date: 2026-08-30  
Verdict: **PASS WITH CONDITIONS**

## Repository truth and boundaries

- Authoritative repo: `/Users/markbroughton/Developer/war-room-os`.
- Waves 1, 2, and 3 were treated as PASS and their regression suites remain green.
- The repo contained extensive unrelated dirty WIP before Wave 4. It was preserved.
- No commit, push, deploy, promotion, remote migration, production connection, autonomous crawl, WRIM-1 training process, or Wave 5 work occurred.
- `/Users/markbroughton/WarRoomNode01` was not accessed.

## Reused systems

Wave 4 extends Wave 3 `active-learning` candidate eligibility and the existing `sovereign-model-lab` corpus, tokenizer, checkpoint, hardware, training-plan, and state-machine infrastructure. It represents Research Engine, Code Operator, Terra, Experience/Failure, Commander corrections, curriculum, and capability evidence through provenance/curriculum/capability references. It does not create another trainer, corpus store, checkpoint vault, or learning runtime.

## Files and migration

- `lib/training-checkpoint/types.ts` — dataset, split, checkpoint, eval, recommendation, rollback, and estimate contracts.
- `lib/training-checkpoint/engine.ts` — canonical hashing, fail-closed filtering, deduplication, lineage-safe splitting, checkpoint registration, gates, and M1 estimates.
- `lib/training-checkpoint/store.ts` — existing Supabase admin-client persistence path.
- `lib/training-checkpoint/index.ts`
- `lib/training-checkpoint/engine.validation.ts`
- `lib/training-checkpoint/postgrest.validation.ts`
- `lib/sovereign-model-lab/runtime.ts` — narrow tokenizer namespace fix and formal recovery transition enforcement.
- `lib/sovereign-model-lab/types.ts` — explicit recovery-transition table.
- `supabase/war_room_phase53a_training_checkpoint_loop.sql` — next real additive phase.
- `package.json` — Wave 4 validation commands.

Phase 53A adds service-role-only, RLS-enabled tables for immutable dataset manifests, checkpoint candidates, and eval manifests. Database constraints permanently keep `training_started = false`, `promotion_executed = false`, and Commander promotion authorization `not_requested` in this planning layer. Update/delete triggers make lineage records append-only.

## Dataset eligibility, provenance, deduplication, and splits

Admission fails closed unless the source record is both Wave 3 eligible and verified. It excludes missing or poor provenance, missing source lineage, secrets, hidden chain-of-thought, poisoned inputs, stale records, retracted/contested records, and unapplied Commander corrections.

Content is normalized (Unicode NFKC, whitespace, case) and SHA-256 hashed for exact semantic-format duplicate detection. Duplicate content is excluded. Split assignment is deterministic from sorted source-lineage IDs: 80% train, 10% validation, 10% test. Records sharing a source lineage cannot cross splits; bridge records that would join already assigned lineages across split boundaries are excluded as `source_lineage_leakage`.

The immutable dataset hash covers policy version, sorted Wave 3 parent manifests, record IDs, content hashes, split assignments, provenance and lineage, correction metadata, curriculum tags, and capability tags. Creation time is deliberately excluded, so rebuilding identical content produces the same hash and manifest ID.

## Commander corrections and curriculum/capability mapping

Corrections retain correction ID, Commander identity, time, applied status, and superseded record ID. An unapplied correction cannot enter a dataset. Admitted records carry explicit curriculum and capability tag arrays into the hashed manifest and later before/after scorecards.

## Manifest and lineage formats

- Dataset manifest: `w4ds_<hash-prefix>`, parent Wave 3 manifests, admitted records, exclusions/reasons, split counts, full SHA-256, immutable/training-not-started assertions.
- Checkpoint candidate: `w4ckpt_<hash-prefix>`, fixed model label `WRIM-1-candidate`, exact WRIM-0 parent checkpoint ID/hash, dataset ID/hash, tokenizer hash, and rollback checkpoint equal to its parent.
- Eval manifest: `w4eval_<hash-prefix>`, held-out benchmark references, capability-keyed baseline/candidate/minimum/regression values, and content hash.

Imported pretrained models cannot be registered as WRIM lineage: every candidate parent must use an explicit `WRIM-0:` checkpoint identity with a 64-character content hash. The existing final WRIM-0 weights hash is `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`; the adopted tokenizer hash is `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`.

## Eval, regression, recommendation, and rollback gates

Every eval needs held-out benchmark references and capability metrics. A candidate is rejected when any score is below its absolute minimum or exceeds its allowed regression from WRIM-0. The output is only `recommend` or `reject`; it never authorizes or executes promotion. Commander authorization remains a later separate action. Rollback lineage always points to the immutable parent WRIM-0 checkpoint.

No benchmark result was fabricated. The tests use declared fixtures solely to prove gate behavior.

## Resource-aware M1 training-plan estimator

The estimator returns steps, broad low/high wall-clock range, peak-memory range, checkpoint disk, feasibility, and explicit assumptions. It has low confidence until calibrated by a separately approved bounded benchmark and never launches a process.

Measured current host facts: Apple M1, 8 logical CPUs, 8 GiB unified memory, and about 22.1 GiB free disk at closeout (disk 95% used). A planning-only example using the existing WRIM-0 parameter count (19,217,152), existing Genesis shard tokens (320,416), three epochs, sequence 512, and effective batch 8 yields 235 steps, a deliberately broad 0.03–0.26 hour range, estimated peak 0.34–0.61 GiB, and about 73 MiB per fp32 checkpoint. At measurement time only about 111 MiB was reported free by the OS, so the estimator truthfully classified execution as not currently feasible. These are estimates, not observed training performance.

## Tokenizer collision and Model Lab recovery audits

The Genesis path-collision defect was still present: tokenizer output used only corpus ID/version. It is fixed narrowly by adding a SHA-256 namespace over corpus checksum, algorithm, requested/recommended vocabulary, minimum frequency, and seed. Same-corpus A/B plans now produce different artifact directories and cannot overwrite each other.

Truth reconciliation previously wrote a corrected state while deliberately bypassing the transition validator. Wave 4 correctness benefits from closing that escape hatch. A separate formal recovery map now allows only `tokenizer_ready → tokenizer_plan_ready` or `tokenizer_ready → tokenizer_not_planned`; every correction is validated and audited as `formal_recovery`. It does not add any model-training transition.

## Validation evidence

Deterministic full regression command: `pnpm run validate:agi-wave4` — **144/144 PASS**:

- Wave 1: 72/72
- Wave 2 additions: 12/12
- Wave 3 additions: 31/31
- Wave 4: 29/29

Wave 4 proves fail-closed eligibility; provenance and source lineage; normalized deduplication; deterministic content hashes/splits; lineage leakage rejection; secret/hidden-CoT/stale/retracted/contested/poison exclusions; Commander correction auditability; curriculum/capability mapping; parent and rollback protection; no auto-training/promotion; before/after capability regression gates; bounded M1 estimates; tokenizer namespace isolation; and recovery-table boundaries.

- `pnpm exec tsc --noEmit` — PASS.
- Targeted ESLint over Wave 4 and modified sovereign-model-lab files — PASS.
- Disposable PostgreSQL 16.15 + PostgREST 16.2 + real `supabase-js` — **12/12 PASS**.

Live checks covered all three Phase 53A tables in the schema cache, service-role persistence, anon denial, immutable dataset lineage, WRIM-0 parent enforcement, checkpoint rollback lineage, eval persistence, and database rejection of training start and promotion/authorization coupling.

All live endpoints bound to `127.0.0.1` only. Ports `55539`, `33109`, and `33110` were clear after cleanup, and both disposable data directories were removed. No production URL or credential was used.

## Limitations and first WRIM-1 decision

Current data is **not sufficient to justify a first WRIM-1 run**. The Phase 53A tables are intentionally unapplied outside the disposable database and contain no real admitted Wave 4 dataset. The existing 320,416-token Genesis shards predate Wave 4 eligibility/provenance/split gates and cannot be silently grandfathered into WRIM-1. There are also no real held-out WRIM-1 eval results, and the current M1 was under severe memory and disk pressure at closeout.

## Exact next step

Populate a reviewed, non-production Phase 53A instance from real Wave 3 eligible records; inspect every exclusion and lineage bridge; obtain a non-empty, immutable dataset with useful train/validation/test coverage; define held-out capability evals; then have the Commander review the dataset and resource plan. Only after those gates pass should a separate authorization decision consider a bounded WRIM-1 training run.

## Verdict

**PASS WITH CONDITIONS.** Wave 4’s governed dataset/checkpoint/eval planning loop is implemented and locally validated. Its conditions are substantive and intentional: no real eligible dataset or eval evidence yet justifies WRIM-1, no promotion has been authorized, and no training was started.
