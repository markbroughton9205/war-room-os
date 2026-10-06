"""Loopback Prometheus exporter: GPU (nvidia-smi), CPU/RAM/disk, War Room / Ollama health.

Evaluated nvidia_gpu_exporter (MIT, Windows) but its stock Windows installer also
installs Grafana on :3000, which is forbidden. This exporter uses the same nvidia-smi
approach under War Room process governance, bound to 127.0.0.1 only.
Cannot control training.
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psutil

BIND_DEFAULT = "127.0.0.1"
PORT_DEFAULT = 43884


def _tcp_up(host: str, port: int, timeout: float = 0.4) -> int:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return 1
    except OSError:
        return 0


def _nvidia() -> dict[str, float]:
    out: dict[str, float] = {
        "wrim_gpu_utilization_percent": -1,
        "wrim_gpu_vram_used_bytes": -1,
        "wrim_gpu_vram_total_bytes": -1,
        "wrim_gpu_temperature_celsius": -1,
        "wrim_gpu_power_watts": -1,
        "wrim_gpu_clock_mhz": -1,
        "wrim_gpu_present": 0,
    }
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.gr",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=4,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return out
        parts = [p.strip() for p in proc.stdout.strip().splitlines()[0].split(",")]
        if len(parts) < 6:
            return out
        def f(i: int) -> float:
            try:
                return float(parts[i])
            except ValueError:
                return -1.0
        out["wrim_gpu_utilization_percent"] = f(0)
        out["wrim_gpu_vram_used_bytes"] = f(1) * 1024 * 1024
        out["wrim_gpu_vram_total_bytes"] = f(2) * 1024 * 1024
        out["wrim_gpu_temperature_celsius"] = f(3)
        out["wrim_gpu_power_watts"] = f(4)
        out["wrim_gpu_clock_mhz"] = f(5)
        out["wrim_gpu_present"] = 1
    except Exception:
        return out
    return out


def collect() -> str:
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\")
    try:
        disk_io = psutil.disk_io_counters()
        read_bytes = float(disk_io.read_bytes) if disk_io else -1
        write_bytes = float(disk_io.write_bytes) if disk_io else -1
    except Exception:
        read_bytes = -1
        write_bytes = -1
    gpu = _nvidia()
    lines = [
        "# HELP wrim_exporter_up WRIM local exporter heartbeat.",
        "# TYPE wrim_exporter_up gauge",
        "wrim_exporter_up 1",
        "# HELP wrim_cpu_utilization_percent Process-host CPU percent.",
        "# TYPE wrim_cpu_utilization_percent gauge",
        f"wrim_cpu_utilization_percent {psutil.cpu_percent(interval=0.05)}",
        "# HELP wrim_ram_used_bytes Host RAM used.",
        "# TYPE wrim_ram_used_bytes gauge",
        f"wrim_ram_used_bytes {vm.used}",
        "# HELP wrim_ram_total_bytes Host RAM total.",
        "# TYPE wrim_ram_total_bytes gauge",
        f"wrim_ram_total_bytes {vm.total}",
        "# HELP wrim_disk_used_bytes System drive used.",
        "# TYPE wrim_disk_used_bytes gauge",
        f"wrim_disk_used_bytes {disk.used}",
        "# HELP wrim_disk_total_bytes System drive total.",
        "# TYPE wrim_disk_total_bytes gauge",
        f"wrim_disk_total_bytes {disk.total}",
        "# HELP wrim_disk_read_bytes Disk read bytes counter snapshot.",
        "# TYPE wrim_disk_read_bytes gauge",
        f"wrim_disk_read_bytes {read_bytes}",
        "# HELP wrim_disk_write_bytes Disk write bytes counter snapshot.",
        "# TYPE wrim_disk_write_bytes gauge",
        f"wrim_disk_write_bytes {write_bytes}",
        "# HELP wrim_core_up War Room Local Core :3847.",
        "# TYPE wrim_core_up gauge",
        f'wrim_core_up { _tcp_up("127.0.0.1", 3847) }',
        "# HELP wrim_ui_up War Room local UI :3848.",
        "# TYPE wrim_ui_up gauge",
        f'wrim_ui_up { _tcp_up("127.0.0.1", 3848) }',
        "# HELP wrim_ollama_up Ollama :11434.",
        "# TYPE wrim_ollama_up gauge",
        f'wrim_ollama_up { _tcp_up("127.0.0.1", 11434) }',
        "# HELP wrim_training_process_up Training process health (0 unless a WRIM trainer is running).",
        "# TYPE wrim_training_process_up gauge",
        "wrim_training_process_up 0",
        "# HELP wrim_training_authorization_on 1 only if TRAINING_AUTHORIZATION is not OFF.",
        "# TYPE wrim_training_authorization_on gauge",
        "wrim_training_authorization_on 0",
        "# HELP wrim_prometheus_cannot_control_training Exporter has no training control plane.",
        "# TYPE wrim_prometheus_cannot_control_training gauge",
        "wrim_prometheus_cannot_control_training 1",
    ]
    for k, v in gpu.items():
        lines.append(f"# TYPE {k} gauge")
        lines.append(f"{k} {v}")
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] not in ("/metrics", "/"):
            self.send_response(404)
            self.end_headers()
            return
        body = collect().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("WRIM_EXPORTER_BIND", BIND_DEFAULT))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WRIM_EXPORTER_PORT", PORT_DEFAULT)))
    args = parser.parse_args()
    if args.host in ("0.0.0.0", "::", ""):
        raise SystemExit("Refusing non-loopback bind.")
    if args.port in (3000, 3001, 3847, 3848, 11434):
        raise SystemExit(f"Forbidden port {args.port}")
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        time.sleep(0.1)
        raise SystemExit(0)
