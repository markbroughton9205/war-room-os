"""Freeze RA1 foundation-completion curricula. Does not train. Never writes the graduation suite."""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_hvu_identity import DATA_ROOT, TOKENIZER_EXPECTED_SHA
from wrim_plm1_corpus import leakage_scan

T3_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0"
T3_ALIGN_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0"
PHRASE_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-1-v1.0.0"
PHRASE_ALIGN_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0"
NAT_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0"
MIX_T3 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-v1.0.0"
MIX_T3_ALIGN = Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-ALIGN-v1.0.0"
MIX_PHRASE = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-v1.0.0"
MIX_PHRASE_ALIGN = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-ALIGN-v1.0.0"
MIX_NAT = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-NATURAL-MIX-v1.0.0"
GRAD_DIR = Path(DATA_ROOT) / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"

# Natural 3-token semantic phrases. Tokenizer length is verified at freeze time.
T3_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "target": "no thank you",
        "train": [
            "Decline politely in three words: no thank you.",
            "Reply with no thank you and then stop.",
            "Give the courteous refusal no thank you.",
            "Answer using the three words no thank you.",
            "A polite decline is no thank you. reply with those words.",
            "Print no thank you as a short refusal.",
            "Output the polite no thank you.",
            "Say no thank you as your whole reply.",
            "Write no thank you and halt.",
            "Respond with the refusal no thank you.",
            "Please decline with no thank you.",
            "Use three words only: no thank you.",
            "The courteous pass is no thank you. reply with that.",
            "Give a short no thank you.",
            "Return no thank you as the answer.",
            "Echo no thank you once.",
        ],
        "val": [
            "State no thank you.",
            "A three-word polite no is no thank you. reply with it.",
            "Offer the decline no thank you.",
            "Answer no thank you.",
            "Three-word refusal required: no thank you.",
            "Reply no thank you.",
        ],
    },
    {
        "cls": "no",
        "target": "not at all",
        "train": [
            "Refuse mildly in three words: not at all.",
            "Reply with not at all and then stop.",
            "Give the mild refusal not at all.",
            "Answer using the three words not at all.",
            "A gentle no is not at all. reply with those words.",
            "Print not at all as a short refusal.",
            "Output the mild not at all.",
            "Say not at all as your whole reply.",
            "Write not at all and halt.",
            "Respond with not at all.",
            "Please decline with not at all.",
            "Use three words only: not at all.",
            "The soft no is not at all. reply with that.",
            "Give a short not at all.",
            "Return not at all as the answer.",
            "Echo not at all once.",
        ],
        "val": [
            "State not at all.",
            "A three-word mild no is not at all. reply with it.",
            "Offer the decline not at all.",
            "Answer not at all.",
            "Three-word refusal required: not at all.",
            "Reply not at all.",
        ],
    },
    {
        "cls": "red",
        "target": "the red car",
        "train": [
            "Name the vehicle phrase: the red car.",
            "Reply with the red car and then stop.",
            "Give the three words the red car.",
            "Answer using the red car.",
            "A common colored vehicle is the red car. reply with those words.",
            "Print the red car as a short label.",
            "Output the red car.",
            "Say the red car as your whole reply.",
            "Write the red car and halt.",
            "Respond with the red car.",
            "Please label the vehicle: the red car.",
            "Use three words only: the red car.",
            "The ordinary scarlet auto is the red car. reply with that.",
            "Give a short the red car.",
            "Return the red car as the answer.",
            "Echo the red car once.",
        ],
        "val": [
            "State the red car.",
            "Three-word vehicle phrase: the red car. reply with it.",
            "Name the red car.",
            "Answer the red car.",
            "Three-word vehicle label required: the red car.",
            "Reply the red car.",
        ],
    },
    {
        "cls": "blue",
        "target": "clear blue sky",
        "train": [
            "Name the weather phrase: clear blue sky.",
            "Reply with clear blue sky and then stop.",
            "Give the three words clear blue sky.",
            "Answer using clear blue sky.",
            "A bright day overhead is a clear blue sky. reply with those words.",
            "Print clear blue sky as a short label.",
            "Output clear blue sky.",
            "Say clear blue sky as your whole reply.",
            "Write clear blue sky and halt.",
            "Respond with clear blue sky.",
            "Please label daytime weather: clear blue sky.",
            "Use three words only: clear blue sky.",
            "The ordinary fair vault is clear blue sky. reply with that.",
            "Give a short clear blue sky.",
            "Return clear blue sky as the answer.",
            "Echo clear blue sky once.",
        ],
        "val": [
            "State clear blue sky.",
            "Three-word sky phrase: clear blue sky. reply with it.",
            "Name clear blue sky.",
            "Answer clear blue sky.",
            "Three-word sky label required: clear blue sky.",
            "Reply clear blue sky.",
        ],
    },
    {
        "cls": "cat",
        "target": "dry cat food",
        "train": [
            "Name the meal phrase: dry cat food.",
            "Reply with dry cat food and then stop.",
            "Give the three words dry cat food.",
            "Answer using dry cat food.",
            "Ordinary kibble for a feline is dry cat food. reply with those words.",
            "Print dry cat food as a short label.",
            "Output dry cat food.",
            "Say dry cat food as your whole reply.",
            "Write dry cat food and halt.",
            "Respond with dry cat food.",
            "Please label the feline meal: dry cat food.",
            "Use three words only: dry cat food.",
            "The pantry kibble is dry cat food. reply with that.",
            "Give a short dry cat food.",
            "Return dry cat food as the answer.",
            "Echo dry cat food once.",
        ],
        "val": [
            "State dry cat food.",
            "Three-word feline meal phrase: dry cat food. reply with it.",
            "Name dry cat food.",
            "Answer dry cat food.",
            "Three-word meal label required: dry cat food.",
            "Reply dry cat food.",
        ],
    },
    {
        "cls": "dog",
        "target": "the dog house",
        "train": [
            "Name the kennel phrase: the dog house.",
            "Reply with the dog house and then stop.",
            "Give the three words the dog house.",
            "Answer using the dog house.",
            "A backyard kennel is the dog house. reply with those words.",
            "Print the dog house as a short label.",
            "Output the dog house.",
            "Say the dog house as your whole reply.",
            "Write the dog house and halt.",
            "Respond with the dog house.",
            "Please label the kennel: the dog house.",
            "Use three words only: the dog house.",
            "The outdoor kennel is the dog house. reply with that.",
            "Give a short the dog house.",
            "Return the dog house as the answer.",
            "Echo the dog house once.",
        ],
        "val": [
            "State the dog house.",
            "Three-word kennel phrase: the dog house. reply with it.",
            "Name the dog house.",
            "Answer the dog house.",
            "Three-word kennel label required: the dog house.",
            "Reply the dog house.",
        ],
    },
]

def _prompt_block(target: str, *, kind: str) -> dict[str, list[str]]:
    train = [
        f"Reply with {target} and then stop.",
        f"Give the words {target}.",
        f"Answer using {target}.",
        f"Print {target} as a short reply.",
        f"Output {target}.",
        f"Say {target} as your whole reply.",
        f"Write {target} and halt.",
        f"Respond with {target}.",
        f"Use those words only: {target}.",
        f"Return {target} as the answer.",
        f"Echo {target} once.",
        f"Please reply {target}.",
        f"The required short answer is {target}. reply with that.",
        f"Give a short {target}.",
        f"State the {kind} {target} after the assistant turn.",
        f"Answer with {target} then stop.",
    ]
    val = [
        f"State {target}.",
        f"Held-out {kind}: {target}. reply with it.",
        f"Name {target}.",
        f"Answer {target}.",
        f"Required reply: {target}.",
        f"Reply {target}.",
    ]
    return {"train": train, "val": val}


# Entry-aligned 3-token targets: first generated token is a working first-token class.
# Frozen THREE-TOKEN-1 remains unchanged. This corpus extends proven two-token openings.
T3_ALIGN_SPECS: list[dict[str, Any]] = []
for _cls, _tgt, _kind in (
    ("no", "no thank you", "refusal"),
    ("no", "no way out", "refusal"),
    ("red", "red car lot", "vehicle"),
    ("blue", "blue sky day", "sky"),
    ("cat", "cat food dry", "meal"),
    ("dog", "dog house out", "kennel"),
):
    blk = _prompt_block(_tgt, kind=_kind)
    T3_ALIGN_SPECS.append({"cls": _cls, "target": _tgt, **blk})

PHRASE_ALIGN_SPECS: list[dict[str, Any]] = []
for _cls, _tgt, _kind in (
    ("no", "no thank you sir", "refusal"),
    ("blue", "blue sky up high", "sky"),
    ("cat", "cat food for now", "meal"),
    ("dog", "dog house out back", "kennel"),
):
    blk = _prompt_block(_tgt, kind=_kind)
    PHRASE_ALIGN_SPECS.append({"cls": _cls, "target": _tgt, **blk})

PHRASE_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "target": "no thank you sir",
        "train": [
            "Decline formally: no thank you sir.",
            "Reply with no thank you sir and stop.",
            "Give the four-word refusal no thank you sir.",
            "Answer using no thank you sir.",
            "A formal polite no is no thank you sir. reply with that.",
            "Print no thank you sir.",
            "Say no thank you sir as your whole reply.",
            "Write no thank you sir and halt.",
            "Respond with no thank you sir.",
            "Use four words only: no thank you sir.",
            "Return no thank you sir as the answer.",
            "Echo no thank you sir once.",
        ],
        "val": [
            "State no thank you sir.",
            "Four-word polite refusal: no thank you sir. reply with it.",
            "Answer no thank you sir.",
            "Reply no thank you sir.",
        ],
    },
    {
        "cls": "red",
        "target": "a small red car",
        "train": [
            "Describe the vehicle: a small red car.",
            "Reply with a small red car and stop.",
            "Give the four words a small red car.",
            "Answer using a small red car.",
            "A compact scarlet auto is a small red car. reply with that.",
            "Print a small red car.",
            "Say a small red car as your whole reply.",
            "Write a small red car and halt.",
            "Respond with a small red car.",
            "Use four words only: a small red car.",
            "Return a small red car as the answer.",
            "Echo a small red car once.",
        ],
        "val": [
            "State a small red car.",
            "Four-word vehicle phrase: a small red car. reply with it.",
            "Answer a small red car.",
            "Reply a small red car.",
        ],
    },
]

NAT_SPECS: list[dict[str, Any]] = [
    {"cls": "yes", "target": "yes", "train": [
        "Is water wet in ordinary speech? yes or no.",
        "Does 2 plus 2 equal 4? yes or no.",
        "Can a bird typically fly? yes or no.",
        "Is ice colder than steam? yes or no.",
        "Reply yes if a circle is round.",
        "Answer yes for a true simple fact: rain is wet.",
        "Say yes.",
        "Give the affirmation yes.",
    ], "val": [
        "Is a cube a square prism? yes or no.",
        "Does a clock tell time? yes or no.",
    ]},
    {"cls": "no", "target": "no", "train": [
        "Is the sun a planet? yes or no.",
        "Does a fish typically bark? yes or no.",
        "Is 2 greater than 9? yes or no.",
        "Can a stone swim like a fish? yes or no.",
        "Reply no if a triangle has eight sides.",
        "Answer no for a false claim: ice is hot.",
        "Say no.",
        "Give the denial no.",
    ], "val": [
        "Is wood a metal? yes or no.",
        "Does a square have five corners? yes or no.",
    ]},
    {"cls": "ok", "target": "ok", "train": [
        "Acknowledge with ok.",
        "Reply ok and stop.",
        "Give the short acknowledgement ok.",
        "Answer ok.",
        "Print ok.",
        "Say ok as your whole reply.",
        "Write ok and halt.",
        "Return ok as the answer.",
    ], "val": [
        "State ok.",
        "Reply ok.",
    ]},
    {"cls": "json", "target": "{\"ok\":1}", "train": [
        "Emit compact JSON only: {\"ok\":1}",
        "Reply with the JSON object {\"ok\":1} and stop.",
        "Output {\"ok\":1} as JSON.",
        "Return compact JSON {\"ok\":1}.",
        "Print {\"ok\":1}.",
        "Give JSON {\"ok\":1}.",
        "Write {\"ok\":1} and halt.",
        "Respond with {\"ok\":1}.",
    ], "val": [
        "State {\"ok\":1}.",
        "Reply {\"ok\":1}.",
    ]},
]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def _tok_len(tokenizer, text: str) -> int:
    return len(tokenizer.encode(text, add_special_tokens=False).ids)


def _rows_from_specs(specs: list[dict[str, Any]], *, family: str, provenance: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    n = 0
    for spec in specs:
        for prompt in spec["train"]:
            train.append(
                {
                    "example_id": f"{family}-{n:04d}",
                    "family": f"{family}_{spec['cls']}",
                    "first_token_class": spec["cls"],
                    "prompt": prompt,
                    "target": spec["target"],
                    "provenance": provenance,
                }
            )
            n += 1
        for prompt in spec["val"]:
            val.append(
                {
                    "example_id": f"{family}-{n:04d}",
                    "family": f"{family}_{spec['cls']}",
                    "first_token_class": spec["cls"],
                    "prompt": prompt,
                    "target": spec["target"],
                    "provenance": provenance,
                }
            )
            n += 1
    return train, val


def _mix(parts: list[tuple[list[dict[str, Any]], int]], rng: random.Random) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rows, k in parts:
        if not rows or k <= 0:
            continue
        if k >= len(rows):
            cur = list(rows)
            while len(cur) < k:
                cur.extend(rows)
            out.extend(cur[:k])
        else:
            out.extend(rng.sample(rows, k))
    rng.shuffle(out)
    return out


def build_all() -> dict[str, Any]:
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file

    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return {"ok": False, "reason": "tokenizer_hash_mismatch"}
    tokenizer = Tokenizer.from_file(str(tok_path))
    if GRAD_DIR.is_dir() and any(p.name.endswith("train.jsonl") for p in GRAD_DIR.iterdir()):
        return {"ok": False, "reason": "graduation_suite_must_not_be_a_train_source"}

    bad = []
    for spec in T3_SPECS:
        n = _tok_len(tokenizer, spec["target"])
        if n != 3:
            bad.append((spec["target"], n, 3))
    for spec in PHRASE_SPECS:
        n = _tok_len(tokenizer, spec["target"])
        if n < 3 or n > 5:
            bad.append((spec["target"], n, "3-5"))
    if bad:
        return {"ok": False, "reason": "token_len_mismatch", "bad": bad}

    t3_train, t3_val = _rows_from_specs(T3_SPECS, family="t3", provenance="first-party-war-room-os-internal-three-token")
    leak = leakage_scan(t3_train, t3_val) if hasattr(leakage_scan, "__call__") else {"ok": True}
    # leakage_scan may expect different args; also check prompt overlap locally.
    train_p = {r["prompt"] for r in t3_train}
    if any(r["prompt"] in train_p for r in t3_val):
        return {"ok": False, "reason": "t3_prompt_overlap"}
    _write_jsonl(T3_DIR / "train.jsonl", t3_train)
    _write_jsonl(T3_DIR / "val.jsonl", t3_val)
    t3_man = {
        "corpus_id": "WR-CORPUS-PLM-THREE-TOKEN-1",
        "corpus_version": "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0",
        "TRAIN_EXAMPLE_COUNT": len(t3_train),
        "VAL_EXAMPLE_COUNT": len(t3_val),
        "TOKEN_LEN": 3,
        "TARGETS": [s["target"] for s in T3_SPECS],
        "FIRST_TOKEN_CLASSES": sorted({s["cls"] for s in T3_SPECS}),
        "train_sha256": _sha(T3_DIR / "train.jsonl"),
        "val_sha256": _sha(T3_DIR / "val.jsonl"),
        "PROVENANCE": "first-party War Room OS internal three-token semantic curriculum.",
        "GRADUATION_SUITE_MUTATED": False,
    }
    _write(T3_DIR / "manifest.json", t3_man)

    ph_train, ph_val = _rows_from_specs(PHRASE_SPECS, family="ph", provenance="first-party-war-room-os-internal-short-phrase")
    train_p = {r["prompt"] for r in ph_train}
    if any(r["prompt"] in train_p for r in ph_val):
        return {"ok": False, "reason": "phrase_prompt_overlap"}
    _write_jsonl(PHRASE_DIR / "train.jsonl", ph_train)
    _write_jsonl(PHRASE_DIR / "val.jsonl", ph_val)
    ph_man = {
        "corpus_id": "WR-CORPUS-PLM-SHORT-PHRASE-1",
        "corpus_version": "WR-CORPUS-PLM-SHORT-PHRASE-1-v1.0.0",
        "TRAIN_EXAMPLE_COUNT": len(ph_train),
        "VAL_EXAMPLE_COUNT": len(ph_val),
        "TARGETS": [s["target"] for s in PHRASE_SPECS],
        "train_sha256": _sha(PHRASE_DIR / "train.jsonl"),
        "val_sha256": _sha(PHRASE_DIR / "val.jsonl"),
        "PROVENANCE": "first-party War Room OS internal short-phrase curriculum.",
        "GRADUATION_SUITE_MUTATED": False,
    }
    _write(PHRASE_DIR / "manifest.json", ph_man)

    nat_train, nat_val = _rows_from_specs(NAT_SPECS, family="nat", provenance="first-party-war-room-os-internal-short-natural")
    train_p = {r["prompt"] for r in nat_train}
    if any(r["prompt"] in train_p for r in nat_val):
        return {"ok": False, "reason": "nat_prompt_overlap"}
    _write_jsonl(NAT_DIR / "train.jsonl", nat_train)
    _write_jsonl(NAT_DIR / "val.jsonl", nat_val)
    _write(NAT_DIR / "manifest.json", {
        "corpus_id": "WR-CORPUS-PLM-SHORT-NATURAL-1",
        "corpus_version": "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0",
        "TRAIN_EXAMPLE_COUNT": len(nat_train),
        "VAL_EXAMPLE_COUNT": len(nat_val),
        "TARGETS": [s["target"] for s in NAT_SPECS],
        "train_sha256": _sha(NAT_DIR / "train.jsonl"),
        "val_sha256": _sha(NAT_DIR / "val.jsonl"),
        "GRADUATION_SUITE_MUTATED": False,
    })

    from wrim_arch_uh1_phase_a import load_jsonl

    ft_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    ft_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    rng = random.Random(8101)

    def freeze_mix(dest: Path, train_parts, val_rows, name: str, mix: str) -> None:
        tr = _mix(train_parts, rng)
        _write_jsonl(dest / "train.jsonl", tr)
        _write_jsonl(dest / "val.jsonl", val_rows)
        _write(dest / "manifest.json", {
            "corpus_id": name,
            "mix": mix,
            "TRAIN": len(tr),
            "VAL": len(val_rows),
            "train_sha256": _sha(dest / "train.jsonl"),
            "val_sha256": _sha(dest / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        })

    freeze_mix(MIX_T3, [(ft_tr, 72), (tt_tr, 96), (t3_train, 96)], tt_va + t3_val, "WR-CORPUS-PLM-FT-TT-T3", "FT72 TT96 T3 96")
    freeze_mix(MIX_PHRASE, [(ft_tr, 48), (tt_tr, 72), (t3_train, 72), (ph_train, 72)], tt_va + t3_val + ph_val, "WR-CORPUS-PLM-FT-TT-T3-PHRASE", "FT48 TT72 T3 72 PH 72")
    freeze_mix(MIX_NAT, [(ft_tr, 48), (tt_tr, 48), (t3_train, 48), (ph_train, 36), (nat_train, 72)], tt_va + t3_val + ph_val + nat_val, "WR-CORPUS-PLM-SHORT-NATURAL-MIX", "FT48 TT48 T3 48 PH36 NAT72")
    return {
        "ok": True,
        "t3": t3_man,
        "phrase": ph_man,
        "leak": leak,
        "GRADUATION_SUITE_MUTATED": False,
        "paths": {"t3": str(T3_DIR), "phrase": str(PHRASE_DIR), "nat": str(NAT_DIR), "mix_t3": str(MIX_T3), "mix_phrase": str(MIX_PHRASE), "mix_nat": str(MIX_NAT)},
    }


def freeze_align_curricula() -> dict[str, Any]:
    """Freeze entry-aligned T3/phrase corpora. Never mutates THREE-TOKEN-1 or the graduation suite."""
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_arch_uh1_phase_a import load_jsonl

    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return {"ok": False, "reason": "tokenizer_hash_mismatch"}
    tokenizer = Tokenizer.from_file(str(tok_path))
    if GRAD_DIR.is_dir() and any(p.name.endswith("train.jsonl") for p in GRAD_DIR.iterdir()):
        return {"ok": False, "reason": "graduation_suite_must_not_be_a_train_source"}
    bad = []
    for spec in T3_ALIGN_SPECS:
        n = _tok_len(tokenizer, spec["target"])
        if n != 3:
            bad.append((spec["target"], n, 3))
    for spec in PHRASE_ALIGN_SPECS:
        n = _tok_len(tokenizer, spec["target"])
        if n < 3 or n > 5:
            bad.append((spec["target"], n, "3-5"))
    if bad:
        return {"ok": False, "reason": "token_len_mismatch", "bad": bad}
    if T3_ALIGN_DIR.joinpath("train.jsonl").is_file() and MIX_T3_ALIGN.joinpath("train.jsonl").is_file():
        return {
            "ok": True,
            "already_frozen": True,
            "GRADUATION_SUITE_MUTATED": False,
            "paths": {
                "t3_align": str(T3_ALIGN_DIR),
                "phrase_align": str(PHRASE_ALIGN_DIR),
                "mix_t3_align": str(MIX_T3_ALIGN),
                "mix_phrase_align": str(MIX_PHRASE_ALIGN),
            },
        }
    t3_train, t3_val = _rows_from_specs(
        T3_ALIGN_SPECS, family="t3a", provenance="first-party-war-room-os-internal-three-token-align"
    )
    train_p = {r["prompt"] for r in t3_train}
    if any(r["prompt"] in train_p for r in t3_val):
        return {"ok": False, "reason": "t3_align_prompt_overlap"}
    _write_jsonl(T3_ALIGN_DIR / "train.jsonl", t3_train)
    _write_jsonl(T3_ALIGN_DIR / "val.jsonl", t3_val)
    _write(
        T3_ALIGN_DIR / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1",
            "corpus_version": "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0",
            "TRAIN_EXAMPLE_COUNT": len(t3_train),
            "VAL_EXAMPLE_COUNT": len(t3_val),
            "TOKEN_LEN": 3,
            "TARGETS": [s["target"] for s in T3_ALIGN_SPECS],
            "FIRST_TOKEN_CLASSES": sorted({s["cls"] for s in T3_ALIGN_SPECS}),
            "ENTRY_ALIGNED": True,
            "train_sha256": _sha(T3_ALIGN_DIR / "train.jsonl"),
            "val_sha256": _sha(T3_ALIGN_DIR / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    ph_train, ph_val = _rows_from_specs(
        PHRASE_ALIGN_SPECS, family="pha", provenance="first-party-war-room-os-internal-short-phrase-align"
    )
    train_p = {r["prompt"] for r in ph_train}
    if any(r["prompt"] in train_p for r in ph_val):
        return {"ok": False, "reason": "phrase_align_prompt_overlap"}
    _write_jsonl(PHRASE_ALIGN_DIR / "train.jsonl", ph_train)
    _write_jsonl(PHRASE_ALIGN_DIR / "val.jsonl", ph_val)
    _write(
        PHRASE_ALIGN_DIR / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1",
            "TARGETS": [s["target"] for s in PHRASE_ALIGN_SPECS],
            "ENTRY_ALIGNED": True,
            "train_sha256": _sha(PHRASE_ALIGN_DIR / "train.jsonl"),
            "val_sha256": _sha(PHRASE_ALIGN_DIR / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    ft_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    rng = random.Random(8117)
    mix_tr = _mix([(t3_train, 192), (tt_tr, 48), (ft_tr, 24)], rng)
    train_prompts = {r["prompt"] for r in mix_tr}
    mix_val = [r for r in (t3_val + tt_va) if r["prompt"] not in train_prompts]
    MIX_T3_ALIGN.mkdir(parents=True, exist_ok=True)
    _write_jsonl(MIX_T3_ALIGN / "train.jsonl", mix_tr)
    _write_jsonl(MIX_T3_ALIGN / "val.jsonl", mix_val)
    _write(
        MIX_T3_ALIGN / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-T3-ALIGN",
            "mix": "T3A192 TT48 FT24",
            "TRAIN": len(mix_tr),
            "VAL": len(mix_val),
            "ENTRY_ALIGNED": True,
            "train_sha256": _sha(MIX_T3_ALIGN / "train.jsonl"),
            "val_sha256": _sha(MIX_T3_ALIGN / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    ph_mix = _mix([(t3_train, 96), (ph_train, 96), (tt_tr, 48), (ft_tr, 24)], rng)
    ph_val_mix = [r for r in (t3_val + ph_val + tt_va) if r["prompt"] not in {x["prompt"] for x in ph_mix}]
    MIX_PHRASE_ALIGN.mkdir(parents=True, exist_ok=True)
    _write_jsonl(MIX_PHRASE_ALIGN / "train.jsonl", ph_mix)
    _write_jsonl(MIX_PHRASE_ALIGN / "val.jsonl", ph_val_mix)
    _write(
        MIX_PHRASE_ALIGN / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-FT-TT-T3-PHRASE-ALIGN",
            "ENTRY_ALIGNED": True,
            "TRAIN": len(ph_mix),
            "VAL": len(ph_val_mix),
            "train_sha256": _sha(MIX_PHRASE_ALIGN / "train.jsonl"),
            "val_sha256": _sha(MIX_PHRASE_ALIGN / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    return {
        "ok": True,
        "GRADUATION_SUITE_MUTATED": False,
        "paths": {
            "t3_align": str(T3_ALIGN_DIR),
            "phrase_align": str(PHRASE_ALIGN_DIR),
            "mix_t3_align": str(MIX_T3_ALIGN),
            "mix_phrase_align": str(MIX_PHRASE_ALIGN),
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_all(), indent=2, default=str))
    print(json.dumps(freeze_align_curricula(), indent=2, default=str))
