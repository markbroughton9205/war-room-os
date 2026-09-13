"""WRIM1-RUN-000003 Stage 3 trainer / runtime.

Default: ZERO-OPTIMIZER-STEP dry-run.
Generic --mode train remains TRAINING_DENIED.
Authorized STAGE3A confirmation uses --mode stage3a only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from tokenizers import Tokenizer

from experiment_pack import encode_raw_families, pack_train_stream
from phase3a_interpolation import ALPHAS as PHASE3A_ALPHAS
from phase3a_interpolation import lerp_state
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import causal_batch_audit, slice_contiguous_batches
from stage2_eval import greedy_generate
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_runtime import (
    ADAMW,
    ARCHITECTURE,
    BASELINE_SHA,
    CHECKPOINT_SCHEME,
    CLASSIFICATION,
    EVAL_SCHEDULE,
    INTERPOLATION_HOOK,
    PARAM_COUNT,
    PARENT_SHA,
    PRECISION,
    REVIEW_BANDS,
    RUN_ID,
    SEED,
    SEGMENT_A,
    SEQ_LEN,
    STAGE3_AUTHORIZATION,
    STAGE3A_STEPS,
    STAGE3A_TOKEN_BUDGET,
    SUITE_ID,
    SUITE_SHA,
    TF32,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TRAINING_AUTHORIZATION,
    abort_payload,
    authorization_gate,
    disk_guard,
    parent_pointer,
    run_manifest_template,
    utc_now,
    write_abort,
    write_json,
)
from stage3_schedule import lr_stage3a, run_schedule_unit_tests, stage3a_table, stage3b_table
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

MICRO_BATCH = 8


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def tensors_sha256(state: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for k in sorted(state):
        t = state[k].detach().contiguous().cpu().float().numpy().tobytes()
        h.update(k.encode("utf-8"))
        h.update(t)
    return h.hexdigest()


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def load_suite(path: Path) -> dict[str, Any]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    items = obj.get("items") or []
    canonical = json.dumps(
        {"suite_id": obj.get("suite_id"), "suite_version": obj.get("suite_version"), "items": items},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    recomputed = sha256_text(canonical)
    cats = {}
    for it in items:
        cats[str(it.get("category"))] = cats.get(str(it.get("category")), 0) + 1
    return {
        "obj": obj,
        "n_items": len(items),
        "categories": cats,
        "stored_hash": obj.get("suite_hash"),
        "recomputed_hash": recomputed,
        "hash_ok": obj.get("suite_hash") == SUITE_SHA and recomputed == SUITE_SHA,
        "inventory_ok": len(items) == 35 and obj.get("suite_id") == SUITE_ID and len(cats) == 7 and all(v == 5 for v in cats.values()),
    }


def load_baseline(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    normalized = raw.replace("\r\n", "\n")
    digest = sha256_text(normalized)
    obj = json.loads(raw)
    self_kl = obj.get("self_kl") or {}
    return {
        "obj": obj,
        "sha256": digest,
        "hash_ok": digest == BASELINE_SHA and obj.get("kind") == "WRIM0_STAGE3_SUITE_BASELINE",
        "self_kl_pass": bool(self_kl.get("pass") is True and self_kl.get("mean") == 0 and self_kl.get("max") == 0),
        "n_items": len(obj.get("items") or []),
        "rewritten": False,
    }


def interpolation_wiring() -> dict[str, Any]:
    alphas = list(PHASE3A_ALPHAS)
    expected = list(INTERPOLATION_HOOK["alphas"])
    return {
        "ok": alphas == expected and callable(lerp_state),
        "alphas": alphas,
        "reuse": INTERPOLATION_HOOK["reuse"],
        "executed": False,
        "auto_promote": False,
        "classification": "TEST_ONLY",
        "note": "Wiring only. No lerp on live weights in this pass.",
    }


def optimizer_schema_probe(model: WRIM0Model) -> dict[str, Any]:
    """Construct AdamW to inspect serialization structure. NEVER step. NEVER backward."""
    opt = torch.optim.AdamW(
        model.parameters(),
        lr=lr_stage3a(1),
        betas=tuple(ADAMW["betas"]),
        eps=ADAMW["eps"],
        weight_decay=ADAMW["weight_decay"],
        fused=False,
    )
    state = opt.state_dict()
    schema = {
        "param_group_keys": sorted(state.get("param_groups", [{}])[0].keys()) if state.get("param_groups") else [],
        "n_param_groups": len(state.get("param_groups") or []),
        "state_entries_before_first_step": len(state.get("state") or {}),
        "expected_after_first_authorized_step": ["exp_avg", "exp_avg_sq", "step"],
        "fused": False,
        "step_called": False,
    }
    del opt
    return schema


def intended_training_loop_exists() -> bool:
    """The authorized STAGE3A loop is implemented below and is unreachable unless both flags open."""
    return True


def run_stage3a_training(
    *,
    model: WRIM0Model,
    batches: list,
    device: torch.device,
    ckpt_dir: Path,
) -> dict[str, Any]:
    """Canonical STAGE3A loop. Hard-gated. Must not run in this pass."""
    gate = authorization_gate(requested_mode="train")
    if not gate["allowed"]:
        return {"ok": False, "error": "TRAINING_DENIED", "gate": gate, "optimizer_steps": 0, "parameter_update_count": 0}
    # Unreachable with current compiled flags. Kept as the official loop for a later authorization.
    model.enable_training()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_stage3a(1),
        betas=tuple(ADAMW["betas"]),
        eps=ADAMW["eps"],
        weight_decay=ADAMW["weight_decay"],
        fused=False,
    )
    optimizer_steps = 0
    parameter_update_count = 0
    for step in range(1, STAGE3A_STEPS + 1):
        lr = lr_stage3a(step)
        for pg in optimizer.param_groups:
            pg["lr"] = lr
        x_np, y_np = batches[step - 1]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(x)
        loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
        if not bool(torch.isfinite(loss).item()):
            write_abort(ckpt_dir, abort_payload(reason="NaN_or_Inf_loss", step=step, extra={"loss": str(loss)}))
            return {"ok": False, "error": "HARD_STOP", "optimizer_steps": optimizer_steps}
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), ADAMW["grad_clip"])
        optimizer.step()
        optimizer_steps += 1
        parameter_update_count += 1
    return {"ok": True, "optimizer_steps": optimizer_steps, "parameter_update_count": parameter_update_count}


def smoke_eval_parent(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, prompt: str) -> dict[str, Any]:
    model.freeze_inference()
    gen = greedy_generate(model, tokenizer, prompt, device, max_new=8)
    return {
        "ok": bool(gen.get("finite")),
        "n_new": gen.get("n_new"),
        "finite": gen.get("finite"),
        "entropy": gen.get("entropy"),
        "special_loop": gen.get("special_loop"),
        "prompt_prefix": prompt[:80],
    }


def forward_batch_no_grad(model: WRIM0Model, batch: tuple[np.ndarray, np.ndarray], device: torch.device) -> dict[str, Any]:
    model.freeze_inference()
    x_np, y_np = batch
    with torch.inference_mode():
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        logits = model(x)
        loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
        finite = bool(torch.isfinite(loss).item()) and bool(torch.isfinite(logits).all().item())
    return {"ok": finite, "loss": float(loss.item()) if finite else None, "backward": False, "step": False}


def deny_train(report_path: Path) -> dict[str, Any]:
    gate = authorization_gate(requested_mode="train")
    payload = {
        "ok": False,
        "error": "TRAINING_DENIED",
        "gate": gate,
        "optimizer_steps": 0,
        "parameter_update_count": 0,
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "run_id": RUN_ID,
        "utc": utc_now(),
    }
    write_json(report_path, payload)
    return payload


def dry_run(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    suite_path: Path,
    baseline_path: Path,
    report_path: Path,
    ckpt_dir: Path,
) -> dict[str, Any]:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    pre_sha = sha256_file(weights)
    pre_mtime = weights.stat().st_mtime_ns
    tok_sha = sha256_file(tokenizer_path)
    schedule = run_schedule_unit_tests()
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    disk = disk_guard(ckpt_dir)
    gate_dry = authorization_gate(requested_mode="dry-run")
    gate_train = authorization_gate(requested_mode="train")

    mismatches = []
    if pre_sha != PARENT_SHA:
        mismatches.append("parent_sha")
    if tok_sha != TOKENIZER_SHA:
        mismatches.append("tokenizer_sha")
    if not suite["hash_ok"]:
        mismatches.append("suite_sha")
    if not baseline["hash_ok"]:
        mismatches.append("baseline_sha")
    if mismatches:
        payload = abort_payload(reason="sha_mismatch", step=0, extra={"mismatches": mismatches, "parent": pre_sha, "tokenizer": tok_sha})
        write_abort(ckpt_dir, payload)
        write_json(report_path, payload)
        return payload
    if disk["hard_stop"]:
        payload = abort_payload(reason="disk_below_32GB", step=0, extra={"disk": disk})
        write_abort(ckpt_dir, payload)
        write_json(report_path, payload)
        return payload

    disable_tf32()
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    raw_families = encode_raw_families(dump_root, tokenizer)
    packed = pack_train_stream(raw_families, tokenizer, strategy="NATURAL_BASELINE", seed=SEED, dump_root=dump_root)
    audit = packed["audit"]
    write_json(ckpt_dir / "packing-audit.json", audit)
    packing_ok = bool(audit.get("packing_ok"))
    if not packing_ok:
        payload = abort_payload(reason="packing_invariant_failure", step=0, extra={"audit": {"packing_ok": False, "mix": audit.get("mix_assertions")}})
        write_abort(ckpt_dir, payload)
        write_json(report_path, payload)
        return payload

    stream = packed["stream"]
    batches = slice_contiguous_batches(stream, STAGE3A_STEPS, MICRO_BATCH, SEQ_LEN)
    causal = causal_batch_audit(batches, stream)
    val0_units = encode_rehearsal_val_units(tokenizer, dump_root)
    val1_units = encode_corpus1_val_units(tokenizer, dump_root)
    val_loaders_ok = len(val0_units) > 0 and len(val1_units) > 0

    state, coverage = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        payload = abort_payload(reason="invalid_architecture_or_tensor_shape", step=0, extra={"coverage": coverage})
        write_abort(ckpt_dir, payload)
        write_json(report_path, payload)
        return payload
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.freeze_inference()
    model.to(device)
    n_params = int(sum(p.numel() for p in model.parameters()))
    mem_sha_before = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()})

    prompt = str((suite["obj"].get("items") or [{}])[0].get("prompt_text") or "The lantern")
    smoke = smoke_eval_parent(model, tokenizer, device, prompt)
    fwd = forward_batch_no_grad(model, batches[0], device)
    opt_schema = optimizer_schema_probe(model)
    interp = interpolation_wiring()

    pointer = parent_pointer(weights_path=weights, parent_sha=pre_sha)
    write_json(ckpt_dir / "parent-pointer.json", pointer)
    write_json(ckpt_dir / "CHECKPOINT_SCHEME.json", CHECKPOINT_SCHEME)
    write_json(ckpt_dir / "REVIEW_BANDS.json", REVIEW_BANDS)
    write_json(ckpt_dir / "EVAL_SCHEDULE.json", EVAL_SCHEDULE)
    manifest = run_manifest_template()
    manifest["hardware"] = {
        "device": str(device),
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "torch": torch.__version__,
        "precision": PRECISION,
        "tf32": TF32,
    }
    write_json(ckpt_dir / "run-manifest.dry-run.json", manifest)

    mem_sha_after = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()})
    post_sha = sha256_file(weights)
    post_mtime = weights.stat().st_mtime_ns
    immutable = pre_sha == post_sha == PARENT_SHA and pre_mtime == post_mtime and mem_sha_before == mem_sha_after
    trained_ckpt_present = (ckpt_dir / "model.safetensors").exists() or (ckpt_dir / "optimizer.safetensors").exists()

    payload = {
        "ok": bool(
            schedule["ok"]
            and suite["hash_ok"]
            and suite["inventory_ok"]
            and baseline["hash_ok"]
            and baseline["self_kl_pass"]
            and packing_ok
            and causal.get("ok")
            and smoke["ok"]
            and fwd["ok"]
            and interp["ok"]
            and immutable
            and n_params == PARAM_COUNT
            and not trained_ckpt_present
            and gate_train["decision"] == "TRAINING_DENIED"
            and disk["ok"]
        ),
        "kind": "STAGE3_ZERO_STEP_DRY_RUN",
        "run_id": RUN_ID,
        "segment": SEGMENT_A,
        "classification": CLASSIFICATION,
        "mode": "dry-run",
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "optimizer_steps": 0,
        "parameter_update_count": 0,
        "intended_training_loop_exists": intended_training_loop_exists(),
        "parent_sha_pre": pre_sha,
        "parent_sha_post": post_sha,
        "tokenizer_sha": tok_sha,
        "suite_sha": suite["stored_hash"],
        "baseline_sha": baseline["sha256"],
        "weight_immutability": immutable,
        "in_memory_tensor_sha_unchanged": mem_sha_before == mem_sha_after,
        "parent_mtime_unchanged": pre_mtime == post_mtime,
        "n_params": n_params,
        "architecture": ARCHITECTURE,
        "disk": disk,
        "schedule_tests": schedule,
        "stage3a_lr_table": stage3a_table(),
        "stage3b_lr_table": stage3b_table(),
        "suite_load": {
            "ok": suite["hash_ok"] and suite["inventory_ok"],
            "n_items": suite["n_items"],
            "categories": suite["categories"],
            "status": suite["obj"].get("status"),
        },
        "baseline_load": {
            "ok": baseline["hash_ok"] and baseline["self_kl_pass"],
            "self_kl": (baseline["obj"].get("self_kl")),
            "rewritten": False,
            "json_valid_count_preserved": 0,
            "known_collapse_items": ["s3-code-04", "s3-json-03", "s3-inst-04", "s3-long-05"],
        },
        "packing": {
            "ok": packing_ok,
            "seed": SEED,
            "rehearsal": audit.get("rehearsal_strategy"),
            "mix_assertions": audit.get("mix_assertions"),
            "bos": audit.get("bos_id"),
            "eos": audit.get("eos_id"),
            "per_token_shuffle": False,
            "causal_ok": causal.get("ok"),
            "n_batches": len(batches),
            "tokens_per_step": TOKENS_PER_STEP,
            "token_budget": STAGE3A_TOKEN_BUDGET,
        },
        "val_loaders_ok": val_loaders_ok,
        "smoke_eval": smoke,
        "forward_no_grad": fwd,
        "optimizer_schema": opt_schema,
        "interpolation_wiring": interp,
        "cap_eval_0": {"status": "COMPATIBILITY_ONLY", "replaced": False, "primary": False},
        "diagnostic_0": {"status": "COMPATIBILITY_ONLY", "id": "d0-json", "json_valid_baseline": False},
        "review_bands": REVIEW_BANDS,
        "checkpoint_scheme": CHECKPOINT_SCHEME,
        "eval_schedule": EVAL_SCHEDULE,
        "parent_pointer": pointer,
        "trained_checkpoint_written": trained_ckpt_present,
        "gate_dry_run": gate_dry,
        "gate_train": gate_train,
        "utc": utc_now(),
    }
    write_json(report_path, payload)
    write_json(ckpt_dir / "DRY_RUN.json", payload)
    print(json.dumps({k: payload.get(k) for k in ("ok", "error", "optimizer_steps", "parameter_update_count", "weight_immutability", "parent_sha_pre", "parent_sha_post")}, indent=2), flush=True)
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    ap.add_argument("--mode", choices=["dry-run", "train", "deny-probe", "stage3a"], default="dry-run")
    args = ap.parse_args()
    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    suite_path = Path(args.suite)
    baseline_path = Path(args.baseline)
    report_path = Path(args.report)
    ckpt_dir = Path(args.ckpt_dir)

    if args.mode == "stage3a":
        from stage3a_run import run_stage3a

        out = run_stage3a(
            weights=weights,
            tokenizer_path=tokenizer_path,
            dump_root=dump_root,
            suite_path=suite_path,
            baseline_path=baseline_path,
            report_path=report_path,
            ckpt_root=ckpt_dir,
        )
        if out.get("kind") == "ABORT" or (isinstance(out.get("abort"), dict) and out["abort"].get("present")):
            return 2
        return 0 if out.get("ok") else 1

    if args.mode in ("train", "deny-probe"):
        denied = deny_train(report_path if args.mode == "deny-probe" else report_path.with_name("stage3-train-denied.json"))
        print(json.dumps(denied, indent=2), flush=True)
        return 0 if denied.get("error") == "TRAINING_DENIED" and denied.get("optimizer_steps") == 0 else 3

    out = dry_run(
        weights=weights,
        tokenizer_path=tokenizer_path,
        dump_root=dump_root,
        suite_path=suite_path,
        baseline_path=baseline_path,
        report_path=report_path,
        ckpt_dir=ckpt_dir,
    )
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
