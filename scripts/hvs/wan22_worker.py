#!/usr/bin/env python3
"""
HVS-GENERATIVE-VIDEO-01 — dedicated Wan 2.2 TI2V-5B worker process.

Launched ONLY by lib/media-command/generative/supervisor.ts with fixed argv (this file) and a typed JSON
object on stdin (schema hvs.wan22.worker-input.v1). It never takes commands, shell strings, code, or URLs.
Torch lives here, never in the Next.js process.

Protocol (stdout): lines `HVS_EVENT {json}` — ready / state / progress / vram / result / error.
Everything else (library logs, tqdm) goes to stderr.

Mirrors the official ti2v-5B branch of github.com/Wan-Video/Wan2.2 generate.py (WanTI2V + save_video),
with the official single-GPU low-memory flags (offload_model, t5_cpu, convert_model_dtype).
Network is disabled in-process (HF/Transformers offline env + socket guard). No prompt extension
(no dashscope / no remote LLM) is ever used.
"""
import json
import logging
import os
import socket
import sys
import time
import traceback

SCHEMA = "hvs.wan22.worker-input.v1"
APPROVED_MODEL_IDS = {"wan2.2-ti2v-5b"}
SUPPORTED_SIZES = {(1280, 704), (704, 1280)}
EXIT_INVALID, EXIT_OOM, EXIT_LOAD, EXIT_GEN, EXIT_ENCODE = 2, 3, 4, 5, 6

_real_stdout = sys.stdout
sys.stdout = sys.stderr  # library prints never reach the event channel
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="[wan22-worker] %(levelname)s: %(message)s")


def emit(event, **payload):
    payload["event"] = event
    _real_stdout.write("HVS_EVENT " + json.dumps(payload, separators=(",", ":")) + "\n")
    _real_stdout.flush()


def fail(code, message, exit_code):
    emit("error", code=code, message=str(message)[:500])
    sys.exit(exit_code)


def install_network_guard():
    """Refuse any non-loopback connection from inside the worker."""
    real_connect = socket.socket.connect

    def guarded_connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if self.family == getattr(socket, "AF_UNIX", None) or host in ("127.0.0.1", "::1", "localhost"):
            return real_connect(self, address)
        raise OSError("HVS wan22 worker: network access is disabled during local generation")

    socket.socket.connect = guarded_connect

    def guarded_create_connection(address, *args, **kwargs):
        raise OSError("HVS wan22 worker: network access is disabled during local generation")

    socket.create_connection = guarded_create_connection


def validate(job):
    if not isinstance(job, dict) or job.get("schema") != SCHEMA:
        raise ValueError("bad schema")
    allowed = {
        "schema", "generationId", "modelId", "task", "prompt", "frames", "width", "height", "fps", "seed",
        "sampleSteps", "offloadModel", "t5Cpu", "convertModelDtype", "memoryMode", "inputImagePath",
        "outputPath", "checkpointDir", "codeDir", "ffmpegPath",
    }
    extra = set(job) - allowed
    if extra:
        raise ValueError("unexpected fields: " + ",".join(sorted(extra)))
    if job["modelId"] not in APPROVED_MODEL_IDS or job["task"] != "ti2v-5B":
        raise ValueError("model not approved")
    if not isinstance(job["prompt"], str) or not (3 <= len(job["prompt"]) <= 1500):
        raise ValueError("prompt bounds")
    if (int(job["width"]), int(job["height"])) not in SUPPORTED_SIZES:
        raise ValueError("unsupported size")
    frames = int(job["frames"])
    if frames < 5 or frames > 121 or (frames - 1) % 4 != 0:
        raise ValueError("frames must be 4n+1 in [5,121]")
    if int(job["fps"]) != 24:
        raise ValueError("fps must be 24")
    if not (0 <= int(job["seed"]) <= 2147483647):
        raise ValueError("seed bounds")
    steps = job.get("sampleSteps")
    if steps is not None and not (1 <= int(steps) <= 100):
        raise ValueError("sampleSteps bounds")
    for key in ("outputPath", "checkpointDir", "codeDir"):
        if not isinstance(job[key], str) or not os.path.isabs(job[key]) or "\x00" in job[key]:
            raise ValueError(key + " must be absolute")
    if not job["outputPath"].endswith(".mp4"):
        raise ValueError("outputPath must be .mp4")
    if not os.path.isdir(os.path.dirname(job["outputPath"])):
        raise ValueError("output directory missing")
    img = job.get("inputImagePath")
    if img is not None and (not isinstance(img, str) or not os.path.isabs(img) or not os.path.isfile(img)):
        raise ValueError("inputImagePath invalid")
    return job


def import_wan(code_dir):
    sys.path.insert(0, code_dir)
    try:
        import wan  # noqa: F401
        return "official-full"
    except ImportError as exc:
        # wan/__init__.py also imports the S2V / Animate pipelines (decord, peft, librosa...). TI2V does not
        # use them. Stub ONLY those two unused pipeline modules and retry; record the mode in provenance.
        missing = getattr(exc, "name", "") or str(exc)
        logging.warning("official wan import failed (%s); retrying with unused S2V/Animate pipelines stubbed", missing)
        import types
        for mod, cls in (("wan.speech2video", "WanS2V"), ("wan.animate", "WanAnimate")):
            stub = types.ModuleType(mod)
            setattr(stub, cls, None)
            sys.modules[mod] = stub
        for name in [n for n in list(sys.modules) if n == "wan" or (n.startswith("wan.") and n not in ("wan.speech2video", "wan.animate"))]:
            del sys.modules[name]
        import wan  # noqa: F401
        return "ti2v-only (s2v/animate stubbed: %s)" % missing


def main():
    raw = sys.stdin.readline()
    try:
        job = validate(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        fail("INVALID_GENERATION_REQUEST", "worker input rejected: %s" % exc, EXIT_INVALID)

    install_network_guard()
    # HVS-GENERATIVE-VIDEO-01A: if the host runs out of RAM, the kernel OOM killer must pick this worker,
    # never the Commander's desktop apps. Raising our own oom_score_adj needs no privilege.
    oom_score_adj = None
    try:
        with open("/proc/self/oom_score_adj", "w") as fh:
            fh.write("1000")
        oom_score_adj = 1000
    except OSError:
        pass
    try:
        import torch
    except Exception as exc:  # noqa: BLE001
        fail("MODEL_LOAD_FAILED", "torch import failed: %s" % exc, EXIT_LOAD)
    cuda = bool(torch.cuda.is_available())
    device_name = torch.cuda.get_device_name(0) if cuda else None
    if not cuda:
        fail("GPU_UNAVAILABLE", "CUDA not available in worker runtime", EXIT_LOAD)

    try:
        wan_import_mode = import_wan(job["codeDir"])
        import wan
        import wan.modules.attention as wan_attention
        import wan.modules.model as wan_model
        from wan.configs import MAX_AREA_CONFIGS, SIZE_CONFIGS, WAN_CONFIGS
        from wan.utils.utils import save_video
    except Exception as exc:  # noqa: BLE001
        fail("MODEL_LOAD_FAILED", "official Wan2.2 code import failed: %s" % exc, EXIT_LOAD)

    attention = "flash_attn"
    if not (wan_attention.FLASH_ATTN_2_AVAILABLE or wan_attention.FLASH_ATTN_3_AVAILABLE):
        if os.environ.get("HVS_WAN22_ALLOW_SDPA_FALLBACK") == "1":
            # UNOFFICIAL: torch SDPA via wan.modules.attention.attention (ignores padding masks). Opt-in only.
            wan_model.flash_attention = lambda *a, **k: wan_attention.attention(*a, **{("fa_version" if kk == "version" else kk): v for kk, v in k.items()})
            attention = "sdpa-fallback (unofficial, opt-in)"
        else:
            fail("MODEL_LOAD_FAILED", "flash_attn is not installed in the worker runtime; the official WanModel requires it "
                 "(set HVS_WAN22_ALLOW_SDPA_FALLBACK=1 to opt into the unofficial SDPA path)", EXIT_LOAD)

    # HVS-GENERATIVE-VIDEO-01A: host-RAM-only loading adjustment (NOT quantization, NOT an offload change).
    # The official path loads the fp32 DiT shards (~20 GB) and then casts to bf16 when convert_model_dtype=True,
    # and torch.load()s the 11 GB T5 checkpoint into a second full copy. On a 30 GB host this exceeds free RAM.
    # With convert_model_dtype=True we (a) load the DiT directly in cfg.param_dtype (bf16) - the same per-tensor
    # rounding the official model.to(bf16) performs - and (b) torch.load checkpoints with mmap=True.
    # Opt out with HVS_WAN22_OFFICIAL_HOST_LOAD=1. Recorded as hostRamLoad in actual settings/provenance.
    host_ram_load = "official"
    if bool(job["convertModelDtype"]) and os.environ.get("HVS_WAN22_OFFICIAL_HOST_LOAD") != "1":
        host_ram_load = "bf16-direct+mmap"
    emit("ready", python=sys.version.split()[0], torch=torch.__version__, cuda=cuda, device=device_name,
         attention=attention, wanImportMode=wan_import_mode, fake=False, hostRamLoad=host_ram_load,
         cudaRuntime=torch.version.cuda, oomScoreAdj=oom_score_adj,
         hfOffline=os.environ.get("HF_HUB_OFFLINE") == "1", networkGuard=True)

    # Real step progress from the official sampler loop (tqdm over timesteps).
    import wan.textimage2video as ti2v_mod
    real_tqdm = ti2v_mod.tqdm

    def progress_tqdm(iterable, *args, **kwargs):
        items = list(iterable)
        total = len(items)
        for i, item in enumerate(real_tqdm(items, *args, **kwargs)):
            yield item
            emit("progress", step=i + 1, total=total)
    ti2v_mod.tqdm = progress_tqdm

    width, height = int(job["width"]), int(job["height"])
    size_key = "%d*%d" % (width, height)
    cfg = WAN_CONFIGS["ti2v-5B"]
    emit("state", state="LOADING_MODEL")
    restore = []
    if host_ram_load != "official":
        orig_from_pretrained = wan_model.WanModel.from_pretrained.__func__

        def bf16_from_pretrained(klass, *args, **kwargs):
            kwargs.setdefault("torch_dtype", cfg.param_dtype)
            return orig_from_pretrained(klass, *args, **kwargs)
        wan_model.WanModel.from_pretrained = classmethod(bf16_from_pretrained)
        orig_torch_load = torch.load

        def mmap_torch_load(f, *args, **kwargs):
            kwargs.setdefault("mmap", True)
            return orig_torch_load(f, *args, **kwargs)
        torch.load = mmap_torch_load
        restore = [lambda: setattr(wan_model.WanModel, "from_pretrained", classmethod(orig_from_pretrained)),
                   lambda: setattr(torch, "load", orig_torch_load)]
    load_started = time.time()
    try:
        pipe = wan.WanTI2V(
            config=cfg,
            checkpoint_dir=job["checkpointDir"],
            device_id=0,
            rank=0,
            t5_fsdp=False,
            dit_fsdp=False,
            use_sp=False,
            t5_cpu=bool(job["t5Cpu"]),
            convert_model_dtype=bool(job["convertModelDtype"]),
        )
    except torch.cuda.OutOfMemoryError as exc:
        fail("GPU_OUT_OF_MEMORY", "OOM while loading Wan2.2 TI2V-5B: %s" % exc, EXIT_OOM)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        fail("MODEL_LOAD_FAILED", "WanTI2V init failed: %s" % exc, EXIT_LOAD)
    finally:
        for undo in restore:
            undo()
    emit("vram", allocatedMiB=round(torch.cuda.memory_allocated() / 1048576),
         reservedMiB=round(torch.cuda.memory_reserved() / 1048576), phase="loaded",
         loadSeconds=round(time.time() - load_started, 2))

    img = None
    if job.get("inputImagePath"):
        from PIL import Image
        img = Image.open(job["inputImagePath"]).convert("RGB")

    emit("state", state="GENERATING")
    torch.cuda.reset_peak_memory_stats()
    gen_started = time.time()
    try:
        video = pipe.generate(
            job["prompt"],
            img=img,
            size=SIZE_CONFIGS[size_key],
            max_area=MAX_AREA_CONFIGS[size_key],
            frame_num=int(job["frames"]),
            shift=cfg.sample_shift,
            sample_solver="unipc",
            sampling_steps=int(job["sampleSteps"] or cfg.sample_steps),
            guide_scale=cfg.sample_guide_scale,
            seed=int(job["seed"]),
            offload_model=bool(job["offloadModel"]),
        )
    except torch.cuda.OutOfMemoryError as exc:
        emit("vram", peakMiB=round(torch.cuda.max_memory_allocated() / 1048576))
        fail("GPU_OUT_OF_MEMORY", "CUDA out of memory during sampling: %s" % str(exc)[:300], EXIT_OOM)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        fail("GENERATION_FAILED", "Wan2.2 sampling failed: %s" % exc, EXIT_GEN)
    emit("vram", peakMiB=round(torch.cuda.max_memory_allocated() / 1048576),
         reservedMiB=round(torch.cuda.max_memory_reserved() / 1048576), phase="generated",
         generateSeconds=round(time.time() - gen_started, 2))

    emit("state", state="ENCODING")
    out = job["outputPath"]
    partial = out[:-4] + ".partial.mp4"
    save_video(tensor=video[None], save_file=partial, fps=cfg.sample_fps, nrow=1, normalize=True, value_range=(-1, 1))
    if not os.path.isfile(partial) or os.path.getsize(partial) == 0:
        fail("ENCODE_FAILED", "official save_video produced no file (imageio/ffmpeg)", EXIT_ENCODE)
    os.replace(partial, out)
    frames = int(video.shape[1]) if hasattr(video, "shape") and len(video.shape) >= 2 else int(job["frames"])
    emit("result", outputPath=out, frames=frames, width=width, height=height, fps=int(cfg.sample_fps),
         seed=int(job["seed"]), fake=False, fixture=False,
         actual={"memoryMode": job["memoryMode"], "attention": attention, "wanImportMode": wan_import_mode,
                 "hostRamLoad": host_ram_load})
    return 0


if __name__ == "__main__":
    started = time.time()
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        fail("GENERATION_FAILED", "worker crashed: %s" % exc, EXIT_GEN)
