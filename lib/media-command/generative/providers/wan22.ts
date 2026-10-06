/**
 * Wan 2.2 TI2V-5B provider descriptor (local, open weights, Apache-2.0 per the HF model card).
 *
 * Facts below were read from official sources on 2026-10-02, not invented:
 * - HF API tree for Wan-AI/Wan2.2-TI2V-5B @ 921dbaf3f1674a56f47e83fb80a34bac8a8f203e (34,203,123,497 bytes total).
 * - github.com/Wan-Video/Wan2.2 @ 1ea34ff48f87168174e12956e200b1d908b1c5ff: generate.py flags
 *   --offload_model, --t5_cpu, --convert_model_dtype; wan/configs/wan_ti2v_5B.py (24 fps, 121 frames, 50 steps);
 *   README: single-GPU 5B uses `--offload_model True --convert_model_dtype --t5_cpu` and "can run on a GPU with
 *   at least 24GB VRAM (e.g, RTX 4090 GPU)". 16 GB operation is NOT claimed by upstream and is UNTESTED here.
 *
 * The weights' installed version/license used at runtime are always re-read from the installed directory
 * (see model-storage.ts). The constants here are only the expected file manifest and official defaults.
 */
import {
  WAN22_IDENTITY,
  WAN22_LIMITS,
  durationForFrames,
  framesForDuration,
  type HvsGenerateVideoRequest,
  type HvsGenerationSettings,
  type HvsGenerativeCapability,
} from '../types'

export const WAN22_REFERENCE_REVISIONS = {
  huggingFaceRevision: '921dbaf3f1674a56f47e83fb80a34bac8a8f203e',
  huggingFaceLastModified: '2025-08-07T10:22:24.000Z',
  officialCodeCommit: '1ea34ff48f87168174e12956e200b1d908b1c5ff',
  observedAt: '2026-10-02',
  note: 'Reference revisions observed during HVS-GENERATIVE-VIDEO-01. Installed metadata wins at runtime.',
} as const

/** Files the worker needs (wan/configs/wan_ti2v_5B.py checkpoint names + diffusers shards + tokenizer). */
export const WAN22_REQUIRED_FILES: ReadonlyArray<{ path: string; bytes: number }> = [
  { path: 'config.json', bytes: 251 },
  { path: 'Wan2.2_VAE.pth', bytes: 2_818_839_170 },
  { path: 'models_t5_umt5-xxl-enc-bf16.pth', bytes: 11_361_920_418 },
  { path: 'diffusion_pytorch_model.safetensors.index.json', bytes: 72_865 },
  { path: 'diffusion_pytorch_model-00001-of-00003.safetensors', bytes: 9_825_014_472 },
  { path: 'diffusion_pytorch_model-00002-of-00003.safetensors', bytes: 9_995_661_736 },
  { path: 'diffusion_pytorch_model-00003-of-00003.safetensors', bytes: 178_558_176 },
  { path: 'google/umt5-xxl/special_tokens_map.json', bytes: 6_623 },
  { path: 'google/umt5-xxl/spiece.model', bytes: 4_548_313 },
  { path: 'google/umt5-xxl/tokenizer.json', bytes: 16_837_417 },
  { path: 'google/umt5-xxl/tokenizer_config.json', bytes: 61_728 },
]

/** Official repo file listing total (HF API, all files incl. README/assets). */
export const WAN22_HF_TOTAL_BYTES = 34_203_123_497
export const WAN22_REQUIRED_BYTES = WAN22_REQUIRED_FILES.reduce((sum, row) => sum + row.bytes, 0)

/** Files the worker needs from the official code checkout. */
export const WAN22_CODE_REQUIRED_FILES = ['generate.py', 'wan/__init__.py', 'wan/textimage2video.py', 'wan/configs/wan_ti2v_5B.py'] as const

export const WAN22_PROVIDER = {
  ...WAN22_IDENTITY,
  label: 'Wan 2.2 TI2V-5B (local)',
  capabilities: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] as HvsGenerativeCapability[],
  local: true,
  network: 'NONE_AT_GENERATION' as const,
  cost: 'none' as const,
  apiKeyRequired: false,
  workerScript: 'scripts/hvs/wan22_worker.py',
  officialDefaults: { sampleSteps: 50, sampleShift: 5.0, guideScale: 5.0, fps: WAN22_LIMITS.fps, frameNum: WAN22_LIMITS.maxFrames },
  officialVramClaim: 'Upstream README: 5B single-GPU 720p command with offload/convert_model_dtype/t5_cpu runs on >=24GB VRAM. 16GB is untested.',
} as const

export function capabilityFor(request: Pick<HvsGenerateVideoRequest, 'sourceImageAssetId'>): HvsGenerativeCapability {
  return request.sourceImageAssetId ? 'IMAGE_TO_VIDEO' : 'TEXT_TO_VIDEO'
}

/** Attempt 1: official single-GPU low-memory flags at the requested settings. */
export function plannedSettings(request: HvsGenerateVideoRequest, seed: number): HvsGenerationSettings {
  const size = request.width && request.height ? { width: request.width, height: request.height } : WAN22_LIMITS.defaultSize
  const fps = WAN22_LIMITS.fps
  const frames = framesForDuration(request.durationSeconds, fps)
  return {
    width: size.width,
    height: size.height,
    fps,
    frames,
    durationSeconds: durationForFrames(frames, fps),
    seed,
    offloadModel: true,
    t5Cpu: true,
    convertModelDtype: true,
    sampleSteps: WAN22_PROVIDER.officialDefaults.sampleSteps,
    memoryMode: 'OFFICIAL_LOW_MEMORY',
  }
}

/**
 * REDUCED_MEMORY_RETRY (at most one, only after GPU_OUT_OF_MEMORY):
 * keeps the official low-memory flags, keeps resolution (TI2V-5B supports only two equal-area sizes),
 * caps frame_num at 49 (~2.0 s @ 24 fps) and asks PyTorch for expandable segments.
 * Requested vs actual settings are both recorded; the shorter duration is never hidden.
 */
export const WAN22_REDUCED_MEMORY_MAX_FRAMES = 49

/** HVS-GENERATIVE-VIDEO-01A: when the first attempt already used <= 49 frames, the retry steps down to 25 (~1 s). */
export const WAN22_REDUCED_MEMORY_FLOOR_FRAMES = 25

export function reducedMemorySettings(previous: HvsGenerationSettings): HvsGenerationSettings {
  const frames = previous.frames > WAN22_REDUCED_MEMORY_MAX_FRAMES
    ? WAN22_REDUCED_MEMORY_MAX_FRAMES
    : Math.min(previous.frames, WAN22_REDUCED_MEMORY_FLOOR_FRAMES)
  return {
    ...previous,
    frames,
    durationSeconds: durationForFrames(frames, previous.fps),
    offloadModel: true,
    t5Cpu: true,
    convertModelDtype: true,
    memoryMode: 'REDUCED_MEMORY_RETRY',
  }
}

/** Typed JSON handed to the worker on stdin. No free-form strings except the prompt. */
export type Wan22WorkerInput = {
  schema: 'hvs.wan22.worker-input.v1'
  generationId: string
  modelId: typeof WAN22_IDENTITY.modelId
  task: typeof WAN22_IDENTITY.officialTask
  prompt: string
  frames: number
  width: number
  height: number
  fps: number
  seed: number
  sampleSteps: number | null
  offloadModel: boolean
  t5Cpu: boolean
  convertModelDtype: boolean
  memoryMode: HvsGenerationSettings['memoryMode']
  /** Resolved internally from an AssetRecord; never taken from a request. */
  inputImagePath: string | null
  outputPath: string
  checkpointDir: string
  codeDir: string
}

export function buildWan22WorkerInput(input: {
  generationId: string
  prompt: string
  settings: HvsGenerationSettings
  inputImagePath: string | null
  outputPath: string
  checkpointDir: string
  codeDir: string
}): Wan22WorkerInput {
  return {
    schema: 'hvs.wan22.worker-input.v1',
    generationId: input.generationId,
    modelId: WAN22_IDENTITY.modelId,
    task: WAN22_IDENTITY.officialTask,
    prompt: input.prompt,
    frames: input.settings.frames,
    width: input.settings.width,
    height: input.settings.height,
    fps: input.settings.fps,
    seed: input.settings.seed,
    sampleSteps: input.settings.sampleSteps,
    offloadModel: input.settings.offloadModel,
    t5Cpu: input.settings.t5Cpu,
    convertModelDtype: input.settings.convertModelDtype,
    memoryMode: input.settings.memoryMode,
    inputImagePath: input.inputImagePath,
    outputPath: input.outputPath,
    checkpointDir: input.checkpointDir,
    codeDir: input.codeDir,
  }
}
