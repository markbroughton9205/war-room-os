"""Matched-step comparison of RUN-000012 vs frozen RUN-000011 evals. Does not mutate 000011."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from run000010_report import _num
from run000012_identity import RUN000011_CKPT_ROOT

MATCHED_STEPS = (5, 6, 10, 15, 20, 25, 30)


def _tf(ev: dict[str, Any]) -> dict[str, Any]:
    return (ev.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or (ev.get("teacher_forced") or {}).get("instruction_stopping") or {}


def _topk(ev: dict[str, Any]) -> dict[str, Any]:
    rd = ev.get("rank_diagnostics") or {}
    return rd.get("TARGET_TOPK") or _tf(ev).get("TARGET_TOPK") or {}


def _stop_topk(ev: dict[str, Any]) -> dict[str, Any]:
    rd = ev.get("rank_diagnostics") or {}
    return rd.get("STOP_TOPK") or {}


def _margin(ev: dict[str, Any]) -> float | None:
    rd = ev.get("rank_diagnostics") or {}
    stats = rd.get("TARGET_LOGIT_MARGIN_STATS") or {}
    if stats.get("mean") is not None:
        return _num(stats.get("mean"))
    return _num(_tf(ev).get("LOGIT_MARGIN_TO_ARGMAX") or _tf(ev).get("MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX"))


def load_eval(root: Path, step: int) -> dict[str, Any] | None:
    p = root / "evals" / f"step-{step}.json"
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_tf_items(root: Path, step: int) -> list[dict[str, Any]]:
    p = root / "evals" / f"teacher-forced-step-{step}.json"
    if not p.is_file():
        return []
    blob = json.loads(p.read_text(encoding="utf-8"))
    return list(blob.get("items") or [])


def snapshot(ev: dict[str, Any] | None) -> dict[str, Any]:
    if not ev:
        return {}
    tf = _tf(ev)
    topk = _topk(ev)
    stopk = _stop_topk(ev)
    me = ev.get("mode_entry_validation") or {}
    return {
        "TARGET_RANK": tf.get("TARGET_FIRST_TOKEN_RANK"),
        "SEQUENCE_NLL": tf.get("TARGET_SEQUENCE_AVG_NLL"),
        "STOP_RANK": tf.get("TARGET_STOP_TOKEN_RANK"),
        "EOS_PROB": tf.get("EOS_PROBABILITY_AT_CORRECT_STOP"),
        "LOGIT_MARGIN": _margin(ev),
        "TOPK": topk,
        "STOP_TOPK": stopk,
        "MODE_ENTRY_GREEDY": me.get("PASS_COUNT"),
        "INSTRUCTION_GREEDY": (me.get("INSTRUCTION_VALIDATION") or {}).get("correct"),
        "STOPPING_GREEDY": (me.get("STOPPING_VALIDATION") or {}).get("correct"),
        "DELTA_NLL": ev.get("mean_wrim0_anchor_nll_delta"),
        "KL": ev.get("mean_kl_wrim0_to_candidate"),
        "CAP": ev.get("historical_binary"),
        "S3_INST_02_MAX_RUN": ev.get("S3_INST_02_MAX_RUN_256"),
    }


def delta(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return float(b) - float(a)


def compare_matched_steps(evals_012: dict[str, dict[str, Any]], root_011: Path | None = None) -> dict[str, Any]:
    root = Path(root_011 or RUN000011_CKPT_ROOT)
    rows = []
    for step in MATCHED_STEPS:
        ev12 = evals_012.get(str(step))
        ev11 = load_eval(root, step)
        s11 = snapshot(ev11)
        s12 = snapshot(ev12)
        rows.append(
            {
                "step": step,
                "RUN011_TARGET_RANK": s11.get("TARGET_RANK"),
                "RUN012_TARGET_RANK": s12.get("TARGET_RANK"),
                "DELTA_TARGET_RANK": delta(s11.get("TARGET_RANK"), s12.get("TARGET_RANK")),
                "RUN011_SEQUENCE_NLL": s11.get("SEQUENCE_NLL"),
                "RUN012_SEQUENCE_NLL": s12.get("SEQUENCE_NLL"),
                "DELTA_SEQUENCE_NLL": delta(s11.get("SEQUENCE_NLL"), s12.get("SEQUENCE_NLL")),
                "RUN011_STOP_RANK": s11.get("STOP_RANK"),
                "RUN012_STOP_RANK": s12.get("STOP_RANK"),
                "DELTA_STOP_RANK": delta(s11.get("STOP_RANK"), s12.get("STOP_RANK")),
                "RUN011_EOS_PROB": s11.get("EOS_PROB"),
                "RUN012_EOS_PROB": s12.get("EOS_PROB"),
                "DELTA_EOS_PROB": delta(s11.get("EOS_PROB"), s12.get("EOS_PROB")),
                "RUN011_LOGIT_MARGIN": s11.get("LOGIT_MARGIN"),
                "RUN012_LOGIT_MARGIN": s12.get("LOGIT_MARGIN"),
                "DELTA_LOGIT_MARGIN": delta(s11.get("LOGIT_MARGIN"), s12.get("LOGIT_MARGIN")),
                "RUN011_TOP_K": s11.get("TOPK"),
                "RUN012_TOP_K": s12.get("TOPK"),
                "RUN011_STOP_TOP_K": s11.get("STOP_TOPK"),
                "RUN012_STOP_TOP_K": s12.get("STOP_TOPK"),
                "RUN011_GREEDY": {
                    "mode_entry": s11.get("MODE_ENTRY_GREEDY"),
                    "instruction": s11.get("INSTRUCTION_GREEDY"),
                    "stopping": s11.get("STOPPING_GREEDY"),
                },
                "RUN012_GREEDY": {
                    "mode_entry": s12.get("MODE_ENTRY_GREEDY"),
                    "instruction": s12.get("INSTRUCTION_GREEDY"),
                    "stopping": s12.get("STOPPING_GREEDY"),
                },
                "GREEDY_DIFFERENCE": {
                    "mode_entry": delta(s11.get("MODE_ENTRY_GREEDY"), s12.get("MODE_ENTRY_GREEDY")),
                    "instruction": delta(s11.get("INSTRUCTION_GREEDY"), s12.get("INSTRUCTION_GREEDY")),
                    "stopping": delta(s11.get("STOPPING_GREEDY"), s12.get("STOPPING_GREEDY")),
                },
            }
        )
    return {"steps": MATCHED_STEPS, "rows": rows, "run011_root": str(root), "run011_present": root.is_dir()}


def per_example_vs_011(step: int, items_012: list[dict[str, Any]], greedy_012: list[dict[str, Any]] | None = None, root_011: Path | None = None) -> list[dict[str, Any]]:
    root = Path(root_011 or RUN000011_CKPT_ROOT)
    items_011 = {str(r.get("example_id")): r for r in load_tf_items(root, step)}
    items_0 = {str(r.get("example_id")): r for r in load_tf_items(root, 0)}
    greedy_by = {}
    for g in greedy_012 or []:
        greedy_by[str(g.get("example_id") or g.get("id") or "")] = g
    out = []
    for r in items_012:
        eid = str(r.get("example_id"))
        a = items_011.get(eid) or {}
        b0 = items_0.get(eid) or {}
        g = greedy_by.get(eid) or {}
        out.append(
            {
                "ITEM_ID": eid,
                "CATEGORY": r.get("category"),
                "BASELINE_RANK": b0.get("TARGET_FIRST_TOKEN_RANK"),
                "RUN011_MATCHED_STEP_RANK": a.get("TARGET_FIRST_TOKEN_RANK"),
                "RUN012_RANK": r.get("TARGET_FIRST_TOKEN_RANK"),
                "TARGET_PROBABILITY": r.get("TARGET_FIRST_TOKEN_PROBABILITY"),
                "ARGMAX_TOKEN": r.get("ARGMAX_TOKEN"),
                "TARGET_TOKEN": r.get("TARGET_TOKEN"),
                "LOGIT_MARGIN": r.get("LOGIT_MARGIN_TO_ARGMAX"),
                "GREEDY_CORRECT": bool(g.get("correct") or g.get("CORRECT") or g.get("pass")),
                "EOS_CORRECT": bool(g.get("eos_correct") or (g.get("stopped") and g.get("correct"))),
            }
        )
    return out


def objective_benefit(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Did 012 materially beat 011 on rank/NLL/top-k/margin/EOS without needing greedy."""
    usable = [r for r in rows if r.get("RUN011_TARGET_RANK") is not None and r.get("RUN012_TARGET_RANK") is not None]
    if not usable:
        return {"status": "NO_OBJECTIVE_BENEFIT", "reason": "missing_run011_or_run012_evals"}
    last = usable[-1]
    rank_win = (last.get("DELTA_TARGET_RANK") or 0) < -10
    nll_win = (last.get("DELTA_SEQUENCE_NLL") or 0) < -0.03
    stop_win = (last.get("DELTA_STOP_RANK") or 0) < -10
    eos_win = (last.get("DELTA_EOS_PROB") or 0) > 1e-6
    margin_win = (last.get("DELTA_LOGIT_MARGIN") or 0) > 0.02
    def top(k: str, key: str) -> int:
        return int(((last.get(k) or {}).get(key)) or 0)
    topk_win = (
        top("RUN012_TOP_K", "TARGET_IN_TOP_10") > top("RUN011_TOP_K", "TARGET_IN_TOP_10")
        or top("RUN012_TOP_K", "TARGET_IN_TOP_50") > top("RUN011_TOP_K", "TARGET_IN_TOP_50")
        or top("RUN012_TOP_K", "TARGET_IN_TOP_100") > top("RUN011_TOP_K", "TARGET_IN_TOP_100")
    )
    wins = sum(bool(x) for x in (rank_win, nll_win, stop_win, eos_win, margin_win, topk_win))
    rank_worse = (last.get("DELTA_TARGET_RANK") or 0) > 10
    nll_worse = (last.get("DELTA_SEQUENCE_NLL") or 0) > 0.03
    if rank_worse and nll_worse:
        status = "OBJECTIVE_REGRESSION"
    elif wins >= 3:
        status = "STRONG_OBJECTIVE_IMPROVEMENT"
    elif wins >= 1:
        status = "MODEST_OBJECTIVE_IMPROVEMENT"
    else:
        status = "NO_OBJECTIVE_BENEFIT"
    return {
        "status": status,
        "wins": wins,
        "rank_win": rank_win,
        "nll_win": nll_win,
        "stop_win": stop_win,
        "eos_win": eos_win,
        "margin_win": margin_win,
        "topk_win": topk_win,
        "last_step": last.get("step"),
    }
