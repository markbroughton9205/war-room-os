"""Phase 2b: response-logit and STEP_400 anchors after document-KL-to-014 was falsified."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_retention_kl_train import train_kl

CORPUS = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"
TEACHER_014 = Path(CKPT_BASE) / "WRIM1-UH1-AC2-LMH-000014" / "step-10"
TOKEN2_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-TT-000007" / "step-40"
INT_PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-INT-000001" / "alpha-0.02"
TOKEN2_CE_REF = 26.50
PREVIOUS_TOTAL = 1_458_176
# 000000-000002 completed 81920*3=245760; 000003 partial ignored
ALREADY_USED = 245_760
PROGRAM_BUDGET = 1_000_000


def main() -> dict:
    memory = []
    tokens_used = ALREADY_USED
    recipes = [
        {"run_id": "WRIM1-UH1-AC2-KL-000006", "parent": TOKEN2_PARENT, "kl_weight": 0.20, "l2_weight": 0.0, "teacher_mix": "014", "kl_on": "response", "steps": 10, "pack": "RESTORE_respKL014_w20"},
        {"run_id": "WRIM1-UH1-AC2-KL-000007", "parent": INT_PARENT, "kl_weight": 0.20, "l2_weight": 0.0, "teacher_mix": "014", "kl_on": "response", "steps": 10, "pack": "PROTECT_respKL014_w20"},
        {"run_id": "WRIM1-UH1-AC2-KL-000008", "parent": INT_PARENT, "kl_weight": 0.20, "l2_weight": 0.0, "teacher_mix": "400", "kl_on": "rehearsal", "steps": 10, "pack": "PROTECT_docKL400_w20"},
        {"run_id": "WRIM1-UH1-AC2-KL-000009", "parent": INT_PARENT, "kl_weight": 0.0, "l2_weight": 10.0, "teacher_mix": "014", "kl_on": "response", "steps": 10, "pack": "PROTECT_l2head_w10"},
    ]
    viable = None
    for rec in recipes:
        obj = train_kl(
            run_id=rec["run_id"],
            corpus_dir=CORPUS,
            parent_ckpt=rec["parent"],
            pack_name=rec["pack"],
            teacher_014=TEACHER_014,
            teacher_400=None,
            kl_weight=rec["kl_weight"],
            teacher_mix=rec["teacher_mix"],
            kl_on=rec["kl_on"],
            l2_weight=rec["l2_weight"],
            steps=rec["steps"],
            head_lr=1e-4,
        )
        used = int(obj.get("TOKENS_USED") or 0)
        tokens_used += used
        s3f = (obj.get("STAGE3_HISTORICAL") or {}).get("final")
        t2p = (obj.get("TOKEN2_CE") or {}).get("parent")
        t2f = (obj.get("TOKEN2_CE") or {}).get("final")
        row = {
            "run_id": rec["run_id"],
            "pack": rec["pack"],
            "ok": obj.get("ok"),
            "reason": obj.get("reason"),
            "abort": obj.get("abort"),
            "preflight": obj.get("PREFLIGHT"),
            "tokens": used,
            "stage3": obj.get("STAGE3_HISTORICAL"),
            "token2": obj.get("TOKEN2_CE"),
            "rank": obj.get("TOKEN2_RANK"),
            "oracle": obj.get("TOKEN2_ORACLE"),
            "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
            "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
            "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        }
        memory.append(row)
        Path(DATA_ROOT, "WRIM_GENESIS_RECOVERY_MEMORY.json").write_text(json.dumps(memory, indent=2) + "\n")
        print(json.dumps({k: row[k] for k in ("run_id", "ok", "reason", "stage3", "token2", "rank", "abort") if k in row}, default=str), flush=True)
        if (
            obj.get("ok")
            and s3f is not None
            and int(s3f) >= 6
            and t2f is not None
            and t2p is not None
            and float(t2f) < float(t2p) - 0.05
            and float(t2f) < TOKEN2_CE_REF
        ):
            viable = row
            break
        if tokens_used >= PROGRAM_BUDGET:
            break

    follow = None
    if viable and tokens_used + 204_800 <= PROGRAM_BUDGET:
        follow = train_kl(
            run_id="WRIM1-UH1-AC2-KL-000010",
            corpus_dir=CORPUS,
            parent_ckpt=Path(CKPT_BASE) / str(viable["best_ckpt"]),
            pack_name=str(viable["run_id"]) + "_continue",
            teacher_014=TEACHER_014,
            teacher_400=None,
            kl_weight=next(r["kl_weight"] for r in recipes if r["run_id"] == viable["run_id"]),
            teacher_mix=next(r["teacher_mix"] for r in recipes if r["run_id"] == viable["run_id"]),
            kl_on=next(r["kl_on"] for r in recipes if r["run_id"] == viable["run_id"]),
            l2_weight=next(r["l2_weight"] for r in recipes if r["run_id"] == viable["run_id"]),
            steps=25,
            head_lr=1e-4,
        )
        tokens_used += int(follow.get("TOKENS_USED") or 0)
        memory.append({"run_id": "WRIM1-UH1-AC2-KL-000010", "continue_of": viable["run_id"], "stage3": follow.get("STAGE3_HISTORICAL"), "token2": follow.get("TOKEN2_CE"), "tokens": follow.get("TOKENS_USED"), "best": follow.get("BEST_EXPERIMENTAL_CHECKPOINT"), "hash": follow.get("BEST_EXPERIMENTAL_HASH"), "abort": follow.get("abort")})

    summary = {
        "VIABLE": viable,
        "FOLLOW": None if follow is None else {"ok": follow.get("ok"), "STAGE3": follow.get("STAGE3_HISTORICAL"), "TOKEN2": follow.get("TOKEN2_CE"), "BEST": follow.get("BEST_EXPERIMENTAL_CHECKPOINT"), "HASH": follow.get("BEST_EXPERIMENTAL_HASH"), "abort": follow.get("abort")},
        "MEMORY": memory,
        "RECOVERY_PROGRAM_TOKENS_USED": tokens_used,
        "RECOVERY_PROGRAM_TOKENS_REMAINING": PROGRAM_BUDGET - tokens_used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + tokens_used,
    }
    Path(DATA_ROOT, "WRIM_GENESIS_RECOVERY_PROGRAM_STATE.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
