#!/usr/bin/env python3
"""Regression fixtures for the R04_open_artifact vs R05_durable_already remediation.

Fixed backlog item: fg_observatory_mem_a (the only case in the 768-row fresh-
generalization SIX_WAY corpus where OPEN_ARTIFACT and MEMORY_ALREADY both fire —
confirmed by scanning every fixture that triggers either flag: 168/168 pass after
this fix, 167/168 already passed before it).

Root cause: OPEN_ARTIFACT matched the bare phrase "open the ..." with no regard for
sentence frame, so "Did we already open the shutter at 21:10?" tripped R04_open_artifact
(-> FILES) before R05_durable_already (-> MEMORY) ever got a chance, because R04 is
ordered first in RULE_SPECS. The sentence is a past-completion recall question ("did we
already ...") about whether an action already happened, not a live "open this document"
command — a missing temporal/completion-state distinction, not a precedence bug to fix
by reordering (reordering would instead break every legitimate R04 case that also
happens to mention "already" elsewhere in a longer prompt).

Fix: added ALREADY_DONE_QUESTION ("did/have we/you/i already ...") and gated
open_artifact off whenever that completion-question frame is present, so R04 no longer
fires as a false trigger and R05 (or the underlying durable-memory state) resolves
the question correctly. Confirmed against every other OPEN_ARTIFACT/MEMORY_ALREADY
fixture in the corpus: no fixture other than fg_observatory_mem_a mixes "already"
with an open/read phrase, so this cannot regress a legitimate FILES case.

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

# The documented failure.
TARGET_FIXTURE = ("fg_observatory_mem_a", "Did we already open the shutter at 21:10?", "MEMORY")

# Sibling non-regression fixtures: legitimate R04_open_artifact behavior (live
# open/read-a-document requests) must still route to FILES.
R04_SIBLING_FIXTURES = [
    ("fg_cedar-tram_files_a", "Open the docs/cedar-tram-bulletin.md and quote the matching line from the attachment.", "FILES"),
    ("fg_cedar-tram_files_b", "Read the cedar-tram-bulletin.md in the workspace and trace the tram hold time row.", "FILES"),
    ("fg_compost-bay_files_a", "Open the docs/compost-bay-log.md and quote the matching line from the attachment.", "FILES"),
    ("fg_quarry-radio_files_b", "Read the quarry-radio-sop.md in the workspace and trace the night channel row.", "FILES"),
]

# Sibling non-regression fixtures: legitimate R05_durable_already behavior (recall of a
# prior durable decision, including "did we already <verb>" phrasing without "open")
# must still route to MEMORY.
R05_SIBLING_FIXTURES = [
    ("fg_cedar-tram_mem_a", "Did we already assign the spare cabin to blue crew?", "MEMORY"),
    ("fg_cedar-tram_mem_b", "We already set a policy on tram hold time; I am not repeating the number. What was it?", "MEMORY"),
    ("fg_compost-bay_mem_a", "Did we already reserve bay three for leaf mix?", "MEMORY"),
    ("fg_quarry-radio_mem_a", "Did we already lock night channel 7?", "MEMORY"),
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

    def assert_route(request_id: str, text: str, gold: str) -> None:
        det = apply_deterministic_rules(text)
        if not det["high_confidence"] or det["predicted_class"] != gold:
            raise AssertionError(f"{request_id}: expected {gold}, got {det['predicted_class']} (rules_fired={det['rules_fired']})")

    request_id, text, gold = TARGET_FIXTURE
    check(f"R04/R05 documented failure fixed: {request_id}", lambda: assert_route(request_id, text, gold))

    for request_id, text, gold in R04_SIBLING_FIXTURES:
        check(f"R04 open-artifact non-regression: {request_id}", lambda request_id=request_id, text=text, gold=gold: assert_route(request_id, text, gold))

    for request_id, text, gold in R05_SIBLING_FIXTURES:
        check(f"R05 durable-already non-regression: {request_id}", lambda request_id=request_id, text=text, gold=gold: assert_route(request_id, text, gold))

    write = SCRIPT_DIR.parent.parent / "model-lab" / "manifests" / "wr_tool_experiments" / "WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION" / "r04-r05-remediation-regression.json"
    write.parent.mkdir(parents=True, exist_ok=True)
    import json

    write.write_text(json.dumps({"results": results, "pass": all(r["ok"] for r in results), "n": len(results)}, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
