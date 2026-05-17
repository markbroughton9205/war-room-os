export type BridgeMode = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATED' | 'LOCAL AI ACTIVE'

export type BridgeProviderId = 'lm_studio' | 'ollama'

export type BridgeAllowedAction =
  | 'model_list'
  | 'prompt_test'
  | 'local_inference'
  | 'diagnostics'
  | 'health_check'

export type BridgeProviderStatus = {
  provider: BridgeProviderId
  reachable: boolean
  functional: boolean
  models: string[]
  activeModel: string | null
  latencyMs: number | null
  error: string | null
  checkedAt: string
}

export type BridgeHeartbeatRequest = {
  nodeName?: string
  activeProvider?: BridgeProviderId | null
  activeModel?: string | null
  latencyMs?: number | null
  providers?: BridgeProviderStatus[]
  capabilities?: BridgeAllowedAction[]
  version?: string
}

export type BridgeNodeIdentity = {
  name: 'Commander Node'
  online: boolean
  lastHeartbeat: string | null
  activeProvider: BridgeProviderId | null
  activeModel: string | null
  latencyMs: number | null
}

export type BridgeStatusResponse = {
  mode: BridgeMode
  authenticated: boolean
  stale: boolean
  tokenConfigured: boolean
  node: BridgeNodeIdentity
  providers: BridgeProviderStatus[]
  capabilities: BridgeAllowedAction[]
  heartbeatIntervalSeconds: number
  staleTimeoutSeconds: number
  pendingInvocations: number
  updatedAt: string
  securityBoundaries: string[]
  futureConnectors: string[]
}

export type BridgeInvocationRequest = {
  id: string
  action: BridgeAllowedAction
  provider: BridgeProviderId | null
  model: string | null
  prompt: string | null
  createdAt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export type BridgeInvocationResult = {
  id: string
  action: BridgeAllowedAction
  provider: BridgeProviderId | null
  model: string | null
  latencyMs: number | null
  response: string | null
  models?: string[]
  diagnostics?: unknown
  error: string | null
  completedAt: string
}
