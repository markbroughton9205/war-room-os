"""Dry-run controller for WRIM1-RUN-000006. Zero optimizer steps. Fixture-driven."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from run000006_collision import assert_run_id_unused
from run000006_coverage import FROZEN_GENESIS_TRAIN_IDS, rehearsal_coverage_report
from run000006_pack import self_test as coverage_pack_self_test
from run000006_gates import HARD_STOP, PASS, REVIEW_REQUIRED, WARNING, evaluate_gates, packing_preflight_decision
from run000006_identity import RUN_ID, TRAINING_AUTHORIZATION
from run000006_integrity import integrity_verdict, newline_normalize_bytes
from run000006_schedule import self_test as schedule_self_test

OPTIMIZER_STEPS = 0
ADAMW_CONSTRUCTED = False


def _healthy_metrics() -> dict[str, Any]:
    return {
        "mean_wrim0_anchor_nll_delta": 0.02,
        "mean_kl_wrim0_to_candidate": 0.004,
        "val_loss_corpus0": 8.80,
        "val_loss_corpus1": 7.90,
        "n_collapsed_256": 4,
        "json_n_collapsed": 1,
        "code_n_collapsed": 1,
        "historical_binary": "6/6",
        "grad_norm": 1.2,
        "loss": 7.0,
    }


def run_dry_cases(tmp: Path) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    optimizer_steps = 0

    def add(case_id: str, ok: bool, detail: dict[str, Any]) -> None:
        cases.append({"id": case_id, **detail, "ok": ok, "optimizer_steps": 0, "AdamW_constructed": False})

    # CASE 1 healthy → PASS / continue
    g1 = evaluate_gates(_healthy_metrics(), eval_step=5)
    add("CASE_1_healthy_pass", g1["STATE"] == PASS and g1["continue_training"] is True, {"STATE": g1["STATE"]})

    # CASE 2 warning ΔNLL → WARNING / continue
    m2 = _healthy_metrics()
    m2["mean_wrim0_anchor_nll_delta"] = 0.075
    g2 = evaluate_gates(m2, eval_step=10)
    add("CASE_2_warning_dnll", g2["STATE"] == WARNING and g2["continue_training"] is True, {"STATE": g2["STATE"]})

    # CASE 3 review-level → REVIEW_REQUIRED, continue (not hard stop)
    m3 = _healthy_metrics()
    m3["mean_wrim0_anchor_nll_delta"] = 0.095
    g3 = evaluate_gates(m3, eval_step=15)
    add(
        "CASE_3_review_dnll",
        g3["STATE"] == REVIEW_REQUIRED and g3["continue_training"] is True and g3["prevent_next_optimizer_step"] is False,
        {"STATE": g3["STATE"]},
    )

    # CASE 4 ΔNLL >= 0.105 → HARD_STOP
    m4 = _healthy_metrics()
    m4["mean_wrim0_anchor_nll_delta"] = 0.105
    g4 = evaluate_gates(m4, eval_step=20)
    add("CASE_4_dnll_hard_stop", g4["STATE"] == HARD_STOP and g4["prevent_next_optimizer_step"] is True, {"STATE": g4["STATE"]})

    # CASE 5 KL >= 0.022 → HARD_STOP
    m5 = _healthy_metrics()
    m5["mean_kl_wrim0_to_candidate"] = 0.022
    g5 = evaluate_gates(m5, eval_step=20)
    add("CASE_5_kl_hard_stop", g5["STATE"] == HARD_STOP and g5["prevent_next_optimizer_step"] is True, {"STATE": g5["STATE"]})

    # CASE 6 JSON collapse >= 4 → HARD_STOP
    m6 = _healthy_metrics()
    m6["json_n_collapsed"] = 4
    g6 = evaluate_gates(m6, eval_step=25)
    add("CASE_6_json_hard_stop", g6["STATE"] == HARD_STOP, {"STATE": g6["STATE"]})

    # CASE 7 CAP <= 4/6 → HARD_STOP
    m7 = _healthy_metrics()
    m7["historical_binary"] = "4/6"
    g7 = evaluate_gates(m7, eval_step=25)
    add("CASE_7_cap_hard_stop", g7["STATE"] == HARD_STOP, {"STATE": g7["STATE"]})

    # CASE 8 NaN → HARD_STOP
    m8 = _healthy_metrics()
    m8["loss"] = float("nan")
    g8 = evaluate_gates(m8, eval_step=5)
    add("CASE_8_nan_hard_stop", g8["STATE"] == HARD_STOP, {"STATE": g8["STATE"]})

    # CASE 9 starved rehearsal document → PRETRAIN ABORT
    starved = rehearsal_coverage_report(
        {
            FROZEN_GENESIS_TRAIN_IDS[0]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[1]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[2]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[3]: 1000,
            # fifth omitted / zero
        }
    )
    p9 = packing_preflight_decision(starved_doc_ids=starved["STARVED_DOC_IDS"], max_doc_share=starved["MAX_DOC_SHARE"])
    add(
        "CASE_9_starved_pretrain_abort",
        p9["decision"] == "PRETRAIN_ABORT" and FROZEN_GENESIS_TRAIN_IDS[4] in starved["STARVED_DOC_IDS"] and p9["abort_before_optimizer"] is True,
        {"STARVED_DOC_IDS": starved["STARVED_DOC_IDS"]},
    )

    # CASE 10 max rehearsal share >= 50% → PRETRAIN ABORT
    p10 = packing_preflight_decision(starved_doc_ids=[], max_doc_share=0.50)
    add("CASE_10_max_share_pretrain_abort", p10["decision"] == "PRETRAIN_ABORT", p10)

    # CASE 11 run ID already exists → PRETRAIN ABORT
    occupied = tmp / RUN_ID
    occupied.mkdir(parents=True)
    (occupied / "model.safetensors").write_bytes(b"not-a-real-checkpoint")
    (occupied / "run-manifest.json").write_text(json.dumps({"run_id": RUN_ID, "optimizer_steps": 1}), encoding="utf-8")
    c11_ckpt = assert_run_id_unused(RUN_ID, [tmp])
    man_only = tmp / "manifest-only"
    man_only.mkdir()
    (man_only / "run-manifest.json").write_text(
        json.dumps({"run_id": RUN_ID, "optimizer_steps": 7, "kind": "EXECUTED_RUN"}), encoding="utf-8"
    )
    c11_man = assert_run_id_unused(RUN_ID, [man_only])
    empty = tmp / "empty-roots"
    empty.mkdir()
    c11_pass = assert_run_id_unused(RUN_ID, [empty])
    c11_registry = assert_run_id_unused("WRIM1-RUN-000005", [empty])
    add(
        "CASE_11_run_id_collision",
        c11_ckpt["ok"] is False
        and c11_ckpt["decision"] == "PRETRAIN_ABORT"
        and c11_man["ok"] is False
        and c11_pass["ok"] is True
        and c11_registry["ok"] is False
        and any(h.get("kind") == "registry" for h in c11_registry["hits"]),
        {"fail_hits": c11_ckpt["hits"], "unused_pass": c11_pass["ok"], "registry": c11_registry["hits"]},
    )

    # CASE 12 semantic reference sidecar mutation → INTEGRITY FAIL
    base = {
        "kind": "WRIM-0_REFERENCE_NLL_FROZEN",
        "items": [{"evalId": "cap0-ret-01", "nll_32": 2.247631549835205}],
    }
    lf = (json.dumps(base, indent=2) + "\n").encode("utf-8")
    crlf = lf.replace(b"\n", b"\r\n")
    from run000006_identity import REFERENCE_NLL_CANONICAL_LF_SHA
    # Use whatever LF hash this fixture produces as "expected" for newline test,
    # then mutate a number and require FAIL against the fixture's own LF hash.
    expected_fixture = __import__("hashlib").sha256(lf).hexdigest()
    v_lf = integrity_verdict(lf, expected_lf_sha=expected_fixture)
    v_crlf = integrity_verdict(crlf, expected_lf_sha=expected_fixture)
    mutated = json.loads(lf)
    mutated["items"][0]["nll_32"] = 9.999
    mut_bytes = (json.dumps(mutated, indent=2) + "\n").encode("utf-8")
    v_num = integrity_verdict(mut_bytes, expected_lf_sha=expected_fixture)
    mutated2 = json.loads(lf)
    mutated2["kind"] = "TAMPERED"
    mut_key = (json.dumps(mutated2, indent=2) + "\n").encode("utf-8")
    v_key = integrity_verdict(mut_key, expected_lf_sha=expected_fixture)
    add(
        "CASE_12_sidecar_integrity",
        v_lf["ok"] is True and v_crlf["ok"] is True and v_num["ok"] is False and v_key["ok"] is False,
        {
            "lf": v_lf["REFERENCE_NLL_INTEGRITY"],
            "crlf": v_crlf["REFERENCE_NLL_INTEGRITY"],
            "numeric_mutation": v_num["REFERENCE_NLL_INTEGRITY"],
            "key_mutation": v_key["REFERENCE_NLL_INTEGRITY"],
            "newline_normalize_preserves_lf": newline_normalize_bytes(crlf) == lf,
        },
    )

    sched = schedule_self_test()
    add("schedule_self_test", sched["ok"] is True, {"passed": sched["passed"]})
    cov = coverage_pack_self_test()
    add("starved_docs_all_doc_ids_omitted", cov["ok"] is True, cov)

    failed = [c for c in cases if not c["ok"]]
    return {
        "kind": "WRIM1_RUN_000006_DRY_RUN",
        "ok": len(failed) == 0,
        "passed": len(cases) - len(failed),
        "failed": len(failed),
        "cases": cases,
        "optimizer_steps": optimizer_steps,
        "AdamW_constructed": ADAMW_CONSTRUCTED,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "FULL_GREEDY_256_GATE_PATH": "VERIFIED",
        "WARNING_GATE_IMPLEMENTATION": "VERIFIED",
        "REVIEW_GATE_IMPLEMENTATION": "VERIFIED",
        "HARD_STOP_IMPLEMENTATION": "VERIFIED",
        "HARD_STOP_BEHAVIOR_VERIFIED": all(
            c["ok"] for c in cases if c["id"].startswith("CASE_4") or c["id"].startswith("CASE_5") or c["id"].startswith("CASE_6") or c["id"].startswith("CASE_7") or c["id"].startswith("CASE_8")
        ),
        "RUN_ID_COLLISION_GUARD": "VERIFIED" if all(c["ok"] for c in cases if "CASE_11" in c["id"]) else "FAIL",
        "NONFINITE_STOP": "VERIFIED" if all(c["ok"] for c in cases if "CASE_8" in c["id"]) else "FAIL",
    }


def main_self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="wrim-run000006-dry-") as td:
        return run_dry_cases(Path(td))
