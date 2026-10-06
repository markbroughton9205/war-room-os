"""AC2 convert, activation tests, and gradient preflight. No optimizer.step."""
from __future__ import annotations

import hashlib
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch

from wrim_arch_uh1_phase_a import _sha_file, _sha_tensor, _split_loss, load_jsonl
from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, SYSTEM_ID
from wrim_g20m_uh1 import (
    ARCH_ID_UH1_AC2,
    UH1_AC2_PARAM_COUNT,
    WRIMUH1Model,
    clone_ac2_from_ac1,
    freeze_body_train_ac2,
)
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    GRAD_HARD,
    GRAD_REVIEW,
    MICRO_BATCH,
    SEED,
    SEQ_LEN,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_plm3_encode import encode_example, pack_train_stream, prefix_ids_for_inference, slice_batches

CONVERT_ID = "WRIM1-ARCH-UH1-AC2-CONVERTED"
PARENT_CKPT = Path(CKPT_BASE) / "WRIM1-UH1-AC1-ROLE-000003" / "step-10"
PARENT_HASH = "80e74f985c6d935cf475ecacd3a4018385cf5631978a14a2306d89640cf3007a"
CKPT_DIR = Path(CKPT_BASE) / CONVERT_ID


def _ctrl_grads(model: torch.nn.Module) -> dict[str, float]:
    entry = span = stop = head = tok = attn = ffn = 0.0
    trainable_sq = 0.0
    all_sq = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        all_sq += n * n
        if p.requires_grad:
            trainable_sq += n * n
        if name == "assistant_ctrl":
            entry = n
        elif name == "assistant_span_ctrl":
            span = n
        elif name == "assistant_stop_ctrl":
            stop = n
        elif name.startswith("lm_head"):
            head = n
        elif name.startswith("tok_emb"):
            tok = n
        elif ".attn" in name and ".attn_norm" not in name:
            attn += n * n
        elif ".ffn" in name and ".ffn_norm" not in name:
            ffn += n * n
    g = trainable_sq ** 0.5
    gate = "UNSAFE"
    if g < GRAD_REVIEW:
        gate = "SAFE"
    elif g < GRAD_HARD:
        gate = "REVIEW"
    return {
        "ENTRY_CTRL_GRAD": entry,
        "SPAN_CTRL_GRAD": span,
        "STOP_CTRL_GRAD": stop,
        "LM_HEAD_GRAD": head,
        "TOK_EMB_INPUT_GRAD": tok,
        "ATTENTION_GRAD": attn ** 0.5,
        "FFN_GRAD": ffn ** 0.5,
        "TOTAL_TRAINABLE_GRAD": g,
        "TOTAL_GRAD": all_sq ** 0.5,
        "GRAD_GATE": gate,
    }


def activation_tests() -> dict[str, Any]:
    from wrim_g20m_uh1 import D_MODEL

    m = WRIMUH1Model(assistant_control=True, span_control=True)
    # [BOS, CMD, 9, AST, 11, 12, EOS, CMD, 9, AST, 13, EOS]
    idx = torch.tensor(
        [[BOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 11, 12, EOS_ID, COMMANDER_ID, 9, ASSISTANT_ID, 13, EOS_ID]],
        dtype=torch.long,
    )
    masks = m.control_masks(idx)
    entry = masks["entry"][0].tolist()
    span = masks["span"][0].tolist()
    stop = masks["stop"][0].tolist()
    expect_entry = [False, False, False, True, False, False, False, False, False, True, False, False]
    expect_span = [False, False, False, False, True, True, False, False, False, False, True, False]
    expect_stop = [False, False, False, False, False, True, False, False, False, False, True, False]
    doc = torch.tensor([[BOS_ID, 20, 21, 22, 23, 24]], dtype=torch.long)
    dmask = m.control_masks(doc)
    cmd = torch.tensor([[BOS_ID, COMMANDER_ID, 30, 31, 32]], dtype=torch.long)
    cmask = m.control_masks(cmd)
    none = torch.tensor([[20, 21, 22, 23]], dtype=torch.long)
    nmask = m.control_masks(none)
    ok = (
        entry == expect_entry
        and span == expect_span
        and stop == expect_stop
        and (not bool(dmask["entry"].any()) and not bool(dmask["span"].any()))
        and (not bool(cmask["entry"].any()) and not bool(cmask["span"].any()))
        and (not bool(nmask["entry"].any()) and not bool(nmask["span"].any()))
    )
    return {
        "ok": ok,
        "entry": entry,
        "span": span,
        "stop": stop,
        "expect_entry": expect_entry,
        "expect_span": expect_span,
        "expect_stop": expect_stop,
        "NO_ASSISTANT_INACTIVE": not bool(nmask["span"].any() or nmask["entry"].any()),
        "COMMANDER_SPAN_INACTIVE": not bool(cmask["span"].any()),
        "DOCUMENT_SPAN_INACTIVE": not bool(dmask["span"].any()),
        "AFTER_ASSISTANT_SPAN_ACTIVE": span[4] is True and span[5] is True,
        "AFTER_EOS_SPAN_INACTIVE": span[6] is False and span[7] is False,
        "MULTI_TURN_RESET": entry[3] is True and entry[9] is True and span[8] is False,
        "d_model": D_MODEL,
    }


def probe_pack(model, tokenizer, train_rows: list[dict], device, *, lm_head: bool = False, stop: bool = False, ctrl: bool = True) -> dict[str, Any]:
    encoded = [encode_example(tokenizer, r) for r in train_rows]
    mean_len = max(1, int(np.mean([int(e["tokens"].size) for e in encoded])))
    need = 10 * MICRO_BATCH * SEQ_LEN + 1
    tiled = list(encoded)
    while len(tiled) * mean_len * 60 < need:
        tiled = tiled + tiled
    stream, mask = pack_train_stream(tiled)
    batches = slice_batches(stream, mask)
    x_np, y_np, m_np = batches[0]
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
    model.zero_grad(set_to_none=True)
    freeze_body_train_ac2(model, lm_head=lm_head, stop=stop, ctrl=ctrl)
    logits = model(x)
    split = _split_loss(logits, y, y_mask, first_w=1.0)
    split["loss"].backward()
    grads = _ctrl_grads(model)
    model.zero_grad(set_to_none=True)
    # isolation: document-only backward on frozen-ctrl-train should yield ~0 ctrl grad
    return {
        **grads,
        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
        "EOS_CE": split["EOS_CE"],
        "weighted_loss": float(split["loss"].detach().item()),
        "n_first": split["n_first"],
        "n_later": split["n_later"],
        "n_eos": split["n_eos"],
        "optimizer_step": False,
        "n_span_positions": int(model.control_masks(x)["span"].sum().item()),
        "n_entry_positions": int(model.control_masks(x)["entry"].sum().item()),
    }


def document_ctrl_grad(model, device) -> dict[str, float]:
    freeze_body_train_ac2(model)
    model.zero_grad(set_to_none=True)
    doc = torch.randint(20, 200, (8, 64), device=device)
    model(doc).mean().backward()
    g = _ctrl_grads(model)
    model.zero_grad(set_to_none=True)
    return {
        "ENTRY_CTRL_GRAD": g["ENTRY_CTRL_GRAD"],
        "SPAN_CTRL_GRAD": g["SPAN_CTRL_GRAD"],
        "TOTAL_TRAINABLE_GRAD": g["TOTAL_TRAINABLE_GRAD"],
    }


def main() -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from safetensors.torch import save_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_cpt_identity import LINUX_CKPT_ROOT
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_hvu_role_search import GENERIC_PROMPTS
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    t0 = datetime.now(timezone.utc).isoformat()
    tests = activation_tests()
    if not tests["ok"]:
        report = {"ok": False, "reason": "activation_tests_fail", "tests": tests, "TRAINING_AUTHORIZATION": "OFF"}
        Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_AC2_PHASE12_REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
        return report

    dump = resolve_dump_root(None)
    assert dump is not None
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    assert sha256_file(tok_path) == TOKENIZER_EXPECTED_SHA
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    assert sha256_file(step400) == CANONICAL_HASH

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    src = PARENT_CKPT / MODEL_NAME
    src_hash = sha256_file(src)
    assert src_hash == PARENT_HASH

    parent = WRIMUH1Model(assistant_control=True, span_control=False)
    parent.load_state_dict(load_safetensors_file(str(src)), strict=True)
    ac2 = clone_ac2_from_ac1(parent, stop_control=False)
    n = int(sum(p.numel() for p in ac2.parameters()))
    if n != UH1_AC2_PARAM_COUNT:
        raise RuntimeError(f"param count {n} != {UH1_AC2_PARAM_COUNT}")
    if float(ac2.assistant_span_ctrl.detach().abs().max().item()) != 0.0:
        raise RuntimeError("span not zero-init")
    if not torch.equal(ac2.assistant_ctrl.detach().cpu(), parent.assistant_ctrl.detach().cpu()):
        raise RuntimeError("entry ctrl not cloned from parent")

    parent.to(device).eval()
    ac2.to(device).eval()
    max_abs = 0.0
    with torch.inference_mode():
        for p in GENERIC_PROMPTS[:16]:
            ids = prefix_ids_for_inference(tokenizer, p)
            x = torch.tensor([ids], dtype=torch.long, device=device)
            max_abs = max(max_abs, float((parent(x) - ac2(x)).abs().max().item()))
        rng = torch.randint(20, 200, (4, 64), device=device)
        max_abs = max(max_abs, float((parent(rng) - ac2(rng)).abs().max().item()))
        val_c1 = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0" / "val.jsonl")
        greedy_match = 0
        nll_max = 0.0
        for rec in val_c1:
            pref = prefix_ids_for_inference(tokenizer, rec["prompt"])
            x = torch.tensor([pref], dtype=torch.long, device=device)
            a = parent(x)[0, -1]
            b = ac2(x)[0, -1]
            greedy_match += int(int(a.argmax()) == int(b.argmax()))
            nll_max = max(nll_max, float((torch.log_softmax(a, -1) - torch.log_softmax(b, -1)).abs().max().item()))
    parity_ok = max_abs < 1e-5 and greedy_match == len(val_c1) and nll_max < 1e-5
    if not parity_ok:
        report = {
            "ok": False,
            "reason": "parity_fail",
            "max_abs_logit_diff": max_abs,
            "greedy_parity": greedy_match == len(val_c1),
            "nll_max": nll_max,
            "TRAINING_AUTHORIZATION": "OFF",
        }
        Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_AC2_PHASE12_REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
        return report

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    cpu_state = {k: v.detach().cpu().contiguous() for k, v in ac2.state_dict().items()}
    save_file(cpu_state, str(CKPT_DIR / MODEL_NAME))
    converted_hash = _sha_file(CKPT_DIR / MODEL_NAME)
    man = {
        "architecture_id": ARCH_ID_UH1_AC2,
        "parent": "WRIM1-UH1-AC1-ROLE-000003/step-10",
        "parent_hash": src_hash,
        "converted_model_hash": converted_hash,
        "entry_ctrl_parameters": 256,
        "span_ctrl_parameters": 256,
        "stop_ctrl_parameters": 0,
        "parameter_count": n,
        "zero_init_span": True,
        "entry_cloned_from_ac1": True,
        "canonical_unchanged": True,
    }
    man["architecture_manifest_hash"] = hashlib.sha256(
        json.dumps(man, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    (CKPT_DIR / "architecture-manifest.json").write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")

    packs = {
        "C1_easy_unigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0" / "train.jsonl",
        "C3_easy_bigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C3_easy_bigram_eos-v1.0.0" / "train.jsonl",
        "C6_easy_trigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C6_easy_trigram_eos-v1.0.0" / "train.jsonl",
        "continuation": Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "train.jsonl",
        "first_token": Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl",
    }
    probes = {}
    for name, p in packs.items():
        rows = load_jsonl(p)
        probes[name] = probe_pack(ac2, tokenizer, rows, device)
    doc_g = document_ctrl_grad(ac2, device)

    meaningful = {k: v for k, v in probes.items() if k != "first_token" or True}
    safe = [k for k, v in probes.items() if v.get("GRAD_GATE") == "SAFE" and (v.get("n_later") or 0) > 0]
    if not safe:
        safe = [k for k, v in probes.items() if v.get("GRAD_GATE") == "SAFE"]
    chosen = min(safe, key=lambda k: probes[k]["TOTAL_TRAINABLE_GRAD"]) if safe else None
    proceed = "PHASE_3" if chosen else "CURRICULUM_REDESIGN"

    report = {
        "ok": True,
        "kind": "WRIM1_ARCH_UH1_AC2_PHASE12_REPORT",
        "CONVERT_ID": CONVERT_ID,
        "ARCHITECTURE_ID": ARCH_ID_UH1_AC2,
        "PARENT": "WRIM1-UH1-AC1-ROLE-000003/step-10",
        "PARENT_HASH": src_hash,
        "CONVERTED_MODEL_HASH": converted_hash,
        "PARAMETER_COUNT": n,
        "ENTRY_CTRL_PARAMETERS": 256,
        "SPAN_CTRL_PARAMETERS": 256,
        "STOP_CTRL_PARAMETERS": 0,
        "ACTIVATION_TESTS": tests,
        "AC2_PARITY": {
            "max_abs_logit_diff": max_abs,
            "greedy_parity": greedy_match == len(val_c1),
            "nll_parity": nll_max < 1e-5,
            "logit_parity": parity_ok,
        },
        "DOCUMENT_CTRL_GRAD": doc_g,
        "PROBES": probes,
        "CHOSEN_SAFE_PACK": chosen,
        "PROCEED": proceed,
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_step": False,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_AC2_PHASE12_REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    obj = main()
    print(json.dumps({k: obj.get(k) for k in (
        "ok", "PROCEED", "CHOSEN_SAFE_PACK", "PARAMETER_COUNT", "CONVERTED_MODEL_HASH",
        "AC2_PARITY", "DOCUMENT_CTRL_GRAD",
    )}, indent=2))
    tests = obj.get("ACTIVATION_TESTS") or {}
    print("ACTIVATION", {k: tests.get(k) for k in (
        "ok", "NO_ASSISTANT_INACTIVE", "COMMANDER_SPAN_INACTIVE", "DOCUMENT_SPAN_INACTIVE",
        "AFTER_ASSISTANT_SPAN_ACTIVE", "AFTER_EOS_SPAN_INACTIVE", "MULTI_TURN_RESET",
    )})
    print("--- PROBES ---")
    print(json.dumps(obj.get("PROBES"), indent=2))
