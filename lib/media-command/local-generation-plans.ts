/**
 * Exact HVS-native local generation install plans.
 * Wave 4: plans only. No pip install, no git clone, no weight download.
 */
export const PIPER_INSTALL_PLAN = {
  engineId: 'piper',
  capability: 'VOICE_SYNTHESIS' as const,
  adapter: 'PiperAdapter',
  officialRepository: {
    maintained: 'https://github.com/OHF-Voice/piper1-gpl',
    maintainedLicense: 'GPL-3.0',
    maintainedRelease: 'v1.8.0 (2026-09 as of Wave 4 audit)',
    archivedPredecessor: 'https://github.com/rhasspy/piper (archived, MIT). Development moved to piper1-gpl.',
  },
  linuxSupport: true,
  cpuRequirements: 'x86_64 or aarch64; ONNX Runtime CPU. No GPU required. ~200–500 MiB RAM while synthesizing.',
  diskRequirements: 'Engine wheel < 50 MiB. One English voice typically 15–60 MiB ONNX + JSON. Plan 250 MiB headroom.',
  runtime: {
    cli: 'piper --model <voice.onnx> --output_file <out.wav>',
    python: 'from piper import PiperVoice; voice.synthesize(text, wav_file)',
    http: 'optional piper HTTP server — HVS must not require it; prefer subprocess',
    outputWav: 'Typically 16-bit PCM WAV, mono, 16000 or 22050 Hz depending on voice. Always probe before AssetRecord.',
    languages: 'espeak-ng languages via voice packs (en, de, es, fr, and others). Thai extra in v1.8.0. HVS first voice should be en_US MIT/CC.',
    voiceSelection: 'HVS request.voiceId maps to a catalogued model filename under models/voice/. Never hard-code a cloned/identity voice.',
  },
  voiceLicensing: 'Per-voice. Prefer rhasspy/piper-voices MIT/CC-BY. Record license + hash + size in catalog.json. Do not copy proprietary license text into the repo.',
  modelStorage: 'media-command/models/voice/{model-id}/{version}/  (application-data, never git, never .hvsproj)',
  security: [
    'Subprocess only. Do not embed GPL engine as a linked library inside the Next.js process.',
    'No network after install. Voices stay on disk.',
    'Sanitize text length. Do not shell-interpolate the prompt.',
    'Output path must be under media-command tmp/originals, then probe + AssetRecord.',
  ],
  hvsFlow: [
    'GenerateVoiceRequest (vendor-neutral)',
    'Provider Router (only if installState === INSTALLED)',
    'PiperAdapter',
    'ProviderJob QUEUED → RUNNING → COMPLETED',
    'WAV on disk',
    'ffprobe',
    'AssetRecord + provenance (model id, version, license, hash)',
    'Media Library',
    'NO timeline auto-insert',
  ],
  installStepsWhenAuthorizedLater: [
    'Commander sets a later-wave install flag. Wave 4 flags stay false.',
    'Create Python venv under media-command/models/voice/venv (not repo).',
    'pip install piper-tts== matching piper1-gpl v1.8.x.',
    'Download one approved English voice ONNX+JSON into models/voice/.',
    'sha256 the ONNX, write catalog.json INSTALLED.',
    'Smoke: synthesize "Higher Vision Studios" → probe WAV → delete smoke file.',
    'PiperAdapter.health() becomes HEALTHY only after that smoke file existed.',
  ],
  notAuthorizedNow: true,
} as const

export const COMFYUI_FLUX_INSTALL_PLAN = {
  engineId: 'comfyui-flux',
  capability: 'IMAGE_GENERATION' as const,
  adapter: 'ComfyUiFluxAdapter',
  officialRepository: {
    comfyui: 'https://github.com/Comfy-Org/ComfyUI (GPL-3.0). Historical URL comfyanonymous/ComfyUI.',
    fluxSchnell: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell',
    fluxLicense: 'Apache-2.0 (schnell only). FLUX.1-dev is NOT Apache and is not part of this plan. FLUX.1-pro has no public weights.',
  },
  linuxSupport: true,
  cuda: 'Optional. ComfyUI --cpu works and is impractically slow for Flux. Intended class: RTX 5060 Ti 16 GiB. Do not repair NVIDIA this wave.',
  ramVram: '16 GiB VRAM intended for 1024² schnell; FP8 / offload can fit ~12–15 GiB peak with T5. System RAM 32 GiB comfortable.',
  expectedWeights: [
    'flux1-schnell.safetensors (~23 GiB FP16 / smaller quantized variants exist)',
    'clip_l / t5xxl text encoders (several GiB)',
    'ae.safetensors VAE',
  ],
  totalStorage: '20–35 GiB typical for ComfyUI + schnell + encoders.',
  pythonEnv: 'Dedicated venv under media-command/models/image/comfyui-venv. Never the War Room app venv. Never pip install into the Next.js process.',
  api: {
    method: 'Local HTTP 127.0.0.1:8188 /prompt after Commander-authorized daemon start. Loopback only. No public bind.',
    projectTruth: 'ComfyUI workflow JSON is an adapter implementation detail. .hvsproj stores GenerateImageRequest + AssetRecord, never vendor workflow JSON as SoT.',
    normalize: 'Adapter maps HVS request (prompt, size, seed, steps) onto an internal template workflow, then maps images[] output back to HVS result.',
  },
  outputValidation: 'Probe image (PNG/JPEG), dimensions, bytes, checksum. Reject empty/HTML. Then AssetRecord + provenance. No timeline auto-insert.',
  cpuFallback: true,
  security: [
    'Loopback-only ComfyUI. No Cloudflare tunnel, no paid GPU rental.',
    'Do not upload prompts off-box.',
    'Weights stay under models/image/. gitignore + catalog hash.',
    'GPL ComfyUI remains a sibling process, not a bundled Next.js dependency.',
  ],
  hvsFlow: [
    'GenerateImageRequest',
    'Provider Router (only if INSTALLED)',
    'ComfyUiFluxAdapter internal workflow template',
    'ProviderJob',
    'image file',
    'probe',
    'AssetRecord + provenance',
    'Media Library',
  ],
  installStepsWhenAuthorizedLater: [
    'Commander authorizes install + disk + GPU use in a later wave.',
    'Clone ComfyUI into application-data (not this git repo).',
    'Create venv, pip install ComfyUI requirements.',
    'Download FLUX.1-schnell Apache weights + required encoders into models/image/.',
    'Record license Apache-2.0, sha256, size, installedAt.',
    'Start loopback daemon, run one HVS-normalized 512² smoke prompt, then stop.',
    'Adapter health HEALTHY only after smoke image existed.',
  ],
  notAuthorizedNow: true,
} as const

export const LOCAL_MODEL_STORAGE_POLICY = {
  root: 'application-data/media-command/models/',
  layout: {
    image: 'models/image/',
    voice: 'models/voice/',
    audio: 'models/audio/',
    catalog: 'models/catalog.json',
  },
  never: [
    'Do not put weights in git.',
    'Do not put weights inside .hvsproj.',
    'Do not copy proprietary license text into the repository.',
  ],
  catalogFields: ['id', 'family', 'version', 'license', 'hash', 'bytes', 'backend', 'path', 'installedAt', 'status'],
} as const
