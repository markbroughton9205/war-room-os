"""U2 continuation after U1 hit the Stage3 5→4 retention wall. No promotion."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_u_program import MIXES, PARENT, persist_state, slim_run
from wrim_u_train import probe_u_mixes, train_u

U2_PARENT_MARGIN = PARENT
U2_PARENT_BEST = Path(CKPT_BASE) / "WRIM1-UH1-AC2-U-000007" / "step-5"
CORPUS = next(c for n, c in MIXES if n == "FT60-TT40")
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_SELECTIVE_BODY_ADAPTATION_STATE.json"


def main() -> dict:
    from run000007_vram import start_user_ollama, stop_user_ollama

    state = json.loads(STATE_PATH.read_text(encoding="utf-8")) if STATE_PATH.exists() else {}
    state.setdefault("MEMORY", [])
    state.setdefault("UNFREEZE_STAGES_TESTED", [])
    if "U2" not in state["UNFREEZE_STAGES_TESTED"]:
        state["UNFREEZE_STAGES_TESTED"].append("U2")
    stop_user_ollama()
    try:
        probes = probe_u_mixes(parent_ckpt=U2_PARENT_MARGIN, stage="U2", mixes=[("FT60-TT40", CORPUS)], restore_ollama=False)
        state["U2_PROBES_FROM_A002"] = probes
        persist_state(state)
        print(
            json.dumps(
                {
                    "u2_probe": {
                        "ok": probes.get("ok"),
                        "mixes": [
                            {k: m.get(k) for k in ("pack", "unsafe", "MAX_TOTAL_TRAINABLE_GRAD")}
                            for m in probes.get("mixes") or []
                        ],
                        "mask": probes.get("mask"),
                    }
                },
                default=str,
            ),
            flush=True,
        )

        runs = [
            {"run_id": "WRIM1-UH1-AC2-U-000011", "parent": U2_PARENT_MARGIN, "steps": 10, "note": "U2_from_stage3_6_alpha002"},
            {"run_id": "WRIM1-UH1-AC2-U-000012", "parent": U2_PARENT_BEST, "steps": 10, "note": "U2_from_U1_legal_best_margin"},
        ]
        for i, rec in enumerate(runs):
            report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
            if report_file.is_file():
                obj = json.loads(report_file.read_text(encoding="utf-8"))
            else:
                obj = train_u(
                    run_id=rec["run_id"],
                    corpus_dir=CORPUS,
                    parent_ckpt=rec["parent"],
                    pack_name="FT60-TT40",
                    stage="U2",
                    steps=rec["steps"],
                    head_lr=1e-4,
                    body_lr=5e-6,
                    restore_ollama=False,
                )
            row = slim_run(obj)
            row["note"] = rec["note"]
            state["MEMORY"].append(row)
            state["REP_ADAPT_TOKENS_USED"] = int(state.get("REP_ADAPT_TOKENS_USED") or 0) + int(obj.get("TOKENS_USED") or 0)
            persist_state(state)
            print(json.dumps({"run_id": rec["run_id"], "ok": obj.get("ok"), "abort": obj.get("abort"), "stage3": obj.get("STAGE3_HISTORICAL"), "token2": obj.get("TOKEN2_CE"), "rank": obj.get("TOKEN2_RANK"), "distance": obj.get("DISTANCE_FINAL"), "preflight": obj.get("PREFLIGHT", {}).get("MAX_TOTAL_TRAINABLE_GRAD")}, default=str), flush=True)

        state["PROGRAM_STATUS"] = "U2_PROBED_AFTER_U1_RETENTION_WALL"
        persist_state(state)
        return {"ok": True, "state_tokens": state.get("REP_ADAPT_TOKENS_USED")}
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
