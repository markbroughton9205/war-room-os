"""RUN-000012 packer: frozen RUN-000010 mix plus independent per-example target-only masks.

Does not mutate jsonl/npy/tokenizer. Does not construct an optimizer.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from run000010_dataset import DATASET_DIRNAME, TRAIN_NAME, load_jsonl as load_mode_jsonl
from run000010_pack import default_mode_train_path, pack_run000010_stream
from run000012_identity import LINUX_DATA_ROOT, MAX_TOKENS, PACKER_VERSION
from wrim_target_only_loss import (
    MASK_CAP_EOS,
    MASK_CAP_TARGET,
    MASK_GENERAL_LM,
    MASK_IGNORE,
    concat_label_mask,
    mask_counts,
)


def pack_run000012_stream(
    dump_root: Path,
    tokenizer_path: Path | None = None,
    *,
    mode_entry_train_path: Path | None = None,
) -> dict[str, Any]:
    from tokenizers import Tokenizer

    packing = pack_run000010_stream(
        dump_root,
        tokenizer_path,
        mode_entry_train_path=mode_entry_train_path,
    )
    tok_path = tokenizer_path or (dump_root / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json")
    tokenizer = Tokenizer.from_file(str(tok_path))
    cap_path = Path(mode_entry_train_path or default_mode_train_path())
    records = load_jsonl_safe(cap_path)
    records_by_id = {str(r.get("example_id")): r for r in records}
    interleaved = packing.get("_interleaved") or []
    stream = packing["_stream"]
    try:
        mask = concat_label_mask(tokenizer, interleaved, records_by_id)
    except Exception as exc:
        packing["decision"] = {
            **(packing.get("decision") or {}),
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "reasons": list((packing.get("decision") or {}).get("reasons") or []) + [f"loss_mask_build_failed:{type(exc).__name__}:{exc}"],
        }
        packing["_mask"] = None
        packing["LOSS_MASK_ERROR"] = f"{type(exc).__name__}: {exc}"
        return packing
    train_mask = mask[: MAX_TOKENS + 1]
    label_mask = train_mask[1:]
    counts = mask_counts(label_mask)
    if int(mask.size) != int(stream.size):
        packing["decision"] = {
            **(packing.get("decision") or {}),
            "ok": False,
            "PACKING_PREFLIGHT": "FAIL",
            "abort_before_optimizer": True,
            "reasons": list((packing.get("decision") or {}).get("reasons") or []) + ["loss_mask_stream_length_mismatch"],
        }
    import hashlib

    from wrim_target_only_loss import unit_label_mask

    cap_meta = []
    for u in interleaved:
        if u.bucket not in {"cap_instruction", "cap_stopping"}:
            continue
        um = unit_label_mask(tokenizer, u, records_by_id)
        cap_meta.append(
            {
                "unit_id": u.unit_id,
                "bucket": u.bucket,
                "n_tokens": int(u.tokens.size),
                "n_prompt_ignored": int((um == MASK_IGNORE).sum()),
                "n_target": int((um == MASK_CAP_TARGET).sum()),
                "n_eos": int((um == MASK_CAP_EOS).sum()),
            }
        )
        if len(cap_meta) >= 12:
            break
    packing["packer"] = PACKER_VERSION
    packing["LOSS_MASK_VERSION"] = "wrim-target-only-v1"
    packing["LOSS_MASK_SHA256"] = hashlib.sha256(mask.tobytes()).hexdigest()
    packing["PROMPT_TOKENS_MASKED"] = counts["PROMPT_TOKENS_MASKED"]
    packing["TARGET_TOKENS_SUPERVISED"] = counts["TARGET_TOKENS_SUPERVISED"]
    packing["EOS_TOKENS_SUPERVISED"] = counts["EOS_TOKENS_SUPERVISED"]
    packing["GENERAL_LM_TOKENS_SUPERVISED"] = counts["GENERAL_LM_TOKENS_SUPERVISED"]
    packing["LOSS_MASK_COUNTS"] = counts
    packing["LOSS_MASK_UNIT_METADATA_SAMPLE"] = cap_meta
    packing["_mask"] = mask
    return packing


def load_jsonl_safe(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return load_mode_jsonl(path)


def default_mode_entry_root() -> Path:
    return Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / TRAIN_NAME
