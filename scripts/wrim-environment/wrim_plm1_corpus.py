"""Build and freeze WR-CORPUS-PLM-PROBE-1-v1.0.0. Does not train."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from wrim_plm1_identity import CORPUS_DIRNAME, CORPUS_ID, CORPUS_VERSION, DATA_ROOT

HERE = Path(__file__).resolve().parent


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _sha256_file(p: Path) -> str:
    return _sha256_bytes(p.read_bytes())


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def probe_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    def add(family: str, prompt: str, target: str) -> None:
        items.append(
            {
                "example_id": f"plm-{len(items):04d}",
                "family": family,
                "prompt": prompt,
                "target": target,
                "provenance": "first-party-war-room-os-internal",
            }
        )

    wrim = [
        ("Name the human operator title used in War Room OS.", "Commander"),
        ("What remaining canonical WRIM checkpoint name is still in force?", "STEP_400"),
        ("Name the WRIM Genesis model family in one token-like label.", "WRIM"),
        ("What tokenizer id is frozen for WRIM Genesis?", "WR-TOKENIZER-0"),
        ("Reply with the Council local runtime name.", "NOVA"),
        ("Is Kimi installed as a War Room capability? yes or no.", "no"),
        ("Name the human who commands War Room OS.", "Mark"),
        ("What architecture option label does WRIM-G-20M use?", "option-A"),
        ("How many attention heads does WRIM-G-20M use? digits only.", "4"),
        ("What hidden size does WRIM-G-20M use? digits only.", "256"),
        ("What context length does WRIM-G-20M use? digits only.", "512"),
        ("Is the WRIM output head tied to embeddings? yes or no.", "yes"),
        ("Name the current prefix-LM probe run id.", "WRIM1-PLM-000001"),
        ("Should STEP_400 be replaced by this probe? yes or no.", "no"),
        ("Is CPT-000006 authorized in this probe? yes or no.", "no"),
        ("Is Stage 3B authorized in this probe? yes or no.", "no"),
        ("Name the experimental parent checkpoint used for this probe.", "step-75"),
        ("Which CPT run produced the parent weights?", "WRIM1-CPT-000005"),
        ("What objective family is this probe using?", "prefix-LM"),
        ("Are new role tokens allowed in this probe? yes or no.", "no"),
        ("Must the tokenizer stay frozen? yes or no.", "yes"),
        ("Reply with the frozen commander special token name.", "commander"),
        ("Reply with the frozen assistant special token name.", "assistant"),
        ("Does this probe promote a successor WRIM? yes or no.", "no"),
    ]
    for p, t in wrim:
        add("wrim_internal", p, t)

    for n in (
        3, 8, 11, 14, 17, 19, 21, 23, 26, 28, 31, 33, 36, 38, 41, 44, 47, 49, 52, 53,
        56, 58, 61, 63, 66, 67, 69, 71, 73, 76, 78, 81, 83, 86, 88, 91, 93, 96, 97, 99,
    ):
        add("integer", f"Reply with the integer {n} and nothing else.", str(n))

    colors = [
        "crimson", "indigo", "amber", "teal", "violet", "maroon", "ivory", "azure",
        "scarlet", "cobalt", "ochre", "saffron", "mauve", "chartreuse", "ultramarine",
        "vermilion", "celadon", "sepia", "periwinkle", "burgundy", "turquoise", "magenta",
        "cyan", "gold",
    ]
    for c in colors:
        add("color_stop", f"Print the color {c} once, then stop.", c)

    yn = [
        ("Is 9 greater than 4? yes or no.", "yes"),
        ("Is 2 greater than 9? yes or no.", "no"),
        ("Does a square have four sides? yes or no.", "yes"),
        ("Does a triangle have eight sides? yes or no.", "no"),
        ("Is ice colder than steam in ordinary speech? yes or no.", "yes"),
        ("Is the sun a planet? yes or no.", "no"),
        ("Is WRIM a 20 million parameter class model? yes or no.", "yes"),
        ("Should this probe spend money? yes or no.", "no"),
        ("Is commit authorized for this probe? yes or no.", "no"),
        ("Is deploy authorized for this probe? yes or no.", "no"),
        ("Must prompt tokens be masked? yes or no.", "yes"),
        ("Must target tokens be supervised? yes or no.", "yes"),
        ("Must EOS be supervised? yes or no.", "yes"),
        ("Is a fresh 10-step warmup required? yes or no.", "no"),
        ("Is more same-mix CPT authorized here? yes or no.", "no"),
        ("Is Ra'el promotion authorized? yes or no.", "no"),
        ("Does 7 plus 1 equal 8? yes or no.", "yes"),
        ("Does 7 plus 1 equal 9? yes or no.", "no"),
        ("Is Monday before Tuesday? yes or no.", "yes"),
        ("Is December before January in the same year? yes or no.", "no"),
    ]
    for p, t in yn:
        add("yes_no", p, t)

    iso = [
        ("Japan", "JP"), ("Kenya", "KE"), ("Peru", "PE"), ("Chile", "CL"),
        ("Ghana", "GH"), ("Nepal", "NP"), ("Qatar", "QA"), ("Malta", "MT"),
        ("Tonga", "TO"), ("Palau", "PW"), ("Fiji", "FJ"), ("Bhutan", "BT"),
        ("Laos", "LA"), ("Oman", "OM"), ("Togo", "TG"), ("Benin", "BJ"),
    ]
    for name, code in iso:
        add("iso_code", f"Return only the ISO alpha-2 code for {name}.", code)

    pairs = [
        ("willow", "birch"), ("onyx", "flint"), ("rye", "oats"), ("plover", "snipe"),
        ("anvil", "forge"), ("keel", "rudder"), ("lumen", "lux"), ("zinc", "tin"),
        ("basil", "sage"), ("quartz", "mica"), ("sable", "ermine"), ("port", "starboard"),
        ("north", "east"), ("larch", "spruce"), ("prime", "scalar"), ("ridge", "vale"),
        ("ember", "cinder"), ("harrow", "plow"), ("lute", "harp"), ("ketch", "yawl"),
    ]
    for a, b in pairs:
        add("first_of_list", f"Which comes first in this list: {a}, {b}?", a)

    for i in range(1, 25):
        tag = f"wrim-plm-tag-{i:04d}"
        add("tag_echo", f"Echo this tag once and stop: {tag}", tag)

    halt = [
        "harbor", "ledger", "cipher", "mantle", "hearth", "spire", "grove", "quill",
        "anvil", "cask", "relay", "signal", "anchor", "vector", "matrix", "kernel",
        "packet", "socket", "buffer", "cursor",
    ]
    for w in halt:
        add("halt_word", f"Output the word {w} once then halt.", w)

    # unique ids already assigned sequentially
    return items


def split_items(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    val_n = 48
    val = items[-val_n:]
    train = items[:-val_n]
    return train, val


def load_forbidden_strings() -> list[str]:
    texts: list[str] = []
    fe = Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/WRIM-FOUNDATION-EVAL-1-v1.0.0/WRIM-FOUNDATION-EVAL-1-v1.0.0.json")
    if fe.is_file():
        obj = json.loads(fe.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            for k in ("prompt", "target"):
                if it.get(k):
                    texts.append(str(it[k]))
    s3 = HERE / "evals" / "WRIM-EVAL-S3-000001.json"
    if s3.is_file():
        obj = json.loads(s3.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            if it.get("prompt_text"):
                texts.append(str(it["prompt_text"]))
            payload = it.get("reference_payload") or {}
            for v in payload.values():
                if isinstance(v, str):
                    texts.append(v)
                elif isinstance(v, list):
                    texts.extend(str(x) for x in v if isinstance(x, str))
    addendum = Path(DATA_ROOT) / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json"
    if addendum.is_file():
        obj = json.loads(addendum.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            if it.get("prompt_text"):
                texts.append(str(it["prompt_text"]))
    return texts


def leakage_scan(train: list[dict[str, Any]], val: list[dict[str, Any]]) -> dict[str, Any]:
    forbidden = [_norm(t) for t in load_forbidden_strings() if str(t).strip()]
    forb_set = set(forbidden)
    hits = []
    train_pt = {(_norm(r["prompt"]), _norm(r["target"])) for r in train}
    overlap = []
    for r in val:
        key = (_norm(r["prompt"]), _norm(r["target"]))
        if key in train_pt:
            overlap.append(r["example_id"])
    for split, rows in (("train", train), ("val", val)):
        for r in rows:
            pn = _norm(r["prompt"])
            tn = _norm(r["target"])
            # Exact prompt copy of an eval prompt (ignore short yes/no style answers).
            if pn in forb_set and len(pn) >= 8:
                hits.append({"split": split, "id": r["example_id"], "field": "prompt", "text": r["prompt"]})
            elif any(pn and len(pn) >= 12 and pn in f for f in forb_set):
                hits.append({"split": split, "id": r["example_id"], "field": "prompt_substr", "text": r["prompt"]})
            if tn in forb_set and len(tn) >= 4:
                hits.append({"split": split, "id": r["example_id"], "field": "target_exact", "text": r["target"]})
            elif any(tn and len(tn) >= 12 and tn in f for f in forb_set):
                hits.append({"split": split, "id": r["example_id"], "field": "target_substr", "text": r["target"]})
    # exact target collision with known eval targets
    eval_targets = set()
    fe = Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/WRIM-FOUNDATION-EVAL-1-v1.0.0/WRIM-FOUNDATION-EVAL-1-v1.0.0.json")
    if fe.is_file():
        obj = json.loads(fe.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            if it.get("target"):
                eval_targets.add(_norm(str(it["target"])))
    target_hits = [
        r["example_id"]
        for r in train + val
        if _norm(r["target"]) in eval_targets and len(_norm(r["target"])) >= 4
    ]
    dup_train = []
    seen = set()
    for r in train:
        k = (_norm(r["prompt"]), _norm(r["target"]))
        if k in seen:
            dup_train.append(r["example_id"])
        seen.add(k)
    ok = not hits and not overlap and not target_hits and not dup_train
    return {
        "ok": ok,
        "LEAKAGE_SCAN": "PASS" if ok else "FAIL",
        "eval_hits": hits,
        "train_val_overlap": overlap,
        "foundation_target_hits": target_hits,
        "duplicate_train": dup_train,
        "n_forbidden_strings": len(forb_set),
    }


def dump_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def freeze_corpus(root: Path | None = None) -> dict[str, Any]:
    root = Path(root or Path(DATA_ROOT) / CORPUS_DIRNAME)
    root.mkdir(parents=True, exist_ok=True)
    items = probe_items()
    train, val = split_items(items)
    leak = leakage_scan(train, val)
    if not leak["ok"]:
        return {"ok": False, "reason": "LEAKAGE_SCAN_FAIL", "leakage": leak}
    train_p = root / "train.jsonl"
    val_p = root / "val.jsonl"
    dump_jsonl(train_p, train)
    dump_jsonl(val_p, val)
    train_hash = _sha256_file(train_p)
    val_hash = _sha256_file(val_p)
    manifest = {
        "corpus_id": CORPUS_ID,
        "corpus_version": CORPUS_VERSION,
        "TRAIN_EXAMPLE_COUNT": len(train),
        "VAL_EXAMPLE_COUNT": len(val),
        "train_file": "train.jsonl",
        "val_file": "val.jsonl",
        "train_sha256": train_hash,
        "val_sha256": val_hash,
        "PROVENANCE": "first-party War Room OS / WRIM Genesis internal items. No third-party scrape.",
        "CPT2_MUTATED": False,
    }
    man_blob = json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    manifest_hash = _sha256_bytes(man_blob)
    manifest["manifest_sha256"] = manifest_hash
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    corpus_hash = _sha256_bytes((train_hash + val_hash + manifest_hash).encode("ascii"))
    (root / "CORPUS_HASH.txt").write_text(corpus_hash + "\n", encoding="utf-8")
    return {
        "ok": True,
        "root": str(root),
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_HASH": corpus_hash,
        "MANIFEST_HASH": manifest_hash,
        "TRAIN_HASH": train_hash,
        "VAL_HASH": val_hash,
        "TRAIN_EXAMPLES": len(train),
        "VAL_EXAMPLES": len(val),
        "LEAKAGE_SCAN": "PASS",
        "leakage": leak,
        "manifest": manifest,
    }


if __name__ == "__main__":
    print(json.dumps(freeze_corpus(), indent=2))
