# HVS_GENERATION_BACKEND_DECISION_REPORT

Wave 3 generation-readiness artifact. Technical fit only. **No engine was installed. No weights were downloaded. No paid HTTP generation ran.**

Hardware assumed: Linux, NVIDIA RTX 5060 Ti 16 GiB. Commander must still authorize any later install or spend.

## Ranking (technical fit, not execution)

### BEST LOCAL IMAGE OPTION
**ComfyUI + FLUX.1 [schnell] (Apache-2.0)**

- Commander must authorize: ComfyUI install, schnell + encoder weights, ~25 GiB disk, GPU use.
- What gets installed: Python env + ComfyUI + weights. **Not installed.**
- Approx storage: ~25 GiB.
- Spend occurs: no (after one-time download from Hugging Face; HF gating/accounts are not HVS spend).

SDXL via ComfyUI is the runner-up (OpenRAIL++ friction).

### BEST LOCAL VOICE OPTION
**Piper TTS (MIT engine)**

- Commander must authorize: Piper install + one MIT/CC voice.
- What gets installed: Piper + voice. **Not installed.**
- Approx storage: ~200 MiB.
- Spend occurs: no.

### BEST REMOTE IMAGE OPTION
**OpenAI Images (`openai-image` adapter)**

- Commander must authorize: spend + external upload. API key ≠ spend.
- What gets installed: nothing. Adapter already exists and is disabled unless configured/authorized.
- Approx storage: 0.
- Spend occurs: yes.

### BEST REMOTE VIDEO OPTION
**Gemini Veo (`gemini-veo` adapter)**

- Commander must authorize: spend + external upload + Gemini key.
- What gets installed: nothing.
- Approx storage: 0.
- Spend occurs: yes.

Replicate video is the fallback when a named community model is required.

### BEST REMOTE VOICE/AUDIO OPTION
**ElevenLabs TTS (`elevenlabs-tts` adapter)**

- Commander must authorize: spend + script upload.
- What gets installed: nothing.
- Approx storage: 0.
- Spend occurs: yes.

## Local candidate audit (no install)

| Role | Project | License | Disk | RAM/VRAM | Linux | Offline | Adapter | 5060 Ti 16 GiB | CPU fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Image | ComfyUI + FLUX schnell | GPL-3 + Apache-2.0 | 20–35 GiB | 16 GiB VRAM class | yes | yes | medium | likely yes | yes, slow |
| Image | ComfyUI + SDXL | OpenRAIL++ | 12–20 GiB | 8–12 GiB VRAM | yes | yes | medium | likely yes | yes, slow |
| Voice | Piper | MIT + per-voice | 50–250 MiB | CPU hundreds of MiB | yes | yes | low | yes | native CPU |
| Voice | Kokoro ONNX | Apache-2.0 (re-verify) | 0.5–2 GiB | CPU/light GPU | yes | yes | low | yes | yes |
| SFX/Music | AudioCraft MusicGen | MIT code, often NC weights | 2–8 GiB | 8–16 GiB VRAM | yes | yes | high | medium likely | yes, slow |

Security/privacy: local options keep prompts and media on-box after weights exist. Remote options upload prompts and any reference assets. MusicGen NC weights are a product-policy hold, not a GPU hold.

## Remote provider readiness (no HTTP)

Verified in-repo for OpenAI image, Gemini image/video, Replicate, ElevenLabs:

- Adapter contract (`HvsProviderAdapter`)
- Request normalization (`Generate*Request` + prompt hash)
- Authority gate (spend + external upload)
- Cost estimate hook (`AdapterEstimate`)
- External upload disclosure (`uploadSummary`)
- Response normalization path (`normalizeProviderArtifact` — requires a real file; class existence is not an artifact)

Submit remains disabled. Unconfigured stubs are not routed.

## Decision

Do **not** execute any choice in Wave 3. Phase 2 stays **NOT READY** until Commander authorizes a local install **or** spend, and a real generated AssetRecord exists.
