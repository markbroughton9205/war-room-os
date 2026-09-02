#!/usr/bin/env python3
"""TEST_ONLY: load WRIM-0 in .venv-wrim and run canonical recovery inference. No training."""
from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer, decoders

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import load_parent_wrim0_weights, model_to_numpy  # noqa: E402
from constants import (  # noqa: E402
    PARENT_CHECKPOINT_REL,
    PARENT_CHECKPOINT_SHA256,
    TOKENIZER_REL,
    TOKENIZER_SHA256,
)
from diagnose_collapse import generate, topk_diag  # noqa: E402
from hashes import sha256_file, tensor_tree_sha256  # noqa: E402
from paths import repo_root  # noqa: E402
from run_recovery_experiment import run_suite  # noqa: E402
from trainer_core import build_from_config  # noqa: E402
from training_config import official_training_config  # noqa: E402

SEED = 20260830
SUITE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
BASELINE_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004/diagnostic-step-000000.json"
OUT_REL = "model-lab/manifests/wrim1_1_recovery/test-only/WRIM-PY312-VENV-WRIM-INFERENCE-VERIFY.json"

EXPECTED_COLLAPSE = 2
EXPECTED_UNIQUE = 0.3966153846153846
EXPECTED_TOP = " a"
EXPECTED_P_PERIOD = 0.0010068492265418172
EXPECTED_SKY_PREFIX = " a"


def main() -> int:
    root = repo_root()
    ckpt = root / PARENT_CHECKPOINT_REL
    tok_path = root / TOKENIZER_REL
    before_sha = sha256_file(ckpt)
    before_stat = ckpt.stat()
    tok_sha = sha256_file(tok_path)

    import mlx.core as mx

    metal_ok = bool(mx.metal.is_available())
    device = str(mx.default_device())
    cfg = official_training_config()
    cfg["seed"] = SEED
    model, arch, nparams = build_from_config(cfg, SEED)
    load_info = load_parent_wrim0_weights(model, ckpt, PARENT_CHECKPOINT_SHA256)
    loaded = model_to_numpy(model)
    loaded_sha = tensor_tree_sha256(loaded)
    raw = load_file(str(ckpt))
    parent_tensors = {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    parent_sha = tensor_tree_sha256(parent_tensors)
    max_abs = 0.0
    for k, a in parent_tensors.items():
        b = loaded[k]
        max_abs = max(max_abs, float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64)))))

    tokenizer = Tokenizer.from_file(str(tok_path))
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()

    logits = topk_diag(model, tokenizer, "The sky is", k=10)
    sky = generate(model, tokenizer, "The sky is", 32, temperature=0.0)
    suite = json.loads((root / SUITE_REL).read_text())
    suite_out = run_suite(model, tokenizer, suite["items"], 32)
    baseline = json.loads((root / BASELINE_REL).read_text())

    after_sha = sha256_file(ckpt)
    after_stat = ckpt.stat()

    unique = suite_out["mean_unique_ratio"]
    collapse = suite_out["collapsed_probes"]
    top_tok = (logits.get("top") or [{}])[0].get("tok")
    p_period = logits.get("p_period")
    sky_cont = sky["continuation"] or ""

    material = []
    if collapse != EXPECTED_COLLAPSE:
        material.append(f"collapse {collapse} != {EXPECTED_COLLAPSE}")
    if unique is None or abs(unique - EXPECTED_UNIQUE) > 0.01:
        material.append(f"unique {unique} vs {EXPECTED_UNIQUE}")
    if top_tok != EXPECTED_TOP:
        material.append(f"top {top_tok!r} != {EXPECTED_TOP!r}")
    if p_period is None or abs(float(p_period) - EXPECTED_P_PERIOD) > 5e-4:
        material.append(f"P(.) {p_period} vs {EXPECTED_P_PERIOD}")
    if not sky_cont.startswith(EXPECTED_SKY_PREFIX):
        material.append(f"sky prefix {sky_cont[:40]!r}")
    if max_abs != 0.0:
        material.append(f"weight load max_abs {max_abs}")
    if before_sha != PARENT_CHECKPOINT_SHA256 or after_sha != before_sha:
        material.append("checkpoint hash mismatch or mutation")
    if tok_sha != TOKENIZER_SHA256:
        material.append("tokenizer hash mismatch")
    if not metal_ok or "gpu" not in device.lower():
        material.append(f"metal/gpu not visible device={device} metal={metal_ok}")

    pkgs = {}
    try:
        from importlib.metadata import version
        for name in ("mlx", "mlx-metal", "numpy", "safetensors", "tokenizers"):
            try:
                pkgs[name] = version(name)
            except Exception as exc:  # noqa: BLE001
                pkgs[name] = f"unavailable:{type(exc).__name__}"
    except Exception:
        pkgs = {"importlib.metadata": "failed"}

    result = {
        "test_only": True,
        "training_steps": 0,
        "optimizer_created": False,
        "python": sys.version,
        "executable": sys.executable,
        "machine": platform.machine(),
        "platform": platform.platform(),
        "mlx_version": getattr(mx, "__version__", None),
        "default_device": device,
        "metal_available": metal_ok,
        "nparams": nparams,
        "checkpoint_path": str(ckpt),
        "checkpoint_sha_before": before_sha,
        "checkpoint_sha_after": after_sha,
        "checkpoint_mtime_before": before_stat.st_mtime,
        "checkpoint_mtime_after": after_stat.st_mtime,
        "checkpoint_size_before": before_stat.st_size,
        "checkpoint_size_after": after_stat.st_size,
        "tokenizer_sha": tok_sha,
        "parent_tensor_tree_sha": parent_sha,
        "loaded_tensor_tree_sha": loaded_sha,
        "max_abs_vs_checkpoint": max_abs,
        "load_info": load_info,
        "sky_greedy": {
            "continuation": sky_cont,
            "new_ids": sky["new_ids"][:8],
        },
        "logits": logits,
        "suite": {
            "collapsed_probes": collapse,
            "n_probes": suite_out["n_probes"],
            "mean_unique_ratio": unique,
            "sky_continuation": suite_out.get("sky_continuation"),
            "items": [
                {"id": it["id"], "collapsed": it["collapsed"], "unique_ratio": it["unique_ratio"], "continuation": it["continuation"]}
                for it in suite_out["items"]
            ],
        },
        "baseline_004_step0": {
            "collapsed_probes": baseline.get("collapsed_probes"),
            "mean_unique_ratio": baseline.get("mean_unique_ratio"),
            "p_period": (baseline.get("logits") or {}).get("p_period"),
            "top": (baseline.get("logits") or {}).get("top"),
            "sky_continuation": baseline.get("sky_continuation"),
        },
        "packages": pkgs,
        "material_differences": material,
        "pass": len(material) == 0,
    }
    out = root / OUT_REL
    out.write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(json.dumps({
        "pass": result["pass"],
        "material_differences": material,
        "device": device,
        "metal_available": metal_ok,
        "python": sys.version.split()[0],
        "machine": platform.machine(),
        "collapse": collapse,
        "unique": unique,
        "top": top_tok,
        "p_period": p_period,
        "sky": sky_cont[:80],
        "max_abs": max_abs,
        "ckpt_unchanged": before_sha == after_sha == PARENT_CHECKPOINT_SHA256,
        "tok_ok": tok_sha == TOKENIZER_SHA256,
        "packages": pkgs,
        "out": str(out),
    }, indent=2))
    return 0 if result["pass"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
