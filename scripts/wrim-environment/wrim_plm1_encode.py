"""Prefix-LM boundary encoding, mask, and packing for WRIM1-PLM-000001.

Does not train. Policy A: <|assistant|> is context only.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID
from wrim_plm1_identity import (
    ASSISTANT_DELIMITER_POLICY,
    MAX_TOKENS,
    MICRO_BATCH,
    SEQ_LEN,
    STEPS,
    TOKENS_PER_STEP,
)
from wrim_target_only_loss import IGNORE_INDEX, MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

RAW_TEMPLATE = "<|commander|>\n{prompt}<|assistant|>{target}"


def raw_string(prompt: str, target: str) -> str:
    return RAW_TEMPLATE.format(prompt=prompt, target=target)


def encode_example(tokenizer: Any, rec: dict[str, Any]) -> dict[str, Any]:
    prompt = str(rec["prompt"])
    target = str(rec["target"])
    raw = raw_string(prompt, target)
    body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
    tokens = [BOS_ID, *body, EOS_ID]
    if tokens[1] != COMMANDER_ID:
        raise ValueError(f"body must start with commander id 5, got {tokens[1:8]}")
    ast = [i for i, t in enumerate(tokens) if t == ASSISTANT_ID]
    if len(ast) != 1:
        raise ValueError(f"expected one assistant token, got {ast} in {raw!r}")
    ast_i = ast[0]
    tgt_ids = list(tokenizer.encode(target, add_special_tokens=False).ids)
    after = tokens[ast_i + 1 : -1]
    if after != tgt_ids:
        raise ValueError(f"target id mismatch after assistant: {after} vs {tgt_ids} raw={raw!r}")
    mask = np.full(len(tokens), MASK_IGNORE, dtype=np.int8)
    supervise_from = int(rec.get("supervise_from_target_index") or 0)
    if supervise_from < 0 or supervise_from >= len(tgt_ids):
        raise ValueError(f"supervise_from_target_index out of range: {supervise_from}")
    for j in range(ast_i + 1, len(tokens) - 1):
        if j - (ast_i + 1) >= supervise_from:
            mask[j] = MASK_CAP_TARGET
    mask[-1] = MASK_CAP_EOS
    expected_supervised = len(tgt_ids) - supervise_from
    if int(np.count_nonzero(mask == MASK_CAP_TARGET)) != expected_supervised:
        raise ValueError("target mask count mismatch")
    return {
        "example_id": rec["example_id"],
        "raw": raw,
        "tokens": np.asarray(tokens, dtype=np.int32),
        "mask": mask,
        "commander_index": 1,
        "assistant_index": ast_i,
        "first_target_index": ast_i + 1,
        "first_target_id": int(tgt_ids[0]),
        "target_ids": tgt_ids,
        "eos_index": len(tokens) - 1,
        "prompt_token_range": [2, ast_i],  # exclusive end at assistant
        "target_token_range": [ast_i + 1, len(tokens) - 1],
        "COMMANDER_TOKEN_ID": COMMANDER_ID,
        "ASSISTANT_TOKEN_ID": ASSISTANT_ID,
        "EOS_TOKEN_ID": EOS_ID,
        "BOS_TOKEN_ID": BOS_ID,
        "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY,
    }


def prefix_ids_for_inference(tokenizer: Any, prompt: str) -> list[int]:
    """Exact greedy prefix: BOS + encode(<|commander|>\\n{prompt}<|assistant|>)."""
    raw = f"<|commander|>\n{prompt}<|assistant|>"
    body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
    if not body or body[0] != COMMANDER_ID or body[-1] != ASSISTANT_ID:
        raise ValueError(f"inference prefix malformed: {body[:12]}...{body[-6:]}")
    return [BOS_ID, *body]


def pack_train_stream(encoded: list[dict[str, Any]], *, steps: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    use_steps = STEPS if steps is None else int(steps)
    need = use_steps * MICRO_BATCH * SEQ_LEN + 1
    parts_t = []
    parts_m = []
    n = 0
    i = 0
    if not encoded:
        raise ValueError("no encoded train examples")
    while n < need:
        rec = encoded[i % len(encoded)]
        parts_t.append(rec["tokens"])
        parts_m.append(rec["mask"])
        n += int(rec["tokens"].size)
        i += 1
        if i > max(len(encoded) * 64, use_steps * MICRO_BATCH * 8):
            raise ValueError("unable to fill prefix-LM stream")
    stream = np.concatenate(parts_t).astype(np.int32)
    mask = np.concatenate(parts_m).astype(np.int8)
    if stream.size != mask.size:
        raise ValueError("stream/mask mismatch")
    return stream[:need], mask[:need]


def slice_batches(stream: np.ndarray, mask: np.ndarray, *, steps: int | None = None) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    from wrim_target_only_loss import slice_contiguous_batches_with_mask

    use_steps = STEPS if steps is None else int(steps)
    batches = slice_contiguous_batches_with_mask(stream, mask, use_steps, MICRO_BATCH, SEQ_LEN)
    if len(batches) != use_steps:
        raise ValueError("batch count")
    if batches[0][0].shape != (MICRO_BATCH, SEQ_LEN):
        raise ValueError(f"unexpected batch shape {batches[0][0].shape}")
    return batches


def mask_report(mask: np.ndarray) -> dict[str, Any]:
    m = np.asarray(mask, dtype=np.int8)
    n_prompt = int(np.count_nonzero(m == MASK_IGNORE))
    n_tgt = int(np.count_nonzero(m == MASK_CAP_TARGET))
    n_eos = int(np.count_nonzero(m == MASK_CAP_EOS))
    return {
        "PROMPT_TOKENS_SUPERVISED": False,
        "TARGET_TOKENS_SUPERVISED": True,
        "EOS_SUPERVISED": True,
        "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY,
        "n_prompt_masked": n_prompt,
        "n_target_supervised": n_tgt,
        "n_eos_supervised": n_eos,
        "n_total": int(m.size),
        "PROMPT_TOKENS_MASKED_FRACTION": n_prompt / max(1, int(m.size)),
        "ok": n_tgt > 0 and n_eos > 0 and n_prompt > 0,
    }


def boundary_fixtures(tokenizer: Any, encoded: list[dict[str, Any]], n: int = 6) -> dict[str, Any]:
    rows = []
    for rec in encoded[:n]:
        ids = [int(x) for x in rec["tokens"].tolist()]
        pieces = [tokenizer.id_to_token(i) for i in ids]
        rows.append(
            {
                "example_id": rec["example_id"],
                "RAW_STRING": rec["raw"],
                "TOKEN_IDS": ids,
                "PIECES": pieces,
                "COMMANDER_TOKEN_ID": rec["COMMANDER_TOKEN_ID"],
                "PROMPT_TOKEN_RANGE": rec["prompt_token_range"],
                "ASSISTANT_TOKEN_ID": rec["ASSISTANT_TOKEN_ID"],
                "FIRST_TARGET_TOKEN_ID": rec["first_target_id"],
                "TARGET_TOKEN_RANGE": rec["target_token_range"],
                "EOS_TOKEN_ID": rec["EOS_TOKEN_ID"],
                "assistant_is_context": True,
                "newline_after_assistant": False,
            }
        )
    return {"n": len(rows), "examples": rows, "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY}


def validate_inference_match(tokenizer: Any, rec: dict[str, Any], enc: dict[str, Any]) -> bool:
    inf = prefix_ids_for_inference(tokenizer, rec["prompt"])
    train_prefix = [int(x) for x in enc["tokens"].tolist()[: enc["assistant_index"] + 1]]
    return inf == train_prefix
