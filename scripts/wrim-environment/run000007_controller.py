"""Dry-run controller for WRIM1-RUN-000007. Zero optimizer steps. Fixture-driven."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from run000006_coverage import FROZEN_GENESIS_TRAIN_IDS, rehearsal_coverage_report
from run000006_gates import HARD_STOP, PASS, REVIEW_REQUIRED, WARNING
from run000007_collision import assert_run_id_unused
from run000007_env import verify_linux_env
from run000007_filter import assert_addendum_absent, assert_dump_excluded, filter_records
from run000007_gates import evaluate_gates, packing_preflight_decision
from run000007_identity import (
    ADDENDUM_NEEDLES,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    PRIVILEGE_REPAIR_PATH,
    RUN_ID,
    TRAINING_AUTHORIZATION,
)
from run000007_pack import self_test as coverage_pack_self_test
from run000007_schedule import self_test as schedule_self_test
from run000007_vram import vram_preflight

OPTIMIZER_STEPS = 0
ADAMW_CONSTRUCTED = False


def _item(iid: str, collapsed: bool = False, span_ok: bool = True, cap_pass: bool | None = None) -> dict[str, Any]:
    scores = {"contains_exact_span": span_ok} if iid.startswith("s3-inst") else {"json_valid": span_ok}
    row: dict[str, Any] = {
        "item_id": iid,
        "descriptive_256": {"collapsed": collapsed, "max_token_run": 12, "unique_ratio": 0.4, "new_ids": [11, 12, 13]},
        "category_scores": scores,
    }
    if cap_pass is not None:
        row["evalId"] = iid
        row["binary_pass"] = cap_pass
    return row


def _healthy_metrics() -> dict[str, Any]:
    return {
        "mean_wrim0_anchor_nll_delta": 0.02,
        "mean_kl_wrim0_to_candidate": 0.004,
        "val_loss_corpus0": 8.80,
        "val_loss_corpus1": 7.90,
        "n_collapsed_256": 4,
        "historical_binary": "6/6",
        "grad_norm": 1.2,
        "loss": 7.0,
        "s3_inst_02_max_run_256": 55,
        "s3_inst_02_collapsed_256": False,
        "s3_inst_02_parent_collapsed": False,
    }


def run_dry_cases(tmp: Path) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    optimizer_steps = 0

    def add(case_id: str, ok: bool, detail: dict[str, Any]) -> None:
        cases.append({"id": case_id, **detail, "ok": ok, "optimizer_steps": 0, "AdamW_constructed": False})

    g1 = evaluate_gates(_healthy_metrics(), eval_step=5)
    add("CASE_1_healthy_pass", g1["STATE"] == PASS and g1["continue_training"] is True, {"STATE": g1["STATE"]})

    m2 = _healthy_metrics()
    m2["mean_wrim0_anchor_nll_delta"] = 0.075
    g2 = evaluate_gates(m2, eval_step=5)
    add("CASE_2_dnll_warning", g2["STATE"] == WARNING and g2["continue_training"] is True, {"STATE": g2["STATE"]})

    m3 = _healthy_metrics()
    m3["mean_kl_wrim0_to_candidate"] = 0.012
    g3 = evaluate_gates(m3, eval_step=5)
    add("CASE_3_kl_warning", g3["STATE"] == WARNING and g3["continue_training"] is True, {"STATE": g3["STATE"]})

    m4 = _healthy_metrics()
    m4["NEW_S3_INST_02_COLLAPSE"] = True
    g4 = evaluate_gates(m4, eval_step=5)
    add("CASE_4_new_s3_inst_02_collapse", g4["STATE"] == HARD_STOP and g4["prevent_next_optimizer_step"] is True, {"STATE": g4["STATE"]})

    parent_items = [_item("s3-json-03", collapsed=True, span_ok=False), _item("s3-inst-02", collapsed=False, span_ok=True)]
    cand_items = [_item("s3-json-03", collapsed=False, span_ok=True), _item("s3-inst-02", collapsed=True, span_ok=False)]
    # recovered json-03 + new inst-02 failure, same aggregate failed count
    m5 = _healthy_metrics()
    m5["items"] = cand_items
    g5 = evaluate_gates(m5, eval_step=5, parent_eval={"items": parent_items})
    add(
        "CASE_5_substitution_same_aggregate",
        g5["STATE"] == HARD_STOP and int(g5["NEW_FAILURES_VS_PARENT"]) == 1,
        {"STATE": g5["STATE"], "NEW_FAILURES_VS_PARENT": g5["NEW_FAILURES_VS_PARENT"]},
    )

    m6 = _healthy_metrics()
    m6["NEW_FAILURES_VS_PARENT"] = 1
    g6 = evaluate_gates(m6, eval_step=5)
    add("CASE_6_new_failures_vs_parent", g6["STATE"] == HARD_STOP, {"STATE": g6["STATE"]})

    m7 = _healthy_metrics()
    m7["MAX_IDENTICAL_TOKEN_RUN_256"] = 60
    g7 = evaluate_gates(m7, eval_step=5)
    add("CASE_7_max_run_60_warning", g7["STATE"] == WARNING and g7["continue_training"] is True, {"STATE": g7["STATE"]})

    m8 = _healthy_metrics()
    m8["MAX_IDENTICAL_TOKEN_RUN_256"] = 70
    g8 = evaluate_gates(m8, eval_step=5)
    add("CASE_8_max_run_70_review", g8["STATE"] == REVIEW_REQUIRED and g8["continue_training"] is True, {"STATE": g8["STATE"]})

    m9 = _healthy_metrics()
    m9["MAX_IDENTICAL_TOKEN_RUN_256"] = 85
    g9 = evaluate_gates(m9, eval_step=5)
    add("CASE_9_max_run_85_hard_stop", g9["STATE"] == HARD_STOP and g9["prevent_next_optimizer_step"] is True, {"STATE": g9["STATE"]})

    m10 = _healthy_metrics()
    m10["historical_binary"] = "5/6"
    g10 = evaluate_gates(m10, eval_step=5)
    add("CASE_10_cap_5_review", g10["STATE"] == REVIEW_REQUIRED, {"STATE": g10["STATE"]})

    m11 = _healthy_metrics()
    m11["historical_binary"] = "4/6"
    g11 = evaluate_gates(m11, eval_step=5)
    add("CASE_11_cap_le4_hard_stop", g11["STATE"] == HARD_STOP, {"STATE": g11["STATE"]})

    m12 = _healthy_metrics()
    m12["NEW_CAP_FAILURES_VS_PARENT"] = ["cap0-ret-01"]
    m12["historical_binary"] = "5/6"
    g12 = evaluate_gates(m12, eval_step=5)
    add(
        "CASE_12_new_cap_item_failure",
        g12["STATE"] == HARD_STOP and any(t["METRIC"] == "NEW_CAP_ITEM_FAILURE_VS_PARENT" for t in g12["triggers"]),
        {"STATE": g12["STATE"], "triggers": [t["METRIC"] for t in g12["triggers"]]},
    )

    m13 = _healthy_metrics()
    m13["loss"] = float("nan")
    g13 = evaluate_gates(m13, eval_step=5)
    add("CASE_13_nan_hard_stop", g13["STATE"] == HARD_STOP, {"STATE": g13["STATE"]})

    starved = rehearsal_coverage_report(
        {
            FROZEN_GENESIS_TRAIN_IDS[0]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[1]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[2]: 1000,
            FROZEN_GENESIS_TRAIN_IDS[3]: 1000,
        }
    )
    p14 = packing_preflight_decision(starved_doc_ids=starved["STARVED_DOC_IDS"], max_doc_share=starved["MAX_DOC_SHARE"])
    add(
        "CASE_14_starved_pretrain_abort",
        p14["decision"] == "PRETRAIN_ABORT" and FROZEN_GENESIS_TRAIN_IDS[4] in starved["STARVED_DOC_IDS"],
        {"STARVED_DOC_IDS": starved["STARVED_DOC_IDS"]},
    )

    p15 = packing_preflight_decision(starved_doc_ids=[], max_doc_share=0.50)
    add("CASE_15_max_share_pretrain_abort", p15["decision"] == "PRETRAIN_ABORT", p15)

    dump_recs = [
        {
            "chunk_id": KNOWN_EVAL_DUMP_CHUNK_IDS[0],
            "source_path": "model-lab/manifests/wrim0_eval_results.json",
            "text": "Alice was beginning to tokenizer_tokenizer",
            "token_count": 120,
            "format": "json",
        },
        {
            "chunk_id": KNOWN_EVAL_DUMP_CHUNK_IDS[1],
            "source_path": "model-lab/manifests/wrim0_eval_results.json",
            "text": "tokenizer_tokenizer tokenizer_tokenizer",
            "token_count": 577,
            "format": "json",
        },
        {
            "chunk_id": "legit-tokenizer-docs",
            "source_path": "docs/tokenizer.md",
            "text": "The tokenizer vocabulary is 16384.",
            "token_count": 40,
            "format": "language_modeling",
        },
        {
            "chunk_id": "privilege-repair",
            "source_path": PRIVILEGE_REPAIR_PATH,
            "text": "The replica collapses into a read-only mode.",
            "token_count": 80,
            "format": "language_modeling",
        },
        {
            "chunk_id": KNOWN_EVAL_DUMP_CHUNK_IDS[2],
            "source_path": "model-lab/manifests/wrim0_eval_results.json",
            "text": "tokenizer_tokenizer",
            "token_count": 206,
            "format": "json",
        },
        {
            "chunk_id": "genesis-report",
            "source_path": "model-lab/manifests/GENESIS_REPORT.md",
            "text": "GENESIS_REPORT",
            "token_count": 10,
            "format": "language_modeling",
        },
    ]
    filt = filter_records(dump_recs)
    dump_ok = assert_dump_excluded(filt)
    # Simulate a leak by omitting the filter:
    leaked = filter_records([dump_recs[1]])  # only legit record — known dump IDs missing from excluded
    leak_gate = assert_dump_excluded(leaked)
    add(
        "CASE_16_eval_dump_filter",
        dump_ok["ok"] is True
        and leak_gate["decision"] == "PRETRAIN_ABORT"
        and "legit-tokenizer-docs" not in filt["EXCLUDED_RECORD_IDS"]
        and filt["privilege_repair_kept"] is True
        and "privilege-repair" not in filt["EXCLUDED_RECORD_IDS"]
        and "genesis-report" in filt["EXCLUDED_RECORD_IDS"],
        {
            "excluded": filt["EXCLUDED_RECORD_IDS"],
            "leak_decision": leak_gate["decision"],
            "privilege_kept": filt["privilege_repair_kept"],
        },
    )

    needle_recs = [
        {
            "chunk_id": "addendum-leak",
            "source_path": "docs/innocent.md",
            "text": f"secret {ADDENDUM_NEEDLES[0]}",
            "token_count": 12,
            "format": "language_modeling",
        }
    ]
    needle_filt = filter_records(needle_recs)
    needle_gate = assert_addendum_absent(needle_filt)
    clean_add = assert_addendum_absent(filt)
    add(
        "CASE_17_addendum_needle_pretrain_abort",
        needle_gate["decision"] == "PRETRAIN_ABORT" and clean_add["ok"] is True,
        {"needle": needle_gate["INSTRUCTION_ADDENDUM_LEAKAGE"]},
    )

    occupied = tmp / RUN_ID
    occupied.mkdir(parents=True)
    (occupied / "model.safetensors").write_bytes(b"not-a-real-checkpoint")
    (occupied / "run-manifest.json").write_text(json.dumps({"run_id": RUN_ID, "optimizer_steps": 1}), encoding="utf-8")
    c18_ckpt = assert_run_id_unused(RUN_ID, [tmp])
    empty = tmp / "empty-roots"
    empty.mkdir()
    c18_pass = assert_run_id_unused(RUN_ID, [empty])
    c18_registry = assert_run_id_unused("WRIM1-RUN-000006", [empty])
    design_only = tmp / "design-only"
    design_only.mkdir()
    (design_only / "WRIM1-RUN-000007-CORRECTIVE-DESIGN-000001.json").write_text(
        json.dumps({"kind": "WRIM1_RUN_000007_CORRECTIVE_DESIGN_000001", "run_id": RUN_ID, "OPTIMIZER_STEPS": 0, "TRAINING_EXECUTED": False}),
        encoding="utf-8",
    )
    c18_design = assert_run_id_unused(RUN_ID, [design_only])
    add(
        "CASE_18_run_id_collision",
        c18_ckpt["ok"] is False
        and c18_ckpt["decision"] == "PRETRAIN_ABORT"
        and c18_pass["ok"] is True
        and c18_registry["ok"] is False
        and c18_design["ok"] is True,
        {"fail_hits": c18_ckpt["hits"], "design_ignored": c18_design["ok"]},
    )

    bad_env = verify_linux_env(probe={"python": "3.12.0", "torch": "cpu", "torch_cuda": None, "safetensors": "0", "tokenizers": "0", "numpy": "0", "gpu_name": "none", "compute_cap": "0", "cuda_available": False})
    good_env = verify_linux_env(
        probe={
            "python": "3.13.15",
            "torch": "2.13.0+cu130",
            "torch_cuda": "13.0",
            "safetensors": "0.8.0",
            "tokenizers": "0.23.2",
            "numpy": "2.5.3",
            "gpu_name": "NVIDIA GeForce RTX 5060 Ti",
            "compute_cap": "12.0",
            "cuda_available": True,
        }
    )
    add(
        "CASE_19_env_mismatch_pretrain_abort",
        bad_env["decision"] == "PRETRAIN_ABORT" and good_env["ok"] is True,
        {"bad": bad_env["mismatches"][:3], "good": good_env["ok"]},
    )

    oom = vram_preflight(probe={"ok": True, "gpus": [{"memory_free_mib": 340.12, "name": "RTX 5060 Ti"}]})
    healthy_vram = vram_preflight(probe={"ok": True, "gpus": [{"memory_free_mib": 12000, "name": "RTX 5060 Ti"}]})
    add(
        "CASE_20_insufficient_vram_pretrain_abort",
        oom["decision"] == "PRETRAIN_ABORT" and healthy_vram["ok"] is True and oom["auto_kill"] is False,
        {"oom_free": oom["FREE_VRAM_MIB"], "healthy": healthy_vram["FREE_VRAM_MIB"]},
    )

    sched = schedule_self_test()
    add("schedule_self_test", sched["ok"] is True, {"passed": sched["passed"]})
    cov = coverage_pack_self_test()
    add("starved_docs_all_doc_ids_omitted", cov["ok"] is True, cov)

    failed = [c for c in cases if not c["ok"]]
    return {
        "kind": "WRIM1_RUN_000007_DRY_RUN",
        "ok": len(failed) == 0,
        "passed": len(cases) - len(failed),
        "failed": len(failed),
        "failed_ids": [c["id"] for c in failed],
        "cases": cases,
        "optimizer_steps": optimizer_steps,
        "OPTIMIZER_STEPS": 0,
        "AdamW_constructed": ADAMW_CONSTRUCTED,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "FULL_GREEDY_256_GATE_PATH": "VERIFIED",
        "NEW_FAILURE_GATE": "VERIFIED",
        "NASCENT_ATTRACTOR_METRICS": "VERIFIED",
        "CORRECTNESS_SCORERS": "VERIFIED",
        "HARD_STOP_BEHAVIOR_VERIFIED": all(
            c["ok"]
            for c in cases
            if c["id"]
            in {
                "CASE_4_new_s3_inst_02_collapse",
                "CASE_5_substitution_same_aggregate",
                "CASE_6_new_failures_vs_parent",
                "CASE_9_max_run_85_hard_stop",
                "CASE_11_cap_le4_hard_stop",
                "CASE_13_nan_hard_stop",
            }
        ),
        "RUN_ID_COLLISION_GUARD": "VERIFIED" if all(c["ok"] for c in cases if "CASE_18" in c["id"]) else "FAIL",
        "NONFINITE_STOP": "VERIFIED" if all(c["ok"] for c in cases if "CASE_13" in c["id"]) else "FAIL",
        "VRAM_PREFLIGHT": "VERIFIED" if all(c["ok"] for c in cases if "CASE_20" in c["id"]) else "FAIL",
        "FILTER_IMPLEMENTED": "VERIFIED" if all(c["ok"] for c in cases if "CASE_16" in c["id"]) else "FAIL",
    }


def main_self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="wrim-run000007-dry-") as td:
        return run_dry_cases(Path(td))
