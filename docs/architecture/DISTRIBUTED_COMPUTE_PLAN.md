# Foundry distributed compute architecture: plan (stage 0, pre-implementation)

Status: PLAN; stage 1 (schemas, pure logic, simulated nodes, validators) is implemented and opt-in, see `lib/agents/forge/compute.validation.ts` (101 checks). Stage 2 (local node probe, measured profiles of the installed models, `section=compute` view, shadow scheduling in the harness) is implemented and opt-in, see section 17. Stages 3-6 are not. Per-GPU concurrency needed no governor change: the node record's `concurrency` is the GPU count (1 on Nebula) and the governor already serializes per node. No model has been downloaded, the canonical launcher is unchanged.
Baseline that must stay intact: Foundry engine `d79a3037` (tree `9eb34b32d578`), gold round 10 + confirmation 18/18 CLEAN_LOCAL_ONLY. See `docs/phases/PHASE_10_FINAL_RECEIPT.md`.
Builds on: `docs/phases/LOCAL_SPECIALIST_POOL.md` (pool, governor, rack seam).

## 0. Law and constraints
- Sovereign Build Law: Foundry owns mission, planning, integration, validation and acceptance. Models and rack nodes are workers. Frontier models stay bounded helpers, never owners. Nodes never decide acceptance.
- No hosted/frontier or Cursor provider is reachable through the node layer. A node endpoint must be loopback or a private-network address.
- UNKNOWN is never zero and never "fits". Reliability gates are not lowered. No simulated provider counts as evidence (a simulated node in tests proves protocol logic only and is labelled so).
- Everything new is opt-in (`FOUNDRY_COMPUTE=1`), off by default. With it off, the engine path is byte-for-byte the Phase 10 path.

## 1. Measured hardware (Nebula, 2026-10-13)
| Item | Value |
|---|---|
| GPU | NVIDIA RTX 5060 Ti, 16311 MiB VRAM, driver 595.91.07, 180 W limit |
| CPU / RAM | Ryzen 7 7700X 8c/16t, 30945 MB RAM (~19.7 GB available), swap 8 GB (nearly full) |
| Disk | NVMe 937 GB, 609 GB free, 44 GB of Ollama models |
| Network | Ethernet reports 100 Mb/s (a 14 GB model moves in ~19 min); tailscale0 present |
| Runtime | Ollama 0.34.2; Devstral Small 2 24B q4_K_M (14 GB), devstral-abliterated 24B, qwen3-abliterated 14B (9 GB), qwen2.5-coder 14B (9 GB) |
Swap pressure means RAM headroom, not VRAM, is the first thing a second model hits. The scheduler must treat available RAM as a measured input.

## 2. Architecture
```
                         Foundry (mission, plan, integrate, validate, ACCEPT)         <- owner, never delegated
                                         |
                              ComputeScheduler  (pure, deterministic, logged)
              role -> candidate models (per-role ranking, Forge evidence)
              candidate -> node (fit, residency, load, measured speed, health)
                                         |
                 +-----------------------+------------------------+
                 |                                                |
        NodeClient(LOCAL)                                NodeClient(RACK)   [stage 4+]
        loopback Ollama via governor                     mTLS/signed HTTP to a Worker Agent
                 |                                                |
        ResidencyGovernor (per node)                     Worker Agent on rack machine
        admit / evict / serialize                        (identity, hardware probe, runtime, model cache,
                 |                                         governor, signed results)
        Ollama (Nebula GPU)                              Ollama / llama.cpp (rack GPU)
                                         |
              Forge store (append-only): model, resource profile, node, heartbeat, benchmark, placement decision, provenance
```
Data that crosses a node boundary: a job (role, prompt, model ref, limits) out; a streamed result plus signed receipt back. A node never gets repo write access, secrets, or acceptance authority. Foundry applies edits itself.

## 3. Roles and specialist set
Roles (new `ModelRole`, generalising `SpecialistRole`; legacy pool roles map onto them so the Phase 10 path is unchanged):
PRIMARY_BUILDER, ARCHITECT_REVIEWER, DEBUGGER_TEST_SPECIALIST, FAST_REPAIR_WORKER, RESEARCH_GENERALIST, CODE_RETRIEVAL, RERANKER, SECURITY_REVIEWER.
Mapping: BUILDER -> PRIMARY_BUILDER, TEST_REVIEWER -> ARCHITECT_REVIEWER (or SECURITY_REVIEWER by task), TEST_WRITER -> DEBUGGER_TEST_SPECIALIST, TEST_CANDIDATE -> FAST_REPAIR_WORKER candidate, ESCALATION unchanged (never implicit).
A role is a job class with its own pass criteria, not a model property. A model holds roles only through evidence.

## 4. Candidate evaluation (metadata only; sizes from Ollama library pages, nothing downloaded)
| Role | Candidate | Quant / size | Ctx | Fit on Nebula (16 GB VRAM, ~20 GB free RAM) | Notes / risk |
|---|---|---|---|---|---|
| PRIMARY_BUILDER | Devstral Small 2 24B (installed, proven) | q4_K_M, 14 GB | 8192 used | PARTIAL_OFFLOAD (measured stage 2: 12.3 GB VRAM + 2.9 GB RAM, ~13 tok/s; an earlier draft of this table said FULL_GPU, which was wrong) | Baseline. 18/18 on d79a3037. Must not be displaced. |
| PRIMARY_BUILDER / ARCHITECT | Qwen3-Coder-30B-A3B (`qwen3-coder:30b`) | q4_K_M, 19 GB | 256K | Does not fit VRAM alone; MoE 3B active so PARTIAL_OFFLOAD may still be usable, speed UNMEASURED | Ollama page does not say "Instruct"; verify the tag is the instruct build after pull. 19 GB + KV cache competes for RAM with swap nearly full. |
| DEBUGGER / ARCHITECT alt | DeepSeek-Coder-V2-Lite-Instruct 16B (`deepseek-coder-v2:16b-lite-instruct-q4_K_M`) | 10 GB | 4K on this tag | FULL_GPU alone | 4K context limits it to small prompts; MoE (≈2.4B active) so fast. Older generation: expect weaker on structured edits. |
| FAST_REPAIR_WORKER | Qwen2.5-Coder 7B (`qwen2.5-coder:7b`) | q4_K_M, 4.7 GB (q8_0 8.1 GB) | 32K | FULL_GPU, can co-reside with nothing else comfortably next to the 14 GB builder | Cheap pre-repair of trivial structural errors only. |
| RESEARCH_GENERALIST | `gemma3:12b` | 8.2 GB (q4_K_M; QAT 8.9 GB) | 128K | FULL_GPU alone | Alternatives to benchmark: qwen3:14b (installed as abliterated variant only), phi4:14b. Pick by evidence. |
| CODE_RETRIEVAL | Qwen3-Embedding-0.6B | Q8_0, 639 MB | 32K | Trivial (CPU or GPU) | Runs overlapped with generation. Embedding endpoint is supported by Ollama. |
| RERANKER | Qwen3-Reranker-0.6B | ~0.6 GB | - | Trivial | Ollama exposes no rerank API; GGUF reranker scoring is unreliable on mainline llama.cpp per HF cards (needs a fix branch). Stage 3 verifies; fallback is a prompt-scored relevance call to a small model or a cross-encoder run in a sidecar. Marked UNVERIFIED until a score-ordering test passes. |
| SECURITY_REVIEWER | none chosen | - | - | - | No candidate is claimed. Evaluate Qwen3-Coder-30B and the best ARCHITECT model with a fixed vulnerability fixture set; the role stays unassigned until one passes. |

## 5. MODEL_RESOURCE_PROFILE
Extends `ResourceProfile` (kept; this is a superset, stored as a new append-only record type `model_resource_profile`, old records still read).
```ts
type ModelResourceProfile = {
  modelRef: string            // exact tag
  digest?: string             // pinned artifact identity
  quantization: string | 'UNKNOWN'
  vramRequiredMiB: number | 'UNKNOWN'   // per context size
  ramRequiredMiB: number | 'UNKNOWN'
  diskRequiredBytes: number | 'UNKNOWN'
  loadMs: number | 'UNKNOWN'
  activeMemoryMiB: number | 'UNKNOWN'   // measured resident, runtime-accounted
  contextTokens: number
  taskRoles: ModelRole[]                // roles it is QUALIFIED for (evidence-gated)
  successRate: { byRole: Record<ModelRole, { ok: number; n: number }> }  // from BenchmarkRecord, never invented
  latency: { firstTokenMs: number|'UNKNOWN'; tokensPerSecond: number|'UNKNOWN' }  // per node
  nodeId: string                        // where this profile was measured
  residency: 'RESIDENT' | 'TRANSIENT' | 'COLD' | 'UNKNOWN'   // current state on that node
  residencyClass: Residency             // FULL_GPU / PARTIAL_OFFLOAD / ...
  basis: 'MEASURED' | 'ESTIMATED' | 'UNKNOWN'
  at: string
}
```
Profiles are per (model, node, context): the same model measures differently on each GPU. `successRate` is derived from BenchmarkRecords by role; a new `BenchmarkRecord.role` field is added (optional, absent = legacy `taskClass`).

## 6. Node registration and protocol
```ts
type NodeRecord = {
  nodeId: string; hostname: string; kind: 'LOCAL'|'RACK'
  cpu: { model: string; cores: number; threads: number }
  ramMiB: number; gpu: { model: string; vramMiB: number }[]
  storage: { totalBytes: number; freeBytes: number }
  networkMbps: number | 'UNKNOWN'
  load: { cpuPct: number; gpuPct: number; vramUsedMiB: number; ramUsedMiB: number; queued: number; at: string }
  installedModels: { ref: string; digest: string; sizeBytes: number }[]
  availableModels: string[]            // approved and fetchable, not yet installed
  health: 'HEALTHY'|'DEGRADED'|'UNREACHABLE'|'QUARANTINED'
  lastHeartbeat: string
  capabilities: { concurrency: number; runtimes: string[]; roles: ModelRole[] }
  identity: { pubkeyFingerprint: string; enrolledAt: string; approvalNote: string } | null   // null for LOCAL
}
```
Protocol (HTTP+JSON over TLS, streaming via NDJSON; every message signed, see 7):
- `POST /v1/enroll` (once, Commander-approved token) -> returns node pubkey, hardware probe.
- `GET /v1/probe` -> hardware + installed models (Foundry compares with claimed record; mismatch -> QUARANTINED).
- `POST /v1/heartbeat` (node -> Foundry every 10 s, or Foundry polls) -> load, residency, health. Missing 3 beats -> UNREACHABLE.
- `POST /v1/prepare` -> ensure approved model by digest is present (pull from an allow-listed source, verify digest). Never runs arbitrary commands.
- `POST /v1/jobs` -> `{jobId, role, modelRef, digest, messages, limits{maxTokens,timeoutMs}, nonce, issuedAt}`; response NDJSON stream of `{jobId, seq, delta}` then a final signed `receipt {jobId, nodeId, modelRef, digest, tokens, elapsedMs, sha256(output), runtimeVersion}`.
- `POST /v1/jobs/{id}/cancel`, `POST /v1/unload`.
The worker agent is a small program with a fixed verb set, no shell, no file API. LOCAL uses the same interface in-process (an adapter around the existing governor + loopback client), so one code path serves both.

## 7. Rack-node trust and auth
1. Enrollment is a Commander act: a one-time enrollment token minted in Foundry, shown to the Commander, entered on the rack machine by the Commander. Foundry never reaches out to an unknown host.
2. Endpoint rules stay: loopback or RFC1918/`.lan`/`.local`/tailnet CGNAT range, no credentials in URL, no public hosts.
3. Identity: node generates an Ed25519 keypair at enrollment; Foundry pins the public-key fingerprint. Transport is TLS with the pinned key (or mTLS); a changed key is QUARANTINED until the Commander re-approves.
4. Every job and receipt is signed; nonce + issuedAt (±60 s) prevent replay. Output hash in the receipt is checked against what Foundry received.
5. Hardware claims are verified, not trusted: `probe` result must agree with the record; model digests must match the pin.
6. Least privilege: nodes receive only the prompt for the job (Foundry already strips secrets). No repo, no env, no credentials.
7. Provenance: every accepted model output is stored with nodeId, key fingerprint, model digest, runtime version, receipt hash. A mission report states which node produced each artifact.
8. Revocation: Commander disables a node; scheduler drops it immediately; its in-flight jobs fail over.
Residual risk (stated, not hidden): a compromised-but-enrolled node can return malicious text. Containment is the same as for any model: Foundry applies it only through its edit pipeline, preflight, tests and verifier; the node cannot touch the workspace.

## 8. Scheduling
Inputs: job role, task class, candidate list for the role (Forge per-role ranking), node records, resource profiles, governor state.
Pure function `schedule(job, world) -> Placement | Refusal` with a logged decision `{role, chosen, rejected[{node,model,reason}], basis}`:
1. Candidates = models qualified for the role by evidence (ACTIVE, `eligible`, success rate on that role above the gate). UNQUALIFIED models are used only in explicit benchmark runs.
2. Per candidate, per node: drop UNREACHABLE/QUARANTINED/DEGRADED-over-threshold nodes; drop if model digest not installed and not prepare-able; drop if `vramRequired+ramRequired` exceeds free capacity after planned evictions (planAdmission, per node); UNKNOWN requirement -> not "fits", prefer a measured alternative.
3. Score = measured role success rate (primary, hard floor), then residency (already RESIDENT on node: large bonus, avoids reload and model movement), then predicted wait (queue length x measured latency), then tokens/s, then transfer cost (bytes to move / networkMbps; a 14 GB move over 100 Mb/s is ~19 min so it is almost never chosen mid-mission). Ties broken by node id for determinism.
4. Nebula (single node) policy, current behaviour preserved:
   - Heavy GPU models run sequentially (governor concurrency 1 per GPU).
   - Deterministic and CPU work (preflight, static gates, test runner, embedding on CPU) overlaps freely.
   - No VRAM overcommit: admission refuses or evicts first. Helpers unload on answer (`keep_alive 0`); the PRIMARY_BUILDER stays resident (10m) while the mission is building and is only evicted when a larger-priority job cannot otherwise run.
   - Small helpers (embedding 0.6 GB, reranker) may co-reside only when measured free VRAM after the builder permits it; otherwise CPU.
5. Rack policy (stage 5):
   - Heavy workers run simultaneously only on different GPUs/nodes (concurrency is per GPU, not per fleet).
   - Prefer the node already holding the model; do not move a model for one job; prefetch (`prepare`) during idle time only.
   - Failover: a job with no receipt by timeout, or a node going UNREACHABLE, is re-scheduled once to the next best node (same job id, new attempt, both attempts logged). Output of a failed attempt is discarded. If no node remains, Foundry falls back to LOCAL; if LOCAL cannot, the mission records a blocked step, it does not lower the standard.
   - Surviving one-node failure is a test, not a claim: simulated-node test kills a node mid-stream.
6. Foundry-owned determinism: given the same world snapshot the same placement results; snapshots are stored with the decision.

## 9. Forge ranks by role
`routeFor(taskClass)` stays (Phase 10 path). Add `rankForRole(role, models, benchmarks, nodeId?)` -> ordered list with evidence counts. A model's rank in one role never lends credit to another. No global leaderboard. A model with no benchmark for a role is `NO_EVIDENCE` for it and is never defaulted into it. Benchmarks get a `role` field and a `nodeId` field (optional).

## 10. Benchmark matrix (no model ranked without it)
Per role, a fixed fixture set, run on the Foundry engine with CONTRACT_TESTS/FIRST_POOL as applicable, recorded as BenchmarkRecords. Metrics: pass rate on N>=9 runs, first-pass validity, repairs, tokens/s, first-token ms, peak VRAM/RAM, load ms, failure class.
| Role | Fixtures | Gate to qualify |
|---|---|---|
| PRIMARY_BUILDER | chat, task, alert missions (existing) | >= Devstral baseline: 9/9 CLEAN_LOCAL_ONLY x2 to *replace*; 9/9 once to become a *secondary* builder |
| ARCHITECT_REVIEWER | review fixtures: seeded-flaw test files and diffs, scored on flaw detection and false-reject rate | detect >= 80% of seeded flaws, false-reject <= 10% (thresholds proposed, fixed before the run) |
| DEBUGGER_TEST_SPECIALIST | failing test + stack -> minimal fix; contract-test authoring | fix passes verifier, no regression, >= 80% of 10 cases |
| FAST_REPAIR_WORKER | structural repair set (unbalanced braces, missing import, wrong export) from real engine failures | >= 90% fixed in one call, median < 20 s |
| RESEARCH_GENERALIST | summarize/compare tasks with checkable facts | factual-check pass >= 85% |
| CODE_RETRIEVAL | repo query set with known relevant files | recall@10 >= 0.9 vs. grep baseline |
| RERANKER | same set after recall | nDCG@5 beats embedding-only order |
| SECURITY_REVIEWER | seeded vuln set (injection, path traversal, authz) | detect >= 80%, false-positive <= 15% |
Thresholds are proposals; they are written into the fixture manifest before any model is run, and are not changed after seeing results.

## 11. First models to test (after the plan stage, when the Commander allows downloads)
Order by value and risk, with expected footprint:
1. Qwen3-Embedding-0.6B: 0.64 GB disk, <1 GB RAM/VRAM. Lowest risk, enables CODE_RETRIEVAL.
2. Qwen2.5-Coder 7B q4_K_M: 4.7 GB disk, ~5.5-6 GB VRAM at 8K ctx. Fast repair.
3. gemma3:12b q4_K_M: 8.2 GB disk, ~9-10 GB VRAM. Research (evaluated alone, never next to the builder).
4. Qwen3-Coder-30B-A3B q4_K_M: 19 GB disk, ~19-22 GB total at 8K ctx -> PARTIAL_OFFLOAD (about 16 GB VRAM + 4-6 GB RAM); swap is nearly full, free swap and RAM first. Highest value, highest risk.
5. DeepSeek-Coder-V2-Lite q4_K_M: 10 GB disk, ~11 GB VRAM. Comparison only.
6. Reranker: after the API question is resolved.
Disk total for 1-5: about 43 GB of the 609 GB free. RAM/VRAM are per model, not additive: only the builder plus tiny helpers are ever co-resident on Nebula. Sizes are from library pages and the usual KV-cache overhead; they are ESTIMATED until profiled.

## 12. Files and interfaces to change
New (all under `lib/agents/forge/` unless stated):
- `roles.ts` ModelRole, mapping from legacy SpecialistRole.
- `resourceProfile.ts` ModelResourceProfile + builders from runtime data (`/api/ps`, `/api/show`).
- `nodeRecord.ts` NodeRecord, probe, health state machine, heartbeat bookkeeping (extends `node.ts`; `NodeRegistry` keeps its refusals).
- `nodeProtocol.ts` message types, signing/verification (Ed25519 via node:crypto), replay window.
- `nodeClient.ts` NodeClient interface; `LocalNodeClient` (wraps governor + `ollamaModel`); `RackNodeClient` (stage 4, HTTP).
- `scheduler.ts` pure `schedule()` + decision log; `rank.ts` `rankForRole`.
- `workerAgent/` the rack-side program (stage 4), fixed verbs.
- `compute.validation.ts` wired into `validate:forge`; `simNode.ts` an in-process simulated node used only in tests (labelled SIMULATED in every record).
Changed:
- `types.ts` add optional `role`, `nodeId` to BenchmarkRecord; new record types in `ForgeRecord`.
- `store.ts` read/write new record types (append-only, backward compatible).
- `pool.ts` assign by `ModelRole` when `FOUNDRY_COMPUTE=1`; legacy `assignPool` untouched.
- `governor.ts` per-GPU concurrency, read-only extra snapshot fields; behaviour with one GPU identical.
- `poolRuntime.ts` route `governedClient` through the scheduler when enabled.
- `poolView.ts`, `poolViewModel.ts`, `app/api/foundry/agents/ops/route.ts` (`section=compute`), `FoundrySpecialistPool.tsx` (nodes/profiles/decisions panel).
- `docs/phases/LOCAL_SPECIALIST_POOL.md` cross-reference.
Not changed: engine files under `lib/agents/ops/engineering` (the workflow only sees a model client), the launcher, `d79a3037`.

## 13. Rollout stages (each ends with validators green and a commit with explicit staging)
1. Schemas and pure logic: roles, ModelResourceProfile, NodeRecord, protocol types/signing, scheduler, `rankForRole`, simulated nodes, validators. No runtime change. Opt-in flag unused by the engine.
2. Local integration: `LocalNodeClient`, profiling of the *already installed* models on Nebula (no downloads), `section=compute` view, scheduler decisions logged for a real mission with `FOUNDRY_COMPUTE=1`. Prove 9/9 on a chat mission parity with pool path (not a full gold round unless the Commander wants it).
3. Specialist qualification (needs download approval): fetch models in section 11 order, profile, run the benchmark matrix, record role qualification. Commander reviews before any role is assigned.
4. Rack worker: worker agent, enrollment, identity pinning, signed jobs; first against a second process on loopback with a different identity (labelled SIMULATED-REMOTE), then a real rack machine when one exists (Commander approval + physical enrollment).
5. Multi-node scheduling and failover proven with simulated nodes, then real.
6. Promotion: only with Commander approval and a full gold round + confirmation on the new default; until then d79a3037 remains the launcher target.

## 14. Rollback
- Flag: unset `FOUNDRY_COMPUTE` -> Phase 10 path (default). No data migration: new Forge record types are additive; old readers ignore unknown types (verified in stage 1 by a test that loads a store containing new records through the old reader).
- Git: each stage is its own commit; revert is `git revert <sha>` (no history rewrite). Tag `phase10-baseline-d79a3037` is placed before stage 1 (non-destructive, local+pushed).
- Runtime: installs are versioned directories; the launcher is not repointed; the baseline install is untouched.
- Nodes: disabling a node in Foundry is immediate; the worker agent can be stopped on the rack machine without Foundry-side cleanup; downloaded models are removable with `ollama rm` (list kept in the evidence directory).
- Evidence: all stage evidence goes to `p10-evidence/compute-*`, never overwritten.

## 15. Compatibility with the frozen Phase 10 baseline
- Engine code is not modified; the workflow talks to a model client interface that the scheduler wraps only when `FOUNDRY_COMPUTE=1`.
- With the flag off, `assignPool`/`governedClient` paths and `pool.validation.ts` (31 checks) are unchanged and must keep passing; a stage-1 test asserts legacy `assignPool` output is identical before/after.
- `routeFor` is unchanged; per-role ranking is additive.
- Any claim of improved reliability needs the same gold standard (9/9 CLEAN_LOCAL_ONLY, then confirmation) on a frozen SHA. Until then the baseline stays the only accepted default.

## 16. Validation of this plan against the codebase (read, not assumed)
- `node.ts`: `NodeDescriptor` and `placeOnNode` exist; `registerRack` returns `callable:false`; extending to `NodeRecord` is additive. `callable()` filters `kind === 'LOCAL'` and must become health- and identity-aware in stage 4.
- `governor.ts`: `lease()` is per-node with a `concurrency` counter, so per-GPU concurrency needs a GPU id dimension; the single-GPU case is unchanged.
- `pool.ts`: roles are a closed union; the mapping layer avoids touching it.
- `types.ts`: `BenchmarkRecord` lacks `role`/`nodeId`; both are optional additions.
- Open questions flagged, not assumed: Qwen3-Coder tag is instruct; Ollama rerank support; usable tokens/s of the 30B MoE under partial offload; real PCIe link speed under load; whether swap exhaustion forbids the 30B on Nebula without freeing memory.

## 17. Stage 2 results (2026-10-13, evidence `p10-evidence/compute-stage2/`)
Measured on Nebula with nothing else resident (desktop holds ~2.3 GB VRAM), 8K context, one 160-token generation each, loaded and unloaded in turn:
| Model | Quant | Residency | VRAM | RAM share | Load | Speed |
|---|---|---|---|---|---|---|
| Devstral Small 2 24B (builder) | Q4_K_M | PARTIAL_OFFLOAD | 12329 MiB | 2912 MiB | 17.3 s | 13.3 tok/s |
| devstral-abliterated 24B | Q4_K_M | PARTIAL_OFFLOAD | 11956 MiB | 3285 MiB | 14.0 s | 11.8 tok/s |
| qwen3-abliterated 14B | Q4_K_M | FULL_GPU | 9722 MiB | n/a | 11.3 s | 43.5 tok/s |
| qwen2.5-coder 14B | Q4_K_M | FULL_GPU | 9803 MiB | n/a | 6.9 s | 42.5 tok/s |
Consequences: the builder never fits wholly in VRAM here, so any larger model (Qwen3-Coder-30B, 19 GB) will offload more and its speed must be measured before it is considered; the 14B-class models are ~3x faster than the builder, which makes them the realistic fast helpers; any helper next to the builder forces an eviction on Nebula (12.3 + 9.7 GB > 16 GB), so the "builder stays resident" rule only pays off when helpers run on a second node.
Live mission with `FOUNDRY_COMPUTE=1 SPECIALIST_POOL=1 FIRST_PASS=1 CONTRACT_TESTS=1` (chat fixture): CLEAN, verifier 12/12, 465 s, 9 governed calls. The shadow scheduler had no evidence in the fresh evidence store at mission start, so it correctly reported PRIMARY_BUILDER not placeable; replayed against the store after the run (1 clean run) it places the same builder on `local` as provisional evidence only, and the strict view still says not qualified (9 runs required). The harness path was not altered by the flag.
Not done in stage 2: qualification of any role (needs the benchmark matrix and, for most roles, downloads), rack scheduling, real remote nodes.
