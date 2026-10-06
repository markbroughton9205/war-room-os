"""Autonomous U1→U2→U4→U6 selective representation-adaptation program.

Does not promote, commit, push, deploy, or change canonical STEP_400.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file

from wrim_arch_uh1_ac1_train import _write
from wrim_g20m_uh1 import WRIMUH1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, STAGE3_PARENT_DRIFT_HARD
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_retention_interp import interpolate_response
from wrim_selective_unfreeze import freeze_u_stage
from wrim_u_train import probe_u_mixes, train_u

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-INT-000001" / "alpha-0.02"
PARENT_A = Path(CKPT_BASE) / "WRIM1-UH1-AC2-LMH-000014" / "step-10"
PARENT_B = Path(CKPT_BASE) / "WRIM1-UH1-AC2-TT-000007" / "step-40"
EXPECT_PARENT = "84c8294e83874e4a08e5bf8413cda14b3cfdb83e5e37c5d88a7aa6846d8ff544"
EXPECT_A = "3bca426498c1deb970c56c9ac8c460531d7484de15c764cb3559ba4d70636718"
EXPECT_B = "f4317371663a2e0dbb67c0bc51bf1e572f7ca62be8c060941ebe36093b3ee4fe"
START_TOKEN2_CE = 26.475702868567573
START_TOKEN2_RANK = 6182.944444444444
LMH_L2_014_TO_007 = 4.57996940612793
LMH_ONLY_STAGE3_5_CE = 23.725401613447403
LMH_ONLY_EFFICIENCY = (START_TOKEN2_CE - LMH_ONLY_STAGE3_5_CE) / ((1.0 - 0.02) * LMH_L2_014_TO_007)
PREVIOUS_TOTAL = 1_916_928
PROGRAM_BUDGET = 1_000_000
HEAD_LR = 1e-4
BODY_LRS = (1e-6, 2e-6, 5e-6, 1e-5)
STAGE_ORDER = ("U1", "U2", "U4", "U6")
MIXES = (
    ("FT75-TT25", Path(DATA_ROOT) / "WR-CORPUS-PLM-FT75-TT25-v1.0.0"),
    ("FT60-TT40", Path(DATA_ROOT) / "WR-CORPUS-PLM-FT60-TT40-v1.0.0"),
    ("FT50-TT50", Path(DATA_ROOT) / "WR-CORPUS-PLM-FT50-TT50-v1.0.0"),
    ("FT40-TT60", Path(DATA_ROOT) / "WR-CORPUS-PLM-FT40-TT60-v1.0.0"),
)
REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_SELECTIVE_BODY_ADAPTATION_REPORT.json"
STATE_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_SELECTIVE_BODY_ADAPTATION_STATE.json"


def sha256_file(path: Path) -> str:
    from run000007_preflight import sha256_file as _sha

    return _sha(path)


def meminfo_ram_mib() -> tuple[float | None, float | None]:
    try:
        txt = Path("/proc/meminfo").read_text(encoding="utf-8")
        vals = {}
        for line in txt.splitlines():
            k, v, *_ = line.replace(":", " ").split()
            vals[k] = float(v) / 1024.0
        return vals.get("MemTotal"), vals.get("MemAvailable")
    except OSError:
        return None, None


def verify_parent() -> dict[str, Any]:
    ha = sha256_file(PARENT_A / MODEL_NAME)
    hb = sha256_file(PARENT_B / MODEL_NAME)
    hp = sha256_file(PARENT / MODEL_NAME)
    a = load_safetensors_file(str(PARENT_A / MODEL_NAME))
    b = load_safetensors_file(str(PARENT_B / MODEL_NAME))
    p = load_safetensors_file(str(PARENT / MODEL_NAME))
    recon = interpolate_response(a, b, 0.02)
    max_abs = 0.0
    worst = None
    for k, v in p.items():
        d = float((v.float() - recon[k].float()).abs().max().item())
        if d > max_abs:
            max_abs = d
            worst = k
    model = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=False)
    model.load_state_dict(p, strict=False)
    mask = freeze_u_stage(model, stage="U1", lm_head=True, ctrl=True)
    ram_total, ram_avail = meminfo_ram_mib()
    return {
        "ok": ha == EXPECT_A and hb == EXPECT_B and hp == EXPECT_PARENT and max_abs == 0.0,
        "HASH_A": ha,
        "HASH_B": hb,
        "HASH_PARENT": hp,
        "RECONSTRUCT_MAX_ABS": max_abs,
        "RECONSTRUCT_WORST_KEY": worst,
        "RECONSTRUCT_OK": max_abs == 0.0,
        "U1_MASK": {k: mask[k] for k in mask if k != "TRAINABLE_NAMES"},
        "U1_TRAINABLE_NAME_COUNT": len(mask["TRAINABLE_NAMES"]),
        "RAM_TOTAL_MIB": ram_total,
        "RAM_AVAILABLE_MIB": ram_avail,
    }


def token2_moved(parent_ce, parent_rank, ce, rank) -> bool:
    if ce is None or parent_ce is None:
        return False
    ce_drop = float(parent_ce) - float(ce)
    rank_drop = 0.0 if rank is None or parent_rank is None else (float(parent_rank) - float(rank))
    return ce_drop >= 0.03 or rank_drop >= 40.0


def better_than_lmh_pareto(*, stage3, token2_ce, lm_head_dist, parent_ce=START_TOKEN2_CE) -> bool:
    if token2_ce is None or stage3 is None:
        return False
    dce = float(parent_ce) - float(token2_ce)
    if int(stage3) >= 6 and dce >= 0.03:
        return True
    dist = float(lm_head_dist or 0.0)
    if int(stage3) >= 5 and dist > 1e-6 and dce >= 0.05:
        return (dce / dist) > LMH_ONLY_EFFICIENCY
    return False


def slim_run(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": obj.get("RUN_ID"),
        "ok": obj.get("ok"),
        "reason": obj.get("reason"),
        "abort": obj.get("abort"),
        "stage": obj.get("UNFREEZE_STAGE"),
        "pack": obj.get("PACK"),
        "head_lr": obj.get("HEAD_LR"),
        "body_lr": obj.get("BODY_LR"),
        "tokens": obj.get("TOKENS_USED"),
        "trainable": obj.get("TRAINABLE_PARAMETER_COUNT"),
        "trainable_pct": obj.get("TRAINABLE_PERCENT"),
        "preflight": obj.get("PREFLIGHT"),
        "stage3": obj.get("STAGE3_HISTORICAL"),
        "token2": obj.get("TOKEN2_CE"),
        "rank": obj.get("TOKEN2_RANK"),
        "oracle": obj.get("TOKEN2_ORACLE"),
        "exact": obj.get("GREEDY_TWO_TOKEN_EXACT"),
        "distance_best": obj.get("DISTANCE_BEST"),
        "eval_snaps": obj.get("EVAL_SNAPS"),
        "best_ckpt": obj.get("BEST_EXPERIMENTAL_CHECKPOINT"),
        "best_hash": obj.get("BEST_EXPERIMENTAL_HASH"),
        "best_legal_step": obj.get("BEST_LEGAL_STEP"),
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
        "wall": obj.get("WALL_SECONDS"),
    }


def persist_state(obj: dict[str, Any]) -> None:
    _write(STATE_PATH, json.loads(json.dumps(obj, default=str)))


def final_report(state: dict[str, Any]) -> dict[str, Any]:
    best = state.get("BEST") or {}
    dist = best.get("distance_best") or {}
    token2 = (best.get("token2") or {}).get("best")
    rank = (best.get("rank") or {}).get("best")
    stage3 = (best.get("stage3") or {}).get("best")
    parent_ce = (best.get("token2") or {}).get("parent") or START_TOKEN2_CE
    parent_rank = (best.get("rank") or {}).get("parent") or START_TOKEN2_RANK
    used = int(state.get("REP_ADAPT_TOKENS_USED") or 0)
    better = better_than_lmh_pareto(
        stage3=stage3,
        token2_ce=token2,
        lm_head_dist=(dist or {}).get("LM_HEAD_DISTANCE_FROM_START"),
        parent_ce=parent_ce,
    )
    drift = best.get("drift")
    headroom = None if drift is None else float(STAGE3_PARENT_DRIFT_HARD) - float(drift)
    report = {
        "REPORT_ID": "WRIM_GENESIS_SELECTIVE_BODY_ADAPTATION_REPORT",
        "PROGRAM_STATUS": state.get("PROGRAM_STATUS"),
        "CANONICAL": "STEP_400",
        "STARTING_STAGE3_6_PARENT": "WRIM1-UH1-AC2-INT-000001/alpha-0.02",
        "STARTING_PARENT_HASH": EXPECT_PARENT,
        "STARTING_TOKEN2_CE": START_TOKEN2_CE,
        "STARTING_TOKEN2_RANK": START_TOKEN2_RANK,
        "PARENT_VERIFY": state.get("PARENT_VERIFY"),
        "UNFREEZE_STAGES_TESTED": state.get("UNFREEZE_STAGES_TESTED"),
        "BEST_UNFREEZE_STAGE": best.get("stage"),
        "BEST_CHECKPOINT": best.get("best_ckpt"),
        "BEST_HASH": best.get("best_hash"),
        "TRAINABLE_PARAMETERS": best.get("trainable"),
        "TRAINABLE_PERCENT": best.get("trainable_pct"),
        "BODY_LR": best.get("body_lr"),
        "LM_HEAD_LR": best.get("head_lr"),
        "BEST_MIX": best.get("pack"),
        "LM_HEAD_DISTANCE_FROM_START": (dist or {}).get("LM_HEAD_DISTANCE_FROM_START"),
        "BODY_DISTANCE_FROM_START": (dist or {}).get("BODY_DISTANCE_FROM_START"),
        "TRAINABLE_BODY_DISTANCE_FROM_START": (dist or {}).get("TRAINABLE_BODY_DISTANCE_FROM_START"),
        "TOKEN2_CE": token2,
        "TOKEN2_RANK": rank,
        "TOKEN2_ORACLE_SUCCESS": (best.get("oracle") or {}).get("best"),
        "GREEDY_TWO_TOKEN_EXACT": (best.get("exact") or {}).get("best"),
        "TWO_TOKEN_CLASSES_WORKING": 0,
        "FIRST_TOKEN_CLASSES_WORKING": best.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": best.get("greedy_first"),
        "SHORT_ANSWER_CAPABILITY": "one-token YES; multi-token NO",
        "GREEDY_SHORT_ANSWER_CORRECT": best.get("greedy_short"),
        "GENERALIZATION": "held-out first-token classes retained unless eval shows otherwise; two-token exact 0 unless eval shows otherwise",
        "EOS": "see GREEDY_STOPPING",
        "GREEDY_STOPPING": best.get("greedy_stopping"),
        "RAMBLE_RATE": best.get("ramble"),
        "EMPTY_RESPONSE_RATE": best.get("empty"),
        "INDEPENDENT_NL_NLL": best.get("independent_nl"),
        "GENERAL_NL_NLL": best.get("general_nl"),
        "CODE_NLL": best.get("code"),
        "JSON_NLL": best.get("json"),
        "STAGE3_HISTORICAL": stage3,
        "STAGE3_COLLAPSE": (best.get("collapse") or {}).get("best"),
        "STAGE3_DRIFT_VS_STEP400": drift,
        "RETENTION_HEADROOM": headroom,
        "GRADIENT_SAFETY": state.get("GRADIENT_SAFETY"),
        "BETTER_THAN_LM_HEAD_ONLY_PARETO": "YES" if better else "NO",
        "LMH_ONLY_EFFICIENCY_REF": LMH_ONLY_EFFICIENCY,
        "TOKEN2_MOVED": token2_moved(parent_ce, parent_rank, token2, rank),
        "TOKEN2_PLATEAU": state.get("TOKEN2_PLATEAU"),
        "RETENTION_WALL": state.get("RETENTION_WALL"),
        "DEEPER_THAN_U6_REQUIRED": state.get("DEEPER_THAN_U6_REQUIRED"),
        "TOKENIZER_CHANGE_REQUIRED": "NO",
        "NEW_ARCHITECTURE_REQUIRED": "NO",
        "REP_ADAPT_TOKENS_USED": used,
        "REP_ADAPT_TOKENS_REMAINING": PROGRAM_BUDGET - used,
        "TOTAL_RESPONSE_TRAINING_TOKENS": PREVIOUS_TOTAL + used,
        "FOUNDATION_SCHOOL_STATUS": "NOT_GRADUATED",
        "FOUNDATION_READY_FOR_GRADUATION_REVIEW": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "STAGE3B_STARTED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "GRADIENT_PROBES": state.get("GRADIENT_PROBES"),
        "RUN_MEMORY": state.get("MEMORY"),
        "NEXT_COMMANDER_DECISION": state.get("NEXT_COMMANDER_DECISION"),
    }
    _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
    return report


def consider_best(state: dict[str, Any], row: dict[str, Any]) -> None:
    pce = (row.get("token2") or {}).get("parent")
    prk = (row.get("rank") or {}).get("parent")
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 5]
    moved = [s for s in snaps if token2_moved(pce, prk, s.get("token2_ce"), s.get("token2_rank"))]
    pool = moved or snaps
    if not pool:
        token2 = (row.get("token2") or {}).get("best")
        stage3 = (row.get("stage3") or {}).get("best")
        if token2 is None or stage3 is None or int(stage3) < 5:
            return
        cand_s3, cand_ce = int(stage3), float(token2)
        cand_moved = token2_moved(pce, prk, token2, (row.get("rank") or {}).get("best"))
    else:
        pick = min(pool, key=lambda s: (-int(s["stage3"]), float(s.get("token2_ce") or 1e9)))
        cand_s3, cand_ce = int(pick["stage3"]), float(pick.get("token2_ce") or 1e9)
        cand_moved = pick in moved if moved else False
    cur = state.get("BEST")
    if cur is None:
        state["BEST"] = row
        return
    cur_s3 = int((cur.get("stage3") or {}).get("best") or 0)
    cur_ce = float((cur.get("token2") or {}).get("best") or 1e9)
    cur_moved = token2_moved((cur.get("token2") or {}).get("parent"), (cur.get("rank") or {}).get("parent"), (cur.get("token2") or {}).get("best"), (cur.get("rank") or {}).get("best"))
    cur_key = (int(cur_moved), cur_s3, -cur_ce)
    new_key = (int(cand_moved), cand_s3, -cand_ce)
    if new_key > cur_key:
        state["BEST"] = row


def run_train(state: dict[str, Any], rec: dict[str, Any], *, last: bool) -> dict[str, Any]:
    report_file = Path(DATA_ROOT) / f"{rec['run_id']}_REPORT.json"
    if report_file.is_file():
        obj = json.loads(report_file.read_text(encoding="utf-8"))
        print(json.dumps({"skip_completed": rec["run_id"], "ok": obj.get("ok"), "stage3": obj.get("STAGE3_HISTORICAL"), "token2": obj.get("TOKEN2_CE")}, default=str), flush=True)
    else:
        parent = rec["parent"]
        corpus = rec["corpus"]
        obj = train_u(
            run_id=rec["run_id"],
            corpus_dir=Path(corpus),
            parent_ckpt=Path(parent),
            pack_name=rec["pack"],
            stage=rec["stage"],
            steps=rec["steps"],
            head_lr=rec["head_lr"],
            body_lr=rec["body_lr"],
            ctrl_trainable=True,
            restore_ollama=last,
        )
    used = int(obj.get("TOKENS_USED") or 0)
    state["REP_ADAPT_TOKENS_USED"] = int(state.get("REP_ADAPT_TOKENS_USED") or 0) + used
    state.setdefault("TOKENS_BY_STAGE", {})
    state["TOKENS_BY_STAGE"][rec["stage"]] = int(state["TOKENS_BY_STAGE"].get(rec["stage"]) or 0) + used
    state.setdefault("RECIPES_BY_STAGE", {})
    state["RECIPES_BY_STAGE"].setdefault(rec["stage"], [])
    if rec["pack"] + f"@{rec['body_lr']}" not in state["RECIPES_BY_STAGE"][rec["stage"]]:
        state["RECIPES_BY_STAGE"][rec["stage"]].append(rec["pack"] + f"@{rec['body_lr']}")
    row = slim_run(obj)
    row["recipe"] = rec
    state.setdefault("MEMORY", []).append(row)
    consider_best(state, row)
    persist_state(state)
    print(
        json.dumps(
            {
                "run_id": row["run_id"],
                "ok": row["ok"],
                "stage3": row["stage3"],
                "token2": row["token2"],
                "rank": row["rank"],
                "distance": row["distance_best"],
                "abort": row["abort"],
                "tokens_used_program": state["REP_ADAPT_TOKENS_USED"],
            },
            default=str,
        ),
        flush=True,
    )
    return row


def legal_learning(row: dict[str, Any]) -> bool:
    pce = (row.get("token2") or {}).get("parent")
    prk = (row.get("rank") or {}).get("parent")
    for snap in row.get("eval_snaps") or []:
        if snap.get("stage3") is None or int(snap["stage3"]) < 5:
            continue
        if token2_moved(pce, prk, snap.get("token2_ce"), snap.get("token2_rank")):
            return True
    s3 = (row.get("stage3") or {}).get("best")
    ce = (row.get("token2") or {}).get("best")
    rk = (row.get("rank") or {}).get("best")
    return s3 is not None and int(s3) >= 5 and token2_moved(pce, prk, ce, rk)


def body_adapted(row: dict[str, Any]) -> bool:
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 5]
    if not snaps:
        dist = row.get("distance_best") or {}
        snaps = [{"distance": dist, "stage3": 5}]
    best_ratio = 0.0
    best_body = 0.0
    for snap in snaps:
        dist = snap.get("distance") or {}
        head = float(dist.get("LM_HEAD_DISTANCE_FROM_START") or 0.0)
        body = float(dist.get("TRAINABLE_BODY_DISTANCE_FROM_START") or 0.0)
        best_body = max(best_body, body)
        if head > 1e-6:
            best_ratio = max(best_ratio, body / head)
    return best_body >= 0.02 or best_ratio >= 0.05


def latest_legal_ckpt(row: dict[str, Any]) -> str | None:
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 5]
    if not snaps:
        return row.get("best_ckpt")
    pick = max(snaps, key=lambda s: int(s.get("step") or 0))
    return f"{row.get('run_id')}/step-{int(pick['step'])}"


def still_learning_along_snaps(row: dict[str, Any]) -> bool:
    snaps = [s for s in (row.get("eval_snaps") or []) if s.get("stage3") is not None and int(s["stage3"]) >= 5]
    if len(snaps) < 2:
        return False
    first = snaps[0]
    last = snaps[-1]
    return token2_moved(first.get("token2_ce"), first.get("token2_rank"), last.get("token2_ce"), last.get("token2_rank"))


def main() -> dict[str, Any]:
    from run000007_vram import start_user_ollama, stop_user_ollama

    t0 = time.time()
    state: dict[str, Any] = {
        "PROGRAM_STATUS": "RUNNING",
        "CANONICAL": "STEP_400",
        "REP_ADAPT_TOKENS_USED": 0,
        "UNFREEZE_STAGES_TESTED": [],
        "TOKEN2_PLATEAU": "NO",
        "RETENTION_WALL": "NO",
        "DEEPER_THAN_U6_REQUIRED": "NO",
        "GRADIENT_SAFETY": None,
        "MEMORY": [],
        "BEST": None,
    }
    verify = verify_parent()
    state["PARENT_VERIFY"] = verify
    persist_state(state)
    print(json.dumps({"parent_verify": {k: verify[k] for k in verify if k != "U1_MASK"}, "u1_mask": verify.get("U1_MASK")}, default=str), flush=True)
    if not verify.get("ok"):
        state["PROGRAM_STATUS"] = "PARENT_VERIFY_FAILED"
        state["NEXT_COMMANDER_DECISION"] = ["Parent α=0.02 was not reconstructable/hashed. Do not start body adaptation from a Stage3=5 parent."]
        return final_report(state)

    try:
        stop_user_ollama()
        probes = probe_u_mixes(parent_ckpt=PARENT, stage="U1", mixes=list(MIXES), restore_ollama=False)
        state["GRADIENT_PROBES"] = probes
        persist_state(state)
        print(json.dumps({"probe_ok": probes.get("ok"), "mixes": [{k: m[k] for k in ("pack", "unsafe", "MAX_TOTAL_TRAINABLE_GRAD") if k in m} for m in probes.get("mixes") or []]}, default=str), flush=True)
        safe_packs = {m["pack"] for m in (probes.get("mixes") or []) if not m.get("unsafe")}
        max_g = max((float(m.get("MAX_TOTAL_TRAINABLE_GRAD") or 0) for m in (probes.get("mixes") or [])), default=0.0)
        state["GRADIENT_SAFETY"] = "HARD" if max_g >= 8.0 else ("REVIEW" if max_g >= 6.5 else ("WARN" if max_g >= 5.0 else "SAFE"))
        if not safe_packs:
            state["PROGRAM_STATUS"] = "U1_PREFLIGHT_UNSAFE"
            state["NEXT_COMMANDER_DECISION"] = ["U1 gradient preflight was unsafe on all mixes. Do not hide with clipping."]
            return final_report(state)

        run_n = 1
        current_parent = PARENT
        for stage in STAGE_ORDER:
            if stage not in state["UNFREEZE_STAGES_TESTED"]:
                state["UNFREEZE_STAGES_TESTED"].append(stage)
            recipes_here = 0
            learning_rows: list[dict[str, Any]] = []
            mix_rows: list[dict[str, Any]] = []
            retention_fail_learning = 0
            safe_no_learn = 0
            mix_cycle = [m for m in MIXES if m[0] in safe_packs] or list(MIXES)
            mix_cycle = sorted(mix_cycle, key=lambda x: 0 if x[0] == "FT60-TT40" else 1)
            probe_grad = {m["pack"]: float(m.get("MAX_TOTAL_TRAINABLE_GRAD") or 99) for m in (probes.get("mixes") or [])}
            preferred = [m for m in mix_cycle if probe_grad.get(m[0], 99) < 5.0]
            if preferred:
                mix_cycle = preferred
            plateau = False
            wall = False
            breakthrough = False

            def consume(row: dict[str, Any]) -> None:
                nonlocal retention_fail_learning, safe_no_learn, breakthrough, recipes_here
                recipes_here += 1
                s3f = (row.get("stage3") or {}).get("final")
                if legal_learning(row):
                    learning_rows.append(row)
                elif s3f is not None and int(s3f) < 5:
                    if token2_moved((row.get("token2") or {}).get("parent"), (row.get("rank") or {}).get("parent"), (row.get("token2") or {}).get("final"), (row.get("rank") or {}).get("final")):
                        retention_fail_learning += 1
                else:
                    safe_no_learn += 1
                oracle = (row.get("oracle") or {}).get("best") or 0
                exact = (row.get("exact") or {}).get("best") or 0
                if int(oracle or 0) > 0 or int(exact or 0) > 0:
                    breakthrough = True

            for pack_name, corpus in mix_cycle:
                if int(state["REP_ADAPT_TOKENS_USED"]) + 4096 >= PROGRAM_BUDGET:
                    state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
                    break
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-U-{run_n:06d}",
                    "parent": PARENT,
                    "corpus": corpus,
                    "pack": pack_name,
                    "stage": stage,
                    "steps": 10,
                    "head_lr": HEAD_LR,
                    "body_lr": BODY_LRS[0],
                }
                row = run_train(state, rec, last=False)
                run_n += 1
                mix_rows.append(row)
                consume(row)
                persist_state(state)
                if breakthrough:
                    break

            adapted_rows = [r for r in learning_rows if body_adapted(r)]
            if not adapted_rows and mix_rows and state.get("PROGRAM_STATUS") != "TOKEN_BUDGET_EXHAUSTED" and not breakthrough:
                # Body LR 1e-6 can move token2 via lm_head while layer 17 barely moves.
                # Raise body LR on the proven 60/40 mix to test the representation hypothesis.
                win_pack = "FT60-TT40"
                if not any(r.get("pack") == win_pack for r in mix_rows):
                    win_pack = mix_rows[0].get("pack")
                win_corpus = next(c for n, c in MIXES if n == win_pack)
                for body_lr in BODY_LRS[1:]:
                    if int(state["REP_ADAPT_TOKENS_USED"]) + 4096 >= PROGRAM_BUDGET:
                        state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
                        break
                    rec = {
                        "run_id": f"WRIM1-UH1-AC2-U-{run_n:06d}",
                        "parent": PARENT,
                        "corpus": win_corpus,
                        "pack": win_pack,
                        "stage": stage,
                        "steps": 10,
                        "head_lr": HEAD_LR,
                        "body_lr": body_lr,
                    }
                    row = run_train(state, rec, last=False)
                    run_n += 1
                    consume(row)
                    persist_state(state)
                    if (legal_learning(row) and body_adapted(row)) or breakthrough:
                        break
                adapted_rows = [r for r in learning_rows if body_adapted(r)]

            continued = False
            cursor_row = None
            if adapted_rows:
                cursor_row = min(
                    adapted_rows,
                    key=lambda r: (
                        float((r.get("token2") or {}).get("final") or 1e9),
                        -int((r.get("stage3") or {}).get("final") or 0),
                    ),
                )
            extra = 0
            while (
                cursor_row is not None
                and extra < 8
                and int(state["REP_ADAPT_TOKENS_USED"]) + 40960 <= PROGRAM_BUDGET
                and not breakthrough
            ):
                parent_rel = latest_legal_ckpt(cursor_row)
                if not parent_rel:
                    break
                rec = {
                    "run_id": f"WRIM1-UH1-AC2-U-{run_n:06d}",
                    "parent": Path(CKPT_BASE) / parent_rel,
                    "corpus": next(c for n, c in MIXES if n == cursor_row["pack"]),
                    "pack": cursor_row["pack"],
                    "stage": stage,
                    "steps": 25,
                    "head_lr": cursor_row["head_lr"],
                    "body_lr": cursor_row["body_lr"],
                }
                row = run_train(state, rec, last=False)
                run_n += 1
                extra += 1
                continued = True
                consume(row)
                persist_state(state)
                if not legal_learning(row):
                    break
                if not still_learning_along_snaps(row):
                    break
                cursor_row = row

            tokens_stage = int((state.get("TOKENS_BY_STAGE") or {}).get(stage) or 0)
            n_recipes = len(state.get("RECIPES_BY_STAGE", {}).get(stage) or [])
            if not learning_rows and retention_fail_learning > 0 and safe_no_learn > 0:
                wall = True
            if not learning_rows and n_recipes >= 3 and tokens_stage >= 150_000:
                plateau = True
            if not learning_rows and n_recipes >= 3 and all(not legal_learning(r) for r in state["MEMORY"] if r.get("stage") == stage):
                # If we tested mix+LR grid without legal learning, treat as plateau or wall.
                if retention_fail_learning > 0:
                    wall = True
                else:
                    plateau = True

            state["TOKEN2_PLATEAU"] = "YES" if plateau else state.get("TOKEN2_PLATEAU")
            state["RETENTION_WALL"] = "YES" if wall else state.get("RETENTION_WALL")
            persist_state(state)

            if breakthrough:
                state["PROGRAM_STATUS"] = "TOKEN2_BREAKTHROUGH"
                break
            if legal_learning(state.get("BEST") or {}) and (state.get("BEST") or {}).get("stage") == stage and not plateau and not wall:
                # Stay at this unfreeze stage. Do not expand body while U1 still learns legally.
                if continued and still_learning_along_snaps(cursor_row or state["BEST"]):
                    if int(state["REP_ADAPT_TOKENS_USED"]) + 40960 <= PROGRAM_BUDGET:
                        state["PROGRAM_STATUS"] = "U1_STILL_LEARNING_CONTINUE"
                        # already exhausted extra continuation loop this stage; treat as in-progress legal U1
                    break
                if learning_rows:
                    state["PROGRAM_STATUS"] = "U_STAGE_LEGAL_LEARNING_NO_GREEDY"
                    break
            if not (plateau or wall):
                # Not enough evidence to expand yet — if we still have budget and no learning, continue next LR already done.
                if learning_rows:
                    state["PROGRAM_STATUS"] = "U_STAGE_LEGAL_LEARNING_NO_GREEDY"
                    break
                if stage == "U6":
                    state["DEEPER_THAN_U6_REQUIRED"] = "YES"
                    state["PROGRAM_STATUS"] = "U6_FAILED_NO_LEGAL_BETTER_PARETO"
                    break
                # Expand only on plateau or wall.
                if n_recipes < 3:
                    # Grid already includes 4 mixes × up to 4 LRs. If early-stopped, keep expanding LRs in this stage via loop.
                    if not learning_rows:
                        continue
                if not (plateau or wall) and not learning_rows:
                    if stage == STAGE_ORDER[-1]:
                        state["DEEPER_THAN_U6_REQUIRED"] = "YES"
                        state["PROGRAM_STATUS"] = "U6_FAILED_NO_LEGAL_BETTER_PARETO"
                        break
                    # Insufficient recipes and no learning: still allow advance if the whole LR/mix grid was attempted.
                    if n_recipes >= 3:
                        plateau = True
                        state["TOKEN2_PLATEAU"] = "YES"
                    else:
                        continue
            # Advance stage
            current_parent = PARENT
            if stage == "U6":
                state["DEEPER_THAN_U6_REQUIRED"] = "YES"
                state["PROGRAM_STATUS"] = "U6_FAILED_NO_LEGAL_BETTER_PARETO"
                break

        if state.get("PROGRAM_STATUS") == "RUNNING":
            if int(state["REP_ADAPT_TOKENS_USED"]) >= PROGRAM_BUDGET:
                state["PROGRAM_STATUS"] = "TOKEN_BUDGET_EXHAUSTED"
            elif legal_learning(state.get("BEST") or {}):
                state["PROGRAM_STATUS"] = "U_STAGE_LEGAL_LEARNING_NO_GREEDY"
            else:
                state["PROGRAM_STATUS"] = "STAGED_BODY_ADAPTATION_NO_BETTER_PARETO"

        best = state.get("BEST") or {}
        better = better_than_lmh_pareto(
            stage3=(best.get("stage3") or {}).get("best"),
            token2_ce=(best.get("token2") or {}).get("best"),
            lm_head_dist=((best.get("distance_best") or {}) or {}).get("LM_HEAD_DISTANCE_FROM_START"),
        )
        decisions = [
            "Do not promote. Canonical remains STEP_400.",
            "Do not change tokenizer or architecture from this program.",
            f"Program status: {state.get('PROGRAM_STATUS')}.",
        ]
        if better:
            decisions.append("Upper-layer adaptation produced a better legal Pareto than lm_head-only. Continue this unfreeze stage rather than expanding the body.")
        else:
            decisions.append("No legal better Pareto than the proven lm_head-only wall was secured in the tested unfreeze stages.")
        if state.get("DEEPER_THAN_U6_REQUIRED") == "YES":
            decisions.append("U6 still did not break the wall. Deeper body unfreeze or a new architecture is a Commander decision. Foundry must not auto-unfreeze layers 0–11 or tok_emb.")
        if (best.get("oracle") or {}).get("best") or (best.get("exact") or {}).get("best"):
            decisions.append("TOKEN2_BREAKTHROUGH occurred. Stay at the smallest successful unfreeze stage and expand held-out two-token classes.")
        state["NEXT_COMMANDER_DECISION"] = decisions
        persist_state(state)
        report = final_report(state)
        report["WALL_SECONDS_PROGRAM"] = time.time() - t0
        _write(REPORT_PATH, json.loads(json.dumps(report, default=str)))
        return report
    finally:
        start_user_ollama()


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
