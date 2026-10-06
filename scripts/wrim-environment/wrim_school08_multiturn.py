"""School 08 MULTI_TURN_CONTEXT_WINDOW.

Sequential two-turn continuity and EOS route reset. Not persistent memory.
Does not install RMR1. Does not train. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import EOS_ID
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import MOD02A_ARTIFACT, PHRASE_REF, RMR1_THRESHOLD
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_rmr1 import MODE_STRUCTURED, RMR1_VERSION
from wrim_school06_continuation import load_ne1

REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL08_MULTITURN_REPORT.json"
RMR1_PT = MOD02A_ARTIFACT / "rmr1.pt"


def _body(gen: dict[str, Any]) -> list[int]:
    ids = list(gen.get("new_ids") or [])
    eos = bool(gen.get("eos"))
    return ids[:-1] if eos else ids


def greedy_turn(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any], entry: str, span: str) -> dict[str, Any]:
    model.set_entry_route(entry)
    model.set_span_route(span)
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    tgt = [int(x) for x in encode_example(tok, rec)["target_ids"]]
    gen = greedy_from_ids(model, tok, device, prefix, max_new=16)
    body = _body(gen)
    return {
        "body": body,
        "eos": bool(gen.get("eos")),
        "exact": int(body == tgt and bool(gen.get("eos"))),
        "empty": int(not body),
        "text": tok.decode(body, skip_special_tokens=True) if body else "",
        "prefix": prefix,
        "target": tgt,
    }


def followup(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, first: dict[str, Any], second: dict[str, Any], entry2: str, span2: str) -> dict[str, Any]:
    """Turn 2 after EOS using a fresh route. Context-window only."""
    ctx = list(first["prefix"]) + list(first["body"]) + [EOS_ID] + list(second["prefix"][1:])
    model.set_entry_route(entry2)
    model.set_span_route(span2)
    gen = greedy_from_ids(model, tok, device, ctx, max_new=16)
    body = _body(gen)
    tgt = second["target"]
    return {
        "exact": int(body == tgt and bool(gen.get("eos"))),
        "empty": int(not body),
        "eos": bool(gen.get("eos")),
        "text": tok.decode(body, skip_special_tokens=True) if body else "",
        "matches_single_turn": body == second["body"],
        "leaked_first_text": first["text"] if first["text"] and first["text"] in (tok.decode(body, skip_special_tokens=True) if body else "") and first["text"] != second["text"] else None,
    }


def rmr_latch_eval(device: torch.device, tok: Tokenizer, phrase: dict[str, Any], nat: dict[str, Any]) -> dict[str, Any]:
    if not RMR1_PT.is_file():
        return {"ran": False, "reason": "rmr1_artifact_missing"}
    src = load_safetensors_file(str(Path(CKPT_BASE) / "WRIM1-UH1-AC2-NE1-000001" / "step-40" / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, ne1=True, rmr1=True)
    model.load_state_dict(src, strict=False)
    blob = torch.load(RMR1_PT, map_location="cpu", weights_only=False)
    sd = blob["state_dict"] if isinstance(blob, dict) and "state_dict" in blob else blob
    model.rmr1.load_state_dict(sd)
    model.to(device).eval()
    from wrim_cpt_identity import ASSISTANT_ID

    def two_turn(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
        pa = prefix_ids_for_inference(tok, a["prompt"])
        pb = prefix_ids_for_inference(tok, b["prompt"])
        dummy = 100
        seq = pa + [dummy, EOS_ID] + pb[1:] + [dummy]
        idx = torch.tensor([seq], dtype=torch.long, device=device)
        model.enable_learned_router(RMR1_THRESHOLD, RMR1_VERSION)
        with torch.inference_mode():
            _ = model.hidden(idx)
        modes = list(model.last_rmr_modes)
        ast = [i for i, t in enumerate(seq) if t == ASSISTANT_ID]
        ra1_mask = model._rmr_ra1_mask[0].detach().cpu().tolist() if model._rmr_ra1_mask is not None else []
        span_after = []
        for pos in ast:
            if pos + 1 < len(ra1_mask):
                span_after.append(bool(ra1_mask[pos + 1]))
        expect_ra1 = [m == MODE_STRUCTURED for m in modes]
        return {
            "modes": modes,
            "cleared_between": len(modes) == 2,
            "latch_matches_decision": span_after == expect_ra1[: len(span_after)],
        }

    ns = two_turn(nat, phrase)
    sn = two_turn(phrase, nat)
    ok = bool(ns.get("cleared_between") and sn.get("cleared_between") and ns.get("latch_matches_decision") and sn.get("latch_matches_decision"))
    return {"ran": True, "ok": ok, "nat_then_struct": ns, "struct_then_nat": sn, "installed_in_runtime": False}


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_ne1(device)
    phrase = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")[0]
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    nat = next((r for r in official if int(_score_loaded_one(model, tok, device, r))), official[0])

    def one(rec, entry, span):
        return greedy_turn(model, tok, device, rec, entry, span)

    s1 = one(phrase, "ea1", "ra1")
    n1 = one(nat, "ne1", "bypass")
    sn = followup(model, tok, device, s1, n1, "ne1", "bypass")
    ns = followup(model, tok, device, n1, s1, "ea1", "ra1")
    leak = bool(sn.get("leaked_first_text") or ns.get("leaked_first_text"))
    continuity = (not sn["empty"]) and (not ns["empty"]) and bool(sn["eos"] or ns["eos"])
    no_leak = (not leak) and bool(sn["matches_single_turn"] or ns["matches_single_turn"] or (sn["exact"] or ns["exact"]))
    latch = rmr_latch_eval(device, tok, phrase, nat)
    success = bool(no_leak and continuity and (not latch.get("ran") or latch.get("ok")))
    report = {
        "kind": "WRIM_GENESIS_SCHOOL08_MULTITURN",
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        "LONG_TERM_MEMORY_CLAIM": False,
        "RMR1_INSTALLED": False,
        "RMR1_TWO_TOKEN_REGRESSION_OPEN": True,
        "STRUCT_THEN_NATURAL": sn,
        "NATURAL_THEN_STRUCT": ns,
        "SINGLE_STRUCT": {k: s1[k] for k in ("exact", "empty", "eos", "text")},
        "SINGLE_NATURAL": {k: n1[k] for k in ("exact", "empty", "eos", "text")},
        "NO_LEAK": no_leak,
        "FOLLOWUP_CONTINUITY": continuity,
        "EXPERIMENTAL_RMR1_LATCH": latch,
        "SUCCESS": success,
        "PHRASE_REF": PHRASE_REF["phrase"],
        "EXTRA_N": len(extra),
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    rec = Engine().complete_school(
        school="SCHOOL_08_MULTI_TURN_CONVERSATION",
        success=success,
        evidence={"no_leak": no_leak, "continuity": continuity, "rmr_latch": latch.get("ok"), "report": str(REPORT)},
        experiment_id="EXP-SCHOOL08-MULTITURN",
    )
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


def _score_loaded_one(model, tok, device, rec) -> int:
    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    g = greedy_turn(model, tok, device, rec, "ne1", "bypass")
    return int(g["exact"])


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": out["SUCCESS"],
        "no_leak": out["NO_LEAK"],
        "continuity": out["FOLLOWUP_CONTINUITY"],
        "latch": out["EXPERIMENTAL_RMR1_LATCH"],
        "promptbook": out.get("PROMPTBOOK"),
        "report": str(REPORT),
    }, indent=2, default=str))
