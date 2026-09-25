#!/usr/bin/env python3
"""Foundry WRIM STEP_400 inference bridge.

Reuses existing load_model + greedy_generate. Does not train, save weights,
mutate the tokenizer, or construct an optimizer. Stdin JSON in, stdout JSON out.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_HINTS = [
    HERE.parents[3] / "scripts" / "wrim-environment" if len(HERE.parents) >= 4 else None,
    HERE.parents[4] / "scripts" / "wrim-environment" if len(HERE.parents) >= 5 else None,
    Path("/home/chosenone/Codex/war-room-os/scripts/wrim-environment"),
]
for hint in REPO_HINTS:
    if hint and hint.is_dir():
        sys.path.insert(0, str(hint))
        break

EXPECTED_CHECKPOINT_HASH = "f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8"
EXPECTED_TOKENIZER_HASH = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
DEFAULT_CHECKPOINT = Path(
    "/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000001/step-400/model.safetensors"
)
DEFAULT_TOKENIZER = Path(
    "/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/"
    "2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419/"
    "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json"
)
HARD_MAX_NEW = 64


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(request_id: str, code: str, message: str, extra: dict | None = None) -> int:
    payload = {
        "requestId": request_id,
        "ok": False,
        "provider": "wrim",
        "model": "STEP_400",
        "error": {"code": code, "message": message[:800]},
        "networkRequired": False,
    }
    if extra:
        payload.update(extra)
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()
    return 2


def resolve_device(requested: str | None):
    import torch

    want = (requested or "auto").strip().lower()
    if want in ("auto", "cuda") and torch.cuda.is_available():
        return torch.device("cuda"), "cuda"
    if want == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but not available")
    return torch.device("cpu"), "cpu"


def health(request: dict) -> int:
    request_id = str(request.get("requestId") or "health")
    checkpoint = Path(str(request.get("checkpointPath") or DEFAULT_CHECKPOINT))
    tokenizer = Path(str(request.get("tokenizerPath") or DEFAULT_TOKENIZER))
    extra = {
        "checkpointPath": str(checkpoint),
        "tokenizerPath": str(tokenizer),
        "checkpointExists": checkpoint.is_file(),
        "tokenizerExists": tokenizer.is_file(),
    }
    if not checkpoint.is_file():
        return fail(request_id, "MODEL_LOAD_FAILURE", "STEP_400 checkpoint is missing", extra)
    if not tokenizer.is_file():
        return fail(request_id, "TOKENIZER_FAILURE", "WR-TOKENIZER-0 file is missing", extra)
    try:
        checkpoint_hash = sha256_file(checkpoint)
        tokenizer_hash = sha256_file(tokenizer)
    except OSError as exc:
        return fail(request_id, "RUNTIME_FAILURE", f"hash failed: {exc}", extra)
    extra["checkpointHash"] = checkpoint_hash
    extra["tokenizerHash"] = tokenizer_hash
    if checkpoint_hash != EXPECTED_CHECKPOINT_HASH:
        return fail(request_id, "MODEL_LOAD_FAILURE", "STEP_400 checkpoint hash mismatch", extra)
    if tokenizer_hash != EXPECTED_TOKENIZER_HASH:
        return fail(request_id, "TOKENIZER_FAILURE", "WR-TOKENIZER-0 hash mismatch", extra)
    try:
        import torch
        from tokenizers import Tokenizer  # noqa: F401
        from stage2_eval import greedy_generate  # noqa: F401
        from wrim_plateau_review_probe import load_model  # noqa: F401
        from wrim_g20m import WRIM0Model  # noqa: F401
    except Exception as exc:
        return fail(request_id, "RUNTIME_FAILURE", f"import failed: {exc}", extra)
    device_name = "cuda" if torch.cuda.is_available() else "cpu"
    sys.stdout.write(
        json.dumps(
            {
                "requestId": request_id,
                "ok": True,
                "provider": "wrim",
                "model": "STEP_400",
                "checkpointId": "WRIM1-CPT-000001/step-400",
                "checkpointHash": checkpoint_hash,
                "tokenizerId": "WR-TOKENIZER-0",
                "tokenizerHash": tokenizer_hash,
                "device": device_name,
                "torch": getattr(torch, "__version__", "unknown"),
                "cudaAvailable": bool(torch.cuda.is_available()),
                "networkRequired": False,
                "imports": ["torch", "tokenizers.Tokenizer", "stage2_eval.greedy_generate", "wrim_plateau_review_probe.load_model"],
            },
            ensure_ascii=True,
        )
        + "\n"
    )
    return 0


def generate(request: dict) -> int:
    request_id = str(request.get("requestId") or "generate")
    prompt = str(request.get("prompt") or "")
    if not prompt:
        return fail(request_id, "INVALID_OUTPUT", "prompt is empty")
    max_new = int(request.get("maxNewTokens") or 24)
    max_new = max(1, min(max_new, HARD_MAX_NEW))
    checkpoint = Path(str(request.get("checkpointPath") or DEFAULT_CHECKPOINT))
    tokenizer_path = Path(str(request.get("tokenizerPath") or DEFAULT_TOKENIZER))
    started = time.time()
    if not checkpoint.is_file():
        return fail(request_id, "MODEL_LOAD_FAILURE", "STEP_400 checkpoint is missing")
    if not tokenizer_path.is_file():
        return fail(request_id, "TOKENIZER_FAILURE", "WR-TOKENIZER-0 file is missing")
    try:
        checkpoint_hash = sha256_file(checkpoint)
        tokenizer_hash = sha256_file(tokenizer_path)
    except OSError as exc:
        return fail(request_id, "RUNTIME_FAILURE", f"hash failed: {exc}")
    if checkpoint_hash != EXPECTED_CHECKPOINT_HASH:
        return fail(request_id, "MODEL_LOAD_FAILURE", "STEP_400 checkpoint hash mismatch")
    if tokenizer_hash != EXPECTED_TOKENIZER_HASH:
        return fail(request_id, "TOKENIZER_FAILURE", "WR-TOKENIZER-0 hash mismatch")
    try:
        import torch
        from tokenizers import Tokenizer
        from stage2_eval import greedy_generate
        from wrim_plateau_review_probe import load_model
    except Exception as exc:
        return fail(request_id, "RUNTIME_FAILURE", f"import failed: {exc}")
    try:
        device, device_name = resolve_device(str(request.get("device") or "auto"))
    except Exception as exc:
        return fail(request_id, "RUNTIME_FAILURE", str(exc))
    try:
        tokenizer = Tokenizer.from_file(str(tokenizer_path))
    except Exception as exc:
        return fail(request_id, "TOKENIZER_FAILURE", str(exc))
    try:
        model = load_model(checkpoint, device)
        model.eval()
    except Exception as exc:
        return fail(request_id, "MODEL_LOAD_FAILURE", str(exc))
    try:
        with torch.inference_mode():
            result = greedy_generate(model, tokenizer, prompt, device, max_new=max_new)
    except Exception as exc:
        return fail(request_id, "RUNTIME_FAILURE", str(exc))
    raw = str(result.get("continuation") or "")
    new_ids = [int(item) for item in (result.get("new_ids") or [])]
    collapsed = bool(result.get("collapsed"))
    empty = not raw.strip()
    finish = "max_new" if len(new_ids) >= max_new else "stop"
    usable = bool(new_ids) and not collapsed and not empty and len(set(new_ids)) >= 3
    capability = "OK" if usable else ("INVALID_OUTPUT" if collapsed or empty or not new_ids else "INSUFFICIENT_CAPABILITY")
    payload = {
        "requestId": request_id,
        "ok": True,
        "provider": "wrim",
        "model": "STEP_400",
        "checkpointId": "WRIM1-CPT-000001/step-400",
        "checkpointHash": checkpoint_hash,
        "tokenizerId": "WR-TOKENIZER-0",
        "tokenizerHash": tokenizer_hash,
        "device": device_name,
        "rawText": raw,
        "generatedTokenIds": new_ids,
        "generatedTokenCount": len(new_ids),
        "finishReason": finish,
        "collapsed": collapsed,
        "latencyMs": int((time.time() - started) * 1000),
        "transportSuccess": True,
        "reasoningUsable": usable,
        "capabilityStatus": capability,
        "generationMode": str(request.get("generationMode") or "greedy"),
        "pythonBridge": "wrim_foundry_infer.py",
        "runtime": "wrim-pytorch-linux",
        "networkRequired": False,
        "mock": False,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    return 0


def main() -> int:
    raw = sys.stdin.read(256_000)
    if not raw.strip():
        return fail("missing", "RUNTIME_FAILURE", "empty stdin request")
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        return fail("invalid", "RUNTIME_FAILURE", f"invalid JSON request: {exc}")
    if not isinstance(request, dict):
        return fail("invalid", "RUNTIME_FAILURE", "request must be a JSON object")
    mode = str(request.get("mode") or "generate").strip().lower()
    try:
        if mode == "health":
            return health(request)
        return generate(request)
    except Exception as exc:
        return fail(str(request.get("requestId") or "error"), "RUNTIME_FAILURE", f"{exc}\n{traceback.format_exc()[-400:]}")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONWARNINGS", "ignore")
    raise SystemExit(main())
