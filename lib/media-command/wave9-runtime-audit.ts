/**
 * Wave 9 local-runtime audit. Read-only. Never downloads models.
 * Never prints secrets. Never claims a missing engine is installed.
 */
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { resolveFfmpegTools } from './ffmpeg'

export type RuntimeUsable = 'YES' | 'NO'

export type Wave9EngineAudit = {
  backend: string
  installed: boolean
  modelPresent: boolean
  license: string
  diskBytes: number | null
  ramNote: string
  vramNote: string
  cpuFallback: boolean
  expectedSpeed: string
  wordTimestamps?: boolean
  languageSupport?: string
  commercialUse: string
  usableNow: RuntimeUsable
  notes: string[]
}

function which(bin: string): string | null {
  const run = spawnSync('which', [bin], { encoding: 'utf8', timeout: 4000 })
  const p = (run.stdout ?? '').trim().split('\n')[0]?.trim() ?? ''
  return run.status === 0 && p && existsSync(p) ? p : null
}

function pythonModule(mod: string): boolean {
  const run = spawnSync('python3', ['-c', `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(mod)}) else 1)`], {
    encoding: 'utf8',
    timeout: 8000,
  })
  return run.status === 0
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = (current: string) => {
    let entries: Dirent<string>[]
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) total += statSync(full).size
      } catch { /* skip */ }
    }
  }
  walk(dir)
  return total
}

function memNotes(): { ram: string; vram: string } {
  const total = os.totalmem()
  const free = os.freemem()
  const smi = spawnSync('nvidia-smi', ['--query-gpu=memory.total,memory.free', '--format=csv,noheader,nounits'], {
    encoding: 'utf8',
    timeout: 4000,
  })
  const vram = smi.status === 0 && smi.stdout.trim()
    ? `nvidia-smi ${smi.stdout.trim()}`
    : 'no GPU driver / nvidia-smi unavailable'
  return {
    ram: `${Math.round(free / 1024 / 1024)} MiB free of ${Math.round(total / 1024 / 1024)} MiB`,
    vram,
  }
}

export const WAVE9_ASR_RECOMMENDATION = {
  engine: 'whisper.cpp',
  runtimeLicense: 'MIT',
  preferredModel: 'ggml-tiny.en.bin',
  modelLicense: 'MIT (OpenAI Whisper weights via ggml conversion)',
  commercialUse: 'YES — MIT runtime + Whisper MIT weights',
  bytes: 77_675_008,
  hashSource: 'https://huggingface.co/ggerganov/whisper.cpp / ggml-tiny.en.bin SHA256 published by ggml-org',
  wordTimestamps: true,
  cpuFallback: true,
  gpuOptional: true,
  expectedSpeed: 'faster than realtime on CPU for tiny.en; multilingual base.en larger',
  overOneGiB: false,
  downloadAuthorized: false,
  status: 'INSTALL_APPROVAL_REQUIRED',
  reason: 'No ASR backend is installed. tiny.en is under 1 GiB but Wave 9 does not download models without a later Commander install gate.',
} as const

export const WAVE9_OBJECT_RECOMMENDATION = {
  runtime: 'onnxruntime (MIT)',
  weights: 'YOLOX-nano ONNX (Apache-2.0)',
  avoid: 'Ultralytics YOLO (AGPL-3.0) — GX-08 remains BLOCKED',
  commercialUse: 'YES if Apache-2 YOLOX + MIT ORT',
  bytesApprox: 9_000_000,
  overOneGiB: false,
  downloadAuthorized: false,
  status: 'INSTALL_APPROVAL_REQUIRED',
} as const

export const WAVE9_EMBEDDING_RECOMMENDATION = {
  model: 'openclip ViT-B-32 (OpenCLIP MIT code; LAION weights)',
  commercialUse: 'review LAION/OpenCLIP weight terms before install',
  overOneGiB: true,
  status: 'INSTALL_APPROVAL_REQUIRED',
  reason: 'Typical CLIP/OpenCLIP checkpoints exceed 1 GiB when including tokenizer + vision weights. No download this wave.',
} as const

export async function auditWave9Runtimes(): Promise<{
  mem: { ram: string; vram: string }
  modelsDirBytes: number
  ffmpeg: { bundled: boolean; path: string | null }
  asr: Wave9EngineAudit[]
  objects: Wave9EngineAudit[]
  action: Wave9EngineAudit[]
  embeddings: Wave9EngineAudit[]
  biometric: Wave9EngineAudit[]
}> {
  const mem = memNotes()
  const tools = await resolveFfmpegTools()
  const modelsDir = mediaCommandDataHierarchy().models
  const modelsDirBytes = dirBytes(modelsDir)
  const bundledWhisper = path.join(mediaCommandDataHierarchy().tools, 'whisper-cli')
  const whisperBin = (existsSync(bundledWhisper) ? bundledWhisper : null) ?? which('whisper-cli') ?? which('whisper') ?? which('whisper.cpp')
  const tinyEn = path.join(modelsDir, 'whisper', 'ggml-tiny.en.bin')
  const whisperReady = Boolean(whisperBin && existsSync(tinyEn))
  const ffmpegPath = tools.ffmpeg ?? which('ffmpeg')
  const asr: Wave9EngineAudit[] = [
    {
      backend: 'whisper.cpp',
      installed: Boolean(whisperBin),
      modelPresent: existsSync(tinyEn),
      license: 'MIT',
      diskBytes: whisperBin && existsSync(whisperBin) ? statSync(whisperBin).size : 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'tiny.en realtime-class on CPU when installed',
      wordTimestamps: whisperReady,
      languageSupport: 'en via tiny.en; multilingual via tiny/base/small',
      commercialUse: 'YES (MIT)',
      usableNow: whisperReady ? 'YES' : 'NO',
      notes: whisperReady
        ? ['Slice 4 local whisper.cpp + ggml-tiny.en.bin. CPU only. No remote transcription.']
        : ['Binary not on PATH. No ggml weights in HVS models dir. No download this wave.'],
    },
    {
      backend: 'faster-whisper',
      installed: pythonModule('faster_whisper'),
      modelPresent: false,
      license: 'MIT',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'CTranslate2; faster than vanilla Whisper when installed',
      wordTimestamps: true,
      languageSupport: 'Whisper languages',
      commercialUse: 'YES (MIT)',
      usableNow: 'NO',
      notes: ['Python package not installed.'],
    },
    {
      backend: 'openai-whisper-python',
      installed: pythonModule('whisper'),
      modelPresent: false,
      license: 'MIT',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'slow on CPU; not preferred',
      wordTimestamps: true,
      languageSupport: 'Whisper languages',
      commercialUse: 'YES (MIT)',
      usableNow: 'NO',
      notes: ['openai-whisper Python package not installed.'],
    },
  ]
  const objects: Wave9EngineAudit[] = [
    {
      backend: 'opencv-python',
      installed: pythonModule('cv2'),
      modelPresent: false,
      license: 'Apache-2.0',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'Haar/HOG only if cascade files present — not a modern detector',
      commercialUse: 'YES (Apache-2.0 runtime)',
      usableNow: 'NO',
      notes: ['cv2 not installed. No cascade/YOLO weights.'],
    },
    {
      backend: 'onnxruntime',
      installed: pythonModule('onnxruntime'),
      modelPresent: false,
      license: 'MIT',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'YOLOX-nano class if weights present',
      commercialUse: 'YES (MIT runtime; weights license separate)',
      usableNow: 'NO',
      notes: ['ONNX Runtime not installed. No YOLOX-nano weights.'],
    },
    {
      backend: 'pytorch+torchvision',
      installed: pythonModule('torch') && pythonModule('torchvision'),
      modelPresent: false,
      license: 'BSD-style (PyTorch)',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'heavy; not required this wave',
      commercialUse: 'YES (BSD-style)',
      usableNow: 'NO',
      notes: ['torch/torchvision not installed.'],
    },
    {
      backend: 'ultralytics',
      installed: pythonModule('ultralytics'),
      modelPresent: false,
      license: 'AGPL-3.0',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'n/a — blocked',
      commercialUse: 'NO without AGPL compliance / paid license — GX-08 BLOCKED',
      usableNow: 'NO',
      notes: ['Do not install. AGPL detector remains BLOCKED.'],
    },
  ]
  const action: Wave9EngineAudit[] = [{
    backend: 'trained-action-recognition',
    installed: pythonModule('mmaction') || pythonModule('pytorchvideo'),
    modelPresent: false,
    license: 'n/a',
    diskBytes: 0,
    ramNote: mem.ram,
    vramNote: mem.vram,
    cpuFallback: false,
    expectedSpeed: 'n/a',
    commercialUse: 'n/a',
    usableNow: 'NO',
    notes: ['No trained action model. Motion heuristics must be labeled HEURISTIC. Do not claim walking/running/fighting.'],
  }]
  const embeddings: Wave9EngineAudit[] = [
    {
      backend: 'openclip / clip',
      installed: pythonModule('open_clip') || pythonModule('clip'),
      modelPresent: false,
      license: 'MIT code; weight terms vary',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'ViT-B-32 interactive on CPU when installed',
      commercialUse: 'review weight terms',
      usableNow: 'NO',
      notes: ['CLIP/SigLIP/sentence-transformers not installed. No remote vector DB. No download (>1 GiB typical).'],
    },
    {
      backend: 'sentence-transformers',
      installed: pythonModule('sentence_transformers'),
      modelPresent: false,
      license: 'Apache-2.0',
      diskBytes: 0,
      ramNote: mem.ram,
      vramNote: mem.vram,
      cpuFallback: true,
      expectedSpeed: 'text embeddings only',
      commercialUse: 'YES for Apache-2 models such as all-MiniLM-L6-v2',
      usableNow: 'NO',
      notes: ['Not installed. MiniLM is small but not downloaded this wave.'],
    },
  ]
  const biometric: Wave9EngineAudit[] = [{
    backend: 'local-face-embedding',
    installed: pythonModule('insightface') || pythonModule('face_recognition'),
    modelPresent: false,
    license: 'InsightFace weights often non-commercial; not used',
    diskBytes: 0,
    ramNote: mem.ram,
    vramNote: mem.vram,
    cpuFallback: true,
    expectedSpeed: 'n/a',
    commercialUse: 'NO silent enrollment. OFF BY DEFAULT.',
    usableNow: 'NO',
    notes: ['No face template backend. Biometric mode remains OFF. No public DB scrape. No remote face API.'],
  }]
  return {
    mem,
    modelsDirBytes,
    ffmpeg: { bundled: Boolean(tools.ffmpeg), path: ffmpegPath },
    asr,
    objects,
    action,
    embeddings,
    biometric,
  }
}

export function asrUsableNow(rows: Wave9EngineAudit[]): RuntimeUsable {
  return rows.some(r => r.usableNow === 'YES' && r.installed && r.modelPresent) ? 'YES' : 'NO'
}
