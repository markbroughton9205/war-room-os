# Sovereign Model Lab: Architecture and Governance

This document describes what the Sovereign Model Lab subsystem's code actually does, verified by
direct source inspection of all 23 `lib/sovereign-model-lab/*.ts` files, both Python scripts, a
representative sample of its ~20 API routes, and its two validation suites (152/152 checks
combined: `sovereignModelLab.validation.ts` 69/69, `tokenizerPipeline.validation.ts` 83/83). It
documents only actual implemented behavior — where the code is stronger or weaker than a name might
suggest, that is stated explicitly rather than assumed.

**Commander hardening decision (post-commit fb2aa74):** authentication and program-state eligibility
alone are not sufficient authority to launch the tokenizer subprocess, create output artifacts, or
begin a build job. Tokenizer execution now requires an explicit, job-specific Commander approval at
the point of execution — see section 12a.

## 1. Designation And Status

Implemented and present in the working tree, not yet committed. Internally labeled "Phase 1 +
Phase 2A" in its own source comments. Phase 1 covers hardware audit → source registration →
document ingest → provenance → dataset candidates → Commander dataset approval → training
*planning* (never execution). Phase 2A adds one real capability on top: local tokenizer training
(not model training) through a full environment-probe → plan → Commander-approval →
freshness-recheck → bounded-subprocess → verification chain.

## 2. Purpose

A local, auditable pipeline for building a training corpus from Commander-controlled or
public-domain/openly-licensed documents, with a real (not simulated) rights/access admission
filter, real provenance tracking, and — as far as this phase goes — real local tokenizer training
and verification. It explicitly stops short of training any actual language model.

## 3. Current Capabilities — What Is Real Versus Simulated

| Capability | Real or simulated | Evidence |
| --- | --- | --- |
| Hardware audit (CPU/RAM/GPU/disk/Python/git/WSL detection) | **Real** | `hardwareProbe.ts` — every field is a real OS/subprocess-probed value or `null`, never fabricated |
| Source registration | Real record, no retrieval | `publicSourceRegistry.ts` — "declares an intended acquisition contract... does NOT mean the source is reachable" |
| Document ingestion | **Real**, local-file-only | `documentIngest.ts` — reads, hashes, and language-guesses a local file; zero network code in the module |
| Rights/access admission policy | **Real**, deterministic | `sourcePolicy.ts` — pure function, rights/access-based only, defaults to Commander review on any ambiguity |
| Provenance ledger | **Real**, append-only | `provenanceLedger.ts` — every document change is a new versioned entry, nothing overwritten |
| Dataset manifest / corpus artifact | **Real** | `datasetBuilder.ts`/`corpusBuilder.ts` — re-hashes every document's live bytes before inclusion; a changed or missing file is excluded, never silently trusted |
| Tokenizer environment probe | **Real** | `tokenizerEnvironment.ts` — probes the actual local Python and two named libraries, installs nothing |
| Tokenizer training | **Real** | `tokenizerRuntime.ts` + `train_wrm001_tokenizer.py` — a real bounded local subprocess actually trains a tokenizer from the approved corpus |
| Tokenizer verification | **Real** | `tokenizerVerifier.ts` + `verify_wrm001_tokenizer.py` — 18 checks, 10 running Node-side, 8 delegated to a fresh Python process |
| Model training | **Not implemented — structurally absent** | See section 4 |
| Model registry | Metadata-only scaffolding | `modelRegistry.ts` / `checkpointVault.ts` — real code, but nothing to register yet (no real checkpoint is ever produced this phase) |
| Evaluation | Catalog only, nothing run | `evaluationRegistry.ts` — "Phase 1 defines what would be measured — it does not run any evaluation" |
| Training cost/memory estimation | **Real math**, honestly-labeled estimate | `trainingMemoryEstimator.ts` — itemized formula per line, `knownOmissions` disclosed, never a fabricated dollar/byte figure |

## 4. Model-Training Status — Explicit Confirmation

**This subsystem does not train models, and cannot be made to via any code path that currently
exists.** This is a structural fact, not a policy statement: `SovereignModelLabState` (the entire
state-machine type union in `types.ts`) contains no "training in progress" state. The furthest any
program can reach is `awaiting_commander_training_approval`, whose own transition table
(`SOVEREIGN_MODEL_LAB_TRANSITIONS`) allows only `['blocked', 'cancelled']` from there — there is
nowhere further to go. `runtime.ts`'s own header states this as a "MODEL-TRAINING HARD BOUNDARY,"
and `requestTrainingApproval()` (the function backing that terminal state) says in its own comment:
"approval here does not start training." No function named or shaped like a model-training
executor exists anywhere in the 23 `lib/sovereign-model-lab/*.ts` files. Confirmed independently by
the validation suite's `phase2a_27_no_model_training_function_exists`.

## 5. Tokenizer Behavior

The one real local-process capability in this phase. `createTokenizerPlan()` builds an immutable,
SHA-256-hashed execution plan (fixed executable path, fixed argv array, output directory, max
runtime, `networkPolicy: 'no_network_allowed'`). `approveTokenizerTraining()` mints a **single-use**
approval bound to that exact plan hash and a snapshot of the corpus manifest checksum at approval
time. `startTokenizerTrainingForProgram()` → `startTokenizerTraining()` re-verifies, immediately
before spawning, that: the approval is unconsumed, the plan's own hash still matches its stored
hash (detects in-memory tampering), the approval's bound hash still matches the plan, and the
corpus manifest on disk still matches what was true at approval time — any drift aborts with no
subprocess spawned. The spawn itself uses `child_process.spawn` with a fixed executable and argv
array (never `shell: true`, `exec()`, `eval()`, or a client-supplied path), a fixed, minimal
environment allowlist (`PATH`/`SystemRoot`/`TEMP`/`TMP` only — **no secrets or API keys are ever
passed to the child process**), a hard runtime ceiling (10 minutes), and OS-level exclusive locking
(`open(path, 'wx')`) so only one tokenizer job can run at a time repo-wide, closing a real
TOCTOU race the code's own comments document as a fixed defect. `train_wrm001_tokenizer.py` itself
imports only the `tokenizers` library (already installed, never auto-installed), trains from the
corpus text only, and writes `tokenizer.json` + a manifest — its own docstring states "never makes
a network request, never downloads a vocabulary or any external model artifact." Verification
(`tokenizerVerifier.ts`, 18 checks) re-hashes every artifact, re-checks the corpus hash against live
bytes, and delegates 8 checks to a brand-new Python process (itself the "fresh process reload"
proof) via `verify_wrm001_tokenizer.py`, which also makes no network call.

## 6. Dataset Boundaries

`sourcePolicy.ts`'s `evaluateSourceAdmission()` is a pure, deterministic, rights/access-only filter
(never a subject-matter filter — explicitly documented). A document is auto-admitted only for
public-domain content, documented Commander-owned content, or content with an explicit,
Commander-declared or otherwise clearly compatible training-use license. `NEVER_AUTO_TRAINING_
ACCESS_STATUSES` (`restricted`, `paywalled`, `authentication_required`, `robots_restricted`,
`unknown`, `unavailable`) can never auto-enter a dataset — `unknown` requires Commander review,
everything else is auto-rejected outright. Undocumented source/provenance is auto-rejected, not
merely flagged. Every fallthrough case defaults to `commander_review_required`, never a guessed
admit. `corpusBuilder.ts` re-verifies every admitted document's live file bytes against its
recorded content hash immediately before inclusion in a corpus — a document that changed or
disappeared since ingestion is excluded, not silently trusted.

## 7. Network Restrictions

**Zero network calls exist anywhere in the 23 `lib/sovereign-model-lab/*.ts` files or either Python
script.** Confirmed by direct reading of every file (no `fetch`, no `http`/`https` module import,
no URL construction toward an external host) and independently by the validation suite's
`phase2a_25_train_wrm001_tokenizer.py_no_network_imports` / `phase2a_25_verify_wrm001_tokenizer.py_
no_network_imports`. `tokenizerEnvironment.ts` itself honestly discloses a real limitation: "Node's
child_process has no OS-level network sandbox on Windows without additional tooling... Compliance
rests on the training script itself never importing a network client — verified statically by the
validation suite, not enforced by process isolation at runtime." This is accurately documented as a
static-verification guarantee, not a hard OS-level sandbox.

## 8. Weight-Download Restrictions

No code path downloads a third-party model, vocabulary, or weight file. `train_wrm001_tokenizer.py`
trains a tokenizer from scratch from the local corpus only; it never calls a model-hub API.
`tokenizerVerifier.ts` explicitly scans the training manifest text for model-hub markers
(`huggingface.co`, `hf.co`, `modelscope.cn`, `civitai.com`, `models--`, `http://`, `https://`) as
one of its 18 mandatory checks (`no_external_references`) — any such reference fails verification
outright. Confirmed independently by `phase2a_26_..._no_weight_downloads`.

## 9. Filesystem Behavior

All writes are confined to `.war-room/sovereign-model-lab/` under the server-configured repo root
(`resolveRepoRoot()`, never client-overridable) — hardware reports, sources, documents, dataset
manifests, corpus artifact bundles, tokenizer experiments/jobs/locks, training plans, checkpoints
(metadata only), evaluations, models, and programs, each in its own subdirectory, written via an
atomic temp-file-then-rename pattern so a reader never observes a half-written record.
`documentIngest.ts`'s `resolveContainedPath()` and `tokenizerVerifier.ts`'s
`isContainedUnderVault()` independently enforce path containment (rejecting `..` traversal and
absolute-path escapes) before any read or verification touches disk. No file outside
`.war-room/sovereign-model-lab/` is ever written by this subsystem.

## 10. Resource Limits

Tokenizer subprocess: 10-minute (`TOKENIZER_MAX_RUNTIME_MS`) hard timeout, enforced by
`setTimeout` + `child.kill()`; stdout/stderr buffers capped at 20,000 characters with a 2,000-char
tail retained; only one tokenizer job may run at a time repo-wide (OS-level exclusive lock).
Document ingestion: 25MB per-file cap (`MAX_INGEST_FILE_BYTES`), a fixed allowed-extension set
(`.txt`, `.md`, `.json`, `.jsonl`, `.csv`, `.html`; `.pdf` explicitly named as unsupported rather
than silently accepted). Repository text search/walk (used indirectly via shared read-only repo
utilities) is bounded the same way Native Builder's is. Training memory/VRAM estimates are
themselves resource-limit *outputs* (see section 3) — nothing in this phase enforces them against a
live process, since no model-training process exists to bound.

## 11. Authentication And Authorization

`middleware.ts`'s `updateSession()` gate covers every `/api/sovereign-model-lab/*` route (confirmed:
no `sovereign-model-lab` exemption exists in `lib/supabase/middleware.ts`'s public-path list, same
as Native Builder) — a session is required to reach any route in this subsystem at all.

## 12. Commander Approval Gates

**Real, structurally-enforced gates exist** for the two decisions that matter most: dataset approval
(`decideDatasetApproval`, required before a corpus can be built) and tokenizer-training approval
(`approveTokenizerTraining` → single-use, hash-bound, freshness-rechecked at spawn time — see
section 5). The freshness-recheck-at-spawn design is genuinely more rigorous than a simple boolean
flag.

**Prior finding, now resolved (section 12a):** an earlier pass of this audit reported that no route
in `app/api/sovereign-model-lab/` called this codebase's shared dangerous-action gate
(`assertAutoOrApproval`), and that `POST .../tokenizer-train` required nothing beyond an
authenticated session and correct program state — no explicit per-request confirmation. This has
been hardened; see section 12a.

## 12a. Tokenizer Execution Approval Gate (Commander Hardening Decision)

**Authentication and program-state eligibility are necessary but not sufficient authority to
launch the tokenizer subprocess, create output artifacts, begin a build job, or otherwise cause
consequential Model Lab filesystem mutation.** `assertTokenizerExecutionApproved()`
(`lib/sovereign-model-lab/tokenizerApproval.ts`) is a pure, side-effect-free gate that
`POST /api/sovereign-model-lab/programs/[id]/tokenizer-train` calls *before*
`startTokenizerTrainingForProgram` is ever invoked — a blocked result guarantees no output
directory is created, no artifact is written, no Python process is spawned, and no job state is
ever set to `running`, because the route never reaches the function that does any of that
(proven by `gate_03b_zero_subprocesses_launched_for_blocked_case` and
`gate_04_zero_files_written_for_blocked_case`, which confirm zero job records and no lock file
exist after a blocked attempt).

All of the following must hold, checked fresh on every single call, with no server-side memory of
a prior approval — **no standing approval exists**:

1. **A valid authenticated session.** `middleware.ts` already blocks any unauthenticated request
   from reaching this route at all (section 11); the gate still declares `hasSession` as its own
   explicit, independently unit-tested parameter (`gate_01_unauthenticated_rejected`).
2. **The program's current state permits execution** — must be exactly
   `awaiting_commander_tokenizer_approval`, the state reached only via a prior, separate
   `approveTokenizerTraining()` call (`gate_02b_wrong_program_state_rejected`).
3. **The safety lock permits execution** — if active, tokenizer execution is blocked outright, with
   **no override** for this action (`gate_11_safety_lock_blocks_execution`).
4. **An explicit, well-formed approval object** — the request body must carry a
   `tokenizerExecutionApproval` object shaped `{ kind: 'sovereign_model_lab_tokenizer_execution',
   granted: true, programId, planHash, action: 'start_tokenizer_training' }`. None of the following
   ever count as approval — each is explicitly tested and rejected: being signed in, opening the
   Model Lab page, creating a tokenizer program, admitting a corpus, reviewing a preview, an
   approval for a different tokenizer job, a bare `{ approval_granted: true }` boolean with no
   `kind`/hash, or an approval for Native Builder or another subsystem
   (`gate_02_authenticated_unapproved_rejected`, `gate_05_malformed_approval_rejected`,
   `gate_06_wrong_approval_kind_rejected`).
5. **The approval kind is specific to Sovereign Model Lab tokenizer execution** —
   `'sovereign_model_lab_tokenizer_execution'` only; an approval minted for
   `'native_builder_live_research'` or any other kind is rejected (`gate_06`).
6. **The approval is deterministically bound to program ID, corpus/dataset version, tokenizer
   configuration, requested action, and output target.** `planHash` is the plan's own SHA-256 over
   its full immutable field set — corpus version, algorithm, vocab size, minimum frequency, seed,
   executable path, argv, output dir, expected artifacts, network policy, and runtime cap (see
   `immutablePlanFields` in `tokenizerApproval.ts`). Binding the gate to this one hash, alongside
   an explicit `programId` field, satisfies binding to every one of those dimensions without a
   second, duplicate hashing scheme. Proven with real, independently-computed plans (not fabricated
   constants) that differ in exactly one dimension each:
   `gate_08_approval_for_another_corpus_version_rejected` (only `corpusVersion` differs),
   `gate_09_approval_for_another_tokenizer_configuration_rejected` (only `requestedVocabSize`
   differs), `gate_10_approval_cannot_authorize_second_materially_different_job` (only `seed`
   differs), `gate_07_approval_for_another_program_rejected` (only `programId` differs).
7. **The approval cannot authorize a later or materially different job.** Nothing about this
   approval is stored server-side between requests — every field is re-supplied and re-checked on
   every call. An approval minted for one plan's hash simply will not equal a different plan's hash,
   by construction of SHA-256.

**Layering, not redundancy:** this route-level gate and `tokenizerApproval.ts`'s pre-existing
`assertFreshBeforeSpawn()` (still called, unchanged, immediately before the actual `spawn()` inside
`tokenizerRuntime.ts`) serve different purposes. This gate proves the *caller* explicitly
authorized this exact action, bound to this exact plan, in this exact request. The pre-spawn
freshness recheck proves nothing *drifted* between authorization and the moment of execution
(e.g. the corpus was rebuilt in between). Both must pass; neither substitutes for the other.

**Read-only operations remain session-authenticated only, unaffected by this gate** — confirmed by
`gate_14_read_only_operations_unaffected`: program status/detail reads, hardware/source/document
listing, dataset-candidate/corpus building, tokenizer-environment probing, tokenizer-plan creation,
dataset-preview, and deterministic validation all remain reachable with nothing beyond a session,
exactly as before this hardening pass. Only the one route that actually launches the subprocess
(`tokenizer-train`) requires the new explicit approval.

**Sandbox, timeout, and concurrency boundaries — unchanged, re-verified:** the 10-minute
(`maxRuntimeMs`) runtime cap, the OS-level exclusive single-job lock
(`acquireTokenizerJobLock`/`TokenizerJobAlreadyRunningError`), the fixed executable+argv (never
`shell: true`), and the minimal environment allowlist are all still enforced by
`tokenizerRuntime.ts`, which this hardening pass did not modify — confirmed by
`gate_15_single_concurrency_lock_mechanism_unchanged` and
`gate_15b_timeout_enforcement_mechanism_unchanged`, and independently by the full, unmodified,
still-passing `phase2a_defect2_*` suite (atomic single-job + approval-consumption gate, stale-lock
handling).

## 13. Rollback Behavior

No rollback mechanism exists for tokenizer training, and none is needed for what this phase can
do: a tokenizer job either completes (writing `tokenizer.json` + manifest to its own versioned
output directory) or fails/times out/is cancelled (writing nothing usable). Corpus artifacts are
immutable and versioned — a new build never overwrites a prior version
(`CorpusVersionExistsError` is thrown rather than silently replacing). `cancelTokenizerTraining()`
kills the in-flight process; there is no partial-state file to roll back because
`train_wrm001_tokenizer.py` writes its `tokenizer.json` output only once, at the end, after
training completes in memory.

## 14. Audit Logging

Every program-state transition and every corpus/tokenizer-training lifecycle event calls
`logWarRoomRepoAudit('sovereign-model-lab: ...', {...})` via `runtime.ts`'s `persist()` helper and
directly from `tokenizerRuntime.ts` (stale-lock recovery is logged explicitly) — reusing the same
pre-existing audit sink Native Builder uses, not a parallel logging path.

## 15. Production Exposure

Not deployed, not pushed, not merged into `main`. `/sovereign-model-lab` page and its API routes
exist in this branch's working tree only.

## 16. Prohibited Actions — Explicit Confirmation

- **Trains models:** No.
- **Downloads weights:** No.
- **Modifies datasets after admission:** No — corpus artifacts are immutable/versioned; a document's
  provenance history is append-only, never overwritten.
- **Invokes providers (LLM/API):** No — zero provider-call code anywhere in this subsystem.
- **Uses external network access:** No — confirmed zero network calls in every file (section 7).
- **Writes files outside its own sandboxed directory:** No — confined to
  `.war-room/sovereign-model-lab/` (section 9).
- **Launches background/scheduled processes:** No — the only subprocess this subsystem starts is the
  single, bounded, explicitly Commander-approved tokenizer-training job; nothing is scheduled,
  cron'd, or queued.

## 17. Owned-File Map

**`lib/sovereign-model-lab/`** (23 files): `types.ts` (domain types, state machine), `runtime.ts`
(sole orchestrator), `storage.ts` (leaf JSON persistence), `hardwareProbe.ts`, `sourcePolicy.ts`
(pure, no I/O), `documentIngest.ts` (local-only), `provenanceLedger.ts` (append-only leaf),
`publicSourceRegistry.ts` (registration only, no retrieval), `datasetBuilder.ts` (pure aggregation),
`corpusBuilder.ts` (real artifact writer), `tokenizerEnvironment.ts` (real probe),
`tokenizerApproval.ts` (hash-bound approval logic), `tokenizerRuntime.ts` (the one real subprocess
executor), `tokenizerVerifier.ts` (18-check verification), `trainingPlanner.ts` (planning only),
`trainingMemoryEstimator.ts` (pure math), `checkpointVault.ts` (metadata/hash-verify only, no real
checkpoints yet), `evaluationRegistry.ts` (static catalog, nothing run), `modelRegistry.ts`
(metadata only), `programProjection.ts` (pure read-model + explicit-Commander-action-only
migration), `sovereignModelLab.validation.ts`, `tokenizerPipeline.validation.ts`, plus
`__fixtures__/sample-commander-document.txt` (a non-production fixture file used by the validation
suite for document-ingest test cases).

**`scripts/sovereign-model-lab/`**: `train_wrm001_tokenizer.py`, `verify_wrm001_tokenizer.py` — the
two subprocess entry points, both real, both network-free, both reviewed in full (sections 5, 7,
8).

**`app/api/sovereign-model-lab/`** (~20 route files): `begin`, `status`, `sources`,
`dataset-candidates`, `hardware`, `tokenizer-environment` (top-level), `programs` (list),
`programs/[id]` (get), and per-program action routes: `cancel`, `corpus`, `dataset-approval`,
`dataset-candidate`, `ingest`, `recheck-truth`, `request-training-approval`,
`tokenizer-approval`, `tokenizer-cancel`, `tokenizer-environment`, `tokenizer-plan`,
`tokenizer-progress`, `tokenizer-train`, `tokenizer-verify`, `training-plan`, `verify-provenance`.

**UI**: `app/sovereign-model-lab/page.tsx`, `components/war-room/sovereign-model-lab/
SovereignModelLabPanel.tsx` — one page, reads the canonical `ProgramProjection` read model, exposes
Commander action buttons matching each state-machine transition.

**Validators**: `scripts/run-sovereign-model-lab-validation.mjs` (wraps
`sovereignModelLab.validation.ts`, 69/69), `scripts/run-sovereign-model-lab-tokenizer-validation.mjs`
(wraps `tokenizerPipeline.validation.ts`, 83/83, including the 21 new tokenizer-execution-gate
cases added in the Commander hardening pass — section 12a). Both are pure Node subprocess wrappers
(same `spawnSync(process.execPath, [...])` pattern as every other `run-*-validation.mjs` in this
repo) — neither wrapper itself makes a network call; confirmed the underlying suites don't either
(section 7).

## 18. Validation Requirements

Both existing suites pass and were independently re-run during this audit:
- `node scripts/run-sovereign-model-lab-validation.mjs` — **69/69 PASS**, including
  `leaf_01_storage_never_imports_runtime`, `leaf_02_provenance_ledger_never_imports_runtime`,
  `secrets_01_audit_log_calls_never_reference_env_or_secret_terms`, and a full state-machine legal-
  transition suite.
- `node scripts/run-sovereign-model-lab-tokenizer-validation.mjs` — **83/83 PASS** (62 prior +
  21 new), including `phase2a_25`/`phase2a_26` (no network imports, no weight downloads, for both
  Python scripts), `phase2a_27_no_model_training_function_exists`, the full itemized
  training-memory-estimate coverage, and the full `gate_*` tokenizer-execution-approval suite
  (section 12a) — every gate test uses `process.execPath` (Node) as its target executable, never
  the real Python tokenizer, confirmed directly by `gate_13_test_never_launches_real_python_
  tokenizer_process`.
- `npx tsc --noEmit`, ESLint on owned files, `npm run build`, `git diff --check` — see the commit
  report for this pass's results.

## 19. Known Limitations

- `tokenizerEnvironment.ts` itself discloses that network isolation for the tokenizer subprocess is
  a static-verification guarantee (the training script never imports a network client, proven by
  the validation suite), not an OS-level sandbox — Windows has no default job-object/firewall-rule
  enforcement wired up here.
- Tokenizer execution (`/tokenizer-train`) is now gated by a bespoke, Model-Lab-specific approval
  mechanism (section 12a) rather than this codebase's shared `assertAutoOrApproval` dangerous-action
  gate that Native Builder's file/rollback-mutating routes use. This was a deliberate choice: the
  shared gate's generic `approval_granted: true` boolean cannot express job-specific binding
  (program/corpus/configuration/output), which this hardening's own requirements call for. No other
  Sovereign Model Lab route (dataset approval, corpus build, environment probe, plan creation) uses
  either gate — they remain session-authenticated only, per section 12a's explicit scope.
- `directMlAvailable` in the hardware report is always `null` — no reliable no-install probe exists
  for it (honestly disclosed in the probe's own output, not silently omitted).
- Training memory/VRAM estimates are architecture-inferred rules of thumb (no real WRM-001
  architecture config exists yet) — every estimate discloses its `knownOmissions` explicitly rather
  than presenting a false-precision number.
- No React/JSDOM/Vitest test stack exists in this repository (pre-existing, repo-wide limitation);
  `SovereignModelLabPanel.tsx`'s UI behavior is confirmed by source inspection, not a rendered-
  component test.

## 20. Completion Criteria

This pass is complete when: (a) every owned file has been read and classified (done — sections 3,
17); (b) model-training, network, and weight-download claims are verified against actual code, not
assumed (done — sections 4, 7, 8, each independently confirmed against both direct source reading
and the existing validation suites); (c) this document exists and documents actual implemented
behavior only, correcting rather than inventing where needed (done — section 12's finding is
reported exactly as found, not smoothed over); (d) both existing validation suites pass
deterministically offline (done — 152/152 combined, including the 21-case tokenizer-execution
approval gate suite); (e) `tsc`, ESLint, `build`, and
`git diff --check` all pass (see commit report); (f) any capability stronger than documented is
explicitly reported (done — section 12). Committing this work to version control, pushing, merging,
and deploying are separate, later steps not authorized by this document.
