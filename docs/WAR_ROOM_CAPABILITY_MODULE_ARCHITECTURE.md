# War Room Capability Module Architecture

Date: 2026-08-31  
Status: Phase 1 foundation. No WR-Tool training.

## Contract

Python: `CapabilityModule` in `scripts/wrim-modular/capability_module.py`  
TypeScript records: `lib/modular-intelligence/capabilityRegistry.ts`

Fields: `capability_id`, `module_id`, `version`, `base_model_id`, `base_checkpoint_sha`, `module_type`, `target_layers`, `trainable_parameter_count`, `state`, `created_at`, `provenance`, `eval_identity`, `artifact_hash`.

Methods: `attach`, `detach`, `forward`, `save`/`load` (artifact), `validateCompatibility`, `describeTrainableParameters`.

## Module types (registry, not all trained)

`LORA` | `ADAPTER` | `CLASSIFIER_HEAD` | `ROUTER_HEAD`

Phase 1 dummy is `CLASSIFIER_HEAD` (`WR-DUMMY-CAP-001`). `LoRALinear` exists as a custom MLX primitive (Apple MLX has **no** built-in LoRA).

## Compatibility (fail closed)

Refuse attach if any of: wrong base model, wrong checkpoint SHA, wrong architecture hash, wrong `d_model` / `n_layers`, wrong tokenizer SHA, unsupported major version, invalid artifact hash.

## Artifact layout

`model-lab/capabilities/<module-id>/` (Phase 1 dummy under `model-lab/manifests/modular-intelligence/test-only/`):

- `manifest.json`
- `weights.safetensors` (module only — **never** a copy of WRIM-0)
- `config.json`
- `compatibility.json`
- `provenance.json`
- `eval.json`
- `hashes.json`

## Lifecycle states

`DESIGN` → `SHADOW` → `CANDIDATE` → `PROMOTED`  
Failures: `REJECTED` then `ARCHIVED`.

Illegal: `DESIGN` → `PROMOTED`.

Mapping onto existing WRIM-1 `promotion.ts` (that file is **not** rewritten):

| Module state | Closest existing promotion state |
|---|---|
| DESIGN | TRAINING_NOT_STARTED |
| SHADOW | EVALUATING |
| CANDIDATE | EVALUATED |
| PROMOTED | PROMOTED |
| REJECTED | PROMOTION_REJECTED |
| ARCHIVED | (none) |

Serving identity is **ACTIVE CORE + ACTIVE MODULES**, not a promotion enum.

## Composed runtime

`composed:WRIM-0+[WR-Tool-Adapter-001]` is an identity string. It is **not** a new merged checkpoint and must not be registered as a `ModelManifest` lineage.

## Failure handling

On module failure:

1. ACTIVE core remains WRIM-0 (untouched).
2. Module → `REJECTED`.
3. Artifact + eval deltas + metrics preserved.
4. Forensic work item may be generated (`auto_promotion: false`).
5. No core rollback (core never changed).

`rejectFailedModule` in `lib/modular-intelligence/lifecycle.ts`.

## Trainable selection

`partition_parameters` returns core vs capability leaves. `assert_optimizer_excludes_core` fails if core keys appear in the optimizer. A TEST_ONLY one-step Adam update on the dummy head proved `core max_abs_diff = 0` while capability weights moved.

## Experience

`toExperienceCapture` places tool fields on existing `CaptureExperienceInput.modelTarget` JSON. No second ledger.

## Future curriculum (design only)

runtime experience → evidence validation → curriculum candidate → adapter dataset → held-out eval → SHADOW training → evaluation → CANDIDATE → Commander promotion. Not implemented in Phase 1.
