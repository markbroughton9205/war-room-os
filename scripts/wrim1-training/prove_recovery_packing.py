#!/usr/bin/env python3
"""Permanent regression proofs for contiguous packing, unit shuffle, EOS, and masks."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from contiguous_pack import PackedUnit, take_units_token_capped, wrap_behavior_tokens, wrap_lm_tokens  # noqa: E402
from dataset_cursor import (  # noqa: E402
    concatenate_units,
    epoch_stream,
    initial_cursor,
    legacy_token_permutation_stream,
    next_batch,
    permute_unit_order,
)
from hashes import sha256_file  # noqa: E402
from constants import TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from paths import repo_root  # noqa: E402


class Harness:
    def __init__(self):
        self.results = []

    def check(self, name, fn):
        try:
            fn()
            self.results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            self.results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    def finish(self) -> int:
        passed = sum(1 for r in self.results if r["ok"])
        failed = sum(1 for r in self.results if not r["ok"])
        print(f"Recovery packing proofs: PASS={passed} FAIL={failed} TOTAL={len(self.results)}")
        return 0 if failed == 0 else 1


def main() -> int:
    root = repo_root()
    tok_path = root / TOKENIZER_REL
    assert sha256_file(tok_path) == TOKENIZER_SHA256
    tokenizer = Tokenizer.from_file(str(tok_path))
    bos = tokenizer.token_to_id("<|bos|>")
    eos = tokenizer.token_to_id("<|eos|>")
    assistant = tokenizer.token_to_id("<|assistant|>")
    h = Harness()

    def no_token_shuffle():
        data = np.arange(64, dtype=np.int32)
        out = epoch_stream(data, 99, 3)
        assert np.array_equal(out, data), "epoch_stream must preserve token order"
        legacy = legacy_token_permutation_stream(data, 99, 3)
        assert not np.array_equal(legacy, data), "legacy path must still permute tokens"
        assert set(legacy.tolist()) == set(data.tolist())

    h.check("epoch_stream preserves token order (legacy path still permutes)", no_token_shuffle)

    def known_string_pack():
        text = "The quick brown fox jumps over the lazy dog."
        ids = tokenizer.encode(text).ids
        wrapped, mask = wrap_lm_tokens(ids, bos, eos)
        stream = np.array(wrapped, dtype=np.int32)
        seq = min(16, stream.size - 2)
        cur = initial_cursor(stream.size, seq, 1, 7)
        x, y, nxt = next_batch(stream, cur)
        assert np.array_equal(x[0], stream[:seq])
        assert np.array_equal(y[0], stream[1:seq + 1])
        assert np.array_equal(y[0], x[0][1:].tolist() + [stream[seq]])
        decoded_ids = x[0].tolist()
        body = tokenizer.encode(text).ids
        # body must appear as a contiguous span inside the packed window/stream
        stream_list = stream.tolist()
        found = any(stream_list[i:i + len(body)] == body for i in range(0, len(stream_list) - len(body) + 1))
        assert found, "source token sequence missing from packed stream"
        assert decoded_ids == stream[:seq].tolist()

    h.check("known string tokenize-pack-retrieve preserves order", known_string_pack)

    def unit_shuffle_not_tokens():
        a = np.array([10, 11, 12, 13], dtype=np.int32)
        b = np.array([20, 21, 22], dtype=np.int32)
        c = np.array([30, 31], dtype=np.int32)
        units = [a, b, c]
        cat0 = concatenate_units(units)
        changed = False
        for epoch in range(0, 40):
            shuffled = permute_unit_order(units, seed=1, epoch=epoch)
            assert {tuple(u.tolist()) for u in shuffled} == {tuple(a.tolist()), tuple(b.tolist()), tuple(c.tolist())}
            for u in shuffled:
                if u[0] == 10:
                    assert np.array_equal(u, a)
                if u[0] == 20:
                    assert np.array_equal(u, b)
                if u[0] == 30:
                    assert np.array_equal(u, c)
            cat1 = concatenate_units(shuffled)
            if not np.array_equal(cat0, cat1):
                changed = True
                for u in shuffled:
                    assert cat1.tobytes().find(u.tobytes()) >= 0
                break
        assert changed, "unit-level permutation never reordered documents"

    h.check("shuffle changes unit order not intra-unit tokens", unit_shuffle_not_tokens)

    def eos_boundary():
        a_text = "Document alpha one."
        b_text = "Document bravo two."
        a_ids = tokenizer.encode(a_text).ids
        b_ids = tokenizer.encode(b_text).ids
        a_w, _ = wrap_lm_tokens(a_ids, bos, eos)
        b_w, _ = wrap_lm_tokens(b_ids, bos, eos)
        stream = np.array(a_w + b_w, dtype=np.int32)
        # EOS sits at end of A; next token is BOS of B
        eos_pos = list(stream).index(eos)
        assert stream[eos_pos] == eos
        assert stream[eos_pos + 1] == bos
        seq = stream.size - 2
        cur = initial_cursor(stream.size, seq, 1, 0)
        x, y, _ = next_batch(stream, cur)
        # target at EOS position predicts BOS of next document
        assert y[0][eos_pos] == bos
        assert x[0][eos_pos] == eos

    h.check("EOS inserted at document boundary with correct target shift", eos_boundary)

    def mask_behavior():
        rendered = "<|bos|>\n<|system|>\nYou are WRIM.\n<|commander|>\nSay hi.\n<|assistant|>\nhello\n<|eos|>"
        ids = tokenizer.encode(rendered).ids
        assert assistant in ids
        ids2, mask = wrap_behavior_tokens(ids, assistant)
        apos = ids2.index(assistant)
        for i, m in enumerate(mask):
            if i > apos:
                assert m == 1, f"response index {i} should be unmasked"
            else:
                assert m == 0, f"prompt index {i} should be masked"
        lm_ids, lm_mask = wrap_lm_tokens(tokenizer.encode("plain language document").ids, bos, eos)
        assert all(m == 1 for m in lm_mask)
        assert lm_ids[0] == bos and lm_ids[-1] == eos

    h.check("behavior response-only mask and raw LM full causal mask", mask_behavior)

    def masked_batch_alignment():
        ids = list(range(40))
        mask = [0] * 10 + [1] * 30
        stream = np.array(ids, dtype=np.int32)
        m = np.array(mask, dtype=np.float32)
        cur = initial_cursor(stream.size, 8, 2, 0)
        x, y, ym, nxt = next_batch(stream, cur, loss_mask=m)
        assert x.shape == (2, 8)
        assert np.array_equal(ym[0], m[1:9])
        assert np.array_equal(y[0], stream[1:9])

    h.check("masked batch target alignment", masked_batch_alignment)

    def rehearsal_token_cap():
        big = PackedUnit(
            unit_id="doc-a", bucket="wr_corpus_0", origin="t",
            tokens=np.arange(100, dtype=np.int32),
            loss_mask=np.ones(100, dtype=np.uint8),
        )
        small = PackedUnit(
            unit_id="doc-b", bucket="wr_corpus_0", origin="t",
            tokens=np.arange(200, 220, dtype=np.int32),
            loss_mask=np.ones(20, dtype=np.uint8),
        )
        taken = take_units_token_capped([big, small], 30, eos, deterministic=True)
        total = int(sum(u.tokens.size for u in taken))
        assert total <= 30, total
        assert total >= 4
        first = taken[0]
        assert np.array_equal(first.tokens[:-1], big.tokens[: first.tokens.size - 1])
        assert int(first.tokens[-1]) == eos
        assert first.truncated

    h.check("rehearsal cap truncates contiguous prefix and stays at/under token budget", rehearsal_token_cap)

    def window_split_preserves_order():
        from interleave_curriculum import (
            interleave_units_by_deficit,
            prove_interleave_unit_order_only,
            prove_window_split_preserves_tokens,
            split_unit_contiguous_windows,
        )
        big = PackedUnit(
            unit_id="novel",
            bucket="wr_corpus_0",
            origin="t",
            tokens=np.arange(5000, dtype=np.int32),
            loss_mask=np.ones(5000, dtype=np.uint8),
        )
        pr = prove_window_split_preserves_tokens(big, 2048, eos_id=eos)
        assert pr["equal_to_source"]
        assert pr["intra_window_matches_source_slices"]
        assert pr["n_windows"] == 3
        wins = split_unit_contiguous_windows(big, 2048, eos_id=eos)
        assert np.array_equal(wins[0].tokens, big.tokens[:2048])
        assert np.array_equal(wins[1].tokens, big.tokens[2048:4096])
        assert np.array_equal(wins[2].tokens, big.tokens[4096:])

        a = PackedUnit("a", "wr_corpus_0", "t", np.arange(10, dtype=np.int32), np.ones(10, dtype=np.uint8))
        a2 = PackedUnit("a2", "wr_corpus_0", "t", np.arange(10, 20, dtype=np.int32), np.ones(10, dtype=np.uint8))
        b = PackedUnit("b", "prose", "t", np.arange(100, 108, dtype=np.int32), np.ones(8, dtype=np.uint8))
        c = PackedUnit("c", "code", "t", np.arange(200, 206, dtype=np.int32), np.ones(6, dtype=np.uint8))
        units = [a, a2, b, c]
        interleaved = interleave_units_by_deficit(units)
        proof = prove_interleave_unit_order_only(units, interleaved)
        assert proof["passed"]
        assert proof["unit_order_changed"], [u.unit_id for u in interleaved]
        assert interleaved[0].unit_id == "a"
        assert interleaved[1].bucket != "wr_corpus_0"
        for u in interleaved:
            src = next(x for x in units if x.unit_id == u.unit_id)
            assert np.array_equal(u.tokens, src.tokens)

    h.check("contiguous window split + deficit interleave change unit order only", window_split_preserves_order)

    return h.finish()


if __name__ == "__main__":
    raise SystemExit(main())
