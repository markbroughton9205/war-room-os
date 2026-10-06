"""Promptbook self-validation. Isolated temp live dir. Zero WRIM optimizer steps."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from wrim_promptbook.curriculum import curriculum_graph, ordered_school_ids, school_by_id
from wrim_promptbook.engine import Engine, PromptbookError, ReturnBoundary
from wrim_promptbook.identity import (
    CURRENT_MISSION,
    CURRENT_SCHOOL,
    EXPERIMENT_STATUSES,
    PARENT_HASH,
    PROHIBITED_ALWAYS,
    RETURN_BOUNDARIES,
    RMR1_EXTRA_UNSEEN_RECALL,
    STRATEGY_CEILING,
)
from wrim_promptbook.store import read_json, read_jsonl, write_json


class _Fail(AssertionError):
    pass


def _eng(tmp: Path) -> Engine:
    spec = tmp / "spec"
    live = tmp / "live"
    e = Engine(spec_dir=spec, live_dir=live)
    e.bootstrap()
    return e


def test_graph_parses() -> None:
    g = curriculum_graph()
    ids = ordered_school_ids(g)
    assert "SCHOOL_04_RESPONSE_MODE_ROUTING" in ids
    assert "SCHOOL_05_NATURAL_ENTRY" in ids
    assert "SCHOOL_15_FOUNDATION_GRADUATION" in ids
    s4 = school_by_id(g, "SCHOOL_04_RESPONSE_MODE_ROUTING")
    assert s4["missions"][0]["id"] == "MOD_02A"
    assert s4["missions"][0]["do_not_rerun"] is True
    assert g["current_school"] == CURRENT_SCHOOL
    assert g["mod_02a_imported"] is True
    assert len(g["rael_bridge"]) == 11


def test_state_transitions(tmp: Path) -> None:
    e = _eng(tmp)
    st = e.load_state()
    assert st["CURRENT_SCHOOL"] == CURRENT_SCHOOL
    assert st["CURRENT_MISSION"] == CURRENT_MISSION
    out = e.advance_if_allowed("SCHOOL_06_NATURAL_CONTINUATION")
    assert out["CURRENT_SCHOOL"] == "SCHOOL_06_NATURAL_CONTINUATION"
    try:
        e.advance_if_allowed("SCHOOL_15_FOUNDATION_GRADUATION")
        raise _Fail("illegal skip allowed")
    except PromptbookError:
        pass


def test_ledger_and_mod02a_import(tmp: Path) -> None:
    e = _eng(tmp)
    rows = read_jsonl(e.paths()["ledger"])
    ids = [r["experiment_id"] for r in rows]
    assert "EXP-MOD-02A-RMR1" in ids
    mod = next(r for r in rows if r["experiment_id"] == "EXP-MOD-02A-RMR1")
    assert mod["status"] == "COMPLETED"
    assert mod["do_not_rerun"] is True
    assert mod["physical_tokens"] == 0
    e.append_ledger({
        "experiment_id": "EXP-TEST-1",
        "school": "SCHOOL_05_NATURAL_ENTRY",
        "status": "PLANNED",
        "hypothesis": "unit",
    })
    assert any(r["experiment_id"] == "EXP-TEST-1" for r in read_jsonl(e.paths()["ledger"]))
    for s in EXPERIMENT_STATUSES:
        assert s


def test_checkpoint_registry(tmp: Path) -> None:
    e = _eng(tmp)
    reg = read_json(e.paths()["registry"])
    ids = [c["id"] for c in reg["checkpoints"]]
    assert "STEP_400" in ids
    assert "WRIM1-UH1-AC2-EA1-000010/step-25" in ids
    rmr = next(c for c in reg["checkpoints"] if c["id"] == "WRIM_RMR1_MOD02A")
    assert rmr["production_ready"] is False
    assert rmr["may_be_parent"] is False
    assert rmr["two_token_regression_open"] is True


def test_capability_matrix(tmp: Path) -> None:
    e = _eng(tmp)
    m = read_json(e.paths()["matrix"])
    assert m["RESPONSE_MODE_ROUTING"] == "PASS_EXPERIMENTAL"
    assert m["ROUTER_PRODUCTION_READINESS"] == "FAIL"
    assert m["ROUTER_REGRESSION_OPEN"] == "YES"
    assert m["NATURAL_ENTRY"] == "EMERGING"
    assert m["FOUNDATION_GRADUATION"] == "NOT_READY"
    assert abs(float(RMR1_EXTRA_UNSEEN_RECALL) - 0.45) < 1e-9


def test_evaluation_manifest(tmp: Path) -> None:
    e = _eng(tmp)
    e.export_spec()
    from wrim_promptbook.identity import EVAL_MANIFEST_NAME
    man = json.loads((e.spec_dir / EVAL_MANIFEST_NAME).read_text(encoding="utf-8"))
    assert man["locked"] is True
    assert "natural_extra_unseen" in man["suites"]
    assert man["suites"]["graduation"]["never_train"] is True
    ev = e.evaluate("status")
    assert "structured_phrase" in ev["suites"]


def test_dry_run(tmp: Path) -> None:
    e = _eng(tmp)
    d = e.dry_run()
    assert d["optimizer_steps"] == 0
    assert d["mod_02a_rerun"] is False
    assert d["promotion"] is False
    assert "SCHOOL_05_NATURAL_ENTRY" in d["visited"]
    assert any(b.get("action") == "IMPORT_COMPLETED_MOD_02A" for b in d["branches"])
    assert any(b.get("current") for b in d["branches"])
    assert len(d["rael"]) == 11


def test_pause_resume(tmp: Path) -> None:
    e = _eng(tmp)
    e.pause()
    assert e.run_current_stage()["ok"] is False
    r = e.resume()
    assert r["replayed_tokens"] == 0
    out = e.run_current_stage()
    assert out["optimizer_constructed"] is False
    assert out["NEW_WRIM_TRAINING_PERFORMED"] is False


def test_crash_recovery_no_replay(tmp: Path) -> None:
    e = _eng(tmp)
    st = e.load_state()
    st["physical_tokens_consumed"] = 4096
    st["last_durable_token_cursor"] = 4096
    st["authorized_tokens_open"] = 204800  # stale open auth after crash
    e.save_state(st)
    rec = e.crash_recover()
    assert rec["replayed"] == 0
    assert rec["physical_tokens"] == 4096
    st2 = e.load_state()
    assert st2["authorized_tokens_open"] == 0
    assert st2["physical_tokens_consumed"] == 4096


def test_budget_enforcement(tmp: Path) -> None:
    e = _eng(tmp)
    e.enforce_budget("SCHOOL_05_NATURAL_ENTRY", 102400)
    try:
        e.enforce_budget("SCHOOL_05_NATURAL_ENTRY", 999999999)
        raise _Fail("budget not enforced")
    except ReturnBoundary as b:
        assert b.code == "TOKEN_BUDGET_EXPANSION_BEYOND_MASTER_CEILING"


def test_strategy_ceiling(tmp: Path) -> None:
    e = _eng(tmp)
    school = "SCHOOL_05_NATURAL_ENTRY"
    assert e.record_strategy(school, "A") == 1
    assert e.record_strategy(school, "B") == 2
    assert e.record_strategy(school, "C") == 3
    try:
        e.record_strategy(school, "D")
        raise _Fail("strategy ceiling not enforced")
    except ReturnBoundary as b:
        assert b.code == "SCIENTIFIC_LANE_EXHAUSTED"
    assert STRATEGY_CEILING == 3


def test_return_boundaries_and_no_promote(tmp: Path) -> None:
    e = _eng(tmp)
    assert "MODEL_PROMOTION" in RETURN_BOUNDARIES
    try:
        e.refuse_promotion()
        raise _Fail("promotion not blocked")
    except ReturnBoundary as b:
        assert b.code == "MODEL_PROMOTION"
    try:
        e.refuse_rael_training()
        raise _Fail("rael not blocked")
    except ReturnBoundary as b:
        assert b.code == "RAEL_POST_FOUNDATION_EXECUTION_AUTHORIZATION"
    st = e.load_state()
    assert st["MODEL_PROMOTED"] is False
    assert st["CANONICAL_CHANGED"] is False
    assert "install_rmr1_in_runtime" in PROHIBITED_ALWAYS
    assert "rerun_mod02a_by_default" in PROHIBITED_ALWAYS


def test_no_unauthorized_optimizer(tmp: Path) -> None:
    e = _eng(tmp)
    out = e.run_current_stage()
    assert out.get("optimizer_constructed") is False
    assert out.get("optimizer_steps", 0) == 0
    # Training ON still cannot construct optimizer without approved master budget.
    st = e.load_state()
    st["TRAINING_AUTHORIZATION"] = "ON"
    e.save_state(st)
    try:
        e.run_current_stage()
        raise _Fail("optimizer path opened")
    except ReturnBoundary:
        pass


def test_authorize_foundation_diagnostic(tmp: Path) -> None:
    e = _eng(tmp)
    out = e.authorize_foundation_execution(ceiling=2_048_000, commander="MARK")
    assert out["TRAINING_AUTHORIZATION"] == "ON"
    assert out["MASTER_LM_TOKEN_CEILING"] == 2_048_000
    assert out["MASTER_LM_TOKENS_REMAINING"] == 2_048_000
    run = e.run_current_stage()
    assert run["mode"] == "DIAGNOSTIC_AUTHORIZED"
    assert run["optimizer_constructed"] is False
    assert run["NE1_AUTO_CREATE"] is False
    assert run.get("optimizer_steps", 0) == 0


def test_mod02a_not_rerun(tmp: Path) -> None:
    e = _eng(tmp)
    st = e.load_state()
    st["CURRENT_SCHOOL"] = "SCHOOL_04_RESPONSE_MODE_ROUTING"
    st["CURRENT_MISSION"] = "MOD_02A"
    e.save_state(st)
    out = e.run_current_stage()
    assert out["ok"] is False
    assert "do_not_rerun" in out["reason"]


def test_current_wrim_truth_fields(tmp: Path) -> None:
    e = _eng(tmp)
    st = e.load_state()
    assert st["PARENT_HASH"] == PARENT_HASH
    assert st["CANONICAL"] == "STEP_400"
    assert st["RMR1_TWO_TOKEN_REGRESSION_OPEN"] is True
    assert st["NE1_IMPLEMENTED"] is False
    assert st["TRAINING_AUTHORIZATION"] == "OFF"


def test_single_trainer_constant() -> None:
    from wrim_single_trainer_lock import MAX_ACTIVE_WRIM_TRAINERS
    assert MAX_ACTIVE_WRIM_TRAINERS == 1


def test_quarantine_invalid_parent(tmp: Path) -> None:
    e = _eng(tmp)
    reg = read_json(e.paths()["registry"])
    parent = next(c for c in reg["checkpoints"] if c["role"] == "EXPERIMENTAL_PARENT")
    assert parent["quarantine"] is False
    rmr = next(c for c in reg["checkpoints"] if c["id"] == "WRIM_RMR1_MOD02A")
    assert rmr["may_be_parent"] is False
    q = {
        "id": "INVALID-FZ",
        "quarantine": True,
        "may_be_parent": False,
        "promotion_status": "QUARANTINED",
    }
    reg["checkpoints"].append(q)
    write_json(e.paths()["registry"], reg)
    loaded = read_json(e.paths()["registry"])
    bad = next(c for c in loaded["checkpoints"] if c["id"] == "INVALID-FZ")
    assert bad["quarantine"] is True
    assert bad["may_be_parent"] is False


def run_all_tests() -> dict[str, Any]:
    results: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="wrim-promptbook-") as td:
        tmp = Path(td)
        tests = [
            ("curriculum_graph_parses", test_graph_parses),
            ("state_transitions", lambda: test_state_transitions(tmp / "t1")),
            ("experiment_ledger", lambda: test_ledger_and_mod02a_import(tmp / "t2")),
            ("checkpoint_registry", lambda: test_checkpoint_registry(tmp / "t3")),
            ("capability_matrix", lambda: test_capability_matrix(tmp / "t4")),
            ("evaluation_manifest", lambda: test_evaluation_manifest(tmp / "t5")),
            ("dry_run", lambda: test_dry_run(tmp / "t6")),
            ("pause_resume", lambda: test_pause_resume(tmp / "t7")),
            ("crash_recovery", lambda: test_crash_recovery_no_replay(tmp / "t8")),
            ("budget_enforcement", lambda: test_budget_enforcement(tmp / "t9")),
            ("strategy_limit", lambda: test_strategy_ceiling(tmp / "t10")),
            ("return_boundaries", lambda: test_return_boundaries_and_no_promote(tmp / "t11")),
            ("no_unauthorized_optimizer", lambda: test_no_unauthorized_optimizer(tmp / "t12")),
            ("authorize_foundation_diagnostic", lambda: test_authorize_foundation_diagnostic(tmp / "t12b")),
            ("mod02a_not_rerun", lambda: test_mod02a_not_rerun(tmp / "t13")),
            ("current_wrim_truth_loaded", lambda: test_current_wrim_truth_fields(tmp / "t14")),
            ("single_trainer_enforcement", test_single_trainer_constant),
            ("checkpoint_quarantine", lambda: test_quarantine_invalid_parent(tmp / "t15")),
        ]
        failed = []
        for name, fn in tests:
            try:
                fn()
                results[name] = "PASS"
            except Exception as exc:  # noqa: BLE001 — report all test failures
                results[name] = f"FAIL:{type(exc).__name__}:{exc}"
                failed.append(name)
    ready = all(v == "PASS" for v in results.values())
    return {
        "n": len(results),
        "failed": failed,
        "results": results,
        "PROMPTBOOK_SELF_VALIDATION": "PASS" if ready else "FAIL",
        "optimizer_steps": 0,
    }


if __name__ == "__main__":
    print(json.dumps(run_all_tests(), indent=2))
