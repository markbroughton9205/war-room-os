"""Freeze remaining RA1 foundation-finalization corpora. Never writes the graduation suite."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_hvu_identity import DATA_ROOT, TOKENIZER_EXPECTED_SHA
from wrim_ra1_grad_corpus import (
    GRAD_DIR,
    MIX_PHRASE_ALIGN,
    PHRASE_ALIGN_DIR,
    T3_ALIGN_DIR,
    _mix,
    _prompt_block,
    _rows_from_specs,
    _sha,
    _tok_len,
    _write_jsonl,
    freeze_align_curricula,
)

PHRASE_RED_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-RED-1-v1.0.0"
PHRASE_NATURAL_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-NATURAL-1-v1.0.0"
NAT2_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-NATURAL-ALIGN-2-v1.0.0"
GEN2_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-2-v1.0.0"
MIX_PHRASE2 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-RED-v1.0.0"
MIX_PHRASE3 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-NATURAL-v1.0.0"
MIX_NAT2 = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-NAT2-v1.0.0"
MIX_GEN = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-GEN-v1.0.0"
MIX_CONS = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-PHRASE-CONS-v1.0.0"

PHRASE_RED_SPECS: list[dict[str, Any]] = [
    {"cls": "red", "target": "red car out back", **_prompt_block("red car out back", kind="vehicle")}
]

PHRASE_NATURAL_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "target": "no thank you sir",
        "train": [
            "A host offers a second cup of tea. Decline politely in four words.",
            "Someone holds out leftover cake. Give a four-word courteous refusal.",
            "Politely pass on more coffee using four short words.",
            "Decline an extra serving with a four-word courtesy, then stop.",
            "Refuse more bread politely, four words only.",
            "A waiter asks if you want more soup. Decline courteously in four words.",
            "Give a four-word polite no to a second helping.",
            "Extra dessert is offered. Decline with a four-word courtesy.",
        ],
        "val": [
            "Extra milk is offered. Decline with four polite words.",
            "Politely refuse more toast in four words.",
        ],
    },
    {
        "cls": "blue",
        "target": "blue sky up high",
        "train": [
            "Picture a cloudless noon in four words, color first.",
            "Four-word outdoor sky description, starting with the color.",
            "Describe clear daytime air overhead in four words.",
            "Give a four-word sky picture with color first, then height.",
            "A bright noon with no clouds: four-word color-first label.",
            "Name the overhead daytime field in four words, color first.",
            "Four-word fair-weather sky, color then place.",
            "Reply with a four-word high daytime sky, color first.",
        ],
        "val": [
            "Four-word color-first label for a cloudless noon sky.",
            "Describe overhead fair weather in four words, color first.",
        ],
    },
    {
        "cls": "cat",
        "target": "cat food for now",
        "train": [
            "What should the indoor feline eat at this moment, four words?",
            "Four-word present meal label for a house cat.",
            "Name the current feline dish in four words.",
            "A hungry house cat needs a four-word meal note.",
            "Four-word present-tense cat meal, starting with the animal.",
            "Label the cat's current ration in four words.",
            "Give the four-word bowl note for a cat right now.",
            "What goes in the cat bowl at present? four words.",
        ],
        "val": [
            "Four-word current meal note for a house cat.",
            "Name the present feline ration in four words.",
        ],
    },
    {
        "cls": "dog",
        "target": "dog house out back",
        "train": [
            "Where does the backyard dog sleep, four words?",
            "Four-word outdoor kennel location, animal first.",
            "Name the rear-yard kennel in four words.",
            "A yard kennel behind the home: four-word label.",
            "Four-word place name for the outdoor dog shelter.",
            "Where is the kennel relative to the house? four words, animal first.",
            "Give the four-word backyard kennel phrase.",
            "Label the rear outdoor kennel in four words.",
        ],
        "val": [
            "Four-word backyard kennel phrase, animal first.",
            "Name the rear-yard dog shelter in four words.",
        ],
    },
    {
        "cls": "red",
        "target": "red car out back",
        "train": [
            "Where is the crimson vehicle parked, four words, color first?",
            "Four-word rear-lot vehicle label, color first.",
            "Name the backyard automobile in four words, color first.",
            "A colored car behind the house: four-word color-first label.",
            "Four-word place for the scarlet vehicle, color first.",
            "Give the four-word rear-yard car phrase, color first.",
            "Label the outdoor car behind the home in four words.",
            "Where is that colored auto? four words, color first.",
        ],
        "val": [
            "Four-word rear-yard vehicle phrase, color first.",
            "Name the backyard car in four words, color first.",
        ],
    },
]

NAT2_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "target": "no",
        "train": [
            "Is a whale a kind of insect? yes or no.",
            "Does a pencil usually bark? yes or no.",
            "Is glass a type of animal? yes or no.",
            "Can a mountain typically swim? yes or no.",
            "Is 9 smaller than 1? yes or no.",
            "Does a circle have corners? yes or no.",
            "Are you ChatGPT? yes or no.",
            "Is silence a loud drum? yes or no.",
        ],
        "val": [
            "Is a lake a kind of mountain? yes or no.",
            "Does a table usually fly? yes or no.",
        ],
    },
    {
        "cls": "yes",
        "target": "yes",
        "train": [
            "Is snow typically cold? yes or no.",
            "Does a week have seven days? yes or no.",
            "Can a fish typically swim? yes or no.",
            "Is a square a four-sided shape? yes or no.",
            "Does fire produce heat? yes or no.",
            "Is water a liquid at room temperature? yes or no.",
            "Can people typically walk? yes or no.",
            "Is midnight darker than noon? yes or no.",
        ],
        "val": [
            "Is ice typically solid water? yes or no.",
            "Does a triangle have three corners? yes or no.",
        ],
    },
    {
        "cls": "red",
        "target": "red",
        "train": [
            "Name the color of a ripe tomato in one word.",
            "What color is a typical stop sign? one word.",
            "Ripe strawberries are which color? one word.",
            "Name the color of fresh blood in one word.",
            "A fire engine is often which color? one word.",
            "Name the color of a cardinal bird in one word.",
            "What color are most bricks? one word.",
            "Give the color of a ripe cherry, one word.",
        ],
        "val": [
            "Name the color of a ripe apple often used in logos, one word.",
            "What color is a typical emergency light on a fire truck? one word.",
        ],
    },
    {
        "cls": "blue",
        "target": "blue",
        "train": [
            "Name the color of a clear noon sky in one word.",
            "What color is a typical clear daytime sky? one word.",
            "Deep ocean water is often which color? one word.",
            "Name the color of blueberries' skin, one word.",
            "A cloudless summer sky is which color? one word.",
            "Give the color of a typical sapphire, one word.",
            "What color is the daytime sky with no clouds? one word.",
            "Name the color associated with a clear sky, one word.",
        ],
        "val": [
            "Name the color of a cloudless day overhead, one word.",
            "What color is a typical fair-weather sky? one word.",
        ],
    },
    {
        "cls": "cat",
        "target": "cat",
        "train": [
            "Name a common house pet that meows, one word.",
            "Which common pet hunts mice and meows? one word.",
            "A small pet with whiskers that purrs is a what? one word.",
            "Name the meowing house animal, one word.",
            "Which pet is a feline? one word.",
            "Give the one-word name of a purring pet.",
            "A litter-box pet that meows is a what? one word.",
            "Name the common pet opposed to a barking dog, one word: the meower.",
        ],
        "val": [
            "Name a purring house pet in one word.",
            "Which common pet meows? one word.",
        ],
    },
    {
        "cls": "dog",
        "target": "dog",
        "train": [
            "Name a common house pet that barks, one word.",
            "Which common pet wags a tail and barks? one word.",
            "A pet that fetches sticks and barks is a what? one word.",
            "Name the barking house animal, one word.",
            "Which pet is a canine? one word.",
            "Give the one-word name of a barking pet.",
            "A leash pet that barks is a what? one word.",
            "Name the common pet opposed to a meowing cat, one word: the barker.",
        ],
        "val": [
            "Name a barking house pet in one word.",
            "Which common pet barks? one word.",
        ],
    },
    {
        "cls": "two",
        "target": "two",
        "train": [
            "How many eyes does a typical person have? one word.",
            "How many wheels does a bicycle have? one word.",
            "How many hands does a typical person have? one word.",
            "What is one plus one? one word.",
            "How many ears does a typical person have? one word.",
            "A pair contains how many items? one word.",
            "How many wings does a typical bird have? one word.",
            "How many halves make a whole? one word.",
        ],
        "val": [
            "How many feet does a typical person have? one word.",
            "How many wheels does a motorcycle usually have? one word.",
        ],
    },
    {
        "cls": "four",
        "target": "four",
        "train": [
            "How many seasons are in a year? one word.",
            "How many legs does a typical dog have? one word.",
            "How many sides does a square have? one word.",
            "What is two plus two? one word.",
            "How many quarters make a whole? one word.",
            "How many wheels does a typical car have? one word.",
            "How many corners does a square have? one word.",
            "A typical chair has how many legs? one word.",
        ],
        "val": [
            "How many legs does a typical cat have? one word.",
            "How many sides does a rectangle have? one word.",
        ],
    },
    {
        "cls": "json",
        "target": "{\"ok\":1}",
        "train": [
            "Return only compact JSON with ok set to 1.",
            "Emit a tiny JSON object whose ok field is 1.",
            "Give compact JSON recording ok as 1.",
            "Output JSON with a single ok key equal to 1.",
            "Reply using compact JSON success flag 1.",
            "Write compact JSON: ok mapped to 1.",
            "Produce JSON whose only field ok equals 1.",
            "Compact JSON success object, ok is 1.",
        ],
        "val": [
            "Give compact JSON with ok equal to 1.",
            "Emit JSON whose ok field is 1.",
        ],
    },
    {
        "cls": "code",
        "target": "print(1)",
        "train": [
            "Write a one-line Python print of integer one.",
            "Python: print the integer 1 and stop.",
            "Give a Python statement that prints 1.",
            "One-line Python that prints the number 1.",
            "Emit Python print of 1.",
            "A minimal Python print of one.",
            "Python code to print 1, one line.",
            "Write print of integer 1 in Python.",
        ],
        "val": [
            "One-line Python that prints 1.",
            "Give Python that prints the integer 1.",
        ],
    },
    {
        "cls": "no",
        "target": "no thank you sir",
        "train": [
            "Need a four-word polite refusal to extra tea.",
            "Four-word courteous pass when more coffee is offered.",
            "Decline a second helping with a four-word courtesy.",
            "A host pushes more cake. Four-word polite refusal.",
            "Give the four-word courtesy used to refuse more soup.",
            "Extra bread is offered. Four-word polite no.",
            "Four-word polite refusal, then stop.",
            "Refuse more dessert using four courteous words.",
        ],
        "val": [
            "Four-word polite refusal to extra milk.",
            "Decline more toast with a four-word courtesy.",
        ],
    },
    {
        "cls": "ok",
        "target": "ok",
        "train": [
            "Acknowledge the instruction with one short word.",
            "Confirm receipt using one brief acknowledgement word.",
            "Give a one-word acknowledgement that work can continue.",
            "Reply with a brief okay-style acknowledgement.",
            "One-word confirmation that the request was heard.",
            "Acknowledge and stop, one short word.",
            "A terse acknowledgement only.",
            "Confirm with the short acknowledgement word.",
        ],
        "val": [
            "One-word acknowledgement that the task is received.",
            "Give a brief acknowledgement word and stop.",
        ],
    },
]


GEN2_EVAL: list[dict[str, Any]] = [
    {"example_id": "g2-000", "family": "gen_no_fact", "first_token_class": "no", "target": "no", "prompt": "Changed wording. Is a cloud a kind of rock? Answer with one yes-or-no word."},
    {"example_id": "g2-001", "family": "gen_no_phrase", "first_token_class": "no", "target": "no thank you sir", "prompt": "Semantically equivalent instruction. Extra tea is offered; refuse courteously in four words."},
    {"example_id": "g2-002", "family": "gen_red_label", "first_token_class": "red", "target": "red", "prompt": "Paraphrase. A ripe tomato: name its ordinary color in one word."},
    {"example_id": "g2-003", "family": "gen_red_phrase", "first_token_class": "red", "target": "red car out back", "prompt": "Word order changed. Behind the house sits a colored auto; four words, color first."},
    {"example_id": "g2-004", "family": "gen_blue_label", "first_token_class": "blue", "target": "blue", "prompt": "Different prompt length. After a long calm pause, name the cloudless noon sky color in one word."},
    {"example_id": "g2-005", "family": "gen_dog_label", "first_token_class": "dog", "target": "dog", "prompt": "Unseen surrounding context. In a quiet kitchen, name the barking house pet in one word."},
    {"example_id": "g2-006", "family": "gen_cat_phrase", "first_token_class": "cat", "target": "cat food for now", "prompt": "Equivalent meal instruction. Current ration for the indoor feline, four words."},
    {"example_id": "g2-007", "family": "gen_two", "first_token_class": "two", "target": "two", "prompt": "Small variation. Count the hands of a typical person in one word."},
    {"example_id": "g2-008", "family": "gen_json", "first_token_class": "json", "target": "{\"ok\":1}", "prompt": "Unseen JSON wording. Compact object, field ok equals 1, nothing else."},
    {"example_id": "g2-009", "family": "gen_code", "first_token_class": "code", "target": "print(1)", "prompt": "Paraphrased code request. Minimal Python that prints integer one."},
    {"example_id": "g2-010", "family": "gen_yes", "first_token_class": "yes", "target": "yes", "prompt": "Fresh yes-no. Is a week longer than a day? one word."},
    {"example_id": "g2-011", "family": "gen_dog_phrase", "first_token_class": "dog", "target": "dog house out back", "prompt": "Changed context. Rear-yard kennel name in four words, animal first."},
]


def _banned_prompts() -> set[str]:
    from wrim_arch_uh1_phase_a import load_jsonl

    banned: set[str] = set()
    for folder in (
        "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0",
        "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-PHRASE-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0",
        "WR-CORPUS-PLM-FT-TT-T3-PHRASE-ALIGN-v1.0.0",
        "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0",
        "WRIM-FOUNDATION-GRADUATION-1-v1.0.0",
        "WRIM-FOUNDATION-EVAL-1-v1.0.0",
    ):
        root = Path(DATA_ROOT) / folder
        if not root.is_dir():
            continue
        for path in root.iterdir():
            if path.suffix == ".jsonl":
                banned.update(str(r.get("prompt")) for r in load_jsonl(path) if r.get("prompt"))
    return banned


def _write_spec_dir(
    dest: Path,
    specs: list[dict[str, Any]],
    *,
    family: str,
    provenance: str,
    corpus_id: str,
    tokenizer,
    min_len: int,
    max_len: int,
    extra: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    bad = []
    for spec in specs:
        n = _tok_len(tokenizer, spec["target"])
        if n < min_len or n > max_len:
            bad.append((spec["target"], n, f"{min_len}-{max_len}"))
    if bad:
        raise RuntimeError(f"token_len_mismatch:{corpus_id}:{bad}")
    train, val = _rows_from_specs(specs, family=family, provenance=provenance)
    train_p = {r["prompt"] for r in train}
    if any(r["prompt"] in train_p for r in val):
        raise RuntimeError(f"prompt_overlap:{corpus_id}")
    dest.mkdir(parents=True, exist_ok=True)
    _write_jsonl(dest / "train.jsonl", train)
    _write_jsonl(dest / "val.jsonl", val)
    man = {
        "corpus_id": corpus_id,
        "TRAIN_EXAMPLE_COUNT": len(train),
        "VAL_EXAMPLE_COUNT": len(val),
        "TARGETS": [s["target"] for s in specs],
        "FIRST_TOKEN_CLASSES": sorted({s["cls"] for s in specs}),
        "train_sha256": _sha(dest / "train.jsonl"),
        "val_sha256": _sha(dest / "val.jsonl"),
        "GRADUATION_SUITE_MUTATED": False,
        "ENTRY_ALIGNED": True,
    }
    if extra:
        man.update(extra)
    _write(dest / "manifest.json", man)
    return train, val


def _freeze_mix(
    dest: Path,
    train_parts: list[tuple[list[dict[str, Any]], int]],
    val_rows: list[dict[str, Any]],
    *,
    name: str,
    mix: str,
    rng: random.Random,
) -> None:
    tr = _mix(train_parts, rng)
    train_p = {r["prompt"] for r in tr}
    val = [r for r in val_rows if r["prompt"] not in train_p]
    dest.mkdir(parents=True, exist_ok=True)
    _write_jsonl(dest / "train.jsonl", tr)
    _write_jsonl(dest / "val.jsonl", val)
    _write(
        dest / "manifest.json",
        {
            "corpus_id": name,
            "mix": mix,
            "TRAIN": len(tr),
            "VAL": len(val),
            "ENTRY_ALIGNED": True,
            "train_sha256": _sha(dest / "train.jsonl"),
            "val_sha256": _sha(dest / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )


def freeze_final_curricula() -> dict[str, Any]:
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_arch_uh1_phase_a import load_jsonl

    aligned = freeze_align_curricula()
    if not aligned.get("ok"):
        return aligned
    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return {"ok": False, "reason": "tokenizer_hash_mismatch"}
    tokenizer = Tokenizer.from_file(str(tok_path))
    if GRAD_DIR.is_dir() and any(p.name.endswith("train.jsonl") for p in GRAD_DIR.iterdir()):
        return {"ok": False, "reason": "graduation_suite_must_not_be_a_train_source"}
    if MIX_CONS.joinpath("train.jsonl").is_file() and NAT2_DIR.joinpath("train.jsonl").is_file():
        return {
            "ok": True,
            "already_frozen": True,
            "GRADUATION_SUITE_MUTATED": False,
            "paths": {
                "phrase_red": str(PHRASE_RED_DIR),
                "phrase_natural": str(PHRASE_NATURAL_DIR),
                "nat2": str(NAT2_DIR),
                "mix_phrase2": str(MIX_PHRASE2),
                "mix_phrase3": str(MIX_PHRASE3),
                "mix_nat2": str(MIX_NAT2),
                "mix_gen": str(MIX_GEN),
                "mix_cons": str(MIX_CONS),
                "gen2": str(GEN2_DIR),
            },
        }

    red_train, red_val = _write_spec_dir(
        PHRASE_RED_DIR,
        PHRASE_RED_SPECS,
        family="phr",
        provenance="first-party-war-room-os-internal-short-phrase-red",
        corpus_id="WR-CORPUS-PLM-SHORT-PHRASE-RED-1",
        tokenizer=tokenizer,
        min_len=3,
        max_len=6,
    )
    natp_train, natp_val = _write_spec_dir(
        PHRASE_NATURAL_DIR,
        PHRASE_NATURAL_SPECS,
        family="phn",
        provenance="first-party-war-room-os-internal-short-phrase-natural",
        corpus_id="WR-CORPUS-PLM-SHORT-PHRASE-NATURAL-1",
        tokenizer=tokenizer,
        min_len=3,
        max_len=6,
    )
    nat2_train, nat2_val = _write_spec_dir(
        NAT2_DIR,
        NAT2_SPECS,
        family="n2",
        provenance="first-party-war-room-os-internal-short-natural-2",
        corpus_id="WR-CORPUS-PLM-SHORT-NATURAL-ALIGN-2",
        tokenizer=tokenizer,
        min_len=1,
        max_len=8,
    )

    banned = _banned_prompts()
    for rows, label in ((red_train, "red"), (natp_train, "phn"), (nat2_train, "nat2")):
        hit = [r["prompt"] for r in rows if r["prompt"] in banned]
        if hit:
            return {"ok": False, "reason": f"train_prompt_leakage_{label}", "n": len(hit), "sample": hit[:5]}

    ft_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    t3_tr = load_jsonl(T3_ALIGN_DIR / "train.jsonl")
    t3_va = load_jsonl(T3_ALIGN_DIR / "val.jsonl")
    ph_tr = load_jsonl(PHRASE_ALIGN_DIR / "train.jsonl")
    ph_va = load_jsonl(PHRASE_ALIGN_DIR / "val.jsonl")
    rng = random.Random(9123)

    _freeze_mix(
        MIX_PHRASE2,
        [(t3_tr, 64), (ph_tr, 96), (red_train, 64), (tt_tr, 32), (ft_tr, 16)],
        t3_va + ph_va + red_val + tt_va,
        name="WR-CORPUS-PLM-FT-TT-T3-PHRASE-RED",
        mix="T3A64 PH96 RED64 TT32 FT16",
        rng=rng,
    )
    _freeze_mix(
        MIX_PHRASE3,
        [(t3_tr, 48), (natp_train, 128), (tt_tr, 32), (ft_tr, 16)],
        t3_va + natp_val + tt_va,
        name="WR-CORPUS-PLM-FT-TT-T3-PHRASE-NATURAL",
        mix="T3A48 PHN128 TT32 FT16",
        rng=rng,
    )
    _freeze_mix(
        MIX_NAT2,
        [(t3_tr, 48), (ph_tr, 48), (nat2_train, 128), (tt_tr, 32), (ft_tr, 16)],
        t3_va + ph_va + nat2_val + tt_va,
        name="WR-CORPUS-PLM-FT-TT-T3-PHRASE-NAT2",
        mix="T3A48 PH48 NAT2128 TT32 FT16",
        rng=rng,
    )
    _freeze_mix(
        MIX_GEN,
        [(t3_tr, 32), (natp_train, 64), (nat2_train, 96), (tt_tr, 32), (ft_tr, 16)],
        t3_va + natp_val + nat2_val + tt_va,
        name="WR-CORPUS-PLM-FT-TT-T3-PHRASE-GEN",
        mix="T3A32 PHN64 NAT296 TT32 FT16",
        rng=rng,
    )
    _freeze_mix(
        MIX_CONS,
        [(tt_tr, 48), (t3_tr, 48), (ph_tr, 48), (nat2_train, 64), (ft_tr, 24)],
        tt_va + t3_va + ph_va + nat2_val,
        name="WR-CORPUS-PLM-FT-TT-T3-PHRASE-CONS",
        mix="TT48 T3A48 PH48 NAT264 FT24",
        rng=rng,
    )

    mix_prompts = set()
    for folder in (MIX_PHRASE2, MIX_PHRASE3, MIX_NAT2, MIX_GEN, MIX_CONS, MIX_PHRASE_ALIGN):
        mix_prompts.update(r["prompt"] for r in load_jsonl(folder / "train.jsonl"))
        mix_prompts.update(r["prompt"] for r in load_jsonl(folder / "val.jsonl"))
    gen2 = [r for r in GEN2_EVAL if r["prompt"] not in banned and r["prompt"] not in mix_prompts]
    if len(gen2) < 8:
        return {"ok": False, "reason": "gen2_overlap", "kept": len(gen2)}
    GEN2_DIR.mkdir(parents=True, exist_ok=True)
    _write_jsonl(GEN2_DIR / "val.jsonl", gen2)
    _write(
        GEN2_DIR / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-GENERALIZATION-EVAL-2",
            "TRAINING_FORBIDDEN": True,
            "VAL_EXAMPLE_COUNT": len(gen2),
            "val_sha256": _sha(GEN2_DIR / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    return {
        "ok": True,
        "GRADUATION_SUITE_MUTATED": False,
        "paths": {
            "phrase_red": str(PHRASE_RED_DIR),
            "phrase_natural": str(PHRASE_NATURAL_DIR),
            "nat2": str(NAT2_DIR),
            "mix_phrase2": str(MIX_PHRASE2),
            "mix_phrase3": str(MIX_PHRASE3),
            "mix_nat2": str(MIX_NAT2),
            "mix_gen": str(MIX_GEN),
            "mix_cons": str(MIX_CONS),
            "gen2": str(GEN2_DIR),
        },
    }


if __name__ == "__main__":
    print(json.dumps(freeze_final_curricula(), indent=2, default=str))
