"""LoRA / classifier-head parameter counts from actual WRIM-0 Linear shapes."""
from __future__ import annotations

from typing import Any

from capability_module import lora_param_count
from frozen_core import FrozenWRIMCore


# Actual WRIM Attention Linear names (not HuggingFace q_proj/v_proj).
ATTN_QKV_O = ("attn.q", "attn.k", "attn.v", "attn.o")
ATTN_Q_V = ("attn.q", "attn.v")
FFN = ("ffn.gate", "ffn.up", "ffn.down")


def _match_suffix(path: str, suffix: str) -> bool:
    return path == suffix or path.endswith("." + suffix)


def count_lora_for_targets(linears: list[dict[str, Any]], suffixes: tuple[str, ...], rank: int) -> dict[str, Any]:
    matched: list[dict[str, Any]] = []
    total = 0
    for row in linears:
        path = row["path"]
        if any(_match_suffix(path, s) for s in suffixes):
            n = lora_param_count(row["in_features"], row["out_features"], rank)
            matched.append({**row, "lora_params_rank": n})
            total += n
    return {
        "rank": rank,
        "target_suffixes": list(suffixes),
        "matched_modules": len(matched),
        "parameter_count": total,
        "modules": matched,
    }


def classifier_head_params(d_model: int, n_classes: int, bias: bool = True) -> int:
    return d_model * n_classes + (n_classes if bias else 0)


def feasibility_report(core: FrozenWRIMCore) -> dict[str, Any]:
    linears = core.eligible_linear_modules()
    ranks = (1, 2, 4, 8)
    qv = {r: count_lora_for_targets(linears, ATTN_Q_V, r) for r in ranks}
    attn = {r: count_lora_for_targets(linears, ATTN_QKV_O, r) for r in ranks}
    attn_ffn = {r: count_lora_for_targets(linears, ATTN_QKV_O + FFN, r) for r in ranks}
    cfg = core.config
    return {
        "mlx_builtin_lora": False,
        "custom_lora_required": True,
        "actual_linear_module_count": len(linears),
        "linear_paths": [r["path"] for r in linears],
        "notes": (
            "WRIM Attention uses q/k/v/o Linear names, not q_proj/v_proj. "
            "FFN is SwiGLU gate/up/down. Embeddings are tied; there is no untied lm_head."
        ),
        "lora_q_and_v": {str(r): qv[r]["parameter_count"] for r in ranks},
        "lora_qkv_o": {str(r): attn[r]["parameter_count"] for r in ranks},
        "lora_attn_and_swiglu": {str(r): attn_ffn[r]["parameter_count"] for r in ranks},
        "lora_q_and_v_detail": {str(r): qv[r] for r in ranks},
        "classifier_head": {
            "last_hidden_d_model": cfg.d_model,
            "tool_vs_none_3way_bias": classifier_head_params(cfg.d_model, 3, True),
            "tool_id_4way_bias": classifier_head_params(cfg.d_model, 4, True),
            "tool_id_8way_bias": classifier_head_params(cfg.d_model, 8, True),
            "feasible": True,
        },
        "core_total_parameters": core.core_total_parameters(),
        "huggingface_q_proj_exists": any(p.endswith("q_proj") for p in (r["path"] for r in linears)),
    }
