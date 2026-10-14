# Stage 4: local specialist integration on Nebula

Status: integrated, opt-in, measured on real missions (evidence `p10-evidence/stage4/`). Baseline engine `d79a3037`, the launcher and the default mission configuration are unchanged. Follows `STAGE3_SPECIALIST_QUALIFICATION.md`.

## Verdict in one paragraph
Hybrid code retrieval and the research brief are implemented, gated by Foundry, logged and validated, and they work as designed (retrieval surfaced every reusable helper in 9 of 9 missions and the builder reused them; the baseline reused none). On the whole-mission measures, however, neither specialist has *proven* an improvement: retrieval was faster and used fewer builder calls and repairs on average but not beyond run-to-run noise, and one of nine retrieval missions failed a verifier check; research added about 16 s plus a model swap and was not faster. By the pre-registered rule both stay INACTIVE (opt-in via `RETRIEVAL=1`, `RESEARCH_MODEL=...`). Devstral Small 2 24B remains the only default model for implementation.

## Architecture
- `lib/agents/ops/engineering/contextPhase.ts`: the engine's only interface (`ContextPhase.prepare`). Called once, after the plan exists and before the builder's first call. Returns per-step packages of `RetrievedItem` (method EXACT / DEFINITION / EMBEDDING, reason, score) and an optional `ResearchBrief`. Absent = unchanged behaviour. A failing phase is logged (`CONTEXT_PHASE_FAILED`) and the build continues.
- `lib/agents/forge/contextRetriever.ts` (`HybridContextPhase`): (1) exact pass first: routes, env vars, quoted and camelCase names from the contract, found by plain search, with definition matches ranked above mere mentions; at most a third of the slots; (2) one batched embedding call for every chunk (content-hash cache) and every query: per-step queries plus capability intents derived from the contract by fixed rules (storage, identifiers, validation, http, tests, repository conventions), each intent contributing its best file first; (3) merge, bounded to 5 items per step, files the import graph already supplies are excluded; (4) everything logged with the reason. The embedding model ranks text only; it decides nothing.
- Research (`researchBrief.ts`): Foundry decides whether research is needed (long local documentation, >= 3000 characters, that retrieval surfaced or that overlaps the contract); the research model writes a brief from the material only; Foundry strips model-written file citations (invented ones are counted), attaches the real sources, rejects briefs with unsupported claims, and gives the builder at most 1200 characters marked advisory. Short documents are handed over whole and never briefed (a brief of a short document only loses facts and costs two model swaps).
- Prompt rules: retrieved items sit inside RELATED CODE, each labelled "retrieved by ... search: <why>; advisory, the acceptance criteria win over anything here"; the brief sits above RELATED CODE and is never shortened (the prompt fitter shortens RELATED CODE first); both are capped.
- Mission phases and switch cost (`roleRouting.planPhases`, scheduler): helpers that must run before the builder (retrieval, then research) run once each, in order, and unload before the builder loads; the plan counts every model switch with its measured load time; the scheduler prices an option that evicts a resident with the measured reload (builder reload 6-18 s, default 15 s). Measured on Nebula: the retrieval phase costs 2.4-9.2 s (model load plus one batched call; 2.4-2.6 s once the corpus is cached), research about 16 s, and each helper makes the builder reload afterwards.
- Always-on record: every mission now reports `contextStats` (builder prompts, files provided, characters, retrieved files). Forge records a `SpecialistUse` per mission (role, model, why routed, inference time, context provided, builder calls saved, repair delta, mission time delta, success, verifier result). `abAnalysis.ts` judges a specialist with a pre-registered rule (>= 6 missions per side; success not worse; time >= 5% lower with Welch t <= -2, or >= 1 builder call saved with time not worse; repairs not higher).

## Models
- Active by default: Devstral Small 2 24B (PRIMARY_BUILDER) and, as in the gold configuration, `huihui_ai/qwen3-abliterated:14b` (test reviewer) and `qwen2.5-coder:14b` (competing test candidate).
- Integrated, opt-in, currently INACTIVE: `qwen3-embedding:0.6b` (retrieval), `gemma3:12b` (research; chosen over `qwen2.5-coder:7b`, see below), `qwen2.5-coder:7b` (fast repair hook, no benefit measured in Stage 3).
- Installed, unused: `qwen3-coder:30b` (qualified for repair/research only; slower, 6.4 GB on the CPU).
- Rejected: `deepseek-coder-v2:16b-lite` (qualified for no role), `dengcao/Qwen3-Reranker-0.6B` (uniform logits in Ollama; no reranker earns the role). Both can be removed with `ollama rm` (not done).

## Research model choice (`research/`, long documents, builder = Devstral)
| | qwen2.5-coder:7b | gemma3:12b | raw document (upper bound) |
|---|---|---|---|
| brief latency | 5.1 s | 8.2 s | n/a |
| fact coverage | 0.90 | 0.97 | n/a |
| invented file citations (stripped by Foundry) | 39 | 18 | n/a |
| briefs withheld by Foundry | 1/8 | 0/8 | n/a |
| builder success with brief (8 tasks; without any document 0/8) | 4/8 | 6/8 | 5/8 |
| builder reload penalty after the research phase | 11.7 s | 11.6 s | n/a |
Two earlier runs are kept: run 1 exposed gate defects (code literals and bracket labels counted as unsupported claims) and showed that briefs of short documents lose facts; run 2 showed that models invent file names in citations, so Foundry now owns provenance. gemma3:12b was chosen: it was not equivalent (6/8 vs 4/8, n small), so the smaller model was not preferred. In missions, research (with gemma) vs retrieval alone: see below.

## Mission results
Same frozen engine (`54ed115e`), cold start for every mission, Devstral builder, gold helper set, padded repository (35 extra files: 4 reusable helpers, a conventions document, 30 unrelated modules; the code plan is identical with and without the padding).

Retrieval vs baseline, 9 missions per side (3 fixtures x 3 repeats, alternating order):
| | BASELINE | RETRIEVAL |
|---|---|---|
| verifier success (CLEAN 12/12) | 9/9 | 8/9 |
| mean wall time | 702 s | 573 s (-18.4%, Welch t = -1.38) |
| mean builder calls | 11.56 | 9.11 (2.4 saved) |
| mean repairs | 1.44 | 0.78 |
| mean generated tokens | 42,024 | 36,579 |
| mean context given to the builder | 45.6k chars | 59.7k chars (+31%) |
| reusable helpers surfaced | n/a | 45/45 (all 5 in every mission) |
| distractor files surfaced | 0 | 9 across 9 missions |
| distinct helper modules imported by the app code | 0 | 1.67 per mission |
| model evictions per mission | 1.3 | 1.2 |
| peak GPU / RAM / swap | 15.3 GB / 20.9 GB / 8192 MiB (full at idle) | 14.8 GB / 19.9 GB / 8192 MiB |
Verdict: INACTIVE under the pre-registered rule (success 9/9 -> 8/9; time saving not beyond noise). The one failure (RETRIEVAL-chat-1: the page check for the sessions list, 11/12) is a UI/route mismatch of the kind seen in earlier rounds; it cannot be attributed to retrieval or excluded.

Research vs retrieval alone, 6 missions per side (long platform guide of 3.4 KB, research triggered by retrieval): success 5/6 vs 4/6 (task fixture 2/2 vs 0/2, both retrieval-only task missions failing the persistence test), but mean time 863 s vs 652 s (+32%, t = 0.98; one alert mission took 1568 s), builder calls 14 vs 11.2, repairs 3.3 vs 2.2, research phase 16.4 s. INACTIVE.

## Defects found by measuring (and fixed)
1. The workflow handed the retrieval layer `ws.snapshot()`, which maps paths to content HASHES; the first three mission series therefore gave the builder 64-character hex strings under the right file names. Those series are invalid and kept as `missions-runB-invalid-hash-context`, `missionsC-invalid-hash-context`. Fixed (file contents), with regression tests CP08/CP09 and a retriever guard that refuses hash-only text.
2. A padded repository whose conventions said "ids are strings" made the builder violate the task contract (numeric ids). Retrieved context is now labelled advisory ("the acceptance criteria win") and the helpers no longer dictate an id type. The first six missions are kept as `missions-runA-conflicting-conventions`.
3. The research trigger used word overlap and never fired on a 3 KB guide; retrieval now triggers it. The brief gate rejected useful briefs for code literals and bracket labels; Foundry now owns citations.
4. TDZ bug (`ctxStats` read before declaration on the early-return path) caught by the validator before any mission.

## Debugger: why qwen2.5-coder:14b reached 75% (gate 80%, unchanged)
Of its 5 misses in the 20 gate runs, all are "wrong fix" (no rewrites, no root-cause wording failures), concentrated in three fixtures: `wrong_status_codes` 0/2, `update_overwrites_id` 0/2, `id_reuse_after_delete` 1/2. Re-runs with full replies (exploratory, not role evidence): under the standard prompt the weak three score 1/9; a prompt that asks for every defect scores 0/9; a prompt that first lists each assertion and whether the code satisfies it scores 4/9 (`id_reuse` 3/3, `update_overwrites_id` 1/3, `wrong_status_codes` 0/3). `wrong_status_codes` carries two defects (201 and 404) but a failing assertion report names only the first: the model correctly diagnoses the 201 defect every time and never finds the second, so the fixture hides context (C) and the model lacks the habit of looking beyond the reported failure (A). The prompt variants (B) help one fixture and do not change the whole-suite score (15/20, 14/20, 15/20). Another installed model (D): `devstral-abliterated:24b` scores 13/20 under the standard prompt. The builder Devstral Small 2 scores 13/20, 14/20 and 16/20 (80%) under the three prompts: the strongest local debugger is the builder itself with the "list each assertion" prompt, which is already the fallback route. No role is filled, no gate was changed, nothing was downloaded.

## Limitations
- The engine runs through the CLI harness, not inside the packaged server; the installed runtime shows the compute view and routing only.
- One repository fixture family (chat, task, alert) with a synthetic padded codebase; effect on real, larger repositories is untested. Samples are small (9 and 6 missions per side); a null result on time is a null result, not proof of no effect.
- SpecialistUse `loadMs` is UNKNOWN (the model load is inside the batched embedding call; only the total is measured).
- The gold proof (9/9, twice) was not run on this line: nothing was promoted. The nine BASELINE missions (default configuration, padded repository) were all CLEAN 12/12.
- GitHub push protection reminder: no key-shaped literals in fixtures.
