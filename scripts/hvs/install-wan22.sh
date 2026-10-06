#!/usr/bin/env bash
# HVS-GENERATIVE-VIDEO-01 — Wan 2.2 TI2V-5B local install helper.
#
# Default: PLAN ONLY (prints checks + exact actions, changes nothing).
# Steps are opt-in and independent:
#   --venv       create an isolated uv venv under <models>/runtimes/wan22/venv and install pinned deps
#   --code       fetch the official Wan2.2 code at a pinned commit into <models>/runtimes/wan22/Wan2.2
#   --flash-attn try to build flash-attn 2.8.3.post1 into the venv (needs nvcc matching torch's CUDA; may fail)
#   --download   download weights Wan-AI/Wan2.2-TI2V-5B @ pinned revision into <models>/Wan2.2-TI2V-5B
#                (≈34.2 GB; ONLY with this flag; refuses if free space is insufficient)
#   --check      metadata-only: query the HF API file listing for the real download size
#   --models-dir DIR   (else $HVS_GENERATIVE_MODELS_DIR, else <app-data>/data/media-command/models/generative)
#   --require-mount MNT  refuse unless the models dir resolves (findmnt -T) onto mount point MNT (never fall back to root)
#
# Never uses sudo, never touches system Python, never installs dashscope (cloud prompt-extension SDK) or any
# cloud client. Recommended on Nebula-Genesis (root disk ~97% full):
#   HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models scripts/hvs/install-wan22.sh --venv --code
#   HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models scripts/hvs/install-wan22.sh --download
# Then export the same HVS_GENERATIVE_MODELS_DIR for the War Room / HVS server process.
set -euo pipefail

HF_REPO="Wan-AI/Wan2.2-TI2V-5B"
HF_REVISION="921dbaf3f1674a56f47e83fb80a34bac8a8f203e"     # observed 2026-10-02 (HF lastModified 2025-08-07)
CODE_COMMIT="1ea34ff48f87168174e12956e200b1d908b1c5ff"    # github.com/Wan-Video/Wan2.2 main @ 2026-09-21
WEIGHTS_BYTES=34203123497                                   # HF API tree total @ HF_REVISION
VENV_ESTIMATE_BYTES=$((12 * 1024 * 1024 * 1024))           # ESTIMATE: torch cu130 + CUDA libs + deps + uv cache
MARGIN_BYTES=$((4 * 1024 * 1024 * 1024))
PY_VERSION="3.12"
TORCH_INDEX="https://download.pytorch.org/whl/cu130"
# Pins chosen for RTX 50xx (sm_120): torch 2.13.0+cu130 is already proven on this machine by another venv.
# Remaining pins satisfy the official Wan2.2 requirements.txt ranges. NOT install-tested in HVS-GENERATIVE-VIDEO-01.
TORCH_PINS=("torch==2.13.0" "torchvision==0.28.0")
PY_PINS=(
  "numpy==1.26.4" "opencv-python==4.11.0.86" "diffusers==0.33.1" "transformers==4.51.3" "tokenizers==0.21.1"
  "accelerate==1.6.0" "huggingface_hub==0.34.4" "safetensors==0.5.3" "tqdm==4.67.1" "imageio==2.37.0"
  "imageio-ffmpeg==0.6.0" "easydict==1.13" "ftfy==6.3.1" "einops==0.8.1" "regex==2024.11.6" "pillow==11.2.1"
)

DO_VENV=0; DO_CODE=0; DO_FA=0; DO_DOWNLOAD=0; DO_CHECK=0; REQUIRE_MOUNT=""
MODELS_DIR="${HVS_GENERATIVE_MODELS_DIR:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --venv) DO_VENV=1 ;;
    --code) DO_CODE=1 ;;
    --flash-attn) DO_FA=1 ;;
    --download) DO_DOWNLOAD=1 ;;
    --check) DO_CHECK=1 ;;
    --models-dir) shift; MODELS_DIR="${1:?--models-dir needs a path}" ;;
    --require-mount) shift; REQUIRE_MOUNT="${1:?--require-mount needs a mount point}" ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

APP_ROOT="${WAR_ROOM_LOCAL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/war-room-os}"
MODELS_DIR="${MODELS_DIR:-$APP_ROOT/data/media-command/models/generative}"
case "$MODELS_DIR" in /*) ;; *) echo "models dir must be absolute" >&2; exit 2 ;; esac
MODEL_PATH="${HVS_WAN22_MODEL_PATH:-$MODELS_DIR/Wan2.2-TI2V-5B}"
RUNTIME_DIR="$MODELS_DIR/runtimes/wan22"
VENV="$RUNTIME_DIR/venv"
CODE_DIR="$RUNTIME_DIR/Wan2.2"
export UV_CACHE_DIR="$MODELS_DIR/.uv-cache"            # keep caches off the root disk
export UV_PYTHON_INSTALL_DIR="$MODELS_DIR/.uv-python"
export HF_HOME="$MODELS_DIR/.hf-home"
# HVS-GENERATIVE-VIDEO-01A: keep every temp/cache dir off the (nearly full) root disk too.
export HF_HUB_CACHE="$HF_HOME/hub"
export PIP_CACHE_DIR="$MODELS_DIR/.pip-cache"
export XDG_CACHE_HOME="$MODELS_DIR/.cache"
export TMPDIR="$MODELS_DIR/.tmp"

free_bytes() { local p="$1"; while [[ ! -e "$p" ]]; do p="$(dirname "$p")"; done; df -B1 --output=avail "$p" | tail -1 | tr -d ' '; }
human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"; }
need_space() { # $1 bytes needed, $2 label
  local free; free="$(free_bytes "$MODELS_DIR")"
  echo "  free at $MODELS_DIR: $(human "$free"); needed for $2: $(human "$1") (+$(human "$MARGIN_BYTES") margin)"
  if (( free < $1 + MARGIN_BYTES )); then
    echo "REFUSED: insufficient disk space for $2 at $MODELS_DIR. Choose a larger volume via --models-dir / HVS_GENERATIVE_MODELS_DIR." >&2
    exit 3
  fi
}

mount_of() { local p="$1"; while [[ ! -e "$p" ]]; do p="$(dirname "$p")"; done; findmnt -n -o TARGET -T "$(realpath "$p")"; }
MOUNT_TARGET="$(mount_of "$MODELS_DIR")"
if [[ -n "$REQUIRE_MOUNT" && "$MOUNT_TARGET" != "$REQUIRE_MOUNT" ]]; then
  echo "REFUSED: $MODELS_DIR resolves onto mount '$MOUNT_TARGET', not required '$REQUIRE_MOUNT'." >&2; exit 3
fi
echo "HVS Wan 2.2 TI2V-5B installer"
echo "  models dir : $MODELS_DIR"
echo "  model path : $MODEL_PATH"
echo "  venv       : $VENV (python $PY_VERSION via uv; caches under $MODELS_DIR)"
echo "  code       : $CODE_DIR @ $CODE_COMMIT"
echo "  weights    : $HF_REPO @ $HF_REVISION ($(human $WEIGHTS_BYTES), from HF API file listing)"
echo "  free space : $(human "$(free_bytes "$MODELS_DIR")") at $MODELS_DIR"
echo "  mount      : $MOUNT_TARGET ($(findmnt -n -o FSTYPE -T "$MOUNT_TARGET" 2>/dev/null)); TMPDIR/caches under $MODELS_DIR"

if (( DO_CHECK )); then
  echo "Querying HF API file listing (metadata only, no weights)…"
  curl -fsS -m 30 "https://huggingface.co/api/models/$HF_REPO/tree/$HF_REVISION?recursive=true" \
    | python3 -c 'import json,sys; t=json.load(sys.stdin); s=sum(f.get("lfs",{}).get("size",f.get("size",0)) for f in t if f.get("type")=="file"); print("  HF listing total:", s, "bytes")' \
    || echo "  HF API unreachable; using recorded size $WEIGHTS_BYTES bytes (recorded 2026-10-02)."
fi

if (( ! DO_VENV && ! DO_CODE && ! DO_FA && ! DO_DOWNLOAD )); then
  echo
  echo "PLAN ONLY. Nothing changed. Steps (each opt-in):"
  echo "  $0 --models-dir $MODELS_DIR --venv --code      # isolated runtime (~$(human $VENV_ESTIMATE_BYTES) ESTIMATE)"
  echo "  $0 --models-dir $MODELS_DIR --flash-attn       # optional, official attention kernel (source build)"
  echo "  $0 --models-dir $MODELS_DIR --download         # $(human $WEIGHTS_BYTES) weights (Commander authorization required)"
  exit 0
fi

command -v uv >/dev/null || { echo "uv not found on PATH (no global installs are performed by this script)" >&2; exit 4; }
mkdir -p "$TMPDIR" "$UV_CACHE_DIR" "$PIP_CACHE_DIR" "$XDG_CACHE_HOME" "$HF_HOME"

if (( DO_VENV )); then
  need_space "$VENV_ESTIMATE_BYTES" "Python runtime (estimate)"
  mkdir -p "$RUNTIME_DIR"
  [[ -x "$VENV/bin/python" ]] || uv venv --python "$PY_VERSION" --python-preference only-managed --link-mode copy "$VENV"
  uv pip install --python "$VENV/bin/python" --link-mode copy --index-url "$TORCH_INDEX" "${TORCH_PINS[@]}"
  uv pip install --python "$VENV/bin/python" --link-mode copy "${PY_PINS[@]}"
  "$VENV/bin/python" -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_arch_list())'
fi

if (( DO_CODE )); then
  mkdir -p "$RUNTIME_DIR"
  tmp_tar="$RUNTIME_DIR/wan22-$CODE_COMMIT.tar.gz"
  curl -fsSL -m 120 -o "$tmp_tar" "https://codeload.github.com/Wan-Video/Wan2.2/tar.gz/$CODE_COMMIT"
  rm -rf "$CODE_DIR.new" && mkdir -p "$CODE_DIR.new"
  tar -xzf "$tmp_tar" -C "$CODE_DIR.new" --strip-components=1
  [[ -f "$CODE_DIR.new/generate.py" && -f "$CODE_DIR.new/wan/textimage2video.py" ]] || { echo "code archive incomplete" >&2; exit 5; }
  [[ -e "$CODE_DIR" ]] && mv "$CODE_DIR" "$CODE_DIR.prev-$(date +%s)"
  mv "$CODE_DIR.new" "$CODE_DIR"
  echo "$CODE_COMMIT" > "$CODE_DIR/HVS_CODE_COMMIT"
  rm -f "$tmp_tar"
fi

if (( DO_FA )); then
  [[ -x "$VENV/bin/python" ]] || { echo "run --venv first" >&2; exit 4; }
  echo "Building flash-attn from source (long; requires nvcc compatible with torch's CUDA 13.0)…"
  uv pip install --python "$VENV/bin/python" --link-mode copy ninja packaging psutil setuptools wheel
  # One bounded attempt (HVS_FA_TIMEOUT seconds, default 2700); arch limited to the local GPU (sm_120) by default.
  FLASH_ATTN_CUDA_ARCHS="${FLASH_ATTN_CUDA_ARCHS:-120}" MAX_JOBS="${MAX_JOBS:-4}" timeout "${HVS_FA_TIMEOUT:-2700}" \
    uv pip install --python "$VENV/bin/python" --link-mode copy --no-build-isolation "flash-attn==2.8.3.post1" \
    || echo "flash-attn build FAILED. Worker will report MODEL_LOAD_FAILED unless HVS_WAN22_ALLOW_SDPA_FALLBACK=1 (unofficial)." >&2
fi

if (( DO_DOWNLOAD )); then
  [[ -x "$VENV/bin/python" ]] || { echo "run --venv first (download uses the venv's huggingface_hub)" >&2; exit 4; }
  need_space "$WEIGHTS_BYTES" "Wan2.2-TI2V-5B weights"
  mkdir -p "$MODEL_PATH"
  # HVS-GENERATIVE-VIDEO-01A: plain resumable HTTP streaming to disk. hf_xet was observed buffering whole shards in
  # RAM (0-byte .incomplete files, RSS climbing) on this 30 GB host, so Xet is disabled for this download.
  HF_HUB_DISABLE_XET=1 HF_HUB_ENABLE_HF_TRANSFER=0 "$VENV/bin/python" - "$HF_REPO" "$HF_REVISION" "$MODEL_PATH" <<'PY'
import json, os, sys
from huggingface_hub import snapshot_download
repo, rev, dest = sys.argv[1:4]
snapshot_download(repo_id=repo, revision=rev, local_dir=dest, max_workers=4, allow_patterns=[
    "config.json", "configuration.json", "README.md", "Wan2.2_VAE.pth", "models_t5_umt5-xxl-enc-bf16.pth",
    "diffusion_pytorch_model*.safetensors", "diffusion_pytorch_model.safetensors.index.json", "google/umt5-xxl/*"])
readme = open(os.path.join(dest, "README.md"), encoding="utf-8").read()
lic = None
if readme.startswith("---"):
    for line in readme.split("\n---", 1)[0].splitlines():
        if line.startswith("license:"):
            lic = line.split(":", 1)[1].strip()
json.dump({"schema": "hvs.wan22.install-manifest.v1", "hfRepo": repo, "hfRevision": rev, "license": lic,
           "installedBy": "scripts/hvs/install-wan22.sh"}, open(os.path.join(dest, "hvs-install-manifest.json"), "w"), indent=2)
print("weights ready at", dest, "license", lic)
PY
fi
echo "done."
