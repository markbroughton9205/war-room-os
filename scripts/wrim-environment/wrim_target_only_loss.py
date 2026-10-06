"""Target-only response CE for WRIM mode-entry capability units.

Does not change rehearsal/general LM objective. Does not construct an optimizer.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from stage1_pack import BOS_ID, EOS_ID, SEQ_LEN

IGNORE_INDEX = -100
MASK_IGNORE = 0
MASK_CAP_TARGET = 1
MASK_CAP_EOS = 2
MASK_GENERAL_LM = 3

CAP_BUCKETS = frozenset({"cap_instruction", "cap_stopping"})


def base_unit_id(unit_id: str) -> str:
    s = str(unit_id)
    if ":prefix" in s:
        s = s.split(":prefix")[0]
    if "#w" in s:
        s = s.split("#w")[0]
    if "#c" in s:
        s = s.split("#c")[0]
    return s


def find_target_span_in_body(tokenizer: Any, body: list[int], target: str, text: str | None = None) -> tuple[int, int]:
    tgt = str(target)
    tgt_ids = list(tokenizer.encode(tgt, add_special_tokens=False).ids)
    if tgt_ids:
        last = None
        n = len(tgt_ids)
        for i in range(0, len(body) - n + 1):
            if body[i : i + n] == tgt_ids:
                last = i
        if last is not None:
            return last, last + n
    if text:
        enc = tokenizer.encode(str(text), add_special_tokens=False)
        enc_ids = list(enc.ids)
        if enc_ids == body:
            idx = str(text).rfind(tgt)
            if idx >= 0:
                end_c = idx + len(tgt)
                start_tok = None
                end_tok = None
                for i, (a, b) in enumerate(list(enc.offsets)):
                    if b <= idx:
                        continue
                    if a >= end_c:
                        break
                    if start_tok is None:
                        start_tok = i
                    end_tok = i + 1
                if start_tok is not None and end_tok is not None and end_tok > start_tok:
                    return start_tok, end_tok
    for start in range(len(body)):
        try:
            decoded = tokenizer.decode(body[start:])
        except Exception:
            continue
        if decoded == tgt or decoded.strip() == tgt.strip() or decoded.lstrip() == tgt:
            return start, len(body)
        if tgt and decoded.endswith(tgt) and (len(decoded) == len(tgt) or decoded[-(len(tgt) + 1)] in "\n \t"):
            # walk until the suffix token start matches target
            for inner in range(start, len(body)):
                try:
                    d2 = tokenizer.decode(body[inner:])
                except Exception:
                    continue
                if d2 == tgt or d2.strip() == tgt.strip():
                    return inner, len(body)
    raise ValueError(f"target span not found in encoded body for {tgt!r}")


def capability_label_mask(tokenizer: Any, rec: dict[str, Any], tokens: np.ndarray) -> np.ndarray:
    """Per-stream-position label class for one wrapped capability unit.

    0 = ignore (BOS, prompt, separator)
    1 = supervise target response tokens
    2 = supervise unit EOS
    """
    ids = [int(x) for x in np.asarray(tokens, dtype=np.int32).tolist()]
    mask = np.full(len(ids), MASK_IGNORE, dtype=np.int8)
    if len(ids) < 3 or ids[0] != BOS_ID or ids[-1] != EOS_ID:
        raise ValueError(f"capability unit must be wrap_lm_tokens [BOS]+body+[EOS], got {ids[:8]}...{ids[-4:]}")
    body = ids[1:-1]
    target = str(rec.get("target") or "")
    text = str(rec.get("text") or "")
    start, end = find_target_span_in_body(tokenizer, body, target, text=text)
    mask[1 + start : 1 + end] = MASK_CAP_TARGET
    mask[-1] = MASK_CAP_EOS
    if int(np.count_nonzero(mask == MASK_CAP_TARGET)) != (end - start):
        raise ValueError("target mask count mismatch")
    return mask


def capability_label_mask_for_possibly_prefixed(tokenizer: Any, rec: dict[str, Any], tokens: np.ndarray) -> np.ndarray:
    from stage1_pack import wrap_lm_tokens

    text = str(rec.get("text") or "")
    body = list(tokenizer.encode(text, add_special_tokens=False).ids)
    full = wrap_lm_tokens(body)
    full_mask = capability_label_mask(tokenizer, rec, full)
    ids = np.asarray(tokens, dtype=np.int32)
    if int(ids.size) == int(full.size) and np.array_equal(ids, full):
        return full_mask
    n = int(ids.size)
    if n < 3:
        raise ValueError("capability unit too short for target-only mask")
    if np.array_equal(ids[:-1], np.asarray(full[: n - 1], dtype=np.int32)) and int(ids[-1]) == EOS_ID:
        m = np.array(full_mask[:n], dtype=np.int8)
        m[-1] = MASK_CAP_EOS
        return m
    raise ValueError("capability tokens are not a wrap_lm_tokens unit or contiguous prefix")


def unit_label_mask(tokenizer: Any, unit: Any, records_by_id: dict[str, dict[str, Any]]) -> np.ndarray:
    n = int(unit.tokens.size)
    if unit.bucket in CAP_BUCKETS:
        rec = records_by_id.get(base_unit_id(unit.unit_id))
        if rec is None:
            raise ValueError(f"missing mode-entry record for unit {unit.unit_id}")
        toks = np.asarray(unit.tokens, dtype=np.int32)
        return capability_label_mask_for_possibly_prefixed(tokenizer, rec, toks)
    return np.full(n, MASK_GENERAL_LM, dtype=np.int8)


def concat_label_mask(tokenizer: Any, units: list[Any], records_by_id: dict[str, dict[str, Any]]) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=np.int8)
    parts = [unit_label_mask(tokenizer, u, records_by_id) for u in units]
    for u, m in zip(units, parts):
        if int(m.size) != int(u.tokens.size):
            raise ValueError(f"mask length {m.size} != tokens {u.tokens.size} for {u.unit_id}")
    return np.concatenate(parts)


def mask_counts(mask: np.ndarray) -> dict[str, int]:
    m = np.asarray(mask, dtype=np.int8)
    return {
        "PROMPT_TOKENS_MASKED": int(np.count_nonzero(m == MASK_IGNORE)),
        "TARGET_TOKENS_SUPERVISED": int(np.count_nonzero(m == MASK_CAP_TARGET)),
        "EOS_TOKENS_SUPERVISED": int(np.count_nonzero(m == MASK_CAP_EOS)),
        "GENERAL_LM_TOKENS_SUPERVISED": int(np.count_nonzero(m == MASK_GENERAL_LM)),
        "n": int(m.size),
    }


def labels_from_y(y: np.ndarray, y_mask: np.ndarray) -> np.ndarray:
    labels = np.asarray(y, dtype=np.int64).copy()
    labels[np.asarray(y_mask, dtype=np.int8) == MASK_IGNORE] = IGNORE_INDEX
    return labels


def slice_contiguous_batches_with_mask(
    stream: np.ndarray,
    mask: np.ndarray,
    steps: int,
    batch_size: int,
    seq_len: int = SEQ_LEN,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    if int(stream.size) != int(mask.size):
        raise ValueError(f"stream/mask length mismatch {stream.size} vs {mask.size}")
    batches = []
    offset = 0
    for _ in range(steps):
        xs = []
        ys = []
        ms = []
        for _b in range(batch_size):
            xs.append(stream[offset : offset + seq_len])
            ys.append(stream[offset + 1 : offset + seq_len + 1])
            ms.append(mask[offset + 1 : offset + seq_len + 1])
            offset += seq_len
        batches.append(
            (
                np.stack(xs).astype(np.int64),
                np.stack(ys).astype(np.int64),
                np.stack(ms).astype(np.int8),
            )
        )
    return batches


def masked_ce(logits, labels, ignore_index: int = IGNORE_INDEX):
    import torch

    return torch.nn.functional.cross_entropy(
        logits.reshape(-1, logits.size(-1)),
        labels.reshape(-1),
        ignore_index=ignore_index,
    )


def split_losses(logits, y, y_mask):
    import torch

    labels = y.clone()
    labels = labels.masked_fill(y_mask == MASK_IGNORE, IGNORE_INDEX)
    loss = masked_ce(logits, labels)
    tgt_labels = y.clone()
    tgt_labels = tgt_labels.masked_fill((y_mask != MASK_CAP_TARGET) & (y_mask != MASK_CAP_EOS), IGNORE_INDEX)
    gen_labels = y.clone()
    gen_labels = gen_labels.masked_fill(y_mask != MASK_GENERAL_LM, IGNORE_INDEX)
    n_tgt = int(((y_mask == MASK_CAP_TARGET) | (y_mask == MASK_CAP_EOS)).sum().item())
    n_gen = int((y_mask == MASK_GENERAL_LM).sum().item())
    n_ign = int((y_mask == MASK_IGNORE).sum().item())
    target_loss = masked_ce(logits, tgt_labels) if n_tgt > 0 else None
    general_loss = masked_ce(logits, gen_labels) if n_gen > 0 else None
    return {
        "loss": loss,
        "TARGET_TOKEN_LOSS": target_loss,
        "GENERAL_LM_LOSS": general_loss,
        "n_target_supervised": n_tgt,
        "n_general_supervised": n_gen,
        "n_ignored": n_ign,
    }
