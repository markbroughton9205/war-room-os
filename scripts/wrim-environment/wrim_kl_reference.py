"""Immutable WRIM-0 KL reference. Never initialize from a restored candidate.

Does not train. Does not mutate Stage 3 scoring. Does not construct a training optimizer.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import torch

from stage3_eval_baseline import encode_prompt_ids, teacher_force_nll_kl

KL_ARTIFACT_NAME = "wrim0-kl-reference.pt"
KL_META_NAME = "wrim0-kl-reference.meta.json"


def _item_targets(suite_items: list[dict[str, Any]], frozen_items: list[dict[str, Any]]) -> list[tuple[str, list[int], list[int]]]:
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    out = []
    for it in suite_items:
        iid = str(it["item_id"])
        frozen = frozen_by_id[iid]
        frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
        out.append((iid, list(it["prompt_text"]), frozen_ids))
    return out


def compute_wrim0_logp(
    *,
    model,
    tokenizer,
    device: torch.device,
    suite_items: list[dict[str, Any]],
    frozen_items: list[dict[str, Any]],
) -> dict[str, torch.Tensor]:
    """Compute per-item log-softmax from the model currently holding WRIM-0 weights."""
    was = model.training
    model.eval()
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    out: dict[str, torch.Tensor] = {}
    with torch.inference_mode():
        for it in suite_items:
            iid = str(it["item_id"])
            prompt_ids = encode_prompt_ids(tokenizer, it["prompt_text"])
            frozen = frozen_by_id[iid]
            frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
            bundle = teacher_force_nll_kl(model, prompt_ids, frozen_ids, device, None)
            logp = bundle.get("log_softmax")
            if logp is None:
                raise RuntimeError(f"WRIM-0 logp missing for {iid}")
            out[iid] = logp.detach().cpu().contiguous().clone()
    if was:
        model.train()
    if len(out) != len(suite_items):
        raise RuntimeError("WRIM-0 KL reference incomplete")
    return out


def artifact_sha256(logp: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for iid in sorted(logp):
        h.update(iid.encode("utf-8"))
        t = logp[iid].detach().cpu().contiguous()
        h.update(str(tuple(int(x) for x in t.shape)).encode("utf-8"))
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def save_wrim0_logp(
    path: Path,
    logp: dict[str, torch.Tensor],
    *,
    parent_hash: str,
    tokenizer_hash: str,
    eval_hash: str,
) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    cpu = {k: v.detach().cpu().contiguous().clone() for k, v in logp.items()}
    payload = {
        "kind": "WRIM0_KL_REFERENCE",
        "PARENT_HASH": parent_hash,
        "TOKENIZER_HASH": tokenizer_hash,
        "EVAL_HASH": eval_hash,
        "item_ids": sorted(cpu),
        "logp": cpu,
    }
    torch.save(payload, path)
    meta = {
        "kind": "WRIM0_KL_REFERENCE_META",
        "PARENT_HASH": parent_hash,
        "TOKENIZER_HASH": tokenizer_hash,
        "EVAL_HASH": eval_hash,
        "n_items": len(cpu),
        "ARTIFACT_SHA256": artifact_sha256(cpu),
        "path": str(path),
    }
    meta_path = path.with_name(KL_META_NAME)
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def load_wrim0_logp(
    path: Path,
    *,
    parent_hash: str,
    tokenizer_hash: str,
    eval_hash: str,
) -> dict[str, torch.Tensor]:
    obj = torch.load(path, map_location="cpu", weights_only=False)
    if obj.get("kind") != "WRIM0_KL_REFERENCE":
        raise ValueError("kl reference kind mismatch")
    if obj.get("PARENT_HASH") != parent_hash:
        raise ValueError("kl reference PARENT_HASH mismatch")
    if obj.get("TOKENIZER_HASH") != tokenizer_hash:
        raise ValueError("kl reference TOKENIZER_HASH mismatch")
    if obj.get("EVAL_HASH") != eval_hash:
        raise ValueError("kl reference EVAL_HASH mismatch")
    logp = obj.get("logp") or {}
    if not logp:
        raise ValueError("kl reference empty")
    return {str(k): v.detach().cpu().contiguous().clone() for k, v in logp.items()}


def ensure_wrim0_logp(
    *,
    parent_model,
    tokenizer,
    device: torch.device,
    suite_items: list[dict[str, Any]],
    frozen_items: list[dict[str, Any]],
    artifact_path: Path,
    parent_hash: str,
    tokenizer_hash: str,
    eval_hash: str,
) -> tuple[dict[str, torch.Tensor], dict[str, Any]]:
    """Load frozen artifact if valid; otherwise compute from parent_model (must be WRIM-0)."""
    if artifact_path.is_file():
        logp = load_wrim0_logp(
            artifact_path,
            parent_hash=parent_hash,
            tokenizer_hash=tokenizer_hash,
            eval_hash=eval_hash,
        )
        if set(logp) >= {str(it["item_id"]) for it in suite_items}:
            return logp, {"source": "artifact", "path": str(artifact_path), "n": len(logp)}
    logp = compute_wrim0_logp(
        model=parent_model,
        tokenizer=tokenizer,
        device=device,
        suite_items=suite_items,
        frozen_items=frozen_items,
    )
    meta = save_wrim0_logp(
        artifact_path,
        logp,
        parent_hash=parent_hash,
        tokenizer_hash=tokenizer_hash,
        eval_hash=eval_hash,
    )
    return logp, {"source": "computed_from_parent", **meta}


def simulate_buggy_fill(candidate_logp: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Reproduce RUN-000011 resume bug: empty cache fills from the first evaluated model."""
    wrim0_logp: dict[str, torch.Tensor] = {}
    for iid, logq in candidate_logp.items():
        parent_logp = wrim0_logp.get(iid)
        if parent_logp is None:
            wrim0_logp[iid] = logq
    return wrim0_logp
