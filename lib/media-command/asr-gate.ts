/**
 * Honest local ASR gate. Never fakes readiness. Never silent-downloads.
 */
import { existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { WAVE9_ASR_RECOMMENDATION } from './wave9-runtime-audit'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED, HVS_SLICE4_ASR_TINY_EN_AUTHORIZED } from './policy'
import { syncWhisperModelCatalog } from './asr-catalog'

export type AsrGateStatus =
  | 'ASR_RUNTIME_READY'
  | 'ASR_MODEL_MISSING'
  | 'ASR_RUNTIME_MISSING'
  | 'ASR_FAILED'
  | 'READY'
  | 'ASR_RUNTIME_NOT_READY'
  | 'ASR_MODEL_APPROVAL_REQUIRED'

export type AsrInstallPlan = {
  model: string
  officialSource: string
  license: string
  estimatedBytes: number
  ramRequirement: string
  vramRequirement: string
  cpuSupport: boolean
  expectedSpeed: string
  languageCoverage: string
  overOneGiB: boolean
  downloadAuthorized: boolean
  status: 'ASR_MODEL_APPROVAL_REQUIRED' | 'AUTHORIZED_TINY_EN'
  note: string
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

export function whisperBinaryPath(): string | null {
  const bundled = path.join(mediaCommandDataHierarchy().tools, 'whisper-cli')
  if (existsSync(bundled)) return bundled
  return which('whisper-cli') ?? which('whisper') ?? which('whisper.cpp')
}

export function whisperModelPath(override?: string | null): string {
  if (override) return override
  return path.join(mediaCommandDataHierarchy().models, 'whisper', 'ggml-tiny.en.bin')
}

export function asrEnvironmentSnapshot(opts?: { modelPathOverride?: string | null }) {
  const modelsDir = mediaCommandDataHierarchy().models
  const modelPath = whisperModelPath(opts?.modelPathOverride)
  const whisperBin = whisperBinaryPath()
  return {
    whisperCppBinary: whisperBin,
    fasterWhisper: pythonModule('faster_whisper'),
    openaiWhisper: pythonModule('whisper'),
    onnxAsr: pythonModule('onnxruntime') && existsSync(path.join(modelsDir, 'asr')),
    tinyEnPresent: existsSync(modelPath),
    tinyEnBytes: existsSync(modelPath) ? statSync(modelPath).size : 0,
    modelsDir,
    modelPath,
    downloadAuthorized: HVS_SLICE4_ASR_TINY_EN_AUTHORIZED,
    wave9DownloadAuthorized: HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED,
  }
}

export const HVS_ASR_INSTALL_PLAN: AsrInstallPlan = {
  model: WAVE9_ASR_RECOMMENDATION.preferredModel,
  officialSource: WAVE9_ASR_RECOMMENDATION.hashSource,
  license: WAVE9_ASR_RECOMMENDATION.modelLicense,
  estimatedBytes: WAVE9_ASR_RECOMMENDATION.bytes,
  ramRequirement: '~1 GiB RAM for tiny.en on CPU',
  vramRequirement: 'GPU optional; CPU fallback supported',
  cpuSupport: true,
  expectedSpeed: WAVE9_ASR_RECOMMENDATION.expectedSpeed,
  languageCoverage: 'English via tiny.en; multilingual models are larger and not this plan',
  overOneGiB: false,
  downloadAuthorized: false,
  status: 'ASR_MODEL_APPROVAL_REQUIRED',
  note: 'tiny.en is under 1 GiB. Wave 9 / Slice 3 do not silent-download. Slice 4 Commander authorization is a separate flag.',
}

export function asrGateStatus(snapshot = asrEnvironmentSnapshot()): {
  status: AsrGateStatus
  snapshot: ReturnType<typeof asrEnvironmentSnapshot>
  installPlan: AsrInstallPlan
  usableNow: boolean
} {
  const runtime = Boolean(snapshot.whisperCppBinary)
  const model = snapshot.tinyEnPresent
  if (runtime && model) {
    try { syncWhisperModelCatalog() } catch { /* catalog is derived truth; missing write is not a runtime miss */ }
    return { status: 'ASR_RUNTIME_READY', snapshot, installPlan: HVS_ASR_INSTALL_PLAN, usableNow: true }
  }
  if (!runtime && !model) {
    return { status: 'ASR_RUNTIME_MISSING', snapshot, installPlan: HVS_ASR_INSTALL_PLAN, usableNow: false }
  }
  if (!runtime) {
    return { status: 'ASR_RUNTIME_MISSING', snapshot, installPlan: HVS_ASR_INSTALL_PLAN, usableNow: false }
  }
  if (!model) {
    return { status: 'ASR_MODEL_MISSING', snapshot, installPlan: HVS_ASR_INSTALL_PLAN, usableNow: false }
  }
  return { status: 'ASR_FAILED', snapshot, installPlan: HVS_ASR_INSTALL_PLAN, usableNow: false }
}

export function asrUnavailableCopy(status: AsrGateStatus): string {
  if (status === 'ASR_MODEL_MISSING' || status === 'ASR_MODEL_APPROVAL_REQUIRED') {
    return 'Speech recognition is unavailable because the local speech model is missing. I will not invent captions.'
  }
  if (status === 'ASR_FAILED') {
    return 'Speech recognition failed. I will not invent captions.'
  }
  return 'Speech recognition is not ready on this computer. I will not invent captions.'
}
