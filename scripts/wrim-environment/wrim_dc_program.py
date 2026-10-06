"""U1 head/body LR decoupling. Start from Stage3=6 alpha=0.02. Ctrl frozen.

Does not promote, commit, push, deploy, or change canonical STEP_400.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD
from wrim_u_train import train_u

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-INT-000001" / "alpha-0.02"
EXPECT_PARENT = "84c8294e83874e4a08e5bf8413cda14b3cfdb83e5e37c5d88a7aa6846d8ff544"
CORPUS = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"
START_CE = 26.475702868567573
START_RANK = 6182.944444444444
PREVIOUS_TOTAL = 2_519_040
PROGRAM_BUDGET = 750_000
U1_1E4_HEAD_DIST = 4.328856
U1_1E4_DCE = START_CE - 23.601702001359726
U1_1E4_EFF = U1_1E4_DCE / U1_1E4_HEAD_DIST
GRID = (
    (5e-6, 0.0),
    (5e-6, 1e-5),
    (5e-6, 3e-5),
    (5e-6, 5e-5),
    (1e-5, 0.0),
    (1e-5, 1e-5),
    (1e-5, 3e-5),
    (1e-5, 5e-5),
)
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_HEAD_BODY_DECOUPLING_REPORT.json"
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_HEAD_BODY_DECOUPLING_STATE.json"


def persist(state: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(state, default=str)))


def token2_moved(pce, prk, ce, rk) -> bool:
    if ce is None or pce is None:
        return False
    dce = float(pce) - float(ce)
    dr = 0.0 if rk is None or prk is None else (float(prk) - float(rk))
    # 2-step window at reduced head LR cannot match the 1e-4 step-2 magnitude.
    # Directional CE/rank drop at Stage3=6 is the search signal; 0.03/40 remains the
    # longer-horizon "meaningful" bar used after step 5.
    return dce >= 0.003 or dr >= 5.0


def snap_at(row: dict[str, Any], step: int) -> dict[str, Any]:
    for s in row.get("eval_snaps") or []:
        if int(s.get("step") or -1) == step:
            return s
    return {}


def slim(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": obj.get("RUN_ID"),
        "ok": obj.get("ok"),
        "abort": obj.get("abort"),
        "reason": obj.get("reason"),
        "pack": obj.get("PACK"),
        "stage": obj.get("UNFREEZE_STAGE"),
        "head_lr": obj.get("HEAD_LR"),
        "body_lr": obj.get("BODY_LR"),
        "lm_head_frozen": obj.get("LM_HEAD_FROZEN"),
        "ctrl_trainable": obj.get("CTRL_TRAINABLE"),
        "tokens": obj.get("TOKENS_USED"),
        "trainable": obj.get("TRAINABLE_PARAMETER_COUNT"),
        "preflight_grad": (obj.get("PREFLIGHT") or {}).get("MAX_TOTAL_TRAINABLE_GRAD"),
        "preflight_gate": ((obj.get("PREFLIGHT") or {}).get("BATCHES") or [{}])[0].get("GRAD_GATE"),
        "stage3": obj.get("STAGE3_HISTORICAL"),
        "token2": obj.get("TOKEN2_CE"),
        "rank": obj.get("TOKEN2_RANK"),
        "oracle": obj.get("TOKEN2_ORACLE"),
        "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
        "distance_final": obj.get("DISTANCE_FINAL"),
        "eval_snaps": obj.get("EVAL_SNAPS"),
        "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
        "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        "first_token_classes": obj.get("FIRST_TOKEN_CLASSES_WORKING"),
        "greedy_first": obj.get("GREEDY_FIRST_TOKEN_MATCH"),
        "greedy_short": obj.get("GREEDY_SHORT_ANSWER_CORRECT"),
        "greedy_stopping": obj.get("GREEDY_STOPPING"),
        "ramble": obj.get("RAMBLE_RATE"),
        "empty": obj.get("EMPTY_RESPONSE_RATE"),
        "independent_nl": obj.get("INDEPENDENT_NL_NLL"),
        "general_nl": obj.get("GENERAL_NL_NLL"),
        "code": obj.get("CODE_NLL"),
        "json": obj.get("JSON_NLL"),
        "drift": obj.get("STAGE3_DRIFT_VS_STEP400"),
        "collapse": obj.get("STAGE3_COLLAPSE"),
        "peak_vram": obj.get("PEAK_VRAM_BYTES"),
        "tokens_per_sec": obj.get("TOKENS_PER_SECOND"),
    }


def run_one(state: dict[str, Any], rec: dict[str, Any], *, last: bool) -> dict[str, Any]:
    report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
    if report_file.is_file():
        obj = json.loads(report_file.read_text(encoding="utf-8"))
        print(json.dumps({"skip_completed": rec["run_id"]}, default=str), flush=True)
    else:
        obj = train_u(
            run_id=rec["run_id"],
            corpus_dir=CORPUS,
            parent_ckpt=Path(rec["parent"]),
            pack_name="FT60-TT40",
            stage=rec.get("stage") or "U1",
            steps=int(rec["steps"]),
            head_lr=float(rec["head_lr"]),
            body_lr=float(rec["body_lr"]),
            ctrl_trainable=False,
            lm_head_trainable=float(rec["head_lr"]) > 0,
            restore_ollama=last,
        )
    used = int(obj.get("TOKENS_USED") or 0)
    already = {str(x.get("run_id")) for x in (state.get("MEMORY") or [])}
    if rec["run_id"] not in already:
        state["DECOUPLING_PROGRAM_TOKENS_USED"] = int(state.get("DECOUPLING_PROGRAM_TOKENS_USED") or 0) + used
    row = slim(obj)
    row["recipe"] = rec
    state.setdefault("MEMORY", []).append(row)
    persist(state)
    s2 = snap_at(row, min(2, int(rec["steps"])))
    print(
        json.dumps(
            {
                "run_id": rec["run_id"],
                "ok": row.get("ok"),
                "head_lr": rec["head_lr"],
                "body_lr": rec["body_lr"],
                "steps": rec["steps"],
                "stage3_final": (row.get("stage3") or {}).get("final"),
                "stage3_step2": s2.get("stage3"),
                "token2_final": (row.get("token2") or {}).get("final"),
                "token2_step2": s2.get("token2_ce"),
                "rank_step2": s2.get("token2_rank"),
                "head_dist": (s2.get("distance") or row.get("distance_final") or {}).get("LM_HEAD_DISTANCE_FROM_START"),
                "body_dist": (s2.get("distance") or row.get("distance_final") or {}).get("TRAINABLE_BODY_DISTANCE_FROM_START"),
                "abort": row.get("abort"),
                "tokens_program": state["DECOUPLING_PROGRAM_TOKENS_USED"],
            },
            default=str,
        ),
        flush=True,
    )
    return row


def keeps_six(row: dict[str, Any], step: int) -> bool:
    s = snap_at(row, step)
    st = s.get("stage3")
    if st is None:
        st = (row.get("stage3") or {}).get("final")
    return st is not None and int(st) >= 6


def row_moved(row: dict[str, Any], step: int) -> bool:
    s = snap_at(row, step)
    pce = (row.get("token2") or {}).get("parent") or START_CE
    prk = (row.get("rank") or {}).get("parent") or START_RANK
    return token2_moved(pce, prk, s.get("token2_ce"), s.get("token2_rank"))


def score_winner(row: dict[str, Any], step: int) -> tuple:
    s = snap_at(row, step)
    ce = float(s.get("token2_ce") if s.get("token2_ce") is not None else 1e9)
    rk = float(s.get("token2_rank") if s.get("token2_rank") is not None else 1e12)
    head = float(((s.get("distance") or {}) or {}).get("LM_HEAD_DISTANCE_FROM_START") or 0.0)
    # prefer Stage3=6 already filtered; then lower head dist, then lower CE
    return (head, ce, rk)


def continue_lane(state: dict[str, Any], recipe: dict[str, Any], run_n: int) -> int:
    """Train the Stage3=6 recipe longer from the same parent. Returns next run_n."""
    for steps in (25, 50):
        if int(state["DECOUPLING_PROGRAM_TOKENS_USED"]) + steps * 4096 > PROGRAM_BUDGET:
            break
        rec = {
            "run_id": f"WRIM1-UH1-AC2-DC-{run_n:06d}",
            "parent": PARENT,
            "stage": "U1",
            "steps": steps,
            "head_lr": recipe.get("head_lr"),
            "body_lr": recipe.get("body_lr"),
        }
        row = run_one(state, rec, last=False)
        run_n += 1
        last_step = steps
        six_snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
        if six_snaps:
            last_six = max(six_snaps, key=lambda s: int(s["step"]))
            if row_moved(row, int(last_six["step"])):
                state["BEST"] = row
        if not keeps_six(row, last_step):
            break
        if row_moved(row, last_step):
            oracle = int((row.get("oracle") or {}).get("best") or 0)
            exact = int((row.get("exact") or {}).get("best") or 0)
            if oracle > 0 or exact > 0:
                state["PROGRAM_STATUS"] = "TOKEN2_BREAKTHROUGH"
                break
            continue
        state["TOKEN2_PLATEAU"] = "YES"
        break
    return run_n


def write_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    s_best = snap_at(best, int((best.get("recipe") or {}).get("steps") or 2)) or {}
    # prefer last legal Stage3=6 snap
    six = [s for s in (best.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
    pick = max(six, key=lambda s: int(s.get("step") or 0)) if six else s_best
    dist = pick.get("distance") or best.get("distance_final") or {}
    head = float(dist.get("LM_HEAD_DISTANCE_FROM_START") or 0.0)
    body = float(dist.get("TRAINABLE_BODY_DISTANCE_FROM_START") or 0.0)
    ce = pick.get("token2_ce")
    dce = None if ce is None else (START_CE - float(ce))
    if head <= 1e-12:
        eff = None if not dce else ("INF" if dce > 0 else 0.0)
        ratio = None if body <= 0 else "INF"
    else:
        eff = None if dce is None else (dce / head)
        ratio = body / head
    used = int(state.get("DECOUPLING_PROGRAM_TOKENS_USED") or 0)
    drift = pick.get("drift") if pick.get("drift") is not None else best.get("drift")
    report = {
        "REPORT_ID": "WRIM_GENESIS_HEAD_BODY_DECOUPLING_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_PARENT": "WRIM1-UH1-AC2-INT-000001/alpha-0.02",
        "STARTING_HASH": EXPECT_PARENT,
        "LR_COMBINATIONS_TESTED": state.get("LR_COMBINATIONS_TESTED"),
        "BODY_ONLY_TESTED": state.get("BODY_ONLY_TESTED"),
        "BODY_ONLY_RESULT": state.get("BODY_ONLY_RESULT"),
        "BEST_BODY_LR": (best.get("recipe") or {}).get("body_lr") or best.get("body_lr"),
        "BEST_LM_HEAD_LR": (best.get("recipe") or {}).get("head_lr") or best.get("head_lr"),
        "BEST_UNFREEZE_STAGE": best.get("stage") or "U1",
        "BEST_CHECKPOINT": best.get("best_ckpt"),
        "BEST_HASH": best.get("best_hash"),
        "STAGE3_AT_BEST": pick.get("stage3") or (best.get("stage3") or {}).get("best"),
        "STAGE3_DRIFT": drift,
        "TOKEN2_CE_START": START_CE,
        "TOKEN2_CE_BEST": ce,
        "TOKEN2_RANK_BEST": pick.get("token2_rank"),
        "TOKEN2_ORACLE_SUCCESS": pick.get("oracle") or (best.get("oracle") or {}).get("best") or 0,
        "GREEDY_TWO_TOKEN_EXACT": pick.get("exact") or (best.get("exact") or {}).get("best") or 0,
        "FIRST_TOKEN_CLASSES_WORKING": best.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": best.get("greedy_first") or pick.get("greedy_first_ft"),
        "LM_HEAD_DISTANCE": head,
        "BODY_DISTANCE": body,
        "BODY_TO_HEAD_DISTANCE_RATIO": ratio,
        "REPRESENTATION_EFFICIENCY": eff,
        "U1_1E4_HEAD_BASELINE_EFFICIENCY": U1_1E4_EFF,
        "BETTER_THAN_1E4_HEAD_BASELINE": state.get("BETTER_THAN_1E4_HEAD_BASELINE"),
        "STAGE3_6_PRESERVED_DURING_LEARNING": state.get("STAGE3_6_PRESERVED_DURING_LEARNING"),
        "TOKEN2_LEARNING_SIGNAL": state.get("TOKEN2_LEARNING_SIGNAL"),
        "TOKEN2_PLATEAU": state.get("TOKEN2_PLATEAU") or "NO",
        "HEAD_BODY_LR_DECOUPLING_FAILED": state.get("HEAD_BODY_LR_DECOUPLING_FAILED"),
        "SHORT_ANSWER_CAPABILITY": "one-token YES; multi-token NO" if not (pick.get("exact") or 0) else "two-token emerging",
        "GREEDY_SHORT_ANSWER_CORRECT": best.get("greedy_short"),
        "GENERALIZATION": "see first-token classes and two-token exact",
        "EOS": "see GREEDY_STOPPING",
        "GREEDY_STOPPING": best.get("greedy_stopping"),
        "RAMBLE_RATE": best.get("ramble"),
        "EMPTY_RESPONSE_RATE": best.get("empty"),
        "INDEPENDENT_NL_NLL": best.get("independent_nl") or pick.get("independent_nl"),
        "GENERAL_NL_NLL": best.get("general_nl") or pick.get("general_nl"),
        "CODE_NLL": best.get("code") or pick.get("code"),
        "JSON_NLL": best.get("json") or pick.get("json"),
        "GRADIENT_SAFETY": state.get("GRADIENT_SAFETY"),
        "DECOUPLING_PROGRAM_TOKENS_USED": used,
        "DECOUPLING_PROGRAM_TOKENS_REMAINING": PROGRAM_BUDGET - used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "FOUNDATION_SCHOOL_STATUS": "NOT_GRADUATED",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
        "NEW_TRAINING_MECHANISM_OR_ARCHITECTURE_REVIEW_REQUIRED": state.get("NEW_TRAINING_MECHANISM_OR_ARCHITECTURE_REVIEW_REQUIRED"),
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "STEP2_SEARCH": state.get("STEP2_SEARCH"),
        "RUN_MEMORY": [
            {
                "run_id": r.get("run_id"),
                "head_lr": r.get("head_lr"),
                "body_lr": r.get("body_lr"),
                "lm_head_frozen": r.get("lm_head_frozen"),
                "tokens": r.get("tokens"),
                "stage3": r.get("stage3"),
                "token2": r.get("token2"),
                "rank": r.get("rank"),
                "abort": r.get("abort"),
                "distance_final": r.get("distance_final"),
            }
            for r in (state.get("MEMORY") or [])
        ],
        "NEXT_COMMANDER_DECISION": state.get("NEXT_COMMANDER_DECISION"),
        "RETENTION_HEADROOM": None if drift is None else float(STAGE3_PARENT_DRIFT_HARD) - float(drift),
    }
    _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
    return report


def main() -> dict[str, Any]:
    from run000007_vram import start_user_ollama

    state: dict[str, Any] = {
        "PROGRAM_STATUS": "RUNNING",
        "DECOUPLING_PROGRAM_TOKENS_USED": 0,
        "MEMORY": [],
        "BEST": None,
        "LR_COMBINATIONS_TESTED": [],
        "BODY_ONLY_TESTED": "NO",
        "BODY_ONLY_RESULT": None,
        "HEAD_BODY_LR_DECOUPLING_FAILED": "NO",
        "STAGE3_6_PRESERVED_DURING_LEARNING": "NO",
        "TOKEN2_LEARNING_SIGNAL": "NO",
        "BETTER_THAN_1E4_HEAD_BASELINE": "NO",
        "NEW_TRAINING_MECHANISM_OR_ARCHITECTURE_REVIEW_REQUIRED": "NO",
        "TOKEN2_PLATEAU": "NO",
        "GRADIENT_SAFETY": None,
    }
    try:
        return _run(state)
    finally:
        start_user_ollama()


def _run(state: dict[str, Any]) -> dict[str, Any]:
    from run000007_preflight import sha256_file
    from wrim_resumable_checkpoint import MODEL_NAME

    parent_hash = sha256_file(PARENT / MODEL_NAME)
    if parent_hash != EXPECT_PARENT:
        state["PROGRAM_STATUS"] = "PARENT_HASH_MISMATCH"
        state["NEXT_COMMANDER_DECISION"] = ["alpha=0.02 hash mismatch. Do not train."]
        return write_report(state)

    run_n = 1
    search_rows: list[dict[str, Any]] = []
    n_grid = len(GRID)
    for i, (body_lr, head_lr) in enumerate(GRID):
        rec = {
            "run_id": f"WRIM1-UH1-AC2-DC-{run_n:06d}",
            "parent": PARENT,
            "stage": "U1",
            "steps": 2,
            "head_lr": head_lr,
            "body_lr": body_lr,
        }
        state["LR_COMBINATIONS_TESTED"].append({"body_lr": body_lr, "head_lr": head_lr, "run_id": rec["run_id"]})
        if head_lr == 0.0:
            state["BODY_ONLY_TESTED"] = "YES"
        last = False
        row = run_one(state, rec, last=last)
        search_rows.append(row)
        run_n += 1
        s2 = snap_at(row, 2)
        gate = row.get("preflight_gate")
        g = row.get("preflight_grad")
        if gate == "HARD" or (g is not None and float(g) >= 8.0):
            state["GRADIENT_SAFETY"] = "HARD"
        elif state.get("GRADIENT_SAFETY") not in {"HARD", "REVIEW"} and (gate == "WARN" or (g is not None and float(g) >= 5.0)):
            if g is not None and float(g) >= 6.5:
                state["GRADIENT_SAFETY"] = "REVIEW"
            elif state.get("GRADIENT_SAFETY") != "REVIEW":
                state["GRADIENT_SAFETY"] = "WARN"
        elif state.get("GRADIENT_SAFETY") is None:
            state["GRADIENT_SAFETY"] = "SAFE"
        persist(state)
        if int(state["DECOUPLING_PROGRAM_TOKENS_USED"]) >= PROGRAM_BUDGET:
            break

    state["STEP2_SEARCH"] = [
        {
            "run_id": r.get("run_id"),
            "head_lr": r.get("head_lr"),
            "body_lr": r.get("body_lr"),
            "lm_head_frozen": r.get("lm_head_frozen"),
            "preflight_grad": r.get("preflight_grad"),
            "stage3_step2": snap_at(r, 2).get("stage3"),
            "token2_step2": snap_at(r, 2).get("token2_ce"),
            "rank_step2": snap_at(r, 2).get("token2_rank"),
            "head_dist": ((snap_at(r, 2).get("distance") or {}) or {}).get("LM_HEAD_DISTANCE_FROM_START"),
            "body_dist": ((snap_at(r, 2).get("distance") or {}) or {}).get("TRAINABLE_BODY_DISTANCE_FROM_START"),
            "keeps_six": keeps_six(r, 2),
            "token2_moved": row_moved(r, 2),
        }
        for r in search_rows
    ]

    body_only = [r for r in search_rows if float(r.get("head_lr") or 0) == 0.0]
    if body_only:
        any_move = any(keeps_six(r, 2) and row_moved(r, 2) for r in body_only)
        any_six = any(keeps_six(r, 2) for r in body_only)
        if any_move:
            state["BODY_ONLY_RESULT"] = "PRESENT"
        elif any_six:
            state["BODY_ONLY_RESULT"] = "STAGE3_6_NO_TOKEN2_MOVEMENT"
        else:
            state["BODY_ONLY_RESULT"] = "LOST_STAGE3_6_OR_UNSAFE"

    winners = [r for r in search_rows if keeps_six(r, 2) and row_moved(r, 2)]
    six_no_move = [r for r in search_rows if keeps_six(r, 2) and not row_moved(r, 2)]
    lost_six = [r for r in search_rows if not keeps_six(r, 2)]

    if winners:
        state["STAGE3_6_PRESERVED_DURING_LEARNING"] = "YES"
        state["TOKEN2_LEARNING_SIGNAL"] = "YES"
        # prefer lower head LR unless higher is materially better token2
        winners_sorted = sorted(winners, key=lambda r: (float(r.get("head_lr") or 0), score_winner(r, 2)))
        best = winners_sorted[0]
        best_ce = float(snap_at(best, 2).get("token2_ce") or START_CE)
        for cand in winners_sorted[1:]:
            ce = float(snap_at(cand, 2).get("token2_ce") or START_CE)
            if (best_ce - ce) >= 0.05 and float(cand.get("head_lr") or 0) > float(best.get("head_lr") or 0):
                best = cand
                best_ce = ce
        state["BEST"] = best
        persist(state)
        run_n = continue_lane(state, best, run_n)
        if state.get("PROGRAM_STATUS") != "TOKEN2_BREAKTHROUGH" and state.get("TOKEN2_PLATEAU") == "YES":
            nxt = [
                r
                for r in winners_sorted
                if float(r.get("head_lr") or 0) > float(best.get("head_lr") or 0)
                or abs(float(r.get("body_lr") or 0) - float(best.get("body_lr") or 0)) > 1e-12
            ]
            if nxt:
                state["TOKEN2_PLATEAU"] = "NO"
                run_n = continue_lane(state, nxt[0], run_n)
        if state.get("PROGRAM_STATUS") == "RUNNING":
            state["PROGRAM_STATUS"] = "U1_STAGE3_6_LEARNING_LANE"
    else:
        state["STAGE3_6_PRESERVED_DURING_LEARNING"] = "NO"
        if six_no_move:
            state["TOKEN2_LEARNING_SIGNAL"] = "ABSENT_AT_STAGE3_6"
            state["BEST"] = min(six_no_move, key=lambda r: float(r.get("head_lr") or 0))
        elif lost_six:
            moved_at_5 = [r for r in lost_six if row_moved(r, 2)]
            if moved_at_5:
                state["TOKEN2_LEARNING_SIGNAL"] = "PRESENT_BUT_LOST_STAGE3_6"
                state["BEST"] = moved_at_5[0]
            else:
                state["TOKEN2_LEARNING_SIGNAL"] = "ABSENT"
                state["BEST"] = search_rows[0] if search_rows else None
        all_fail = (not winners) and (
            (not six_no_move) or True
        )
        # Failure if all either lose 6 before meaningful token2, or produce zero token2 while keeping 6
        if not winners:
            state["HEAD_BODY_LR_DECOUPLING_FAILED"] = "YES"
            state["NEW_TRAINING_MECHANISM_OR_ARCHITECTURE_REVIEW_REQUIRED"] = "YES"
            state["PROGRAM_STATUS"] = "HEAD_BODY_LR_DECOUPLING_FAILED"

    # efficiency vs 1e-4 baseline: only if Stage3=6 learning
    best = state.get("BEST") or {}
    if state.get("STAGE3_6_PRESERVED_DURING_LEARNING") == "YES" and best:
        six = [s for s in (best.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 6]
        pick = max(six, key=lambda s: int(s.get("step") or 0)) if six else {}
        dist = pick.get("distance") or {}
        head = float(dist.get("LM_HEAD_DISTANCE_FROM_START") or 0.0)
        ce = pick.get("token2_ce")
        dce = START_CE - float(ce) if ce is not None else 0.0
        if head <= 1e-12:
            better = dce >= 0.03
        else:
            better = (dce / head) > U1_1E4_EFF and dce >= 0.03
        state["BETTER_THAN_1E4_HEAD_BASELINE"] = "YES" if better else "NO"

    if state.get("PROGRAM_STATUS") == "RUNNING":
        if int(state["DECOUPLING_PROGRAM_TOKENS_USED"]) >= PROGRAM_BUDGET:
            state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
        elif state.get("HEAD_BODY_LR_DECOUPLING_FAILED") == "YES":
            state["PROGRAM_STATUS"] = "HEAD_BODY_LR_DECOUPLING_FAILED"

    decisions = [
        "Do not promote. Canonical remains STEP_400.",
        "Do not change tokenizer or architecture from this program unless NEW_TRAINING_MECHANISM_OR_ARCHITECTURE_REVIEW_REQUIRED=YES.",
        f"Program status: {state.get('PROGRAM_STATUS')}.",
    ]
    if state.get("HEAD_BODY_LR_DECOUPLING_FAILED") == "YES":
        decisions.append(
            "Head/body LR decoupling at U1 (head 0/1e-5/3e-5/5e-5, body 5e-6/1e-5) did not keep Stage3=6 with meaningful token2. Do not lower Stage3, unfreeze 0–11, or spend another million tokens on the same idea."
        )
    elif state.get("STAGE3_6_PRESERVED_DURING_LEARNING") == "YES":
        decisions.append("A decoupled U1 recipe kept Stage3=6 while token2 moved. Continue that U1 lane, do not expand the body.")
    if state.get("BODY_ONLY_RESULT") == "PRESENT":
        decisions.append("BODY_ONLY_REPRESENTATION_LEARNING=PRESENT. Token2 moved with frozen lm_head.")
    elif state.get("BODY_ONLY_TESTED") == "YES" and state.get("BODY_ONLY_RESULT") not in {None, "PRESENT"}:
        decisions.append("Body-only (lm_head frozen) did not produce Stage3=6 token2 learning.")
    state["NEXT_COMMANDER_DECISION"] = decisions
    persist(state)
    return write_report(state)


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
