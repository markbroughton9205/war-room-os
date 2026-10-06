/**
 * Local-engine candidate audit + remote ranking.
 * Technical fit only. Does not install, download weights, or execute.
 */
export type LocalEngineCandidate = {
  role: 'IMAGE GENERATION' | 'VOICE SYNTHESIS' | 'SFX / MUSIC'
  project: string
  official: string
  license: string
  modelLicense: string
  diskEstimate: string
  ramVramEstimate: string
  linux: boolean
  offline: boolean
  adapterComplexity: 'low' | 'medium' | 'high'
  rtx5060Ti16GiBLikelySufficient: boolean
  cpuFallback: boolean
  securityPrivacy: string
  notes: string
}

export const LOCAL_ENGINE_CANDIDATES: LocalEngineCandidate[] = [
  {
    role: 'IMAGE GENERATION',
    project: 'ComfyUI + FLUX.1 [schnell]',
    official: 'https://github.com/comfyanonymous/ComfyUI and https://huggingface.co/black-forest-labs/FLUX.1-schnell',
    license: 'ComfyUI GPL-3.0; FLUX.1 schnell Apache-2.0',
    modelLicense: 'Apache-2.0 weights. No extra paid license for schnell. Dev/pro Flux variants are not Apache and are not recommended here.',
    diskEstimate: '20–35 GiB (ComfyUI + schnell ~12–24 GiB weights + text encoders)',
    ramVramEstimate: '16 GiB VRAM is the intended class for 1024² schnell; system RAM 32 GiB comfortable',
    linux: true,
    offline: true,
    adapterComplexity: 'medium',
    rtx5060Ti16GiBLikelySufficient: true,
    cpuFallback: true,
    securityPrivacy: 'Fully local after weights are on disk. No prompt upload. Weights must be fetched only after Commander install authorization.',
    notes: 'Best local image option on this GPU class. CPU fallback exists but is impractically slow.',
  },
  {
    role: 'IMAGE GENERATION',
    project: 'ComfyUI + Stable Diffusion XL',
    official: 'https://github.com/Stability-AI/generative-models',
    license: 'SDXL CreativeML Open RAIL++-M',
    modelLicense: 'OpenRAIL++ use restrictions (not OSI). Check commercial clauses before HVS product use.',
    diskEstimate: '12–20 GiB',
    ramVramEstimate: '8–12 GiB VRAM typical at 1024²; 16 GiB is comfortable',
    linux: true,
    offline: true,
    adapterComplexity: 'medium',
    rtx5060Ti16GiBLikelySufficient: true,
    cpuFallback: true,
    securityPrivacy: 'Local. OpenRAIL++ is not a blank commercial license.',
    notes: 'Mature pipeline. Slightly more license friction than Flux schnell.',
  },
  {
    role: 'VOICE SYNTHESIS',
    project: 'Piper TTS',
    official: 'https://github.com/OHF-Voice/piper1-gpl (maintained; rhasspy/piper archived)',
    license: 'GPL-3.0 (maintained engine). Archived rhasspy/piper was MIT.',
    modelLicense: 'Per-voice. Prefer MIT/CC-BY voices. Do not assume every Piper voice is commercial-clear.',
    diskEstimate: '50–250 MiB per voice; engine < 50 MiB',
    ramVramEstimate: 'CPU-only, ~200–500 MiB RAM. No VRAM required.',
    linux: true,
    offline: true,
    adapterComplexity: 'low',
    rtx5060Ti16GiBLikelySufficient: true,
    cpuFallback: true,
    securityPrivacy: 'Local ONNX. Text never leaves the machine.',
    notes: 'Best local voice option. Fast on CPU. Not a clone/voice-conversion system.',
  },
  {
    role: 'VOICE SYNTHESIS',
    project: 'Kokoro / similar small ONNX TTS',
    official: 'https://github.com/hexgrad/kokoro',
    license: 'Apache-2.0 (verify current repo license before install)',
    modelLicense: 'Apache-2.0 claimed for Kokoro-82M; re-verify at install time.',
    diskEstimate: '0.5–2 GiB',
    ramVramEstimate: 'CPU or light GPU. 16 GiB VRAM far more than needed.',
    linux: true,
    offline: true,
    adapterComplexity: 'low',
    rtx5060Ti16GiBLikelySufficient: true,
    cpuFallback: true,
    securityPrivacy: 'Local. Confirm voice identity/cloning policy — HVS must not ship identity cloning.',
    notes: 'Higher quality than Piper in some samples. Still a local candidate, not installed.',
  },
  {
    role: 'SFX / MUSIC',
    project: 'AudioCraft MusicGen (facebook/audiocraft)',
    official: 'https://github.com/facebookresearch/audiocraft',
    license: 'MIT code; model weights mixed (some NC)',
    modelLicense: 'MusicGen small/medium often CC-BY-NC. Non-commercial weights cannot be a HVS production backend without a separate license decision.',
    diskEstimate: '2–8 GiB depending on size',
    ramVramEstimate: 'medium ~8–16 GiB VRAM; 16 GiB likely OK for medium, not large',
    linux: true,
    offline: true,
    adapterComplexity: 'high',
    rtx5060Ti16GiBLikelySufficient: true,
    cpuFallback: true,
    securityPrivacy: 'Local after download. NC weights are a product-policy issue, not a GPU issue.',
    notes: 'Practical SFX/music research path. License may block shipping. CPU fallback is slow.',
  },
]

export type RankedBackend = {
  category: 'BEST LOCAL IMAGE OPTION' | 'BEST LOCAL VOICE OPTION' | 'BEST REMOTE IMAGE OPTION' | 'BEST REMOTE VIDEO OPTION' | 'BEST REMOTE VOICE/AUDIO OPTION'
  pick: string
  why: string
  commanderMustAuthorize: string[]
  whatGetsInstalled: string
  approxStorage: string
  spendOccurs: boolean
}

export const GENERATION_BACKEND_RANKING: RankedBackend[] = [
  {
    category: 'BEST LOCAL IMAGE OPTION',
    pick: 'ComfyUI + FLUX.1 [schnell] (Apache-2.0 weights)',
    why: '16 GiB VRAM class, Linux, offline, Apache weights, established node graph we can adapt without faking generation.',
    commanderMustAuthorize: ['Install ComfyUI', 'Download schnell + text-encoder weights', 'Disk ~25 GiB', 'GPU runtime use'],
    whatGetsInstalled: 'Python env + ComfyUI + FLUX schnell weights. Not installed this wave.',
    approxStorage: '~25 GiB',
    spendOccurs: false,
  },
  {
    category: 'BEST LOCAL VOICE OPTION',
    pick: 'Piper TTS',
    why: 'MIT engine, CPU-native, tiny disk, no VRAM, low adapter complexity, offline.',
    commanderMustAuthorize: ['Install Piper binary or Python wheel', 'Download one MIT/CC voice model'],
    whatGetsInstalled: 'Piper + one voice. Not installed this wave.',
    approxStorage: '~200 MiB',
    spendOccurs: false,
  },
  {
    category: 'BEST REMOTE IMAGE OPTION',
    pick: 'OpenAI Images adapter (openai-image)',
    why: 'Existing HVS IMAGE_GENERATION contract, request normalization, cost/upload gates already exist. Gemini Imagen is equivalent technically if Gemini is preferred later.',
    commanderMustAuthorize: ['Spend authorization', 'External upload of prompts (and any reference images)', 'OPENAI_API_KEY already being a key ≠ spend'],
    whatGetsInstalled: 'Nothing local. Adapter already present, submit remains disabled.',
    approxStorage: '0 (remote)',
    spendOccurs: true,
  },
  {
    category: 'BEST REMOTE VIDEO OPTION',
    pick: 'Gemini Veo adapter (gemini-veo)',
    why: 'Native video generation capability in the registry. Replicate is a fallback when a specific model is required.',
    commanderMustAuthorize: ['Spend authorization', 'External upload', 'GEMINI_API_KEY configured'],
    whatGetsInstalled: 'Nothing local.',
    approxStorage: '0 (remote)',
    spendOccurs: true,
  },
  {
    category: 'BEST REMOTE VOICE/AUDIO OPTION',
    pick: 'ElevenLabs TTS adapter (elevenlabs-tts)',
    why: 'Voice/SFX/music already registered. Spend + upload gates exist. Local Piper remains preferable when privacy matters.',
    commanderMustAuthorize: ['Spend authorization', 'External upload of script text', 'ELEVENLABS_API_KEY'],
    whatGetsInstalled: 'Nothing local.',
    approxStorage: '0 (remote)',
    spendOccurs: true,
  },
]

/**
 * HVS-GENERATIVE-VIDEO-01 (additive): first native local VIDEO engine decision.
 * Implementation lives in lib/media-command/generative/ (provider layer, worker supervision, ingest).
 * Facts read from the official HF repo listing + github.com/Wan-Video/Wan2.2 on 2026-10-02.
 */
export const LOCAL_VIDEO_ENGINE_DECISION = {
  role: 'VIDEO GENERATION',
  project: 'Wan 2.2 TI2V-5B (Wan-AI/Wan2.2-TI2V-5B)',
  official: 'https://github.com/Wan-Video/Wan2.2 and https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B',
  license: 'Code Apache-2.0 (LICENSE.txt); weights apache-2.0 (HF model card). Re-read from installed metadata at runtime.',
  diskEstimate: '34,203,123,497 bytes (31.85 GiB) per HF API file listing; plus ~6–10 GiB Python/torch runtime (estimate)',
  ramVramEstimate: 'Upstream README: 5B single-GPU 720p with --offload_model True --convert_model_dtype --t5_cpu on >=24 GB VRAM. 16 GB: UNTESTED.',
  linux: true,
  offline: true,
  rtx5060Ti16GiBLikelySufficient: false,
  rtx5060Ti16GiBNote: 'Below the documented 24 GB class. Admission policy requires ~14 GB free; not claimed compatible until a live run proves it.',
  autoDownload: false,
  implementation: 'lib/media-command/generative/',
} as const
