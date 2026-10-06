# HVS ComfyUI + FLUX.1 [schnell] install plan (Wave 4 — plan only)

**Do not install ComfyUI. Do not download FLUX weights. Generate does not install.**

Canonical machine-readable copy: `lib/media-command/local-generation-plans.ts` (`COMFYUI_FLUX_INSTALL_PLAN`).

## Official source

| Item | Value |
|---|---|
| ComfyUI | https://github.com/Comfy-Org/ComfyUI — GPL-3.0 |
| FLUX.1 [schnell] | https://huggingface.co/black-forest-labs/FLUX.1-schnell — Apache-2.0 |
| Not in this plan | FLUX.1-dev (non-commercial), FLUX.1-pro (no public weights) |

## Hardware / storage

- Linux. CUDA optional. `--cpu` exists and is impractical for Flux.
- Intended class: 16 GiB VRAM (RTX 5060 Ti class). Do not repair NVIDIA this wave.
- System RAM 32 GiB comfortable.
- Expected weights: `flux1-schnell.safetensors` (~23 GiB FP16) + CLIP-L / T5-XXL + VAE. Total **20–35 GiB**.
- Dedicated venv under `media-command/models/image/comfyui-venv`. Never the War Room app venv.

## API / project truth

- After a later-wave authorized daemon start: loopback `127.0.0.1:8188 /prompt` only. No public bind. No paid GPU rental.
- ComfyUI workflow JSON is an **adapter implementation detail**.
- `.hvsproj` stores `GenerateImageRequest` + `AssetRecord`, **never** vendor workflow JSON as source of truth.
- Adapter maps HVS prompt/size/seed/steps onto an internal template, then maps image output back to HVS result.
- Probe PNG/JPEG, checksum, dimensions. Reject empty/HTML. No timeline auto-insert.

## HVS adapter

`ComfyUiFluxAdapter` capability `IMAGE_GENERATION`.

Flow: `GenerateImageRequest` → Router (only if `INSTALLED`) → adapter template workflow → `ProviderJob` → image → probe → `AssetRecord` + provenance → Media Library.

## Storage

`application-data/media-command/models/image/` — never git, never `.hvsproj`. Catalog records id, version, license Apache-2.0, hash, size, backend, installedAt.

## Install authority

Generate never installs. Commander install is a separate later-wave action. Wave 4 records `NOT_INSTALLED` / `INSTALL_APPROVAL_REQUIRED` only.
