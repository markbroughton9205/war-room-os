"""Read-only natural-position diagnostic. No optimizer."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import EOS_ID
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_bridge_corpus import GEN_BRIDGE_DIR, NAT_FULL_DIR
from wrim_ra1_final_corpus import NAT2_DIR
from wrim_ra1_phrase_diagnostic import _pos_stats, document_parity
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-CR-000006" / "step-21"
EXPECT = "a1e6de9965f93134261fa6586aa5629233eafbf426a6802cb67dc85788cfc9ec"
OUT = Path(DATA_ROOT) / "WRIM_RA1_B32_NATURAL_POSITION_DIAGNOSTIC.json"
WORKING = {"blue", "cat", "dog", "no", "red", "Ġblue", "Ġcat", "Ġdog", "Ġno", "Ġred"}


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _mean(rows: list[dict[str, Any]], key: str) -> float | None:
    vals = [float(r[key]) for r in rows if r.get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def classify_failure(first_wrong: dict[str, Any] | None, *, depth: int, n_tgt: int, eos: bool, greedy: str, gold: str) -> str:
    if first_wrong is None:
        return "NONE"
    pos = int(first_wrong["position"])
    greedy_tok = str(first_wrong.get("greedy_token") or "")
    if greedy_tok in {"</s>", "<|eos|>"} or int(first_wrong.get("top1_id") or -1) == EOS_ID:
        return "EOS_PREMATURE_STOP"
    if pos == 1:
        return "ENTRY_TRANSFER_FAILURE"
    if pos == 2:
        return "TOKEN2_TRANSFER_FAILURE"
    if pos == 3:
        return "TOKEN3_TRANSFER_FAILURE"
    if pos >= 4:
        return "LATE_CONTINUATION_FAILURE"
    g_low = greedy_tok.replace("Ġ", "")
    if g_low in {"blue", "cat", "dog", "no", "red"} and g_low not in gold:
        return "WRONG_SEMANTIC_ATTRACTOR"
    if not first_wrong.get("span") or float(first_wrong.get("ra1_residual_contribution_norm") or 0) < 1e-6:
        return "NATURAL_SEQUENCE_GEOMETRY_FAILURE"
    return "TOKEN2_TRANSFER_FAILURE" if pos == 2 else "LATE_CONTINUATION_FAILURE"


def diagnose_rows(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rows: list[dict[str, Any]], label: str) -> dict[str, Any]:
    examples = []
    families: dict[str, dict[str, Any]] = {}
    classes = Counter()
    depths = []
    oracle_ok = {2: 0, 3: 0, 4: 0}
    oracle_n = {2: 0, 3: 0, 4: 0}
    for rec in rows:
        enc = encode_example(tok, rec)
        tgt = [int(x) for x in enc["target_ids"]]
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        gen = greedy_from_ids(model, tok, device, prefix, max_new=12)
        new = list(gen.get("new_ids") or [])
        eos = bool(gen.get("eos"))
        body = new[:-1] if eos else new
        depth = 0
        for a, b in zip(body, tgt):
            if a != b:
                break
            depth += 1
        depths.append(depth)
        positions = []
        for k, gold in enumerate(tgt, start=1):
            ctx = prefix + tgt[: k - 1]
            stats = _pos_stats(model, device, ctx, gold)
            stats["position"] = k
            stats["gold_id"] = gold
            stats["gold_token"] = tok.id_to_token(gold)
            stats["greedy_token"] = tok.id_to_token(stats["top1_id"])
            stats["gold_match"] = int(stats["top1_id"] == gold)
            stats["prefix_depth"] = k - 1
            positions.append(stats)
        first_wrong = next((p for p in positions if not p["gold_match"]), None)
        fail = classify_failure(
            first_wrong,
            depth=depth,
            n_tgt=len(tgt),
            eos=eos,
            greedy=" ".join(tok.id_to_token(i) for i in body[:6]),
            gold=str(rec.get("target") or ""),
        )
        classes[fail] += 1
        oracle = {}
        for k in range(1, len(tgt) + 1):
            ctx = prefix + tgt[: k - 1]
            with torch.inference_mode():
                nxt = int(model(torch.tensor([ctx], dtype=torch.long, device=device))[0, -1].argmax().item())
            hit = int(nxt == tgt[k - 1])
            oracle[f"gold_prefix_{k - 1}"] = {
                "next_gold": tok.id_to_token(tgt[k - 1]),
                "next_greedy": tok.id_to_token(nxt),
                "match": hit,
            }
            if k in oracle_ok:
                oracle_n[k] += 1
                oracle_ok[k] += hit
        exact = int(body == tgt and eos)
        fam = str(rec.get("family") or rec.get("first_token_class") or "unk")
        examples.append(
            {
                "example_id": rec.get("example_id"),
                "set": label,
                "family": fam,
                "task": rec.get("task"),
                "target": rec.get("target"),
                "free_depth": depth,
                "n_tgt": len(tgt),
                "exact": exact,
                "eos": eos,
                "free_body": [tok.id_to_token(i) for i in body[:8]],
                "FAILURE_CLASS": fail,
                "oracle": oracle,
                "positions": positions,
            }
        )
        bucket = families.setdefault(fam, {"n": 0, "exact": 0, "depths": [], "positions": defaultdict(list), "fail": Counter()})
        bucket["n"] += 1
        bucket["exact"] += exact
        bucket["depths"].append(depth)
        bucket["fail"][fail] += 1
        for pos in positions:
            bucket["positions"][pos["position"]].append(pos)
    summary = {}
    for fam, bucket in families.items():
        pos_out = {}
        for k, prow in bucket["positions"].items():
            pos_out[str(k)] = {
                "n": len(prow),
                "gold_match": sum(int(r["gold_match"]) for r in prow),
                "mean_rank": _mean(prow, "target_rank"),
                "mean_probability": _mean(prow, "target_probability"),
                "mean_ce": _mean(prow, "token_ce"),
                "mean_gap": _mean(prow, "target_top1_gap"),
                "mean_residual_norm": _mean(prow, "ra1_residual_contribution_norm"),
                "mean_input_norm": _mean(prow, "ra1_input_hidden_norm"),
                "mean_output_norm": _mean(prow, "ra1_output_norm"),
                "mean_eos_logit": _mean(prow, "eos_logit"),
                "span_rate": _mean(prow, "span"),
                "greedy_tokens": sorted({r["greedy_token"] for r in prow}),
            }
        summary[fam] = {
            "n": bucket["n"],
            "exact": bucket["exact"],
            "mean_free_depth": sum(bucket["depths"]) / len(bucket["depths"]),
            "FAILURE_CLASSES": dict(bucket["fail"]),
            "positions": pos_out,
        }
    n = max(1, len(rows))
    primary = classes.most_common(1)[0][0] if classes else "NONE"
    unlock = {"token1_unlocks_rest": 0, "token12_unlocks_rest": 0, "n": 0}
    for ex in examples:
        tgt_n = int(ex["n_tgt"])
        if tgt_n < 2:
            continue
        unlock["n"] += 1
        o = ex["oracle"]
        t2 = (o.get("gold_prefix_1") or {}).get("match")
        rest = all((o.get(f"gold_prefix_{k}") or {}).get("match") for k in range(1, tgt_n))
        if t2 and rest:
            unlock["token1_unlocks_rest"] += 1
        t3 = True
        if tgt_n >= 3:
            t3 = all((o.get(f"gold_prefix_{k}") or {}).get("match") for k in range(2, tgt_n))
        if (o.get("gold_prefix_1") or {}).get("match") and (o.get("gold_prefix_2") or {}).get("match") and t3:
            unlock["token12_unlocks_rest"] += 1
    return {
        "SET": label,
        "n": len(rows),
        "exact": sum(int(e["exact"]) for e in examples),
        "mean_free_depth": (sum(depths) / len(depths)) if depths else 0.0,
        "FAILURE_CLASSES": dict(classes),
        "NATURAL_PRIMARY_BLOCK": primary,
        "ORACLE_PREFIX_RESULT": {
            "token2_given_gold1": oracle_ok[2],
            "token2_n": oracle_n[2],
            "token3_given_gold12": oracle_ok[3],
            "token3_n": oracle_n[3],
            "token4_given_gold123": oracle_ok[4],
            "token4_n": oracle_n[4],
            **unlock,
        },
        "FAMILIES": summary,
        "EXAMPLES": examples,
    }


def run(ckpt: Path = PARENT) -> dict[str, Any]:
    got = sha256_file(ckpt / MODEL_NAME)
    if ckpt == PARENT and got != EXPECT:
        raise RuntimeError(f"parent hash mismatch {got}")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = model.load_state_dict(load_safetensors_file(str(ckpt / MODEL_NAME)), strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith("ea1.") or n.startswith("ra1.")} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"diag load mismatch extra={extra} unexpected={unexpected}")
    model.to(device).eval()
    parity = document_parity(model, device)
    sets = {
        "nat2": _rows(NAT2_DIR / "val.jsonl"),
        "bridge_natural": _rows(NAT_FULL_DIR / "val.jsonl"),
        "gen_bridge": _rows(GEN_BRIDGE_DIR / "val.jsonl"),
    }
    out_sets = {name: diagnose_rows(model, tok, device, rows, name) for name, rows in sets.items() if rows}
    primary = (out_sets.get("bridge_natural") or out_sets.get("nat2") or {}).get("NATURAL_PRIMARY_BLOCK") or "NONE"
    report = {
        "CHECKPOINT": str(ckpt),
        "HASH": got,
        "OPTIMIZER_STEPS": 0,
        "DOCUMENT_PARITY": parity,
        "NATURAL_PRIMARY_BLOCK": primary,
        "SETS": {k: {kk: vv for kk, vv in v.items() if kk != "EXAMPLES"} for k, v in out_sets.items()},
        "EXAMPLES": {k: v.get("EXAMPLES") for k, v in out_sets.items()},
    }
    if ckpt == PARENT:
        OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return report


if __name__ == "__main__":
    rep = run()
    slim = {
        "NATURAL_PRIMARY_BLOCK": rep["NATURAL_PRIMARY_BLOCK"],
        "DOCUMENT_PARITY": rep["DOCUMENT_PARITY"],
        "SETS": {
            k: {
                "n": v["n"],
                "exact": v["exact"],
                "mean_free_depth": v["mean_free_depth"],
                "NATURAL_PRIMARY_BLOCK": v["NATURAL_PRIMARY_BLOCK"],
                "ORACLE_PREFIX_RESULT": v["ORACLE_PREFIX_RESULT"],
                "FAILURE_CLASSES": v["FAILURE_CLASSES"],
            }
            for k, v in (rep.get("SETS") or {}).items()
        },
    }
    print(json.dumps(slim, indent=2))
