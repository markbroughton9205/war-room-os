/**
 * Wave 5 install manifests + literal command plans.
 * NEVER EXECUTE. No git clone, pip, huggingface-cli, or wget from this module.
 */
export const INSTALL_COMMANDS_MUST_NOT_RUN = true as const

export const PIPER_INSTALL_MANIFEST = {
  engineId: 'piper' as const,
  neverExecute: true,
  officialRepo: 'https://github.com/OHF-Voice/piper1-gpl',
  release: 'v1.8.0',
  license: 'GPL-3.0',
  strategy: 'Dedicated venv subprocess. Do not link GPLv3 into Next.js.',
  python: '3.11+',
  recommendedVoice: {
    id: 'en_US-lessac-medium',
    family: 'piper-voice',
    language: 'en_US',
    source: 'https://huggingface.co/rhasspy/piper-voices',
    onnx: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    config: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    license: 'MIT',
  },
  hashPlan: 'sha256sum the ONNX after download; store hex in catalog.json.hash. Refuse mismatch.',
  expectedStorage: '~80–250 MiB (venv + one medium English voice)',
  runtimeDir: 'application-data/media-command/models/voice/piper/',
  adapter: { id: 'PiperAdapter', capability: 'VOICE_SYNTHESIS', health: 'subprocess --help + one smoke WAV probe' },
  uninstall: [
    'Stop any piper subprocess.',
    'Remove models/voice/piper/ and the voice ONNX directory.',
    'Set catalog engines.piper.installState = NOT_INSTALLED.',
    'Do not touch .hvsproj or originals.',
  ],
} as const

export const PIPER_INSTALL_COMMAND_PLAN = {
  neverExecute: true,
  shell: 'bash',
  commands: [
    'ROOT="$HVS_APP_DATA/media-command/models/voice"',
    'mkdir -p "$ROOT/piper" "$ROOT/en_US-lessac-medium"',
    'python3 -m venv "$ROOT/piper/venv"',
    'source "$ROOT/piper/venv/bin/activate"',
    'pip install --upgrade pip',
    'pip install "piper-tts @ git+https://github.com/OHF-Voice/piper1-gpl.git@v1.8.0"',
    'curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" -o "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx"',
    'curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" -o "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx.json"',
    'sha256sum "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx" | tee "$ROOT/en_US-lessac-medium/SHA256"',
    'printf \'Higher Vision Studios\' | piper --model "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx" --output_file "$ROOT/piper/smoke.wav"',
    'ffprobe -hide_banner "$ROOT/piper/smoke.wav"',
    'rm -f "$ROOT/piper/smoke.wav"',
    '# Then write catalog.json INSTALLED with id/family/version/license/hash/bytes/backend/path/installedAt/status',
  ],
} as const

export const COMFYUI_FLUX_INSTALL_MANIFEST = {
  engineId: 'comfyui-flux' as const,
  neverExecute: true,
  comfyui: {
    repo: 'https://github.com/Comfy-Org/ComfyUI',
    release: 'v0.37.0',
    license: 'GPL-3.0',
    python: '3.11 or 3.12 (3.10 approaching EOL)',
    venv: 'application-data/media-command/models/image/comfyui-venv',
    checkout: 'application-data/media-command/models/image/ComfyUI',
    startup: 'python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch',
    health: 'GET http://127.0.0.1:8188/system_stats loopback only',
  },
  flux: {
    repo: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell',
    license: 'Apache-2.0',
    files: [
      { name: 'flux1-schnell.safetensors', approx: '23.8 GiB', sha256: '9403429e0052277ac2a87ad800adece5481eecefd9ed334e1f348723621d2a0a' },
      { name: 'ae.safetensors', approx: '335 MiB', sha256: 'verify-at-download' },
    ],
    encoders: 'clip_l.safetensors + t5xxl_fp8_e4m3fn.safetensors (or fp16) from Comfy-Org flux text encoder pack',
    notInPlan: ['FLUX.1-dev', 'FLUX.1-pro'],
  },
  storageEstimate: '20–35 GiB',
  vram: '16 GiB class intended; --cpu exists and is impractical',
  loopbackOnly: true,
  adapter: { id: 'ComfyUiFluxAdapter', capability: 'IMAGE_GENERATION', projectTruth: 'GenerateImageRequest + AssetRecord. Never Comfy workflow JSON in .hvsproj.' },
  rollback: [
    'Stop :8188.',
    'Delete models/image/ComfyUI, comfyui-venv, and FLUX weights.',
    'catalog engines.comfyui-flux.installState = NOT_INSTALLED.',
    'Do not touch originals or .hvsproj.',
  ],
} as const

export const COMFYUI_FLUX_INSTALL_COMMAND_PLAN = {
  neverExecute: true,
  shell: 'bash',
  commands: [
    'IMG="$HVS_APP_DATA/media-command/models/image"',
    'mkdir -p "$IMG"',
    'git clone --branch v0.37.0 --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$IMG/ComfyUI"',
    'python3.11 -m venv "$IMG/comfyui-venv"',
    'source "$IMG/comfyui-venv/bin/activate"',
    'pip install --upgrade pip',
    'pip install -r "$IMG/ComfyUI/requirements.txt"',
    '# DO NOT run huggingface-cli download until Commander authorizes FLUX weights',
    '# huggingface-cli download black-forest-labs/FLUX.1-schnell flux1-schnell.safetensors ae.safetensors --local-dir "$IMG/FLUX.1-schnell"',
    '# sha256sum "$IMG/FLUX.1-schnell/flux1-schnell.safetensors"',
    '# python "$IMG/ComfyUI/main.py" --listen 127.0.0.1 --port 8188 --disable-auto-launch',
    '# curl -sS http://127.0.0.1:8188/system_stats',
  ],
} as const
