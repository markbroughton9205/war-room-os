#!/usr/bin/env python3
"""Regression fixtures for the compact TOOL= lexical-fallback remediation.

Fixed backlog items (the final 6/17 of the fresh-generalization backlog):
fg_realtest_mem, fg_realtest_files, fg_realtest_sha, fg_realtest_mem2,
fg_realtest_files2, fg_realtest_sha2.

Reconstruction: each fixture is a compact test-harness protocol line, e.g.
"TOOL=memory\\nquery=already assigned spare cabin blue crew". No deterministic
rule fires on this syntax (none of the natural-language regexes match "TOOL=",
"query=", "path=", "text="), so information_state/gate resolve to AMBIGUOUS and
the router falls through to the family-shortlist + lexical cascade with an
*unrestricted* 6-class shortlist (capability_family is None for an AMBIGUOUS
state). The free-text tail in these fixtures is short and largely
out-of-vocabulary for the frozen BoW model (fit on natural-language trajectory
text), so its top score lands on NO_TOOL by a slim margin in every case.

This is not a lexical-normalization, tokenization, class-mapping, or confidence
threshold defect: tokenize() already extracts "tool"/"memory"/"files"/"sha256"
as literal in-vocabulary tokens, and the BoW model's own class rankings for
these rows put the correct class 2nd, not far behind NO_TOOL. The actual defect
is that the shortlist stage (the pipeline step between the gate and the lexical
fallback) never gets narrowed for this syntax, so a noisy, near-tied 6-way BoW
vote decides instead of the tool the input explicitly names.

Fix (lexical-fallback layer only, not a new deterministic rule): added
DECLARED_TOOL_DIRECTIVE / declared_tool_class() in native_router_v1.py, which
recognizes an explicit "tool=<x>" directive using the router's own existing
tool-id/EVAL6-class vocabulary (TOOL_ID_TO_EVAL6) and narrows the shortlist
handed to the family-then-lexical cascade to that single class. It only
applies in the main cascade (mode in {"det", "det_lex", "det_wrim", "full"})
and never touches the pure "lex"/"wrim"/"lex_wrim" ablation modes, so those
ablation numbers still measure raw component behavior, unchanged. It does not
change RULE_SPECS (rule count and hash stay at 10), does not change the
information-state classifier or gate, and does not hardcode any fixture ID —
it is driven entirely by the literal "tool=" directive text, which is why the
six already-passing sibling fixtures below (declaring web/research/none) work
identically through the same code path.

Does not train WRIM. Does not train LoRA. Does not touch production. Pure
deterministic + lexical-fallback check; no WRIM component involved.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file  # noqa: E402
from native_router_v1 import NativeRouterV1, parse_tool_registry_cards  # noqa: E402
from paths import NATIVE_ROUTER_V1_DIR  # noqa: E402

# The six documented failures.
TARGET_FIXTURES = [
    ("fg_realtest_mem", "TOOL=memory\nquery=already assigned spare cabin blue crew", "MEMORY"),
    ("fg_realtest_files", "TOOL=files\npath=docs/cedar-tram-bulletin.md", "FILES"),
    ("fg_realtest_sha", "TOOL=sha256\ntext=tram-hold-14m", "SHA256"),
    ("fg_realtest_mem2", "TOOL=memory\nquery=already standardized vat four pH", "MEMORY"),
    ("fg_realtest_files2", "TOOL=files\npath=docs/silk-dye-sop.md", "FILES"),
    ("fg_realtest_sha2", "TOOL=sha256\ntext=vat4-pH81", "SHA256"),
]

# Sibling non-regression fixtures within the same compact TOOL= protocol family
# (already passing before this fix, via deterministic rules or a lucky lexical
# guess) — must still resolve correctly through the same code path.
TOOL_DIRECTIVE_SIBLING_FIXTURES = [
    ("fg_realtest_none", "TOOL=none", "NO_TOOL"),
    ("fg_realtest_web", "TOOL=web\nquery=cedar tram hold time tonight", "WEB"),
    ("fg_realtest_research", "TOOL=research\nquery=compare independent tram authority notes", "RESEARCH"),
    ("fg_realtest_none2", "TOOL=none\nnote=conceptual only", "NO_TOOL"),
    ("fg_realtest_web2", "TOOL=web\nquery=inland ferry last sailing currently", "WEB"),
    ("fg_realtest_research2", "TOOL=research\nquery=reconcile two independent textile notes", "RESEARCH"),
]

# Sibling non-regression fixtures for ordinary (non-TOOL=) natural-language
# routing, distinct from the ones already covered by the R03 and R04/R05
# regression suites — proves the declared-tool shortlist narrowing never
# engages on natural language and doesn't disturb ordinary routing.
ORDINARY_MEMORY_FIXTURE = ("fg_compost-bay_mem_b", "We already set a policy on bay three temperature; I am not repeating the number. What was it?", "MEMORY")
ORDINARY_FILES_FIXTURE = ("fg_proofing-room_files_a", "Open the docs/proofing-room-spec.md and quote the matching line from the attachment.", "FILES")
ORDINARY_SHA256_FIXTURE = ("fg_cedar-tram_sha_a", "Checksum this exact batch id: tram-hold-14m", "SHA256")


def load_frozen_bow(path: Path) -> dict:
    z = np.load(path, allow_pickle=True)
    keys = [str(k) for k in z["vocab"].tolist()]
    vocab = {k: i for i, k in enumerate(keys)}
    return {"vocab": vocab, "weights": z["weights"], "hash": sha256_file(path), "type": "v5_style_l2_bow_ova"}


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

    cards = parse_tool_registry_cards()
    bow = load_frozen_bow(NATIVE_ROUTER_V1_DIR / "lexical-bow.npz")
    router = NativeRouterV1(cards=cards, bow=bow, margin_threshold=0.12)

    def assert_route(request_id: str, text: str, gold: str) -> None:
        d = router.score(text, mode="det_lex")
        if d["predicted_class"] != gold:
            raise AssertionError(f"{request_id}: expected {gold}, got {d['predicted_class']} (stage={d['decision_stage']})")

    for request_id, text, gold in TARGET_FIXTURES:
        check(f"TOOL= lexical-fallback fixed: {request_id}", lambda request_id=request_id, text=text, gold=gold: assert_route(request_id, text, gold))

    for request_id, text, gold in TOOL_DIRECTIVE_SIBLING_FIXTURES:
        check(f"TOOL= directive non-regression: {request_id}", lambda request_id=request_id, text=text, gold=gold: assert_route(request_id, text, gold))

    for request_id, text, gold in (ORDINARY_MEMORY_FIXTURE, ORDINARY_FILES_FIXTURE, ORDINARY_SHA256_FIXTURE):
        check(f"ordinary natural-language non-regression: {request_id}", lambda request_id=request_id, text=text, gold=gold: assert_route(request_id, text, gold))

    # Guard: the shortlist-narrowing signal must not fire on ordinary natural
    # language (it is driven only by a literal "tool=" directive).
    def no_false_trigger():
        from native_router_v1 import declared_tool_class

        for _, text, _ in (ORDINARY_MEMORY_FIXTURE, ORDINARY_FILES_FIXTURE, ORDINARY_SHA256_FIXTURE):
            if declared_tool_class(text) is not None:
                raise AssertionError(f"declared_tool_class false-triggered on ordinary text: {text!r}")

    check("declared-tool signal does not false-trigger on ordinary text", no_false_trigger)

    write = SCRIPT_DIR.parent.parent / "model-lab" / "manifests" / "wr_tool_experiments" / "WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION" / "lexical-fallback-remediation-regression.json"
    write.parent.mkdir(parents=True, exist_ok=True)
    import json

    write.write_text(json.dumps({"results": results, "pass": all(r["ok"] for r in results), "n": len(results)}, indent=2) + "\n")
    failed = [r for r in results if not r["ok"]]
    print(f"TOTAL={len(results)} PASS={len(results)-len(failed)} FAIL={len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
