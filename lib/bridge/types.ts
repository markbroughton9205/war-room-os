export type BridgeMode = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATED' | 'LOCAL AI ACTIVE'

export type BridgeProviderId = 'lm_studio' | 'ollama'

export type BridgeNodeType =
  | 'commander_laptop'
  | 'engineering_node'
  | 'observer_node'
  | 'future_gpu_node'

export type BridgeTrustLevel = 'observer' | 'inference' | 'engineering' | 'restricted'

export type BridgeNodeStatus = 'online' | 'offline' | 'connecting' | 'degraded' | 'reconnecting'

export type BridgeRuntimeStatus = 'online' | 'degraded' | 'reconnecting' | 'disconnected' | 'recovered'

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

export type BridgeRuntimeSnapshot = {
  nodeId: string
  uptimeSeconds: number
  reconnectCount: number
  heartbeatLatencyMs: number | null
  memoryUsageMb: number | null
  activeModel: string | null
  activeProvider: BridgeProviderId | null
  nodeHealth: BridgeRuntimeStatus
  providerSwitchCount: number
  lastProviderSwitchAt: string | null
  supervisor: {
    enabled: boolean
    restartCount: number
    lastRestartAt: string | null
    backoffMs: number | null
    launchMode: 'manual' | 'supervised' | 'task_scheduler'
    serviceModeActive?: boolean
    runtimePid?: number | null
    startupMode?: 'manual' | 'login' | 'boot'
    logPath?: string | null
    lastCrashReason?: string | null
  }
  updatedAt: string
}

export type BridgeHeartbeatRequest = {
  nodeId?: string
  nodeName?: string
  nodeType?: BridgeNodeType
  trustLevel?: BridgeTrustLevel
  reconnectStatus?: BridgeNodeStatus
  backoffMs?: number | null
  activeProvider?: BridgeProviderId | null
  activeModel?: string | null
  latencyMs?: number | null
  providers?: BridgeProviderStatus[]
  runtime?: Omit<BridgeRuntimeSnapshot, 'nodeId' | 'updatedAt'>
  capabilities?: BridgeAllowedAction[]
  version?: string
}

export type BridgeNodeIdentity = {
  nodeId: string
  name: string
  nodeType: BridgeNodeType
  status: BridgeNodeStatus
  online: boolean
  lastHeartbeat: string | null
  activeProvider: BridgeProviderId | null
  activeModel: string | null
  latencyMs: number | null
  capabilities: BridgeAllowedAction[]
  trustLevel: BridgeTrustLevel
  reconnectStatus: BridgeNodeStatus
  backoffMs: number | null
}

export type BridgeNodeRegistryEntry = {
  node_id: string
  node_name: string
  node_type: BridgeNodeType
  status: BridgeNodeStatus
  provider: BridgeProviderId | null
  active_model: string | null
  last_heartbeat: string | null
  latency: number | null
  capabilities: BridgeAllowedAction[]
  trust_level: BridgeTrustLevel
  reconnect_status: BridgeNodeStatus
  degraded_reason: string | null
}

export type BridgeStatusTimelineEntry = {
  id: string
  nodeId: string
  nodeName: string
  eventType: 'heartbeat' | 'provider_change' | 'model_swap' | 'failure' | 'reconnect' | 'invoke_request' | 'node_action' | 'rejection' | 'runtime_status'
  summary: string
  severity: 'info' | 'watch' | 'warning' | 'critical'
  createdAt: string
}

export type BridgeRoutingRule = {
  taskType: string
  routeTo: string
  preferredNodeType: BridgeNodeType | 'cloud_family'
  preferredProvider: BridgeProviderId | 'grok_cloud' | 'chatgpt_family' | null
  trustRequired: BridgeTrustLevel
  notes: string
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
  nodes: BridgeNodeRegistryEntry[]
  statusTimeline: BridgeStatusTimelineEntry[]
  routingModel: BridgeRoutingRule[]
  runtime: BridgeRuntimeSnapshot | null
  statusHistory: BridgeStatusHistoryEntry[]
}

export type BridgeStatusHistoryEntry = {
  id: string
  nodeId: string
  nodeName: string
  status: BridgeRuntimeStatus
  previousStatus: BridgeRuntimeStatus | null
  summary: string
  createdAt: string
}

export type BridgeRuntimeResponse = {
  generatedAt: string
  staleTimeoutSeconds: number
  nodes: BridgeNodeRegistryEntry[]
  runtimes: BridgeRuntimeSnapshot[]
  primaryRuntime: BridgeRuntimeSnapshot | null
  statusHistory: BridgeStatusHistoryEntry[]
  providerStatus: Record<string, BridgeProviderStatus[]>
}

export type BridgeServiceStatusResponse = {
  generatedAt: string
  serviceModeActive: boolean
  runtimePid: number | null
  uptimeSeconds: number
  restartCount: number
  reconnectCount: number
  lastCrashReason: string | null
  runtimeHealth: BridgeRuntimeStatus
  startupMode: 'manual' | 'login' | 'boot'
  logPath: string | null
  persistentNodeState: BridgeNodeRegistryEntry | null
}

export type BridgeInvocationRequest = {
  id: string
  nodeId: string | null
  action: BridgeAllowedAction
  provider: BridgeProviderId | null
  model: string | null
  prompt: string | null
  createdAt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export type BridgeInvocationResult = {
  id: string
  nodeId?: string | null
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
