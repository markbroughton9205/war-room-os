/**
 * HVS-GENERATIVE-VIDEO-01 — native local generative-video provider contract.
 *
 * Chain: HVS → local Wan worker (separate process) → video file → existing ingest → AssetRecord → Source monitor.
 * Never HVS → Grok → Wan. No cloud API, no LLM, no API key participates in generation.
 *
 * Deliberately separate from:
 * - lib/media-command/provider-registry.ts (remote metered capability registry; untouched)
 * - lib/media-command/creative-intelligence/* (creative LLM provider abstraction; untouched)
 * This module is pure (no node imports) so the UI and the AI Director can share the contract.
 */

/** Implemented capabilities. */
export const HVS_GENERATIVE_CAPABILITIES = ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] as const
export type HvsGenerativeCapability = (typeof HVS_GENERATIVE_CAPABILITIES)[number]

/** Placeholders only. Not implemented, never routed. */
export const HVS_GENERATIVE_FUTURE_CAPABILITIES = [
  'VIDEO_TO_VIDEO',
  'VIDEO_EXTEND',
  'TEXT_TO_IMAGE',
  'AUDIO_TO_VIDEO',
] as const
export type HvsGenerativeFutureCapability = (typeof HVS_GENERATIVE_FUTURE_CAPABILITIES)[number]

export const HVS_GENERATE_VIDEO_OP = 'hvs.generate.video' as const

export const HVS_GENERATION_STATUSES = [
  'QUEUED',
  'LOADING_MODEL',
  'GENERATING',
  'ENCODING',
  'INGESTING',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
] as const
export type HvsGenerationStatus = (typeof HVS_GENERATION_STATUSES)[number]
export const HVS_GENERATION_TERMINAL: readonly HvsGenerationStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED']

export const HVS_GENERATION_ERROR_CODES = [
  'MODEL_NOT_INSTALLED',
  'MODEL_LOAD_FAILED',
  'GPU_UNAVAILABLE',
  'INSUFFICIENT_VRAM',
  'GPU_OUT_OF_MEMORY',
  'INVALID_GENERATION_REQUEST',
  'SOURCE_ASSET_NOT_FOUND',
  'GENERATION_TIMEOUT',
  'GENERATION_FAILED',
  'ENCODE_FAILED',
  'INGEST_FAILED',
  'CANCELLED',
] as const
export type HvsGenerationErrorCode = (typeof HVS_GENERATION_ERROR_CODES)[number]

export type HvsGenerationError = { code: HvsGenerationErrorCode; message: string }

/** Model lifecycle of the heavy model inside the worker process. */
export const HVS_MODEL_LIFECYCLE_STATES = ['UNLOADED', 'LOADING', 'READY', 'GENERATING', 'UNLOADING', 'ERROR'] as const
export type HvsModelLifecycleState = (typeof HVS_MODEL_LIFECYCLE_STATES)[number]

/** GPU / VRAM availability as seen by the policy. */
export const HVS_GPU_STATES = ['AVAILABLE', 'INSUFFICIENT_VRAM', 'MODEL_BUSY', 'MODEL_NOT_LOADED', 'GPU_UNAVAILABLE'] as const
export type HvsGpuState = (typeof HVS_GPU_STATES)[number]

/** Only identifiers in this list are approved model ids for the worker. */
export const HVS_APPROVED_MODEL_IDS = ['wan2.2-ti2v-5b'] as const
export type HvsApprovedModelId = (typeof HVS_APPROVED_MODEL_IDS)[number]

export const WAN22_IDENTITY = {
  provider: 'wan',
  providerFamily: 'WAN',
  modelFamily: 'Wan2.2',
  modelVariant: 'TI2V-5B',
  modelId: 'wan2.2-ti2v-5b' as HvsApprovedModelId,
  huggingFaceRepo: 'Wan-AI/Wan2.2-TI2V-5B',
  officialCodeRepo: 'https://github.com/Wan-Video/Wan2.2',
  officialTask: 'ti2v-5B',
} as const

/**
 * Bounds come from the official Wan2.2 ti2v-5B config (wan/configs/wan_ti2v_5B.py and
 * wan/configs/__init__.py SUPPORTED_SIZES['ti2v-5B']): 24 fps, frame_num 121 (4n+1), sizes 1280*704 / 704*1280.
 */
export const WAN22_LIMITS = {
  fps: 24,
  supportedSizes: [
    { width: 1280, height: 704 },
    { width: 704, height: 1280 },
  ],
  defaultSize: { width: 1280, height: 704 },
  minDurationSeconds: 1,
  maxDurationSeconds: 5,
  maxFrames: 121,
  promptMinChars: 3,
  promptMaxChars: 1500,
  seedMax: 2_147_483_647,
} as const

export type HvsGenerateVideoRequest = {
  projectId: string
  prompt: string
  durationSeconds: number
  width?: number
  height?: number
  fps?: number
  seed?: number
  /** Resolved ONLY through the project's AssetRecord pool. Filesystem paths are rejected. */
  sourceImageAssetId?: string
  modelPreference?: HvsApprovedModelId
}

export type HvsGenerationSettings = {
  width: number
  height: number
  fps: number
  frames: number
  durationSeconds: number
  seed: number
  offloadModel: boolean
  t5Cpu: boolean
  convertModelDtype: boolean
  sampleSteps: number | null
  memoryMode: 'OFFICIAL_LOW_MEMORY' | 'REDUCED_MEMORY_RETRY'
  attention?: string | null
  /** HVS-GENERATIVE-VIDEO-01A: host-RAM loading mode reported by the worker ('official' | 'bf16-direct+mmap'). */
  hostRamLoad?: string | null
}

export type HvsGenerateVideoResult = {
  generationId: string
  provider: 'wan'
  model: string
  status: HvsGenerationStatus
  outputAssetId?: string
  outputPath?: string
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  seed?: number
  startedAt?: string
  completedAt?: string
  error?: HvsGenerationError
  /** Real step progress parsed from the worker. Never invented. */
  progress?: { step: number; totalSteps: number } | null
  capability?: HvsGenerativeCapability
  requested?: Partial<HvsGenerationSettings> | null
  actual?: Partial<HvsGenerationSettings> | null
  attempts?: number
  /** True only when a real Wan worker produced the file. Fixtures/fake workers are never live. */
  liveGeneration?: boolean
  fixture?: boolean
  jobId?: string
  /** HVS-GENERATIVE-VIDEO-01A: real wall-clock timestamps of each status transition. */
  phaseTimes?: Partial<Record<HvsGenerationStatus, string>>
}

export type HvsGenerateVideoOp = {
  op: typeof HVS_GENERATE_VIDEO_OP
  request: Omit<HvsGenerateVideoRequest, 'projectId'> & { projectId?: string }
  /** Director proposals never execute. The Commander confirms in the UI. */
  execute: false
  source: 'ai-director' | 'natural-language' | 'ui'
}

/** Keys that can never appear in a generation request (no command channel exists). */
export const HVS_GENERATION_FORBIDDEN_KEYS = [
  'command', 'commands', 'cmd', 'shell', 'bash', 'sh', 'exec', 'execute', 'spawn', 'args', 'argv',
  'python', 'pythonCode', 'pythonPath', 'script', 'scriptPath', 'code', 'eval',
  'path', 'filePath', 'sourceImagePath', 'inputImagePath', 'imagePath', 'outputPath', 'outputDir',
  'modelPath', 'workerPython', 'env', 'url', 'apiKey', 'endpoint', 'provider',
] as const

export const HVS_GENERATION_ALLOWED_KEYS = [
  'projectId', 'prompt', 'durationSeconds', 'width', 'height', 'fps', 'seed', 'sourceImageAssetId', 'modelPreference',
] as const

/** Model readiness surfaced to UI. Never claims READY unless installed + GPU policy allows. */
export const HVS_MODEL_STATUS_LINES = ['WAN 2.2 READY', 'MODEL NOT INSTALLED', 'INSUFFICIENT VRAM', 'BUSY', 'ERROR', 'DISABLED', 'GPU UNAVAILABLE'] as const
export type HvsModelStatusLine = (typeof HVS_MODEL_STATUS_LINES)[number]

export function isTerminalGenerationStatus(status: HvsGenerationStatus): boolean {
  return HVS_GENERATION_TERMINAL.includes(status)
}

/** Official frame rule: frame_num must be 4n+1. 5 s @ 24 fps → 121 frames. */
export function framesForDuration(durationSeconds: number, fps: number = WAN22_LIMITS.fps): number {
  const raw = Math.round(durationSeconds * fps)
  const n = Math.max(1, Math.round((raw - 1) / 4))
  return Math.min(WAN22_LIMITS.maxFrames, 4 * n + 1)
}

export function durationForFrames(frames: number, fps: number = WAN22_LIMITS.fps): number {
  return Math.round((frames / fps) * 1000) / 1000
}
