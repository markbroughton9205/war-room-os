"""Freeze RA1 B32 phrase-to-natural bridge corpora. Never writes the graduation suite."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_arch_uh1_phase_a import load_jsonl
from wrim_hvu_identity import DATA_ROOT, TOKENIZER_EXPECTED_SHA
from wrim_ra1_final_corpus import _banned_prompts, _freeze_mix, _write_spec_dir
from wrim_ra1_grad_corpus import (
    GRAD_DIR,
    MIX_PHRASE_ALIGN,
    PHRASE_ALIGN_DIR,
    T3_ALIGN_DIR,
    _sha,
    _tok_len,
    _write_jsonl,
)

BRIDGE_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-PHRASE-NATURAL-BRIDGE-1-v1.0.0"
NAT_FULL_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-NATURAL-BRIDGE-1-v1.0.0"
GEN_BRIDGE_DIR = Path(DATA_ROOT) / "WR-CORPUS-PLM-NATURAL-BRIDGE-GEN-1-v1.0.0"
MIX_A = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-BRIDGE-A-v1.0.0"
MIX_B = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-BRIDGE-B-v1.0.0"
MIX_C = Path(DATA_ROOT) / "WR-CORPUS-PLM-FT-TT-T3-BRIDGE-C-v1.0.0"

# B: mastered 3-token stem + one new continuation token (2-5 tokens total).
# C: first two phrase tokens + two natural continuation tokens.
BRIDGE_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "stage": "B",
        "task": "refuse",
        "target": "no thank you then",
        "train": [
            "Decline once more, four words, ending with then.",
            "Four-word polite pass that finishes with then.",
            "Give the courteous refusal that ends in then.",
            "A second offer arrives. Four-word thanks-no ending then.",
            "Reply with the four-word decline whose last word is then.",
            "Short polite refusal, four words, last word then.",
            "Host offers again. Four-word courtesy ending then.",
            "Output a four-word no-thanks whose last token is then.",
        ],
        "val": [
            "Held-out four-word polite decline ending with then.",
            "Unseen wording: courteous four-word pass, last word then.",
        ],
    },
    {
        "cls": "dog",
        "stage": "B",
        "task": "place",
        "target": "dog house out there",
        "train": [
            "Point to the outdoor kennel in four words, ending there.",
            "Four-word kennel location whose last word is there.",
            "Where is that kennel from here? four words ending there.",
            "Name the outdoor dog shelter in four words, last word there.",
            "Give the four-word kennel phrase finishing with there.",
            "A yard kennel some distance off: four words ending there.",
            "Label the far kennel in four words, animal first, last there.",
            "Four-word outdoor kennel pointing word there.",
        ],
        "val": [
            "Held-out four-word kennel phrase ending with there.",
            "Unseen: outdoor dog shelter, four words, last word there.",
        ],
    },
    {
        "cls": "blue",
        "stage": "B",
        "task": "sky",
        "target": "blue sky up there",
        "train": [
            "Four-word overhead color note ending with there.",
            "Point at noon air in four words, last word there.",
            "Color-first sky phrase, four words, finishing there.",
            "Give the four-word high-sky label ending there.",
            "A clear vault overhead: four words, last there.",
            "Name the daytime vault in four words ending there.",
            "Four-word color-then-place sky, last word there.",
            "Reply with the four-word sky point ending there.",
        ],
        "val": [
            "Held-out four-word sky phrase ending with there.",
            "Unseen color-first overhead label, four words, last there.",
        ],
    },
    {
        "cls": "cat",
        "stage": "B",
        "task": "meal",
        "target": "cat food for him",
        "train": [
            "Four-word bowl note for a male house cat.",
            "What goes in his bowl? four words, animal first.",
            "Give the four-word ration line ending with him.",
            "Present meal for the tom, four words, last word him.",
            "Label his current feline dish in four words.",
            "Four-word cat ration assigned to him.",
            "A tom needs a four-word meal line ending him.",
            "Reply with four words: feline food meant for him.",
        ],
        "val": [
            "Held-out four-word tom-cat meal line ending him.",
            "Unseen: current ration for him, four words, animal first.",
        ],
    },
    {
        "cls": "red",
        "stage": "B",
        "task": "vehicle",
        "target": "red car out there",
        "train": [
            "Four-word color-first auto location ending there.",
            "Point at the scarlet vehicle in four words, last there.",
            "Where is that colored auto from here? four words ending there.",
            "Give the four-word car phrase finishing with there.",
            "A crimson vehicle some way off: four words, last there.",
            "Name the outdoor car in four words ending there.",
            "Color-first four-word vehicle point, last word there.",
            "Reply with the four-word far-lot car label ending there.",
        ],
        "val": [
            "Held-out four-word vehicle phrase ending with there.",
            "Unseen color-first auto location, four words, last there.",
        ],
    },
    {
        "cls": "dog",
        "stage": "C",
        "task": "place",
        "target": "dog house is there",
        "train": [
            "State that the kennel exists yonder, four words, animal first.",
            "Four-word kennel existence line ending there.",
            "Confirm the outdoor kennel location in four words.",
            "Give a four-word 'kennel is yonder' line, animal first.",
            "A backyard kennel: say it is yonder in four words.",
            "Four-word statement that the dog shelter is yonder.",
            "Reply that the kennel is yonder, four words, animal first.",
            "Name where the kennel is, four words ending there.",
        ],
        "val": [
            "Held-out four-word kennel-is-yonder line, animal first.",
            "Unseen: the shelter is yonder, four words, animal first.",
        ],
    },
    {
        "cls": "blue",
        "stage": "C",
        "task": "sky",
        "target": "blue sky is high",
        "train": [
            "Four-word claim that the daytime vault is high.",
            "State the overhead field is high, four words, color first.",
            "Give a four-word high-vault statement, color first.",
            "A cloudless vault: say it is high in four words.",
            "Four-word sky-height statement starting with color.",
            "Reply that the noon vault is high, four words.",
            "Color-first four-word height note for the sky.",
            "Name the high daytime vault in four words.",
        ],
        "val": [
            "Held-out four-word sky-is-high statement, color first.",
            "Unseen: overhead vault is high, four words, color first.",
        ],
    },
    {
        "cls": "cat",
        "stage": "C",
        "task": "meal",
        "target": "cat food is ready",
        "train": [
            "Four-word notice that the feline dish is prepared.",
            "Announce the bowl is prepared, four words, animal first.",
            "Give a four-word ready-meal line for the house cat.",
            "A filled bowl: say the meal is prepared in four words.",
            "Four-word feline-dish-ready statement, animal first.",
            "Reply that the cat ration is prepared, four words.",
            "Kitchen note: feline food prepared, four words.",
            "Name the prepared cat dish in four words.",
        ],
        "val": [
            "Held-out four-word cat-dish-ready line, animal first.",
            "Unseen: the feline ration is prepared, four words.",
        ],
    },
    {
        "cls": "red",
        "stage": "C",
        "task": "vehicle",
        "target": "red car is there",
        "train": [
            "Four-word claim that the colored auto is yonder.",
            "State the scarlet vehicle is yonder, four words, color first.",
            "Give a four-word car-is-yonder line, color first.",
            "A parked crimson auto: say it is yonder in four words.",
            "Four-word vehicle-presence statement starting with color.",
            "Reply that the colored car is yonder, four words.",
            "Color-first four-word location for the auto.",
            "Name that the outdoor car is yonder in four words.",
        ],
        "val": [
            "Held-out four-word car-is-yonder line, color first.",
            "Unseen: the colored auto is yonder, four words.",
        ],
    },
    {
        "cls": "no",
        "stage": "C",
        "task": "refuse",
        "target": "no thank you now",
        "train": [
            "Decline at this moment in four words ending now.",
            "Four-word polite pass whose last word is now.",
            "Give the present-tense courtesy refusal ending now.",
            "A waiter asks again. Four-word thanks-no ending now.",
            "Short courteous refusal, four words, last word now.",
            "Reply with four-word decline finishing now.",
            "Present offer: four-word polite no ending now.",
            "Output the four-word thanks-no whose last token is now.",
        ],
        "val": [
            "Held-out four-word present decline ending with now.",
            "Unseen: polite four-word pass, last word now.",
        ],
    },
]

# D: 3-token fragments. E: 3-5 token complete short natural answers.
NATURAL_SPECS: list[dict[str, Any]] = [
    {
        "cls": "no",
        "stage": "D",
        "task": "refuse",
        "target": "no not yet",
        "train": [
            "Delay the extra serving in three short words.",
            "Three-word postpone of more tea.",
            "Not this moment: three-word delay.",
            "A second cup is early. Three-word not-yet.",
            "Give a three-word later-not-now refusal.",
            "Brief delay, three words, starting with no.",
            "The dessert can wait. Three-word postpone.",
            "Reply with a three-word not-yet decline.",
        ],
        "val": [
            "Held-out three-word postpone starting with no.",
            "Unseen: extra toast can wait, three words.",
        ],
    },
    {
        "cls": "no",
        "stage": "E",
        "task": "fact",
        "target": "no it is not",
        "train": [
            "Is a pebble a kind of bird? four-word no-it sentence.",
            "Does a cloud usually bark? four-word no-it sentence.",
            "Is a spoon a type of tree? four-word no-it sentence.",
            "Can a hill typically fly? four-word no-it sentence.",
            "Is silence a trumpet? four-word no-it sentence.",
            "Does a lamp usually swim? four-word no-it sentence.",
            "Is 8 smaller than 2? four-word no-it sentence.",
            "Are you a toaster? four-word no-it sentence.",
        ],
        "val": [
            "Is a river a kind of desert? four-word no-it sentence.",
            "Does a chair usually sing? four-word no-it sentence.",
        ],
    },
    {
        "cls": "no",
        "stage": "E",
        "task": "refuse",
        "target": "no that is fine",
        "train": [
            "Decline more help with a four-word that-is-fine line.",
            "Someone offers extra aid. Four-word courteous enough.",
            "Pass on more service using four words starting no.",
            "A clerk asks to redo it. Four-word that-is-fine no.",
            "Give a four-word enough-already courtesy starting no.",
            "No further change needed: four-word that-is-fine.",
            "Host offers to fetch more. Four-word that-is-fine no.",
            "Reply that the current amount is enough, four words.",
        ],
        "val": [
            "Held-out four-word enough-already line starting no.",
            "Unseen: extra help is unnecessary, four words starting no.",
        ],
    },
    {
        "cls": "dog",
        "stage": "D",
        "task": "number",
        "target": "dog has four",
        "train": [
            "Typical canine leg count, three words, animal first.",
            "How many legs on a usual dog? three words.",
            "Three-word limb count for a common dog.",
            "A house dog's legs: three-word count, animal first.",
            "Give the three-word canine leg number.",
            "Usual dog limb total in three words.",
            "Count a typical dog's legs, three words, animal first.",
            "Reply with three words: canine, verb, four.",
        ],
        "val": [
            "Held-out three-word typical-dog leg count.",
            "Unseen: ordinary canine limbs, three words, animal first.",
        ],
    },
    {
        "cls": "dog",
        "stage": "E",
        "task": "definition",
        "target": "dog is a pet",
        "train": [
            "Define a barking house animal in four words.",
            "Four-word definition of a common canine companion.",
            "What kind of companion is a dog? four words.",
            "Give a four-word pet-class line, animal first.",
            "A leash companion that barks: four-word definition.",
            "Classify the barking house animal in four words.",
            "Four-word household-companion definition starting dog.",
            "Reply with a four-word pet definition, animal first.",
        ],
        "val": [
            "Held-out four-word barking-companion definition.",
            "Unseen: classify the canine house animal in four words.",
        ],
    },
    {
        "cls": "dog",
        "stage": "E",
        "task": "place",
        "target": "dog lives out back",
        "train": [
            "Where does the yard canine stay? four words.",
            "Four-word outdoor dwelling line, animal first.",
            "Give the four-word backyard-living note for a dog.",
            "A kennel animal behind the home: four-word stay line.",
            "Four-word place where the barking pet stays.",
            "State the rear-yard dwelling in four words, animal first.",
            "Reply with four words: dog dwelling behind the house.",
            "Name the outdoor stay of the house dog in four words.",
        ],
        "val": [
            "Held-out four-word backyard-stay line, animal first.",
            "Unseen: where the yard dog stays, four words.",
        ],
    },
    {
        "cls": "blue",
        "stage": "D",
        "task": "sky",
        "target": "blue sky today",
        "train": [
            "Three-word fair-weather overhead note, color first.",
            "Give today's vault color in three words.",
            "A clear morning: three-word sky note, color first.",
            "Three-word present-day sky label starting with color.",
            "Name this morning's vault in three words.",
            "Weather line: three words, color then sky then today.",
            "Reply with a three-word current-sky color note.",
            "Short present-sky caption, three words, color first.",
        ],
        "val": [
            "Held-out three-word current-sky caption, color first.",
            "Unseen: this day's overhead color, three words.",
        ],
    },
    {
        "cls": "blue",
        "stage": "E",
        "task": "label",
        "target": "blue means sky",
        "train": [
            "Three-word color-to-vault association.",
            "What does that color usually mark overhead? three words.",
            "Give a three-word color-means-vault line.",
            "Associate the clear-day color with the vault, three words.",
            "Three-word mapping from that color to the overhead field.",
            "Reply with the three-word color-means-sky note.",
            "A crayon labeled for noon air: three-word meaning.",
            "Short color definition ending sky, three words.",
        ],
        "val": [
            "Held-out three-word color-means-vault line.",
            "Unseen: that daytime color names the vault, three words.",
        ],
    },
    {
        "cls": "cat",
        "stage": "D",
        "task": "label",
        "target": "cat not dog",
        "train": [
            "Three-word contrast: the meower, not the barker.",
            "Pick the feline against the canine in three words.",
            "Three-word animal contrast starting with the meower.",
            "A litter-box pet versus a barker: three words.",
            "Give the three-word meower-not-barker label.",
            "Reply with three words: feline, not, canine.",
            "Which house pet meows rather than barks? three words.",
            "Short contrast line, three words, meower first.",
        ],
        "val": [
            "Held-out three-word meower-versus-barker contrast.",
            "Unseen: the purring pet, not the barker, three words.",
        ],
    },
    {
        "cls": "cat",
        "stage": "E",
        "task": "definition",
        "target": "cat is a pet",
        "train": [
            "Define a purring house animal in four words.",
            "Four-word definition of a common feline companion.",
            "What kind of companion is a cat? four words.",
            "Give a four-word pet-class line starting with cat.",
            "A litter-box companion that meows: four-word definition.",
            "Classify the purring house animal in four words.",
            "Four-word household-companion definition starting cat.",
            "Reply with a four-word pet definition, feline first.",
        ],
        "val": [
            "Held-out four-word purring-companion definition.",
            "Unseen: classify the feline house animal in four words.",
        ],
    },
    {
        "cls": "red",
        "stage": "D",
        "task": "number",
        "target": "red has four",
        "train": [
            "A typical car of that color: wheel count in three words.",
            "Three-word wheel total for a usual colored auto, color first.",
            "How many wheels on a usual car? three words, color first.",
            "Give the three-word colored-auto wheel count.",
            "Ordinary automobile wheels, three words starting with color.",
            "Reply with three words: color, verb, four.",
            "Count wheels on a typical colored car, three words.",
            "Short wheel-count line, three words, color first.",
        ],
        "val": [
            "Held-out three-word colored-car wheel count.",
            "Unseen: usual auto wheels, three words, color first.",
        ],
    },
    {
        "cls": "red",
        "stage": "E",
        "task": "label",
        "target": "red means stop",
        "train": [
            "Three-word traffic-color meaning.",
            "What does a typical brake-light color mean? three words.",
            "Give a three-word color-means-halt line.",
            "Associate that emergency color with halt, three words.",
            "Three-word mapping from that color to halt.",
            "Reply with the three-word color-means-stop note.",
            "A signal lamp of that color: three-word meaning.",
            "Short color definition ending stop, three words.",
        ],
        "val": [
            "Held-out three-word color-means-halt line.",
            "Unseen: that signal color names halt, three words.",
        ],
    },
    {
        "cls": "no",
        "stage": "E",
        "task": "instruction",
        "target": "no do not go",
        "train": [
            "Forbid leaving in four short words starting no.",
            "Four-word stay-put command beginning with no.",
            "Someone starts for the door. Four-word do-not-go.",
            "Give a four-word prohibition against leaving.",
            "A child steps outside. Four-word do-not-go line.",
            "Reply with four words forbidding departure.",
            "Guard instruction: four-word do-not-go starting no.",
            "Short stay command, four words, first word no.",
        ],
        "val": [
            "Held-out four-word do-not-leave command starting no.",
            "Unseen: forbid walking away, four words starting no.",
        ],
    },
]

GEN_BRIDGE_EVAL: list[dict[str, Any]] = [
    {"example_id": "nbg-000", "family": "nbg_fact", "first_token_class": "no", "task": "fact", "target": "no it is not", "prompt": "Changed order. A pebble: is that a bird? answer with four words starting no."},
    {"example_id": "nbg-001", "family": "nbg_refuse", "first_token_class": "no", "task": "refuse", "target": "no that is fine", "prompt": "Paraphrase. Extra editing is offered; four-word enough line starting no."},
    {"example_id": "nbg-002", "family": "nbg_def_dog", "first_token_class": "dog", "task": "definition", "target": "dog is a pet", "prompt": "Fresh wording. Household barker class, four words, animal first."},
    {"example_id": "nbg-003", "family": "nbg_place_dog", "first_token_class": "dog", "task": "place", "target": "dog lives out back", "prompt": "Word order change. Behind the home the barker stays; four words."},
    {"example_id": "nbg-004", "family": "nbg_sky", "first_token_class": "blue", "task": "label", "target": "blue means sky", "prompt": "Unseen length. After a pause, three-word color-to-vault map."},
    {"example_id": "nbg-005", "family": "nbg_def_cat", "first_token_class": "cat", "task": "definition", "target": "cat is a pet", "prompt": "Quiet kitchen. Four-word class for the purring house animal."},
    {"example_id": "nbg-006", "family": "nbg_num_red", "first_token_class": "red", "task": "number", "target": "red has four", "prompt": "Small variation. Typical colored-auto wheels, three words, color first."},
    {"example_id": "nbg-007", "family": "nbg_stop", "first_token_class": "red", "task": "label", "target": "red means stop", "prompt": "Different context. Signal-lamp color meaning, three words."},
    {"example_id": "nbg-008", "family": "nbg_instr", "first_token_class": "no", "task": "instruction", "target": "no do not go", "prompt": "New surface. Doorway: forbid leaving in four words starting no."},
    {"example_id": "nbg-009", "family": "nbg_num_dog", "first_token_class": "dog", "task": "number", "target": "dog has four", "prompt": "Unseen prompt. Ordinary canine legs, three words, animal first."},
]


def _stamp_spec_meta(rows: list[dict[str, Any]], specs: list[dict[str, Any]], prefix: str) -> None:
    by = {s["target"]: s for s in specs}
    for rec in rows:
        spec = by.get(rec["target"])
        if not spec:
            continue
        rec["task"] = spec.get("task")
        rec["stage"] = spec.get("stage")
        rec["family"] = f"{prefix}_{spec['cls']}_{spec.get('task') or spec['cls']}"


def _rewrite_split(dest: Path, train: list[dict[str, Any]], val: list[dict[str, Any]], corpus_id: str) -> None:
    _write_jsonl(dest / "train.jsonl", train)
    _write_jsonl(dest / "val.jsonl", val)
    man_path = dest / "manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.is_file() else {"corpus_id": corpus_id}
    man["TRAIN_EXAMPLE_COUNT"] = len(train)
    man["VAL_EXAMPLE_COUNT"] = len(val)
    man["train_sha256"] = _sha(dest / "train.jsonl")
    man["val_sha256"] = _sha(dest / "val.jsonl")
    _write(man_path, man)


def _gold_prefix_rows(rows: list[dict[str, Any]], tokenizer) -> list[dict[str, Any]]:
    out = []
    n = 0
    for rec in rows:
        n_tok = _tok_len(tokenizer, rec["target"])
        for index in range(1, n_tok):
            row = dict(rec)
            row["example_id"] = f"gpx-{n:04d}"
            row["supervise_from_target_index"] = index
            row["family"] = f"gpx_{rec.get('first_token_class')}_{index}"
            row["provenance"] = "first-party-war-room-os-internal-gold-prefix-natural"
            out.append(row)
            n += 1
    return out


def freeze_bridge_curricula() -> dict[str, Any]:
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file

    if MIX_C.joinpath("train.jsonl").is_file() and NAT_FULL_DIR.joinpath("train.jsonl").is_file():
        return {
            "ok": True,
            "already_frozen": True,
            "GRADUATION_SUITE_MUTATED": False,
            "paths": {
                "bridge": str(BRIDGE_DIR),
                "natural": str(NAT_FULL_DIR),
                "gen": str(GEN_BRIDGE_DIR),
                "mix_a": str(MIX_A),
                "mix_b": str(MIX_B),
                "mix_c": str(MIX_C),
            },
        }
    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing"}
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return {"ok": False, "reason": "tokenizer_hash_mismatch"}
    tokenizer = Tokenizer.from_file(str(tok_path))
    if GRAD_DIR.is_dir() and any(p.name.endswith("train.jsonl") for p in GRAD_DIR.iterdir()):
        return {"ok": False, "reason": "graduation_suite_must_not_be_a_train_source"}

    br_train, br_val = _write_spec_dir(
        BRIDGE_DIR,
        BRIDGE_SPECS,
        family="br",
        provenance="first-party-war-room-os-internal-phrase-natural-bridge",
        corpus_id="WR-CORPUS-PLM-PHRASE-NATURAL-BRIDGE-1",
        tokenizer=tokenizer,
        min_len=2,
        max_len=5,
        extra={"STAGES": ["B", "C"]},
    )
    nat_train, nat_val = _write_spec_dir(
        NAT_FULL_DIR,
        NATURAL_SPECS,
        family="ntb",
        provenance="first-party-war-room-os-internal-short-natural-bridge",
        corpus_id="WR-CORPUS-PLM-SHORT-NATURAL-BRIDGE-1",
        tokenizer=tokenizer,
        min_len=2,
        max_len=5,
        extra={"STAGES": ["D", "E"]},
    )
    _stamp_spec_meta(br_train, BRIDGE_SPECS, "br")
    _stamp_spec_meta(br_val, BRIDGE_SPECS, "br")
    _stamp_spec_meta(nat_train, NATURAL_SPECS, "ntb")
    _stamp_spec_meta(nat_val, NATURAL_SPECS, "ntb")
    _rewrite_split(BRIDGE_DIR, br_train, br_val, "WR-CORPUS-PLM-PHRASE-NATURAL-BRIDGE-1")
    _rewrite_split(NAT_FULL_DIR, nat_train, nat_val, "WR-CORPUS-PLM-SHORT-NATURAL-BRIDGE-1")
    banned = _banned_prompts()
    for folder in (
        "WR-CORPUS-PLM-SHORT-PHRASE-RED-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-PHRASE-NATURAL-1-v1.0.0",
        "WR-CORPUS-PLM-SHORT-NATURAL-ALIGN-2-v1.0.0",
        "WR-CORPUS-PLM-GENERALIZATION-EVAL-2-v1.0.0",
        "WR-CORPUS-PLM-FT-TT-T3-PHRASE-NAT2-v1.0.0",
        "WR-CORPUS-PLM-FT-TT-T3-PHRASE-GEN-v1.0.0",
        "WR-CORPUS-PLM-FT-TT-T3-PHRASE-CONS-v1.0.0",
    ):
        root = Path(DATA_ROOT) / folder
        if not root.is_dir():
            continue
        for path in root.iterdir():
            if path.suffix == ".jsonl":
                banned.update(str(r.get("prompt")) for r in load_jsonl(path) if r.get("prompt"))
    for rows, label in ((br_train, "bridge"), (nat_train, "natural")):
        hit = [r["prompt"] for r in rows if r["prompt"] in banned]
        if hit:
            return {"ok": False, "reason": f"train_prompt_leakage_{label}", "n": len(hit), "sample": hit[:5]}

    gold = _gold_prefix_rows(nat_train, tokenizer)
    if not gold:
        return {"ok": False, "reason": "gold_prefix_empty"}

    ft_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_tr = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "train.jsonl")
    tt_va = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    t3_tr = load_jsonl(T3_ALIGN_DIR / "train.jsonl")
    t3_va = load_jsonl(T3_ALIGN_DIR / "val.jsonl")
    ph_tr = load_jsonl(PHRASE_ALIGN_DIR / "train.jsonl")
    ph_va = load_jsonl(PHRASE_ALIGN_DIR / "val.jsonl")
    rng = random.Random(9341)
    val_all = t3_va + ph_va + tt_va + br_val + nat_val

    _freeze_mix(
        MIX_A,
        [(ph_tr, 64), (t3_tr, 24), (tt_tr, 24), (br_train, 56), (gold, 28), (nat_train, 84), (ft_tr, 8)],
        val_all,
        name="WR-CORPUS-PLM-FT-TT-T3-BRIDGE-A",
        mix="PH40 BR30 NAT30",
        rng=rng,
    )
    _freeze_mix(
        MIX_B,
        [(ph_tr, 48), (t3_tr, 18), (tt_tr, 18), (br_train, 72), (gold, 40), (nat_train, 84), (ft_tr, 8)],
        val_all,
        name="WR-CORPUS-PLM-FT-TT-T3-BRIDGE-B",
        mix="PH30 BR40 NAT30",
        rng=rng,
    )
    _freeze_mix(
        MIX_C,
        [(ph_tr, 40), (t3_tr, 16), (tt_tr, 14), (br_train, 56), (gold, 42), (nat_train, 112), (ft_tr, 8)],
        val_all,
        name="WR-CORPUS-PLM-FT-TT-T3-BRIDGE-C",
        mix="PH25 BR35 NAT40",
        rng=rng,
    )

    mix_prompts = set()
    for folder in (MIX_A, MIX_B, MIX_C, MIX_PHRASE_ALIGN, BRIDGE_DIR, NAT_FULL_DIR):
        mix_prompts.update(r["prompt"] for r in load_jsonl(folder / "train.jsonl"))
        if (folder / "val.jsonl").is_file():
            mix_prompts.update(r["prompt"] for r in load_jsonl(folder / "val.jsonl"))
    gen = [r for r in GEN_BRIDGE_EVAL if r["prompt"] not in banned and r["prompt"] not in mix_prompts]
    if len(gen) < 8:
        return {"ok": False, "reason": "gen_bridge_overlap", "kept": len(gen)}
    GEN_BRIDGE_DIR.mkdir(parents=True, exist_ok=True)
    _write_jsonl(GEN_BRIDGE_DIR / "val.jsonl", gen)
    _write(
        GEN_BRIDGE_DIR / "manifest.json",
        {
            "corpus_id": "WR-CORPUS-PLM-NATURAL-BRIDGE-GEN-1",
            "TRAINING_FORBIDDEN": True,
            "VAL_EXAMPLE_COUNT": len(gen),
            "val_sha256": _sha(GEN_BRIDGE_DIR / "val.jsonl"),
            "GRADUATION_SUITE_MUTATED": False,
        },
    )
    return {
        "ok": True,
        "GRADUATION_SUITE_MUTATED": False,
        "GOLD_PREFIX_TRAIN": len(gold),
        "paths": {
            "bridge": str(BRIDGE_DIR),
            "natural": str(NAT_FULL_DIR),
            "gen": str(GEN_BRIDGE_DIR),
            "mix_a": str(MIX_A),
            "mix_b": str(MIX_B),
            "mix_c": str(MIX_C),
        },
    }


if __name__ == "__main__":
    print(json.dumps(freeze_bridge_curricula(), indent=2, default=str))
