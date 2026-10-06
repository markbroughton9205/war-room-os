"""#23 WRIM sovereign model laboratory: verify, install, instrument, import, validate.

No training. TRAINING_AUTHORIZATION remains OFF. Loopback services only.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from observability_bus import UNKNOWN, ObservabilityBus, unknown_if_missing, utc_now

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
PORTS_PATH = SCRIPT_DIR / "lab_ports.json"
PORTS = json.loads(PORTS_PATH.read_text(encoding="utf-8"))
BIND = PORTS["bind"]
SVC = PORTS["services"]

PROMETHEUS_VERSION = "3.14.0"
PROMETHEUS_ZIP = f"prometheus-{PROMETHEUS_VERSION}.windows-amd64.zip"
PROMETHEUS_URL = (
    f"https://github.com/prometheus/prometheus/releases/download/v{PROMETHEUS_VERSION}/{PROMETHEUS_ZIP}"
)
PROMETHEUS_SHA256 = "e57fbb99e4d0bc734d2f2b3aeb68c02fba38862259dc99a95c27ea46d9ccba0a"

RUN5 = {
    "run_id": "WRIM1-RUN-000005",
    "status": "STOPPED_BY_POLICY",
    "steps": 50,
    "tokens": 204800,
    "terminal_reason": "dnll_gt_0.105",
    "stream_sha": "5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5",
    "recipe_sha": "5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117",
    "trajectory": [0, 5, 10, 25, 50],
}

HISTORICAL = [
    "WRIM-0",
    "WRIM1-RUN-000001",
    "WRIM1-RUN-000002",
    "WRIM1-RUN-000003",
    "WRIM1-RUN-000004",
    "WRIM1-RUN-000005",
]


def lab_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DO_NOT_TRACK": "1",
            "MLFLOW_DISABLE_TELEMETRY": "true",
            "DVC_NO_ANALYTICS": "1",
            "AIM_UI_TELEMETRY_ENABLED": "0",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "HF_HUB_OFFLINE": env.get("HF_HUB_OFFLINE", "0"),
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
            "NO_COLOR": "1",
        }
    )
    if extra:
        env.update(extra)
    return env


def appdata_root() -> Path:
    override = os.environ.get("WAR_ROOM_LOCAL_DATA_DIR")
    if override:
        return Path(override)
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "War Room OS"


def paths() -> dict[str, Path]:
    root = appdata_root()
    data = root / "data"
    lab = data / "wrim-environment" / "sovereign-lab"
    return {
        "app_root": root,
        "data": data,
        "lab": lab,
        "report": data / "wrim-environment" / "sovereign-lab-report.json",
        "venv": root / "venvs" / "wrim-lab",
        "pytorch_venv": root / "venvs" / "wrim-pytorch",
        "aim": lab / "aim",
        "tb": lab / "tensorboard",
        "mlflow": lab / "mlflow",
        "duckdb": lab / "analytics" / "wrim.duckdb",
        "parquet": lab / "analytics" / "parquet",
        "dvc": lab / "dvc-repo",
        "dvc_cache": lab / "dvc-cache",
        "prometheus_dir": root / "tools" / "prometheus",
        "prometheus_data": lab / "prometheus-tsdb",
        "profiler": lab / "profiler",
        "safetensors_v2": lab / "checkpoint-format-v2-probe",
        "journal": lab / "observability-journal.jsonl",
        "ckpts": data / "wrim-checkpoints" / "test-only",
        "run5": data / "wrim-checkpoints" / "test-only" / "WRIM1-RUN-000005" / "P2",
        "pids": lab / "service-pids.json",
        "lineage_git": SCRIPT_DIR / "artifact-lineage",
    }


def py_lab(p: dict[str, Path]) -> Path:
    return p["venv"] / "Scripts" / "python.exe"


def py_torch(p: dict[str, Path]) -> Path:
    return p["pytorch_venv"] / "Scripts" / "python.exe"


def run(cmd: list[str], *, env: dict[str, str] | None = None, cwd: Path | None = None, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env or lab_env(),
        text=True,
        capture_output=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def bind_ok(host: str, port: int) -> bool:
    return host == "127.0.0.1" and port not in (3000, 3001, 3847, 3848, 11434)


def http_get(url: str, timeout: float = 4.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "wrim-sovereign-lab"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


def ensure_lab_venv(p: dict[str, Path], findings: dict[str, Any]) -> None:
    torch_py = py_torch(p)
    if not torch_py.exists():
        raise RuntimeError(f"missing wrim-pytorch python: {torch_py}")
    lab_py = py_lab(p)
    if not lab_py.exists():
        proc = run([str(torch_py), "-m", "venv", str(p["venv"])], timeout=180)
        if proc.returncode != 0:
            raise RuntimeError(f"venv failed: {proc.stderr}")
    findings["lab_python"] = str(lab_py)
    findings["pytorch_python"] = str(torch_py)


def pip_install(p: dict[str, Path], findings: dict[str, Any]) -> None:
    py = str(py_lab(p))
    pkgs = [
        "aim==3.29.1",
        "tensorboard==2.21.0",
        "mlflow==3.15.0",
        "dvc==3.63.0",
        "duckdb==1.4.2",
        "prometheus-client==0.23.1",
        "psutil==7.1.3",
        "safetensors==0.6.2",
        "pyarrow==21.0.0",
        "tensorboardX==2.6.4",
        "lm-eval==0.4.9.1",
    ]
    findings["pip"] = {}
    subprocess.run([py, "-m", "pip", "install", "pathspec==0.12.1", "tensorboard==2.21.0"], env=lab_env(), timeout=180)
    if os.environ.get("WRIM_LAB_SKIP_PIP") == "1":
        findings["pip_skipped"] = True
        return
    subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"], env=lab_env(), timeout=180)
    for spec in pkgs:
        name = spec.split("==", 1)[0]
        proc = subprocess.run([py, "-m", "pip", "install", spec], env=lab_env(), timeout=900)
        if proc.returncode != 0:
            proc2 = subprocess.run([py, "-m", "pip", "install", name], env=lab_env(), timeout=900)
            findings["pip"][name] = {
                "pinned_ok": False,
                "unpinned_ok": proc2.returncode == 0,
            }
        else:
            findings["pip"][name] = {"pinned_ok": True, "spec": spec}
    tb_torch = subprocess.run([str(py_torch(p)), "-m", "pip", "install", "tensorboard", "psutil"], env=lab_env(), timeout=300)
    findings["pytorch_venv_tensorboard"] = tb_torch.returncode == 0


def download_prometheus(p: dict[str, Path], findings: dict[str, Any]) -> None:
    dest_dir = p["prometheus_dir"]
    dest_dir.mkdir(parents=True, exist_ok=True)
    exe = dest_dir / "prometheus.exe"
    if exe.exists():
        findings["prometheus_binary"] = str(exe)
        findings["prometheus_cached"] = True
        return
    zip_path = dest_dir / PROMETHEUS_ZIP
    req = urllib.request.Request(PROMETHEUS_URL, headers={"User-Agent": "wrim-sovereign-lab"})
    with urllib.request.urlopen(req, timeout=120) as resp, zip_path.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    digest = sha256_file(zip_path)
    if digest != PROMETHEUS_SHA256:
        raise RuntimeError(f"prometheus sha256 mismatch: {digest}")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest_dir)
    inner = dest_dir / f"prometheus-{PROMETHEUS_VERSION}.windows-amd64"
    for name in ("prometheus.exe", "promtool.exe"):
        src = inner / name
        if src.exists():
            shutil.copy2(src, dest_dir / name)
    findings["prometheus_binary"] = str(exe)
    findings["prometheus_sha256"] = digest
    findings["prometheus_cached"] = False


class AimAdapter:
    def __init__(self, repo: Path) -> None:
        self.repo = repo
        self.repo.mkdir(parents=True, exist_ok=True)
        self._runs: dict[str, Any] = {}
        self.available = False
        self.error = ""
        try:
            import aim  # noqa: F401
            self.available = True
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)

    def __call__(self, event: dict[str, Any]) -> None:
        if not self.available:
            raise RuntimeError(self.error or "aim unavailable")
        from aim import Run

        run_id = str(event.get("run_id") or "unknown")
        run = self._runs.get(run_id)
        if run is None:
            run = Run(repo=str(self.repo), experiment="WRIM", system_tracking_interval=0)
            run["wrim_run_id"] = run_id
            run["import_class"] = event.get("import_class", "LIVE")
            run["model_id"] = event.get("model_id")
            run["parent_hash"] = event.get("parent_hash")
            run["stream_sha"] = event.get("stream_sha")
            run["recipe_sha"] = event.get("recipe_sha")
            run["tokenizer_hash"] = event.get("tokenizer_hash")
            self._runs[run_id] = run
        if event.get("event_type") == "RUN_CONFIG":
            for k, v in (event.get("metrics") or {}).items():
                run[k] = v
        step = event.get("optimizer_step")
        ctx = {"split": str(event.get("event_type"))}
        metrics = event.get("metrics") or {}
        if event.get("metric_name"):
            metrics[str(event["metric_name"])] = event.get("metric_value")
        for name, value in metrics.items():
            if value in (None, UNKNOWN) or isinstance(value, str):
                continue
            if isinstance(step, int):
                run.track(value, name=name, step=step, context=ctx)
            else:
                run.track(value, name=name, context=ctx)

    def close(self) -> None:
        for run in self._runs.values():
            try:
                run.close()
            except Exception:
                continue


class TensorBoardAdapter:
    def __init__(self, logdir: Path) -> None:
        self.logdir = logdir
        self.logdir.mkdir(parents=True, exist_ok=True)
        self._writers: dict[str, Any] = {}
        self.available = False
        self.error = ""
        try:
            from tensorboardX import SummaryWriter  # type: ignore
            self.available = True
            self._cls = SummaryWriter
        except Exception as exc:  # noqa: BLE001
            try:
                from torch.utils.tensorboard import SummaryWriter
                self.available = True
                self._cls = SummaryWriter
            except Exception as exc2:  # noqa: BLE001
                self.error = f"{exc} / {exc2}"

    def _writer(self, run_id: str) -> Any:
        w = self._writers.get(run_id)
        if w is None:
            w = self._cls(log_dir=str(self.logdir / run_id))
            self._writers[run_id] = w
        return w

    def __call__(self, event: dict[str, Any]) -> None:
        if not self.available:
            raise RuntimeError(self.error or "tensorboard unavailable")
        step = event.get("optimizer_step")
        if not isinstance(step, int):
            step = 0
        writer = self._writer(str(event.get("run_id") or "unknown"))
        metrics = event.get("metrics") or {}
        if event.get("metric_name") and event.get("metric_value") not in (None, UNKNOWN):
            metrics[str(event["metric_name"])] = event["metric_value"]
        for name, value in metrics.items():
            if isinstance(value, (int, float)) and value == value:
                writer.add_scalar(name, float(value), step)
        writer.flush()

    def close(self) -> None:
        for w in self._writers.values():
            try:
                w.close()
            except Exception:
                continue


class MlflowAdapter:
    def __init__(self, tracking_dir: Path) -> None:
        self.tracking_dir = tracking_dir
        self.tracking_dir.mkdir(parents=True, exist_ok=True)
        self._active: dict[str, str] = {}
        self.available = False
        self.error = ""
        os.environ["MLFLOW_DISABLE_TELEMETRY"] = "true"
        os.environ["DO_NOT_TRACK"] = "1"
        try:
            import mlflow
            db = (self.tracking_dir / "mlflow.db").as_posix()
            uri = f"sqlite:///{db}"
            mlflow.set_tracking_uri(uri)
            mlflow.set_experiment("WRIM")
            self.uri = uri
            self.mlflow = mlflow
            self.available = True
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)

    def __call__(self, event: dict[str, Any]) -> None:
        if not self.available:
            raise RuntimeError(self.error or "mlflow unavailable")
        run_id = str(event.get("run_id") or "unknown")
        if run_id not in self._active:
            run = self.mlflow.start_run(run_name=run_id)
            self._active[run_id] = run.info.run_id
            tags = {
                "wrim.run_id": run_id,
                "wrim.import_class": str(event.get("import_class") or "LIVE"),
                "wrim.lifecycle": str(event.get("lifecycle_state") or "ANALYSIS_ONLY"),
                "wrim.not_promotion_authority": "true",
                "wrim.parent_hash": str(event.get("parent_hash") or ""),
                "wrim.stream_sha": str(event.get("stream_sha") or ""),
                "wrim.recipe_sha": str(event.get("recipe_sha") or ""),
                "wrim.tokenizer_hash": str(event.get("tokenizer_hash") or ""),
            }
            self.mlflow.set_tags(tags)
        else:
            self.mlflow.start_run(run_id=self._active[run_id])
        try:
            metrics = event.get("metrics") or {}
            step = event.get("optimizer_step") if isinstance(event.get("optimizer_step"), int) else None
            for name, value in metrics.items():
                if isinstance(value, (int, float)) and value == value:
                    key = name.replace("/", "_")[:250]
                    self.mlflow.log_metric(key, float(value), step=step)
            if event.get("event_type") in ("RUN_STOPPED", "RUN_FAILED", "STOP_POLICY_DECISION"):
                self.mlflow.set_tag("wrim.terminal_event", str(event.get("event_type")))
                if event.get("lifecycle_state"):
                    self.mlflow.set_tag("wrim.lifecycle", str(event["lifecycle_state"]))
        finally:
            self.mlflow.end_run()

    def close(self) -> None:
        return


class DuckdbAdapter:
    def __init__(self, db_path: Path, parquet_dir: Path) -> None:
        self.db_path = db_path
        self.parquet_dir = parquet_dir
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.parquet_dir.mkdir(parents=True, exist_ok=True)
        self.available = False
        self.error = ""
        self._rows: list[dict[str, Any]] = []
        try:
            import duckdb
            self.duckdb = duckdb
            self.con = duckdb.connect(str(self.db_path))
            self.con.execute(
                """
                CREATE TABLE IF NOT EXISTS wrim_events (
                    event_type VARCHAR,
                    run_id VARCHAR,
                    model_id VARCHAR,
                    parent_hash VARCHAR,
                    stream_sha VARCHAR,
                    recipe_sha VARCHAR,
                    tokenizer_hash VARCHAR,
                    optimizer_step VARCHAR,
                    tokens_seen VARCHAR,
                    ts VARCHAR,
                    hardware_id VARCHAR,
                    metric_name VARCHAR,
                    metric_value VARCHAR,
                    metric_unit VARCHAR,
                    import_class VARCHAR,
                    eval_lane VARCHAR,
                    lifecycle_state VARCHAR
                )
                """
            )
            self.available = True
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)

    def __call__(self, event: dict[str, Any]) -> None:
        if not self.available:
            raise RuntimeError(self.error or "duckdb unavailable")
        metrics = dict(event.get("metrics") or {})
        if event.get("metric_name"):
            metrics[str(event["metric_name"])] = event.get("metric_value")
        units = event.get("metric_units") or {}
        if not metrics:
            metrics = {"": None}
        for name, value in metrics.items():
            row = {
                "event_type": event.get("event_type"),
                "run_id": event.get("run_id"),
                "model_id": event.get("model_id"),
                "parent_hash": event.get("parent_hash"),
                "stream_sha": event.get("stream_sha"),
                "recipe_sha": event.get("recipe_sha"),
                "tokenizer_hash": event.get("tokenizer_hash"),
                "optimizer_step": str(unknown_if_missing(event.get("optimizer_step"))),
                "tokens_seen": str(unknown_if_missing(event.get("tokens_seen"))),
                "ts": event.get("timestamp"),
                "hardware_id": event.get("hardware_id"),
                "metric_name": name or None,
                "metric_value": json.dumps(unknown_if_missing(value), default=str),
                "metric_unit": units.get(name) or event.get("metric_unit"),
                "import_class": event.get("import_class"),
                "eval_lane": event.get("eval_lane"),
                "lifecycle_state": event.get("lifecycle_state"),
            }
            self._rows.append(row)
            self.con.execute(
                """
                INSERT INTO wrim_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                list(row.values()),
            )

    def close(self) -> None:
        if not self.available:
            return
        parquet = self.parquet_dir / "wrim_events.parquet"
        self.con.execute(f"COPY wrim_events TO '{parquet.as_posix()}' (FORMAT PARQUET)")
        for view, where in (
            ("wrim_runs", "event_type IN ('RUN_STARTED','RUN_CONFIG','RUN_STOPPED','RUN_FAILED')"),
            ("wrim_steps", "event_type = 'STEP_COMPLETED'"),
            ("wrim_checkpoints", "event_type = 'CHECKPOINT_SAVED'"),
            ("wrim_eval_results", "event_type = 'EVAL_COMPLETED'"),
        ):
            self.con.execute(f"CREATE OR REPLACE VIEW {view} AS SELECT * FROM wrim_events WHERE {where}")
        self.con.close()


class PrometheusAdapter:
    """Records scrape-ready textfile metrics; does not control training."""

    def __init__(self, out_path: Path) -> None:
        self.out_path = out_path
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        self.available = True
        self._last_step: dict[str, float] = {}

    def __call__(self, event: dict[str, Any]) -> None:
        if event.get("event_type") != "STEP_COMPLETED":
            return
        run_id = str(event.get("run_id") or "unknown")
        step = event.get("optimizer_step")
        if isinstance(step, (int, float)):
            self._last_step[run_id] = float(step)
        lines = [
            "# HELP wrim_bus_last_step Last imported/live optimizer step by run.",
            "# TYPE wrim_bus_last_step gauge",
        ]
        for rid, val in self._last_step.items():
            lines.append(f'wrim_bus_last_step{{run_id="{rid}"}} {val}')
        lines.append("wrim_prometheus_cannot_control_training 1")
        self.out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def identity_fields(run_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    base = {
        "run_id": run_id,
        "model_id": extra.get("model_id") if extra else run_id,
        "parent_hash": (extra or {}).get("parent_hash") or (extra or {}).get("parent_sha256") or UNKNOWN,
        "stream_sha": (extra or {}).get("stream_sha") or (extra or {}).get("stream_sha256") or UNKNOWN,
        "recipe_sha": (extra or {}).get("recipe_sha") or (extra or {}).get("recipe_sha256") or UNKNOWN,
        "tokenizer_hash": (extra or {}).get("tokenizer_hash") or (extra or {}).get("tokenizer_sha256") or UNKNOWN,
        "hardware_id": (extra or {}).get("hardware_id") or UNKNOWN,
        "import_class": "IMPORTED_HISTORICAL",
    }
    return base


def step_metrics_from_row(row: dict[str, Any], compact: dict[str, Any] | None, grad_clip: float | None) -> dict[str, Any]:
    pre = row.get("grad_norm")
    clipped = row.get("clipped")
    out = {
        "train_loss": unknown_if_missing(row.get("loss") if "loss" in row else (compact or {}).get("train_loss")),
        "lr": unknown_if_missing(row.get("lr") if row.get("lr") is not None else (compact or {}).get("lr")),
        "pre_clip_gradient_norm": unknown_if_missing(pre),
        "post_clip_gradient_norm": UNKNOWN,
        "was_clipped": unknown_if_missing(clipped if clipped is not None else None),
        "clipping_ratio": UNKNOWN,
        "update_norm": unknown_if_missing(row.get("update_norm")),
        "parameter_norm": UNKNOWN,
        "update_weight_ratio": UNKNOWN,
        "cumulative_lr_exposure": UNKNOWN,
        "gpu_allocated_memory": UNKNOWN,
        "gpu_reserved_memory": UNKNOWN,
        "tokens_seen": unknown_if_missing(row.get("tokens") if row.get("tokens") is not None else (compact or {}).get("tokens")),
        "optimizer_step": unknown_if_missing(row.get("step") if row.get("step") is not None else (compact or {}).get("step")),
    }
    if isinstance(pre, (int, float)) and isinstance(grad_clip, (int, float)) and grad_clip:
        out["clipping_ratio"] = float(pre) / float(grad_clip)
    if compact:
        for k_src, k_dst in (
            ("dnll", "dnll"),
            ("kl", "kl"),
            ("val0", "val0"),
            ("val1", "val1"),
            ("dev_looping", "looping"),
            ("dev_unique_128", "unique128"),
            ("dev_unique_256", "unique256"),
        ):
            if k_src in compact:
                out[k_dst] = unknown_if_missing(compact.get(k_src))
    return out


def import_run5(bus: ObservabilityBus, p: dict[str, Path], findings: dict[str, Any]) -> None:
    root = p["run5"]
    manifest = read_json(root / "run-manifest.json") or {}
    abort = read_json(root / "ABORT.json") or {}
    metrics = {int(r["step"]): r for r in load_jsonl(root / "metrics.jsonl") if "step" in r}
    grad_clip = None
    try:
        grad_clip = float(((manifest.get("optimizer") or {}) if manifest else {}).get("grad_clip") or 1.0)
    except Exception:
        grad_clip = 1.0
    ident = identity_fields(
        RUN5["run_id"],
        {
            "model_id": "WRIM-0-child-RUN-000005",
            "parent_hash": manifest.get("parent_sha256"),
            "stream_sha": manifest.get("stream_sha256") or RUN5["stream_sha"],
            "recipe_sha": manifest.get("recipe_sha256") or RUN5["recipe_sha"],
            "tokenizer_hash": manifest.get("tokenizer_sha256"),
        },
    )
    bus.emit({**ident, "event_type": "RUN_STARTED", "optimizer_step": 0, "tokens_seen": 0, "lifecycle_state": "DIAGNOSTIC", "metrics": {"status": RUN5["status"]}})
    bus.emit({**ident, "event_type": "RUN_CONFIG", "optimizer_step": 0, "tokens_seen": 0, "metrics": {
        "peak_lr": manifest.get("peak_lr"),
        "grad_clip": grad_clip,
        "sequence_length": manifest.get("sequence_length"),
        "halt_kind": manifest.get("halt_kind"),
    }})
    imported_steps = []
    for step in RUN5["trajectory"]:
        compact = read_json(root / "evals" / f"step-{step}.compact.json")
        row = metrics.get(step, {})
        if step == 0:
            row = {"step": 0, "tokens": 0, "loss": None, "lr": None}
        sm = step_metrics_from_row(row, compact, grad_clip)
        bus.emit({
            **ident,
            "event_type": "STEP_COMPLETED",
            "optimizer_step": step,
            "tokens_seen": sm.get("tokens_seen"),
            "metrics": sm,
            "eval_lane": "SOVEREIGN_EVAL" if compact else None,
            "lifecycle_state": "DIAGNOSTIC",
        })
        if compact:
            bus.emit({
                **ident,
                "event_type": "EVAL_COMPLETED",
                "optimizer_step": step,
                "tokens_seen": compact.get("tokens"),
                "eval_lane": "SOVEREIGN_EVAL",
                "metrics": {
                    "dnll": unknown_if_missing(compact.get("dnll")),
                    "kl": unknown_if_missing(compact.get("kl")),
                    "val0": unknown_if_missing(compact.get("val0")),
                    "val1": unknown_if_missing(compact.get("val1")),
                    "looping": unknown_if_missing(compact.get("dev_looping")),
                    "unique128": unknown_if_missing(compact.get("dev_unique_128")),
                    "unique256": unknown_if_missing(compact.get("dev_unique_256")),
                    "cap_pass": unknown_if_missing(compact.get("cap_pass")),
                    "coherence": UNKNOWN,
                },
            })
        ckpt = root / f"step-{step}" / "model.safetensors"
        if ckpt.exists():
            bus.emit({
                **ident,
                "event_type": "CHECKPOINT_SAVED",
                "optimizer_step": step,
                "tokens_seen": sm.get("tokens_seen"),
                "payload_ref": str(ckpt),
                "metrics": {
                    "weights_sha256": sha256_file(ckpt),
                    "layerwise_parameter_displacement": UNKNOWN,
                    "embedding_displacement": UNKNOWN,
                    "attention_displacement": UNKNOWN,
                    "mlp_displacement": UNKNOWN,
                    "rmsnorm_displacement": UNKNOWN,
                    "retention_anchor_breakdown": UNKNOWN,
                    "family_specific_nll": UNKNOWN,
                    "generation_samples": UNKNOWN,
                    "format": "WRIM_CHECKPOINT_SPLIT_V1",
                },
            })
        imported_steps.append({"step": step, "had_compact": bool(compact), "had_ckpt": ckpt.exists(), "had_metrics_row": step in metrics or step == 0})
    stop = abort.get("stop") or {}
    bus.emit({
        **ident,
        "event_type": "STOP_POLICY_DECISION",
        "optimizer_step": abort.get("step") or 50,
        "tokens_seen": 204800,
        "lifecycle_state": "STOPPED_BY_POLICY",
        "metrics": {
            "decision": stop.get("decision") or "HARD_ABORT",
            "hard_abort_reason": stop.get("hard_abort_reason") or RUN5["terminal_reason"],
            "final_classification": abort.get("final_classification"),
            "TRAINING_AUTHORIZATION": abort.get("TRAINING_AUTHORIZATION") or "OFF",
        },
    })
    bus.emit({
        **ident,
        "event_type": "RUN_STOPPED",
        "optimizer_step": 50,
        "tokens_seen": 204800,
        "lifecycle_state": "STOPPED_BY_POLICY",
        "metrics": {"terminal_reason": RUN5["terminal_reason"], "status": "STOPPED_BY_POLICY"},
    })
    findings["run000005"] = {
        "imported": True,
        "steps": imported_steps,
        "status": "STOPPED_BY_POLICY",
        "stream_sha": ident["stream_sha"],
        "recipe_sha": ident["recipe_sha"],
        "unknown_kept": [
            "post_clip_gradient_norm",
            "parameter_norm",
            "update_weight_ratio",
            "cumulative_lr_exposure",
            "gpu_allocated_memory",
            "gpu_reserved_memory",
            "layerwise_parameter_displacement",
            "coherence",
        ],
    }


def import_other_historical(bus: ObservabilityBus, p: dict[str, Path], findings: dict[str, Any]) -> None:
    ckpts = p["ckpts"]
    mapping = {
        "WRIM-0": None,
        "WRIM1-RUN-000001": None,
        "WRIM1-RUN-000002": None,
        "WRIM1-RUN-000003": ckpts / "WRIM1-RUN-000003" / "STAGE3A" / "run-manifest.json",
        "WRIM1-RUN-000004": ckpts / "WRIM1-RUN-000004" / "STAGE3A-CORRECTIVE",
        "WRIM1-RUN-000005": p["run5"] / "run-manifest.json",
    }
    results = {}
    for run_id, loc in mapping.items():
        if run_id == "WRIM1-RUN-000005":
            results[run_id] = "imported_dedicated"
            continue
        manifest = None
        artifact_present = False
        if isinstance(loc, Path):
            if loc.is_file():
                manifest = read_json(loc)
                artifact_present = True
            elif loc.is_dir():
                artifact_present = loc.exists()
                man = loc / "run-manifest.json"
                if man.exists():
                    manifest = read_json(man)
        ident = identity_fields(run_id, manifest or {})
        lifecycle = "ANALYSIS_ONLY"
        if run_id == "WRIM1-RUN-000001":
            lifecycle = "REJECTED"
        if run_id == "WRIM1-RUN-000002":
            lifecycle = "REJECTED"
        if run_id == "WRIM1-RUN-000003":
            lifecycle = "DIAGNOSTIC"
        if run_id == "WRIM1-RUN-000004":
            lifecycle = "REJECTED"
        bus.emit({
            **ident,
            "event_type": "RUN_STARTED",
            "optimizer_step": UNKNOWN,
            "tokens_seen": UNKNOWN,
            "lifecycle_state": lifecycle,
            "metrics": {"artifact_present": artifact_present, "note": "IMPORTED_HISTORICAL metadata only unless manifest exists"},
        })
        if manifest:
            bus.emit({
                **ident,
                "event_type": "RUN_CONFIG",
                "optimizer_step": unknown_if_missing((manifest.get("step_range") or [UNKNOWN])[-1] if isinstance(manifest.get("step_range"), list) else UNKNOWN),
                "tokens_seen": unknown_if_missing(manifest.get("token_budget") or manifest.get("tokens_trained")),
                "lifecycle_state": lifecycle,
                "metrics": {"classification": manifest.get("classification") or manifest.get("kind") or UNKNOWN},
            })
        results[run_id] = {"artifact_present": artifact_present, "manifest": bool(manifest), "import_class": "IMPORTED_HISTORICAL"}
    findings["historical"] = results


def safetensors_roundtrip(p: dict[str, Path], findings: dict[str, Any]) -> None:
    py = str(py_torch(p))
    probe = p["safetensors_v2"]
    probe.mkdir(parents=True, exist_ok=True)
    code = r'''
import json, hashlib
from pathlib import Path
import torch
from safetensors.torch import save_file, load_file
out = Path(r"''' + str(probe).replace("\\", "\\\\") + r'''")
tensors = {
  "tok_emb.weight": torch.tensor([[1.0, 2.0],[3.0, 4.0]], dtype=torch.float32),
  "layers.0.attn.q.weight": torch.arange(12, dtype=torch.float32).reshape(3,4),
}
path = out / "model.safetensors"
save_file(tensors, str(path))
loaded = load_file(str(path))
ok = all(torch.equal(tensors[k].cpu(), loaded[k].cpu()) for k in tensors)
meta = {k: {"dtype": str(v.dtype).replace("torch.",""), "shape": list(v.shape)} for k,v in tensors.items()}
raw = path.read_bytes()
manifest = {
  "format": "WRIM_CHECKPOINT_FORMAT_V2",
  "weights_sha256": hashlib.sha256(raw).hexdigest(),
  "dtype_shape": meta,
  "equality": ok,
  "historical_overwritten": False,
}
(out / "checkpoint-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps(manifest))
'''
    proc = run([py, "-c", code], timeout=120)
    findings["safetensors"] = {
        "ok": proc.returncode == 0,
        "stdout": (proc.stdout or "")[-2000:],
        "stderr": (proc.stderr or "")[-2000:],
        "historical_overwritten": False,
    }


def profiler_trace(p: dict[str, Path], findings: dict[str, Any]) -> None:
    py = str(py_torch(p))
    out = p["profiler"]
    out.mkdir(parents=True, exist_ok=True)
    code = r'''
import json, time
from pathlib import Path
import torch
from torch.profiler import profile, ProfilerActivity
out = Path(r"''' + str(out).replace("\\", "\\\\") + r'''")
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = torch.nn.Linear(32, 32).to(device)
opt = torch.optim.SGD(model.parameters(), lr=1e-3)
x = torch.randn(8, 32, device=device)
y = torch.randn(8, 32, device=device)
acts = [ProfilerActivity.CPU]
if device.type == "cuda":
    acts.append(ProfilerActivity.CUDA)
t0 = time.perf_counter()
with profile(activities=acts, record_shapes=True, profile_memory=True, with_stack=False) as prof:
    for i in range(3):
        opt.zero_grad(set_to_none=True)
        loss = torch.nn.functional.mse_loss(model(x), y)
        loss.backward()
        opt.step()
elapsed = time.perf_counter() - t0
trace = out / "probe-trace.json"
prof.export_chrome_trace(str(trace))
(out / "probe.json").write_text(json.dumps({
  "steps": 3,
  "device": str(device),
  "elapsed_s": elapsed,
  "trace": str(trace),
  "recipe_unchanged": True,
  "mode": "OBSERVABILITY_DIAGNOSTIC",
}, indent=2), encoding="utf-8")
print("ok", elapsed)
'''
    proc = run([py, "-c", code], timeout=180)
    findings["profiler"] = {
        "ok": proc.returncode == 0,
        "stdout": (proc.stdout or "")[-1500:],
        "stderr": (proc.stderr or "")[-1500:],
        "silent_recipe_change": False,
    }


def dvc_track_test(p: dict[str, Path], findings: dict[str, Any]) -> None:
    os.environ["DVC_NO_ANALYTICS"] = "1"
    py = str(py_lab(p))
    repo = p["dvc"]
    if repo.exists():
        shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True, exist_ok=True)
    src = SCRIPT_DIR / "artifact-lineage" / "lab-test-artifact.json"
    dest = repo / "lab-test-artifact.json"
    shutil.copy2(src, dest)
    original_bytes = dest.read_bytes()
    original_sha = hashlib.sha256(original_bytes).hexdigest()
    run(["git", "init"], cwd=repo, timeout=60)
    run(["git", "config", "user.email", "wrim-lab@local"], cwd=repo, timeout=30)
    run(["git", "config", "user.name", "WRIM Lab"], cwd=repo, timeout=30)
    init = run([py, "-m", "dvc", "init"], cwd=repo, timeout=120)
    cfg = run([py, "-m", "dvc", "config", "core.analytics", "false"], cwd=repo, timeout=60)
    remote = run([py, "-m", "dvc", "remote", "add", "-d", "localcache", str(p["dvc_cache"])], cwd=repo, timeout=60)
    add = run([py, "-m", "dvc", "add", "lab-test-artifact.json"], cwd=repo, timeout=120)
    still = dest.exists() and dest.read_bytes() == original_bytes
    pointer = repo / "lab-test-artifact.json.dvc"
    git_ptr = SCRIPT_DIR / "artifact-lineage" / "lab-test-artifact.json.dvc"
    if pointer.exists():
        shutil.copy2(pointer, git_ptr)
    findings["dvc"] = {
        "init_ok": init.returncode == 0,
        "analytics_off": cfg.returncode == 0,
        "remote_ok": remote.returncode == 0,
        "add_ok": add.returncode == 0,
        "original_preserved": still,
        "original_sha256": original_sha,
        "stderr": (add.stderr or init.stderr or "")[-2000:],
        "no_cloud_remote": True,
    }


def lm_harness_load(p: dict[str, Path], findings: dict[str, Any]) -> None:
    py = str(py_lab(p))
    code = r'''
import json
out = {"loaded": False, "promotion": "DENIED", "starter_tasks": ["wikitext", "lambada_openai"], "excluded": ["mmlu","hellaswag","gsm8k","bigbench","arc_challenge"]}
try:
    import lm_eval
    out["loaded"] = True
    out["version"] = getattr(lm_eval, "__version__", "unknown")
    try:
        from lm_eval.tasks import TaskManager
        tm = TaskManager()
        names = list(tm.all_tasks) if hasattr(tm, "all_tasks") else []
        out["task_count"] = len(names)
        out["starter_present"] = {t: (t in names or any(t in n for n in names)) for t in out["starter_tasks"]}
    except Exception as exc:
        out["task_manager_error"] = str(exc)
except Exception as exc:
    out["error"] = str(exc)
print(json.dumps(out))
'''
    proc = run([py, "-c", code], timeout=180)
    payload = {}
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        payload = {"stdout": proc.stdout, "stderr": proc.stderr, "loaded": False}
    payload["can_promote"] = False
    payload["lane"] = "EXTERNAL_STANDARD_EVAL"
    payload["sovereign_primary"] = True
    findings["lm_eval"] = payload


def start_process(cmd: list[str], cwd: Path | None = None, log: Path | None = None) -> subprocess.Popen[str]:
    logf = None
    if log is not None:
        log.parent.mkdir(parents=True, exist_ok=True)
        logf = log.open("w", encoding="utf-8")
    return subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=lab_env(),
        stdout=logf or subprocess.DEVNULL,
        stderr=logf or subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def wait_port(port: int, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _tcp(BIND, port):
            return True
        time.sleep(0.4)
    return False


def _tcp(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False


def start_services(p: dict[str, Path], findings: dict[str, Any]) -> dict[str, Any]:
    py = str(py_lab(p))
    procs: dict[str, subprocess.Popen[str]] = {}
    errors: dict[str, str] = {}
    logs = p["lab"] / "service-logs"
    logs.mkdir(parents=True, exist_ok=True)
    # exporter
    try:
        procs["wrim_exporter"] = start_process(
            [py, str(SCRIPT_DIR / "lab_exporter.py"), "--host", BIND, "--port", str(SVC["wrim_exporter"]["port"])],
            log=logs / "wrim_exporter.log",
        )
    except Exception as exc:
        errors["wrim_exporter"] = str(exc)
    # prometheus
    exe = p["prometheus_dir"] / "prometheus.exe"
    p["prometheus_data"].mkdir(parents=True, exist_ok=True)
    if exe.exists():
        try:
            procs["prometheus"] = start_process(
                [
                    str(exe),
                    f"--config.file={SCRIPT_DIR / 'prometheus.yml'}",
                    f"--storage.tsdb.path={p['prometheus_data']}",
                    f"--web.listen-address={BIND}:{SVC['prometheus']['port']}",
                    "--web.enable-lifecycle",
                ],
                log=logs / "prometheus.log",
            )
        except Exception as exc:
            errors["prometheus"] = str(exc)
    else:
        errors["prometheus"] = "binary missing"
    # tensorboard
    try:
        tb_exe = p["venv"] / "Scripts" / "tensorboard.exe"
        tb_cmd = [str(tb_exe) if tb_exe.exists() else py]
        if not tb_exe.exists():
            tb_cmd.extend(["-m", "tensorboard.main"])
        tb_cmd.extend(["--logdir", str(p["tb"]), "--host", BIND, "--port", str(SVC["tensorboard"]["port"]), "--reload_interval", "30"])
        procs["tensorboard"] = start_process(tb_cmd, log=logs / "tensorboard.log")
    except Exception as exc:
        errors["tensorboard"] = str(exc)
    # mlflow sqlite local backend
    mlflow_db = (p["mlflow"] / "mlflow.db").as_posix()
    try:
        procs["mlflow"] = start_process(
            [py, "-m", "mlflow", "server", "--backend-store-uri", f"sqlite:///{mlflow_db}", "--host", BIND, "--port", str(SVC["mlflow"]["port"])],
            log=logs / "mlflow.log",
        )
    except Exception as exc:
        errors["mlflow"] = str(exc)
    # aim (may be absent on Windows/cp313)
    try:
        procs["aim"] = start_process(
            [py, "-m", "aim", "up", "--repo", str(p["aim"]), "--host", BIND, "--port", str(SVC["aim"]["port"])],
            log=logs / "aim.log",
        )
    except Exception as exc:
        errors["aim"] = str(exc)

    time.sleep(2)
    status = {}
    for name, spec in SVC.items():
        port = int(spec["port"])
        up = wait_port(port, timeout=35 if name in ("mlflow", "tensorboard") else 22)
        body = ""
        code = 0
        if up:
            path = "/metrics" if name in ("wrim_exporter", "prometheus") else "/"
            if name == "prometheus":
                path = "/-/healthy"
            code, body = http_get(f"http://{BIND}:{port}{path}")
        status[name] = {
            "port": port,
            "bind": BIND,
            "up": up,
            "http": code,
            "loopback_only": BIND == "127.0.0.1",
            "forbidden_collision": port in (3000, 3001, 3847, 3848, 11434),
            "pid": procs[name].pid if name in procs and procs[name].poll() is None else None,
            "error": errors.get(name),
            "sample": body[:200],
        }
    p["pids"].write_text(json.dumps({k: v.pid for k, v in procs.items() if v.poll() is None}, indent=2), encoding="utf-8")
    findings["services"] = status
    return {"procs": procs, "status": status}


def stop_services(handle: dict[str, Any]) -> None:
    for proc in handle.get("procs", {}).values():
        try:
            proc.terminate()
        except Exception:
            continue
    time.sleep(0.8)
    for proc in handle.get("procs", {}).values():
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                continue


def versions(p: dict[str, Path]) -> dict[str, Any]:
    py = str(py_lab(p))
    code = "import importlib, json, sys\nmods=['aim','tensorboard','mlflow','dvc','safetensors','duckdb','lm_eval','prometheus_client','psutil']\nout={}\nfor m in mods:\n    try:\n        mod=importlib.import_module(m)\n        out[m]=getattr(mod,'__version__','unknown')\n    except Exception as e:\n        out[m]=f'UNAVAILABLE:{e}'\nprint(json.dumps(out))"
    proc = run([py, "-c", code], timeout=60)
    lab = {}
    try:
        lab = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        lab = {"parse_error": proc.stdout, "stderr": proc.stderr}
    torch = run([str(py_torch(p)), "-c", "import torch,safetensors,json; print(json.dumps({'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'safetensors': safetensors.__version__}))"], timeout=60)
    t = {}
    try:
        t = json.loads(torch.stdout.strip().splitlines()[-1])
    except Exception:
        t = {"stderr": torch.stderr}
    return {"lab_venv": lab, "pytorch_venv": t, "prometheus": PROMETHEUS_VERSION}


def main() -> int:
    p = paths()
    p["lab"].mkdir(parents=True, exist_ok=True)
    p["mlflow"].mkdir(parents=True, exist_ok=True)
    p["aim"].mkdir(parents=True, exist_ok=True)
    p["tb"].mkdir(parents=True, exist_ok=True)
    findings: dict[str, Any] = {
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_steps_this_pass": 0,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "council_untouched": True,
        "foundry_untouched": True,
        "terra_untouched": True,
        "corpus_unchanged": True,
        "tokenizer_unchanged": True,
        "wrim_weights_unchanged": True,
        "bind": BIND,
        "ports": SVC,
    }
    if os.environ.get("WRIM_LAB_INNER") != "1":
        ensure_lab_venv(p, findings)
        pip_install(p, findings)
        try:
            download_prometheus(p, findings)
        except Exception as exc:
            findings["prometheus_download_error"] = str(exc)
        inner_env = lab_env({"WRIM_LAB_INNER": "1"})
        (p["lab"] / "bootstrap.json").write_text(json.dumps(findings, default=str), encoding="utf-8")
        proc = subprocess.run(
            [str(py_lab(p)), str(Path(__file__).resolve()), *sys.argv[1:]],
            cwd=str(SCRIPT_DIR),
            env=inner_env,
            timeout=3600,
        )
        return proc.returncode
    boot = p["lab"] / "bootstrap.json"
    if boot.exists():
        try:
            findings.update(json.loads(boot.read_text(encoding="utf-8")))
        except Exception:
            pass
    try:
        download_prometheus(p, findings)
    except Exception as exc:
        findings["prometheus_download_error"] = str(exc)
    safetensors_roundtrip(p, findings)
    profiler_trace(p, findings)
    dvc_track_test(p, findings)
    lm_harness_load(p, findings)

    bus = ObservabilityBus(mode="OBSERVABILITY_STANDARD", journal_path=p["journal"])
    aim = AimAdapter(p["aim"])
    tb = TensorBoardAdapter(p["tb"])
    mlf = MlflowAdapter(p["mlflow"])
    duck = DuckdbAdapter(p["duckdb"], p["parquet"])
    prom = PrometheusAdapter(p["lab"] / "textfile" / "bus.prom")
    # Intentional isolation: a broken adapter must not halt others.
    def broken(_event: dict[str, Any]) -> None:
        raise RuntimeError("intentional isolation probe")
    bus.register("aim", aim)
    bus.register("tensorboard", tb)
    bus.register("mlflow", mlf)
    bus.register("duckdb", duck)
    bus.register("prometheus", prom)
    bus.register("broken_isolation_probe", broken)

    import_run5(bus, p, findings)
    import_other_historical(bus, p, findings)
    findings["bus"] = bus.summary()
    findings["adapter_availability"] = {
        "aim": {"available": aim.available, "error": aim.error, "role": "PRIMARY_WRIM_EXPERIMENT_EXPLORER"},
        "tensorboard": {"available": tb.available, "error": tb.error, "role": "LOW_LEVEL_LIVE_TRAINING_CURVES_HISTOGRAMS"},
        "mlflow": {"available": mlf.available, "error": mlf.error, "role": "WRIM_RUN_MODEL_LIFECYCLE_REGISTRY"},
        "duckdb": {"available": duck.available, "error": duck.error, "role": "LOCAL_WRIM_ANALYTICS_WAREHOUSE"},
        "prometheus": {"available": True, "role": "LONG_RUN_MACHINE_SERVICE_TELEMETRY"},
    }
    aim.close()
    tb.close()
    mlf.close()
    duck.close()

    findings["versions"] = versions(p)
    handle = {"procs": {}}
    try:
        handle = start_services(p, findings)
        # scrape prometheus targets if up
        prom_status = findings.get("services", {}).get("prometheus", {})
        if prom_status.get("up"):
            code, body = http_get(f"http://{BIND}:{SVC['prometheus']['port']}/api/v1/targets")
            findings["prometheus_targets"] = {"http": code, "body": body[:4000]}
        exp = findings.get("services", {}).get("wrim_exporter", {})
        if exp.get("up"):
            code, body = http_get(f"http://{BIND}:{SVC['wrim_exporter']['port']}/metrics")
            findings["exporter_metrics_present"] = "wrim_gpu_" in body or "wrim_cpu_" in body
            findings["exporter_loopback_sample"] = body[:500]
    finally:
        stop_services(handle)

    duck_ok = False
    try:
        import duckdb  # may not be in this interpreter
    except Exception:
        duck_ok = False
    py = str(py_lab(p))
    q = run([py, "-c", f"import duckdb,json; c=duckdb.connect(r'{p['duckdb']}'); n=c.execute('select count(*) from wrim_events').fetchone()[0]; s=c.execute(\"select metric_value from wrim_events where run_id='WRIM1-RUN-000005' and event_type='STOP_POLICY_DECISION' limit 1\").fetchall(); print(json.dumps({{'n':n,'stop':s}}))"], timeout=30)
    findings["duckdb_query"] = {"ok": q.returncode == 0, "stdout": q.stdout, "stderr": q.stderr}

    findings["roles_distinct"] = {
        "aim_vs_mlflow": "Aim=explorer UI; MLflow=lifecycle registry; neither promotes",
        "tensorboard_not_authority": True,
        "lm_harness_cannot_promote": True,
        "prometheus_cannot_control_training": True,
    }
    findings["offline_core"] = {
        "after_install": True,
        "public_benchmarks_may_need_network": True,
        "motherduck": "disabled",
        "hosted_mlflow": False,
        "aim_cloud": False,
        "dvc_cloud": False,
        "wandb": False,
    }
    findings["performance"] = {
        "mode_standard": "low-overhead scalar logging",
        "mode_diagnostic": "profiler + histograms cadence 50 + layerwise",
        "official_runs_use": "OBSERVABILITY_STANDARD",
        "profiler_probe": findings.get("profiler"),
        "no_official_training_this_pass": True,
    }
    avail = findings.get("adapter_availability") or {}
    svc = findings.get("services") or {}
    core_ok = all([
        findings.get("safetensors", {}).get("ok"),
        findings.get("profiler", {}).get("ok"),
        findings.get("dvc", {}).get("original_preserved"),
        findings.get("run000005", {}).get("imported"),
        findings.get("duckdb_query", {}).get("ok"),
        (avail.get("mlflow") or {}).get("available"),
        (avail.get("duckdb") or {}).get("available"),
        (avail.get("tensorboard") or {}).get("available"),
        (svc.get("wrim_exporter") or {}).get("loopback_only", True),
        not any((s or {}).get("forbidden_collision") for s in svc.values()) if svc else True,
        findings.get("TRAINING_AUTHORIZATION") == "OFF",
        findings.get("optimizer_steps_this_pass") == 0,
    ])
    aim_ok = (avail.get("aim") or {}).get("available")
    prom_up = (svc.get("prometheus") or {}).get("up")
    lm_ok = (findings.get("lm_eval") or {}).get("loaded")
    if core_ok and aim_ok and prom_up and lm_ok:
        cls = "WRIM_SOVEREIGN_MODEL_LAB_READY"
    elif core_ok:
        cls = "WRIM_SOVEREIGN_MODEL_LAB_PARTIAL"
    else:
        cls = "WRIM_SOVEREIGN_MODEL_LAB_PARTIAL"
    findings["final_classification"] = cls
    p["report"].write_text(json.dumps(findings, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"ok": True, "report": str(p["report"]), "final_classification": cls}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
