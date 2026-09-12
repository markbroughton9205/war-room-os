/**
 * #22 Phase 11B — Local model types + runtime-truth states.
 * THIRD_PARTY_MODEL_RUNNING_LOCALLY != WRIM != RA'EL
 */
export const LOCAL_MODEL_PROVIDER_TYPES = ['OLLAMA', 'LM_STUDIO', 'LOCAL_OPENAI_COMPATIBLE'] as const
export type LocalModelProviderType = (typeof LOCAL_MODEL_PROVIDER_TYPES)[number]

export const LOCAL_MODEL_RUNTIME_STATES = [
  'READY',
  'AVAILABLE',
  'UNAVAILABLE',
  'NOT_RUNNING',
  'NOT_CONFIGURED',
  'MODEL_NOT_INSTALLED',
  'ENDPOINT_UNREACHABLE',
  'DEGRADED',
  'TIMEOUT',
  'ERROR',
] as const
export type LocalModelRuntimeState = (typeof LOCAL_MODEL_RUNTIME_STATES)[number]

export const GENESIS_GENERAL_MODEL_ID = 'huihui_ai/qwen3-abliterated:14b' as const

export type LocalModelEndpointClass = 'LOOPBACK' | 'DENIED' | 'UNTRUSTED'

export type LocalModelDiscovery = {
  provider: LocalModelProviderType
  configured: boolean
  endpoint: string | null
  endpoint_class: LocalModelEndpointClass
  service_status: LocalModelRuntimeState
  models: string[]
  selected_model: string | null
  selected_model_status: LocalModelRuntimeState
  inference_ready: boolean
  streaming_supported: boolean
  detail: string
  /** CONFIGURED != AVAILABLE */
  notes: string[]
}

export type LocalModelInferRequest = {
  prompt: string
  system?: string
  model?: string | null
  provider?: LocalModelProviderType
  ownerUserId?: string | null
  resourceOwnerUserId?: string | null
  conversationId?: string | null
  /** Red-team / policy probes */
  attemptToolAuthorization?: boolean
  attemptDeployAuthorization?: boolean
  attemptPushAuthorization?: boolean
  attemptFinanceAuthorization?: boolean
  attemptAgentSpawn?: boolean
  attemptApproveGovernance?: boolean
  claimIsWrim?: boolean
  claimIsRael?: boolean
}

export type LocalModelInferResult = {
  ok: boolean
  status: LocalModelRuntimeState
  requested_provider: LocalModelProviderType
  actual_provider: LocalModelProviderType | null
  actual_model: string | null
  fallback_used: boolean
  local_or_remote: 'LOCAL' | 'REMOTE'
  content: string | null
  error: string | null
  started_at: string
  completed_at: string
  latency_ms: number | null
  streaming: boolean
  denials: Array<{ capability_or_action: string; reason_code: string; reason: string }>
  audit: {
    provider_type: LocalModelProviderType | null
    model: string | null
    local_or_remote: 'LOCAL'
    result_status: LocalModelRuntimeState
    fallback_used: boolean
    actor: string
    conversation_id: string | null
  }
  intelligence_class: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY'
  wrim: 'NOT_IMPLEMENTED'
  rael: 'NOT_IMPLEMENTED'
  roadmap_23: 'NOT_STARTED'
}

export type LocalCouncilModeReport = {
  mode: 'DEGRADED_LOCAL' | 'UNAVAILABLE' | 'FULL_MULTI_PROVIDER_COUNCIL_NOT_CLAIMED'
  shared_physical_model: boolean
  physical_model_id: string | null
  role_contracts_preserved: true
  seats_using_shared_weight: string[]
  note: string
}
