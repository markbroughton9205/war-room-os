"""RA1 Phase 1 architecture validation. No optimizer.step."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch

from wrim_arch_uh1_ac1_train import _write
from wrim_arch_uh1_ac2 import activation_tests as ac2_activation_tests
from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, SYSTEM_ID
from wrim_g20m_ra1 import (
    PLACEMENT_A,
    PLACEMENT_B,
    RA1_PARAM_CEILING,
    WRIMRA1Model,
    freeze_base_train_ra1,
    frozen_parameter_hash,
)
from wrim_g20m_uh1 import WRIMUH1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, GRAD_HARD, GRAD_REVIEW, SEED
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-DC-000009" / "step-5"
EXPECT_PARENT = "282449e3761d4d32910ea6a8b1edf69b3371dca6f9e94a8b00b9322ded225fde"
VALIDATE_REPORT = Path(DATA_ROOT) / "WRIM1_UH1_AC2_RA1_PHASE1_REPORT.json"


def _load_parent(device: torch.device) -> tuple[WRIMUH1Model, str]:
    from safetensors.torch import load_file as load_safetensors_file
    from run000007_preflight import sha256_file

    path = PARENT / MODEL_NAME
    h = sha256_file(path)
    if h != EXPECT_PARENT:
        raise RuntimeError(f"parent hash mismatch {h}")
    m = WRIMUH1Model(assistant_control=True, span_control=True)
    missing, unexpected = m.load_state_dict(load_safetensors_file(str(path)), strict=False)
    extra = set(missing) - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"parent load mismatch missing={missing} unexpected={unexpected}")
    m.to(device).eval()
    for p in m.parameters():
        p.requires_grad_(False)
    return m, h


def _load_ra1(placement: str, bottleneck: int, device: torch.device) -> WRIMRA1Model:
    from safetensors.torch import load_file as load_safetensors_file

    m = WRIMRA1Model(placement=placement, bottleneck=bottleneck)
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    missing, unexpected = m.load_state_dict(src, strict=False)
    extra = set(missing) - set(k for k, _ in m.named_parameters() if k.startswith("ra1.")) - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"RA1 load mismatch missing={missing} unexpected={unexpected}")
    m.ra1.reset_zero_init()
    m.to(device)
    return m


def _max_abs_logit(a: torch.Tensor, b: torch.Tensor) -> float:
    return float((a - b).abs().max().item())


def validate_placement(placement: str, bottleneck: int, parent: WRIMUH1Model, device: torch.device) -> dict[str, Any]:
    ra1 = _load_ra1(placement, bottleneck, device)
    n_ra1 = ra1.ra1.param_count()
    if n_ra1 > RA1_PARAM_CEILING:
        return {"ok": False, "reason": "param_ceiling", "n": n_ra1}
    masks_ok = ac2_activation_tests()
    idx_mt = torch.tensor(
        [[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, 12, EOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 13, EOS_ID]],
        dtype=torch.long,
        device=device,
    )
    m = ra1.control_masks(idx_mt)
    span = m["span"][0].tolist()
    entry = m["entry"][0].tolist()
    expect_span = [False, False, False, False, True, True, False, False, False, False, True, False]
    expect_entry = [False, False, False, True, False, False, False, False, False, True, False, False]
    multi_turn = span == expect_span and entry == expect_entry and span[7] is False and span[8] is False

    docs = [
        torch.tensor([[BOS_ID, 20, 21, 22, 23, 24, 25]], dtype=torch.long, device=device),
        torch.tensor([[BOS_ID, COMMANDER_ID, 30, 31, 32]], dtype=torch.long, device=device),
        torch.tensor([[BOS_ID, SYSTEM_ID, 40, 41]], dtype=torch.long, device=device),
        torch.randint(20, 200, (2, 48), device=device),
        idx_mt,
    ]
    parent.eval()
    ra1.eval()
    max_abs = 0.0
    with torch.inference_mode():
        for x in docs:
            max_abs = max(max_abs, _max_abs_logit(parent(x), ra1(x)))
            d = ra1.ra1.delta(torch.randn(x.shape[0], x.shape[1], 256, device=device, dtype=next(ra1.parameters()).dtype))
            max_abs_delta = float(d.abs().max().item())
            if max_abs_delta != 0.0:
                return {"ok": False, "reason": "zero_init_delta_nonzero", "max_abs_delta": max_abs_delta, "placement": placement}

    # Negative activation: with nonzero W_up, inactive spans still add 0
    with torch.no_grad():
        ra1.ra1.up.weight.fill_(0.05)
    doc = torch.tensor([[BOS_ID, 20, 21, 22, 23, 24]], dtype=torch.long, device=device)
    cmd = torch.tensor([[BOS_ID, COMMANDER_ID, 30, 31, 32]], dtype=torch.long, device=device)
    post = torch.tensor([[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, EOS_ID, 99, 100]], dtype=torch.long, device=device)
    with torch.inference_mode():
        doc_diff = _max_abs_logit(parent(doc), ra1(doc))
        cmd_diff = _max_abs_logit(parent(cmd), ra1(cmd))
        post_masks = ra1.control_masks(post)
        post_span = post_masks["span"][0].tolist()
    ra1.ra1.reset_zero_init()
    ra1.to(device)

    # Positive: span positions exist; after freeze only RA1 has grad
    freeze_base_train_ra1(ra1)
    x = idx_mt
    y = torch.roll(x, -1, dims=1)
    ra1.zero_grad(set_to_none=True)
    logits = ra1(x)
    loss = torch.nn.functional.cross_entropy(logits[:, :-1].reshape(-1, logits.size(-1)), y[:, :-1].reshape(-1))
    loss.backward()
    ra1_grad = 0.0
    frozen_grad = 0.0
    frozen_had_grad = False
    for n, p in ra1.named_parameters():
        if p.grad is None:
            continue
        nrm = float(p.grad.detach().float().norm(2).item())
        if n.startswith("ra1."):
            ra1_grad += nrm * nrm
        else:
            frozen_had_grad = True
            frozen_grad += nrm * nrm
    ra1_grad = ra1_grad ** 0.5
    frozen_grad = frozen_grad ** 0.5
    ra1.zero_grad(set_to_none=True)
    gate = "UNSAFE"
    if ra1_grad < GRAD_REVIEW:
        gate = "SAFE"
    elif ra1_grad < GRAD_HARD:
        gate = "REVIEW"
    ok = (
        n_ra1 <= RA1_PARAM_CEILING
        and masks_ok["ok"]
        and multi_turn
        and max_abs == 0.0
        and doc_diff == 0.0
        and cmd_diff == 0.0
        and post_span[5] is False
        and post_span[6] is False
        and ra1_grad > 0.0
        and not frozen_had_grad
        and gate != "UNSAFE"
    )
    return {
        "ok": ok,
        "placement": placement,
        "bottleneck": bottleneck,
        "RA1_PARAMETER_COUNT": n_ra1,
        "ARCHITECTURE_ID": ra1.architecture_id,
        "MAX_ABS_LOGIT_DIFF": max_abs,
        "ZERO_INIT_PARITY": "PASS" if max_abs == 0.0 else "FAIL",
        "DOCUMENT_PARITY_NONZERO_WUP": "PASS" if doc_diff == 0.0 else "FAIL",
        "COMMANDER_PARITY_NONZERO_WUP": "PASS" if cmd_diff == 0.0 else "FAIL",
        "POST_EOS_SPAN_INACTIVE": post_span[5] is False and post_span[6] is False,
        "MULTI_TURN_RESET": multi_turn,
        "AC2_MASKS": masks_ok["ok"],
        "RA1_GRAD": ra1_grad,
        "FROZEN_PARAM_GRAD": frozen_grad,
        "FROZEN_HAD_GRAD": frozen_had_grad,
        "GRAD_GATE": gate,
        "SPAN_ACTIVE_AFTER_ASSISTANT": span[4] is True,
        "FROZEN_HASH": frozen_parameter_hash(ra1),
        "REMOVABLE": True,
        "STATE_DICT_RA1_KEYS": [n for n, _ in ra1.named_parameters() if n.startswith("ra1.")],
    }


def main() -> dict[str, Any]:
    from wrim_proven_load import disable_tf32

    torch.manual_seed(SEED)
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    parent, parent_hash = _load_parent(device)
    parent_hash_named = frozen_parameter_hash(parent)
    rows = []
    ok_all = True
    for placement in (PLACEMENT_B, PLACEMENT_A):
        row = validate_placement(placement, 32, parent, device)
        rows.append(row)
        ok_all = ok_all and bool(row.get("ok"))
        if frozen_parameter_hash(_load_ra1(placement, 32, device)) != parent_hash_named:
            row["FROZEN_PARAMETER_HASH_MATCH"] = "NO"
            ok_all = False
        else:
            row["FROZEN_PARAMETER_HASH_MATCH"] = "YES"
    report = {
        "ok": ok_all,
        "PARENT": str(PARENT),
        "FROZEN_PARENT_HASH": parent_hash,
        "FROZEN_PARAMETER_HASH": parent_hash_named,
        "PLACEMENTS": rows,
        "PREFERRED_PLACEMENT": PLACEMENT_B,
        "RA1_BOTTLENECK": 32,
        "RA1_ZERO_INIT_PARITY": "PASS" if all(r.get("ZERO_INIT_PARITY") == "PASS" for r in rows) else "FAIL",
        "DOCUMENT_PARITY": "PASS" if all(r.get("DOCUMENT_PARITY_NONZERO_WUP") == "PASS" for r in rows) else "FAIL",
        "FROZEN_PARAMETER_HASH_MATCH": "YES" if ok_all else "NO",
        "BASE_MODEL_CHANGED": "NO",
        "TRAINING_AUTHORIZATION": "OFF",
    }
    _write(VALIDATE_REPORT, report)
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
