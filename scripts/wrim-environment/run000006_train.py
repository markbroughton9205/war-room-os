"""WRIM1-RUN-000006 trainer.

THIS FILE DOES NOT TRAIN UNLESS BOTH are present:
  --authorize-wrim1-run-000006
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_RUN_000006_ONLY

The pre-training gate mission must never pass those. Default path writes a denial
report and returns without constructing AdamW or calling optimizer.step.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from run000006_identity import (
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
        "kind": "WRIM1_RUN_000006_TRAINING_DENIED",
        "run_id": RUN_ID,
        "reason": reason,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "optimizer_steps": 0,
        "AdamW_constructed": False,
        "training_executed": False,
    }


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    """Executed only after Commander authorization. Imported lazily so denial path has no optimizer."""
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from wrim_g20m import WRIM0Model
    from run000006_collision import assert_run_id_unused
    from run000006_gates import evaluate_gates, hard_stop_payload
    from run000006_identity import (
        BASELINE_SHA,
        BETAS,
        EPS,
        FULL_EVAL_STEPS,
        GRAD_CLIP,
        MAX_TOKENS,
        MICRO_BATCH,
        NEXT_UNAUTHORIZED_STEP,
        PACK_TARGET_TOKENS,
        PARENT_SHA,
        SEED,
        SEQ_LEN,
        STEPS,
        SUITE_SHA,
        TOKENIZER_SHA,
        TOKENS_PER_STEP,
        WEIGHT_DECAY,
    )
    from run000006_preflight import collision_roots, pack_balanced_genesis, resolve_dump_root, sha256_file
    from run000006_schedule import lr_run000006
    from safetensors_model import load_model_state_from_safetensors
    from stage1_pack import PackedUnit, slice_contiguous_batches
    from stage2_pack import _pack_selected, encode_corpus1_val_units, encode_rehearsal_val_units, take_until_budget
    from stage3_eval_baseline import concat_units
    from stage3_runtime import parent_pointer, utc_now, write_abort, write_json
    from stage3a_run import evaluate_candidate, load_baseline, load_suite, save_continuity, save_weights
    from run000006_pack import balanced_genesis_units, load_frozen_genesis_train_units
    from run000006_identity import LOCKED_MIX
    from experiment_pack import FROZEN_GENESIS_TRAIN_IDS, encode_raw_families, _wr_corpus_1_families
    from phase2_grid import annotate_stream

    ckpt_root = Path(args.ckpt)
    report_path = Path(args.report)
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

    packing = pack_balanced_genesis(dump, tokenizer_path)
    if not packing["decision"]["ok"]:
        payload = {**denial_payload("packing_preflight_fail"), "packing": packing}
        write_json(report_path, payload)
        return payload

    # Real training continues only past this point under Commander authorization.
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    model = WRIM0Model()
    load_model_state_from_safetensors(model, str(weights))
    model.to(device)
    suite = load_suite(Path(args.suite))
    baseline = load_baseline(Path(args.baseline))
    if not suite["hash_ok"] or suite["stored_hash"] != SUITE_SHA:
        payload = denial_payload("suite_hash_mismatch")
        write_json(report_path, payload)
        return payload
    if not baseline["hash_ok"] or baseline["sha256"] != BASELINE_SHA:
        payload = denial_payload("baseline_hash_mismatch")
        write_json(report_path, payload)
        return payload

    raw = encode_raw_families(dump, tokenizer)
    c1 = _wr_corpus_1_families(raw, SEED)
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
    buckets, docs = annotate_stream(interleaved)
    all_docs = list(FROZEN_GENESIS_TRAIN_IDS)
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump))
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "step-0" / "parent_pointer.json", parent_pointer(weights_path=weights, parent_sha=PARENT_SHA))

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None) -> dict[str, Any]:
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
            c1=c1,
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
        return ev

    eval0 = run_eval(0, None, 0, None)
    write_json(evals_dir / "step-0.json", eval0)
    g0 = evaluate_gates(eval0, eval_step=0)
    if g0["prevent_next_optimizer_step"]:
        payload = hard_stop_payload(reason="gate_at_step0", metric="pretrain_eval", value=g0, step=0, tokens=0)
        write_json(report_path, payload)
        return payload

    model.enable_training()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_run000006(1),
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
            abort = hard_stop_payload(reason="step_26_forbidden", metric="step", value=step, step=step - 1, tokens=tokens_seen)
            break
        x_np, y_np = batches[step - 1]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        for pg in optimizer.param_groups:
            pg["lr"] = lr_run000006(step)
        optimizer.zero_grad(set_to_none=True)
        logits = model(x)
        loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
        if not torch.isfinite(loss):
            abort = hard_stop_payload(reason="NaN_or_Inf_loss", metric="loss", value=str(loss.item()), step=step, tokens=tokens_seen)
            break
        loss.backward()
        grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        optimizer.step()
        tokens_seen += TOKENS_PER_STEP
        row = {"step": step, "loss": float(loss.item()), "lr": lr_run000006(step), "grad_norm": float(grad_norm), "tokens_seen": tokens_seen}
        metrics.append(row)
        (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8").write(json.dumps(row) + "\n")
        if step in FULL_EVAL_STEPS:
            if step in (5, 10, 15, 20):
                save_weights(ckpt_root / f"step-{step}", model, step, tokens_seen)
            ev = run_eval(step, float(loss.item()), tokens_seen, lr_run000006(step))
            ev["grad_norm"] = float(grad_norm)
            write_json(evals_dir / f"step-{step}.json", ev)
            gate = evaluate_gates(ev, eval_step=step)
            write_json(ckpt_root / f"gate-step-{step}.json", gate)
            if gate["prevent_next_optimizer_step"]:
                save_continuity(ckpt_root / f"step-{step}", model, optimizer, step, tokens_seen, {"packing_cursor": step})
                trig = (gate["triggers"] or [{}])[-1]
                abort = hard_stop_payload(
                    reason="HARD_STOP_GATE",
                    metric=str(trig.get("METRIC")),
                    value=trig.get("value"),
                    step=step,
                    tokens=tokens_seen,
                )
                abort["gate"] = gate
                break
    if abort is None:
        save_continuity(ckpt_root / "step-25", model, optimizer, 25, tokens_seen, {"packing_cursor": 25})
        summary = {
            "ok": True,
            "kind": "WRIM1_RUN_000006_TRAINING_COMPLETE_PENDING_REVIEW",
            "run_id": RUN_ID,
            "optimizer_steps": len(metrics),
            "tokens_seen": tokens_seen,
            "TRAINING_AUTHORIZATION": "OFF",
            "STAGE3B_AUTHORIZATION": "NO",
            "promotion_candidate": False,
        }
        write_json(report_path, summary)
        return summary
    abort["TRAINING_AUTHORIZATION"] = "OFF"
    write_json(report_path, abort)
    write_abort(ckpt_root, abort)
    return abort


def main() -> int:
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument(AUTHORIZE_FLAG, action="store_true")
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
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
    return 0 if out.get("kind") != "WRIM1_RUN_000006_TRAINING_DENIED" or out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
