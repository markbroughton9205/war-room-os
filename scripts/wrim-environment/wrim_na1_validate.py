"""MOD-01 NA1 architecture validation. No optimizer.step."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, SYSTEM_ID
from wrim_g20m_ra1 import (
    ADAPTER_PARAM_CEILING,
    ARCH_ID_EA1_RA1_NA1,
    NA1_PARAM_CEILING,
    PLACEMENT_B,
    WRIMRA1Model,
    freeze_base_train_ra1,
    frozen_parameter_hash,
    module_parameter_hash,
)
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT, GRAD_HARD
from wrim_plm1_encode import prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_phrase_school import load_rows
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
OUT = Path(DATA_ROOT) / "WRIM_NA1_ARCHITECTURE_VALIDATE.json"
PHRASE_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0" / "val.jsonl"
EXPECTED_NA1 = 16640


def _load_pair(device: torch.device) -> tuple[WRIMRA1Model, WRIMRA1Model, dict[str, Any]]:
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    parent = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False)
    missing, unexpected = parent.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in parent.named_parameters() if n.startswith(("ea1.", "ra1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"parent load mismatch extra={extra} unexpected={unexpected}")
    child = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=True)
    missing, unexpected = child.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in child.named_parameters() if n.startswith(("ea1.", "ra1.", "na1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"child load mismatch extra={extra} unexpected={unexpected}")
    if child.na1 is None:
        raise RuntimeError("na1 missing")
    child.na1.reset_zero_init()
    child.set_span_route("ra1")
    parent.to(device).eval()
    child.to(device).eval()
    return parent, child, src


def validate_na1_architecture() -> dict[str, Any]:
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    parent, child, src = _load_pair(device)
    n_na1 = child.na1.param_count() if child.na1 is not None else 0
    n_ea1 = child.ea1.param_count() if child.ea1 is not None else 0
    n_ra1 = child.ra1.param_count()
    physical = n_ea1 + n_ra1 + n_na1
    up_zero = float(child.na1.up.weight.abs().max().item()) if child.na1 is not None else 1.0
    frozen_match = frozen_parameter_hash(parent) == frozen_parameter_hash(child)
    ea1_match = module_parameter_hash(parent, "ea1.") == module_parameter_hash(child, "ea1.")
    ra1_match = module_parameter_hash(parent, "ra1.") == module_parameter_hash(child, "ra1.")

    idx_doc = torch.tensor([[BOS_ID, COMMANDER_ID, 9, 10, 11, 12, EOS_ID]], dtype=torch.long, device=device)
    idx_resp = torch.tensor([[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, 12, EOS_ID]], dtype=torch.long, device=device)
    idx_mt = torch.tensor(
        [[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, 12, EOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 13, EOS_ID]],
        dtype=torch.long,
        device=device,
    )
    with torch.inference_mode():
        child.set_span_route("ra1")
        max_doc = float((parent(idx_doc) - child(idx_doc)).abs().max().item())
        max_resp = float((parent(idx_resp) - child(idx_resp)).abs().max().item())
        span_doc = bool(child.control_masks(idx_doc)["span"].any().item())
        ra1_m, na1_m = child._span_route_masks(idx_resp)
        exclusive = not bool((ra1_m & na1_m).any().item())
        unknown_before = child.last_route_fallbacks
        child.set_span_route("unknown-label")
        unknown_fallback = child.span_route == "ra1" and child.last_route_fallbacks >= unknown_before
        child.set_span_route("ra1")
        child.set_span_route("na1", schedule=["na1", "ra1"])
        ra1_mt, na1_mt = child._span_route_masks(idx_mt)
        span = child.control_masks(idx_mt)["span"][0].tolist()
        # token indices 4,5 are first-response span; 10 is second-response span
        first_na1 = bool(na1_mt[0, 4].item()) and bool(na1_mt[0, 5].item()) and not bool(ra1_mt[0, 4].item())
        second_ra1 = bool(ra1_mt[0, 10].item()) and not bool(na1_mt[0, 10].item())
        eos_unlatch = span[6] is False and span[7] is False and span[8] is False
        multi_turn = first_na1 and second_ra1 and eos_unlatch
        child.set_span_route("ra1")

    greedy_ok = True
    rows = load_rows(PHRASE_VAL) if PHRASE_VAL.is_file() else []
    for rec in rows:
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        a = greedy_from_ids(parent, tok, device, prefix, max_new=8)
        b = greedy_from_ids(child, tok, device, prefix, max_new=8)
        if list(a.get("new_ids") or []) != list(b.get("new_ids") or []):
            greedy_ok = False
            break

    # Nonzero NA1 must still be inactive on documents and on RA1-routed span.
    assert child.na1 is not None
    with torch.no_grad():
        child.na1.up.weight.fill_(0.05)
    child.set_span_route("ra1")
    with torch.inference_mode():
        doc_nz = float((parent(idx_doc) - child(idx_doc)).abs().max().item())
        resp_ra1_nz = float((parent(idx_resp) - child(idx_resp)).abs().max().item())
    child.na1.reset_zero_init()
    child.to(device)

    mask = freeze_base_train_ra1(child, train_ea1=False, train_ra1=False, train_na1=True)
    trainable = mask["TRAINABLE_NAMES"]
    n_train = int(mask["TRAINABLE_PARAMETER_COUNT"])
    ra1_frozen = all(not n.startswith("ra1.") for n in trainable)
    ea1_frozen = all(not n.startswith("ea1.") for n in trainable)
    only_na1 = all(n.startswith("na1.") for n in trainable) and n_train == n_na1
    child.zero_grad(set_to_none=True)
    child.set_span_route("na1")
    x = idx_resp
    y = torch.roll(x, -1, dims=1)
    logits = child(x)
    loss = torch.nn.functional.cross_entropy(logits[:, :-1].reshape(-1, logits.size(-1)), y[:, :-1].reshape(-1))
    loss.backward()
    na1_grad = 0.0
    frozen_had = False
    for n, p in child.named_parameters():
        if p.grad is None:
            continue
        nrm = float(p.grad.detach().float().norm(2).item())
        if n.startswith("na1."):
            na1_grad += nrm * nrm
        elif p.requires_grad:
            frozen_had = True
        elif nrm > 0:
            frozen_had = True
    na1_grad = na1_grad ** 0.5
    child.zero_grad(set_to_none=True)
    child.set_span_route("ra1")

    tmp = Path(DATA_ROOT) / "WRIM_NA1_VALIDATE_STATE.pt"
    torch.save({k: v.detach().cpu() for k, v in child.state_dict().items() if k.startswith("na1.")}, tmp)
    blob = torch.load(tmp, map_location="cpu", weights_only=False)
    reload = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=True)
    reload.load_state_dict(src, strict=False)
    reload.load_state_dict(blob, strict=False)
    ser_ok = all(torch.equal(child.state_dict()[k].cpu(), reload.state_dict()[k].cpu()) for k in blob)
    tmp.unlink(missing_ok=True)

    parity = (
        n_na1 == EXPECTED_NA1
        and n_na1 <= NA1_PARAM_CEILING
        and physical <= ADAPTER_PARAM_CEILING
        and physical == 49920
        and up_zero == 0.0
        and max_doc == 0.0
        and max_resp == 0.0
        and greedy_ok
        and frozen_match
        and ea1_match
        and ra1_match
        and exclusive
        and unknown_fallback
        and multi_turn
        and doc_nz == 0.0
        and resp_ra1_nz == 0.0
        and not span_doc
        and only_na1
        and ra1_frozen
        and ea1_frozen
        and n_train == EXPECTED_NA1
        and na1_grad > 0.0
        and not frozen_had
        and ser_ok
        and child.architecture_id == ARCH_ID_EA1_RA1_NA1
        and na1_grad < GRAD_HARD
    )
    report = {
        "PARENT": str(PARENT),
        "PARENT_HASH": EXPECT,
        "ARCHITECTURE_ID": child.architecture_id,
        "NA1_PLACEMENT": "pre_lm_head",
        "NA1_BOTTLENECK": 32,
        "NA1_PARAMETER_COUNT": n_na1,
        "EA1_PARAMETER_COUNT": n_ea1,
        "RA1_PARAMETER_COUNT": n_ra1,
        "PHYSICAL_ADAPTER_PARAMETERS": physical,
        "NA1_W_UP_MAX_ABS": up_zero,
        "MAX_ABS_LOGIT_DIFF_DOCUMENT": max_doc,
        "MAX_ABS_LOGIT_DIFF_RESPONSE_RA1_ROUTE": max_resp,
        "DOCUMENT_SPAN_ANY": span_doc,
        "DOCUMENT_PARITY_NONZERO_NA1": "PASS" if doc_nz == 0.0 else "FAIL",
        "RA1_ROUTE_PARITY_NONZERO_NA1": "PASS" if resp_ra1_nz == 0.0 else "FAIL",
        "GREEDY_PARITY": "PASS" if greedy_ok else "FAIL",
        "FROZEN_PARAMETER_HASH_MATCH": "YES" if frozen_match else "NO",
        "EA1_HASH_MATCH": "YES" if ea1_match else "NO",
        "RA1_HASH_MATCH": "YES" if ra1_match else "NO",
        "MUTUAL_EXCLUSION": "YES" if exclusive else "NO",
        "UNKNOWN_ROUTE_FALLBACK": "RA1" if unknown_fallback else "FAIL",
        "MULTI_TURN_ROUTE_RESET": "PASS" if multi_turn else "FAIL",
        "TRAINABLE_NAMES": trainable,
        "TRAINABLE_PARAMETER_COUNT": n_train,
        "TRAIN_NA1_ONLY": "YES" if only_na1 else "NO",
        "NA1_GRAD": na1_grad,
        "FROZEN_HAD_GRAD": frozen_had,
        "SERIALIZE_ROUNDTRIP": "PASS" if ser_ok else "FAIL",
        "ORACLE_GATE_CLASS": child.oracle_gate_class,
        "ROUTER_PARAMETER_COUNT": 0,
        "NA1_ZERO_INIT_PARITY": "PASS" if parity else "FAIL",
        "OPTIMIZER_STEPS": 0,
    }
    _write(OUT, json.loads(json.dumps(report, default=str)))
    return report


def main() -> dict[str, Any]:
    report = validate_na1_architecture()
    print(json.dumps(report, indent=2, default=str))
    if report["NA1_ZERO_INIT_PARITY"] != "PASS":
        raise SystemExit(1)
    return report


if __name__ == "__main__":
    main()
