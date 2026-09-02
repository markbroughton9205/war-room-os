from __future__ import annotations

from constants import (
    ARCHITECTURE_CONFIG_SHA256,
    ARCHITECTURE_ID,
    BATCH,
    CONTEXT,
    CORPUS_ID,
    CORPUS_SHA256,
    EPOCHS,
    PARAM_COUNT,
    PARENT_CHECKPOINT_SHA256,
    PARENT_MODEL_ID,
    PLANNED_STEPS,
    PLANNED_TRAINING_TOKENS,
    TOKENIZER_ID,
    TOKENIZER_SHA256,
    TRAIN_TOKENS,
    VOCAB_SIZE,
)


def official_training_config() -> dict:
    """Complete WRIM-1 Option A recipe. Resume must not fill missing fields from defaults."""
    return {
        "architecture_family": ARCHITECTURE_ID,
        "parameter_count": PARAM_COUNT,
        "vocab_size": VOCAB_SIZE,
        "d_model": 256,
        "n_layers": 18,
        "n_heads": 4,
        "head_dim": 64,
        "d_ff": 768,
        "rope_theta": 10000.0,
        "context_length": CONTEXT,
        "batch_size": BATCH,
        "gradient_accumulation": 1,
        "precision": "fp32",
        "optimizer": "AdamW",
        "learning_rate": 0.003,
        "betas": [0.9, 0.95],
        "eps": 1e-8,
        "weight_decay": 0.1,
        "gradient_clipping": 1.0,
        "scheduler": "linear_warmup_cosine_decay",
        "warmup_steps": 50,
        "scheduler_floor_ratio": 0.1,
        "total_steps": PLANNED_STEPS,
        "epochs": EPOCHS,
        "target_training_tokens": PLANNED_TRAINING_TOKENS,
        "unique_train_tokens": TRAIN_TOKENS,
        "validation_cadence_steps": 200,
        "checkpoint_cadence_steps": 200,
        "seed": 20260830,
        "shuffle_strategy": "epoch_permutation_then_sequential_cursor",
        "mlx_memory_limit_bytes": 3221225472,
        "mlx_cache_limit_bytes": 268435456,
        "cache_clear_strategy": "mx.clear_cache after each materialized step",
        "dataset_split_identity": {
            "corpus_id": CORPUS_ID,
            "corpus_sha256": CORPUS_SHA256,
            "train_split": "train",
            "validation_split": "validation",
            "test_split": "test",
        },
        "tokenizer_identity": {"tokenizer_id": TOKENIZER_ID, "tokenizer_sha256": TOKENIZER_SHA256},
        "parent_identity": {
            "parent_model_id": PARENT_MODEL_ID,
            "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
            "architecture_config_sha256": ARCHITECTURE_CONFIG_SHA256,
        },
        "checkpoint_cadence_rationale": (
            "Genesis median ~4.56s/step at batch=8 ctx=512. 1893 steps ≈ 2.4h DERIVED. "
            "Checkpoint every 200 steps is ~15 minutes of lost work, ~10 writes, "
            "and ~2.4 GiB if all retained before policy prune."
        ),
        "validation_cadence_rationale": (
            "Full validation is 836935 tokens (~204 batches at 8×512). That would dominate the 1893-step run. "
            "Validate every 200 steps using 8 diagnostic batches (32768 tokens) plus a final fuller pass after training."
        ),
    }


def test_only_training_config() -> dict:
    cfg = official_training_config()
    cfg.update({
        "architecture_family": "TEST-WAVE9-TINY",
        "parameter_count": None,
        "vocab_size": 64,
        "d_model": 32,
        "n_layers": 2,
        "n_heads": 2,
        "head_dim": 16,
        "d_ff": 64,
        "context_length": 32,
        "batch_size": 2,
        "total_steps": 20,
        "epochs": 2,
        "target_training_tokens": 20 * 2 * 32,
        "unique_train_tokens": 512,
        "validation_cadence_steps": 5,
        "checkpoint_cadence_steps": 10,
        "warmup_steps": 2,
        "seed": 9,
        "dataset_split_identity": {
            "corpus_id": "TEST-WAVE9-SYNTHETIC",
            "corpus_sha256": "not-official-lineage",
            "train_split": "synthetic_train",
            "validation_split": "synthetic_val",
            "test_split": "synthetic_test",
        },
        "tokenizer_identity": {"tokenizer_id": "TEST-ONLY-INT-VOCAB", "tokenizer_sha256": "not-wr-tokenizer-0"},
        "parent_identity": {
            "parent_model_id": "TEST-WAVE9-RANDOM-INIT",
            "parent_checkpoint_sha256": "none",
            "architecture_config_sha256": "test-tiny",
        },
        "test_only": True,
        "lineage": "NOT_MODEL_LINEAGE",
        "promotable": False,
    })
    return cfg


def optimizer_config_from_training(cfg: dict) -> dict:
    return {
        "optimizer": cfg["optimizer"],
        "learning_rate": cfg["learning_rate"],
        "betas": list(cfg["betas"]),
        "eps": cfg["eps"],
        "weight_decay": cfg["weight_decay"],
        "gradient_clipping": cfg["gradient_clipping"],
        "gradient_accumulation": cfg["gradient_accumulation"],
        "scheduler": {
            "type": cfg["scheduler"],
            "warmup_steps": cfg["warmup_steps"],
            "total_steps": cfg["total_steps"],
            "base_lr": cfg["learning_rate"],
            "floor_ratio": cfg["scheduler_floor_ratio"],
        },
    }
