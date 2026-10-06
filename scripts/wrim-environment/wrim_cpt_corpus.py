"""WR-CORPUS-CPT-1-v1.0.0 builder + inventory. Does not train. Does not mutate older corpora."""
from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000007_preflight import resolve_dump_root
from run000008_dataset import HARD_BANNED
from run000008_identity import ADDENDUM_NEEDLES, BANNED_STAGE3_KEYS
from stage1_pack import EVAL_INFRA_MARKERS, HELD_OUT_PROMPT_STRINGS, bucket_for_record, is_eval_infra_text, is_tool_use, text_of
from wrim_cpt_identity import (
    ASSISTANT_ID,
    BOS_ID,
    COMMANDER_ID,
    CORPUS_ID,
    CORPUS_VERSION,
    EOS_ID,
    FOUNDATION_EVAL_ID,
    FOUNDATION_EVAL_VERSION,
    LINUX_DATA_ROOT,
    NEWLINE_ID,
    SEED,
    SYSTEM_ID,
)

HERE = Path(__file__).resolve().parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_json(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def corpus_root() -> Path:
    return Path(LINUX_DATA_ROOT) / CORPUS_VERSION


def eval_root() -> Path:
    return Path(LINUX_DATA_ROOT) / FOUNDATION_EVAL_VERSION


def extra_banned() -> set[str]:
    """Protected markers and full SFT prompts. Do not ingest short generic SFT targets (even/odd/JSON)."""
    banned = {s for s in (set(HARD_BANNED) | set(ADDENDUM_NEEDLES) | set(BANNED_STAGE3_KEYS)) if isinstance(s, str) and len(s) >= 6}
    for name in (
        "WR-CORPUS-MODE-ENTRY-1-v1.0.0/WR-CORPUS-MODE-ENTRY-1-v1.0.0-TRAIN.jsonl",
        "WR-CORPUS-MODE-ENTRY-1-v1.0.0/WR-CORPUS-MODE-ENTRY-1-v1.0.0-VALIDATION.jsonl",
        "WR-CORPUS-CAPABILITY-1-v1.0.0/WR-CORPUS-CAPABILITY-1-v1.0.0-TRAIN.jsonl",
        "WR-CORPUS-CAPABILITY-1-v1.0.0/WR-CORPUS-CAPABILITY-1-v1.0.0-VALIDATION.jsonl",
    ):
        p = Path(LINUX_DATA_ROOT) / name
        for rec in load_jsonl(p):
            pmt = str(rec.get("prompt") or "").strip()
            if len(pmt) >= 24:
                banned.add(pmt)
    return banned


def leak_blob(text: str) -> list[str]:
    hits = []
    for s in HELD_OUT_PROMPT_STRINGS:
        if s and s in text:
            hits.append("heldout:" + s[:40])
    for s in EVAL_INFRA_MARKERS:
        if s and s in text:
            hits.append("evalinfra:" + s[:40])
    for s in ADDENDUM_NEEDLES:
        if s and s in text:
            hits.append("addendum:" + s)
    for s in BANNED_STAGE3_KEYS:
        if s and s in text:
            hits.append("s3key:" + s)
    return hits


def classify_c1(rec: dict[str, Any]) -> str:
    b = bucket_for_record(rec)
    path = str(rec.get("source_path") or rec.get("path") or "").replace("\\", "/")
    tags = " ".join(str(t) for t in (rec.get("capability_tags") or []))
    if b == "code":
        return "code"
    if b == "json":
        return "json"
    if b == "behavior":
        return "dialogue"
    if path.startswith("docs/") or "architecture" in path.lower() or "policy" in tags:
        return "technical"
    if path.endswith((".md", ".txt")) or b == "prose":
        if any(k in path.lower() for k in ("readme", "constitution", "philosophy", "narrative")):
            return "natural"
        return "technical"
    return "natural"


def inventory_c0(dump: Path) -> dict[str, Any]:
    man_p = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json"
    npy = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    c0j = dump / "sovereign-model-lab" / "corpora" / "WRM-001" / "175af25fe1c17cf7630b506d0d6e6e88" / "corpus.jsonl"
    man = json.loads(man_p.read_text(encoding="utf-8")) if man_p.is_file() else {}
    import numpy as np

    arr = np.load(str(npy), mmap_mode="r") if npy.is_file() else None
    n = int(arr.size) if arr is not None else 0
    eos = float((arr == 2).sum()) / n if arr is not None and n else None
    role = {
        "bos": float((arr == 1).sum()) / n if arr is not None and n else None,
        "eos": eos,
        "system": float((arr == 4).sum()) / n if arr is not None and n else None,
        "commander": float((arr == 5).sum()) / n if arr is not None and n else None,
        "assistant": float((arr == 6).sum()) / n if arr is not None and n else None,
    }
    return {
        "CORPUS_ID": "WR-CORPUS-0",
        "VERSION": str(man.get("corpusJsonlSha256") or "WRM-001"),
        "RECORD_COUNT": int(man.get("trainDocumentCount") or 0) + int(man.get("valDocumentCount") or 0),
        "TOKEN_COUNT": n,
        "SOURCE_TYPES": ["genesis_literary_code_documents"],
        "LICENSE_STATUS": "INTERNAL_SOVEREIGN_MODEL_LAB_WRM-001; historically used to train WRIM-0; not a third-party web crawl",
        "QUALITY_STATUS": "FROZEN; 6 documents; exact-dup-removed=0",
        "FORMAT_CLASSES": ["DOCUMENT_CONTINUATION"],
        "LANGUAGE_DISTRIBUTION": {"en": 5, "unknown": 1},
        "CODE_SHARE": "UNKNOWN_TOKEN_FRACTION",
        "JSON_SHARE": 0.0,
        "DIALOGUE_SHARE": 0.0,
        "INSTRUCTION_SHARE": 0.0,
        "DOCUMENT_SHARE": 1.0,
        "EOS_DENSITY": eos,
        "ROLE_TOKEN_DENSITY": role,
        "FROZEN": True,
        "jsonl_exists": c0j.is_file(),
        "SUITABLE_FOR_CPT": "YES_AS_GENESIS_REHEARSAL_ONLY",
    }


def inventory_c1(dump: Path) -> dict[str, Any]:
    train_p = dump / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    man_p = dump / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "corpus-manifest.json"
    man = json.loads(man_p.read_text(encoding="utf-8")) if man_p.is_file() else {}
    rows = load_jsonl(train_p)
    kept = []
    skipped = Counter()
    classes = Counter()
    tokens = Counter()
    formats = Counter()
    leak = 0
    for rec in rows:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_tool_use(rec) or is_eval_infra_text(text, path):
            skipped["eval_or_tool"] += 1
            continue
        if leak_blob(text):
            leak += 1
            skipped["leak"] += 1
            continue
        kept.append(rec)
        cls = classify_c1(rec)
        classes[cls] += 1
        tokens[cls] += int(rec.get("token_count") or 0)
        formats[str(rec.get("format") or "")] += 1
    tot_tok = sum(tokens.values()) or 1
    return {
        "CORPUS_ID": "WR-CORPUS-1-HARDENED",
        "VERSION": man.get("corpusIdentityHash"),
        "RECORD_COUNT": len(rows),
        "TOKEN_COUNT": (man.get("tokenCounts") or {}).get("train"),
        "KEPT_FOR_CPT": len(kept),
        "SKIPPED": dict(skipped),
        "SOURCE_TYPES": ["first_party_war_room_os_worktree_chunks"],
        "LICENSE_STATUS": "FIRST_PARTY_INTERNAL_WORKTREE; historical Commander grant for WRIM training; not redistributed",
        "QUALITY_STATUS": "FROZEN_HARDENED_SHARD",
        "FORMAT_CLASSES": dict(formats),
        "LANGUAGE_DISTRIBUTION": {"en": "dominant_unknown_exact"},
        "CODE_SHARE": tokens["code"] / tot_tok,
        "JSON_SHARE": tokens["json"] / tot_tok,
        "DIALOGUE_SHARE": tokens["dialogue"] / tot_tok,
        "INSTRUCTION_SHARE": 0.0,
        "DOCUMENT_SHARE": (tokens["natural"] + tokens["technical"]) / tot_tok,
        "CLASS_RECORD_COUNTS": dict(classes),
        "CLASS_TOKEN_COUNTS": dict(tokens),
        "EOS_DENSITY": "PER_DOCUMENT_WHEN_PACKED_BOS_EOS",
        "ROLE_TOKEN_DENSITY": 0.0,
        "LEAK_HITS_TRAIN": leak,
        "FROZEN": True,
        "SUITABLE_FOR_CPT": "YES_AFTER_EVAL_INFRA_FILTER",
        "_kept": kept,
    }


def inventory_small(name: str, train: Path, val: Path, *, suitable: str) -> dict[str, Any]:
    tr, va = load_jsonl(train), load_jsonl(val)
    cats = Counter(str(r.get("category")) for r in tr)
    return {
        "CORPUS_ID": name,
        "VERSION": train.parent.name,
        "RECORD_COUNT": len(tr) + len(va),
        "TOKEN_COUNT": "NOT_PRETOKENIZED",
        "SOURCE_TYPES": ["synthetic_wrim_sft"],
        "LICENSE_STATUS": "ORIGINAL_SYNTHETIC_INTERNAL",
        "QUALITY_STATUS": "FROZEN",
        "FORMAT_CLASSES": dict(cats),
        "LANGUAGE_DISTRIBUTION": {"en": 1.0},
        "CODE_SHARE": cats.get("code", 0) / max(1, len(tr)),
        "JSON_SHARE": cats.get("json", 0) / max(1, len(tr)),
        "DIALOGUE_SHARE": 0.0,
        "INSTRUCTION_SHARE": cats.get("instruction", 0) / max(1, len(tr)),
        "DOCUMENT_SHARE": 0.0,
        "EOS_DENSITY": "WHEN_PACKED",
        "ROLE_TOKEN_DENSITY": 0.0,
        "FROZEN": True,
        "SUITABLE_FOR_CPT": suitable,
        "train": len(tr),
        "val": len(va),
    }


# --- original role-delimited short responses (not Stage 3 / addendum / mode-entry) ---

COLORS = ("amber", "indigo", "olive", "teal", "maroon", "ivory", "coral", "slate")
ANIMALS = ("otter", "heron", "badger", "lynx", "wren", "mink", "finch", "pike")
CITIES = ("Lisbon", "Oslo", "Kyoto", "Accra", "Berne", "Quito", "Riga", "Dakar")
VERBS = ("fold", "sort", "clamp", "rinse", "stack", "label", "weigh", "seal")
NOUNS = ("crate", "spool", "latch", "plank", "rivet", "hinge", "gasket", "bolt")
ADJ = ("dry", "cold", "flat", "odd", "keen", "pale", "brisk", "stout")


def _det(i: int, salt: str) -> int:
    h = hashlib.sha256(f"{SEED}:{salt}:{i}".encode()).digest()
    return int.from_bytes(h[:4], "little")


def make_role_pairs(n_train: int, n_val: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    banned = extra_banned()
    rows_train: list[dict[str, Any]] = []
    rows_val: list[dict[str, Any]] = []

    def ok(text: str) -> bool:
        if text in banned:
            return False
        if any(b in text for b in banned if len(b) >= 8):
            return False
        return not leak_blob(text)

    def add(split: str, subtype: str, prompt: str, target: str) -> None:
        dest = rows_train if split == "train" else rows_val
        if not ok(prompt) or not ok(target):
            return
        rec = {
            "dataset_id": CORPUS_ID,
            "dataset_version": CORPUS_VERSION,
            "split": split,
            "category": "role",
            "subtype": subtype,
            "prompt": prompt,
            "target": target,
            "format": "role_delimited",
        }
        rec["example_id"] = f"cpt1_{split}_{subtype}_{sha256_text(prompt + '\\n' + target)[:16]}"
        dest.append(rec)

    # train generators cycle until counts met
    i = 0
    while len(rows_train) < n_train:
        i += 1
        k = _det(i, "tr")
        kind = i % 10
        a, b, c = COLORS[k % 8], ANIMALS[(k // 8) % 8], CITIES[(k // 64) % 8]
        n1, n2 = (k % 97) + 3, (k % 9) + 1
        word = f"{ADJ[k % 8]}-{NOUNS[(k // 3) % 8]}-{i:05d}"
        if kind == 0:
            add("train", "exact", f"Reply with only this tag: {word}", word)
        elif kind == 1:
            add("train", "extract", f"From note: bin {word} shelf {n2}. Return only the tag.", word)
        elif kind == 2:
            add("train", "one_word", f"Item {i}: name one animal from {{ {a}, {b} }} using the second entry only.", b)
        elif kind == 3:
            add("train", "fact", f"Item {i}: what color name is listed first: {a} then {b}?", a)
        elif kind == 4:
            add("train", "classify", f"Item {i}: is {n1} even or odd? Answer even or odd.", "even" if n1 % 2 == 0 else "odd")
        elif kind == 5:
            add("train", "transform", f"Lowercase only: {word.upper()}", word.lower())
        elif kind == 6:
            add("train", "code", f"Item {i}: return only this Python call: print({n1})", f"print({n1})")
        elif kind == 7:
            add("train", "json", f"Item {i}: return JSON object with key n set to {n1}.", f'{{"n":{n1}}}')
        elif kind == 8:
            add("train", "stopping", f"Say {word} once and halt.", word)
        else:
            add("train", "answer_only", f"Item {i}: city label {c}. Return the city name only.", c)
        if i > n_train * 8:
            break

    j = 0
    while len(rows_val) < n_val:
        j += 1
        k = _det(j, "va")
        kind = j % 10
        a, b, c = COLORS[(k + 3) % 8], ANIMALS[(k + 5) % 8], CITIES[(k + 1) % 8]
        n1 = (k % 89) + 11
        word = f"{VERBS[k % 8]}-{NOUNS[(k // 5) % 8]}-{j:05d}"
        if kind == 0:
            add("val", "exact", f"Emit only: {word}", word)
        elif kind == 1:
            add("val", "extract", f"Keep the tag in: zone {word} gate {c}.", word)
        elif kind == 2:
            add("val", "one_word", f"Item {j}: answer with the animal {b} and nothing else.", b)
        elif kind == 3:
            add("val", "fact", f"Item {j}: which color comes last here: {a}, {b}? Return {b}.", b)
        elif kind == 4:
            add("val", "classify", f"Item {j}: parity of {n1}? even or odd.", "even" if n1 % 2 == 0 else "odd")
        elif kind == 5:
            add("val", "transform", f"Uppercase only: {word}", word.upper())
        elif kind == 6:
            add("val", "code", f"Item {j}: return only: len('{b}')", f"len('{b}')")
        elif kind == 7:
            add("val", "json", f"Item {j}: return JSON {{\"n\":{n1}}} exactly.", f'{{"n":{n1}}}')
        elif kind == 8:
            add("val", "stopping", f"Output {word} once then stop.", word)
        else:
            add("val", "answer_only", f"Item {j}: city only: {c}", c)
        if j > n_val * 8:
            break
    return rows_train, rows_val


def encode_role_record(tokenizer, rec: dict[str, Any]) -> list[int]:
    prompt_ids = list(tokenizer.encode(rec["prompt"], add_special_tokens=False).ids)
    target_ids = list(tokenizer.encode(rec["target"], add_special_tokens=False).ids)
    return [BOS_ID, COMMANDER_ID, NEWLINE_ID, *prompt_ids, ASSISTANT_ID, NEWLINE_ID, *target_ids, EOS_ID]


def validate_role_tokens(tokenizer) -> dict[str, Any]:
    c = tokenizer.token_to_id("<|commander|>")
    a = tokenizer.token_to_id("<|assistant|>")
    s = tokenizer.token_to_id("<|system|>")
    enc_c = list(tokenizer.encode("<|commander|>", add_special_tokens=False).ids)
    enc_a = list(tokenizer.encode("<|assistant|>", add_special_tokens=False).ids)
    nl = list(tokenizer.encode("\n", add_special_tokens=False).ids)
    return {
        "COMMANDER_ID_LOOKUP": c,
        "ASSISTANT_ID_LOOKUP": a,
        "SYSTEM_ID_LOOKUP": s,
        "ENCODE_COMMANDER": enc_c,
        "ENCODE_ASSISTANT": enc_a,
        "COMMANDER_IS_SINGLE_SPECIAL": enc_c == [COMMANDER_ID],
        "ASSISTANT_IS_SINGLE_SPECIAL": enc_a == [ASSISTANT_ID],
        "NEWLINE_PIECES": nl,
        "NEWLINE_ID_USED": NEWLINE_ID,
        "ok": c == COMMANDER_ID and a == ASSISTANT_ID and enc_c == [COMMANDER_ID] and enc_a == [ASSISTANT_ID],
    }


def build_foundation_eval(tokenizer, role_val: list[dict[str, Any]]) -> dict[str, Any]:
    items = []

    def add(item_id: str, family: str, prompt_mode: str, prompt: str, target: str | None = None) -> None:
        items.append(
            {
                "item_id": item_id,
                "family": family,
                "prompt_mode": prompt_mode,
                "prompt": prompt,
                "target": target,
            }
        )

    add("fe-doc-01", "document_continuation", "raw", "The harbour lamps were lit before dusk, and the")
    add("fe-doc-02", "document_continuation", "raw", "In quiet valleys the river turns around worn")
    add("fe-code-01", "code_continuation", "raw", "def clamp(x, lo, hi):\n    return")
    add("fe-code-02", "code_continuation", "raw", "export function ping(n: number): number {\n  return")
    add("fe-json-01", "json_continuation", "raw", '{"ready":true,"count":')
    add("fe-json-02", "json_continuation", "raw", '{"items":[{"id":1},{"id":')
    add("fe-role-01", "role_token_continuation", "commander_only", "Name a halt word.")
    add("fe-role-02", "role_token_continuation", "commander_only", "Return a short status.")
    add("fe-bound-01", "assistant_boundary", "role", "Reply with only this tag: maple-hinge-44", "maple-hinge-44")
    add("fe-bound-02", "assistant_boundary", "role", "Is the integer 42 even or odd? one word.", "even")
    add("fe-eos-01", "eos_prediction", "role", "Print the word cedar once, then end.", "cedar")
    add("fe-eos-02", "eos_prediction", "role", "Give the word pewter and then halt.", "pewter")
    add("fe-short-01", "short_response", "role", "Return only the country code for Norway as two letters.", "NO")
    add("fe-short-02", "short_response", "role", "Which fruit is listed second: quince, fig?", "fig")
    add("fe-ans-01", "simple_answer_mode", "role", "How many letters are in the English word ox?", "2")
    add("fe-ans-02", "simple_answer_mode", "role", "Return JSON object with key ready set to false.", '{"ready":false}')
    # held-out val role items
    for i, rec in enumerate(role_val[:24]):
        items.append(
            {
                "item_id": f"fe-roleval-{i:02d}",
                "family": "short_response",
                "prompt_mode": "role",
                "prompt": rec["prompt"],
                "target": rec["target"],
                "subtype": rec.get("subtype"),
            }
        )
    leak = []
    for it in items:
        blob = (it.get("prompt") or "") + "\n" + str(it.get("target") or "")
        leak.extend(leak_blob(blob))
    payload = {
        "eval_id": FOUNDATION_EVAL_ID,
        "version": FOUNDATION_EVAL_VERSION,
        "created_at": utc_now(),
        "n": len(items),
        "items": items,
        "leakage_hits": leak,
        "role_token_validation": validate_role_tokens(tokenizer),
    }
    return payload


def freeze_corpus() -> dict[str, Any]:
    from tokenizers import Tokenizer

    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tokenizer = Tokenizer.from_file(str(tok_path))
    role_val_tok = validate_role_tokens(tokenizer)
    if not role_val_tok["ok"]:
        return {"ok": False, "reason": "role_tokens_not_special", "detail": role_val_tok}

    c0 = inventory_c0(dump)
    c1 = inventory_c1(dump)
    kept = c1.pop("_kept", [])
    me = inventory_small(
        "WR-CORPUS-MODE-ENTRY-1",
        Path(LINUX_DATA_ROOT) / "WR-CORPUS-MODE-ENTRY-1-v1.0.0/WR-CORPUS-MODE-ENTRY-1-v1.0.0-TRAIN.jsonl",
        Path(LINUX_DATA_ROOT) / "WR-CORPUS-MODE-ENTRY-1-v1.0.0/WR-CORPUS-MODE-ENTRY-1-v1.0.0-VALIDATION.jsonl",
        suitable="NO_DO_NOT_TRAIN_FROZEN_SFT_SET",
    )
    cap = inventory_small(
        "WR-CORPUS-CAPABILITY-1",
        Path(LINUX_DATA_ROOT) / "WR-CORPUS-CAPABILITY-1-v1.0.0/WR-CORPUS-CAPABILITY-1-v1.0.0-TRAIN.jsonl",
        Path(LINUX_DATA_ROOT) / "WR-CORPUS-CAPABILITY-1-v1.0.0/WR-CORPUS-CAPABILITY-1-v1.0.0-VALIDATION.jsonl",
        suitable="NO_DO_NOT_TRAIN_FROZEN_SFT_SET",
    )

    role_tr, role_va = make_role_pairs(12000, 240)
    # exact/near dup within role
    seen = set()
    exact_dup = 0
    unique_tr = []
    for r in role_tr:
        k = r["prompt"] + "\n" + r["target"]
        if k in seen:
            exact_dup += 1
            continue
        seen.add(k)
        unique_tr.append(r)
    role_tr = unique_tr

    c1_out = []
    for rec in kept:
        cls = classify_c1(rec)
        c1_out.append(
            {
                "origin": "WR-CORPUS-1-HARDENED",
                "bucket": cls if cls != "dialogue" else "technical",
                "source_path": rec.get("source_path"),
                "chunk_id": rec.get("chunk_id"),
                "token_count": rec.get("token_count"),
                "text": text_of(rec),
                "format": rec.get("format"),
            }
        )

    root = corpus_root()
    root.mkdir(parents=True, exist_ok=True)
    write_jsonl(root / f"{CORPUS_VERSION}-C1-TRAIN.jsonl", c1_out)
    write_jsonl(root / f"{CORPUS_VERSION}-ROLE-TRAIN.jsonl", role_tr)
    write_jsonl(root / f"{CORPUS_VERSION}-ROLE-VAL.jsonl", role_va)

    fe = build_foundation_eval(tokenizer, role_va)
    er = eval_root()
    write_json(er / f"{FOUNDATION_EVAL_VERSION}.json", fe)

    # hashes
    files = {
        "c1": sha256_file(root / f"{CORPUS_VERSION}-C1-TRAIN.jsonl"),
        "role_train": sha256_file(root / f"{CORPUS_VERSION}-ROLE-TRAIN.jsonl"),
        "role_val": sha256_file(root / f"{CORPUS_VERSION}-ROLE-VAL.jsonl"),
        "foundation_eval": sha256_file(er / f"{FOUNDATION_EVAL_VERSION}.json"),
    }
    corpus_hash = sha256_text(json.dumps(files, sort_keys=True))
    manifest = {
        "corpus_id": CORPUS_ID,
        "version": CORPUS_VERSION,
        "created_at": utc_now(),
        "immutable": True,
        "parent_corpora_mutated": False,
        "files": files,
        "CORPUS_HASH": corpus_hash,
        "role_train_n": len(role_tr),
        "role_val_n": len(role_va),
        "c1_kept_n": len(c1_out),
        "exact_duplicates_dropped_from_role": exact_dup,
        "role_token_validation": role_val_tok,
        "inventory": {"WR-CORPUS-0": c0, "WR-CORPUS-1-HARDENED": c1, "MODE-ENTRY": me, "CAPABILITY": cap},
    }
    write_json(root / f"{CORPUS_VERSION}-MANIFEST.json", manifest)
    write_json(root / f"{CORPUS_VERSION}-SHA256.json", {"CORPUS_HASH": corpus_hash, "files": files})
    return {"ok": True, "manifest": manifest, "root": str(root), "eval_root": str(er)}


if __name__ == "__main__":
    out = freeze_corpus()
    print(json.dumps({k: v for k, v in out.items() if k != "manifest"}, indent=2, default=str))
    if out.get("ok"):
        m = out["manifest"]
        print("CORPUS_HASH", m["CORPUS_HASH"])
        print("role", m["role_train_n"], m["role_val_n"], "c1", m["c1_kept_n"])
        print("role_tokens_ok", m["role_token_validation"]["ok"])
