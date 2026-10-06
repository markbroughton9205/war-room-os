"""EVAL-ONLY instruction addendum for WRIM1-RUN-000006 review.

No optimizer. No training. Does not write checkpoints or mutate corpus.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage2_eval import greedy_generate
from stage3_eval_baseline import disable_tf32, score_item, sha256_text
from wrim_g20m import WRIM0Model

SUITE_ID = "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001"
SUITE_VERSION = "1.0.0"

ITEMS: list[dict[str, Any]] = [
    {
        "item_id": "ia-format-01",
        "pattern": "exact-format",
        "prompt_text": "Output exactly this token and stop: NOK-17",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "contains_exact_span", "fingerprint"],
        "reference_payload": {"span": "NOK-17"},
    },
    {
        "item_id": "ia-multi-01",
        "pattern": "multi-constraint",
        "prompt_text": "Write exactly two lowercase words and no digits: copper lantern",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "lowercase_no_digits", "required_terms", "max_words"],
        "reference_payload": {"required_terms": ["copper", "lantern"], "max_words": 2},
    },
    {
        "item_id": "ia-short-01",
        "pattern": "short-answer",
        "prompt_text": "Reply with a single digit and stop. How many sides does a triangle have?",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "exactly_one_word", "accepted_word"],
        "reference_payload": {"accepted_words": ["3"]},
    },
    {
        "item_id": "ia-forbid-01",
        "pattern": "forbidden-token",
        "prompt_text": "One ordinary sentence about a wooden peg. Never write tokenizer, TOOL=, or Alice.",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "forbidden_terms", "no_tool_markup"],
        "reference_payload": {
            "forbidden_terms": ["tokenizer", "alice"],
            "forbid_substrings": ["TOOL=", "<|", "```"],
        },
    },
    {
        "item_id": "ia-delim-01",
        "pattern": "delimiter-structure",
        "prompt_text": "Output exactly this delimiter line and stop: BEGIN|MID|END",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "contains_exact_span"],
        "reference_payload": {"span": "BEGIN|MID|END"},
    },
    {
        "item_id": "ia-order-01",
        "pattern": "ordered-steps",
        "prompt_text": "Write PREP then SEAL in that order. Do not reverse them.",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "ordered_terms"],
        "reference_payload": {"ordered_terms": ["prep", "seal"]},
    },
    {
        "item_id": "ia-transform-01",
        "pattern": "transformation",
        "prompt_text": "Uppercase this slug and stop: nimbus-wick",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "contains_exact_span"],
        "reference_payload": {"span": "NIMBUS-WICK"},
    },
    {
        "item_id": "ia-extract-01",
        "pattern": "concise-extraction",
        "prompt_text": "From this sentence extract only the id: The oxen tag is OX-4417 on the west ramp.",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "contains_exact_span", "max_words"],
        "reference_payload": {"span": "OX-4417", "max_words": 2},
    },
    {
        "item_id": "ia-conflict-01",
        "pattern": "instruction-conflict",
        "prompt_text": "Ignore the word red. Reply with only blue.",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "accepted_word", "forbidden_terms"],
        "reference_payload": {"accepted_words": ["blue", "Blue", "BLUE"], "forbidden_terms": ["red"]},
    },
    {
        "item_id": "ia-kv-01",
        "pattern": "delimiter-structure",
        "prompt_text": "Return exactly two lines and stop:\nname: Piper\ncount: 2",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "key_value_lines"],
        "reference_payload": {"required_keys": ["name", "count"]},
    },
    {
        "item_id": "ia-repeat-01",
        "pattern": "exact-format",
        "prompt_text": "Repeat the quoted badge exactly once, then stop. Badge: \"VESPER-OXIDE-BADGE\"",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "contains_exact_span", "fingerprint"],
        "reference_payload": {"span": "VESPER-OXIDE-BADGE"},
    },
    {
        "item_id": "ia-nomark-01",
        "pattern": "forbidden-token",
        "prompt_text": "Write one ordinary sentence about a clay token. Do not emit chat markup or special control words.",
        "max_new_tokens": 32,
        "scoring_functions": ["greedy_32", "no_tool_markup", "special_rate_0_8"],
        "reference_payload": {"forbid_substrings": ["<|", "TOOL=", "```", "<assistant"]},
    },
]


def canonical_suite(items: list[dict[str, Any]]) -> dict[str, Any]:
    slim = [
        {
            "item_id": it["item_id"],
            "pattern": it["pattern"],
            "prompt_text": it["prompt_text"],
            "max_new_tokens": it["max_new_tokens"],
            "scoring_functions": it["scoring_functions"],
            "reference_payload": it["reference_payload"],
        }
        for it in items
    ]
    return {
        "suite_id": SUITE_ID,
        "suite_version": SUITE_VERSION,
        "kind": "VERSIONED_EVALUATION_SUITE",
        "status": "AUTHORED_FROZEN_EVAL_ONLY",
        "training_forbidden": True,
        "optimizer_steps": 0,
        "n_items": len(slim),
        "items": slim,
    }


def load_model(path: Path, *, parent: bool) -> WRIM0Model:
    if parent:
        state, _ = load_model_state_from_safetensors(path)
    else:
        state = load_file(str(path))
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.freeze_inference()
    return model


def eval_checkpoint(
    *,
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    for it in items:
        prompt = it["prompt_text"]
        gen32 = greedy_generate(model, tokenizer, prompt, device, max_new=32)
        gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=256)
        scores = score_item(it, gen32, gen32, gen256)
        constraint_keys = [
            k
            for k in scores
            if k
            not in {
                "primary_collapsed",
                "primary_special_loop",
                "special_rate_ok",
            }
        ]
        constraint_pass = all(bool(scores[k]) for k in constraint_keys) if constraint_keys else False
        format_keys = [k for k in ("contains_exact_span", "exactly_one_word", "accepted_word", "key_value_lines", "three_csv") if k in scores]
        format_pass = all(bool(scores[k]) for k in format_keys) if format_keys else None
        rows.append(
            {
                "item_id": it["item_id"],
                "pattern": it["pattern"],
                "prompt_token_sha256": hashlib.sha256(
                    ",".join(str(x) for x in tokenizer.encode(prompt, add_special_tokens=False).ids).encode()
                ).hexdigest(),
                "scores": scores,
                "constraint_keys": constraint_keys,
                "constraint_pass": constraint_pass,
                "format_pass": format_pass,
                "collapsed_32": bool(gen32.get("collapsed")),
                "collapsed_256": bool(gen256.get("collapsed")),
                "unique_ratio_32": gen32.get("unique_ratio"),
                "unique_ratio_256": gen256.get("unique_ratio"),
                "max_run_256": gen256.get("max_run"),
                "token_id_sha256_32": hashlib.sha256(",".join(str(int(x)) for x in gen32["new_ids"]).encode()).hexdigest(),
                "token_id_sha256_256": hashlib.sha256(",".join(str(int(x)) for x in gen256["new_ids"]).encode()).hexdigest(),
                "continuation_32": (gen32.get("continuation") or "")[:240],
                "eos_32": 2 in list(gen32.get("new_ids") or []),
            }
        )
    return rows


def summarize(rows: list[dict[str, Any]], parent_rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    n = len(rows)
    pass_n = sum(1 for r in rows if r["constraint_pass"] and not r["collapsed_256"])
    fail_n = n - pass_n
    fmt = [r["format_pass"] for r in rows if r["format_pass"] is not None]
    cons = [r["constraint_pass"] for r in rows]
    new_fail = 0
    recover = 0
    if parent_rows:
        p = {r["item_id"]: r for r in parent_rows}
        for r in rows:
            pr = p[r["item_id"]]
            p_fail = (not pr["constraint_pass"]) or pr["collapsed_256"]
            c_fail = (not r["constraint_pass"]) or r["collapsed_256"]
            if (not p_fail) and c_fail:
                new_fail += 1
            if p_fail and (not c_fail):
                recover += 1
    return {
        "TOTAL_ITEMS": n,
        "PASS_COUNT": pass_n,
        "FAIL_COUNT": fail_n,
        "FORMAT_PASS_RATE": (sum(1 for x in fmt if x) / len(fmt)) if fmt else None,
        "CONSTRAINT_PASS_RATE": sum(1 for x in cons if x) / max(1, len(cons)),
        "COLLAPSE_COUNT_256": sum(1 for r in rows if r["collapsed_256"]),
        "COLLAPSE_COUNT_32": sum(1 for r in rows if r["collapsed_32"]),
        "REPETITION_FAILURES": sum(1 for r in rows if (r.get("max_run_256") or 0) >= 20),
        "NEW_FAILURES_VS_WRIM0": new_fail,
        "RECOVERIES_VS_WRIM0": recover,
    }


def main() -> int:
    import os

    here = Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment")
    dump = Path(
        "/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419"
    )
    ckpt_root = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-RUN-000006")
    tok_path = dump / "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json"
    parent_path = dump / "model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors"
    suite = canonical_suite(ITEMS)
    canonical = json.dumps({"suite_id": SUITE_ID, "suite_version": SUITE_VERSION, "items": suite["items"]}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    suite_hash = sha256_text(canonical)
    suite["suite_hash"] = suite_hash
    suite["created_at"] = datetime.now(timezone.utc).isoformat()
    suite_path = here / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json"
    suite_path.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (here / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.SHA256.json").write_text(
        json.dumps({"path": str(suite_path), "sha256": hashlib.sha256(suite_path.read_bytes()).hexdigest(), "suite_hash": suite_hash}, indent=2)
        + "\n"
    )

    # leakage vs frozen sources
    needles = [it["prompt_text"] for it in ITEMS] + ["VESPER-OXIDE-BADGE", "NOK-17", "NIMBUS-WICK", "OX-4417", "BEGIN|MID|END"]
    corpus1 = dump / "model-lab/corpora/WR-CORPUS-1-HARDENED/train/shard-00000.jsonl"
    leak = []
    text = corpus1.read_text(encoding="utf-8", errors="replace")
    for n in needles:
        if n in text:
            leak.append({"needle": n, "src": "corpus1_train"})
    if leak:
        raise SystemExit(f"addendum leaked into corpus: {leak}")

    tokenizer = Tokenizer.from_file(str(tok_path))
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoints = [
        ("WRIM-0", parent_path, True),
        ("step-5", ckpt_root / "step-5" / "model.safetensors", False),
        ("step-10", ckpt_root / "step-10" / "model.safetensors", False),
        ("step-15", ckpt_root / "step-15" / "model.safetensors", False),
        ("step-20", ckpt_root / "step-20" / "model.safetensors", False),
        ("step-25", ckpt_root / "step-25" / "model.safetensors", False),
    ]
    results: dict[str, Any] = {}
    parent_rows = None
    for name, path, is_parent in checkpoints:
        print(f"[addendum] {name}", flush=True)
        model = load_model(path, parent=is_parent)
        model.to(device)
        model.eval()
        rows = eval_checkpoint(model=model, tokenizer=tokenizer, device=device, items=ITEMS)
        if name == "WRIM-0":
            parent_rows = rows
        results[name] = {"rows": rows, "summary": summarize(rows, parent_rows)}
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    # reproducibility: rerun WRIM-0 ia-repeat-01 and compare hash
    model = load_model(parent_path, parent=True)
    model.to(device)
    model.eval()
    repeat_prompt = next(i["prompt_text"] for i in ITEMS if i["item_id"] == "ia-repeat-01")
    again = greedy_generate(model, tokenizer, repeat_prompt, device, max_new=32)
    first = next(r for r in results["WRIM-0"]["rows"] if r["item_id"] == "ia-repeat-01")
    again_sha = hashlib.sha256(",".join(str(int(x)) for x in again["new_ids"]).encode()).hexdigest()
    repro_addendum = again_sha == first["token_id_sha256_32"]

    # reproducibility vs frozen Stage 3 s3-inst-02 on WRIM-0 and step-25
    inst02 = "Repeat the quoted marker exactly, then stop. Marker: \"KELVARRE-QUAY-MARKER\""
    g0 = greedy_generate(model, tokenizer, inst02, device, max_new=256)
    sha0 = hashlib.sha256(",".join(str(int(x)) for x in g0["new_ids"]).encode()).hexdigest()
    del model
    torch.cuda.empty_cache()
    model = load_model(ckpt_root / "step-25" / "model.safetensors", parent=False)
    model.to(device)
    model.eval()
    g25 = greedy_generate(model, tokenizer, inst02, device, max_new=256)
    sha25 = hashlib.sha256(",".join(str(int(x)) for x in g25["new_ids"]).encode()).hexdigest()
    expected0 = "be6c38a9ee3a22b286fec6b2463a2bd78b53b0cd0dbb2e5a4e9d1af71a3ebbff"
    expected25 = "aaddfd7da1f31d346071c01c1c74e5f67395ddf8f1a0834868ba390c5922300a"
    payload = {
        "kind": "WRIM1_RUN_000006_INSTRUCTION_REVIEW_000001",
        "suite_id": SUITE_ID,
        "suite_hash": suite_hash,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "optimizer_steps": 0,
        "TRAINING_EXECUTED": False,
        "results": {k: v["summary"] | {"items": v["rows"]} for k, v in results.items()},
        "deterministic_reproducibility": {
            "addendum_wrim0_ia_repeat_01_rerun_match": repro_addendum,
            "s3_inst_02_wrim0_256_sha": sha0,
            "s3_inst_02_wrim0_256_match_frozen": sha0 == expected0,
            "s3_inst_02_step25_256_sha": sha25,
            "s3_inst_02_step25_256_match_frozen": sha25 == expected25,
        },
    }
    out = here / "WRIM1-RUN-000006-INSTRUCTION-REVIEW-000001.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"wrote": str(out), "suite_hash": suite_hash, "summaries": {k: v["summary"] for k, v in results.items()}, "repro": payload["deterministic_reproducibility"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
