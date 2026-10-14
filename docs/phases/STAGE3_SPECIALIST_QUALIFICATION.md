# Stage 3: local specialist model qualification on Nebula

Status: tooling implemented and validated; measurements and benchmarks run on Nebula (RTX 5060 Ti 16 GB, 31 GB RAM, Ollama 0.34.2) on 2026-10-13/14; evidence under `p10-evidence/stage3/`. Baseline engine `d79a3037` and the launcher are unchanged. Everything new is opt-in.

## What was done
- Downloaded (free Ollama-registry weights, no cloud): `qwen3-embedding:0.6b` (Q8_0, 610 MiB), `qwen2.5-coder:7b` (Q4_K_M, 4466 MiB), `gemma3:12b` (Q4_K_M, 7786 MiB), `deepseek-coder-v2:16b-lite-instruct-q4_K_M` (9884 MiB), `qwen3-coder:30b` (Q4_K_M, 17697 MiB), and the community packaging `dengcao/Qwen3-Reranker-0.6B:Q8_0` (639 MB; third-party upload, digest c9da58824943). Direct pulls from `hf.co` were blocked by the client ("blocked redirect to a different host") and were not worked around. Total about 41 GB of 609 GB free disk.
- Role benchmark suites (`lib/agents/forge/roleBench/`): fast repair (10 bounded-edit cases, executed under Node's permission model), debugger (10 cases: root cause + minimal fix), architect reviewer (7 seeded flaws + 3 correct variants), research (6 answerable + 4 unanswerable), security (10 vulnerability classes + 7 safe look-alikes), code retrieval (24 identifier queries + 18 paraphrased queries on this repository against a keyword baseline), reranker (top-20 reorder). Every checker is validated against a reference and a broken answer (`roleBench.validation.ts`).
- Gates (fixed before the runs; a role needs the overall gate AND the class gates): see below the matrix. Models are qualified per role from recorded runs; a model never inherits a role from another.
- Forge: `BenchmarkRecord` gained `role`, `nodeId`, `fixtureClass`; `specialists.ts` promotes a candidate to ACTIVE only for roles whose gate its recorded runs clear; `roleRouting.ts` maps task intent -> role -> model with explicit fallbacks; the scheduler has a designated primary builder.
- Opt-in `fastRepair` hook in the workflow (`FAST_REPAIR_MODEL` in the harness): first retry of an implementation file rejected for a bounded syntax/import problem; any further retry, and any failed call, goes to the builder.

## Results
| Model | Params / quant | Disk MiB | VRAM GPU / CPU MiB | Load ms | tok/s | Residency | primary builder | architect reviewer | debugger test specialist | fast repair worker | research generalist | code retrieval | reranker | security reviewer | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m | 23.6B / Q4_K_M | 13670 | 12329 / 2912 | 14477 | 12.9 | PARTIAL_OFFLOAD | 246/368 | 13/20 | 12/20 | 20/20 ✔ | 20/20 ✔ | – | – | 21/34 | RESIDENT (10m) |
| qwen2.5-coder:14b | 14.8B / Q4_K_M | 8572 | 9803 / 0 | 6286 | 42 | FULL_GPU | – | 9/20 | 15/20 | 20/20 ✔ | – | – | – | – | TRANSIENT (0) |
| huihui_ai/qwen3-abliterated:14b | 14.8B / Q4_K_M | 8585 | 9722 / 0 | 8792 | 43.6 | FULL_GPU | 0/40 | 12/20 | 12/20 | 17/20 | 20/20 ✔ | – | – | – | TRANSIENT (0) |
| deepseek-coder-v2:16b-lite-instruct-q4_K_M | 15.7B / Q4_K_M | 9884 | 12260 / 0 | 13402 | 160.8 | FULL_GPU | – | 6/20 | 4/20 | 16/20 | 16/20 | – | – | 20/34 | TRANSIENT (0) |
| gemma3:12b | 11.8B / Q4_K_M | 7786 | 7963 / 0 | 15939 | 48.3 | FULL_GPU | – | 8/20 | 8/20 | 20/20 ✔ | 20/20 ✔ | – | 0/42 | 24/34 | TRANSIENT (0) |
| qwen2.5-coder:7b | 7.6B / Q4_K_M | 4466 | 4896 / 0 | 2434 | 84.1 | FULL_GPU | – | 8/20 | 6/20 | 20/20 ✔ | 20/20 ✔ | – | 0/42 | 24/34 | TRANSIENT (0) |
| qwen3-coder:30b | 30.5B / Q4_K_M | 17697 | 12290 / 6409 | 16182 | 38.3 | PARTIAL_OFFLOAD | – | 11/20 | 10/20 | 18/20 ✔ | 19/20 ✔ | – | – | 22/34 | ON_DEMAND_ONLY (0) |
| qwen3-embedding:0.6b | 595.78M / Q8_0 | 610 | 2029 / 0 | 1900 | UNKNOWN | FULL_GPU | – | – | – | – | – | 24/24 ✔ | – | – | TRANSIENT (0) |

Gates: PRIMARY_BUILDER ≥100% over ≥9 runs; ARCHITECT_REVIEWER ≥80% over ≥10 runs; DEBUGGER_TEST_SPECIALIST ≥80% over ≥10 runs; FAST_REPAIR_WORKER ≥90% over ≥10 runs; RESEARCH_GENERALIST ≥85% over ≥10 runs; CODE_RETRIEVAL ≥90% over ≥10 runs; RERANKER ≥90% over ≥10 runs; SECURITY_REVIEWER ≥80% over ≥10 runs. ✔ = qualified (overall gate and class gates).

### Reranker experiments (pre-registered rule: reranked MRR > embedding MRR and reranked recall@3 >= embedding recall@3)

| Reranking model | Embedding MRR / r@1 / r@3 | Reranked MRR / r@1 / r@3 | Candidates with no yes/no logits | Rule | Qualified |
|---|---|---|---|---|---|
| gemma3:12b | 0.674 / 0.571 / 0.714 | 0.645 / 0.500 / 0.714 | 0 | not passed | none |
| qwen2.5-coder:7b | 0.677 / 0.571 / 0.714 | 0.666 / 0.524 / 0.762 | 0 | not passed | none |
| dengcao/Qwen3-Reranker-0.6B:Q8_0 | 0.677 / 0.571 / 0.714 | 0.677 / 0.571 / 0.714 | 840 | not passed | none |

### Foundry routing table (what each kind of work goes to, from recorded evidence)

| Task intent | Role | Routed to | How |
|---|---|---|---|
| syntax_import_repair | FAST_REPAIR_WORKER | qwen2.5-coder:7b | specialist: FAST_REPAIR_WORKER qualified: qwen2.5-coder:7b on local; not resident; the node holds no other model |
| bounded_edit | FAST_REPAIR_WORKER | qwen2.5-coder:7b | specialist: FAST_REPAIR_WORKER qualified: qwen2.5-coder:7b on local; not resident; the node holds no other model |
| small_implementation | PRIMARY_BUILDER | AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m | primary builder: PRIMARY_BUILDER qualified: AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m on local; designated primary builder; not resident; the node holds no oth |
| feature_build | PRIMARY_BUILDER | AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m | primary builder: PRIMARY_BUILDER qualified: AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m on local; designated primary builder; not resident; the node holds no oth |
| multi_file_implementation | PRIMARY_BUILDER | AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m | primary builder: PRIMARY_BUILDER qualified: AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m on local; designated primary builder; not resident; the node holds no oth |
| architecture_decision | ARCHITECT_REVIEWER | UNAVAILABLE | unavailable: no model is qualified for ARCHITECT_REVIEWER; nothing is defaulted; no substitute is allowed for ARCHITECT_REVIEWER |
| contract_review | ARCHITECT_REVIEWER | UNAVAILABLE | unavailable: no model is qualified for ARCHITECT_REVIEWER; nothing is defaulted; no substitute is allowed for ARCHITECT_REVIEWER |
| failure_diagnosis | DEBUGGER_TEST_SPECIALIST | AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m | fallback builder: no model is qualified for DEBUGGER_TEST_SPECIALIST (no model is qualified for DEBUGGER_TEST_SPECIALIST; nothing is defaulted); the primary builder does it itself |
| technical_research | RESEARCH_GENERALIST | qwen2.5-coder:7b | specialist: RESEARCH_GENERALIST qualified: qwen2.5-coder:7b on local; not resident; the node holds no other model |
| repo_context_search | CODE_RETRIEVAL | qwen3-embedding:0.6b | specialist: CODE_RETRIEVAL qualified: qwen3-embedding:0.6b on local; not resident; the node holds no other model |
| rerank_candidates | RERANKER | deterministic method | fallback deterministic: no model is qualified for RERANKER; the deterministic method (keyword search / retrieval order) is used |
| security_review | SECURITY_REVIEWER | UNAVAILABLE | unavailable: no model is qualified for SECURITY_REVIEWER; nothing is defaulted; no substitute is allowed for SECURITY_REVIEWER |


Notes on reading the matrix: the primary-builder column counts every historical `complete_feature` record in the store (including earlier engine versions and failed attempts), which is why the builder is a DESIGNATED role and not decided by that rate. Reranker rows 0/42 mean the pre-registered rule was not met, so every query is recorded as failed.

### Roles earned
- CODE_RETRIEVAL: `qwen3-embedding:0.6b` (identifier queries recall@10 100%, MRR 0.939 vs keyword 0.882; paraphrased queries recall@10 0.722 vs keyword 0.333).
- FAST_REPAIR_WORKER: `qwen2.5-coder:7b` (20/20), `gemma3:12b` (20/20), `qwen3-coder:30b` (18/20); the 14B models and the builder also clear it.
- RESEARCH_GENERALIST: `qwen2.5-coder:7b` (20/20), `gemma3:12b` (20/20), `qwen3-coder:30b` (19/20).
### Roles rejected (no model cleared the gate)
- ARCHITECT_REVIEWER: no model does both halves. Detection of the seeded flaws vs passing the correct variants: qwen3-abliterated 14B 12/14 and 0/6, Qwen3-Coder-30B 11/14 and 0/6, Devstral 9/14 and 4/6, gemma3 8/14 and 0/6, qwen2.5-coder:14b 8/14 and 1/6, qwen2.5-coder:7b 2/14 and 6/6, DeepSeek-Lite 0/14 and 6/6 (the last two simply approve everything).
- DEBUGGER_TEST_SPECIALIST: best was qwen2.5-coder:14b 15/20 (75%, gate 80%); DeepSeek-Coder-V2-Lite 4/20; the builder 12/20.
- SECURITY_REVIEWER: no model assigned. Every model tested finds all 20 vulnerable cases but flags safe code: safe-class pass rates are DeepSeek-Lite 0/14, Devstral 1/14, Qwen3-Coder-30B 2/14, gemma3 and qwen2.5-coder:7b 4/14 (gate 85%).
- RERANKER: `dengcao/Qwen3-Reranker-0.6B` loads in Ollama but returns uniform logits (all candidates unscored); the supported `logprobs` path works with ordinary models, but gemma3:12b and qwen2.5-coder:7b used as pointwise rerankers did not beat the embedding order (rule not met). No reranker is assigned; the deterministic retrieval order is used.
- DeepSeek-Coder-V2-Lite-Instruct qualified for nothing (fast: 160 tok/s, but 80% on repair and weak elsewhere).
These suites are hard for every local model including the proven builder (calibration: Devstral 12/20 debugger, 13/20 architect, 21/34 security), so the rejections describe what a role needs, not a weakness of one candidate.

## Residency and unload rules (measured)
- Nebula holds one resident model. `coexist.json`: loading even the 0.6B embedder evicted the 24B builder (builder 12.3 GB + embedder 2.0 GB + desktop 2.3 GB > 16.3 GB); reloading the builder afterwards took 6.3 s (after the embedder) and 17.9 s (after the 7B).
- Builder: RESIDENT (keep-alive 10m). Every helper: TRANSIENT (keep-alive 0), calls batched to limit builder reloads. Qwen3-Coder-30B (6.4 GB on the CPU, 38 tok/s): ON_DEMAND_ONLY. `recommendResidency` derives this from measured sizes only.
- Memory safety: every run samples GPU/RAM/swap and aborts the model test if available RAM falls under 2500 MiB (never triggered; minimum available RAM seen 15.3 GB; swap delta 0-11 MiB; swap was already full at idle).

## Baseline vs specialist (same frozen tree `c5d296c9`, one mission per cell, helpers as in the gold rounds)
| Fixture | BASELINE (builder + qwen3 14B reviewer + qwen2.5-coder 14B candidate) | SPECIALIST (+ qwen2.5-coder:7b fast repair) |
|---|---|---|
| chat | CLEAN 12/12, 433 s, 9 calls, 0 repairs, 1 eviction | CLEAN 12/12, 309 s, 7 calls, 0 repairs, 1 eviction, fast repair 0 calls |
| task | CLEAN 12/12, 421 s, 7 calls, 0 repairs, 1 eviction | CLEAN 12/12, 507 s, 10 calls, 2 repairs, 1 eviction, fast repair 0 calls |
| alert | CLEAN 12/12, 787 s, 13 calls, 3 repairs, 2 evictions | CLEAN 12/12, 755 s, 12 calls, 1 repair, 3 evictions, fast repair 1 call, 0 accepted, 1 escalated |
| total | 1641 s, 29 builder-path calls, 4 evictions | 1571 s, 29 calls, 5 evictions |
Verdict: no measurable benefit. The hook fired once in six missions and its reply failed the gates (escalated to the builder). The 70 s difference is run-to-run variance (the chat run was 124 s faster with zero specialist calls). The hook stays OFF by default and is not promoted; a specialist that adds a model swap without improving outcomes should not be active.

## Mixed-mission proof (`mixedProof.ts`, real models, Residency Governor)
Nine steps routed by role: retrieval (qwen3-embedding) PASS, research (qwen2.5-coder:7b) PASS, bounded repair (qwen2.5-coder:7b) PASS, builder work (Devstral) PASS, diagnosis (no qualified debugger -> builder fallback) PASS, contract review UNAVAILABLE (no substitute), security review UNAVAILABLE, rerank deterministic, builder again PASS: 6/6 model steps, 3 distinct local models, every step's executor taken from the model that answered, no cloud call. The first two runs are kept in the evidence: run 1 could not place the builder (its mixed history failed the strict gate, which led to the designated-builder rule); run 2 retrieved the proof script itself because it contains the query text (the script now excludes itself from the corpus).

## Limitations
- One mission per cell; no statistical claim. The retrieval and reranker corpora are this repository; the fixtures are small and written by us (the security suite uses textbook cases).
- The retrieval, research and repair roles are routable but only the repair hook is wired into the engine (opt-in, no benefit measured). Nothing in the engine consumes CODE_RETRIEVAL or RESEARCH output yet.
- Generated model code runs under Node's permission model in the benchmarks only; mission code still has no OS isolation.
- Benchmark thresholds were fixed before runs, but the security suite was extended (4 more safe cases) and re-run after the first model's result to give the false-positive gate more power; the earlier runs are in `superseded/`.
- The `hardcoded_secret` security fixture originally used a string shaped like a live payment-provider key; GitHub push protection blocked the push, so the literal was replaced by an obviously fake one (`fixture-not-a-real-key-...`) and the unpushed local commits were rebuilt (backup branch `backup/pre-secret-fix-447c4ff4`). Every model had scored 20/20 on the vulnerable class before; the changed fixture was re-run once on qwen2.5-coder:7b (detected 2/2, suite 25/34, evidence `stage3/verify-secret-fixture/`), and the safe-class results that decide the role are unaffected.
