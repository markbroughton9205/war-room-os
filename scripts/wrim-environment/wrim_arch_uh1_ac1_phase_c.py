"""Phase C: UH1-AC1 zero-init assistant control vector, parity, gradient search.

Does not replace canonical architecture. No optimizer.step.
"""
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

from wrim_arch_uh1_phase_a import CONVERT_ID as UH1_CONVERT_ID
from wrim_arch_uh1_phase_a import _sha_file, _sha_tensor, load_jsonl, probe_pack
from wrim_cpt_identity import ASSISTANT_ID
from wrim_g20m import VOCAB_SIZE, WRIM0Model
from wrim_g20m_uh1 import (
    AC1_ADDED,
    ARCH_ID_UH1_AC1,
    UH1_AC1_PARAM_COUNT,
    UH1_PARAM_COUNT,
    assert_untied,
    clone_ac1_from_uh1,
    clone_init_from_tied,
    freeze_body_train_ctrl,
)
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    DATA_ROOT,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_HARD,
    GRAD_REVIEW,
    NEWLINE_TOKEN_ID,
    SEED,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_plm3_encode import prefix_ids_for_inference


CONVERT_ID = "WRIM1-ARCH-UH1-AC1-CONVERTED"
CKPT_DIR = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only") / CONVERT_ID
UH1_CKPT = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only") / UH1_CONVERT_ID


def _gate(g: float) -> str:
    if g < GRAD_REVIEW:
        return "SAFE"
    if g < GRAD_HARD:
        return "REVIEW"
    return "UNSAFE"


def main() -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from safetensors.torch import save_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_hvu_role_search import GENERIC_PROMPTS
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    t0 = datetime.now(timezone.utc).isoformat()
    dump = resolve_dump_root(None)
    assert dump is not None
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    assert sha256_file(tok_path) == TOKENIZER_EXPECTED_SHA
    tokenizer = Tokenizer.from_file(str(tok_path))

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    src = Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME
    src_hash = sha256_file(src)
    assert src_hash == EXPECTED_PARENT_MODEL_HASH
    uh1_src = UH1_CKPT / MODEL_NAME
    uh1_hash = sha256_file(uh1_src)

    tied = WRIM0Model()
    tied.load_state_dict(load_safetensors_file(str(src)), strict=True)
    uh1 = clone_init_from_tied(tied, assistant_control=False)
    # Prefer converted UH1 weights if hash matches Phase A artifact.
    uh1.load_state_dict(load_safetensors_file(str(uh1_src)), strict=True)
    ac1 = clone_ac1_from_uh1(uh1)
    sep = assert_untied(ac1)
    n = int(sum(p.numel() for p in ac1.parameters()))
    if n != UH1_AC1_PARAM_COUNT:
        raise RuntimeError(f"param count {n} != {UH1_AC1_PARAM_COUNT}")
    if float(ac1.assistant_ctrl.detach().abs().max().item()) != 0.0:
        raise RuntimeError("assistant_ctrl not zero-init")
    if "assistant_ctrl" not in ac1.state_dict():
        raise RuntimeError("assistant_ctrl missing from state dict")

    tied.to(device).eval()
    uh1.to(device).eval()
    ac1.to(device).eval()

    max_abs = 0.0
    doc_abs = 0.0
    with torch.inference_mode():
        for p in GENERIC_PROMPTS[:16]:
            ids = prefix_ids_for_inference(tokenizer, p)
            x = torch.tensor([ids], dtype=torch.long, device=device)
            a = tied(x)
            b = uh1(x)
            c = ac1(x)
            max_abs = max(max_abs, float((a - c).abs().max().item()), float((b - c).abs().max().item()))
        # Ordinary document tokens: never include assistant id.
        doc = torch.randint(7, VOCAB_SIZE, (4, 64), device=device)
        doc_abs = float((uh1(doc) - ac1(doc)).abs().max().item())
        max_abs = max(max_abs, doc_abs)

    parity_ok = max_abs < 1e-5 and doc_abs < 1e-5
    if not parity_ok:
        report = {
            "ok": False,
            "kind": "WRIM1_ARCH_UH1_AC1_CONVERSION_PARITY_FAIL",
            "max_abs_logit_diff": max_abs,
            "document_abs_logit_diff": doc_abs,
            "TRAINING_AUTHORIZATION": "OFF",
        }
        Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_AC1_PHASE_C_REPORT.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        return report

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    cpu_state = {k: v.detach().cpu().contiguous() for k, v in ac1.state_dict().items()}
    save_file(cpu_state, str(CKPT_DIR / MODEL_NAME))
    converted_hash = _sha_file(CKPT_DIR / MODEL_NAME)
    man = {
        "architecture_id": ARCH_ID_UH1_AC1,
        "source": "WRIM1-CPT-000005/step-75",
        "uh1_parent": UH1_CONVERT_ID,
        "source_model_hash": src_hash,
        "uh1_model_hash": uh1_hash,
        "converted_model_hash": converted_hash,
        "tok_emb_hash": _sha_tensor(ac1.tok_emb.weight),
        "lm_head_hash": _sha_tensor(ac1.lm_head.weight),
        "assistant_ctrl_hash": _sha_tensor(ac1.assistant_ctrl),
        "parameter_count_before": UH1_PARAM_COUNT,
        "parameter_count_after": n,
        "added_parameter_count": AC1_ADDED,
        "zero_init": True,
        "removable": True,
        "activation": "hidden[:, 1:] += 1[idx[:, :-1]==ASSISTANT] * assistant_ctrl",
        "canonical_unchanged": True,
        **sep,
    }
    man_blob = json.dumps(man, sort_keys=True, separators=(",", ":")).encode()
    man["architecture_manifest_hash"] = hashlib.sha256(man_blob).hexdigest()
    (CKPT_DIR / "architecture-manifest.json").write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")

    packs = {
        "C1_easy_unigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0" / "train.jsonl",
        "C3_easy_bigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C3_easy_bigram_eos-v1.0.0" / "train.jsonl",
        "C6_easy_trigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C6_easy_trigram_eos-v1.0.0" / "train.jsonl",
        "continuation": Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "train.jsonl",
    }

    full_probes = {}
    ac1.enable_training()
    for name, p in packs.items():
        rows = load_jsonl(p)
        full_probes[name] = probe_pack(ac1, tokenizer, rows, device)

    ctrl_probes = {}
    freeze_body_train_ctrl(ac1)
    for name, p in packs.items():
        rows = load_jsonl(p)
        ctrl_probes[name] = probe_pack(ac1, tokenizer, rows, device)
        ctrl_probes[name]["BODY_FROZEN"] = True
        ctrl_probes[name]["TRAINABLE"] = "assistant_ctrl"

    # Document-only backward: control grad must be ~0.
    freeze_body_train_ctrl(ac1)
    ac1.zero_grad(set_to_none=True)
    doc = torch.randint(7, VOCAB_SIZE, (8, 64), device=device)
    logits = ac1(doc)
    logits.mean().backward()
    doc_ctrl = 0.0 if ac1.assistant_ctrl.grad is None else float(ac1.assistant_ctrl.grad.detach().float().norm(2).item())
    ac1.zero_grad(set_to_none=True)

    full_safe = [k for k, v in full_probes.items() if v.get("GRAD_GATE") == "SAFE"]
    ctrl_safe = [k for k, v in ctrl_probes.items() if v.get("GRAD_GATE") == "SAFE"]
    full_all_hard = all(full_probes[k]["TOTAL_GRAD"] >= GRAD_HARD for k in full_probes)
    ctrl_all_hard = all(ctrl_probes[k]["TOTAL_GRAD"] >= GRAD_HARD for k in ctrl_probes)

    if full_safe:
        result = "PASS_FULL_MODEL"
        chosen = min(full_safe, key=lambda k: full_probes[k]["TOTAL_GRAD"])
        train_scope = "FULL_MODEL"
        proceed = "PHASE_D_FULL"
    elif ctrl_safe:
        result = "PASS_CONTROL_VECTOR_ONLY"
        chosen = min(ctrl_safe, key=lambda k: ctrl_probes[k]["TOTAL_GRAD"])
        train_scope = "CONTROL_VECTOR_ONLY"
        proceed = "PHASE_D_CTRL"
    elif full_all_hard and ctrl_all_hard:
        result = "FAIL"
        chosen = None
        train_scope = None
        proceed = "STOP_ARCHITECTURE_RESPONSE_CONTROL_BLOCKED"
    else:
        result = "REVIEW_ONLY"
        chosen = None
        train_scope = None
        proceed = "STOP_NO_SAFE_PACK"

    # Parent geometry snapshot (init = parent)
    from wrim_hvu_role_search import VAL_PROMPTS

    val_c1 = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0" / "val.jsonl")
    ac1.eval()
    nl_argmax = 0
    nl_probs = []
    tgt_logits = []
    nl_logits = []
    with torch.inference_mode():
        for rec in val_c1:
            pref = prefix_ids_for_inference(tokenizer, rec["prompt"])
            lg = ac1(torch.tensor([pref], dtype=torch.long, device=device))[0, -1].float()
            pr = torch.softmax(lg, dim=-1)
            tid = tokenizer.encode(str(rec["target"]), add_special_tokens=False).ids
            tid0 = int(tid[0]) if tid else NEWLINE_TOKEN_ID
            nl_logits.append(float(lg[NEWLINE_TOKEN_ID].item()))
            nl_probs.append(float(pr[NEWLINE_TOKEN_ID].item()))
            tgt_logits.append(float(lg[tid0].item()))
            if int(lg.argmax()) == NEWLINE_TOKEN_ID:
                nl_argmax += 1
    n_val = max(1, len(val_c1))
    parent_geo = {
        "n": len(val_c1),
        "NEWLINE_ARGMAX_RATE": nl_argmax / n_val,
        "NEWLINE_PROBABILITY": float(sum(nl_probs) / n_val),
        "NEWLINE_LOGIT": float(sum(nl_logits) / n_val),
        "TARGET_LOGIT": float(sum(tgt_logits) / n_val),
        "TARGET_NEWLINE_GAP": float(sum(t - n for t, n in zip(tgt_logits, nl_logits)) / n_val),
        "held_out_prompts": VAL_PROMPTS[:8],
    }

    report = {
        "ok": True,
        "kind": "WRIM1_ARCH_UH1_AC1_PHASE_C_REPORT",
        "CONVERT_ID": CONVERT_ID,
        "ARCHITECTURE_ID": ARCH_ID_UH1_AC1,
        "SOURCE_PARENT": "WRIM1-CPT-000005/step-75",
        "SOURCE_PARENT_HASH": src_hash,
        "UH1_MODEL_HASH": uh1_hash,
        "CONVERTED_MODEL_HASH": converted_hash,
        "ARCHITECTURE_MANIFEST_HASH": man["architecture_manifest_hash"],
        "PARAMETER_COUNT": n,
        "ADDED_PARAMETER_COUNT": AC1_ADDED,
        "CONTROL_VECTOR_PARITY": {
            "max_abs_logit_diff": max_abs,
            "document_abs_logit_diff": doc_abs,
            "logit_parity": parity_ok,
            "document_zero_effect": doc_abs < 1e-5,
            "document_ctrl_grad_on_no_assistant": doc_ctrl,
        },
        "FULL_MODEL_PROBES": full_probes,
        "CONTROL_VECTOR_ONLY_PROBES": ctrl_probes,
        "CONTROL_VECTOR_GRAD_RESULT": result,
        "CHOSEN_SAFE_PACK": chosen,
        "TRAIN_SCOPE": train_scope,
        "PROCEED": proceed,
        "PARENT_ROLE_GEOMETRY": parent_geo,
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_step": False,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_AC1_PHASE_C_REPORT.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    return report


if __name__ == "__main__":
    obj = main()
    print(json.dumps({k: obj.get(k) for k in (
        "ok", "CONTROL_VECTOR_GRAD_RESULT", "CHOSEN_SAFE_PACK", "TRAIN_SCOPE", "PROCEED",
        "PARAMETER_COUNT", "CONVERTED_MODEL_HASH", "CONTROL_VECTOR_PARITY", "PARENT_ROLE_GEOMETRY",
    )}, indent=2))
    print("--- FULL ---")
    print(json.dumps(obj.get("FULL_MODEL_PROBES"), indent=2))
    print("--- CTRL ONLY ---")
    print(json.dumps(obj.get("CONTROL_VECTOR_ONLY_PROBES"), indent=2))
