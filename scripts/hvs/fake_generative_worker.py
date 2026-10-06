#!/usr/bin/env python3
"""
FAKE GENERATIVE WORKER — TEST ONLY (HVS-GENERATIVE-VIDEO-01 validator).

Exercises supervision paths (ready / crash / hang / OOM / load failure / bad output) without torch or weights.
`success-fixture` writes a deterministic ffmpeg testsrc clip. Every event carries fake=true / fixture=true;
HVS records such outputs with liveGeneration=false and they are NEVER accepted as live Wan generation proof.
The real app never launches this file (test hooks require HVS_GENERATIVE_TEST_HOOKS=1).
"""
import json
import os
import subprocess
import sys
import time


def emit(event, **payload):
    payload["event"] = event
    sys.stdout.write("HVS_EVENT " + json.dumps(payload) + "\n")
    sys.stdout.flush()


def fixture(job, frames):
    out = job["outputPath"]
    partial = out[:-4] + ".partial.mp4"
    w, h, fps = int(job["width"]) // 4, int(job["height"]) // 4, int(job["fps"])
    dur = frames / fps
    ff = job.get("ffmpegPath") or "ffmpeg"
    subprocess.run([ff, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=%dx%d:rate=%d" % (w, h, fps),
                    "-t", "%.3f" % dur, "-c:v", "libx264", "-pix_fmt", "yuv420p", partial], check=True)
    os.replace(partial, out)
    emit("result", outputPath=out, frames=frames, width=w, height=h, fps=fps, seed=int(job["seed"]), fake=True, fixture=True,
         actual={"memoryMode": job.get("memoryMode")})


def main():
    job = json.loads(sys.stdin.readline())
    mode = job.get("fakeMode", "success-fixture")
    emit("ready", python=sys.version.split()[0], torch=None, cuda=False, device=None, fake=True, attention=None, wanImportMode="FAKE")
    emit("state", state="LOADING_MODEL")
    if mode == "load-fail":
        emit("error", code="MODEL_LOAD_FAILED", message="FAKE: checkpoint could not be loaded")
        return 4
    if mode == "crash-load":
        os._exit(9)
    emit("state", state="GENERATING")
    for i in range(1, 4):
        emit("progress", step=i, total=3)
    if mode == "crash":
        os._exit(9)
    if mode == "hang":
        subprocess.Popen(["sleep", "300"])  # grandchild in the same process group: must be killed too
        time.sleep(300)
        return 0
    if mode == "oom" or (mode == "oom-then-success" and job.get("memoryMode") != "REDUCED_MEMORY_RETRY"):
        sys.stderr.write("torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB (FAKE)\n")
        sys.stderr.flush()
        emit("vram", peakMiB=15000)
        return 1
    emit("state", state="ENCODING")
    if mode == "no-output":
        emit("result", outputPath=job["outputPath"], frames=job["frames"], width=job["width"], height=job["height"], fps=24, seed=job["seed"], fake=True, fixture=True)
        return 0
    if mode == "escape-path":
        emit("result", outputPath="/tmp/hvs-fake-escape.mp4", frames=job["frames"], width=job["width"], height=job["height"], fps=24, seed=job["seed"], fake=True, fixture=True)
        return 0
    fixture(job, int(job["frames"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
