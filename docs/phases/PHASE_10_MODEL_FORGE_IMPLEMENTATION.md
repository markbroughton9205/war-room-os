# Phase 10 — Model Forge (Foundry subsystem)

Model Forge lives in `lib/agents/forge/` inside Agent Foundry. It is not a separate application. State is an append-only JSONL
(`model-forge.jsonl`) beside the Foundry log (same data dir, torn-line tolerant, credential-like content refused).

## Implemented now
| Area | Where | Notes |
|---|---|---|
| Registry | `registry.ts`, `store.ts` | Exact Ollama refs, role, status (ACTIVE / BASELINE / FUTURE_HEAVY / CANDIDATE / RETIRED), `routing.eligible`. Statuses are policy, never performance claims. |
| Lineage | `ModelEntry.lineage` | parent, transformation, note. Third-party abliteration is recorded as such; War Room has not re-ablated anything. |
| License honesty | `ModelEntry.license` | Derivatives are `permissive: UNKNOWN` until the model card is checked. |
| Resource profiles | `profile.ts` | Residency from the runtime's own `/api/ps` bytes (`size` vs `size_vram`): FULL_GPU / PARTIAL_OFFLOAD / CPU_ASSISTED / UNKNOWN (MEASURED). Pre-load size-only reasoning is tagged ESTIMATED and never claims FULL_GPU. Also load ms, first-token ms, tokens/s, GPU MiB and system RAM MiB after load, context. |
| Smoke test | `smoke.ts` | Identity (digest from `/api/tags`), responds, structured JSON, a coding reply that is executed, through the same `OllamaModelClient` Foundry uses. |
| Benchmarks | `e2eRealModel.ts` -> `ForgeStore.recordBenchmark` | Same chat-session fixture + independent 12-check verifier for every model; records score, calls, repairs, elapsed, peak GPU/RAM sampled during the run, actual executor, context. Retries/regressions are `UNKNOWN` until measured. |
| Routing evidence | `routing.ts` | Per task class. Only ACTIVE+eligible models; needs a COMPLETED, full-score, real-executor, no-manual-intervention run; ties by repairs then time. No evidence => `NO_EVIDENCE`, never a default. Scripted-double runs and BASELINE models are excluded. |
| CLI | `cli.ts` | `register-pool`, `profile <model>`, `smoke <model>`, `route`, `status`. |
| Validator | `forge.validation.ts` | `pnpm run validate:forge`. |

## Designed, NOT implemented (future Forge slices)
- **Transformations** (`warroom/<family>-engineer-vN` variants): only with a written improvement hypothesis plus a benchmark able to measure it; every variant records its parent and the recipe in lineage. Do not damage a working model to create a variant.
- **Adapters (LoRA)**, **quantization variants**, **training-example curation** (from verified Foundry successes and debug-ledger corrections, secrets-redacted, Commander-approved), **abliteration/permissive experiments** (only on a separate copy, benchmarked against its parent, license reviewed).
- **Load management**: eviction/serialization of large models; needed before the 123B is revisited.
- **123B**: registered as FUTURE_HEAVY, not downloaded. Estimated REQUIRES_OFFLOAD (~70 GB artifact vs ~46 GiB RAM+VRAM). Classification stays ESTIMATED until measured.

## Foundry integration
- `OllamaModelClient` already reports the actual executor and token counts; benchmark records carry them.
- Routing decisions are read by Foundry through `routeFor(taskClass, models, benchmarks)`; wiring it into assignment execution is a follow-up once at least one model has full-score evidence.
- Qwen2.5-coder:14b remains installed as historical baseline only (`historicalBaseline: true` in its benchmark records).
