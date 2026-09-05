#!/usr/bin/env python3
"""Regression fixtures for the R03_prior_turn_underspecified remediation.

Fixed backlog item: R03_prior_turn_underspecified (lowest deterministic-rule
precision in WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001, 0.8478260869565217,
7 false positives / 46 triggers). Source of truth for these fixtures is
model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001/
fresh-cases.jsonl and failure-taxonomy.json (POST_TEST_REMEDIATION_CANDIDATE).

Two failure shapes, both against R03 (requires: multi_turn, prior_underspecified -> MEMORY):

1. False positives (gold NO_TOOL, R03 fired MEMORY): the prior turn already states
   the concrete value in plain words after "at ..." (no digit/quote), so the old
   CONCRETE_VALUE regex missed it and treated the turn as underspecified.
2. False negatives (gold MEMORY, R02 fired NO_TOOL instead): the prior turn contains
   a stray digit inside a label (e.g. "stall B12") alongside an explicit
   "but I am not repeating it" disclaimer; the old CONCRETE_VALUE regex treated the
   stray digit as a supplied value and overrode the disclaimer.

Does not train WRIM. Does not train LoRA. Does not touch production. Pure
deterministic-rule check; no lexical/WRIM components involved.
"""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from native_router_v1 import apply_deterministic_rules  # noqa: E402

R03_FALSE_POSITIVE_FIXTURES = [
    ("fg_glider-tow_mt_notool", "Prior turn: we locked tow queue at four waiting. Current: what value did we lock?", "NO_TOOL"),
    ("fg_bee-yard_mt_notool", "Prior turn: we locked nectar flow at late linden. Current: what value did we lock?", "NO_TOOL"),
    ("fg_salt-pan_mt_notool", "Prior turn: we locked harvest window at dawn only. Current: what value did we lock?", "NO_TOOL"),
    ("fg_tide-gate_mt_notool", "Prior turn: we locked sluice opening at half-rise. Current: what value did we lock?", "NO_TOOL"),
    ("fg_rowboat-club_mt_notool", "Prior turn: we locked shell eight assignment at crew D. Current: what value did we lock?", "NO_TOOL"),
    ("fg_puppet-stage_mt_notool", "Prior turn: we locked act two cue at lantern drop. Current: what value did we lock?", "NO_TOOL"),
    ("fg_ropewalk_mt_notool", "Prior turn: we locked hemp lay at Z-lay. Current: what value did we lock?", "NO_TOOL"),
]

R03_FALSE_NEGATIVE_FIXTURES = [
    ("fg_market-stall_mt_memory", "Prior turn: we picked a stall B12 rent but I am not repeating it. Current: which value did we pick?", "MEMORY"),
    ("fg_cheese-cave_mt_memory", "Prior turn: we picked a wheel 19 age but I am not repeating it. Current: which value did we pick?", "MEMORY"),
    ("fg_lichen-plot_mt_memory", "Prior turn: we picked a plot 4 cover but I am not repeating it. Current: which value did we pick?", "MEMORY"),
]


def main() -> int:
    results = []

    def check(name: str, fn):
        try:
            fn()
            results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    for request_id, text, gold in R03_FALSE_POSITIVE_FIXTURES:
        def run(text=text, gold=gold, request_id=request_id):
            det = apply_deterministic_rules(text)
            if not det["high_confidence"] or det["predicted_class"] != gold:
                raise AssertionError(f"{request_id}: expected {gold}, got {det['predicted_class']} (rules_fired={det['rules_fired']})")

        check(f"R03 false-positive fixed: {request_id}", run)

    for request_id, text, gold in R03_FALSE_NEGATIVE_FIXTURES:
        def run(text=text, gold=gold, request_id=request_id):
            det = apply_deterministic_rules(text)
            if not det["high_confidence"] or det["predicted_class"] != gold:
                raise AssertionError(f"{request_id}: expected {gold}, got {det['predicted_class']} (rules_fired={det['rules_fired']})")

        check(f"R03 false-negative fixed: {request_id}", run)

    # Guard: R02 (prior_turn_concrete -> NO_TOOL) must still fire correctly on a
    # genuinely concrete, non-withheld prior turn (no regression on the sibling rule).
    def r02_still_works():
        det = apply_deterministic_rules("Prior turn: the ceiling is 42 feet. Current: what did we say the ceiling was?")
        if not det["high_confidence"] or det["predicted_class"] != "NO_TOOL":
            raise AssertionError(f"R02 regressed: {det}")

    check("R02 sibling rule unaffected", r02_still_works)

    write = SCRIPT_DIR.parent.parent / "model-lab" / "manifests" / "wr_tool_experiments" / "WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION" / "r03-remediation-regression.json"
    write.parent.mkdir(parents=True, exist_ok=True)
    import json

    write.write_text(json.dumps({"results": results, "pass": all(r["ok"] for r in results), "n": len(results)}, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
