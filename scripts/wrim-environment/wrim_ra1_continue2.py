"""Continue RA1 B32 from 000006/step-25. Warm-start, frozen base, no promotion."""
from __future__ import annotations

import json
from pathlib import Path

from wrim_g20m_ra1 import PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, TOKENS_PER_STEP
from wrim_ra1_program import (
    CORPUS,
    PROGRAM_BUDGET,
    persist,
    slim,
    token2_moved,
    write_report,
)
from wrim_ra1_train import train_ra1

STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_RESPONSE_ADAPTER_STATE.json"
START = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-TT-000008" / "step-50"
START_N = 10
CHUNK_STEPS = 50
LR = 3e-4
FALLBACK_LR = 1e-4


def _ckpt(rel: str | None, fallback: Path) -> Path:
    if not rel:
        return fallback
    p = Path(CKPT_BASE) / rel
    if (p / "model.safetensors").is_file() or p.is_file():
        return p
    return fallback


def _six_best(row: dict) -> dict:
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
    if not snaps:
        return {}
    return min(
        snaps,
        key=lambda s: (
            float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9),
            float(s.get("token2_rank") if s.get("token2_rank") is not None else 1e12),
            -int(s.get("step") or 0),
        ),
    )


def _classes_exact(row: dict) -> int:
    snap = _six_best(row)
    n = snap.get("n_classes_exact")
    if n is not None:
        return int(n)
    return 0


def main() -> dict:
    from run000007_vram import start_user_ollama

    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    parent = START
    lr = LR
    used_fallback = False
    try:
        for i in range(6):
            used = int(state.get("RA1_PROGRAM_TOKENS_USED") or 0)
            remaining_steps = max(0, (PROGRAM_BUDGET - used) // TOKENS_PER_STEP)
            steps = min(CHUNK_STEPS, remaining_steps)
            if steps < 5:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
                break
            run_id = f"WRIM1-UH1-AC2-RA1-TT-{START_N + i:06d}"
            print(json.dumps({"starting": run_id, "parent": str(parent), "lr": lr, "steps": steps, "tokens_used": used}, default=str), flush=True)
            report_file = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
            if report_file.is_file():
                obj = json.loads(report_file.read_text(encoding="utf-8"))
            else:
                obj = train_ra1(
                    run_id=run_id,
                    corpus_dir=CORPUS,
                    parent_ckpt=parent,
                    pack_name="FT60-TT40",
                    steps=steps,
                    lr=lr,
                    placement=PLACEMENT_B,
                    bottleneck=32,
                    restore_ollama=False,
                    reset_adapter=False,
                )
            tok = int(obj.get("TOKENS_USED") or 0)
            already = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
            if run_id not in already:
                state["RA1_PROGRAM_TOKENS_USED"] = used + tok
                state.setdefault("MEMORY", []).append(slim(obj))
            row = slim(obj)
            six = _six_best(row)
            oracle = int((obj.get("TOKEN2_ORACLE") or {}).get("best") or 0)
            exact = int((obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("best") or 0)
            frozen = obj.get("FROZEN_PARAMETER_HASH_MATCH")
            abort = obj.get("abort")
            print(
                json.dumps(
                    {
                        "run_id": run_id,
                        "ok": obj.get("ok"),
                        "token2": obj.get("TOKEN2_CE"),
                        "rank": obj.get("TOKEN2_RANK"),
                        "stage3": obj.get("STAGE3_HISTORICAL"),
                        "oracle": obj.get("TOKEN2_ORACLE"),
                        "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
                        "classes_exact": _classes_exact(row),
                        "abort": abort,
                        "frozen": frozen,
                        "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
                    },
                    default=str,
                ),
                flush=True,
            )
            if frozen != "YES":
                state["PROGRAM_STATUS"] = "FROZEN_BASE_CHANGED"
                state["NEXT_COMMANDER_DECISION"] = ["Frozen base parameters changed. Training-system bug. STOP."]
                persist(state)
                return write_report(state)
            if six:
                state["BEST"] = row
                parent = _ckpt(obj.get("BEST_EXPERIMENTAL_CHECKPOINT"), parent)
            if abort and str((abort or {}).get("stop_reason") or "") == "GRAD_INSTABILITY":
                state["RA1_GRADIENT_SAFETY"] = "HARD"
                if not used_fallback and six:
                    lr = FALLBACK_LR
                    used_fallback = True
                    state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
                    persist(state)
                    continue
                state["PROGRAM_STATUS"] = "RA1_GRADIENT_UNSAFE"
                persist(state)
                break
            state["RA1_GRADIENT_SAFETY"] = "SAFE"
            if six.get("stage3") is None or int(six.get("stage3") or 0) < 6:
                state["PROGRAM_STATUS"] = "RA1_STAGE3_RETENTION_WALL"
                persist(state)
                break
            if oracle > 0 or exact > 0:
                state["PROGRAM_STATUS"] = "TOKEN2_BREAKTHROUGH"
                state["FOUNDATION_SCHOOL_STATUS"] = "TOKEN2_SCHOOL"
                persist(state)
                n_cls = _classes_exact(row)
                if n_cls >= 2:
                    break
                # Phase 4: stay on B32 until two semantic classes, if budget remains.
                continue
            pce = (obj.get("TOKEN2_CE") or {}).get("parent")
            prk = (obj.get("TOKEN2_RANK") or {}).get("parent")
            if not token2_moved(pce, prk, six.get("token2_ce"), six.get("token2_rank"), ce_bar=0.01, rank_bar=5.0):
                if not used_fallback:
                    lr = FALLBACK_LR
                    used_fallback = True
                    state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
                    persist(state)
                    continue
                state["TOKEN2_PLATEAU"] = "YES"
                state["PROGRAM_STATUS"] = "RA1_B32_PLATEAU"
                persist(state)
                break
            state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
            persist(state)
        if state.get("PROGRAM_STATUS") not in {
            "TOKEN2_BREAKTHROUGH",
            "RA1_STAGE3_RETENTION_WALL",
            "FROZEN_BASE_CHANGED",
            "RA1_GRADIENT_UNSAFE",
            "TOKEN_BUDGET_EXHAUSTED",
            "RA1_B32_PLATEAU",
        }:
            state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
        state["NEXT_COMMANDER_DECISION"] = [
            "Do not promote. Canonical remains STEP_400.",
            f"Program status: {state.get('PROGRAM_STATUS')}.",
            "RA1 B32 pre_lm_head remains the legal token2 lane. Frozen base unchanged. Do not enlarge bottleneck while 32 still learns.",
        ]
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


if __name__ == "__main__":
    import json as _json

    print(_json.dumps(main(), indent=2, default=str))
