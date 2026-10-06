"""Continue RA1 from the legal 1e-3 step-15 wall at a safer LR. No promotion."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_ra1_program import (
    CORPUS,
    PROGRAM_BUDGET,
    persist,
    slim,
    write_report,
)
from wrim_ra1_train import train_ra1

WARM = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-TT-000004" / "step-15"
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_RESPONSE_ADAPTER_STATE.json"


def main() -> dict:
    from run000007_vram import start_user_ollama

    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    try:
        recs = [
            {"run_id": "WRIM1-UH1-AC2-RA1-TT-000006", "steps": 25, "lr": 3e-4, "parent": WARM},
        ]
        for rec in recs:
            if int(state.get("RA1_PROGRAM_TOKENS_USED") or 0) + rec["steps"] * 4096 > PROGRAM_BUDGET:
                break
            report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
            if report_file.is_file():
                obj = json.loads(report_file.read_text(encoding="utf-8"))
            else:
                obj = train_ra1(
                    run_id=rec["run_id"],
                    corpus_dir=CORPUS,
                    parent_ckpt=rec["parent"],
                    pack_name="FT60-TT40",
                    steps=rec["steps"],
                    lr=rec["lr"],
                    placement=PLACEMENT_B,
                    bottleneck=32,
                    restore_ollama=False,
                    reset_adapter=False,
                )
            used = int(obj.get("TOKENS_USED") or 0)
            already = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
            if rec["run_id"] not in already:
                state["RA1_PROGRAM_TOKENS_USED"] = int(state.get("RA1_PROGRAM_TOKENS_USED") or 0) + used
                state.setdefault("MEMORY", []).append(slim(obj))
            print(json.dumps({"run_id": rec["run_id"], "ok": obj.get("ok"), "token2": obj.get("TOKEN2_CE"), "stage3": obj.get("STAGE3_HISTORICAL"), "oracle": obj.get("TOKEN2_ORACLE"), "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"), "abort": obj.get("abort"), "frozen": obj.get("FROZEN_PARAMETER_HASH_MATCH")}, default=str), flush=True)
            snaps = obj.get("EVAL_SNAPS") or []
            six = [s for s in snaps if s.get("stage3") is not None and int(s["stage3"]) >= 6]
            if six:
                pick = min(six, key=lambda s: float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9))
                row = slim(obj)
                state["BEST"] = row
            oracle = int((obj.get("TOKEN2_ORACLE") or {}).get("best") or 0)
            exact = int((obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("best") or 0)
            if oracle > 0 or exact > 0:
                state["PROGRAM_STATUS"] = "TOKEN2_BREAKTHROUGH"
                persist(state)
                return write_report(state)
            persist(state)
        if state.get("PROGRAM_STATUS") not in {"TOKEN2_BREAKTHROUGH"}:
            state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
        state["NEXT_COMMANDER_DECISION"] = [
            "Do not promote. Canonical remains STEP_400.",
            f"Program status: {state.get('PROGRAM_STATUS')}.",
            "RA1 B32 pre_lm_head is the legal token2 lane. Frozen base unchanged. Do not enlarge bottleneck while 32 still learns.",
        ]
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


if __name__ == "__main__":
    import json as _json
    print(_json.dumps(main(), indent=2, default=str))
