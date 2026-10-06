"""School 06 NATURAL_CONTINUATION_BYPASS_TEST.

Read-only: after NE1 entry, is frozen-base BYPASS span enough?
Does not train. Does not revive NA1. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_entry_bypass_review import gold_prefix_matrix, summarize_probes, token1_probe
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model, frozen_parameter_hash, module_parameter_hash
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import EA1_HASH, FROZEN_BASE_HASH, PARENT_HASH, PHRASE_REF, RA1_HASH
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME

NE1_CKPT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-NE1-000001" / "step-40"
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL06_CONTINUATION_REPORT.json"


def gold_sum(mats: list[list[dict[str, Any]]], k: int) -> int:
    return sum(int((m[k].get("exact_remaining") if k < len(m) else 0) or 0) for m in mats)


def load_ne1(device: torch.device) -> WRIMRA1Model:
    src = load_safetensors_file(str(NE1_CKPT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, ne1=True)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("na1.", "rmr1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"load mismatch extra={extra} unexpected={unexpected}")
    return model.to(device).eval()


def localize(probes: list[dict[str, Any]]) -> dict[str, Any]:
    entry = span = ok = 0
    for p in probes:
        if int(p.get("greedy_exact") or 0):
            ok += 1
        elif not int(p.get("token1_ok") or 0):
            entry += 1
        else:
            span += 1
    return {"n": len(probes), "exact": ok, "entry_fail": entry, "span_fail": span}


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    if sha256_file(PARENT / MODEL_NAME) != PARENT_HASH:
        raise SystemExit("parent_hash_mismatch")
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_ne1(device)
    hashes = {
        "FROZEN": frozen_parameter_hash(model),
        "EA1": module_parameter_hash(model, "ea1."),
        "RA1": module_parameter_hash(model, "ra1."),
        "NE1": module_parameter_hash(model, "ne1."),
    }
    hashes_ok = hashes["FROZEN"] == FROZEN_BASE_HASH and hashes["EA1"] == EA1_HASH and hashes["RA1"] == RA1_HASH
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")

    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    off_p = [token1_probe(model, tok, device, rec) for rec in official]
    ex_p = [token1_probe(model, tok, device, rec) for rec in extra]
    for p in off_p + ex_p:
        p.pop("ea1_delta", None)
    gold = {
        "official": [gold_prefix_matrix(model, tok, device, rec) for rec in official],
        "extra": [gold_prefix_matrix(model, tok, device, rec) for rec in extra],
    }
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    phrase_exact = int(_score_loaded(model, tok, device, phrase).get("short_phrase_exact") or 0)

    loc_off = localize(off_p)
    loc_ex = localize(ex_p)
    k = {
        "official_k0": gold_sum(gold["official"], 0),
        "official_k1": gold_sum(gold["official"], 1),
        "official_k2": gold_sum(gold["official"], 2),
        "official_k3": gold_sum(gold["official"], 3),
        "extra_k0": gold_sum(gold["extra"], 0),
        "extra_k1": gold_sum(gold["extra"], 1),
        "extra_k2": gold_sum(gold["extra"], 2),
        "extra_k3": gold_sum(gold["extra"], 3),
    }
    off_sum = summarize_probes(off_p)
    ex_sum = summarize_probes(ex_p)
    entry_established = int(ex_sum["token1_exact"]) > 1 and int(off_sum["token1_exact"]) >= 3
    bypass_sufficient = (k["official_k1"] >= k["official_k0"] and loc_off["span_fail"] == 0 and loc_ex["span_fail"] == 0)
    span_localized = loc_ex["span_fail"] > 0 or (k["extra_k1"] - k["extra_k0"] >= 1)
    success = bool(hashes_ok and phrase_exact == PHRASE_REF["phrase"] and entry_established and (bypass_sufficient or span_localized))
    na1_revive = False

    report = {
        "kind": "WRIM_GENESIS_SCHOOL06_CONTINUATION",
        "CHECKPOINT": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        "NA1_REVIVED": na1_revive,
        "HASHES": hashes,
        "HASHES_OK": hashes_ok,
        "PHRASE_EXACT": phrase_exact,
        "OFFICIAL": off_sum,
        "EXTRA": ex_sum,
        "LOCALIZE_OFFICIAL": loc_off,
        "LOCALIZE_EXTRA": loc_ex,
        "GOLD": k,
        "ENTRY_ESTABLISHED": entry_established,
        "BYPASS_SUFFICIENT": bypass_sufficient,
        "SPAN_FAILURE_LOCALIZED": span_localized,
        "SUCCESS": success,
        "ATTRACTORS_EXTRA_ENTRY": dict(Counter(str(p.get("top1")) for p in ex_p if not int(p.get("token1_ok") or 0))),
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    eng = Engine()
    rec = eng.complete_school(
        school="SCHOOL_06_NATURAL_CONTINUATION",
        success=success,
        evidence={
            "entry_established": entry_established,
            "bypass_sufficient": bypass_sufficient,
            "span_localized": span_localized,
            "na1_revived": False,
            "extra_token1": ex_sum["token1_exact"],
            "extra_greedy": ex_sum["greedy_exact"],
            "gold_extra_k0": k["extra_k0"],
            "gold_extra_k1": k["extra_k1"],
            "report": str(REPORT),
        },
        experiment_id="EXP-SCHOOL06-BYPASS-TEST",
    )
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": out["SUCCESS"],
        "entry_established": out["ENTRY_ESTABLISHED"],
        "bypass_sufficient": out["BYPASS_SUFFICIENT"],
        "span_localized": out["SPAN_FAILURE_LOCALIZED"],
        "gold": out["GOLD"],
        "localize_extra": out["LOCALIZE_EXTRA"],
        "promptbook": out.get("PROMPTBOOK"),
        "tokens_used": 0,
        "report": str(REPORT),
    }, indent=2, default=str))
