"""Official WRIM-1 shard loader: immutable materialized bundle only.

Live-repo reconstruction is forbidden for official runs. Wave 8.1R recovered
bytes live under model-lab/corpora/WR-CORPUS-1-HARDENED/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from constants import TEST_TOKENS, TRAIN_TOKENS, VAL_TOKENS
from recover_frozen_corpus import verify_bundle
from corpus_bundle import bundle_dir
from paths import repo_root


def materialize_official_shards(root: Path | None = None) -> dict:
    raise RuntimeError(
        "official WRIM-1 materialization from mutable repo files is disabled. "
        "Use scripts/wrim1-training/recover_frozen_corpus.py to rebuild the "
        "immutable Wave 8.1R shard bundle from hash-matched frozen bytes."
    )


def load_split_arrays(root: Path | None = None) -> tuple[np.ndarray, np.ndarray, dict]:
    root = root or repo_root()
    verified = verify_bundle(root)
    if not verified.get("ok"):
        raise RuntimeError(f"official shard verification failed: {verified.get('detail')}")
    man = verified["manifest"]
    out = bundle_dir(root)
    train = np.load(out / "tokens" / "train.npy", mmap_mode="r")
    val = np.load(out / "tokens" / "validation.npy", mmap_mode="r")
    test = np.load(out / "tokens" / "test.npy", mmap_mode="r")
    if int(train.size) != TRAIN_TOKENS or int(val.size) != VAL_TOKENS or int(test.size) != TEST_TOKENS:
        raise RuntimeError(
            f"loaded mmap shard sizes do not match Wave 8.1 token counts "
            f"train={train.size} val={val.size} test={test.size}"
        )
    return train, val, {**man, "test_mmap_tokens": int(test.size)}


if __name__ == "__main__":
    train, val, manifest = load_split_arrays()
    print({
        "ok": True,
        "train": int(train.size),
        "validation": int(val.size),
        "bundle_hash": manifest.get("materializedBundleHash"),
    })
    sys.exit(0)
