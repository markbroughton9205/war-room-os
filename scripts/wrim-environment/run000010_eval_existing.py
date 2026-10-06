"""Eval an existing WRIM1-RUN-000010 weight checkpoint. Does not train. Does not construct an optimizer."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from run000010_identity import ADDENDUM_SHA, BASELINE_SHA, EVAL_SEED, LINUX_DATA_ROOT, PARENT_SHA, SUITE_SHA, TOKENIZER_SHA
from run000010_schedule import lr_run000010
from stage3_runtime import write_json


def eval_existing_step(*, dump: Path, ckpt_root: Path, suite_path: Path, baseline_path: Path, addendum_path: Path, step: int) -> dict[str, Any]:
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from run000006_instruction_addendum_eval import eval_checkpoint, summarize as summarize_addendum
    from run000007_gates import annotate_eval_snapshot, evaluate_gates
    from run000007_preflight import sha256_file, suite_canonical_sha256
    from run000008_capability_eval import eval_capability_items
    from run000008_correctness import category_correctness
    from run000008_dataset import DATASET_DIRNAME, VAL_NAME, load_jsonl as load_cap_jsonl
    from run000010_dataset import DATASET_DIRNAME as ME_DIR, VAL_NAME as ME_VAL
    from run000010_diagnostics import classify_eval_items, delta_teacher_force_me, s3_inst_02_trace, teacher_force_capability
    from run000010_train import basin_counts_from_eval
    from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
    from stage3_eval_baseline import concat_units
    from stage3a_run import evaluate_candidate, load_baseline, load_suite
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32, load_parent_into_model

    weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    tokenizer_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    cand = ckpt_root / f"step-{step}" / "model.safetensors"
    if not cand.is_file():
        raise FileNotFoundError(cand)
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    parent_model = WRIM0Model()
    load_parent_into_model(parent_model, weights)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in parent_model.state_dict().items()}
    del parent_model
    from safetensors.torch import load_file

    model = WRIM0Model()
    native = load_file(str(cand))
    model.load_state_dict(native, strict=True)
    model.to(device)
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    if not suite["hash_ok"] or suite["stored_hash"] != SUITE_SHA:
        raise RuntimeError("suite hash mismatch")
    if not baseline["hash_ok"] or baseline["sha256"] != BASELINE_SHA:
        raise RuntimeError("baseline hash mismatch")
    if sha256_file(weights) != PARENT_SHA or sha256_file(tokenizer_path) != TOKENIZER_SHA:
        raise RuntimeError("parent/tokenizer mismatch")
    addendum_hash = suite_canonical_sha256(addendum_path)
    if addendum_hash != ADDENDUM_SHA:
        raise RuntimeError("addendum hash mismatch")
    addendum_items = list(json.loads(addendum_path.read_text(encoding="utf-8")).get("items") or [])
    cap_val_items = load_cap_jsonl(Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / VAL_NAME)
    me_val_items = load_cap_jsonl(Path(LINUX_DATA_ROOT) / ME_DIR / ME_VAL)
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1v = concat_units(encode_corpus1_val_units(tokenizer, dump))
    parent_eval = json.loads((ckpt_root / "evals" / "step-0.json").read_text(encoding="utf-8"))
    parent_tf_me = json.loads((ckpt_root / "evals" / "teacher-forced-step-0.json").read_text(encoding="utf-8")).get("mode_entry")
    parent_ids02 = []
    d0 = next((it.get("descriptive_256") or {} for it in (parent_eval.get("items") or []) if it.get("item_id") == "s3-inst-02"), {})
    parent_ids02 = [int(x) for x in (d0.get("new_ids") or [])]
    addendum_parent_rows = json.loads((ckpt_root / "evals" / "addendum-step-0.json").read_text(encoding="utf-8")).get("items")

    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    metrics_by_step = {json.loads(ln)["step"]: json.loads(ln) for ln in (ckpt_root / "metrics.jsonl").read_text().splitlines() if ln.strip()}
    row = metrics_by_step.get(step) or {}
    ev = evaluate_candidate(
        model=model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump,
        suite_items=suite["obj"]["items"],
        frozen_items=baseline["obj"]["items"],
        wrim0_logp={},
        parent_cpu=parent_cpu,
        c0=c0,
        c1=c1v,
        greedy_256=True,
        step=step,
        train_loss=row.get("loss"),
        tokens=int(row.get("tokens_seen") or step * 4096),
        lr=lr_run000010(step) if step >= 1 else None,
    )
    cats = ev.get("category_aggregates") or {}
    ev["json_n_collapsed"] = int((cats.get("JSON_STRUCTURED_OUTPUT") or {}).get("n_collapsed") or 0)
    ev["code_n_collapsed"] = int((cats.get("CODE") or {}).get("n_collapsed") or 0)
    ev["n_collapsed_256"] = int(ev.get("n_collapsed") or 0)
    cap = ev.get("cap_eval_0") or {}
    ev["cap_items"] = list(cap.get("items") or [])
    ev["historical_binary"] = cap.get("historical_binary") or ev.get("historical_binary")
    parent_cap = list(parent_eval.get("cap_items") or [])
    ev["NEW_CAP_FAILURES_VS_PARENT"] = [
        str(x.get("evalId"))
        for x in ev["cap_items"]
        if any(str(p.get("evalId")) == str(x.get("evalId")) and p.get("binary_pass") is True and x.get("binary_pass") is not True for p in parent_cap)
    ]
    ev = annotate_eval_snapshot(ev, parent_eval)
    inst = ev.get("s3_inst_02") or {}
    first = inst.get("first_token_id")
    if first is not None:
        ev["S3_INST_02_FIRST_TOKEN"] = first
        try:
            ev["S3_INST_02_FIRST_TOKEN_TEXT"] = tokenizer.decode([int(first)])
        except Exception:
            ev["S3_INST_02_FIRST_TOKEN_TEXT"] = None
    ev["S3_INST_02_MAX_RUN_256"] = inst.get("max_run_256")
    ev["S3_INST_02_GENERATION_HASH"] = inst.get("token_id_sha256_256")
    d02 = next((it.get("descriptive_256") or {} for it in (ev.get("items") or []) if it.get("item_id") == "s3-inst-02"), {})
    ids02 = [int(x) for x in (d02.get("new_ids") or [])]
    trace = s3_inst_02_trace(tokenizer, ids02, parent_ids02)
    ev.update({f"S3_INST_02_{k}": v for k, v in trace.items()})
    corr = category_correctness(list(ev.get("items") or []))
    ev["stage3_correctness"] = corr
    add_rows = eval_checkpoint(model=model, tokenizer=tokenizer, device=device, items=addendum_items)
    add_sum = summarize_addendum(add_rows, addendum_parent_rows)
    ev["instruction_addendum"] = {"summary": add_sum, "items": add_rows}
    evals_dir = ckpt_root / "evals"
    write_json(evals_dir / f"addendum-step-{step}.json", {"step": step, "summary": add_sum, "items": add_rows})
    cap_sum = eval_capability_items(model=model, tokenizer=tokenizer, device=device, items=cap_val_items)
    cap_items = cap_sum.pop("items")
    ev["capability_validation"] = cap_sum
    write_json(evals_dir / f"capability-step-{step}.json", {"step": step, "summary": cap_sum, "items": cap_items})
    me_sum = eval_capability_items(model=model, tokenizer=tokenizer, device=device, items=me_val_items)
    me_items = me_sum.pop("items")
    ev["mode_entry_validation"] = me_sum
    write_json(evals_dir / f"mode-entry-step-{step}.json", {"step": step, "summary": me_sum, "items": me_items})
    cap_tf_items = [x for x in cap_val_items if str(x.get("category") or "") in {"instruction", "stopping"}]
    tf = teacher_force_capability(model=model, tokenizer=tokenizer, device=device, items=cap_tf_items)
    tf.pop("items", None)
    tf_me = teacher_force_capability(model=model, tokenizer=tokenizer, device=device, items=me_val_items)
    tf_me_items = tf_me.pop("items")
    ev["teacher_forced"] = tf
    ev["teacher_forced_mode_entry"] = tf_me
    ev["teacher_forced_delta"] = delta_teacher_force_me(tf_me, parent_tf_me)
    write_json(evals_dir / f"teacher-forced-step-{step}.json", {"step": step, "mode_entry": tf_me, "capability_instruction_stopping": tf, "items": tf_me_items, "delta": ev["teacher_forced_delta"]})
    cap_basins = classify_eval_items(cap_items)
    s3_basins = classify_eval_items(list(ev.get("items") or []))
    me_basins = classify_eval_items(me_items)
    ev["capability_basins"] = {"counts": cap_basins["counts"], "n": cap_basins["n"]}
    ev["stage3_basins"] = {"counts": s3_basins["counts"], "n": s3_basins["n"]}
    ev["mode_entry_basins"] = {"counts": me_basins["counts"], "n": me_basins["n"]}
    ev["basin_counts"] = basin_counts_from_eval(ev)
    write_json(evals_dir / f"basins-step-{step}.json", {"step": step, "capability": cap_basins, "stage3": s3_basins, "mode_entry": me_basins, "combined": ev["basin_counts"]})
    ev["grad_norm"] = row.get("grad_norm")
    write_json(evals_dir / f"step-{step}.json", ev)
    gate = evaluate_gates(ev, eval_step=step, parent_eval=parent_eval)
    write_json(ckpt_root / f"gate-step-{step}.json", gate)
    return {"ok": True, "step": step, "gate": gate.get("STATE"), "optimizer_constructed": False, "training_executed": False}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--addendum", required=True)
    ap.add_argument("--step", type=int, required=True)
    args = ap.parse_args()
    out = eval_existing_step(
        dump=Path(args.dump_root),
        ckpt_root=Path(args.ckpt),
        suite_path=Path(args.suite),
        baseline_path=Path(args.baseline),
        addendum_path=Path(args.addendum),
        step=int(args.step),
    )
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
