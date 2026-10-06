"""Pack WR-CORPUS-CPT-1 into a contiguous 4096-token/step stream. Does not train."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from run000006_pack import load_frozen_genesis_train_units
from run000007_pack import mix_within_tolerance, prefix_bucket_counts, shares_from_counts
from run000007_preflight import resolve_dump_root
from stage1_pack import PackedUnit, leak_hits, shuffle_unit_order, wrap_lm_tokens
from stage2_pack import split_bounded_excerpts
from wrim_cpt_corpus import CORPUS_VERSION, corpus_root, encode_role_record, load_jsonl, validate_role_tokens
from wrim_cpt_identity import (
    ASSISTANT_ID,
    COMMANDER_ID,
    LOCKED_MIX,
    MAX_TOKENS,
    MIX_TOLERANCE,
    PACK_TARGET_TOKENS,
    PACKER_VERSION,
    SEED,
    TOKENS_PER_STEP,
)


def family_budgets(n: int) -> dict[str, int]:
    raw = {k: n * v for k, v in LOCKED_MIX.items()}
    floors = {k: int(v) for k, v in raw.items()}
    rem = int(n) - int(sum(floors.values()))
    order = sorted(raw, key=lambda f: (raw[f] - floors[f], f), reverse=True)
    i = 0
    while rem > 0 and order:
        floors[order[i % len(order)]] += 1
        rem -= 1
        i += 1
    return floors


def load_c1_units(tokenizer: Tokenizer) -> dict[str, list[PackedUnit]]:
    rows = load_jsonl(corpus_root() / f"{CORPUS_VERSION}-C1-TRAIN.jsonl")
    by: dict[str, list[PackedUnit]] = defaultdict(list)
    for rec in rows:
        text = str(rec.get("text") or "")
        if not text.strip():
            continue
        if leak_hits(text):
            continue
        body = tokenizer.encode(text, add_special_tokens=False).ids
        if not body:
            continue
        ids = wrap_lm_tokens(list(int(x) for x in body))
        bucket = str(rec.get("bucket") or "technical")
        if bucket not in LOCKED_MIX:
            bucket = "technical"
        unit = PackedUnit(
            unit_id=str(rec.get("chunk_id") or rec.get("source_path")),
            bucket=bucket,
            origin="WR-CORPUS-1-HARDENED",
            tokens=ids,
            source_path=str(rec.get("source_path") or ""),
            n_eos=int((ids == 2).sum()),
            n_bos=int((ids == 1).sum()),
        )
        for part in split_bounded_excerpts(unit, max_tokens=1024):
            part.bucket = bucket
            by[bucket].append(part)
    return dict(by)


def load_role_units(tokenizer: Tokenizer, split: str) -> list[PackedUnit]:
    name = f"{CORPUS_VERSION}-ROLE-TRAIN.jsonl" if split == "train" else f"{CORPUS_VERSION}-ROLE-VAL.jsonl"
    rows = load_jsonl(corpus_root() / name)
    out = []
    for rec in rows:
        ids = np.array(encode_role_record(tokenizer, rec), dtype=np.int32)
        if int(ids[1]) != COMMANDER_ID or ASSISTANT_ID not in ids.tolist():
            raise RuntimeError("role unit missing special tokens")
        out.append(
            PackedUnit(
                unit_id=str(rec.get("example_id")),
                bucket="role",
                origin="WR-CORPUS-CPT-1-ROLE",
                tokens=ids,
                n_eos=int((ids == 2).sum()),
                n_bos=int((ids == 1).sum()),
            )
        )
    return out


def fill_budget(units: list[PackedUnit], budget: int, seed: int, tag: str) -> list[PackedUnit]:
    if budget <= 0 or not units:
        return []
    shuffled = shuffle_unit_order(units, seed + (sum(ord(c) for c in tag) % 997))
    out: list[PackedUnit] = []
    used = 0
    i = 0
    while used < budget:
        u = shuffled[i % len(shuffled)]
        n = int(u.tokens.size)
        out.append(u)
        used += n
        i += 1
        if used >= budget:
            break
        if i > len(shuffled) * 80:
            break
    return out


def concat_units(units: list[PackedUnit]) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=np.int32)
    return np.concatenate([u.tokens for u in units]).astype(np.int32)


def pack_cpt_stream(dump_root: Path | None = None) -> dict[str, Any]:
    dump = dump_root or resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tokenizer = Tokenizer.from_file(str(tok_path))
    rv = validate_role_tokens(tokenizer)
    if not rv["ok"]:
        return {"ok": False, "reason": "role_token_validation_failed", "detail": rv}

    genesis = load_frozen_genesis_train_units(dump)
    g_units = []
    for u in genesis:
        pu = PackedUnit(
            unit_id=u.unit_id,
            bucket="genesis",
            origin="WR-CORPUS-0",
            tokens=np.array(u.tokens, dtype=np.int32),
            n_eos=int(sum(1 for t in u.tokens if int(t) == 2)),
            n_bos=int(sum(1 for t in u.tokens if int(t) == 1)),
        )
        parts = split_bounded_excerpts(pu, max_tokens=1024)
        for p in parts:
            p.bucket = "genesis"
        g_units.extend(parts)

    c1 = load_c1_units(tokenizer)
    role = load_role_units(tokenizer, "train")
    role_val = load_role_units(tokenizer, "val")

    pools = {
        "natural": list(c1.get("natural") or []),
        "code": list(c1.get("code") or []),
        "technical": list(c1.get("technical") or []),
        "json": list(c1.get("json") or []),
        "role": role,
        "genesis": g_units,
    }
    # If natural pool is thin, reuse genesis excerpts as document language with bucket=natural
    if len(pools["natural"]) < 8:
        extra = []
        for u in g_units:
            extra.append(
                PackedUnit(
                    unit_id=f"{u.unit_id}#natural",
                    bucket="natural",
                    origin=u.origin,
                    tokens=u.tokens,
                    n_eos=u.n_eos,
                    n_bos=u.n_bos,
                )
            )
        pools["natural"] = list(c1.get("natural") or []) + extra

    budgets = family_budgets(PACK_TARGET_TOKENS)
    selected: list[PackedUnit] = []
    for fam, bud in budgets.items():
        selected.extend(fill_budget(pools.get(fam) or [], bud, SEED, fam))
    selected = shuffle_unit_order(selected, SEED)
    stream = concat_units(selected)
    if stream.size < PACK_TARGET_TOKENS:
        return {"ok": False, "reason": "short_stream", "n": int(stream.size), "need": PACK_TARGET_TOKENS}
    stream = stream[:PACK_TARGET_TOKENS]
    counts = prefix_bucket_counts(selected, PACK_TARGET_TOKENS)
    shares = shares_from_counts(counts)
    mix = mix_within_tolerance(shares, LOCKED_MIX, MIX_TOLERANCE)
    n_eos = int((stream == 2).sum())
    n_cmd = int((stream == COMMANDER_ID).sum())
    n_ast = int((stream == ASSISTANT_ID).sum())

    def take_ids(units: list[PackedUnit], n: int = 2048) -> list[int]:
        buf: list[int] = []
        for u in units:
            buf.extend(int(x) for x in u.tokens.tolist())
            if len(buf) >= n:
                break
        return buf[:n]

    val_packs = {
        "genesis": take_ids(g_units),
        "code": take_ids(list(c1.get("code") or [])),
        "json": take_ids(list(c1.get("json") or [])),
        "role": take_ids(role_val or role),
        "technical": take_ids(list(c1.get("technical") or [])),
        "natural": take_ids(pools["natural"]),
    }
    val_packs["general"] = (val_packs["natural"] + val_packs["technical"] + val_packs["code"])[:2048]
    return {
        "ok": True,
        "mix_strict": bool(mix["ok"]),
        "PACKER_VERSION": PACKER_VERSION,
        "n_tokens": int(stream.size),
        "n_steps": int(stream.size // TOKENS_PER_STEP),
        "shares": shares,
        "counts": {k: int(v) for k, v in counts.items()},
        "mix_check": mix,
        "EOS_DENSITY": n_eos / max(1, stream.size),
        "COMMANDER_TOKEN_DENSITY": n_cmd / max(1, stream.size),
        "ASSISTANT_TOKEN_DENSITY": n_ast / max(1, stream.size),
        "pool_sizes": {k: len(v) for k, v in pools.items()},
        "role_val_n": len(role_val),
        "_stream": stream,
        "_role_val": role_val,
        "_pools": pools,
        "_val_packs": val_packs,
    }


if __name__ == "__main__":
    import json

    p = pack_cpt_stream()
    print(json.dumps({k: v for k, v in p.items() if not str(k).startswith("_")}, indent=2, default=str))
