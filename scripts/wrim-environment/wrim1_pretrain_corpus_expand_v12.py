"""Additive WRIM-1-PRETRAIN-CORPUS-v1.2.0. Does not mutate v1.1.0 or the pilot freeze."""
from __future__ import annotations

import json
import random
import re
import sysconfig
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from wrim1_pretrain_corpus_build import (
    SECRET_RE,
    assign_tokens,
    contamination_hit,
    dedup,
    domain_tokens,
    first_party_instruction_from_passages,
    first_party_math,
    iter_jsonl,
    load_locked_fingerprints,
    load_tokenizer,
    n_tokens,
    quality_fail,
    sha256_file,
    sha256_text,
    split_by_source,
    utc_now,
    write_json,
    write_jsonl,
)
from wrim1_pretrain_corpus_identity import (
    CHECKPOINT_25M,
    CHECKPOINT_40M,
    CORPUS_ID,
    DATA_ROOT,
    PILOT_CORPUS_HASH,
    PILOT_TOKENIZER_HASH,
    PILOT_TOKENIZER_PATH,
    PRIMARY_LANGUAGE,
    PROGRAM_ID,
    REPORT_PATH,
    SEED,
    UNIQUE_TARGET,
)
from wrim_pilot_ab_identity import CANONICAL, CANONICAL_HASH

VERSION = "WRIM-1-PRETRAIN-CORPUS-v1.2.0"
PREV = DATA_ROOT / "WRIM-1-PRETRAIN-CORPUS-v1.1.0"
OUT_DIR = DATA_ROOT / VERSION
ALLOWED_LICENSE = re.compile(
    r"\b(MIT|BSD|Apache-2\.0|Apache 2\.0|PSF-2\.0|0BSD|Zlib|CC0)\b",
    re.I,
)
BLOCKED_LICENSE = re.compile(r"NVIDIA|Proprietary|MPL|GPL|LGPL|AGPL|UNKNOWN|None", re.I)


def load_split(name: str) -> list[dict[str, Any]]:
    return list(iter_jsonl(PREV / name))


def rescue_mega_sources(train, val, hold, rng: random.Random) -> tuple[list, list, list, int]:
    mega = []
    keep_val, keep_hold = [], []
    moved = 0
    for rec in val:
        if str(rec.get("source_id") or "").startswith(("psf:", "usgov:")):
            mega.append(rec)
            moved += 1
        else:
            keep_val.append(rec)
    for rec in hold:
        if str(rec.get("source_id") or "").startswith(("psf:", "usgov:")):
            mega.append(rec)
            moved += 1
        else:
            keep_hold.append(rec)
    rng.shuffle(mega)
    n_h = max(1, int(len(mega) * 0.04)) if mega else 0
    n_v = max(1, int(len(mega) * 0.06)) if mega else 0
    for rec in mega[:n_h]:
        rec = dict(rec)
        rec["source_id"] = str(rec["source_id"]) + "-holdout"
        keep_hold.append(rec)
    keep_val.extend(mega[n_h : n_h + n_v])
    train.extend(mega[n_h + n_v :])
    return train, keep_val, keep_hold, moved


def license_ok(text: str) -> bool:
    if not text:
        return False
    if BLOCKED_LICENSE.search(text) and not ALLOWED_LICENSE.search(text):
        return False
    return bool(ALLOWED_LICENSE.search(text))


def ingest_licensed_site_packages(tok, fps) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    root = Path("/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/lib/python3.13/site-packages")
    docs: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    skip_pkg = {
        "nvidia", "cuda_bindings", "cuda_pathfinder", "cuda_toolkit", "torch", "triton",
        "hf_xet", "certifi", "pip", "setuptools",
    }
    for meta in sorted(root.glob("*.dist-info")):
        pkg = meta.name.split("-")[0].replace("_", "-")
        key = meta.name.split("-")[0].lower()
        if any(key.startswith(s.replace("-", "_")) or key.startswith(s) for s in skip_pkg):
            continue
        md = meta / "METADATA"
        lic = ""
        if md.is_file():
            for line in md.read_text(encoding="utf-8", errors="replace").splitlines():
                low = line.lower()
                if low.startswith("license:") or low.startswith("license-expression:"):
                    lic = line.split(":", 1)[1].strip()
                    break
        if not license_ok(lic):
            sources.append({"source_id": f"pypi:{key}", "license": lic or "UNDECLARED", "status": "REJECT", "reason": "rights_unverified_or_blocked"})
            continue
        pkg_dir = root / key
        if not pkg_dir.is_dir():
            pkg_dir = root / key.replace("-", "_")
        if not pkg_dir.is_dir():
            continue
        kept = 0
        post = 0
        for path in sorted(pkg_dir.rglob("*.py")):
            if any(p in {"tests", "test", "__pycache__", "vendor", "third_party"} for p in path.parts):
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if size < 120 or size > 160_000:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if quality_fail(text, domain="CODE") or SECRET_RE.search(text):
                continue
            if contamination_hit(text, fps):
                continue
            rel = str(path.relative_to(pkg_dir))
            nt = n_tokens(tok, text)
            docs.append({
                "doc_id": f"pypi:{key}:{rel}",
                "source_id": f"pypi:{key}",
                "source_name": f"{key} {rel}",
                "source_url": f"https://pypi.org/project/{pkg}/",
                "license": lic,
                "license_evidence": str(md),
                "retrieval_date": utc_now()[:10],
                "domain": "CODE",
                "text": text,
                "origin": "venv-licensed-python",
                "n_tokens": nt,
            })
            kept += 1
            post += nt
            if kept >= 900:
                break
        sources.append({
            "source_id": f"pypi:{key}",
            "source_name": key,
            "source_url": f"https://pypi.org/project/{pkg}/",
            "license": lic,
            "license_evidence": str(md),
            "status": "ACCEPT" if kept else "REJECT",
            "document_count": kept,
            "post_clean_tokens": post,
            "domain": "CODE",
        })
        print(f"PYPI {key} {lic} n={kept} tokens={post}", flush=True)
    return docs, sources


def longer_conversation(rng: random.Random) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    places = [
        "north shed", "side path", "upper loft", "stone bench", "narrow stair",
        "tool crib", "east window", "loading dock", "record desk", "water pump",
    ]
    hold_places = ["iron gate", "south chimney"]
    names = ["Reed", "Lila", "Omar", "Nia", "Seth", "Priya", "Cole", "Wren"]

    def one(i: int, place: str, sid: str, prefix: str) -> dict[str, Any]:
        a, b = names[i % 8], names[(i + 3) % 8]
        n = 4 + i % 21
        why = [
            "the count did not match the card",
            "the last person left no note",
            "the lamp failed before the check",
            "the door was locked from the inside",
            "the list had two different times",
        ][i % 5]
        text = (
            f"{a} met {b} at the {place} after the others had gone.\n"
            f"{a}: I need a plain answer. Did the {n} remaining checks actually happen?\n"
            f"{b}: Two happened. The rest stopped because {why}.\n"
            f"{a}: Then say what is still true, not what we hoped.\n"
            f"{b}: What is still true is the unfinished work, and that we can finish it in order.\n"
            f"{a}: If someone asks later, I will repeat that, not a cleaner story.\n"
            f"{b}: Good. Cleaner stories are how the next shift inherits a lie.\n"
            f"They waited a moment, then {a} wrote the unfinished items on the card and {b} read them back."
        )
        return {
            "doc_id": f"{prefix}:{i:05d}",
            "source_id": sid,
            "source_name": "War Room first-party natural exchanges v2",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Original authored dialogues v2; eval probes excluded",
            "retrieval_date": utc_now()[:10],
            "domain": "CONVERSATION_NATURAL",
            "text": text,
            "origin": "first-party-conversation-v2",
        }

    train = [one(i, places[i % len(places)], "first-party:conversation-v2", "fp-conv2") for i in range(20000)]
    hold = [one(i, hold_places[i % 2], "first-party:conversation-v2-holdout", "fp-conv2-hold") for i in range(800)]
    return train, hold


def longer_math(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    for n in range(16000):
        a = rng.randint(8, 400)
        b = rng.randint(3, 80)
        c = rng.randint(2, 20)
        kind = n % 6
        if kind == 0:
            prompt = (
                f"A crate holds {b} boxes and each box holds {c} parts. "
                f"If {a} parts are already used, how many parts remain? Show the arithmetic in order."
            )
            remain = max(b * c - a, 0)
            target = f"boxes_times_parts = {b}*{c} = {b*c}. remain = {b*c}-{a} = {remain}."
        elif kind == 1:
            prompt = f"Put these in increasing order and name the middle value: {a}, {b}, {a-b if a>b else b-a}."
            seq = sorted([a, b, abs(a - b)])
            target = f"order={seq}. middle={seq[1]}."
        elif kind == 2:
            prompt = f"If today is hour {a % 12} and a task takes {c} hours, what hour is it afterward on a 12-hour clock?"
            target = str(((a % 12) + c) % 12)
        elif kind == 3:
            prompt = f"A set contains multiples of {c} below {a}. How many are there, and what is the largest?"
            xs = list(range(c, a, c))
            target = f"count={len(xs)}; largest={xs[-1] if xs else 'none'}"
        elif kind == 4:
            prompt = f"Compare {a}/{max(b,1)} and {c}. Which is larger, or are they equal? Use integer division."
            left = a // max(b, 1)
            target = "left" if left > c else ("right" if left < c else "equal")
        else:
            prompt = (
                f"There are {a} people. They form groups of {c}. "
                f"How many full groups, and how many people are left over?"
            )
            target = f"groups={a//c}; leftover={a%c}"
        text = f"Commander: {prompt}\nAssistant: {target}"
        docs.append({
            "doc_id": f"fp-math2:{n:05d}",
            "source_id": "first-party:math-reasoning-v2",
            "source_name": "War Room first-party math primitives v2",
            "source_url": "",
            "license": "FIRST_PARTY",
            "license_evidence": "Authored reasoning items; probe pairs excluded",
            "retrieval_date": utc_now()[:10],
            "domain": "MATH_REASONING",
            "text": text,
            "origin": "first-party-math-v2",
            "target_in_prompt": False,
        })
    return docs


def instruction_from_excerpts(train_rows: list[dict[str, Any]], rng: random.Random, fps) -> list[dict[str, Any]]:
    excerpts = []
    for rec in train_rows:
        if rec.get("domain") not in {"PROSE_GENERAL", "SCIENCE_STEM", "TECHNICAL"}:
            continue
        t = rec.get("text") or ""
        if len(t) < 400:
            continue
        start = rng.randint(0, max(0, len(t) - 360))
        piece = " ".join(t[start : start + 320].split())
        if 180 <= len(piece) <= 360:
            excerpts.append(piece)
        if len(excerpts) >= 28000:
            break
    rng.shuffle(excerpts)
    return first_party_instruction_from_passages(excerpts, rng, fps)


def main() -> int:
    print("EXPAND_V12_START", utc_now(), flush=True)
    assert PILOT_TOKENIZER_PATH.is_file()
    assert sha256_file(PILOT_TOKENIZER_PATH) == PILOT_TOKENIZER_HASH
    assert (PREV / "train.jsonl").is_file()
    tok = load_tokenizer()
    fps = load_locked_fingerprints()
    rng = random.Random(SEED + 12)
    train = load_split("train.jsonl")
    val = load_split("val.jsonl")
    hold = load_split("source-holdout.jsonl")
    print("loaded", len(train), len(val), len(hold), flush=True)
    train, val, hold, moved = rescue_mega_sources(train, val, hold, rng)
    print("rescued_mega", moved, flush=True)

    code_docs, code_sources = ingest_licensed_site_packages(tok, fps)
    conv, conv_hold = longer_conversation(rng)
    math_docs = longer_math(rng)
    inst = instruction_from_excerpts(train, rng, fps)
    for rec in inst:
        rec["doc_id"] = rec["doc_id"].replace("first-party-inst-pd:", "fp-inst2:")
        rec["source_id"] = "first-party:instruction-from-pd-v2"
    print("new_fp", len(conv), len(math_docs), len(inst), "code", len(code_docs), flush=True)

    new_rows = code_docs + conv + conv_hold + math_docs + inst
    assign_tokens(tok, new_rows)
    print("new_tokens", sum(r["n_tokens"] for r in new_rows), flush=True)

    existing = train + val + hold + new_rows
    cleaned, dedup_stats = dedup(existing)
    print("post_dedup", len(cleaned), dedup_stats, flush=True)
    still = []
    cont = 0
    for rec in cleaned:
        if contamination_hit(rec["text"], fps):
            cont += 1
            continue
        still.append(rec)
    # Preserve prior Gutenberg/IETF holdout membership where possible
    old_hold_ids = {r["doc_id"] for r in hold}
    old_val_ids = {r["doc_id"] for r in val}
    train2, val2, hold2 = [], [], []
    rest = []
    for rec in still:
        did = rec["doc_id"]
        sid = str(rec.get("source_id") or "")
        if sid.endswith("-holdout") or did in old_hold_ids:
            hold2.append(rec)
        elif did in old_val_ids:
            val2.append(rec)
        elif sid.startswith("pypi:") or sid.startswith("first-party:"):
            rest.append(rec)
        else:
            train2.append(rec)
    add_train, add_val, add_hold = split_by_source(rest, rng)
    train2.extend(add_train)
    val2.extend(add_val)
    hold2.extend(add_hold)
    train_tok = sum(int(r.get("n_tokens") or 0) for r in train2)
    val_tok = sum(int(r.get("n_tokens") or 0) for r in val2)
    hold_tok = sum(int(r.get("n_tokens") or 0) for r in hold2)
    print("split", len(train2), train_tok, len(val2), val_tok, len(hold2), hold_tok, flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train2)
    write_jsonl(OUT_DIR / "val.jsonl", val2)
    write_jsonl(OUT_DIR / "source-holdout.jsonl", hold2)
    write_json(OUT_DIR / "SOURCE_LEDGER.json", code_sources)
    by_dom: dict[str, list] = defaultdict(list)
    for rec in train2:
        by_dom[rec["domain"]].append(rec)
    subset = []
    for items in by_dom.values():
        rng.shuffle(items)
        subset.extend(items[: min(400, len(items))])
    write_jsonl(OUT_DIR / "tokenizer-training-subset.jsonl", subset)

    domains = domain_tokens(train2)
    total = max(sum(domains.values()), 1)
    mix = {k: round(v / total, 4) for k, v in sorted(domains.items())}
    licenses = Counter(r.get("license") for r in train2)
    target_copy = [r for r in train2 if r.get("domain") == "INSTRUCTION_RICH"]
    copy_rate = sum(1 for r in target_copy if r.get("target_in_prompt")) / max(len(target_copy), 1)
    overlap = sorted({r["doc_id"] for r in train2} & {r["doc_id"] for r in val2})
    unique_train = train_tok
    checkpoints = {
        "CORPUS_25M_READY": unique_train >= CHECKPOINT_25M,
        "CORPUS_40M_READY": unique_train >= CHECKPOINT_40M,
        "CORPUS_50M_READY": unique_train >= UNIQUE_TARGET and not overlap and copy_rate < 0.35,
    }
    write_json(OUT_DIR / "CHECKPOINT_25M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_25M_READY"], "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_40M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_40M_READY"], "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_50M.json", {"unique_train": unique_train, "ready": checkpoints["CORPUS_50M_READY"], "at": utc_now()})
    manifest = {
        "CORPUS_ID": CORPUS_ID,
        "VERSION": VERSION,
        "CREATED_AT": utc_now(),
        "PROGRAM_ID": PROGRAM_ID,
        "immutable": True,
        "language": PRIMARY_LANGUAGE,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.1.0",
        "TOTAL_DOCUMENTS": len(still),
        "UNIQUE_TOKENS_METHOD": "WRIM1-PILOT-TOKENIZER-v1 encode add_special_tokens=False",
        "UNIQUE_TOKENS": unique_train + val_tok + hold_tok,
        "TRAIN_TOKENS": unique_train,
        "VAL_TOKENS": val_tok,
        "SOURCE_HOLDOUT_TOKENS": hold_tok,
        "DOMAIN_COUNTS": dict(Counter(r["domain"] for r in train2)),
        "DOMAIN_TOKENS": domains,
        "SOURCE_COUNTS": len({r["source_id"] for r in train2}),
        "LICENSE_COUNTS": dict(licenses),
        "DEDUP_STATS": dedup_stats,
        "CONTAMINATION_STATS": {"removed": cont, "locked_grams": len(fps["grams"])},
        "PILOT_CORPUS_HASH_UNCHANGED": PILOT_CORPUS_HASH,
        "PILOT_TOKENIZER_HASH_UNCHANGED": PILOT_TOKENIZER_HASH,
        "CANONICAL": CANONICAL,
        "CANONICAL_HASH": CANONICAL_HASH,
        "files": {
            "train": "train.jsonl",
            "val": "val.jsonl",
            "holdout": "source-holdout.jsonl",
            "tokenizer_subset": "tokenizer-training-subset.jsonl",
            "source_ledger": "SOURCE_LEDGER.json",
        },
    }
    man_path = OUT_DIR / f"{VERSION}-MANIFEST.json"
    write_json(man_path, manifest)
    manifest["HASHES"] = {
        "manifest_prehash": sha256_file(man_path),
        "train": sha256_file(OUT_DIR / "train.jsonl"),
        "val": sha256_file(OUT_DIR / "val.jsonl"),
        "holdout": sha256_file(OUT_DIR / "source-holdout.jsonl"),
        "tokenizer_subset": sha256_file(OUT_DIR / "tokenizer-training-subset.jsonl"),
    }
    write_json(man_path, manifest)
    manifest["CORPUS_HASH"] = sha256_file(man_path)
    write_json(man_path, manifest)

    report = json.loads((DATA_ROOT / "WRIM1_CORPUS_50M_EXPANSION_REPORT.json").read_text(encoding="utf-8"))
    report.update({
        "kind": "WRIM1_CORPUS_50M_EXPANSION_REPORT",
        "CORPUS_VERSION": VERSION,
        "PARENT_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.1.0",
        "PARENT_TRAIN_UNIQUE_TOKENS": 36203732,
        "V11_CHECKPOINT_UNIQUE_TRAIN": 36203732,
        "RAW_DOCUMENTS": len(existing),
        "CLEAN_DOCUMENTS": len(still),
        "RAW_TOKENS": sum(int(r.get("n_tokens") or 0) for r in existing),
        "POST_CLEAN_UNIQUE_TOKENS": unique_train + val_tok + hold_tok,
        "TRAIN_UNIQUE_TOKENS": unique_train,
        "VAL_UNIQUE_TOKENS": val_tok,
        "SOURCE_HOLDOUT_UNIQUE_TOKENS": hold_tok,
        "GENERAL_PROSE_TOKENS": domains.get("PROSE_GENERAL", 0),
        "NATURAL_CONVERSATION_TOKENS": domains.get("CONVERSATION_NATURAL", 0),
        "INSTRUCTION_RICH_TOKENS": domains.get("INSTRUCTION_RICH", 0),
        "TECHNICAL_TOKENS": domains.get("TECHNICAL", 0),
        "STEM_TOKENS": domains.get("SCIENCE_STEM", 0),
        "MATH_REASONING_TOKENS": domains.get("MATH_REASONING", 0),
        "CODE_TOKENS": domains.get("CODE", 0),
        "JSON_STRUCTURED_TOKENS": domains.get("JSON_STRUCTURED", 0),
        "PROCEDURAL_REFERENCE_TOKENS": domains.get("PROCEDURAL", 0) + domains.get("REFERENCE_FACTUAL", 0),
        "EXACT_DUPLICATES_REMOVED": dedup_stats.get("exact", 0),
        "NORMALIZED_DUPLICATES_REMOVED": dedup_stats.get("normalized", 0),
        "NEAR_DUPLICATES_REMOVED": dedup_stats.get("near", 0),
        "CROSS_SOURCE_DUPLICATES_REMOVED": dedup_stats.get("chunk", 0),
        "EVAL_CONTAMINATION_REMOVED": cont,
        "TARGET_COPY_RATE": round(copy_rate, 4),
        "TRAIN_VAL_DOCUMENT_OVERLAP": len(overlap),
        "CORPUS_HASH": manifest["CORPUS_HASH"],
        "CORPUS_25M_READY": checkpoints["CORPUS_25M_READY"],
        "CORPUS_40M_READY": checkpoints["CORPUS_40M_READY"],
        "CORPUS_50M_READY": bool(checkpoints["CORPUS_50M_READY"] and unique_train >= UNIQUE_TARGET and not overlap),
        "FINAL_UNIQUE_TOKEN_COUNT": unique_train,
        "FINAL_DOMAIN_MIX": mix,
        "FINAL_LICENSE_MIX": dict(licenses),
        "TOKENIZER_TRAINING_SUBSET_READY": True,
        "PILOT_CORPUS_MUTATED": False,
        "PILOT_TOKENIZER_MUTATED": False,
        "MODEL_TRAINING_PERFORMED": False,
        "FULL_WRIM1_TRAINING_AUTHORIZED": False,
        "MODEL_PROMOTED": False,
        "CANONICAL_CHANGED": False,
        "GENESIS_RESUMED": False,
        "FOUNDATION_V2_STARTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "RAEL_STARTED": False,
        "MEGA_SOURCES_RESCUED_FROM_SOURCE_SPLIT": moved,
        "NEXT_COMMANDER_DECISION": (
            "AUTHORIZE FINAL WRIM1 TOKENIZER + NEXT-STAGE MODEL TRAINING"
            if unique_train >= UNIQUE_TARGET and checkpoints["CORPUS_50M_READY"]
            else "EXPAND / REBALANCE CORPUS"
        ),
        "created_at": utc_now(),
        "corpus_dir": str(OUT_DIR),
    })
    write_json(REPORT_PATH, report)
    print("EXPAND_V12_DONE", unique_train, report["NEXT_COMMANDER_DECISION"], flush=True)
    print(json.dumps({k: report[k] for k in ("TRAIN_UNIQUE_TOKENS", "CORPUS_25M_READY", "CORPUS_40M_READY", "CORPUS_50M_READY", "FINAL_DOMAIN_MIX", "CORPUS_HASH")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
