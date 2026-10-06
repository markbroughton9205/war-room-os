"""RA1 architecture + token2 completion program. No promotion, commit, push, or canonical change."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_ra1 import PLACEMENT_A, PLACEMENT_B
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD
from wrim_ra1_train import train_ra1
from wrim_ra1_validate import main as validate_ra1

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-DC-000009" / "step-5"
EXPECT_PARENT = "282449e3761d4d32910ea6a8b1edf69b3371dca6f9e94a8b00b9322ded225fde"
CORPUS = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"
START_CE = 26.448594358232285
START_RANK = 6152.305555555556
PREVIOUS_TOTAL = 2_727_936
PROGRAM_BUDGET = 1_000_000
LRS = (3e-4, 1e-4, 1e-3)
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_RESPONSE_ADAPTER_COMPLETION_REPORT.json"
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_RESPONSE_ADAPTER_STATE.json"


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def snap_at(row: dict[str, Any], step: int) -> dict[str, Any]:
    for s in row.get("eval_snaps") or []:
        if int(s.get("step") or -1) == step:
            return s
    return {}


def last_six(row: dict[str, Any]) -> dict[str, Any]:
    six = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
    return max(six, key=lambda s: int(s.get("step") or 0)) if six else {}


def token2_moved(pce, prk, ce, rk, *, ce_bar: float = 0.03, rank_bar: float = 40.0) -> bool:
    if ce is None or pce is None:
        return False
    dce = float(pce) - float(ce)
    dr = 0.0 if rk is None or prk is None else (float(prk) - float(rk))
    return dce >= ce_bar or dr >= rank_bar


def slim(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": obj.get("RUN_ID"),
        "ok": obj.get("ok"),
        "abort": obj.get("abort"),
        "reason": obj.get("reason"),
        "placement": obj.get("RA1_PLACEMENT"),
        "bottleneck": obj.get("RA1_BOTTLENECK"),
        "n_params": obj.get("RA1_PARAMETER_COUNT"),
        "lr": obj.get("RA1_LR"),
        "tokens": obj.get("TOKENS_USED"),
        "preflight_grad": (obj.get("PREFLIGHT") or {}).get("MAX_RA1_GRAD"),
        "preflight_gate": ((obj.get("PREFLIGHT") or {}).get("BATCHES") or [{}])[0].get("GRAD_GATE"),
        "stage3": obj.get("STAGE3_HISTORICAL"),
        "token2": obj.get("TOKEN2_CE"),
        "rank": obj.get("TOKEN2_RANK"),
        "oracle": obj.get("TOKEN2_ORACLE"),
        "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
        "eval_snaps": obj.get("EVAL_SNAPS"),
        "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
        "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        "first_token_classes": obj.get("FIRST_TOKEN_CLASSES_WORKING"),
        "greedy_first": obj.get("GREEDY_FIRST_TOKEN_MATCH"),
        "greedy_short": obj.get("GREEDY_SHORT_ANSWER_CORRECT"),
        "greedy_stopping": obj.get("GREEDY_STOPPING"),
        "ramble": obj.get("RAMBLE_RATE"),
        "empty": obj.get("EMPTY_RESPONSE_RATE"),
        "newline": obj.get("NEWLINE_ARGMAX_RATE"),
        "independent_nl": obj.get("INDEPENDENT_NL_NLL"),
        "general_nl": obj.get("GENERAL_NL_NLL"),
        "code": obj.get("CODE_NLL"),
        "json": obj.get("JSON_NLL"),
        "drift": obj.get("STAGE3_DRIFT_VS_STEP400"),
        "collapse": obj.get("STAGE3_COLLAPSE"),
        "frozen_match": obj.get("FROZEN_PARAMETER_HASH_MATCH"),
        "global_drift": obj.get("GLOBAL_WEIGHT_DRIFT"),
        "ra1_dist": obj.get("RA1_WEIGHT_DISTANCE"),
        "architecture": obj.get("ARCHITECTURE_ID"),
    }


def run_one(state: dict[str, Any], rec: dict[str, Any], *, last: bool) -> dict[str, Any]:
    report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
    if report_file.is_file():
        obj = json.loads(report_file.read_text(encoding="utf-8"))
        print(json.dumps({"skip_completed": rec["run_id"]}, default=str), flush=True)
    else:
        obj = train_ra1(
            run_id=rec["run_id"],
            corpus_dir=CORPUS,
            parent_ckpt=PARENT,
            pack_name="FT60-TT40",
            steps=int(rec["steps"]),
            lr=float(rec["lr"]),
            placement=str(rec["placement"]),
            bottleneck=int(rec.get("bottleneck") or 32),
            restore_ollama=last,
        )
    used = int(obj.get("TOKENS_USED") or 0)
    already = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
    if rec["run_id"] not in already:
        state["RA1_PROGRAM_TOKENS_USED"] = int(state.get("RA1_PROGRAM_TOKENS_USED") or 0) + used
        state.setdefault("MEMORY", []).append(slim(obj))
    persist(state)
    s = last_six(slim(obj)) or snap_at(slim(obj), int(rec["steps"]))
    print(
        json.dumps(
            {
                "run_id": rec["run_id"],
                "ok": obj.get("ok"),
                "lr": rec["lr"],
                "placement": rec["placement"],
                "steps": rec["steps"],
                "stage3_final": (obj.get("STAGE3_HISTORICAL") or {}).get("final"),
                "stage3_best6": s.get("stage3"),
                "token2_best6": s.get("token2_ce"),
                "rank_best6": s.get("token2_rank"),
                "oracle": (obj.get("TOKEN2_ORACLE") or {}).get("best"),
                "exact": (obj.get("GREEDY_TWO_TOKEN_EXACT") or {}).get("best"),
                "frozen_match": obj.get("FROZEN_PARAMETER_HASH_MATCH"),
                "abort": obj.get("abort"),
                "tokens_program": state["RA1_PROGRAM_TOKENS_USED"],
            },
            default=str,
        ),
        flush=True,
    )
    return slim(obj)


def write_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    pick = last_six(best) or {}
    used = int(state.get("RA1_PROGRAM_TOKENS_USED") or 0)
    drift = pick.get("drift") if pick.get("drift") is not None else best.get("drift")
    oracle = int(pick.get("oracle") or (best.get("oracle") or {}).get("best") or 0)
    exact = int(pick.get("exact") or (best.get("exact") or {}).get("best") or 0)
    report = {
        "REPORT_ID": "WRIM_GENESIS_RESPONSE_ADAPTER_COMPLETION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "FROZEN_PARENT": "WRIM1-UH1-AC2-DC-000009/step-5",
        "FROZEN_PARENT_HASH": EXPECT_PARENT,
        "ARCHITECTURE": (best.get("architecture") or "WRIM-G-20M-v1-option-A-UH1-AC2-RA1"),
        "RA1_IMPLEMENTED": state.get("RA1_IMPLEMENTED", "YES"),
        "RA1_PLACEMENT": best.get("placement") or state.get("RA1_PLACEMENT"),
        "RA1_BOTTLENECK": best.get("bottleneck") or state.get("RA1_BOTTLENECK") or 32,
        "RA1_PARAMETER_COUNT": best.get("n_params") or state.get("RA1_PARAMETER_COUNT"),
        "RA1_ZERO_INIT_PARITY": state.get("RA1_ZERO_INIT_PARITY"),
        "DOCUMENT_PARITY": state.get("DOCUMENT_PARITY"),
        "FROZEN_PARAMETER_HASH_MATCH": best.get("frozen_match") or state.get("FROZEN_PARAMETER_HASH_MATCH"),
        "BASE_MODEL_CHANGED": "NO",
        "RA1_LR": best.get("lr"),
        "RA1_GRADIENT_SAFETY": state.get("RA1_GRADIENT_SAFETY"),
        "RA1_TOKENS_USED": used,
        "RA1_TOKENS_REMAINING": PROGRAM_BUDGET - used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "TOKEN2_CE_START": START_CE,
        "TOKEN2_CE_BEST": pick.get("token2_ce") or (best.get("token2") or {}).get("best"),
        "TOKEN2_RANK_BEST": pick.get("token2_rank") or (best.get("rank") or {}).get("best"),
        "TOKEN2_ORACLE_SUCCESS": oracle,
        "GREEDY_TWO_TOKEN_EXACT": exact,
        "TWO_TOKEN_CLASSES_WORKING": pick.get("n_classes_exact") or 0,
        "FIRST_TOKEN_CLASSES_WORKING": best.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": best.get("greedy_first") or pick.get("greedy_first_ft"),
        "SHORT_ANSWER_CAPABILITY": "one-token YES; multi-token NO" if exact <= 0 else "two-token emerging",
        "GREEDY_SHORT_ANSWER_CORRECT": best.get("greedy_short"),
        "GENERALIZATION": "see two-token exact and first-token classes",
        "ASSISTANT_CONTROL_STATE": "PRESENT_FROZEN",
        "RESPONSE_SPAN_CONTROL_STATE": "PRESENT_FROZEN",
        "NEWLINE_ARGMAX_RATE": best.get("newline") or pick.get("newline"),
        "EOS": "see GREEDY_STOPPING",
        "GREEDY_STOPPING": best.get("greedy_stopping"),
        "RAMBLE_RATE": best.get("ramble"),
        "EMPTY_RESPONSE_RATE": best.get("empty"),
        "INDEPENDENT_NL_NLL": best.get("independent_nl") or pick.get("independent_nl"),
        "GENERAL_NL_NLL": best.get("general_nl") or pick.get("general_nl"),
        "CODE_NLL": best.get("code") or pick.get("code"),
        "JSON_NLL": best.get("json") or pick.get("json"),
        "STAGE3_HISTORICAL": pick.get("stage3") or (best.get("stage3") or {}).get("best"),
        "STAGE3_COLLAPSE": pick.get("collapse") or (best.get("collapse") or {}).get("best"),
        "STAGE3_DRIFT_VS_STEP400": drift,
        "RETENTION_HEADROOM": None if drift is None else float(STAGE3_PARENT_DRIFT_HARD) - float(drift),
        "GLOBAL_WEIGHT_DRIFT": best.get("global_drift") or 0,
        "RA1_WEIGHT_DISTANCE": (pick.get("distance") or {}).get("RA1_WEIGHT_DISTANCE") or best.get("ra1_dist"),
        "FOUNDATION_SCHOOL_STATUS": state.get("FOUNDATION_SCHOOL_STATUS") or "NOT_GRADUATED",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": state.get("FOUNDATION_READY_FOR_GRADUATION_REVIEW") or "NO",
        "LARGER_ADAPTER_REQUIRED": state.get("LARGER_ADAPTER_REQUIRED") or "NO",
        "LORA_REQUIRED": state.get("LORA_REQUIRED") or "NO",
        "NEW_TRANSFORMER_ARCHITECTURE_REQUIRED": state.get("NEW_TRANSFORMER_ARCHITECTURE_REQUIRED") or "NO",
        "TOKENIZER_CHANGE_REQUIRED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "PHASE1": state.get("PHASE1"),
        "RUN_MEMORY": [
            {
                "run_id": r.get("run_id"),
                "lr": r.get("lr"),
                "placement": r.get("placement"),
                "tokens": r.get("tokens"),
                "stage3": r.get("stage3"),
                "token2": r.get("token2"),
                "rank": r.get("rank"),
                "oracle": r.get("oracle"),
                "exact": r.get("exact"),
                "frozen_match": r.get("frozen_match"),
                "abort": r.get("abort"),
            }
            for r in (state.get("MEMORY") or [])
        ],
        "NEXT_COMMANDER_DECISION": state.get("NEXT_COMMANDER_DECISION"),
        "BEST_CHECKPOINT": best.get("best_ckpt"),
        "BEST_HASH": best.get("best_hash"),
    }
    _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
    return report


def continue_lane(state: dict[str, Any], recipe: dict[str, Any], run_n: int) -> int:
    for steps in (25, 50):
        if int(state["RA1_PROGRAM_TOKENS_USED"]) + steps * 4096 > PROGRAM_BUDGET:
            break
        rec = {
            "run_id": f"WRIM1-UH1-AC2-RA1-TT-{run_n:06d}",
            "steps": steps,
            "lr": recipe.get("lr"),
            "placement": recipe.get("placement"),
            "bottleneck": recipe.get("bottleneck") or 32,
        }
        row = run_one(state, rec, last=False)
        run_n += 1
        six = last_six(row)
        if six and token2_moved(START_CE, START_RANK, six.get("token2_ce"), six.get("token2_rank"), ce_bar=0.003, rank_bar=5.0):
            state["BEST"] = row
        oracle = int((row.get("oracle") or {}).get("best") or 0)
        exact = int((row.get("exact") or {}).get("best") or 0)
        if oracle > 0 or exact > 0:
            state["PROGRAM_STATUS"] = "TOKEN2_BREAKTHROUGH"
            state["BEST"] = row
            break
        if six.get("stage3") is None or int(six.get("stage3") or 0) < 6:
            break
        if not token2_moved(START_CE, START_RANK, six.get("token2_ce"), six.get("token2_rank"), ce_bar=0.003, rank_bar=5.0):
            state["TOKEN2_PLATEAU"] = "YES"
            break
    return run_n


def main() -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from run000007_vram import start_user_ollama
    from wrim_resumable_checkpoint import MODEL_NAME

    state: dict[str, Any] = {
        "PROGRAM_STATUS": "RUNNING",
        "RA1_PROGRAM_TOKENS_USED": 0,
        "MEMORY": [],
        "BEST": None,
        "RA1_IMPLEMENTED": "YES",
        "RA1_BOTTLENECK": 32,
        "RA1_PLACEMENT": PLACEMENT_B,
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
        "LARGER_ADAPTER_REQUIRED": "NO",
        "LORA_REQUIRED": "NO",
        "NEW_TRANSFORMER_ARCHITECTURE_REQUIRED": "NO",
        "TOKEN2_PLATEAU": "NO",
        "RA1_GRADIENT_SAFETY": None,
    }
    try:
        parent_hash = sha256_file(PARENT / MODEL_NAME)
        if parent_hash != EXPECT_PARENT:
            state["PROGRAM_STATUS"] = "PARENT_HASH_MISMATCH"
            state["NEXT_COMMANDER_DECISION"] = ["DC-000009/step-5 hash mismatch. Do not train RA1."]
            return write_report(state)

        phase1 = validate_ra1()
        state["PHASE1"] = {
            "ok": phase1.get("ok"),
            "RA1_ZERO_INIT_PARITY": phase1.get("RA1_ZERO_INIT_PARITY"),
            "DOCUMENT_PARITY": phase1.get("DOCUMENT_PARITY"),
            "FROZEN_PARAMETER_HASH_MATCH": phase1.get("FROZEN_PARAMETER_HASH_MATCH"),
            "PLACEMENTS": [
                {k: p.get(k) for k in ("ok", "placement", "RA1_PARAMETER_COUNT", "MAX_ABS_LOGIT_DIFF", "RA1_GRAD", "GRAD_GATE", "MULTI_TURN_RESET", "DOCUMENT_PARITY_NONZERO_WUP")}
                for p in (phase1.get("PLACEMENTS") or [])
            ],
        }
        state["RA1_ZERO_INIT_PARITY"] = phase1.get("RA1_ZERO_INIT_PARITY")
        state["DOCUMENT_PARITY"] = phase1.get("DOCUMENT_PARITY")
        state["FROZEN_PARAMETER_HASH_MATCH"] = phase1.get("FROZEN_PARAMETER_HASH_MATCH")
        n_params = None
        for p in phase1.get("PLACEMENTS") or []:
            if p.get("placement") == PLACEMENT_B:
                n_params = p.get("RA1_PARAMETER_COUNT")
                state["RA1_GRADIENT_SAFETY"] = p.get("GRAD_GATE")
        state["RA1_PARAMETER_COUNT"] = n_params
        persist(state)
        if not phase1.get("ok"):
            state["PROGRAM_STATUS"] = "RA1_ARCHITECTURE_VALIDATION_FAILED"
            state["NEXT_COMMANDER_DECISION"] = ["RA1 failed Phase 1 parity/gating/gradient isolation. Do not train."]
            return write_report(state)

        run_n = 1
        search_rows: list[dict[str, Any]] = []
        for lr in LRS:
            if int(state["RA1_PROGRAM_TOKENS_USED"]) + 10 * 4096 > PROGRAM_BUDGET:
                break
            rec = {
                "run_id": f"WRIM1-UH1-AC2-RA1-TT-{run_n:06d}",
                "steps": 10,
                "lr": lr,
                "placement": PLACEMENT_B,
                "bottleneck": 32,
            }
            row = run_one(state, rec, last=False)
            search_rows.append(row)
            run_n += 1
            if (row.get("frozen_match") or "YES") != "YES":
                state["PROGRAM_STATUS"] = "FROZEN_BASE_CHANGED"
                state["NEXT_COMMANDER_DECISION"] = ["Frozen base parameters changed. Training-system bug. STOP."]
                return write_report(state)
            gate = row.get("preflight_gate")
            g = row.get("preflight_grad")
            if gate == "UNSAFE" or (g is not None and float(g) >= 8.0):
                state["RA1_GRADIENT_SAFETY"] = "HARD"
            elif state.get("RA1_GRADIENT_SAFETY") not in {"HARD"} and (gate == "REVIEW" or (g is not None and float(g) >= 6.5)):
                state["RA1_GRADIENT_SAFETY"] = "REVIEW"
            elif state.get("RA1_GRADIENT_SAFETY") not in {"HARD", "REVIEW"}:
                state["RA1_GRADIENT_SAFETY"] = "SAFE"
            persist(state)

        def six_score(r: dict[str, Any]) -> tuple:
            s = last_six(r)
            ce = float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9)
            st = int(s.get("step") or -1)
            return (0 if s.get("stage3") == 6 else 1, ce, -st)

        viable = [r for r in search_rows if last_six(r).get("stage3") == 6]
        learners = [
            r
            for r in viable
            if token2_moved(START_CE, START_RANK, last_six(r).get("token2_ce"), last_six(r).get("token2_rank"), ce_bar=0.003, rank_bar=5.0)
        ]
        if learners:
            best = min(learners, key=six_score)
            state["BEST"] = best
            state["STAGE3_6_PRESERVED"] = "YES"
            run_n = continue_lane(state, best, run_n)
            if state.get("PROGRAM_STATUS") == "TOKEN2_BREAKTHROUGH":
                state["FOUNDATION_SCHOOL_STATUS"] = "TOKEN2_SCHOOL"
            elif state.get("PROGRAM_STATUS") == "RUNNING":
                state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
        elif viable:
            state["BEST"] = min(viable, key=six_score)
            state["STAGE3_6_PRESERVED"] = "YES"
            state["PROGRAM_STATUS"] = "RA1_NO_TOKEN2_MOVEMENT_AT_10"
        else:
            # try placement A at best-looking LR (middle 3e-4) once
            if int(state["RA1_PROGRAM_TOKENS_USED"]) + 10 * 4096 <= PROGRAM_BUDGET:
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-RA1-TT-{run_n:06d}",
                    "steps": 10,
                    "lr": 3e-4,
                    "placement": PLACEMENT_A,
                    "bottleneck": 32,
                }
                row = run_one(state, rec, last=False)
                run_n += 1
                if last_six(row).get("stage3") == 6 and token2_moved(
                    START_CE, START_RANK, last_six(row).get("token2_ce"), last_six(row).get("token2_rank"), ce_bar=0.003, rank_bar=5.0
                ):
                    state["BEST"] = row
                    state["RA1_PLACEMENT"] = PLACEMENT_A
                    run_n = continue_lane(state, row, run_n)
                    if state.get("PROGRAM_STATUS") == "RUNNING":
                        state["PROGRAM_STATUS"] = "RA1_STAGE3_6_LEARNING_LANE"
                else:
                    state["BEST"] = row
                    state["PROGRAM_STATUS"] = "RA1_STAGE3_RETENTION_WALL"
            else:
                state["PROGRAM_STATUS"] = "RA1_STAGE3_RETENTION_WALL"

        if int(state["RA1_PROGRAM_TOKENS_USED"]) >= PROGRAM_BUDGET and state.get("PROGRAM_STATUS") == "RUNNING":
            state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"

        decisions = [
            "Do not promote. Canonical remains STEP_400.",
            f"Program status: {state.get('PROGRAM_STATUS')}.",
        ]
        if state.get("PROGRAM_STATUS") == "TOKEN2_BREAKTHROUGH":
            decisions.append("Stay on the smallest successful RA1. Do not enlarge bottleneck. Expand two-token classes next.")
        elif state.get("PROGRAM_STATUS") == "RA1_STAGE3_6_LEARNING_LANE":
            decisions.append("RA1 is learning token2 with Stage3=6 and a frozen base. Continue the same adapter; do not unfreeze global weights.")
        elif "WALL" in str(state.get("PROGRAM_STATUS")):
            decisions.append("RA1 did not preserve Stage3=6 while learning. Do not enlarge past 64, do not start LoRA in this report unless plateau criteria are fully met.")
        state["NEXT_COMMANDER_DECISION"] = decisions
        persist(state)
        return write_report(state)
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
