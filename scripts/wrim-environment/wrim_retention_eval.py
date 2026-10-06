"""Shared read-only eval bundle for retention recovery. Does not train."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch

from wrim_arch_uh1_ac1_train import role_geometry
from wrim_hvu_identity import DATA_ROOT, STAGE3_REVIEW_DELTA, STEP400_STAGE3_DELTA_VS_WRIM0
from wrim_plm1_eval import evaluate_prefix_heldout
from wrim_plm1_gates import hard_hits


RESPONSE_KEYS = ("lm_head.weight", "assistant_ctrl", "assistant_span_ctrl", "assistant_stop_ctrl")


def body_keys(state: dict[str, torch.Tensor]) -> list[str]:
    return [k for k in state if k not in RESPONSE_KEYS]


def tensor_sha(t: torch.Tensor) -> str:
    import hashlib

    return hashlib.sha256(t.detach().cpu().contiguous().numpy().tobytes()).hexdigest()


def slim_prefix(prefix: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in prefix.items() if k != "items"}


def working_classes(geo: dict[str, Any]) -> list[str]:
    by = geo.get("BY_CLASS") or {}
    return [k for k, v in by.items() if int(v.get("GREEDY_FIRST_TOKEN_MATCH") or 0) > 0]


def eval_retention_bundle(
    *,
    model,
    tokenizer,
    device,
    dump,
    suite,
    baseline,
    wrim0_logp: dict[str, torch.Tensor],
    parent_cpu: dict[str, torch.Tensor],
    val_packs: dict[str, list[int]],
    nl_rows: list[dict[str, Any]],
    ft_rows: list[dict[str, Any]],
    tt_rows: list[dict[str, Any]],
    mix_rows: list[dict[str, Any]],
    step: int = 0,
    name: str = "interp",
    t3_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_val_nl_independent import eval_candidate
    from stage3a_run import evaluate_candidate

    model.eval()
    geo_ft = role_geometry(model, tokenizer, device, ft_rows)
    geo_mix = role_geometry(model, tokenizer, device, mix_rows)
    prefix_tt = slim_prefix(evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=tt_rows))
    prefix_mix = slim_prefix(evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=mix_rows))
    prefix_ft = slim_prefix(evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=ft_rows))
    prefix_t3 = slim_prefix(evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=t3_rows)) if t3_rows else {}
    found = {k: v for k, v in evaluate_foundation(model=model, tokenizer=tokenizer, device=device).items() if k != "items"}
    nlls = family_nll(model=model, device=device, packs=val_packs)
    nl = eval_candidate(name=f"{name}-step-{step}", model=model, tokenizer=tokenizer, device=device, rows=nl_rows)
    nl_slim = {k: v for k, v in nl.items() if k != "generations"}
    ev = evaluate_candidate(
        model=model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump,
        suite_items=suite["obj"]["items"],
        frozen_items=baseline["obj"]["items"],
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0=np.array(val_packs.get("genesis") or [1, 2, 3], dtype=np.int32),
        c1=np.array(val_packs.get("general") or [1, 2, 3], dtype=np.int32),
        greedy_256=False,
        step=step,
        train_loss=None,
        tokens=0,
        lr=None,
    )
    delta = ev.get("mean_wrim0_anchor_nll_delta")
    drift = None if delta is None else float(delta) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
    s3 = {
        "step": step,
        "mean_wrim0_anchor_nll_delta": delta,
        "historical_pass_count": ev.get("historical_pass_count"),
        "n_collapsed": ev.get("n_collapsed"),
        "STAGE3_DRIFT_VS_STEP400": drift,
        "STAGE3_NLL_REVIEW": bool(delta is not None and float(delta) >= STAGE3_REVIEW_DELTA),
    }
    bundle = {
        "stage3_historical": s3.get("historical_pass_count"),
        "stage3_collapse": s3.get("n_collapsed"),
        "stage3_delta_nll": s3.get("mean_wrim0_anchor_nll_delta"),
        "grad_norm": None,
        "nan": False,
    }
    ft_working = working_classes(geo_ft)
    return {
        "stage3": s3,
        "hard_gate_hits": hard_hits(bundle),
        "geo_ft": geo_ft,
        "geo_mix": geo_mix,
        "prefix_tt": prefix_tt,
        "prefix_mix": prefix_mix,
        "prefix_ft": prefix_ft,
        "prefix_t3": prefix_t3,
        "foundation": found,
        "nlls": nlls,
        "independent_nl": nl_slim,
        "FIRST_TOKEN_CLASSES_WORKING": ft_working,
        "N_FIRST_TOKEN_CLASSES_WORKING": len(ft_working),
        "GREEDY_FIRST_TOKEN_MATCH_FT": geo_ft.get("GREEDY_FIRST_TOKEN_MATCH"),
        "GREEDY_FIRST_TOKEN_MATCH_MIX": geo_mix.get("GREEDY_FIRST_TOKEN_MATCH"),
        "NEWLINE_ARGMAX_RATE": geo_mix.get("NEWLINE_ARGMAX_RATE"),
        "NEWLINE_PROBABILITY": geo_mix.get("NEWLINE_PROBABILITY"),
        "TOKEN2_CE": prefix_tt.get("TOKEN2_CE"),
        "TOKEN2_RANK": prefix_tt.get("TOKEN2_RANK"),
        "TOKEN2_PROBABILITY": prefix_tt.get("TOKEN2_PROBABILITY"),
        "TOKEN2_ORACLE_SUCCESS": prefix_tt.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"),
        "GREEDY_TWO_TOKEN_EXACT": prefix_tt.get("GREEDY_TWO_TOKEN_EXACT"),
        "N_CLASSES_GREEDY_TWO_TOKEN": prefix_tt.get("N_CLASSES_GREEDY_TWO_TOKEN"),
        "GREEDY_THREE_TOKEN_EXACT": (prefix_t3 or prefix_tt).get("GREEDY_THREE_TOKEN_EXACT"),
        "N_CLASSES_GREEDY_THREE_TOKEN": (prefix_t3 or prefix_tt).get("N_CLASSES_GREEDY_THREE_TOKEN"),
        "TOKEN3_CE": (prefix_t3 or prefix_tt).get("TOKEN3_CE"),
        "TOKEN3_RANK": (prefix_t3 or prefix_tt).get("TOKEN3_RANK"),
        "TOKEN3_GIVEN_GOLD_PREFIX": (prefix_t3 or prefix_tt).get("TOKEN3_GIVEN_GOLD_PREFIX"),
        "GREEDY_SHORT_ANSWER_CORRECT": prefix_mix.get("GREEDY_SHORT_ANSWER_CORRECT"),
        "GREEDY_STOPPING": prefix_mix.get("GREEDY_STOPPING"),
        "RAMBLE_RATE": prefix_mix.get("RAMBLE_RATE"),
        "EMPTY_RESPONSE_RATE": prefix_mix.get("EMPTY_RESPONSE_RATE"),
        "EOS_MEAN_RANK": prefix_mix.get("EOS_MEAN_RANK"),
        "INDEPENDENT_NL_NLL": nl_slim.get("natural_language_nll_mean"),
        "GENERAL_NL_NLL": nlls.get("general"),
        "CODE_NLL": nlls.get("code"),
        "JSON_NLL": nlls.get("json"),
    }
