"""Continue remaining Stage3=6 U1 recipes after the 8-point grid. No promotion."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_dc_program import (
    CORPUS,
    PARENT,
    PROGRAM_BUDGET,
    persist,
    run_one,
    write_report,
)
from wrim_hvu_identity import DATA_ROOT

STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_HEAD_BODY_DECOUPLING_STATE.json"


def main() -> dict:
    from run000007_vram import start_user_ollama

    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    try:
        rec = {
            "run_id": "WRIM1-UH1-AC2-DC-000010",
            "parent": PARENT,
            "stage": "U1",
            "steps": 10,
            "head_lr": 1e-5,
            "body_lr": 1e-5,
        }
        if int(state.get("DECOUPLING_PROGRAM_TOKENS_USED") or 0) + 10 * 4096 <= PROGRAM_BUDGET:
            row = run_one(state, rec, last=False)
            six = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
            if six:
                last_six = max(six, key=lambda s: int(s["step"]))
                body_best = state.get("BEST") or {}
                body_six = [
                    s
                    for s in (body_best.get("eval_snaps") or [])
                    if s.get("stage3") is not None and int(s["stage3"]) >= 6
                ]
                body_pick = max(body_six, key=lambda s: int(s.get("step") or 0)) if body_six else {}
                body_ce = float(body_pick.get("token2_ce") or 1e9)
                cand_ce = float(last_six.get("token2_ce") or 1e9)
                if cand_ce < body_ce - 1e-6:
                    state["BEST"] = row
        state["PROGRAM_STATUS"] = "U1_STAGE3_6_LEARNING_LANE"
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
