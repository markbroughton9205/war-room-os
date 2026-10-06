"""Durable resumable WRIM training checkpoints.

Does not train. Does not construct an optimizer except when restoring one
the caller already created. Writes are atomic (temp dir + rename).
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STEP_DIR_RE = re.compile(r"^step-(\d+)$")
MANIFEST_NAME = "resume-manifest.json"
HASHES_NAME = "hashes.json"
MODEL_NAME = "model.safetensors"
OPTIMIZER_NAME = "optimizer.pt"
SCHEDULER_NAME = "scheduler.pt"
RNG_NAME = "rng-state.pt"
STREAM_NAME = "stream-state.json"
CURRICULUM_NAME = "curriculum-state.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def schedule_hash(table: dict[str, float]) -> str:
    return sha256_text(canonical_json({str(k): float(v) for k, v in sorted(table.items(), key=lambda kv: int(kv[0]))}))


def _fsync_file(path: Path) -> None:
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(path: Path) -> None:
    fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def capture_rng() -> dict[str, Any]:
    import numpy as np
    import torch

    payload: dict[str, Any] = {
        "python": random.getstate(),
        "numpy": np.random.get_state(),
        "torch_cpu": torch.random.get_rng_state().cpu(),
        "torch_cuda": None,
        "torch_cuda_all": None,
    }
    if torch.cuda.is_available():
        payload["torch_cuda"] = torch.cuda.get_rng_state().cpu()
        try:
            payload["torch_cuda_all"] = [s.cpu() for s in torch.cuda.get_rng_state_all()]
        except Exception:
            payload["torch_cuda_all"] = None
    return payload


def restore_rng(payload: dict[str, Any]) -> None:
    import numpy as np
    import torch

    random.setstate(payload["python"])
    np.random.set_state(payload["numpy"])
    torch.random.set_rng_state(payload["torch_cpu"])
    if torch.cuda.is_available():
        if payload.get("torch_cuda_all"):
            torch.cuda.set_rng_state_all(payload["torch_cuda_all"])
        elif payload.get("torch_cuda") is not None:
            torch.cuda.set_rng_state(payload["torch_cuda"])


def rng_hashes(payload: dict[str, Any]) -> dict[str, str | None]:
    import torch

    def tensor_hash(t: Any) -> str | None:
        if t is None:
            return None
        if isinstance(t, list):
            h = hashlib.sha256()
            for item in t:
                h.update(item.detach().cpu().contiguous().numpy().tobytes())
            return h.hexdigest()
        if torch.is_tensor(t):
            return hashlib.sha256(t.detach().cpu().contiguous().numpy().tobytes()).hexdigest()
        return sha256_text(repr(t))

    return {
        "python": sha256_text(repr(payload.get("python"))),
        "numpy": sha256_text(repr(payload.get("numpy"))),
        "torch_cpu": tensor_hash(payload.get("torch_cpu")),
        "torch_cuda": tensor_hash(payload.get("torch_cuda")),
        "torch_cuda_all": tensor_hash(payload.get("torch_cuda_all")),
    }


def is_complete_checkpoint(path: Path) -> bool:
    man = path / MANIFEST_NAME
    if not man.is_file():
        return False
    try:
        obj = json.loads(man.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if obj.get("RESUME_MANIFEST_COMPLETE") is not True:
        return False
    required = (MODEL_NAME, OPTIMIZER_NAME, SCHEDULER_NAME, RNG_NAME, STREAM_NAME, CURRICULUM_NAME, HASHES_NAME)
    return all((path / name).is_file() for name in required)


def list_complete_checkpoints(run_root: Path) -> list[Path]:
    if not run_root.is_dir():
        return []
    found = []
    for child in run_root.iterdir():
        if not child.is_dir() or child.name.endswith(".partial"):
            continue
        m = STEP_DIR_RE.match(child.name)
        if not m:
            continue
        if is_complete_checkpoint(child):
            found.append(child)
    found.sort(key=lambda p: int(STEP_DIR_RE.match(p.name).group(1)))
    return found


def latest_complete_checkpoint(run_root: Path) -> Path | None:
    found = list_complete_checkpoints(run_root)
    return found[-1] if found else None


def load_manifest(path: Path) -> dict[str, Any]:
    return json.loads((path / MANIFEST_NAME).read_text(encoding="utf-8"))


def verify_checkpoint_hashes(path: Path) -> dict[str, Any]:
    man = load_manifest(path)
    hashes = json.loads((path / HASHES_NAME).read_text(encoding="utf-8"))
    mismatches = []
    for name, expected in hashes.items():
        if name in {HASHES_NAME, MANIFEST_NAME}:
            continue
        fp = path / name
        if not fp.is_file():
            mismatches.append({"file": name, "reason": "missing"})
            continue
        got = sha256_file(fp)
        if got != expected:
            mismatches.append({"file": name, "expected": expected, "got": got})
    return {"ok": len(mismatches) == 0, "mismatches": mismatches, "manifest_complete": man.get("RESUME_MANIFEST_COMPLETE") is True}


def verify_resume_identity(manifest: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "PARENT_HASH",
        "TOKENIZER_HASH",
        "STAGE3_HASH",
        "INSTRUCTION_ADDENDUM_HASH",
        "TRAIN_DATASET_HASHES",
        "VALIDATION_DATASET_HASHES",
        "LR_SCHEDULE_HASH",
        "TRAINER_PROVENANCE_HASH",
        "PACKER_PROVENANCE_HASH",
        "RUN_ID",
    ]
    mismatches = []
    for key in keys:
        if key not in expected:
            continue
        if manifest.get(key) != expected.get(key):
            mismatches.append({"key": key, "reason": f"{key}_MISMATCH", "manifest": manifest.get(key), "expected": expected.get(key)})
    return {"ok": len(mismatches) == 0, "mismatches": mismatches, "REFUSE_RESUME": len(mismatches) > 0}


def remaining_authorization(manifest: dict[str, Any]) -> dict[str, Any]:
    max_step = int(manifest["AUTHORIZED_MAX_STEP"])
    max_tokens = int(manifest["AUTHORIZED_MAX_TOKENS"])
    current = int(manifest["CURRENT_GLOBAL_STEP"])
    tokens = int(manifest["TOKENS_PROCESSED"])
    next_step = int(manifest["NEXT_GLOBAL_STEP"])
    can_continue = next_step <= max_step and tokens < max_tokens
    restore_ok = current <= max_step and tokens <= max_tokens and next_step == current + 1
    return {
        "ok": restore_ok,
        "can_continue_training": can_continue,
        "AUTHORIZED_MAX_STEP": max_step,
        "AUTHORIZED_MAX_TOKENS": max_tokens,
        "CURRENT_GLOBAL_STEP": current,
        "NEXT_GLOBAL_STEP": next_step,
        "TOKENS_PROCESSED": tokens,
        "STEPS_REMAINING": max(0, max_step - current),
        "TOKENS_REMAINING": max(0, max_tokens - tokens),
        "extends_authorization": False,
    }


def save_resumable_checkpoint(
    *,
    run_root: Path,
    step: int,
    model: Any,
    optimizer: Any,
    tokens_processed: int,
    next_token_offset: int,
    stream_prefix_sha256: str,
    curriculum: dict[str, Any],
    identity: dict[str, Any],
    lr_table: dict[str, float],
    authorized_max_step: int,
    authorized_max_tokens: int,
) -> dict[str, Any]:
    from safetensors.torch import save_file
    import torch

    run_root.mkdir(parents=True, exist_ok=True)
    final = run_root / f"step-{step}"
    tmp = run_root / f".step-{step}.partial"
    if tmp.exists():
        import shutil

        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_file(model_cpu, str(tmp / MODEL_NAME))
    torch.save({"state_dict": optimizer.state_dict(), "hyper": identity.get("OPTIMIZER_HYPERPARAMETERS")}, tmp / OPTIMIZER_NAME)
    sched = {
        "current_step": step,
        "next_step": step + 1,
        "lr_now": lr_table.get(str(step)),
        "lr_next": lr_table.get(str(step + 1)),
        "lr_table": {str(k): float(v) for k, v in lr_table.items()},
        "lr_schedule_hash": schedule_hash(lr_table),
        "pytorch_scheduler": False,
        "lr_applied_explicitly_each_step": True,
    }
    torch.save(sched, tmp / SCHEDULER_NAME)
    rng_payload = capture_rng()
    torch.save(rng_payload, tmp / RNG_NAME)
    stream = {
        "completed_step": step,
        "next_global_step": step + 1,
        "next_batch_index": step,
        "tokens_processed": int(tokens_processed),
        "next_token_offset": int(next_token_offset),
        "stream_prefix_sha256": stream_prefix_sha256,
    }
    (tmp / STREAM_NAME).write_text(json.dumps(stream, indent=2) + "\n", encoding="utf-8")
    (tmp / CURRICULUM_NAME).write_text(json.dumps(curriculum, indent=2) + "\n", encoding="utf-8")

    hashes = {
        MODEL_NAME: sha256_file(tmp / MODEL_NAME),
        OPTIMIZER_NAME: sha256_file(tmp / OPTIMIZER_NAME),
        SCHEDULER_NAME: sha256_file(tmp / SCHEDULER_NAME),
        RNG_NAME: sha256_file(tmp / RNG_NAME),
        STREAM_NAME: sha256_file(tmp / STREAM_NAME),
        CURRICULUM_NAME: sha256_file(tmp / CURRICULUM_NAME),
    }
    (tmp / HASHES_NAME).write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")

    for name in (MODEL_NAME, OPTIMIZER_NAME, SCHEDULER_NAME, RNG_NAME, STREAM_NAME, CURRICULUM_NAME, HASHES_NAME):
        _fsync_file(tmp / name)

    rng_h = rng_hashes(rng_payload)
    manifest = {
        "kind": "WRIM_RESUMABLE_CHECKPOINT",
        "RESUME_MANIFEST_COMPLETE": True,
        "RUN_ID": identity["RUN_ID"],
        "PARENT_MODEL_ID": identity["PARENT_MODEL_ID"],
        "PARENT_HASH": identity["PARENT_HASH"],
        "TOKENIZER_HASH": identity["TOKENIZER_HASH"],
        "STAGE3_HASH": identity["STAGE3_HASH"],
        "INSTRUCTION_ADDENDUM_HASH": identity["INSTRUCTION_ADDENDUM_HASH"],
        "TRAIN_DATASET_IDS": identity["TRAIN_DATASET_IDS"],
        "TRAIN_DATASET_HASHES": identity["TRAIN_DATASET_HASHES"],
        "VALIDATION_DATASET_IDS": identity["VALIDATION_DATASET_IDS"],
        "VALIDATION_DATASET_HASHES": identity["VALIDATION_DATASET_HASHES"],
        "TRAINER_PROVENANCE_HASH": identity["TRAINER_PROVENANCE_HASH"],
        "PACKER_PROVENANCE_HASH": identity["PACKER_PROVENANCE_HASH"],
        "OPTIMIZER_CLASS": identity.get("OPTIMIZER_CLASS", "AdamW"),
        "OPTIMIZER_HYPERPARAMETERS": identity.get("OPTIMIZER_HYPERPARAMETERS"),
        "LR_SCHEDULE_ID": identity.get("LR_SCHEDULE_ID"),
        "LR_SCHEDULE_HASH": schedule_hash(lr_table),
        "CURRENT_GLOBAL_STEP": step,
        "NEXT_GLOBAL_STEP": step + 1,
        "TOKENS_PROCESSED": int(tokens_processed),
        "NEXT_TOKEN_OFFSET": int(next_token_offset),
        "CURRENT_CURRICULUM_STAGE": curriculum.get("stage"),
        "RNG_STATE_HASHES": rng_h,
        "MODEL_HASH": hashes[MODEL_NAME],
        "OPTIMIZER_STATE_HASH": hashes[OPTIMIZER_NAME],
        "SCHEDULER_STATE_HASH": hashes[SCHEDULER_NAME],
        "CREATED_AT": utc_now(),
        "AUTHORIZED_MAX_STEP": int(authorized_max_step),
        "AUTHORIZED_MAX_TOKENS": int(authorized_max_tokens),
        "RUN_AUTHORIZED": True,
        "TRAINING_AUTHORIZATION_STORED": "NOT_PERMANENTLY_ON",
        "FILE_HASHES": hashes,
    }
    man_path = tmp / MANIFEST_NAME
    man_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    _fsync_file(man_path)
    _fsync_dir(tmp)

    if final.exists():
        raise FileExistsError(f"refusing overwrite of existing checkpoint {final}")
    os.rename(str(tmp), str(final))
    _fsync_dir(run_root)
    check = verify_checkpoint_hashes(final)
    if not check["ok"]:
        raise RuntimeError(f"checkpoint hash verification failed: {check}")
    return {"ok": True, "path": str(final), "manifest": manifest, "HASH_VERIFICATION": True}


def restore_resumable_checkpoint(
    *,
    path: Path,
    model: Any,
    optimizer: Any,
    expected_identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import torch
    from safetensors.torch import load_file

    if not is_complete_checkpoint(path):
        return {"ok": False, "reason": "incomplete_checkpoint", "path": str(path)}
    from wrim_trainer_hard_stop import check_resume_allowed

    stopped = check_resume_allowed(path.parent, expected_identity)
    if not stopped.get("ok"):
        return stopped
    hashes = verify_checkpoint_hashes(path)
    if not hashes["ok"]:
        return {"ok": False, "reason": "hash_verification_failed", **hashes}
    manifest = load_manifest(path)
    if expected_identity:
        ident = verify_resume_identity(manifest, expected_identity)
        if not ident["ok"]:
            return {"ok": False, "reason": "identity_mismatch", **ident}
    auth = remaining_authorization(manifest)
    if not auth["ok"]:
        return {"ok": False, "reason": "authorization_exhausted", **auth}

    state = load_file(str(path / MODEL_NAME))
    model.load_state_dict(state, strict=True)
    opt_blob = torch.load(path / OPTIMIZER_NAME, map_location="cpu", weights_only=False)
    optimizer.load_state_dict(opt_blob["state_dict"])
    sched = torch.load(path / SCHEDULER_NAME, map_location="cpu", weights_only=False)
    rng_payload = torch.load(path / RNG_NAME, map_location="cpu", weights_only=False)
    restore_rng(rng_payload)
    stream = json.loads((path / STREAM_NAME).read_text(encoding="utf-8"))
    curriculum = json.loads((path / CURRICULUM_NAME).read_text(encoding="utf-8"))
    return {
        "ok": True,
        "path": str(path),
        "manifest": manifest,
        "scheduler": {k: sched[k] for k in ("current_step", "next_step", "lr_now", "lr_next", "lr_schedule_hash") if k in sched},
        "stream": stream,
        "curriculum": curriculum,
        "authorization": auth,
        "restored_model": True,
        "restored_optimizer": True,
        "restored_scheduler": True,
        "restored_rng": True,
        "restored_stream": True,
    }


def move_optimizer_state_to_device(optimizer: Any, device: Any) -> None:
    import torch

    for state in optimizer.state.values():
        for k, v in list(state.items()):
            if torch.is_tensor(v):
                state[k] = v.to(device)


def disk_preflight(run_root: Path, *, n_full_checkpoints: int, bytes_per_checkpoint: int, eval_bytes: int, extra_bytes: int = 1 << 30) -> dict[str, Any]:
    run_root.mkdir(parents=True, exist_ok=True)
    usage = os.statvfs(str(run_root))
    free = int(usage.f_bavail * usage.f_frsize)
    need = int(n_full_checkpoints) * int(bytes_per_checkpoint) + int(eval_bytes) + int(extra_bytes)
    return {
        "ok": free >= need,
        "DISK_FREE_BYTES": free,
        "DISK_FREE_GB": round(free / (1024**3), 3),
        "DISK_NEEDED_BYTES": need,
        "DISK_NEEDED_GB": round(need / (1024**3), 3),
        "n_full_checkpoints": n_full_checkpoints,
        "bytes_per_checkpoint_estimate": bytes_per_checkpoint,
    }
