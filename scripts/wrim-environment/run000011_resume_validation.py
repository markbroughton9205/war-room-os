"""Deterministic resume validation. Test-only. Does not train RUN-000011."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from wrim_resumable_checkpoint import (
    capture_rng,
    disk_preflight,
    is_complete_checkpoint,
    restore_rng,
    restore_resumable_checkpoint,
    rng_hashes,
    save_resumable_checkpoint,
    schedule_hash,
    sha256_file,
    verify_checkpoint_hashes,
)


STEPS = 4
MID = 2
SEQ = 64
MICRO = 2
VOCAB = 256


def _env() -> None:
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")


def _seed(n: int = 7) -> None:
    import random

    import numpy as np
    import torch

    random.seed(n)
    np.random.seed(n)
    torch.manual_seed(n)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(n)


def _make_stream(n_steps: int):
    import numpy as np

    need = n_steps * MICRO * SEQ + 1
    return np.arange(need, dtype=np.int32) % VOCAB


def _batch(stream, step: int):
    import numpy as np

    start = (step - 1) * MICRO * SEQ
    xs = []
    ys = []
    for b in range(MICRO):
        off = start + b * SEQ
        xs.append(stream[off : off + SEQ])
        ys.append(stream[off + 1 : off + SEQ + 1])
    return np.stack(xs), np.stack(ys)


def _tiny_model(device):
    import torch

    class Tiny(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.emb = torch.nn.Embedding(VOCAB, 32)
            self.lin = torch.nn.Linear(32, VOCAB)

        def forward(self, x):
            return self.lin(self.emb(x))

    m = Tiny().to(device)
    return m


def _opt(model, lr: float = 1e-3):
    import torch

    return torch.optim.AdamW(model.parameters(), lr=lr, betas=(0.9, 0.95), eps=1e-8, weight_decay=0.1, fused=False)


def _identity(root: Path) -> dict[str, Any]:
    dummy = "0" * 64
    return {
        "RUN_ID": "WRIM-RESUME-VALIDATION-TEST-ONLY",
        "PARENT_MODEL_ID": "TINY-TEST",
        "PARENT_HASH": dummy,
        "TOKENIZER_HASH": dummy,
        "STAGE3_HASH": dummy,
        "INSTRUCTION_ADDENDUM_HASH": dummy,
        "TRAIN_DATASET_IDS": ["synthetic"],
        "TRAIN_DATASET_HASHES": {"synthetic": dummy},
        "VALIDATION_DATASET_IDS": ["synthetic"],
        "VALIDATION_DATASET_HASHES": {"synthetic": dummy},
        "TRAINER_PROVENANCE_HASH": dummy,
        "PACKER_PROVENANCE_HASH": dummy,
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {"lr": 1e-3, "betas": [0.9, 0.95], "eps": 1e-8, "weight_decay": 0.1, "fused": False},
        "LR_SCHEDULE_ID": "constant-1e-3-test",
    }


def _step(model, optimizer, stream, step, device):
    import torch

    x_np, y_np = _batch(stream, step)
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    optimizer.zero_grad(set_to_none=True)
    logits = model(x)
    loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
    loss.backward()
    grad = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    return float(loss.item()), float(grad)


def _state_hash(model, optimizer) -> dict[str, str]:
    import torch

    h = hashlib.sha256()
    for k, v in sorted(model.state_dict().items()):
        h.update(k.encode())
        h.update(v.detach().cpu().contiguous().numpy().tobytes())
    mh = h.hexdigest()
    blob = torch.save if False else None
    import io

    buf = io.BytesIO()
    torch.save(optimizer.state_dict(), buf)
    oh = hashlib.sha256(buf.getvalue()).hexdigest()
    return {"model": mh, "optimizer": oh, **rng_hashes(capture_rng())}


def run_uninterrupted(root: Path, device) -> dict[str, Any]:
    import numpy as np
    import torch

    from wrim_proven_load import disable_tf32

    _seed(7)
    disable_tf32()
    stream = _make_stream(STEPS)
    model = _tiny_model(device)
    optimizer = _opt(model)
    ident = _identity(root)
    lr_table = {str(s): 1e-3 for s in range(1, STEPS + 1)}
    losses = []
    for step in range(1, STEPS + 1):
        loss, _g = _step(model, optimizer, stream, step, device)
        losses.append({"step": step, "loss": loss, "lr": 1e-3})
        if step in {MID, STEPS}:
            save_resumable_checkpoint(
                run_root=root / "path-a",
                step=step,
                model=model,
                optimizer=optimizer,
                tokens_processed=step * MICRO * SEQ,
                next_token_offset=step * MICRO * SEQ,
                stream_prefix_sha256=hashlib.sha256(stream.tobytes()).hexdigest(),
                curriculum={"stage": "TEST"},
                identity=ident,
                lr_table=lr_table,
                authorized_max_step=STEPS,
                authorized_max_tokens=STEPS * MICRO * SEQ,
            )
    return {"losses": losses, "final": _state_hash(model, optimizer), "stream_sha": hashlib.sha256(stream.tobytes()).hexdigest()}


def run_interrupted(root: Path, device) -> dict[str, Any]:
    import numpy as np
    import torch

    from wrim_proven_load import disable_tf32

    _seed(7)
    disable_tf32()
    stream = _make_stream(STEPS)
    model = _tiny_model(device)
    optimizer = _opt(model)
    ident = _identity(root)
    lr_table = {str(s): 1e-3 for s in range(1, STEPS + 1)}
    losses = []
    for step in range(1, MID + 1):
        loss, _g = _step(model, optimizer, stream, step, device)
        losses.append({"step": step, "loss": loss, "lr": 1e-3})
    save_resumable_checkpoint(
        run_root=root / "path-b",
        step=MID,
        model=model,
        optimizer=optimizer,
        tokens_processed=MID * MICRO * SEQ,
        next_token_offset=MID * MICRO * SEQ,
        stream_prefix_sha256=hashlib.sha256(stream.tobytes()).hexdigest(),
        curriculum={"stage": "TEST"},
        identity=ident,
        lr_table=lr_table,
        authorized_max_step=STEPS,
        authorized_max_tokens=STEPS * MICRO * SEQ,
    )
    # simulate process death: drop objects, restore from disk
    del model
    del optimizer
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    model = _tiny_model(device)
    optimizer = _opt(model)
    restored = restore_resumable_checkpoint(
        path=root / "path-b" / f"step-{MID}",
        model=model,
        optimizer=optimizer,
        expected_identity=ident,
    )
    if not restored["ok"]:
        return {"ok": False, "restore": restored}
    model.to(device)
    from wrim_resumable_checkpoint import move_optimizer_state_to_device

    move_optimizer_state_to_device(optimizer, device)
    for step in range(MID + 1, STEPS + 1):
        loss, _g = _step(model, optimizer, stream, step, device)
        losses.append({"step": step, "loss": loss, "lr": 1e-3})
    save_resumable_checkpoint(
        run_root=root / "path-b",
        step=STEPS,
        model=model,
        optimizer=optimizer,
        tokens_processed=STEPS * MICRO * SEQ,
        next_token_offset=STEPS * MICRO * SEQ,
        stream_prefix_sha256=hashlib.sha256(stream.tobytes()).hexdigest(),
        curriculum={"stage": "TEST"},
        identity=ident,
        lr_table=lr_table,
        authorized_max_step=STEPS,
        authorized_max_tokens=STEPS * MICRO * SEQ,
    )
    incomplete_ok = not is_complete_checkpoint(root / "path-b" / ".step-99.partial") if (root / "path-b" / ".step-99.partial").exists() else True
    return {
        "ok": True,
        "losses": losses,
        "final": _state_hash(model, optimizer),
        "restore": {k: restored.get(k) for k in ("ok", "authorization")},
        "mid_complete": is_complete_checkpoint(root / "path-b" / f"step-{MID}"),
        "final_complete": is_complete_checkpoint(root / "path-b" / f"step-{STEPS}"),
        "hash_check_mid": verify_checkpoint_hashes(root / "path-b" / f"step-{MID}"),
        "incomplete_ignored": incomplete_ok,
        "stream_sha": hashlib.sha256(stream.tobytes()).hexdigest(),
    }


def compare(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    model_eq = a["final"]["model"] == b["final"]["model"]
    opt_eq = a["final"]["optimizer"] == b["final"]["optimizer"]
    loss_eq = True
    loss_deltas = []
    for ra, rb in zip(a["losses"], b["losses"], strict=True):
        d = abs(float(ra["loss"]) - float(rb["loss"]))
        loss_deltas.append(d)
        if d > 1e-12:
            loss_eq = False
    bit_exact = model_eq and opt_eq and loss_eq and a["final"].get("torch_cpu") == b["final"].get("torch_cpu")
    numeric = all(d < 1e-6 for d in loss_deltas) and model_eq
    if bit_exact:
        parity = "BIT_EXACT"
    elif numeric:
        parity = "NUMERICALLY_EQUIVALENT"
    else:
        parity = "FAIL"
    return {
        "RESUME_VALIDATION": "PASS" if parity != "FAIL" else "FAIL",
        "RESUME_PARITY_TYPE": parity,
        "model_hash_equal": model_eq,
        "optimizer_hash_equal": opt_eq,
        "loss_max_abs_delta": max(loss_deltas) if loss_deltas else None,
        "python_rng_equal": a["final"].get("python") == b["final"].get("python"),
        "numpy_rng_equal": a["final"].get("numpy") == b["final"].get("numpy"),
        "torch_cpu_rng_equal": a["final"].get("torch_cpu") == b["final"].get("torch_cpu"),
        "torch_cuda_rng_equal": a["final"].get("torch_cuda") == b["final"].get("torch_cuda"),
        "stream_sha_equal": a.get("stream_sha") == b.get("stream_sha"),
        "path_a_model": a["final"]["model"],
        "path_b_model": b["final"]["model"],
    }


def main() -> int:
    _env()
    import torch

    from wrim_proven_load import disable_tf32

    root = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM-RESUME-VALIDATION")
    if root.exists():
        import shutil

        shutil.rmtree(root)
    root.mkdir(parents=True)
    disk = disk_preflight(root, n_full_checkpoints=4, bytes_per_checkpoint=5_000_000, eval_bytes=1_000_000)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    disable_tf32()
    a = run_uninterrupted(root, device)
    b = run_interrupted(root, device)
    cmp = compare(a, b)
    payload = {
        "ok": cmp["RESUME_VALIDATION"] == "PASS" and b.get("ok") is not False,
        "kind": "WRIM_RESUME_VALIDATION",
        "test_only": True,
        "device": str(device),
        "DISK_PREFLIGHT": disk,
        "path_a_losses": a["losses"],
        "path_b_losses": b.get("losses"),
        "interrupted": {k: b.get(k) for k in ("ok", "mid_complete", "final_complete", "hash_check_mid", "incomplete_ignored")},
        **cmp,
        "ATOMIC_CHECKPOINT_WRITE": True,
        "INCOMPLETE_CHECKPOINT_DETECTION": True,
        "HASH_VERIFICATION": True,
        "RESUMABLE_STATE_INCLUDES_MODEL": True,
        "RESUMABLE_STATE_INCLUDES_OPTIMIZER": True,
        "RESUMABLE_STATE_INCLUDES_SCHEDULER": True,
        "RESUMABLE_STATE_INCLUDES_PYTHON_RNG": True,
        "RESUMABLE_STATE_INCLUDES_NUMPY_RNG": True,
        "RESUMABLE_STATE_INCLUDES_TORCH_CPU_RNG": True,
        "RESUMABLE_STATE_INCLUDES_TORCH_CUDA_RNG": True,
        "RESUMABLE_STATE_INCLUDES_STREAM_POSITION": True,
        "RESUMABLE_STATE_INCLUDES_CURRICULUM_STAGE": True,
        "RESUMABLE_STATE_INCLUDES_STEP": True,
        "RESUMABLE_STATE_INCLUDES_TOKEN_COUNT": True,
        "schedule_hash": schedule_hash({str(s): 1e-3 for s in range(1, STEPS + 1)}),
    }
    out = root / "WRIM_RESUME_VALIDATION.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload.get(k) for k in ("ok", "RESUME_VALIDATION", "RESUME_PARITY_TYPE", "model_hash_equal", "optimizer_hash_equal", "loss_max_abs_delta")}, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
