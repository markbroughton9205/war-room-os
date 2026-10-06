# HVS ComfyUI + FLUX.1 [schnell] install command plan (Wave 5 — REPORT ONLY)

**DO NOT RUN THESE COMMANDS.** Wave 5 is not ComfyUI or FLUX download approval.

Canonical machine-readable copy: `lib/media-command/install-manifests.ts`.

## Manifest

| Item | Value |
|---|---|
| ComfyUI | https://github.com/Comfy-Org/ComfyUI **v0.37.0** GPL-3.0 |
| Python | 3.11 or 3.12, dedicated venv |
| FLUX | https://huggingface.co/black-forest-labs/FLUX.1-schnell Apache-2.0 |
| Weights | `flux1-schnell.safetensors` (~23.8 GiB) + `ae.safetensors` (~335 MiB) |
| Schnell sha256 | `9403429e0052277ac2a87ad800adece5481eecefd9ed334e1f348723621d2a0a` |
| Not in plan | FLUX.1-dev, FLUX.1-pro |
| Bind | `127.0.0.1:8188` loopback only |
| Project truth | GenerateImageRequest + AssetRecord — never Comfy workflow JSON in `.hvsproj` |

## Commands (never execute this wave)

Downloads stay commented until a later Commander install authorization.

```bash
IMG="$HVS_APP_DATA/media-command/models/image"
mkdir -p "$IMG"
git clone --branch v0.37.0 --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$IMG/ComfyUI"
python3.11 -m venv "$IMG/comfyui-venv"
source "$IMG/comfyui-venv/bin/activate"
pip install --upgrade pip
pip install -r "$IMG/ComfyUI/requirements.txt"
# huggingface-cli download black-forest-labs/FLUX.1-schnell flux1-schnell.safetensors ae.safetensors --local-dir "$IMG/FLUX.1-schnell"
# sha256sum "$IMG/FLUX.1-schnell/flux1-schnell.safetensors"
# python "$IMG/ComfyUI/main.py" --listen 127.0.0.1 --port 8188 --disable-auto-launch
# curl -sS http://127.0.0.1:8188/system_stats
```

## Authority required later

Both:

- `HVS_MODEL_INSTALL_AUTHORIZATION=true`
- `HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED=true`

Wave 5 leaves both **false**.
