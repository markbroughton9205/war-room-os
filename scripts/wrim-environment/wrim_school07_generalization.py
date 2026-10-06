"""School 07 NATURAL_GENERALIZATION_GATES.

Report train / official val / extra-unseen / family holdout separately.
Never train on extra-unseen. Do not merge public scores. Canonical remains STEP_400.
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
from wrim_entry_bypass_review import summarize_probes, token1_probe
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import PHRASE_REF
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_school05_ne1_review import leakage_audit
from wrim_school06_continuation import NE1_CKPT, load_ne1

REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL07_GENERALIZATION_REPORT.json"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_ne1(device)
    train = load_rows(NAT_DIR / "train.jsonl")
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    para = load_rows(GEN_VAL) if GEN_VAL.is_file() else []
    leak = leakage_audit(train, official, extra)

    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    off = summarize_probes([token1_probe(model, tok, device, rec) for rec in official])
    ex = summarize_probes([token1_probe(model, tok, device, rec) for rec in extra])
    for row in (off, ex):
        for p in []:
            pass
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    phrase_exact = int(_score_loaded(model, tok, device, phrase).get("short_phrase_exact") or 0)
    para_exact = int(_score_loaded(model, tok, device, para).get("short_phrase_exact") or 0) if para else 0

    public = {
        "train": {"n": len(train), "never_used_as_public_score": True},
        "official_validation": {
            "n": official and off["n"],
            "greedy": off["greedy_exact"],
            "token1": off["token1_exact"],
            "families": off["families"],
        },
        "extra_unseen": {
            "n": ex["n"],
            "greedy": ex["greedy_exact"],
            "token1": ex["token1_exact"],
            "families": ex["families"],
            "never_train": True,
        },
        "family_holdout": ex["families"],
        "paraphrase_holdout_structured": {"exact": para_exact, "ref": PHRASE_REF.get("paraphrase")},
        "adversarial_template": {"status": "NOT_SEPARATE_CORPUS", "note": "no encoded adversarial-template suite yet"},
    }
    merged = False
    template_only = int(ex["token1_exact"]) == 0 and int(off["token1_exact"]) > 0
    success = (not merged) and bool(leak.get("ok")) and ("extra_unseen" in public) and ("family_holdout" in public) and not template_only
    report = {
        "kind": "WRIM_GENESIS_SCHOOL07_GENERALIZATION",
        "CHECKPOINT": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        "TRAINED_ON_EXTRA_UNSEEN": False,
        "PUBLIC_METRICS_MERGED": merged,
        "LEAKAGE": leak,
        "PHRASE_EXACT": phrase_exact,
        "SPLITS": public,
        "TEMPLATE_MEMORIZATION_ONLY": template_only,
        "SUCCESS": success,
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    rec = Engine().complete_school(
        school="SCHOOL_07_NATURAL_GENERALIZATION",
        success=success,
        evidence={
            "extra_unseen_greedy": ex["greedy_exact"],
            "extra_unseen_token1": ex["token1_exact"],
            "official_greedy": off["greedy_exact"],
            "leakage_ok": leak.get("ok"),
            "merged": merged,
            "report": str(REPORT),
        },
        experiment_id="EXP-SCHOOL07-GENERALIZATION-GATES",
    )
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": out["SUCCESS"],
        "splits": {
            "official": out["SPLITS"]["official_validation"],
            "extra_unseen": {k: v for k, v in out["SPLITS"]["extra_unseen"].items() if k != "families"},
            "family_holdout_keys": list((out["SPLITS"]["family_holdout"] or {}).keys()),
        },
        "leakage_ok": out["LEAKAGE"].get("ok"),
        "promptbook": out.get("PROMPTBOOK"),
        "report": str(REPORT),
    }, indent=2, default=str))
