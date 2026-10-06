"""Linux WRIM environment verification. Does not reinstall or upgrade packages."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from run000007_identity import LINUX_VENV_PYTHON

EXPECTED = {
    "python": "3.13.15",
    "torch": "2.13.0+cu130",
    "torch_cuda": "13.0",
    "safetensors": "0.8.0",
    "tokenizers": "0.23.2",
    "numpy": "2.5.3",
    "gpu_name_substr": "RTX 5060 Ti",
    "compute_cap": "12.0",
}


def _probe_script() -> str:
    return (
        "import json,sys,numpy,torch,safetensors,tokenizers;"
        "gpu=torch.cuda.get_device_name(0) if torch.cuda.is_available() else '';"
        "cap='.'.join(str(x) for x in torch.cuda.get_device_capability(0)) if torch.cuda.is_available() else '';"
        "print(json.dumps({"
        "'python': sys.version.split()[0],"
        "'torch': torch.__version__,"
        "'torch_cuda': getattr(torch.version,'cuda',None),"
        "'cuda_available': bool(torch.cuda.is_available()),"
        "'gpu_name': gpu,"
        "'compute_cap': cap,"
        "'safetensors': getattr(safetensors,'__version__', None),"
        "'tokenizers': tokenizers.__version__,"
        "'numpy': numpy.__version__,"
        "}))"
    )


def verify_linux_env(*, python_bin: str | None = None, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    py = python_bin or LINUX_VENV_PYTHON
    exists = Path(py).is_file()
    if probe is None:
        if not exists:
            return {
                "ok": False,
                "decision": "PRETRAIN_ABORT",
                "python_bin": py,
                "python_bin_exists": False,
                "mismatches": ["venv_python_missing"],
            }
        try:
            raw = subprocess.check_output([py, "-c", _probe_script()], text=True, timeout=60, env={**os.environ, "PYTHONUNBUFFERED": "1"})
            probe = json.loads(raw.strip().splitlines()[-1])
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            return {"ok": False, "decision": "PRETRAIN_ABORT", "python_bin": py, "error": str(exc), "mismatches": ["probe_failed"]}
    mismatches = []
    if str(probe.get("python") or "") != EXPECTED["python"]:
        mismatches.append(f"python {probe.get('python')} != {EXPECTED['python']}")
    if str(probe.get("torch") or "") != EXPECTED["torch"]:
        mismatches.append(f"torch {probe.get('torch')} != {EXPECTED['torch']}")
    if str(probe.get("torch_cuda") or "") != EXPECTED["torch_cuda"]:
        mismatches.append(f"torch_cuda {probe.get('torch_cuda')} != {EXPECTED['torch_cuda']}")
    if str(probe.get("safetensors") or "") != EXPECTED["safetensors"]:
        mismatches.append(f"safetensors {probe.get('safetensors')} != {EXPECTED['safetensors']}")
    if str(probe.get("tokenizers") or "") != EXPECTED["tokenizers"]:
        mismatches.append(f"tokenizers {probe.get('tokenizers')} != {EXPECTED['tokenizers']}")
    if str(probe.get("numpy") or "") != EXPECTED["numpy"]:
        mismatches.append(f"numpy {probe.get('numpy')} != {EXPECTED['numpy']}")
    gpu = str(probe.get("gpu_name") or "")
    if EXPECTED["gpu_name_substr"] not in gpu:
        mismatches.append(f"gpu {gpu!r} missing {EXPECTED['gpu_name_substr']}")
    if str(probe.get("compute_cap") or "") != EXPECTED["compute_cap"]:
        mismatches.append(f"compute_cap {probe.get('compute_cap')} != {EXPECTED['compute_cap']}")
    if probe.get("cuda_available") is not True:
        mismatches.append("cuda_available != True")
    ok = len(mismatches) == 0
    manifest = {
        "kind": "WRIM1_RUN_000007_ENVIRONMENT_MANIFEST",
        "python_bin": py,
        "expected": EXPECTED,
        "observed": probe,
        "reinstall": False,
        "upgrade": False,
        "new_venv": False,
    }
    blob = (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    return {
        "ok": ok,
        "decision": "PASS" if ok else "PRETRAIN_ABORT",
        "python_bin": py,
        "python_bin_exists": exists,
        "expected": EXPECTED,
        "observed": probe,
        "mismatches": mismatches,
        "manifest": manifest,
        "ENVIRONMENT_MANIFEST_SHA": hashlib.sha256(blob).hexdigest(),
        "packages_modified": False,
    }
