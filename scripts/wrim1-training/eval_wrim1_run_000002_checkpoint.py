#!/usr/bin/env python3
"""Inference-only WRIM-1.1-CAP-EVAL-0 on an official 000002 checkpoint. Does not train."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from capability_curriculum_lib import EVAL_ID  # noqa: E402
from checkpoint_io import load_bundle, load_model_weights  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import repo_root  # noqa: E402
from run_recovery_experiment import load_tokenizer  # noqa: E402
from run_wrim1_run_000002 import delta_vs_baseline, official_config, run_cap_eval  # noqa: E402
from trainer_core import build_from_config  # noqa: E402


def main() -> int:
    root = repo_root()
    step = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    work = root / "model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002"
    ckpt = work / f"checkpoint-step-{step:06d}"
    suite = json.loads((root / "model-lab/eval-only" / EVAL_ID / "suite.json").read_text(encoding="utf-8"))
    baseline = json.loads((root / "model-lab/eval-only" / EVAL_ID / "wrim0-baseline.json").read_text(encoding="utf-8"))
    tokenizer = load_tokenizer(root)
    cfg = official_config()
    bundle = load_bundle(ckpt)
    model, _, nparams = build_from_config(cfg, int(cfg["seed"]))
    load_model_weights(model, bundle["model"], strict=True)
    ev = run_cap_eval(model, tokenizer, suite)
    ev["step"] = step
    ev["model_id"] = "WRIM-1.1-CANDIDATE"
    ev["parameter_count"] = nparams
    ev["checkpoint_sha256"] = bundle["manifest"]["model_tensor_sha256"]
    ev["delta"] = delta_vs_baseline(ev, baseline)
    ev["optimizer_steps"] = step
    dest = work / f"cap-eval-step-{step:06d}.json"
    dest.write_text(json.dumps(ev, indent=2, default=str) + "\n")
    print(json.dumps({
        "step": step,
        "pass_count": ev["pass_count"],
        "item_count": ev["item_count"],
        "family_stats_short": ev["family_stats_short"],
        "p0_improve": ev["delta"]["p0_meaningful_improvements"],
        "p0_reg": ev["delta"]["p0_regressions"],
        "sha": ev["checkpoint_sha256"],
        "suite_sha": sha256_file(root / "model-lab/eval-only" / EVAL_ID / "suite.json"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
