"""U4 then U6 10-step probes from Stage3=6 parent after U2 retention wall."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_hvu_identity import DATA_ROOT
from wrim_u_program import MIXES, PARENT, persist_state, slim_run
from wrim_u_train import probe_u_mixes, train_u

CORPUS = next(c for n, c in MIXES if n == "FT60-TT40")
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_SELECTIVE_BODY_ADAPTATION_STATE.json"


def main() -> dict:
    from run000007_vram import start_user_ollama, stop_user_ollama

    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    stop_user_ollama()
    try:
        for stage, run_id, probe_key in (
            ("U4", "WRIM1-UH1-AC2-U-000013", "U4_PROBES"),
            ("U6", "WRIM1-UH1-AC2-U-000014", "U6_PROBES"),
        ):
            if stage not in state.get("UNFREEZE_STAGES_TESTED", []):
                state.setdefault("UNFREEZE_STAGES_TESTED", []).append(stage)
            probes = probe_u_mixes(parent_ckpt=PARENT, stage=stage, mixes=[("FT60-TT40", CORPUS)], restore_ollama=False)
            state[probe_key] = {k: probes.get(k) for k in ("ok", "mask", "vram") if k in probes}
            state[probe_key]["MAX_TOTAL_TRAINABLE_GRAD"] = (probes.get("mixes") or [{}])[0].get("MAX_TOTAL_TRAINABLE_GRAD")
            persist_state(state)
            print(json.dumps({"stage": stage, "probe": state[probe_key]}, default=str), flush=True)
            report_file = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
            if report_file.is_file():
                obj = json.loads(report_file.read_text(encoding="utf-8"))
            else:
                obj = train_u(
                    run_id=run_id,
                    corpus_dir=CORPUS,
                    parent_ckpt=PARENT,
                    pack_name="FT60-TT40",
                    stage=stage,
                    steps=10,
                    head_lr=1e-4,
                    body_lr=5e-6,
                    restore_ollama=False,
                )
            row = slim_run(obj)
            row["note"] = f"{stage}_from_alpha002"
            state.setdefault("MEMORY", []).append(row)
            state["REP_ADAPT_TOKENS_USED"] = int(state.get("REP_ADAPT_TOKENS_USED") or 0) + int(obj.get("TOKENS_USED") or 0)
            persist_state(state)
            print(
                json.dumps(
                    {
                        "run_id": run_id,
                        "ok": obj.get("ok"),
                        "abort": obj.get("abort"),
                        "stage3": obj.get("STAGE3_HISTORICAL"),
                        "token2": obj.get("TOKEN2_CE"),
                        "distance": obj.get("DISTANCE_FINAL"),
                        "trainable": obj.get("TRAINABLE_PARAMETER_COUNT"),
                    },
                    default=str,
                ),
                flush=True,
            )
        state["PROGRAM_STATUS"] = "U1_U2_U4_U6_STAGE3_6_WALL_AND_STAGE3_5_4_WALL"
        persist_state(state)
        return {"ok": True, "tokens": state.get("REP_ADAPT_TOKENS_USED")}
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
