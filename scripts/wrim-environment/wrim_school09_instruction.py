"""School 09 INSTRUCTION_FOLLOWING_HELD_OUT.

Readonly eval on WRIM-FOUNDATION-EVAL-1 items that have targets.
Never train on this suite. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_eval import greedy_from_ids
from wrim_hvu_identity import DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_promptbook.engine import Engine, ReturnBoundary
from wrim_proven_load import disable_tf32
from wrim_school06_continuation import load_ne1
from wrim_school08_multiturn import greedy_turn

REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL09_INSTRUCTION_REPORT.json"
EVAL_PATH = Path(DATA_ROOT) / "WRIM-FOUNDATION-EVAL-1-v1.0.0" / "WRIM-FOUNDATION-EVAL-1-v1.0.0.json"
CORPUS_READY = Path(DATA_ROOT) / "WRIM_INSTRUCTION_TRAIN_V1_BUILD_REPORT.json"


def eval_locked_instruction(model: Any, tok: Tokenizer, device: torch.device) -> dict[str, Any]:
    obj = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    items = [it for it in obj.get("items") or [] if it.get("target")]
    rows = []
    exact_s = exact_n = 0
    by_fam: dict[str, dict[str, int]] = {}
    attractors = {"blue": 0, "cat": 0, "dog": 0, "yes": 0, "no": 0, "ok": 0, "red": 0}
    for it in items:
        rec = {"prompt": it["prompt"], "target": it["target"], "example_id": it.get("item_id"), "family": it.get("family")}
        fam = str(it.get("family") or "unk")
        by_fam.setdefault(fam, {"n": 0, "structured_exact": 0, "natural_exact": 0})
        by_fam[fam]["n"] += 1
        try:
            s = greedy_turn(model, tok, device, rec, "ea1", "ra1")
            n = greedy_turn(model, tok, device, rec, "ne1", "bypass")
        except Exception as exc:  # noqa: BLE001
            rows.append({"id": it.get("item_id"), "error": str(exc)})
            continue
        exact_s += int(s["exact"])
        exact_n += int(n["exact"])
        by_fam[fam]["structured_exact"] += int(s["exact"])
        by_fam[fam]["natural_exact"] += int(n["exact"])
        text = str(n.get("text") or s.get("text") or "").strip().lower()
        for k in attractors:
            if text == k or text.startswith(k + " "):
                attractors[k] += 1
        rows.append({
            "id": it.get("item_id"),
            "family": it.get("family"),
            "subtype": it.get("subtype"),
            "target": it["target"],
            "structured_text": s["text"],
            "structured_exact": s["exact"],
            "natural_text": n["text"],
            "natural_exact": n["exact"],
        })
    oracle_exact = sum(int(r.get("structured_exact") or 0) or int(r.get("natural_exact") or 0) for r in rows)
    return {
        "N_WITH_TARGETS": len(items),
        "STRUCTURED_EXACT": exact_s,
        "NATURAL_EXACT": exact_n,
        "ORACLE_EXACT": oracle_exact,
        "FAMILY_BREAKDOWN": by_fam,
        "ATTRACTOR_FAILURES": attractors,
        "ROWS": rows,
        "TRAINED_ON_EVAL": False,
        "HISTORICAL_BASELINE_EXACT": 0,
    }


def main() -> dict[str, Any]:
    if CORPUS_READY.is_file():
        ready = json.loads(CORPUS_READY.read_text(encoding="utf-8"))
        if str(ready.get("SCHOOL_09_READY") or "") == "YES":
            raise SystemExit("school09_train_corpus_ready_use_wrim_s09_instruction")

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_ne1(device)
    locked = eval_locked_instruction(model, tok, device)
    n = max(1, int(locked["N_WITH_TARGETS"]))
    oracle_exact = int(locked["ORACLE_EXACT"])
    success = oracle_exact >= max(2, n // 10)
    report = {
        "kind": "WRIM_GENESIS_SCHOOL09_INSTRUCTION",
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        **locked,
        "SUCCESS": success,
        "INSTRUCTION_TRAIN_CORPUS": None,
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    rec = Engine().complete_school(
        school="SCHOOL_09_INSTRUCTION_FOLLOWING",
        success=success,
        evidence={"oracle_exact": oracle_exact, "n": len(items), "structured_exact": exact_s, "natural_exact": exact_n, "report": str(REPORT)},
        experiment_id="EXP-SCHOOL09-INSTRUCTION-HELD-OUT",
    )
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    if not success:
        raise ReturnBoundary(
            "DATA_BOUNDARY_REQUIRES_NEW_CORPUS_SOURCE",
            "School 09 held-out instruction exact is below gate. No separate instruction train corpus is encoded. Do not train on WRIM-FOUNDATION-EVAL-1.",
        )
    return report


if __name__ == "__main__":
    from wrim_promptbook.engine import ReturnBoundary as RB
    try:
        out = main()
        print(json.dumps({"ok": out["SUCCESS"], "oracle_exact": out["ORACLE_EXACT"], "n": out["N_WITH_TARGETS"], "promptbook": out.get("PROMPTBOOK"), "report": str(REPORT)}, indent=2, default=str))
    except RB as e:
        print(json.dumps({"ok": False, "return_boundary": e.code, "detail": e.detail, "report": str(REPORT)}, indent=2))
        raise SystemExit(2)
