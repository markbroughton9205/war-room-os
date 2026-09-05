/**
 * WR-Engineer Phase 5 engine-selection and dashboard types.
 *
 * Identity stays in IDENTITY.md — these labels describe the backing runtime/provider, never who
 * WR-Engineer is. Default Commander mode is LOCAL.
 */
import type { DirectProviderFamily } from '@/lib/council/providerDirectCall'
import type { ProviderFailureClass, ProviderHealthStatus } from './providerFailure'

export const ENGINE_MODES = ['LOCAL', 'AUTO', 'EXTERNAL'] as const
export type EngineMode = (typeof ENGINE_MODES)[number]

export const LOCAL_ENGINE_STATUSES = ['READY', 'STARTING', 'UNAVAILABLE'] as const
export type LocalEngineStatus = (typeof LOCAL_ENGINE_STATUSES)[number]

export const DEFAULT_ENGINE_MODE: EngineMode = 'LOCAL'
export const DEFAULT_LOCAL_RUNTIME = 'ollama'
export const DEFAULT_LOCAL_MODEL = 'qwen2.5-coder:14b'
export const DEFAULT_EXTERNAL_FAMILY: DirectProviderFamily = 'claude'
export const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434'
export const LOCAL_INFERENCE_TIMEOUT_MS = 60_000
export const LOCAL_MAX_ATTEMPTS = 1
export const LOCAL_MAX_SYSTEM_PROMPT_BYTES = 96 * 1024

export const RECOMMENDED_LOCAL_MODEL = {
  name: DEFAULT_LOCAL_MODEL,
  parameterClass: '14B',
  quantization: 'Q4_K_M (Ollama default tag)',
  estimatedDiskBytes: 9 * 1024 * 1024 * 1024,
  estimatedVramBytes: 11 * 1024 * 1024 * 1024,
  estimatedSystemRamBytes: 4 * 1024 * 1024 * 1024,
  why: 'Coding-focused 14B instruct model that fits an RTX 5060 Ti 16 GB card with headroom for the Phase 4 inspect loop context; swappable later without changing WR-Engineer identity.',
} as const

export function isEngineMode(value: string): value is EngineMode {
  return (ENGINE_MODES as readonly string[]).includes(value)
}

export type EngineSelection = {
  mode: EngineMode
  externalFamily: DirectProviderFamily
  localModel: string
  updatedAt: string
}

export type LocalEngineTelemetry = {
  lastLatencyMs: number | null
  lastError: string | null
  lastStatus: LocalEngineStatus
  lastCheckedAt: string | null
  lastPromptBytes: number | null
  lastResponseBytes: number | null
  lastModel: string | null
}

export type SafeLocalEngineView = {
  runtime: string
  model: string
  status: LocalEngineStatus
  endpoint: string
  lastLatencyMs: number | null
  lastError: string | null
}

export type ExternalProviderView = {
  provider: DirectProviderFamily
  configured: boolean
  status: ProviderHealthStatus
  lastFailureClass?: ProviderFailureClass
}

export type WrEngineerEngineDashboardState = {
  wrEngineer: 'WR-ENGINEER'
  mode: EngineMode
  activeEngine: 'local' | 'external' | 'none'
  model: string
  runtime: string
  gpu: string
  engineStatus: LocalEngineStatus | 'EXTERNAL_READY' | 'EXTERNAL_UNAVAILABLE' | 'EXTERNAL_RATE_LIMITED'
  node: string
  local: SafeLocalEngineView
  external: ExternalProviderView[]
  fallbackAllowed: boolean
}

export type LocalInferenceMetrics = {
  promptBytes: number
  responseBytes: number
  latencyMs: number
  truncatedPrompt: boolean
}
