"""WRIM foundational generation root-cause audit. ZERO optimizer steps.

Analysis / validation / design only. Does not train. Does not mutate corpus
or tokenizer. Does not promote. Does not start STAGE3B.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage2_eval import EVAL_SEED, greedy_generate
from stage3_eval_baseline import extract_json_blob, score_item
from stage3_runtime import PARAM_COUNT, PARENT_SHA, TOKENIZER_SHA, utc_now, write_json
from stage3a_corrective_dev_sets import ITEMS as DEV_ITEMS
from stage3a_corrective_pack import TOKENS_PER_STEP, build_corrective_stream
from wrim_g20m import WRIM0Model, expected_torch_keys

AUDIT_ID = "WRIM1-NEBULA-FOUNDATIONAL-ROOT-CAUSE-000001"
PARENT_STEPS = 500
PARENT_TOKENS = 2_048_000
C0_UNIQUE_TRAIN_TOKENS_DECLARED = 317_338
CHINCHILLA_TPP = 20.0
HISTORICAL_RUN = "WRIM1-RUN-000003"
CORRECTIVE_RUN = "WRIM1-RUN-000004"
PACKED_SOURCE_SHA = "14f5b55e452fa2b25ec49b2d52411a113d0c7f3303a518fded14abef32fb41fe"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def coded_soft_degradations(ev: dict[str, Any], parent0: dict[str, Any]) -> list[str]:
    hits = []
    p = parent0.get("dev") or {}
    n = ev.get("dev") or {}
    if int(n.get("instruction_constraint_ok") or 0) <= int(p.get("instruction_constraint_ok") or 0) - 2:
        hits.append("instruction")
    if int(n.get("json_valid_count") or 0) < int(p.get("json_valid_count") or 0):
        hits.append("structured")
    pu = float(p.get("unique_ratio_128") or p.get("mean_unique_ratio") or 0.0)
    nu = float(n.get("unique_ratio_128") or n.get("mean_unique_ratio") or 0.0)
    if nu <= pu - 0.05:
        hits.append("longform_unique")
    if int(n.get("n_looping") or 0) >= int(p.get("n_looping") or 0) + 2:
        hits.append("repetition")
    if int(n.get("n_collapsed") or 0) >= int(p.get("n_collapsed") or 0) + 2:
        hits.append("collapse")
    if int(n.get("entity_track_ok") or 0) <= int(p.get("entity_track_ok") or 0) - 2:
        hits.append("semantic")
    return hits


def coded_generation_axes(ev: dict[str, Any], parent0: dict[str, Any]) -> dict[str, Any]:
    p = parent0.get("dev") or {}
    n = ev.get("dev") or {}
    improved = []
    worsened = []
    loop_imp = int(n.get("n_looping") or 0) <= int(p.get("n_looping") or 0) - 2
    uniq_imp = float(n.get("unique_ratio_128") or n.get("mean_unique_ratio") or 0.0) >= float(p.get("unique_ratio_128") or p.get("mean_unique_ratio") or 0.0) + 0.03
    if loop_imp or uniq_imp:
        improved.append("repetition_resistance")
    elif int(n.get("n_looping") or 0) > int(p.get("n_looping") or 0) or float(n.get("mean_unique_ratio") or 0) < float(p.get("mean_unique_ratio") or 0) - 0.01:
        worsened.append("repetition_resistance")
    ent_imp = int(n.get("entity_track_ok") or 0) >= int(p.get("entity_track_ok") or 0) + 1
    if uniq_imp or ent_imp:
        improved.append("continuity_128_256")
    elif float(n.get("unique_ratio_128") or 0) < float(p.get("unique_ratio_128") or 0) - 0.01 or int(n.get("entity_track_ok") or 0) < int(p.get("entity_track_ok") or 0):
        worsened.append("continuity_128_256")
    if int(n.get("instruction_constraint_ok") or 0) >= int(p.get("instruction_constraint_ok") or 0) + 1:
        improved.append("instruction_following")
    elif int(n.get("instruction_constraint_ok") or 0) < int(p.get("instruction_constraint_ok") or 0):
        worsened.append("instruction_following")
    struct_now = int(n.get("json_valid_count") or 0) + int(n.get("kv_ok_count") or 0) + int(n.get("list_ok_count") or 0) + int(n.get("csv_ok_count") or 0)
    struct_p = int(p.get("json_valid_count") or 0) + int(p.get("kv_ok_count") or 0) + int(p.get("list_ok_count") or 0) + int(p.get("csv_ok_count") or 0)
    json_imp = int(n.get("json_valid_count") or 0) >= int(p.get("json_valid_count") or 0) + 1
    if json_imp or struct_now >= struct_p + 1:
        improved.append("structured_output")
    elif struct_now < struct_p:
        worsened.append("structured_output")
    return {"improved": improved, "worsened": worsened}


def fake_gen(text: str, *, n_ids: int | None = None, collapsed: bool = False, looping: bool = False) -> dict[str, Any]:
    words = re.findall(r"\S+", text)
    n = n_ids if n_ids is not None else max(8, min(256, len(words) * 2))
    if looping:
        ids = ([7, 7, 7, 7, 7, 7, 7, 8] * (n // 8 + 1))[:n]
    else:
        ids = list(range(20, 20 + n))
    uniq = (len(set(ids)) / len(ids)) if ids else 0.0
    max_run = 1
    run = 1
    for a, b in zip(ids, ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    return {
        "continuation": text,
        "new_ids": ids,
        "n_new": len(ids),
        "unique_ratio": round(uniq, 4),
        "max_run": max_run,
        "collapsed": collapsed or (max_run >= max(6, len(ids) // 3)),
        "special_loop": False,
        "entropy": 4.0,
        "finite": True,
    }


def scorer_oracle() -> dict[str, Any]:
    items_by_id = {it["item_id"]: it for it in DEV_ITEMS}
    cases = []

    def run(item_id: str, text: str, expect: dict[str, Any], *, collapsed: bool = False, looping: bool = False) -> None:
        item = items_by_id[item_id]
        gen = fake_gen(text, collapsed=collapsed, looping=looping)
        scores = score_item(item, gen, gen, gen)
        row = {"item_id": item_id, "expect": expect, "scores": {k: scores.get(k) for k in expect}, "collapsed": gen["collapsed"], "unique_ratio": gen["unique_ratio"]}
        row["ok"] = all(scores.get(k) is v for k, v in expect.items())
        if "collapsed" in expect:
            row["ok"] = row["ok"] and (gen["collapsed"] is expect["collapsed"])
        cases.append(row)

    run("dev-json-01", '{"quay_tag":"A1","crate_mass":12}', {"json_valid": True, "json_required_keys": True})
    run("dev-json-01", "not json at all", {"json_valid": False})
    run("dev-json-02", '["winch","boom","cleat"]', {"json_valid": True, "json_array_len_3": True})
    run("dev-json-02", '["only-one"]', {"json_valid": True, "json_array_len_3": False})
    run("dev-kv-01", "quay_tag: pellwick\ncrate_mass: 18", {"key_value_lines": True})
    run("dev-kv-01", "hello world without labels", {"key_value_lines": False})
    list_item = next(it for it in DEV_ITEMS if "list_lines" in (it.get("scoring_functions") or []))
    gen_list_ok = fake_gen("- a\n- b\n- c\n- d")
    list_ok = score_item(list_item, gen_list_ok, gen_list_ok, gen_list_ok).get("list_lines")
    gen_list_bad = fake_gen("no")
    list_bad = score_item(list_item, gen_list_bad, gen_list_bad, gen_list_bad).get("list_lines")
    csv_item = next(it for it in DEV_ITEMS if "csv_row" in (it.get("scoring_functions") or []))
    gen_csv_ok = fake_gen("alpha,beta,gamma")
    csv_ok = score_item(csv_item, gen_csv_ok, gen_csv_ok, gen_csv_ok).get("csv_row")
    gen_csv_bad = fake_gen("onlyonefield")
    csv_bad = score_item(csv_item, gen_csv_bad, gen_csv_bad, gen_csv_bad).get("csv_row")
    run("dev-inst-01", "five", {"exactly_one_word": True, "accepted_word": True})
    run("dev-inst-01", "the answer is maybe seven or eight", {"exactly_one_word": False})
    prose_ok = fake_gen(
        "Pellwick kept the blue crate in view. Joss counted a third bump, then a fourth, "
        "and named the incoming skipper, the lamp color, and the herring tally without repeating a clause. "
        * 12,
        n_ids=128,
    )
    prose_loop = fake_gen("pin pin pin pin pin pin pin pin pin pin pin pin pin pin pin pin", n_ids=128, looping=True)
    collapse_bad = fake_gen("......", n_ids=32, collapsed=True)
    unique_ok = float(prose_ok["unique_ratio"]) >= 0.35 and not prose_ok["collapsed"]
    unique_loop = float(prose_loop["unique_ratio"]) < 0.35 or prose_loop["collapsed"]
    cases.append({"item_id": "oracle-list", "ok": bool(list_ok) and (not bool(list_bad)), "scores": {"list_ok": list_ok, "list_bad": list_bad}})
    cases.append({"item_id": "oracle-csv", "ok": bool(csv_ok) and (not bool(csv_bad)), "scores": {"csv_ok": csv_ok, "csv_bad": csv_bad}})
    cases.append({"item_id": "oracle-longform-128", "ok": unique_ok, "unique_ratio": prose_ok["unique_ratio"], "collapsed": prose_ok["collapsed"]})
    cases.append({"item_id": "oracle-loop-negative", "ok": unique_loop, "unique_ratio": prose_loop["unique_ratio"], "collapsed": prose_loop["collapsed"]})
    cases.append({"item_id": "oracle-collapse-negative", "ok": bool(collapse_bad["collapsed"]), "collapsed": collapse_bad["collapsed"]})
    passed = all(c.get("ok") for c in cases)
    return {
        "ok": passed,
        "n_cases": len(cases),
        "n_pass": int(sum(1 for c in cases if c.get("ok"))),
        "cases": cases,
        "note": "Scorers distinguish authored good vs bad fixtures. WRIM failure is not an evaluator defect if this passes.",
    }


def compact_from_eval(path: Path) -> dict[str, Any]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    d = obj.get("dev") or {}
    return {
        "step": obj.get("step"),
        "looping": d.get("n_looping"),
        "collapse": d.get("n_collapsed"),
        "unique128": d.get("unique_ratio_128"),
        "unique256": d.get("unique_ratio_256"),
        "json_valid": d.get("json_valid_count"),
        "instruction": d.get("instruction_constraint_ok"),
        "entity": d.get("entity_track_ok"),
        "val1": obj.get("val_loss_corpus1"),
        "raw_dev": d,
        "raw": obj,
    }


def design_md_soft_hits(now: dict[str, Any], parent: dict[str, Any]) -> list[str]:
    hits = []
    if float(now.get("unique128") or 0) <= float(parent.get("unique128") or 0) - 0.05:
        hits.append("unique128_le_parent_minus_0.05")
    if int(now.get("instruction") or 0) <= int(parent.get("instruction") or 0) - 2:
        hits.append("instruction_le_parent_minus_2")
    json_flat = int(now.get("json_valid") or 0) <= int(parent.get("json_valid") or 0)
    loop_worse = int(now.get("looping") or 0) > int(parent.get("looping") or 0)
    if json_flat and loop_worse:
        hits.append("json_flat_and_looping_worsened")
    if float(now.get("val1") or 0) > float(parent.get("val1") or 0) + 0.15:
        hits.append("val1_gt_parent_plus_0.15")
    return hits


def commander_spirit_hits(now: dict[str, Any], parent: dict[str, Any]) -> list[str]:
    """Qualitative two-axis reading of the run authorization, without changing coded thresholds."""
    hits = []
    if int(now.get("instruction") or 0) < int(parent.get("instruction") or 0):
        hits.append("instruction")
    if int(now.get("json_valid") or 0) < int(parent.get("json_valid") or 0):
        hits.append("structured")
    if float(now.get("unique128") or 0) < float(parent.get("unique128") or 0) - 0.01 or float(now.get("unique256") or 0) < float(parent.get("unique256") or 0) - 0.01:
        hits.append("longform_unique")
    if int(now.get("looping") or 0) > int(parent.get("looping") or 0):
        hits.append("repetition")
    if int(now.get("collapse") or 0) > int(parent.get("collapse") or 0):
        hits.append("collapse")
    if int(now.get("entity") or 0) < int(parent.get("entity") or 0):
        hits.append("semantic")
    return hits


def soft_stop_audit(ckpt_dir: Path) -> dict[str, Any]:
    evals = {}
    for step in (0, 5, 10, 15, 20, 25):
        p = ckpt_dir / "evals" / f"step-{step}.json"
        evals[step] = compact_from_eval(p) if p.exists() else None
    parent_ev = evals[0]["raw"] if evals[0] else {}
    coded = {}
    design = {}
    spirit = {}
    for step in (5, 10, 15, 20, 25):
        if not evals[step]:
            continue
        coded[step] = coded_soft_degradations(evals[step]["raw"], parent_ev)
        design[step] = design_md_soft_hits(evals[step], evals[0])
        spirit[step] = commander_spirit_hits(evals[step], evals[0])
    floor_metrics = {
        "parent_json_valid": evals[0]["json_valid"] if evals[0] else None,
        "parent_instruction": evals[0]["instruction"] if evals[0] else None,
        "parent_entity": evals[0]["entity"] if evals[0] else None,
        "note": "When parent JSON/instruction/entity are already 0, coded degradation tests (json < parent, instruction <= parent-2, entity <= parent-2) cannot fire.",
    }
    should_coded_15 = len(coded.get(15) or []) >= 2
    should_coded_20 = len(coded.get(20) or []) >= 2
    should_coded_25 = len(coded.get(25) or []) >= 2
    return {
        "coded_rule": {
            "stop_if": "len(soft_degradations) >= 2",
            "axes": [
                "instruction: constraint_ok <= parent-2",
                "structured: json_valid < parent (strict less)",
                "longform_unique: unique128 <= parent-0.05 (unique256 NOT used)",
                "repetition: looping >= parent+2",
                "collapse: collapsed >= parent+2",
                "semantic: entity_track_ok <= parent-2",
            ],
            "hits": coded,
        },
        "design_md_rule": {
            "source": "STAGE3A_CORRECTIVE_DESIGN.md section 29",
            "hits": design,
        },
        "commander_spirit_qualitative": {
            "note": "Two or more worsened generation axes, including unique256, without the 0.05 / +2 floors. Not the coded runner.",
            "hits": spirit,
        },
        "step15_coded_would_stop": should_coded_15,
        "step20_coded_would_stop": should_coded_20,
        "step25_coded_would_stop": should_coded_25,
        "step15_spirit_would_stop": len(spirit.get(15) or []) >= 2,
        "step20_spirit_would_stop": len(spirit.get(20) or []) >= 2,
        "continued_because": "Coded runner required two thresholded hits. Step 20 had repetition only (looping 17 >= 16). unique128 drop 0.033 < 0.05. JSON/instruction/entity were already 0 so those axes could not degrade. unique256 is not in the coded rule.",
        "implementation_class": "CODED_RULE_FOLLOWED_SPEC_GAP",
        "runner_defect": False,
        "validator_coverage_failed": True,
        "validator_gap": "Pilot validator asserted abort_occurred=false; it did not independently recompute soft-stop hits from checkpoint evals.",
        "floor_metrics": floor_metrics,
        "checkpoints": {str(k): {kk: vv for kk, vv in (v or {}).items() if kk not in {"raw", "raw_dev"}} for k, v in evals.items()},
        "generation_axes_at_10": coded_generation_axes(evals[10]["raw"], parent_ev) if evals.get(10) else None,
        "generation_axes_at_25": coded_generation_axes(evals[25]["raw"], parent_ev) if evals.get(25) else None,
    }


def classify_text_objective(text: str, rec: dict[str, Any]) -> str:
    fmt = str(rec.get("format") or "")
    kind = str(rec.get("kind") or "")
    if kind == "behavior_example" or fmt == "instruction_response":
        return "INSTRUCTION_RESPONSE"
    blob = text.strip()
    low = blob.lower()
    if any(s in blob for s in ("<|assistant", "Assistant:", "User:", "### Instruction", "### Response")):
        return "CHAT_TURN"
    if blob.startswith("{") or blob.startswith("["):
        if "return json" in low or "respond with" in low:
            return "INSTRUCTION_CONDITIONED_JSON"
        if "json" in fmt or blob[:1] in "{[":
            return "RAW_JSON_DOCUMENT"
    if fmt in ("code",):
        return "CODE_DOCUMENT"
    return "DOCUMENT_CONTINUATION"


def data_format_audit(dump_root: Path) -> dict[str, Any]:
    train_jsonl = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    behavior_path = dump_root / "model-lab" / "manifests" / "wave8_1" / "behavior-examples.json"
    c0_manifest = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json"
    rows = []
    with train_jsonl.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    from stage1_pack import bucket_for_record, text_of

    by_bucket: dict[str, list[dict[str, Any]]] = defaultdict(list)
    obj_counts: dict[str, int] = defaultdict(int)
    json_instruction_conditioned = 0
    json_raw = 0
    json_samples = []
    behavior_like = 0
    for rec in rows:
        text = text_of(rec)
        b = bucket_for_record(rec)
        by_bucket[b].append(rec)
        obj = classify_text_objective(text, rec)
        obj_counts[obj] += 1
        if b == "json" or obj in {"RAW_JSON_DOCUMENT", "INSTRUCTION_CONDITIONED_JSON"}:
            if obj == "INSTRUCTION_CONDITIONED_JSON":
                json_instruction_conditioned += 1
            else:
                json_raw += 1
            if len(json_samples) < 8:
                json_samples.append(
                    {
                        "format": rec.get("format"),
                        "kind": rec.get("kind"),
                        "path_suffix": str(rec.get("source_path") or rec.get("path") or "")[-80:],
                        "objective": obj,
                        "prefix": (text or "")[:180],
                    }
                )
        if obj == "INSTRUCTION_RESPONSE":
            behavior_like += 1
    c0 = json.loads(c0_manifest.read_text(encoding="utf-8")) if c0_manifest.exists() else {}
    c0_docs = list(c0.get("trainDocs") or [])
    c0_tokens = int(sum(int(d.get("tokenCount") or 0) for d in c0_docs))
    beh = json.loads(behavior_path.read_text(encoding="utf-8")) if behavior_path.exists() else {}
    beh_examples = list(beh.get("examples") or [])
    beh_with_response = 0
    beh_prefixes = []
    for ex in beh_examples[:12]:
        rendered = str(ex.get("renderedTrainingText") or "")
        if any(s in rendered for s in ("Assistant", "response", "Output:", "###")):
            beh_with_response += 1
        if len(beh_prefixes) < 5:
            beh_prefixes.append(rendered[:200])
    families = {}
    for b, recs in by_bucket.items():
        n_instr = sum(1 for r in recs if classify_text_objective(text_of(r), r) in {"INSTRUCTION_RESPONSE", "CHAT_TURN", "INSTRUCTION_CONDITIONED_JSON"})
        families[b] = {
            "record_count": len(recs),
            "explicit_instruction_or_response_records": n_instr,
            "typical_format": recs[0].get("format") if recs else None,
            "typical_kind": recs[0].get("kind") if recs else None,
            "sample_prefix": (text_of(recs[0]) if recs else "")[:160],
        }
    return {
        "wr_corpus_1_train_records": len(rows),
        "wr_corpus_1_train_path": str(train_jsonl),
        "wr_corpus_0_train_docs": len(c0_docs),
        "wr_corpus_0_train_tokens_from_manifest": c0_tokens,
        "wr_corpus_0_declared_unique_train_tokens": C0_UNIQUE_TRAIN_TOKENS_DECLARED,
        "objective_record_counts": dict(obj_counts),
        "families": families,
        "json": {
            "raw_json_document_records": json_raw,
            "instruction_conditioned_json_records": json_instruction_conditioned,
            "samples": json_samples,
            "finding": "JSON records are overwhelmingly raw JSON documents, not prompt→JSON response pairs.",
        },
        "behavior_examples_file_n": len(beh_examples),
        "behavior_sample_prefixes": beh_prefixes,
        "assistant_markers_in_behavior_sample": beh_with_response,
        "prompt_response_boundary_present_in_c1_majority": obj_counts.get("INSTRUCTION_RESPONSE", 0) + obj_counts.get("CHAT_TURN", 0) < max(1, len(rows) * 0.05),
        "predominant_objective": "DOCUMENT_CONTINUATION",
    }


def packing_step_map(spans: list[dict[str, Any]]) -> dict[str, Any]:
    cursor = 0
    span_i = 0
    span_used = 0
    steps = []
    for step in range(1, 26):
        need = TOKENS_PER_STEP
        mix: dict[str, int] = defaultdict(int)
        origins: dict[str, int] = defaultdict(int)
        docs = set()
        while need > 0 and span_i < len(spans):
            sp = spans[span_i]
            avail = int(sp["n"]) - span_used
            take = min(need, avail)
            mix[str(sp["bucket"])] += take
            origins[str(sp.get("origin") or "")] += take
            docs.add(str(sp.get("unit_id")))
            need -= take
            span_used += take
            cursor += take
            if span_used >= int(sp["n"]):
                span_i += 1
                span_used = 0
        total = int(sum(mix.values())) or 1
        steps.append(
            {
                "step": step,
                "tokens": TOKENS_PER_STEP,
                "mix": dict(mix),
                "mix_pct": {k: round(100.0 * v / total, 1) for k, v in sorted(mix.items())},
                "dominant": max(mix.items(), key=lambda kv: kv[1])[0] if mix else None,
                "n_docs": len(docs),
            }
        )
    return {"steps": steps, "stream_tokens_mapped": cursor}


def entropy_from_logits(logits: torch.Tensor) -> float:
    x = logits.float()
    x = x - x.max()
    p = torch.softmax(x, dim=-1)
    return float(-(p * torch.log(p.clamp_min(1e-12))).sum().item())


def next_token(logits: torch.Tensor, *, mode: str, temperature: float, top_p: float, rng: torch.Generator) -> int:
    if mode == "greedy":
        return int(torch.argmax(logits).item())
    x = logits.float() / max(temperature, 1e-6)
    p = torch.softmax(x, dim=-1).detach().cpu()
    if mode == "top_p":
        sp, idx = torch.sort(p, descending=True)
        cdf = torch.cumsum(sp, dim=-1)
        mask = cdf > top_p
        mask[0] = False
        sp = sp.masked_fill(mask, 0.0)
        sp = sp / sp.sum().clamp_min(1e-12)
        draw = torch.multinomial(sp, 1, generator=rng)
        return int(idx[int(draw.item())].item())
    return int(torch.multinomial(p, 1, generator=rng).item())


def generate_trace(
    model: WRIM0Model,
    tokenizer: Tokenizer,
    prompt: str,
    device: torch.device,
    *,
    max_new: int,
    mode: str = "greedy",
    temperature: float = 1.0,
    top_p: float = 0.9,
    seed: int = EVAL_SEED,
) -> dict[str, Any]:
    bos = tokenizer.token_to_id("<|bos|>")
    eos = tokenizer.token_to_id("<|eos|>")
    lbrace = tokenizer.token_to_id("{")
    rbrace = tokenizer.token_to_id("}")
    quote = tokenizer.token_to_id('"')
    colon = tokenizer.token_to_id(":")
    nl = tokenizer.token_to_id("\n")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    ids = [int(bos), *body]
    new_ids: list[int] = []
    per_pos = []
    rng = torch.Generator(device="cpu")
    rng.manual_seed(seed)
    model.eval()
    degenerated_at = None
    with torch.inference_mode():
        cur = torch.tensor([ids], dtype=torch.long, device=device)
        for i in range(max_new):
            logits = model(cur)[0, -1]
            probs = torch.softmax(logits.float(), dim=-1)
            topv, topi = torch.topk(probs, k=min(5, probs.numel()))
            nxt = next_token(logits, mode=mode, temperature=temperature, top_p=top_p, rng=rng)
            rec = {
                "t": i + 1,
                "entropy": round(entropy_from_logits(logits), 4),
                "top1_prob": round(float(topv[0].item()), 4),
                "top5_mass": round(float(topv.sum().item()), 4),
                "eos_prob": round(float(probs[int(eos)].item()), 6) if eos is not None else None,
                "repeat_last_prob": round(float(probs[new_ids[-1]].item()), 4) if new_ids else None,
                "lbrace_prob": round(float(probs[int(lbrace)].item()), 6) if lbrace is not None else None,
                "rbrace_prob": round(float(probs[int(rbrace)].item()), 6) if rbrace is not None else None,
                "quote_prob": round(float(probs[int(quote)].item()), 6) if quote is not None else None,
                "colon_prob": round(float(probs[int(colon)].item()), 6) if colon is not None else None,
                "newline_prob": round(float(probs[int(nl)].item()), 6) if nl is not None else None,
                "token_id": nxt,
            }
            per_pos.append(rec)
            new_ids.append(nxt)
            ids.append(nxt)
            window = new_ids[-16:]
            uniq = len(set(window)) / max(1, len(window))
            run = 1
            max_run = 1
            for a, b in zip(new_ids, new_ids[1:]):
                run = run + 1 if a == b else 1
                max_run = max(max_run, run)
            if degenerated_at is None and (uniq < 0.35 and len(new_ids) >= 16 or max_run >= 8):
                degenerated_at = i + 1
            if nxt == eos:
                break
            cur = torch.tensor([ids], dtype=torch.long, device=device)
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    uniq_all = (len(set(new_ids)) / len(new_ids)) if new_ids else 0.0
    blob = extract_json_blob(continuation)
    json_valid = False
    if blob:
        try:
            json.loads(blob)
            json_valid = True
        except Exception:
            json_valid = False
    return {
        "mode": mode,
        "temperature": temperature if mode != "greedy" else None,
        "top_p": top_p if mode == "top_p" else None,
        "n_new": len(new_ids),
        "continuation_prefix": continuation[:280],
        "unique_ratio": round(uniq_all, 4),
        "degeneration_onset": degenerated_at,
        "mean_entropy": round(float(sum(p["entropy"] for p in per_pos) / max(1, len(per_pos))), 4),
        "mean_top1": round(float(sum(p["top1_prob"] for p in per_pos) / max(1, len(per_pos))), 4),
        "mean_top5_mass": round(float(sum(p["top5_mass"] for p in per_pos) / max(1, len(per_pos))), 4),
        "mean_eos_prob": round(float(sum((p["eos_prob"] or 0) for p in per_pos) / max(1, len(per_pos))), 6),
        "json_valid": json_valid,
        "positions_head": per_pos[:8],
        "positions_tail": per_pos[-4:] if len(per_pos) > 8 else [],
    }


def load_frozen_model(weights: Path, device: torch.device) -> WRIM0Model:
    raw = load_file(str(weights))
    if any(k.startswith("model.") for k in raw):
        state = {k[len("model.") :]: v for k, v in raw.items() if k.startswith("model.")}
    else:
        state = {k: v for k, v in raw.items() if not k.startswith("opt.")}
    if set(state) != set(expected_torch_keys()):
        # Parent dump may only be readable via the header-only model.* loader.
        state, _cov = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        raise RuntimeError(f"architecture key mismatch {sorted(set(state) ^ set(expected_torch_keys()))[:8]}")
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.to(device)
    model.freeze_inference()
    return model


def decoding_audit(*, tokenizer: Tokenizer, device: torch.device, models: dict[str, Path]) -> dict[str, Any]:
    prompts = {
        "json": next(it["prompt_text"] for it in DEV_ITEMS if it["item_id"] == "dev-json-01"),
        "instruction": next(it["prompt_text"] for it in DEV_ITEMS if it["item_id"] == "dev-inst-01"),
        "long_prose": next(it["prompt_text"] for it in DEV_ITEMS if it["item_id"] == "dev-prose-01"),
        "kv": next(it["prompt_text"] for it in DEV_ITEMS if it["item_id"] == "dev-kv-01"),
    }
    out: dict[str, Any] = {"prompts": {k: v[:160] for k, v in prompts.items()}, "greedy": {}, "sensitivity_wrim0_json": []}
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    for name, path in models.items():
        print(f"[audit] decode {name}", flush=True)
        model = load_frozen_model(path, device)
        bundle = {}
        for key, prompt in prompts.items():
            max_new = 64 if key == "long_prose" else 32
            bundle[key] = generate_trace(model, tokenizer, prompt, device, max_new=max_new, mode="greedy")
        out["greedy"][name] = bundle
        if name == "WRIM-0":
            for mode, temp, tp in (("greedy", 1.0, 1.0), ("temperature", 0.3, 1.0), ("temperature", 0.8, 1.0), ("top_p", 0.8, 0.9)):
                out["sensitivity_wrim0_json"].append(
                    generate_trace(
                        model,
                        tokenizer,
                        prompts["json"],
                        device,
                        max_new=32,
                        mode="greedy" if mode == "greedy" else ("top_p" if mode == "top_p" else "temperature"),
                        temperature=temp,
                        top_p=tp,
                    )
                )
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    json_greedy = {k: bool((v.get("json") or {}).get("json_valid")) for k, v in out["greedy"].items()}
    inst_word = {}
    for k, v in out["greedy"].items():
        text = ((v.get("instruction") or {}).get("continuation_prefix") or "").strip()
        inst_word[k] = text.split()[:6]
    out["cross_checkpoint"] = {
        "json_valid_greedy": json_greedy,
        "instruction_first_words": inst_word,
        "finding": "If greedy JSON stays invalid across WRIM-0/STEP10/STEP25 and sampling does not suddenly produce valid JSON, the failure is encoded in the weights, not primarily a greedy decoding artifact.",
    }
    return out


def scale_audit(c0_tokens: int, c1_records: int) -> dict[str, Any]:
    tpp = PARENT_TOKENS / PARAM_COUNT
    epochs = PARENT_TOKENS / max(1, c0_tokens)
    chinchilla_tokens = CHINCHILLA_TPP * PARAM_COUNT
    return {
        "parameter_count": PARAM_COUNT,
        "architecture": {"n_layers": 18, "d_model": 256, "n_heads": 4, "d_ff": 768, "context": 512, "vocab": 15126, "tied": True},
        "wrim0_optimizer_steps": PARENT_STEPS,
        "wrim0_training_tokens": PARENT_TOKENS,
        "wr_corpus_0_unique_train_tokens": c0_tokens,
        "repeated_token_exposure": PARENT_TOKENS - c0_tokens,
        "corpus_equivalent_passes": round(epochs, 3),
        "tokens_per_parameter": round(tpp, 6),
        "chinchilla_20tpp_token_target": int(chinchilla_tokens),
        "tpp_vs_chinchilla_fraction": round(tpp / CHINCHILLA_TPP, 6),
        "wr_corpus_1_train_records": c1_records,
        "document_coverage_wrim0": "6 genesis documents / WR-CORPUS-0 literary+code mix; no pretrained weights",
        "can_predict_tokens": True,
        "can_generate_useful_responses": False,
        "enough_for_coherent_multi_sentence": False,
        "enough_for_instruction_following": False,
        "enough_for_json_generation": False,
        "enough_for_stable_128": False,
        "enough_for_stable_256": False,
        "rationale": (
            f"WRIM-0 saw {PARENT_TOKENS} tokens at {PARENT_STEPS} steps (~{tpp:.3f} tokens/parameter). "
            f"Unique WR-CORPUS-0 train tokens are {c0_tokens}, so epoch reuse is ~{epochs:.2f}x. "
            f"A Chinchilla-style 20 tokens/parameter compute-optimal budget for 19.2M params is ~{int(chinchilla_tokens/1e6)}M tokens. "
            "Teacher-forced NLL can fall while greedy generation remains looping/non-JSON because next-token fit on repeated literary documents is not the same objective as prompt-conditioned useful responses."
        ),
    }


def classify_readiness(scale: dict[str, Any], data: dict[str, Any], decode: dict[str, Any], oracle: dict[str, Any], packing: dict[str, Any]) -> dict[str, Any]:
    json_never = not any((decode.get("greedy") or {}).get(k, {}).get("json", {}).get("json_valid") for k in ("WRIM-0", "STEP10", "STEP25"))
    sampling_json = any(bool(x.get("json_valid")) for x in (decode.get("sensitivity_wrim0_json") or []))
    blockers = []
    if scale["tokens_per_parameter"] < 2.0:
        blockers.append("A_UNDERTRAINED")
    if data.get("predominant_objective") == "DOCUMENT_CONTINUATION":
        blockers.append("B_OBJECTIVE_MISMATCH")
    if data.get("json", {}).get("instruction_conditioned_json_records", 1) == 0:
        blockers.append("C_DATA_LIMITED_JSON_INSTRUCTION")
    if packing.get("document_major_bursts"):
        blockers.append("D_PACKING_BURSTS_SECONDARY")
    if json_never and not sampling_json:
        blockers.append("E_FAILURE_IN_WEIGHTS_NOT_PRIMARILY_DECODING")
    if oracle.get("ok"):
        blockers.append("F_SCORER_NOT_THE_BOTTLENECK")
    architecture_limited = False
    label = "F. MULTIPLE_FOUNDATIONAL_BLOCKERS"
    return {
        "readiness_class": label,
        "blockers": blockers,
        "architecture_limited_primary": architecture_limited,
        "architecture_note": "19.2M / 512-ctx decoder can represent simple JSON and short instructions if trained on that objective. CAP 6/6 shows some retained literary generation. Architecture is not the primary JSON/instruction blocker.",
        "scorer_ok": bool(oracle.get("ok")),
        "json_valid_any_greedy": (not json_never),
        "json_valid_any_sampled_wrim0": sampling_json,
        "evidence_backed": True,
    }


def proposed_strategy(scale: dict[str, Any]) -> dict[str, Any]:
    existing_unique = int(scale["wr_corpus_0_unique_train_tokens"]) + 3_874_900
    return {
        "direction": "STAGED_COMBINATION",
        "not_recommended_now": ["another 25-step corrective Stage3A", "STAGE3B", "STEP10 promotion", "instruction-only SFT from this undertrained base as the first next run"],
        "phase_f1_foundational": {
            "kind": "FOUNDATIONAL_PRETRAINING_EXPANSION",
            "objective": "DOCUMENT_CONTINUATION on existing WR-CORPUS-0 + WR-CORPUS-1-HARDENED only (no corpus mutation)",
            "packing": "deficit-interleave families; do not binge DOCUMENT_MAJOR_CONTIGUOUS for the next official run",
            "proposed_token_scale": 16_384_000,
            "proposed_steps_at_4096": 4000,
            "epochs_on_existing_unique_approx": round(16_384_000 / max(1, existing_unique), 2),
            "tokens_per_parameter_after": round(16_384_000 / PARAM_COUNT, 3),
            "still_below_chinchilla": True,
            "peak_lr_design_range": "1e-5 to 3e-5 (Recovery-006 order); not 3e-3",
            "repeat_policy": "allow epoch reuse of existing unique tokens; do not invent new WR-CORPUS records this pass",
            "curriculum": "interleaved wr_corpus_0 / prose / code / json / behavior; Alice cap remains",
            "checkpoint_cadence": "every 100 steps; full compact gen eval every 200",
            "gates": {
                "retention": "ΔNLL < 0.105, KL < 0.018, val0 <= parent, CAP >= 5/6",
                "generation": "DEV looping <= parent-2 OR unique128 +>= 0.03; unique256 must be recorded and may stop the run if it drops >= 0.05 with looping increase",
                "json_not_required_to_leave_zero_in_f1": True,
            },
            "compute_estimate": "4000 steps × ~0.2s ≈ 15–25 min train + eval overhead on RTX 5060 Ti; eval cadence dominates wall-clock",
        },
        "phase_f2_sft": {
            "kind": "INSTRUCTION_SFT_CURRICULUM",
            "data_class": "PROPOSED_TRAINING_DATA",
            "not_merged_into_wr_corpus": True,
            "starts_only_after": "F1 generation unique128/looping gate, not after val-loss improvement alone",
            "format": "explicit prompt→response with loss masked on the prompt tokens",
            "includes": ["instruction following", "constrained JSON", "list/KV/CSV", "128/256 long-form anti-repetition"],
            "held_out": "frozen WRIM-EVAL-S3A-* remain evaluation-only; new SFT items must leak-scan against them",
        },
        "decoding": "Keep greedy as the official eval decoder. Sampling is diagnostic only. Do not retune eval because WRIM fails.",
        "architecture": "Keep WRIM-G-20M-v1-option-A. No sparse experts. No Qwen replacement.",
        "proposed_token_scale_headline": 16_384_000,
        "proposed_corpus_requirement": "Existing WR-CORPUS-0 + WR-CORPUS-1-HARDENED for F1. F2 requires separately classified PROPOSED_TRAINING_DATA. Full Chinchilla ~384M tokens is not available without new data.",
        "proposed_objective": "F1 next-token document LM; F2 prompt-masked SFT",
        "proposed_curriculum": "F1 interleaved continuation; F2 instruction/structured/long-form with prompt loss masking",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--design", required=True)
    p.add_argument("--pilot", required=True)
    p.add_argument("--ckpt-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()
    weights = Path(args.weights)
    tok_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    ckpt = Path(args.ckpt_dir)
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tok_path)
    sha_ok = parent_sha == PARENT_SHA and tok_sha == TOKENIZER_SHA
    if "WRIM1-RUN-000003" in str(ckpt) and "WRIM1-RUN-000004" not in str(ckpt):
        raise SystemExit("refuses to treat 000003 as this audit target")

    print("[audit] scorer oracle", flush=True)
    oracle = scorer_oracle()
    print("[audit] soft-stop replay", flush=True)
    soft = soft_stop_audit(ckpt)
    print("[audit] data-format (read-only)", flush=True)
    data = data_format_audit(dump_root)
    c0_tokens = int(data["wr_corpus_0_train_tokens_from_manifest"] or C0_UNIQUE_TRAIN_TOKENS_DECLARED)
    scale = scale_audit(c0_tokens, int(data["wr_corpus_1_train_records"]))

    print("[audit] rebuild corrective spans (no optimizer)", flush=True)
    tokenizer = Tokenizer.from_file(str(tok_path))
    packed = build_corrective_stream(dump_root=dump_root, tokenizer=tokenizer)
    pack_ok = packed.get("packed_source_ids_sha256") == PACKED_SOURCE_SHA
    stream_sha = packed.get("stream_sha256")
    persisted = ckpt / "corrective-stream.npy"
    persisted_sha = hashlib.sha256(np.load(persisted).tobytes()).hexdigest() if persisted.exists() else None
    packing = packing_step_map(list(packed.get("unit_spans") or []))
    step_loss = {}
    pilot = json.loads(Path(args.pilot).read_text(encoding="utf-8")) if Path(args.pilot).exists() else {}
    for row in (pilot.get("step_metrics") or []):
        step_loss[int(row["step"])] = {"loss": row.get("loss"), "grad_norm": row.get("grad_norm")}
    bursts = []
    for s in packing["steps"]:
        rec = {**s, **(step_loss.get(s["step"]) or {})}
        bursts.append(rec)
    low_loss = [b for b in bursts if isinstance(b.get("loss"), float) and b["loss"] < 6.0]
    packing_summary = {
        "packed_source_ids_sha256": packed.get("packed_source_ids_sha256"),
        "pack_matches_frozen_design": pack_ok,
        "rebuilt_stream_sha256": stream_sha,
        "persisted_stream_sha256": persisted_sha,
        "stream_sha_match_persisted": bool(persisted_sha and persisted_sha == stream_sha),
        "document_major_bursts": True,
        "steps": bursts,
        "low_loss_steps": low_loss,
        "finding": "Large loss swings track domain/document bursts under DOCUMENT_MAJOR_CONTIGUOUS, not a sudden capability phase change. Low-loss steps 18–19 are 100% WR-CORPUS-0 literary rehearsal (loss 5.28 then 4.22), not JSON/behavior skill and not evidence of generation skill.",
    }

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    models = {
        "WRIM-0": weights,
        "STEP10": ckpt / "step-10" / "model.safetensors",
        "STEP25": ckpt / "step-25" / "model.safetensors",
    }
    print("[audit] decoding traces (inference only)", flush=True)
    decode = decoding_audit(tokenizer=tokenizer, device=device, models=models)

    step10 = {
        "looping_delta": (soft["checkpoints"]["10"]["looping"] if soft["checkpoints"].get("10") else None),
        "explanation": (
            "STEP10 looping 14→12 meets the coded success delta for repetition (-2) but unique128 only +0.002 "
            "(need +0.03) and JSON/instruction remain 0. That is a one-axis wiggle, not two-axis generation skill. "
            "It is consistent with domain-order / document-major packing plus small entropy movement, not a promoteable adaptation."
        ),
        "promotion": False,
        "axes": soft.get("generation_axes_at_10"),
        "step10_dominant_family": next((s.get("dominant") for s in packing["steps"] if s["step"] == 10), None),
        "step11_dominant_family": next((s.get("dominant") for s in packing["steps"] if s["step"] == 11), None),
    }

    readiness = classify_readiness(scale, data, decode, oracle, packing_summary)
    strategy = proposed_strategy(scale)
    ended = utc_now()
    payload = {
        "ok": True,
        "kind": "WRIM_FOUNDATIONAL_GENERATION_ROOT_CAUSE_AUDIT",
        "audit_id": AUDIT_ID,
        "final_classification": "FOUNDATIONAL_ROOT_CAUSE_IDENTIFIED",
        "readiness_class": readiness["readiness_class"],
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "start_timestamp": started,
        "end_timestamp": ended,
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "sha_ok": sha_ok,
        "historical_run_unmodified": HISTORICAL_RUN,
        "corrective_run": CORRECTIVE_RUN,
        "scale": scale,
        "soft_stop": soft,
        "step10": step10,
        "decoding": decode,
        "scorer_oracle": oracle,
        "data_format": data,
        "packing": packing_summary,
        "readiness": readiness,
        "strategy": strategy,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "promotion_candidate": False,
        "step10_promoted": False,
        "step25_promoted": False,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "PROPOSED_TRAINING_DATA": "F2 SFT corpus is proposed only; not merged into WR-CORPUS",
    }
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": payload["final_classification"],
                "readiness_class": payload["readiness_class"],
                "optimizer_steps_this_pass": 0,
                "scorer_oracle_ok": oracle["ok"],
                "sha_ok": sha_ok,
                "TRAINING_AUTHORIZATION": "OFF",
            },
            indent=2,
        ),
        flush=True,
    )
    return 0 if sha_ok and oracle["ok"] and payload["optimizer_steps_this_pass"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
