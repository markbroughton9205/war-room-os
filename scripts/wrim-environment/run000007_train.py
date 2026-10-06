"""WRIM1-RUN-000007 trainer.

THIS FILE DOES NOT TRAIN UNLESS BOTH are present:
  --authorize-wrim1-run-000007
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_RUN_000007_ONLY

The pre-training gate mission must never pass those. Default path writes a denial
report and returns without constructing AdamW or calling optimizer.step.

Proven load path (RUN-000006 execution contract):
  disable_tf32() after seeding
  state, _coverage = load_model_state_from_safetensors(weights)
  model.load_state_dict(state, strict=True)
Imported from wrim_proven_load — not from a dirty run000006_train.py working tree.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from run000007_identity import (
    AUTHORIZE_ENV,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    RUN_ID,
    STAGE3B_AUTHORIZATION,
    TRAINING_AUTHORIZATION,
)


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    return AUTHORIZE_FLAG in args and os.environ.get(AUTHORIZE_ENV) == AUTHORIZE_ENV_VALUE


def denial_payload(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "WRIM1_RUN_000007_TRAINING_DENIED",
        "run_id": RUN_ID,
        "reason": reason,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "optimizer_steps": 0,
        "OPTIMIZER_STEPS": 0,
        "AdamW_constructed": False,
        "training_executed": False,
    }


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    """Executed only after Commander authorization. Imported lazily so denial path has no optimizer."""
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from experiment_pack import FROZEN_GENESIS_TRAIN_IDS
    from phase2_grid import annotate_stream
    from run000007_collision import assert_run_id_unused
    from run000007_env import verify_linux_env
    from run000007_gates import annotate_eval_snapshot, evaluate_gates, hard_stop_payload
    from run000007_identity import (
        ADDENDUM_SHA,
        BASELINE_SHA,
        BETAS,
        EPS,
        FULL_EVAL_STEPS,
        GRAD_CLIP,
        LINUX_VENV_PYTHON,
        LOCKED_MIX,
        MAX_TOKENS,
        MICRO_BATCH,
        NEXT_UNAUTHORIZED_STEP,
        PARENT_SHA,
        SEED,
        SEQ_LEN,
        STEPS,
        SUITE_SHA,
        TOKENIZER_SHA,
        TOKENS_PER_STEP,
        WEIGHT_DECAY,
    )
    from run000006_integrity import hash_reference_nll_path
    from run000006_instruction_addendum_eval import eval_checkpoint, summarize as summarize_addendum
    from run000007_identity import ADDENDUM_SHA as ADDENDUM_CANONICAL_SHA
    from run000007_identity import REFERENCE_NLL_CANONICAL_LF_SHA
    from run000007_pack import pack_run000007_stream
    from run000007_preflight import collision_roots, locate_addendum, locate_reference_nll, resolve_dump_root, sha256_file, suite_canonical_sha256
    from run000007_schedule import lr_run000007
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from stage1_pack import slice_contiguous_batches
    from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
    from stage3_eval_baseline import concat_units
    from stage3_runtime import parent_pointer, write_abort, write_json
    from stage3a_run import evaluate_candidate, load_baseline, load_suite, save_continuity, save_weights
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32, load_parent_into_model

    ckpt_root = Path(args.ckpt)
    report_path = Path(args.report)
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    if not env["ok"]:
        payload = {**denial_payload("training_environment_mismatch"), "env": env}
        write_json(report_path, payload)
        return payload

    if ckpt_root.exists() and any(ckpt_root.rglob("model.safetensors")):
        payload = denial_payload("run_directory_already_has_weights")
        write_json(report_path, payload)
        return payload

    dump = resolve_dump_root(args.dump_root)
    if dump is None:
        payload = denial_payload("dump_root_missing")
        write_json(report_path, payload)
        return payload

    coll = assert_run_id_unused(RUN_ID, collision_roots(Path(args.data_root)))
    if not coll["ok"]:
        payload = {**denial_payload("run_id_collision"), "collision": coll}
        write_json(report_path, payload)
        return payload

    weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    tokenizer_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(weights) != PARENT_SHA or sha256_file(tokenizer_path) != TOKENIZER_SHA:
        payload = denial_payload("parent_or_tokenizer_hash_mismatch")
        write_json(report_path, payload)
        return payload

    packing = pack_run000007_stream(dump, tokenizer_path)
    if not packing["decision"]["ok"]:
        payload = {**denial_payload("packing_preflight_fail"), "packing": packing}
        write_json(report_path, payload)
        return payload
    if packing.get("EVAL_DUMP_LEAKAGE") != "NONE" or packing.get("INSTRUCTION_ADDENDUM_LEAKAGE") != "NONE":
        payload = {**denial_payload("eval_or_addendum_leakage"), "packing": packing}
        write_json(report_path, payload)
        return payload

    nll_path = locate_reference_nll(Path(args.data_root))
    nll = hash_reference_nll_path(nll_path) if nll_path else None
    if not nll or nll.get("CANONICAL_LF_SHA256") != REFERENCE_NLL_CANONICAL_LF_SHA:
        payload = {**denial_payload("reference_nll_mismatch"), "reference_nll": nll}
        write_json(report_path, payload)
        return payload

    addendum_path = Path(args.addendum) if getattr(args, "addendum", None) else locate_addendum(Path(args.data_root))
    if addendum_path is None or not addendum_path.is_file():
        payload = denial_payload("addendum_missing")
        write_json(report_path, payload)
        return payload
    addendum_hash = suite_canonical_sha256(addendum_path)
    if addendum_hash != ADDENDUM_SHA:
        payload = {**denial_payload("addendum_hash_mismatch"), "addendum_hash": addendum_hash}
        write_json(report_path, payload)
        return payload
    addendum_obj = json.loads(addendum_path.read_text(encoding="utf-8"))
    addendum_items = list(addendum_obj.get("items") or [])

    ollama_restored = False
    vram = ensure_vram_for_training()
    ollama_active_before = bool(vram.get("OLLAMA_ACTIVE_BEFORE"))
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not vram["ok"]:
        payload = {**denial_payload("insufficient_vram"), "vram": vram, "OLLAMA_ACTIVE_BEFORE": ollama_active_before, "OLLAMA_STOPPED_FOR_TRAINING": ollama_stopped}
        if ollama_stopped:
            start_user_ollama()
            ollama_restored = True
            payload["OLLAMA_RESTORED"] = True
        write_json(report_path, payload)
        payload["TRAINING_AUTHORIZATION"] = "OFF"
        return payload

    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    model = WRIM0Model()
    load_parent_into_model(model, weights)
    model.to(device)
    suite = load_suite(Path(args.suite))
    baseline = load_baseline(Path(args.baseline))
    if not suite["hash_ok"] or suite["stored_hash"] != SUITE_SHA:
        payload = denial_payload("suite_hash_mismatch")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    if not baseline["hash_ok"] or baseline["sha256"] != BASELINE_SHA:
        payload = denial_payload("baseline_hash_mismatch")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    from stage2_pack import _pack_selected
    from run000007_pack import encode_corpus1_filtered, scan_corpus1_filter
    from experiment_pack import _wr_corpus_1_families, encode_behavior_units
    from run000006_pack import balanced_genesis_units, load_frozen_genesis_train_units, Unit
    from stage1_pack import PackedUnit
    from stage2_pack import take_until_budget
    from run000007_identity import PACK_TARGET_TOKENS

    scan = scan_corpus1_filter(dump)
    kept = scan.pop("_kept")
    c1_raw = encode_corpus1_filtered(tokenizer, dump, kept)
    behavior = encode_behavior_units(tokenizer, dump)
    c1 = _wr_corpus_1_families(
        {"prose": list(c1_raw.get("prose") or []), "code": list(c1_raw.get("code") or []), "json": list(c1_raw.get("json") or []), "behavior": list(behavior)},
        SEED,
    )
    genesis_raw = load_frozen_genesis_train_units(dump)
    selected = []
    for fam, frac in LOCKED_MIX.items():
        budget = int(PACK_TARGET_TOKENS * frac)
        if fam == "wr_corpus_0":
            taken_u = balanced_genesis_units(genesis_raw, SEED, budget)
            taken = [
                PackedUnit(
                    unit_id=u.unit_id,
                    bucket=u.bucket,
                    origin=u.origin,
                    tokens=np.array(u.tokens, dtype=np.int32),
                    n_eos=int(sum(1 for t in u.tokens if t == 2)),
                    n_bos=int(sum(1 for t in u.tokens if t == 1)),
                )
                for u in taken_u
            ]
        else:
            taken = take_until_budget(c1.get(fam, []), budget)
        selected.extend(taken)
    stream, meta = _pack_selected(selected, MAX_TOKENS + 1)
    batches = slice_contiguous_batches(stream, STEPS, MICRO_BATCH, SEQ_LEN)
    interleaved = meta["interleaved_units"]
    annotate_stream(interleaved)
    del FROZEN_GENESIS_TRAIN_IDS, Unit
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1v = concat_units(encode_corpus1_val_units(tokenizer, dump))
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "step-0" / "parent_pointer.json", parent_pointer(weights_path=weights, parent_sha=PARENT_SHA))

    parent_eval_hold: dict[str, Any] | None = None
    addendum_parent_rows: list[dict[str, Any]] | None = None
    addendum_by_step: dict[str, Any] = {}
    checkpoints: list[dict[str, Any]] = []
    gates_by_step: dict[str, Any] = {}

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None) -> dict[str, Any]:
        nonlocal parent_eval_hold, addendum_parent_rows
        ev = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump,
            suite_items=suite["obj"]["items"],
            frozen_items=baseline["obj"]["items"],
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=c0,
            c1=c1v,
            greedy_256=True,
            step=step,
            train_loss=train_loss,
            tokens=tokens,
            lr=lr,
        )
        cats = ev.get("category_aggregates") or {}
        ev["json_n_collapsed"] = int((cats.get("JSON_STRUCTURED_OUTPUT") or {}).get("n_collapsed") or 0)
        ev["code_n_collapsed"] = int((cats.get("CODE") or {}).get("n_collapsed") or 0)
        ev["n_collapsed_256"] = int(ev.get("n_collapsed") or 0)
        cap = ev.get("cap_eval_0") or {}
        ev["cap_items"] = list(cap.get("items") or [])
        ev["historical_binary"] = cap.get("historical_binary") or ev.get("historical_binary")
        parent_cap = list((parent_eval_hold or {}).get("cap_items") or [])
        ev["NEW_CAP_FAILURES_VS_PARENT"] = [
            str(x.get("evalId"))
            for x in ev["cap_items"]
            if any(str(p.get("evalId")) == str(x.get("evalId")) and p.get("binary_pass") is True and x.get("binary_pass") is not True for p in parent_cap)
        ]
        ev = annotate_eval_snapshot(ev, parent_eval_hold)
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
        add_rows = eval_checkpoint(model=model, tokenizer=tokenizer, device=device, items=addendum_items)
        add_sum = summarize_addendum(add_rows, addendum_parent_rows)
        ev["instruction_addendum"] = {"summary": add_sum, "items": add_rows}
        addendum_by_step[str(step)] = add_sum
        write_json(evals_dir / f"addendum-step-{step}.json", {"step": step, "summary": add_sum, "items": add_rows})
        if step == 0:
            parent_eval_hold = ev
            addendum_parent_rows = add_rows
        return ev

    try:
        eval0 = run_eval(0, None, 0, None)
        write_json(evals_dir / "step-0.json", eval0)
        g0 = evaluate_gates(eval0, eval_step=0, parent_eval=parent_eval_hold)
        gates_by_step["0"] = g0
        write_json(ckpt_root / "gate-step-0.json", g0)
        if g0["prevent_next_optimizer_step"]:
            payload = hard_stop_payload(reason="gate_at_step0", metric="pretrain_eval", value=g0, step=0, tokens=0)
            payload["TRAINING_AUTHORIZATION"] = "OFF"
            payload["OLLAMA_ACTIVE_BEFORE"] = ollama_active_before
            payload["OLLAMA_STOPPED_FOR_TRAINING"] = ollama_stopped
            write_json(report_path, payload)
            return payload

        model.enable_training()
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=lr_run000007(1),
            betas=tuple(BETAS),
            eps=EPS,
            weight_decay=WEIGHT_DECAY,
            fused=False,
        )
        metrics: list[dict[str, Any]] = []
        tokens_seen = 0
        abort: dict[str, Any] | None = None
        for step in range(1, STEPS + 1):
            if step >= NEXT_UNAUTHORIZED_STEP:
                abort = hard_stop_payload(reason="step_11_forbidden", metric="step", value=step, step=step - 1, tokens=tokens_seen)
                abort["TRAINING_AUTHORIZATION"] = "OFF"
                break
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = lr_run000007(step)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
            if not torch.isfinite(loss):
                abort = hard_stop_payload(reason="NaN_or_Inf_loss", metric="loss", value=str(loss.item()), step=step, tokens=tokens_seen)
                abort["TRAINING_AUTHORIZATION"] = "OFF"
                break
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {"step": step, "loss": float(loss.item()), "lr": lr_run000007(step), "grad_norm": float(grad_norm), "tokens_seen": tokens_seen}
            metrics.append(row)
            (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8").write(json.dumps(row) + "\n")
            if step in FULL_EVAL_STEPS:
                if step in (5, 6, 8):
                    meta = save_weights(ckpt_root / f"step-{step}", model, step, tokens_seen)
                    checkpoints.append(meta)
                ev = run_eval(step, float(loss.item()), tokens_seen, lr_run000007(step))
                ev["grad_norm"] = float(grad_norm)
                write_json(evals_dir / f"step-{step}.json", ev)
                gate = evaluate_gates(ev, eval_step=step, parent_eval=parent_eval_hold)
                gates_by_step[str(step)] = gate
                write_json(ckpt_root / f"gate-step-{step}.json", gate)
                if gate["prevent_next_optimizer_step"]:
                    meta = save_continuity(ckpt_root / f"step-{step}", model, optimizer, step, tokens_seen, {"packing_cursor": step})
                    checkpoints.append(meta)
                    trig = (gate["triggers"] or [{}])[-1]
                    abort = hard_stop_payload(
                        reason="HARD_STOP_GATE",
                        metric=str(trig.get("METRIC")),
                        value=trig.get("value"),
                        step=step,
                        tokens=tokens_seen,
                    )
                    abort["gate"] = gate
                    abort["TRAINING_AUTHORIZATION"] = "OFF"
                    break
        if abort is None:
            meta = save_continuity(ckpt_root / "step-10", model, optimizer, 10, tokens_seen, {"packing_cursor": 10})
            checkpoints.append(meta)
            summary = {
                "ok": True,
                "kind": "WRIM1_RUN_000007_TRAINING_COMPLETE_PENDING_REVIEW",
                "run_id": RUN_ID,
                "optimizer_steps": len(metrics),
                "tokens_seen": tokens_seen,
                "TRAINING_AUTHORIZATION": "OFF",
                "STAGE3B_AUTHORIZATION": "NO",
                "promotion_candidate": False,
                "checkpoints": checkpoints,
                "gates": gates_by_step,
                "metrics": metrics,
                "instruction_addendum_by_step": addendum_by_step,
                "packing": {
                    "EXCLUDED_RECORD_IDS": packing.get("EXCLUDED_RECORD_IDS"),
                    "EXCLUDED_TOKEN_COUNT": packing.get("EXCLUDED_TOKEN_COUNT"),
                    "STARVED_DOC_IDS": packing.get("STARVED_DOC_IDS"),
                    "MAX_REHEARSAL_DOC_SHARE": packing.get("MAX_REHEARSAL_DOC_SHARE"),
                    "ACTUAL_PACKED_MIX": packing.get("ACTUAL_PACKED_MIX"),
                    "EVAL_DUMP_LEAKAGE": packing.get("EVAL_DUMP_LEAKAGE"),
                    "INSTRUCTION_ADDENDUM_LEAKAGE": packing.get("INSTRUCTION_ADDENDUM_LEAKAGE"),
                },
                "OLLAMA_ACTIVE_BEFORE": ollama_active_before,
                "OLLAMA_STOPPED_FOR_TRAINING": ollama_stopped,
                "VRAM_FREE_BEFORE_TRAINING": vram.get("VRAM_FREE_BEFORE_TRAINING"),
            }
            write_json(report_path, summary)
            return summary
        abort["TRAINING_AUTHORIZATION"] = "OFF"
        abort["OLLAMA_ACTIVE_BEFORE"] = ollama_active_before
        abort["OLLAMA_STOPPED_FOR_TRAINING"] = ollama_stopped
        abort["checkpoints"] = checkpoints
        abort["gates"] = gates_by_step
        abort["metrics"] = metrics
        abort["instruction_addendum_by_step"] = addendum_by_step
        write_json(report_path, abort)
        write_abort(ckpt_root, abort)
        return abort
    finally:
        if ollama_stopped:
            restore = start_user_ollama()
            ollama_restored = bool(restore.get("restored"))
            sidecar = ckpt_root / "ollama-restore.json"
            write_json(sidecar, {"OLLAMA_RESTORED": ollama_restored, **restore})
        write_json(ckpt_root / "training-authorization-off.json", {"TRAINING_AUTHORIZATION": "OFF", "run_id": RUN_ID})


def main() -> int:
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument(AUTHORIZE_FLAG, action="store_true")
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--addendum", default=None)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--report", required=True)
    args, _unknown = ap.parse_known_args()
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    if not authorization_ok(sys.argv[1:]):
        payload = denial_payload("TRAINING_AUTHORIZATION_OFF_OR_FLAG_MISSING")
        report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, indent=2))
        return 0
    out = run_authorized_training(args)
    print(json.dumps({k: out.get(k) for k in ("ok", "kind", "run_id", "optimizer_steps", "TRAINING_AUTHORIZATION")}, indent=2, default=str))
    return 0 if out.get("kind") != "WRIM1_RUN_000007_TRAINING_DENIED" or out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
