"""Phase A: convert CPT-000005/step-75 to UH1, prove parity, re-probe role grads.

No optimizer.step. Does not replace canonical architecture.
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

from wrim_g20m import WRIM0Model
from wrim_g20m_uh1 import (
    ARCH_ID_UH1,
    TIED_PARAM_COUNT,
    UH1_ADDED,
    UH1_PARAM_COUNT,
    WRIMUH1Model,
    assert_untied,
    clone_init_from_tied,
)
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    DATA_ROOT,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_HARD,
    GRAD_REVIEW,
    MICRO_BATCH,
    SEED,
    SEQ_LEN,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_plm3_encode import encode_example, pack_train_stream, slice_batches
from wrim_target_only_loss import IGNORE_INDEX, MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE
from wrim_plm3_encode import MASK_CAP_FIRST


CONVERT_ID = "WRIM1-ARCH-UH1-CONVERTED"
CKPT_DIR = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only") / CONVERT_ID


def _sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha_tensor(t: torch.Tensor) -> str:
    return hashlib.sha256(t.detach().cpu().contiguous().numpy().tobytes()).hexdigest()


def _module_grads(model: torch.nn.Module) -> dict[str, float]:
    attn = 0.0
    ffn = 0.0
    tok = 0.0
    head = 0.0
    ctrl = 0.0
    total = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        total += n * n
        if name.startswith("tok_emb"):
            tok = n
        elif name.startswith("lm_head"):
            head = n
        elif name.startswith("assistant_ctrl"):
            ctrl = n
        elif ".attn" in name and ".attn_norm" not in name:
            attn += n * n
        elif ".ffn" in name and ".ffn_norm" not in name:
            ffn += n * n
    return {
        "TOTAL_GRAD": total ** 0.5,
        "TOK_EMB_INPUT_GRAD": tok,
        "LM_HEAD_OUTPUT_GRAD": head,
        "CONTROL_VECTOR_GRAD": ctrl,
        "ATTENTION_GRAD": attn ** 0.5,
        "FFN_GRAD": ffn ** 0.5,
    }


def _split_loss(logits, y, y_mask, first_w: float = 1.0):
    import torch.nn.functional as F

    labels = y.clone().masked_fill(y_mask == MASK_IGNORE, IGNORE_INDEX)
    nll = F.cross_entropy(
        logits.reshape(-1, logits.size(-1)),
        labels.reshape(-1),
        reduction="none",
        ignore_index=IGNORE_INDEX,
    ).view_as(y)
    w = torch.zeros_like(y_mask, dtype=torch.float32)
    w = w.masked_fill(y_mask == MASK_CAP_FIRST, first_w)
    w = w.masked_fill(y_mask == MASK_CAP_TARGET, 1.0)
    w = w.masked_fill(y_mask == MASK_CAP_EOS, 1.0)
    mass = w.sum().clamp_min(1.0)
    loss = (nll * w).sum() / mass

    def mean(flag):
        if int(flag.sum().item()) == 0:
            return None
        return float(nll[flag].mean().item())

    return {
        "loss": loss,
        "FIRST_TOKEN_CE": mean(y_mask == MASK_CAP_FIRST),
        "LATER_TOKEN_CE": mean(y_mask == MASK_CAP_TARGET),
        "EOS_CE": mean(y_mask == MASK_CAP_EOS),
        "n_first": int((y_mask == MASK_CAP_FIRST).sum().item()),
        "n_later": int((y_mask == MASK_CAP_TARGET).sum().item()),
        "n_eos": int((y_mask == MASK_CAP_EOS).sum().item()),
    }


def probe_pack(model, tokenizer, train_rows: list[dict], device) -> dict[str, Any]:
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
    model.train()
    logits = model(x)
    split = _split_loss(logits, y, y_mask, first_w=1.0)
    split["loss"].backward()
    grads = _module_grads(model)
    g = grads["TOTAL_GRAD"]
    gate = "UNSAFE"
    if g < GRAD_REVIEW:
        gate = "SAFE"
    elif g < GRAD_HARD:
        gate = "REVIEW"
    model.zero_grad(set_to_none=True)
    return {
        **grads,
        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
        "EOS_CE": split["EOS_CE"],
        "weighted_loss": float(split["loss"].detach().item()),
        "n_first": split["n_first"],
        "n_later": split["n_later"],
        "n_eos": split["n_eos"],
        "GRAD_GATE": gate,
        "optimizer_step": False,
    }


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def main() -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from safetensors.torch import save_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
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

    tied = WRIM0Model()
    tied.load_state_dict(load_safetensors_file(str(src)), strict=True)
    n_tied = int(sum(p.numel() for p in tied.parameters()))
    uh1 = clone_init_from_tied(tied, assistant_control=False)
    sep = assert_untied(uh1)
    n_uh1 = int(sum(p.numel() for p in uh1.parameters()))
    if n_tied != TIED_PARAM_COUNT or n_uh1 != UH1_PARAM_COUNT:
        raise RuntimeError(f"param count mismatch tied={n_tied} uh1={n_uh1}")

    tied.to(device).eval()
    uh1.to(device).eval()

    # Logit parity on several prefixes + a random batch
    from wrim_hvu_role_search import GENERIC_PROMPTS
    from wrim_plm3_encode import prefix_ids_for_inference

    max_abs = 0.0
    max_rel = 0.0
    n_checked = 0
    with torch.inference_mode():
        for p in GENERIC_PROMPTS[:16]:
            ids = prefix_ids_for_inference(tokenizer, p)
            x = torch.tensor([ids], dtype=torch.long, device=device)
            a = tied(x)
            b = uh1(x)
            d = (a - b).abs()
            max_abs = max(max_abs, float(d.max().item()))
            n_checked += 1
        rng = torch.randint(0, 15126, (4, 64), device=device)
        a = tied(rng)
        b = uh1(rng)
        d = (a - b).abs()
        max_abs = max(max_abs, float(d.max().item()))
        denom = a.abs().clamp_min(1e-8)
        max_rel = float((d / denom).max().item())
        n_checked += 1

    parity_ok = max_abs < 1e-5
    if not parity_ok:
        report = {
            "ok": False,
            "kind": "WRIM1_ARCH_UH1_CONVERSION_PARITY_FAIL",
            "max_abs_logit_diff": max_abs,
            "TRAINING_AUTHORIZATION": "OFF",
        }
        Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_CONVERSION_REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
        return report

    # Cheap NLL/greedy parity on a handful of continuation val prompts
    from wrim_plm3_encode import prefix_ids_for_inference

    val_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "val.jsonl")[:16]
    greedy_match = 0
    nll_diffs = []
    with torch.inference_mode():
        for rec in val_rows:
            pref = prefix_ids_for_inference(tokenizer, rec["prompt"])
            x = torch.tensor([pref], dtype=torch.long, device=device)
            la = tied(x)[0, -1]
            lb = uh1(x)[0, -1]
            greedy_match += int(int(la.argmax()) == int(lb.argmax()))
            nll_diffs.append(float((torch.log_softmax(la, dim=-1) - torch.log_softmax(lb, dim=-1)).abs().max().item()))
    greedy_parity = greedy_match == len(val_rows)
    nll_parity = max(nll_diffs) < 1e-5 if nll_diffs else False

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    cpu_state = {k: v.detach().cpu().contiguous() for k, v in uh1.state_dict().items()}
    save_file(cpu_state, str(CKPT_DIR / MODEL_NAME))
    converted_hash = _sha_file(CKPT_DIR / MODEL_NAME)
    tok_h = _sha_tensor(uh1.tok_emb.weight)
    head_h = _sha_tensor(uh1.lm_head.weight)
    man = {
        "architecture_id": ARCH_ID_UH1,
        "source": "WRIM1-CPT-000005/step-75",
        "source_model_hash": src_hash,
        "converted_model_hash": converted_hash,
        "tok_emb_hash": tok_h,
        "lm_head_hash": head_h,
        "parameter_count_before": n_tied,
        "parameter_count_after": n_uh1,
        "added_parameter_count": UH1_ADDED,
        "clone_init": True,
        "tied_pointer": False,
        "assistant_control": False,
        "canonical_unchanged": True,
        **sep,
    }
    man_blob = json.dumps(man, sort_keys=True, separators=(",", ":")).encode()
    man["architecture_manifest_hash"] = hashlib.sha256(man_blob).hexdigest()
    (CKPT_DIR / "architecture-manifest.json").write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")

    # Gradient re-probe
    uh1.train()
    packs = {
        "C1_easy_unigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C1_easy_unigram_eos-v1.0.0" / "train.jsonl",
        "C3_easy_bigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C3_easy_bigram_eos-v1.0.0" / "train.jsonl",
        "C6_easy_trigram": Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C6_easy_trigram_eos-v1.0.0" / "train.jsonl",
        "continuation": Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "train.jsonl",
    }
    probes = {}
    for name, p in packs.items():
        rows = load_jsonl(p)
        probes[name] = probe_pack(uh1, tokenizer, rows, device)

    safe = [k for k, v in probes.items() if v.get("GRAD_GATE") == "SAFE"]
    if safe:
        fix = "PASS"
        chosen = min(safe, key=lambda k: probes[k]["TOTAL_GRAD"])
    elif all(probes[k]["TOTAL_GRAD"] >= GRAD_HARD for k in probes):
        fix = "FAIL"
        chosen = None
    else:
        fix = "REVIEW_ONLY"
        chosen = None

    report = {
        "ok": True,
        "kind": "WRIM1_ARCH_UH1_PHASE_A_REPORT",
        "CONVERT_ID": CONVERT_ID,
        "ARCHITECTURE_ID": ARCH_ID_UH1,
        "SOURCE_PARENT": "WRIM1-CPT-000005/step-75",
        "SOURCE_PARENT_HASH": src_hash,
        "CONVERTED_MODEL_HASH": converted_hash,
        "TOK_EMB_HASH": tok_h,
        "LM_HEAD_HASH": head_h,
        "ARCHITECTURE_MANIFEST_HASH": man["architecture_manifest_hash"],
        "PARAMETER_COUNT_BEFORE": n_tied,
        "PARAMETER_COUNT_AFTER": n_uh1,
        "ADDED_PARAMETER_COUNT": UH1_ADDED,
        "SEPARATION": sep,
        "UNTIED_HEAD_PARITY": {
            "max_abs_logit_diff": max_abs,
            "max_rel_logit_diff": max_rel,
            "n_checked": n_checked,
            "greedy_parity": greedy_parity,
            "nll_parity": nll_parity,
            "logit_parity": parity_ok,
        },
        "PROBES": probes,
        "UNTIED_HEAD_GRADIENT_FIX": fix,
        "CHOSEN_SAFE_PACK": chosen,
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_step": False,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    Path(DATA_ROOT).joinpath("WRIM1_ARCH_UH1_PHASE_A_REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    obj = main()
    print(json.dumps({k: obj.get(k) for k in (
        "ok", "UNTIED_HEAD_GRADIENT_FIX", "CHOSEN_SAFE_PACK", "PARAMETER_COUNT_AFTER",
        "ADDED_PARAMETER_COUNT", "CONVERTED_MODEL_HASH", "UNTIED_HEAD_PARITY", "SEPARATION",
    )}, indent=2))
    print("--- PROBES ---")
    print(json.dumps(obj.get("PROBES"), indent=2))
