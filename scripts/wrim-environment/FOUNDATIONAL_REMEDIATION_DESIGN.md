# WRIM foundational remediation design

Design and validation only. No optimizer. No WR-CORPUS mutation. No tokenizer mutation. No STAGE3B. Training remains OFF.

**Source of truth:** successful third-run `WRIM1-NEBULA-FOUNDATIONAL-ROOT-CAUSE-000001` (`FOUNDATIONAL_ROOT_CAUSE_IDENTIFIED`, `F. MULTIPLE_FOUNDATIONAL_BLOCKERS`). Failed attempts 1–2 are tooling defects only.

## Must fix before another optimizer step is authorized

1. **Packing:** do not start the next official run under `DOCUMENT_MAJOR_CONTIGUOUS`. Next packer is `DEFICIT_INTERLEAVE_FAMILIES`. Frozen RUN-000004 stream stays untouched.
2. **Soft-stop:** coded rule must include `unique256`, must not silently continue, must be recomputed by the validator. Floor-at-zero JSON/instruction/entity cannot count as degradations or improvements.
3. **Separate Commander authorization** is still required. Completing this design does not turn training ON.

Scale, objective, instruction JSON, and repetition in the weights cannot be cleared without later authorized training. They are designed here; they are not authorized here.

## Do not

- Train longer as the default answer.
- Run another 25-step Stage3A corrective pilot.
- SFT-first on this undertrained base.
- Promote STEP10 / STEP25 / interpolants.
- Merge proposed data into WR-CORPUS.
- Hide bad weights with sampling or repetition penalty as the official decoder.

## Objective

**C. staged causal-LM pretraining, then prompt-masked SFT.**

Foundation learning = document continuation. Behavior/instruction specialization starts only after a generation uniqueness/looping gate.

## Token budgets (none authorized)

| Scale | Tokens | Steps @ 4096 | Intent |
|---|---:|---:|---|
| MINIMUM DIAGNOSTIC | 4,096,000 | 1,000 | Did interleaved CLM move looping/unique128? JSON may stay 0. |
| PRACTICAL DEVELOPMENT | 16,384,000 | 4,000 | Existing C0+C1 only. Audit F1 headline. |
| TARGET FOUNDATION | 65,536,000 | 16,000 | Needs `PROPOSED_TRAINING_DATA`. Still below Chinchilla ~384M. |

## Architecture / tokenizer

- Architecture: **ARCHITECTURE_ACCEPTABLE_FOR_NEXT_FOUNDATIONAL_PASS**
- Tokenizer: **CONSTRAINING_BUT_USABLE** (no mutation)

## Evaluation decoder

Greedy. Temperature / top-p are diagnostic only. No repetition penalty in official eval.

## STAGE3B

**NO** until a later Commander pass after P3–P7 gates.
