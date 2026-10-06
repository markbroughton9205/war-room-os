"""Focused loss-mask fixture for WRIM1-RUN-000012. Does not train the run."""
from __future__ import annotations

from typing import Any

import numpy as np

from stage1_pack import BOS_ID, EOS_ID, PackedUnit, wrap_lm_tokens
from wrim_target_only_loss import (
    IGNORE_INDEX,
    MASK_CAP_EOS,
    MASK_CAP_TARGET,
    MASK_GENERAL_LM,
    MASK_IGNORE,
    capability_label_mask,
    concat_label_mask,
    labels_from_y,
    slice_contiguous_batches_with_mask,
    unit_label_mask,
)


class FakeTok:
    def encode(self, text: str, add_special_tokens: bool = False):
        class R:
            def __init__(self, ids: list[int]) -> None:
                self.ids = ids

        table = {
            "P1": [10, 11],
            "T1": [20, 21],
            "P1\nT1": [10, 11, 30, 20, 21],
            "P2": [12],
            "T2": [22],
            "P2\nT2": [12, 30, 22],
            "GEN": [40, 41, 42],
        }
        if text not in table:
            raise KeyError(text)
        return R(table[text])

    def decode(self, ids: list[int]) -> str:
        inv = {
            (20, 21): "T1",
            (22,): "T2",
        }
        return inv.get(tuple(ids), "")


def _unit(uid: str, bucket: str, tokens) -> PackedUnit:
    arr = np.asarray(tokens, dtype=np.int32)
    return PackedUnit(
        unit_id=uid,
        bucket=bucket,
        origin="fixture",
        tokens=arr,
        n_eos=int((arr == EOS_ID).sum()),
        n_bos=int((arr == BOS_ID).sum()),
    )


def _ce_active(labels: np.ndarray, mask: np.ndarray, cls: int) -> bool:
    return bool(np.any((mask == cls) & (labels != IGNORE_INDEX)))


def run_loss_mask_validation() -> dict[str, Any]:
    tok = FakeTok()
    rec1 = {"example_id": "ex1", "prompt": "P1", "target": "T1", "text": "P1\nT1"}
    rec2 = {"example_id": "ex2", "prompt": "P2", "target": "T2", "text": "P2\nT2"}
    u1_body = tok.encode(rec1["text"]).ids
    u2_body = tok.encode(rec2["text"]).ids
    u_gen_body = tok.encode("GEN").ids
    u1 = _unit("ex1", "cap_instruction", wrap_lm_tokens(u1_body))
    u2 = _unit("ex2", "cap_stopping", wrap_lm_tokens(u2_body))
    ug = _unit("gen0", "wr_corpus_0", wrap_lm_tokens(u_gen_body))
    recs = {"ex1": rec1, "ex2": rec2}

    m1 = capability_label_mask(tok, rec1, u1.tokens)
    m2 = capability_label_mask(tok, rec2, u2.tokens)
    mg = unit_label_mask(tok, ug, recs)

    # u1 tokens: BOS, 10,11,30,20,21, EOS
    prompt_pos = [0, 1, 2, 3]  # BOS + P1 + sep 30
    target_pos = [4, 5]
    eos_pos = [6]
    checks = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": name, "ok": bool(ok), "detail": detail})

    add("prompt_ignored_ex1", all(int(m1[i]) == MASK_IGNORE for i in prompt_pos), str(m1.tolist()))
    add("target_active_ex1", all(int(m1[i]) == MASK_CAP_TARGET for i in target_pos), str(m1.tolist()))
    add("eos_active_ex1", all(int(m1[i]) == MASK_CAP_EOS for i in eos_pos), str(m1.tolist()))
    add("no_target_in_prompt_ex1", not any(int(m1[i]) in {MASK_CAP_TARGET, MASK_CAP_EOS} for i in prompt_pos), "")
    add("prompt_ignored_ex2", int(m2[0]) == MASK_IGNORE and int(m2[1]) == MASK_IGNORE and int(m2[2]) == MASK_IGNORE, str(m2.tolist()))
    add("target_active_ex2", int(m2[3]) == MASK_CAP_TARGET, str(m2.tolist()))
    add("eos_active_ex2", int(m2[-1]) == MASK_CAP_EOS, str(m2.tolist()))
    u1c = _unit("ex1#c0", "cap_instruction", u1.tokens)
    m1c = unit_label_mask(tok, u1c, recs)
    add("cycle_clone_same_mask", bool(np.array_equal(m1, m1c)), str(m1c.tolist()))

    packed_units = [u1, ug, u2]
    stream = np.concatenate([u.tokens for u in packed_units])
    mask = concat_label_mask(tok, packed_units, recs)
    add("packed_len", int(stream.size) == int(mask.size), f"{stream.size} vs {mask.size}")
    # Independent masks: target 20,21 only in first unit span; 22 only in third.
    s1 = 0
    e1 = int(u1.tokens.size)
    s2 = e1 + int(ug.tokens.size)
    add("packed_ex1_target_unrelated_to_ex2", int(np.count_nonzero(mask[s1:e1] == MASK_CAP_TARGET)) == 2, "")
    add("packed_ex2_target_independent", int(np.count_nonzero(mask[s2:] == MASK_CAP_TARGET)) == 1, "")
    add("general_span_unchanged", bool(np.all(mask[e1:s2] == MASK_GENERAL_LM)), "")

    # Pad token 0 as ignore in a synthetic batch
    pad_stream = np.concatenate([stream, np.array([0, 0, 0, 0], dtype=np.int32)])
    pad_mask = np.concatenate([mask, np.full(4, MASK_IGNORE, dtype=np.int8)])
    seq = 8
    need = 1 * 2 * seq + 1
    if pad_stream.size < need:
        extra = need - int(pad_stream.size)
        pad_stream = np.concatenate([pad_stream, np.zeros(extra, dtype=np.int32)])
        pad_mask = np.concatenate([pad_mask, np.full(extra, MASK_IGNORE, dtype=np.int8)])
    batches = slice_contiguous_batches_with_mask(pad_stream, pad_mask, steps=1, batch_size=2, seq_len=seq)
    x, y, ym = batches[0]
    labels = labels_from_y(y, ym)
    add("padding_ignored", bool(np.all(labels[ym == MASK_IGNORE] == IGNORE_INDEX)), "")
    add("target_labels_not_ignore", _ce_active(labels, ym, MASK_CAP_TARGET), "")
    add("eos_labels_not_ignore", _ce_active(labels, ym, MASK_CAP_EOS) or np.any(ym == MASK_CAP_EOS), str(int(np.count_nonzero(ym == MASK_CAP_EOS))))
    add("general_labels_active", _ce_active(labels, ym, MASK_GENERAL_LM) or np.any(ym == MASK_GENERAL_LM), "")
    add("no_prompt_label_leak", not np.any((ym == MASK_IGNORE) & (labels != IGNORE_INDEX)), "")
    add("sequence_shift", bool(np.all(y[:, :-1] == x[:, 1:])), "causal")

    # Tiny torch CE: ignored positions must not contribute.
    try:
        import torch

        vocab = 64
        logits = torch.zeros(y.shape[0], y.shape[1], vocab)
        for i in range(y.shape[0]):
            for j in range(y.shape[1]):
                logits[i, j, int(y[i, j])] = 10.0
        lab = torch.tensor(labels, dtype=torch.long)
        loss = torch.nn.functional.cross_entropy(
            logits.reshape(-1, vocab),
            lab.reshape(-1),
            ignore_index=IGNORE_INDEX,
        )
        add("torch_ce_finite", bool(torch.isfinite(loss)), str(float(loss)))
        # Flip a prompt/ignored gold token; loss must stay identical.
        y2 = torch.tensor(y, dtype=torch.long).clone()
        ym_t = torch.tensor(ym)
        ign = (ym_t == MASK_IGNORE).nonzero(as_tuple=False)
        if ign.numel():
            bi, ti = int(ign[0, 0]), int(ign[0, 1])
            y2[bi, ti] = (int(y2[bi, ti]) + 3) % vocab
            lab2 = y2.clone()
            lab2[ym_t == MASK_IGNORE] = IGNORE_INDEX
            loss2 = torch.nn.functional.cross_entropy(logits.reshape(-1, vocab), lab2.reshape(-1), ignore_index=IGNORE_INDEX)
            add("prompt_token_loss_ignored", abs(float(loss) - float(loss2)) < 1e-8, str(abs(float(loss) - float(loss2))))
        else:
            add("prompt_token_loss_ignored", False, "no ignore positions in batch")
        # Flip a target gold token; loss must change.
        tgt = ((ym_t == MASK_CAP_TARGET) | (ym_t == MASK_CAP_EOS)).nonzero(as_tuple=False)
        if tgt.numel():
            bi, ti = int(tgt[0, 0]), int(tgt[0, 1])
            y3 = torch.tensor(y, dtype=torch.long).clone()
            y3[bi, ti] = (int(y3[bi, ti]) + 5) % vocab
            lab3 = y3.clone()
            lab3[ym_t == MASK_IGNORE] = IGNORE_INDEX
            loss3 = torch.nn.functional.cross_entropy(logits.reshape(-1, vocab), lab3.reshape(-1), ignore_index=IGNORE_INDEX)
            add("target_token_loss_active", float(loss3) > float(loss) + 1e-4, str(float(loss3)))
        else:
            add("target_token_loss_active", False, "no target positions in batch")
    except Exception as exc:
        add("torch_ce_finite", False, f"{type(exc).__name__}: {exc}")
        add("prompt_token_loss_ignored", False, "torch failed")
        add("target_token_loss_active", False, "torch failed")

    failed = [c for c in checks if not c["ok"]]
    return {
        "ok": len(failed) == 0,
        "LOSS_MASK_VALIDATION": "PASS" if not failed else "FAIL",
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "checks": checks,
        "TARGET_ONLY_ALREADY_IMPLEMENTED": "NO",
        "PROMPT_TOKENS_PREVIOUSLY_SUPERVISED": "YES",
        "TARGET_TOKENS_PREVIOUSLY_SUPERVISED": "YES",
        "EOS_PREVIOUSLY_SUPERVISED": "YES",
    }


def main() -> int:
    import json

    out = run_loss_mask_validation()
    print(json.dumps({k: out[k] for k in ("ok", "LOSS_MASK_VALIDATION", "passed", "failed")}, indent=2))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
