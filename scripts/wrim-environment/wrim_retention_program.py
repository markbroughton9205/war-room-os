"""Retention recovery program driver. Sequences interpolation then KL probes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_retention_kl_train import train_kl

CORPUS = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"
TEACHER_014 = Path(CKPT_BASE) / "WRIM1-UH1-AC2-LMH-000014" / "step-10"
TOKEN2_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-TT-000007" / "step-40"
INTERP_REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_INTERP_000001_REPORT.json"
TOKEN2_CE_REF = 26.50
PREVIOUS_TOTAL = 1_458_176
PROGRAM_BUDGET = 1_000_000


def select_parent(interp: dict[str, Any]) -> tuple[Path, str, dict[str, Any]]:
    if interp.get("FOUND_BETTER_STAGE3_6") and interp.get("BEST_INTERPOLATED_STAGE3_6"):
        alpha = float(interp["BEST_INTERPOLATION_ALPHA"])
        path = Path(CKPT_BASE) / "WRIM1-UH1-AC2-INT-000001" / f"alpha-{alpha:.2f}"
        return path, f"INT-000001/alpha-{alpha:.2f}", interp["BEST_INTERPOLATED_STAGE3_6"]
    return TEACHER_014, "WRIM1-UH1-AC2-LMH-000014/step-10", {"source": "retention_reference"}


def run_program() -> dict[str, Any]:
    interp = json.loads(INTERP_REPORT.read_text(encoding="utf-8"))
    parent, parent_id, parent_row = select_parent(interp)
    memory: list[dict[str, Any]] = []
    tokens_used = 0
    recipes = [
        {"run_id": "WRIM1-UH1-AC2-KL-000000", "kl_weight": 0.20, "teacher_mix": "014", "steps": 10, "parent": TOKEN2_PARENT, "pack": "RESTORE_from_000007_kl014_w20"},
        {"run_id": "WRIM1-UH1-AC2-KL-000001", "kl_weight": 0.05, "teacher_mix": "014", "steps": 10, "parent": parent, "pack": "FT60_TT40_kl014_w05"},
        {"run_id": "WRIM1-UH1-AC2-KL-000002", "kl_weight": 0.10, "teacher_mix": "014", "steps": 10, "parent": parent, "pack": "FT60_TT40_kl014_w10"},
        {"run_id": "WRIM1-UH1-AC2-KL-000003", "kl_weight": 0.20, "teacher_mix": "014", "steps": 10, "parent": parent, "pack": "FT60_TT40_kl014_w20"},
        {"run_id": "WRIM1-UH1-AC2-KL-000004", "kl_weight": 0.30, "teacher_mix": "mix", "steps": 10, "parent": parent, "pack": "FT60_TT40_klmix_w30"},
        {"run_id": "WRIM1-UH1-AC2-KL-000005", "kl_weight": 0.50, "teacher_mix": "400", "steps": 10, "parent": parent, "pack": "FT60_TT40_kl400_w50"},
    ]

    viable = None
    for rec in recipes:
        if tokens_used + 81_920 > PROGRAM_BUDGET:
            memory.append({"run_id": rec["run_id"], "skipped": "budget"})
            break
        obj = train_kl(
            run_id=rec["run_id"],
            corpus_dir=CORPUS,
            parent_ckpt=rec["parent"],
            pack_name=rec["pack"],
            teacher_014=TEACHER_014,
            teacher_400=None,
            kl_weight=rec["kl_weight"],
            teacher_mix=rec["teacher_mix"],
            steps=rec["steps"],
            head_lr=1e-4,
        )
        used = int(obj.get("TOKENS_USED") or 0)
        tokens_used += used
        s3p = (obj.get("STAGE3_HISTORICAL") or {}).get("parent")
        s3f = (obj.get("STAGE3_HISTORICAL") or {}).get("final")
        t2p = (obj.get("TOKEN2_CE") or {}).get("parent")
        t2f = (obj.get("TOKEN2_CE") or {}).get("final")
        row = {
            "run_id": rec["run_id"],
            "kl_weight": rec["kl_weight"],
            "teacher_mix": rec["teacher_mix"],
            "parent": str(rec["parent"]),
            "ok": obj.get("ok"),
            "reason": obj.get("reason"),
            "abort": obj.get("abort"),
            "preflight": obj.get("PREFLIGHT"),
            "tokens": used,
            "stage3_parent": s3p,
            "stage3_final": s3f,
            "token2_parent": t2p,
            "token2_final": t2f,
            "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
            "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        }
        memory.append(row)
        Path(DATA_ROOT, "WRIM_GENESIS_RECOVERY_MEMORY.json").write_text(json.dumps(memory, indent=2) + "\n")
        keep = (
            obj.get("ok")
            and s3f is not None
            and int(s3f) >= 6
            and t2f is not None
            and float(t2f) < TOKEN2_CE_REF
            and (t2p is None or float(t2f) <= float(t2p) + 0.05)
        )
        restore = (
            obj.get("ok")
            and s3f is not None
            and int(s3f) >= 6
            and t2f is not None
            and float(t2f) < 25.0
        )
        if keep or restore:
            viable = row
            break
        # do not continue a recipe that hard-stops Stage3 < 5; next recipe is a new run id
        if obj.get("reason") == "preflight_unsafe":
            continue

    follow = None
    if viable and tokens_used + 204_800 <= PROGRAM_BUDGET:
        parent_follow = Path(CKPT_BASE) / str(viable["best_ckpt"])
        follow = train_kl(
            run_id="WRIM1-UH1-AC2-KL-000010",
            corpus_dir=CORPUS,
            parent_ckpt=parent_follow,
            pack_name=str(viable["run_id"]) + "_continue",
            teacher_014=TEACHER_014,
            teacher_400=None,
            kl_weight=float(viable["kl_weight"]),
            teacher_mix=str(viable["teacher_mix"]),
            steps=25,
            head_lr=1e-4,
        )
        tokens_used += int(follow.get("TOKENS_USED") or 0)
        memory.append({"run_id": "WRIM1-UH1-AC2-KL-000010", "continue_of": viable["run_id"], "report_keys": {
            "ok": follow.get("ok"),
            "stage3": follow.get("STAGE3_HISTORICAL"),
            "token2": follow.get("TOKEN2_CE"),
            "tokens": follow.get("TOKENS_USED"),
            "best": follow.get("BEST_EXPERIMENTAL_CHECKPOINT"),
            "hash": follow.get("BEST_EXPERIMENTAL_HASH"),
            "abort": follow.get("abort"),
        }})
        Path(DATA_ROOT, "WRIM_GENESIS_RECOVERY_MEMORY.json").write_text(json.dumps(memory, indent=2) + "\n")

    summary = {
        "INTERP": {
            "BEST_INTERPOLATION_ALPHA": interp.get("BEST_INTERPOLATION_ALPHA"),
            "FOUND_BETTER_STAGE3_6": interp.get("FOUND_BETTER_STAGE3_6"),
            "RETENTION_RECOVERY_PARENT": interp.get("RETENTION_RECOVERY_PARENT"),
        },
        "PARENT_USED": parent_id,
        "PARENT_ROW": parent_row,
        "VIABLE_RECIPE": viable,
        "FOLLOW": None if follow is None else {
            "ok": follow.get("ok"),
            "STAGE3_HISTORICAL": follow.get("STAGE3_HISTORICAL"),
            "TOKEN2_CE": follow.get("TOKEN2_CE"),
            "BEST": follow.get("BEST_EXPERIMENTAL_CHECKPOINT"),
            "HASH": follow.get("BEST_EXPERIMENTAL_HASH"),
            "abort": follow.get("abort"),
        },
        "MEMORY": memory,
        "RECOVERY_PROGRAM_TOKENS_USED": tokens_used,
        "RECOVERY_PROGRAM_TOKENS_REMAINING": PROGRAM_BUDGET - tokens_used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + tokens_used,
    }
    Path(DATA_ROOT, "WRIM_GENESIS_RECOVERY_PROGRAM_STATE.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


if __name__ == "__main__":
    print(json.dumps(run_program(), indent=2, default=str))
