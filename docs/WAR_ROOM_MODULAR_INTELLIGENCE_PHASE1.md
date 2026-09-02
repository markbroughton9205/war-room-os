# War Room Modular Intelligence — Phase 1

Date: 2026-08-31  
Status: **ARCHITECTURE FOUNDATION**  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production (`/Users/markbroughton/WarRoomNode01`): **not modified**

Phase 1 does **not** train WR-Tool, start Recovery-012, start WRIM1-RUN-000003, promote any model, or change the active lineage. Official frozen core remains **WRIM-0**.

Experiment 001 was later authorized separately; see `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_001_REPORT.md`. Experiment 002 (LoRA r=2) was later authorized separately; see `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_002_REPORT.md`. WR-TOOL evidence expansion (curriculum V3 + EVAL-2) was later authorized separately; see `docs/WR_TOOL_EVIDENCE_EXPANSION_REPORT.md`. Experiment 003 is **design only** (`docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_003_DESIGN.md`) and has **not** been started. Phase 1 itself remains architecture-only.

## Verdict language (capacity)

- **Full-weight tool training:** repeatedly unstable in the current WRIM-1.1 regime (Recovery-011 failed at step 120 after compact V2 reintroduction; Recovery-010 without tool supervision completed 250/250).
- **Parameter-isolated tool learning:** linear head tested in EXP-001 (INCONCLUSIVE tool-ID); LoRA r=2 + head tested in EXP-002 (capability DEMONSTRATED on the same tiny split; not promoted).
- **19.2M capacity limit:** **insufficient evidence**. Do not record “19M cannot learn tools” as fact.

Recovery-010 remains **TEST_ONLY** comparison evidence. It is not the foundation model.

## Architecture

```
WAR ROOM
   │
   ▼
WRIM FROZEN CORE          (WRIM-0, MLX freeze, trainable_parameters = 0)
   │
   ▼
CAPABILITY INTERFACE
   ├─ module attached → compact intent → Tool Router → validated request → (execution boundary) → ToolResult → WRIM observation
   └─ no module        → normal WRIM logits
```

## What already existed (extended, not duplicated)

| System | Location | Phase 1 action |
|---|---|---|
| WRIM-0 architecture | `scripts/sovereign-model-lab/wrim0_architecture.py` | Additive `forward_hidden` |
| Checkpoint I/O | `wrim0_checkpoint.py`, `scripts/wrim1-training/checkpoint_io.py` | Reused |
| Model Lab promotion | `lib/wrim1-training/promotion.ts` | Unchanged; module states *map* onto it |
| Model registry | `lib/sovereign-model-lab/modelRegistry.ts` | Full checkpoints only; modules are separate |
| Tool UI registry | `lib/tools/toolRegistry.ts` | Authoritative for War Room tools |
| AGI gym sha256 | `lib/agi-gym/engine.ts` | Bounded reversible executor |
| Compact dialect | Recovery-011 V2 `TOOL=` lines | Parser promoted to a real router |
| Experience ledger | `lib/agi-experience` | Hooks only; no parallel ledger |
| ACTIVE/CANDIDATE models | `lib/model-router` | Council families; WRIM core/modules are a distinct runtime record |

There is no parallel `src/` tree.

## Delivered

1. `FrozenWRIMCore` — exact WRIM-0 load, SHA checks, MLX `Module.freeze()`, hidden states, no core optimizer.
2. Capability module contract + dummy CLASSIFIER_HEAD lifecycle (attach/detach/save/load).
3. Module registry + DESIGN/SHADOW/CANDIDATE/PROMOTED/REJECTED/ARCHIVED (does not replace promotion.ts).
4. ACTIVE CORE vs ACTIVE MODULES; composed runtime identity is **not** a merged checkpoint.
5. Deterministic Tool Router: parse → validate → normalize → execution boundary.
6. Dummy + one-step synthetic optimizer isolation (`core max_abs_diff = 0`).
7. Phase 2 **design only** for WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 (later executed; see EXP-001 report).

## Proofs

- Python: `scripts/wrim-modular/prove_phase1.py` — **22/22**
- TypeScript: `lib/modular-intelligence/modularIntelligence.validation.ts` — **24/24**
- Command: `pnpm run validate:modular-intelligence`

## Stop state

Phase 1 stop is complete. Experiment 001 and Experiment 002 **have been run**. WR-TOOL-CURRICULUM-V3 and WR-TOOL-EVAL-2 **have been materialized**. Do **not** start Recovery-012, WRIM1-RUN-000003, promotion, WRIM-1.2, LoRA r=4, Experiment 003 training, or production deploy without a new Commander order.
