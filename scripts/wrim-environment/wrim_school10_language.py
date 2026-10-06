"""School 10 GENERAL_LANGUAGE_HELD_OUT.

Readonly: independent NL NLL, extra-unseen, instruction-holdout language families.
Does not train. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root
from wrim_arch_uh1_ac1_train import _write
from wrim_entry_bypass_review import summarize_probes, token1_probe
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_instruction_train_v1 import ROOT as CORPUS_ROOT
from wrim_promptbook.engine import Engine
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR
from wrim_ra1_phrase_school import load_rows
from wrim_s09_instruction import greedy_instruction, score_split
from wrim_school06_continuation import load_ne1
from wrim_val_nl_independent import PACK_ROOT, eval_candidate, load_jsonl

REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL10_LANGUAGE_REPORT.json"
S09_STATE = Path(DATA_ROOT) / "WRIM_S09_NE1_INSTRUCTION_STATE.json"
PARENT_EXTRA = {"greedy": 2, "token1": 3}
PARENT_NL = 6.972


def load_eval_model(device: torch.device):
    from safetensors.torch import load_file as load_safetensors_file
    from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
    from wrim_hvu_identity import CKPT_BASE
    from wrim_resumable_checkpoint import MODEL_NAME

    ckpt = None
    if S09_STATE.is_file():
        st = json.loads(S09_STATE.read_text(encoding="utf-8"))
        train = st.get("TRAIN") or {}
        best = train.get("best_checkpoint")
        if not best and isinstance(train.get("BEST"), dict):
            best = train["BEST"].get("checkpoint")
        if best:
            ckpt = Path(CKPT_BASE) / str(best)
    if ckpt is None or not (ckpt / MODEL_NAME).is_file():
        return load_ne1(device), "WRIM1-UH1-AC2-NE1-000001/step-40"
    src = load_safetensors_file(str(ckpt / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, ne1=True)
    model.load_state_dict(src, strict=False)
    return model.to(device).eval(), str(ckpt.relative_to(CKPT_BASE)) if ckpt.is_relative_to(CKPT_BASE) else str(ckpt)


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model, ckpt = load_eval_model(device)
    extra = natural_span_eval()
    official = load_rows(NAT_DIR / "val.jsonl")
    model.set_entry_route("ne1")
    model.set_span_route("bypass")
    off = summarize_probes([token1_probe(model, tok, device, rec) for rec in official])
    ex = summarize_probes([token1_probe(model, tok, device, rec) for rec in extra])
    lang_rows = [r for r in load_rows(CORPUS_ROOT / "family_holdout.jsonl") if r.get("family") in {"explain", "brief", "classify"}]
    lang_rows += [r for r in load_rows(CORPUS_ROOT / "template_holdout.jsonl") if r.get("family") in {"explain", "brief", "classify"}][:80]
    lang = score_split(model, tok, device, lang_rows, cap=160)
    nl_rows = []
    pack = PACK_ROOT / "val.jsonl"
    if pack.is_file():
        nl_rows = load_jsonl(pack)[:12]
    nl = None
    if nl_rows:
        nl = eval_candidate(name=ckpt, model=model, tokenizer=tok, device=device, rows=nl_rows)
    nl_mean = None if not nl else nl.get("natural_language_nll_mean")
    extra_g = int(ex["greedy_exact"])
    extra_t1 = int(ex["token1_exact"])
    nl_ok = nl_mean is None or float(nl_mean) <= PARENT_NL + 0.12
    extra_ok = extra_t1 >= 1 and extra_g >= 1
    lang_ok = int(lang["exact"]) >= 2
    success = bool(nl_ok and extra_ok and lang_ok)
    report = {
        "kind": "WRIM_GENESIS_SCHOOL10_LANGUAGE",
        "CHECKPOINT": ckpt,
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        "official_greedy": int(off["greedy_exact"]),
        "official_token1": int(off["token1_exact"]),
        "extra_greedy": extra_g,
        "extra_token1": extra_t1,
        "heldout_language": lang,
        "independent_nl_nll": nl_mean,
        "PARENT_NL_REF": PARENT_NL,
        "nl_ok": nl_ok,
        "extra_ok": extra_ok,
        "lang_ok": lang_ok,
        "SUCCESS": success,
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    rec = Engine().complete_school(
        school="SCHOOL_10_GENERAL_LANGUAGE",
        success=success,
        evidence={"report": str(REPORT), "nl": nl_mean, "extra_greedy": extra_g, "extra_token1": extra_t1, "lang_exact": lang["exact"]},
        experiment_id="EXP-SCHOOL10-LANGUAGE-HELD-OUT",
    )
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    out = main()
    print(json.dumps({"ok": out["SUCCESS"], "nl": out.get("independent_nl_nll"), "extra": [out["extra_greedy"], out["extra_token1"]], "lang": out["heldout_language"]["exact"], "promptbook": out.get("PROMPTBOOK"), "report": str(REPORT)}, indent=2, default=str))
