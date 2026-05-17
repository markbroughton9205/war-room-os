import { bridgeTokenConfigured } from './auth'
import { BRIDGE_ROUTING_MODEL } from './catalog'
import {
  persistBridgeAuditLog,
  persistBridgeHeartbeat,
  persistBridgeNode,
  persistBridgeProviderEvent,
} from './persistence'
import type {
  BridgeAllowedAction,
  BridgeHeartbeatRequest,
  BridgeInvocationRequest,
  BridgeInvocationResult,
  BridgeMode,
  BridgeNodeRegistryEntry,
  BridgeNodeStatus,
  BridgeNodeType,
  BridgeProviderId,
  BridgeProviderStatus,
  BridgeStatusResponse,
  BridgeStatusTimelineEntry,
  BridgeTrustLevel,
} from './types'

const HEARTBEAT_INTERVAL_SECONDS = 20
const STALE_TIMEOUT_SECONDS = 50
const MAX_QUEUE_DEPTH = 20
const MAX_PROMPT_LENGTH = 4000
const DEFAULT_NODE_ID = 'commander-node'

export const BRIDGE_SECURITY_BOUNDARIES = [
  'No shell execution',
  'No arbitrary command execution',
  'No arbitrary localhost forwarding',
  'No filesystem writes',
  'No deployment control',
  'No OS automation',
  'Approval gates remain external and explicit',
]

const FUTURE_CONNECTORS = ['OpenHands', 'Continue', 'Aider', 'Goose', 'Codex']
const FUTURE_NODE_TARGETS = ['Remote GPU nodes', 'VPS nodes', 'Mobile observer clients', 'Dedicated inference machines']
const ALLOWED_ACTIONS: BridgeAllowedAction[] = ['model_list', 'prompt_test', 'local_inference', 'diagnostics', 'health_check']
const PROVIDERS: BridgeProviderId[] = ['lm_studio', 'ollama']
const NODE_TYPES: BridgeNodeType[] = ['commander_laptop', 'engineering_node', 'observer_node', 'future_gpu_node']
const TRUST_LEVELS: BridgeTrustLevel[] = ['observer', 'inference', 'engineering', 'restricted']
const STATUSES: BridgeNodeStatus[] = ['online', 'offline', 'connecting', 'degraded', 'reconnecting']

type BridgeMemory = {
  authenticated: boolean
  nodes: Record<string, BridgeNodeRegistryEntry>
  providerSnapshots: Record<string, BridgeProviderStatus[]>
  queue: BridgeInvocationRequest[]
  results: BridgeInvocationResult[]
  timeline: BridgeStatusTimelineEntry[]
}

declare global {
  var warRoomBridgeMemory: BridgeMemory | undefined
}

function memory(): BridgeMemory {
  globalThis.warRoomBridgeMemory ??= {
    authenticated: false,
    nodes: {},
    providerSnapshots: {},
    queue: [],
    results: [],
    timeline: [],
  }
  return globalThis.warRoomBridgeMemory
}

function nowIso() {
  return new Date().toISOString()
}

function timestampIsStale(value: string | null) {
  if (!value) return true
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return true
  return Date.now() - parsed > STALE_TIMEOUT_SECONDS * 1000
}

function nodeIsStale(node: BridgeNodeRegistryEntry) {
  return timestampIsStale(node.last_heartbeat)
}

function liveNodes(state: BridgeMemory) {
  return Object.values(state.nodes).map(node => {
    if (!nodeIsStale(node)) return node
    return {
      ...node,
      status: 'offline' as BridgeNodeStatus,
      provider: null,
      active_model: null,
      latency: null,
      reconnect_status: 'reconnecting' as BridgeNodeStatus,
      degraded_reason: 'heartbeat stale',
    }
  })
}

function primaryNode(state: BridgeMemory) {
  const nodes = liveNodes(state)
  return nodes.find(node => node.node_id === DEFAULT_NODE_ID)
    ?? nodes.find(node => node.status === 'online' && node.trust_level === 'engineering')
    ?? nodes.find(node => node.status === 'online')
    ?? nodes[0]
    ?? null
}

function modeFor(state: BridgeMemory): BridgeMode {
  if (!bridgeTokenConfigured()) return 'DISCONNECTED'
  const nodes = liveNodes(state)
  if (nodes.length === 0) return 'CONNECTING'
  const onlineNodes = nodes.filter(node => node.status === 'online')
  if (onlineNodes.length === 0) return nodes.some(node => node.status === 'degraded' || node.status === 'reconnecting') ? 'AUTHENTICATED' : 'DISCONNECTED'
  if (onlineNodes.some(node => node.provider && node.active_model)) return 'LOCAL AI ACTIVE'
  return state.authenticated ? 'AUTHENTICATED' : 'CONNECTING'
}

function cleanId(value: string | undefined, fallback = DEFAULT_NODE_ID) {
  const cleaned = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

function cleanNodeType(value: BridgeNodeType | undefined): BridgeNodeType {
  return value && NODE_TYPES.includes(value) ? value : 'commander_laptop'
}

function cleanTrustLevel(value: BridgeTrustLevel | undefined): BridgeTrustLevel {
  return value && TRUST_LEVELS.includes(value) ? value : 'inference'
}

function cleanStatus(value: BridgeNodeStatus | undefined): BridgeNodeStatus {
  return value && STATUSES.includes(value) ? value : 'online'
}

function cleanProvider(provider: BridgeProviderStatus): BridgeProviderStatus {
  return {
    provider: provider.provider,
    reachable: Boolean(provider.reachable),
    functional: Boolean(provider.functional),
    models: Array.isArray(provider.models) ? provider.models.slice(0, 50).map(model => model.slice(0, 160)) : [],
    activeModel: provider.activeModel?.slice(0, 160) ?? null,
    latencyMs: typeof provider.latencyMs === 'number' ? provider.latencyMs : null,
    error: provider.error?.slice(0, 300) ?? null,
    checkedAt: provider.checkedAt || nowIso(),
  }
}

function addTimeline(input: Omit<BridgeStatusTimelineEntry, 'id' | 'createdAt'>) {
  const state = memory()
  const entry: BridgeStatusTimelineEntry = {
    ...input,
    id: `bridge_event_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso(),
  }
  state.timeline.unshift(entry)
  state.timeline = state.timeline.slice(0, 40)
  void persistBridgeAuditLog({
    nodeId: entry.nodeId,
    eventType: entry.eventType,
    severity: entry.severity,
    summary: entry.summary,
  })
  return entry
}

function registryEntryFor(input: BridgeHeartbeatRequest, providers: BridgeProviderStatus[]): BridgeNodeRegistryEntry {
  const nodeId = cleanId(input.nodeId)
  const activeProvider = input.activeProvider && PROVIDERS.includes(input.activeProvider) ? input.activeProvider : null
  const activeModel = input.activeModel?.slice(0, 160) ?? null
  const status = cleanStatus(input.reconnectStatus)
  const degraded = providers.some(provider => provider.error)

  return {
    node_id: nodeId,
    node_name: input.nodeName?.trim().slice(0, 120) || (nodeId === DEFAULT_NODE_ID ? 'Commander Node' : nodeId),
    node_type: cleanNodeType(input.nodeType),
    status: degraded && !activeProvider ? 'degraded' : status,
    provider: activeProvider,
    active_model: activeProvider ? activeModel : null,
    last_heartbeat: nowIso(),
    latency: typeof input.latencyMs === 'number' ? input.latencyMs : null,
    capabilities: (input.capabilities ?? ALLOWED_ACTIONS).filter(action => ALLOWED_ACTIONS.includes(action)),
    trust_level: cleanTrustLevel(input.trustLevel),
    reconnect_status: status === 'reconnecting' ? 'reconnecting' : 'online',
    degraded_reason: degraded && !activeProvider ? 'provider failure reported' : null,
  }
}

export function getBridgeStatus(): BridgeStatusResponse {
  const state = memory()
  const node = primaryNode(state)
  const nodes = liveNodes(state)
  const isStale = !node || nodeIsStale(node)
  const activeProvider = isStale ? null : node.provider
  const activeModel = isStale ? null : node.active_model

  return {
    mode: modeFor(state),
    authenticated: state.authenticated && !isStale,
    stale: isStale,
    tokenConfigured: bridgeTokenConfigured(),
    node: {
      nodeId: node?.node_id ?? DEFAULT_NODE_ID,
      name: node?.node_name ?? 'Commander Node',
      nodeType: node?.node_type ?? 'commander_laptop',
      status: node?.status ?? 'offline',
      online: Boolean(node) && !isStale && node.status === 'online',
      lastHeartbeat: node?.last_heartbeat ?? null,
      activeProvider,
      activeModel,
      latencyMs: isStale ? null : node?.latency ?? null,
      capabilities: node?.capabilities ?? ALLOWED_ACTIONS,
      trustLevel: node?.trust_level ?? 'inference',
      reconnectStatus: node?.reconnect_status ?? 'reconnecting',
      backoffMs: null,
    },
    providers: isStale ? [] : state.providerSnapshots[node.node_id] ?? [],
    capabilities: node?.capabilities ?? ALLOWED_ACTIONS,
    heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    staleTimeoutSeconds: STALE_TIMEOUT_SECONDS,
    pendingInvocations: state.queue.filter(item => item.status === 'pending').length,
    updatedAt: nowIso(),
    securityBoundaries: BRIDGE_SECURITY_BOUNDARIES,
    futureConnectors: [...FUTURE_CONNECTORS, ...FUTURE_NODE_TARGETS],
    nodes,
    statusTimeline: state.timeline,
    routingModel: BRIDGE_ROUTING_MODEL,
  }
}

export function recordBridgeHeartbeat(input: BridgeHeartbeatRequest) {
  const state = memory()
  const providers = (input.providers ?? [])
    .filter(provider => PROVIDERS.includes(provider.provider))
    .map(cleanProvider)
  const previous = state.nodes[cleanId(input.nodeId)]
  const node = registryEntryFor(input, providers)

  state.authenticated = true
  state.nodes[node.node_id] = node
  state.providerSnapshots[node.node_id] = providers

  const heartbeatEvent: 'heartbeat' | 'failure' | 'reconnect' =
    node.status === 'degraded' ? 'failure' : previous && previous.status !== 'online' ? 'reconnect' : 'heartbeat'

  addTimeline({
    nodeId: node.node_id,
    nodeName: node.node_name,
    eventType: heartbeatEvent,
    severity: node.status === 'degraded' ? 'warning' : heartbeatEvent === 'reconnect' ? 'watch' : 'info',
    summary: `${node.node_name} heartbeat ${node.status}${node.provider ? ` via ${node.provider}` : ''}.`,
  })

  if (previous && previous.provider !== node.provider) {
    addTimeline({
      nodeId: node.node_id,
      nodeName: node.node_name,
      eventType: 'provider_change',
      severity: 'watch',
      summary: `${node.node_name} provider changed from ${previous.provider ?? 'none'} to ${node.provider ?? 'none'}.`,
    })
    void persistBridgeProviderEvent({
      nodeId: node.node_id,
      eventType: 'provider_change',
      previousProvider: previous.provider,
      nextProvider: node.provider,
      summary: `${node.node_name} provider changed.`,
    })
  }

  if (previous && previous.active_model !== node.active_model) {
    addTimeline({
      nodeId: node.node_id,
      nodeName: node.node_name,
      eventType: 'model_swap',
      severity: 'watch',
      summary: `${node.node_name} model changed from ${previous.active_model ?? 'none'} to ${node.active_model ?? 'none'}.`,
    })
    void persistBridgeProviderEvent({
      nodeId: node.node_id,
      eventType: 'model_swap',
      previousModel: previous.active_model,
      nextModel: node.active_model,
      summary: `${node.node_name} model changed.`,
    })
  }

  void persistBridgeNode(node)
  void persistBridgeHeartbeat({ node, providers, eventType: heartbeatEvent })

  return getBridgeStatus()
}

function newInvocationId() {
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function enqueueBridgeInvocation(input: {
  action?: string
  nodeId?: string | null
  provider?: string | null
  model?: string | null
  prompt?: string | null
}) {
  const status = getBridgeStatus()
  if (!status.authenticated || status.mode === 'DISCONNECTED' || status.mode === 'CONNECTING') {
    return { ok: false as const, status: 409, message: 'Commander Node is not authenticated and online.' }
  }

  const action = input.action as BridgeAllowedAction
  if (!ALLOWED_ACTIONS.includes(action)) {
    addTimeline({
      nodeId: input.nodeId ?? DEFAULT_NODE_ID,
      nodeName: input.nodeId ?? 'Commander Node',
      eventType: 'rejection',
      severity: 'warning',
      summary: `Rejected unsupported bridge action: ${input.action ?? 'unknown'}.`,
    })
    void persistBridgeAuditLog({
      nodeId: input.nodeId,
      eventType: 'rejection',
      severity: 'warning',
      summary: `Rejected unsupported bridge action: ${input.action ?? 'unknown'}.`,
      action: input.action,
      rejected: true,
    })
    return { ok: false as const, status: 400, message: 'Unsupported bridge action.' }
  }

  const provider = input.provider ? input.provider as BridgeProviderId : null
  if (provider && !PROVIDERS.includes(provider)) {
    void persistBridgeAuditLog({
      nodeId: input.nodeId,
      eventType: 'rejection',
      severity: 'warning',
      summary: `Rejected unsupported local provider: ${input.provider ?? 'unknown'}.`,
      action,
      rejected: true,
    })
    return { ok: false as const, status: 400, message: 'Unsupported local provider.' }
  }

  const prompt = input.prompt?.trim() ?? null
  if ((action === 'prompt_test' || action === 'local_inference') && !prompt) {
    void persistBridgeAuditLog({
      nodeId: input.nodeId,
      eventType: 'rejection',
      severity: 'warning',
      summary: 'Rejected bridge invocation without required prompt.',
      action,
      rejected: true,
    })
    return { ok: false as const, status: 400, message: 'Prompt is required for this bridge action.' }
  }
  if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
    void persistBridgeAuditLog({
      nodeId: input.nodeId,
      eventType: 'rejection',
      severity: 'warning',
      summary: 'Rejected bridge invocation because prompt exceeded limit.',
      action,
      rejected: true,
    })
    return { ok: false as const, status: 400, message: 'Prompt exceeds bridge limit.' }
  }

  const state = memory()
  const requestedNodeId = input.nodeId ? cleanId(input.nodeId) : null
  const targetNode = requestedNodeId ? liveNodes(state).find(node => node.node_id === requestedNodeId) : primaryNode(state)
  if (!targetNode || targetNode.status !== 'online' || targetNode.trust_level === 'observer' || targetNode.trust_level === 'restricted') {
    void persistBridgeAuditLog({
      nodeId: requestedNodeId,
      eventType: 'rejection',
      severity: 'warning',
      summary: 'Rejected bridge invocation because no trusted online node can accept it.',
      action,
      rejected: true,
    })
    return { ok: false as const, status: 409, message: 'No trusted online bridge node can accept this invocation.' }
  }

  if (state.queue.filter(item => item.status === 'pending').length >= MAX_QUEUE_DEPTH) {
    void persistBridgeAuditLog({
      nodeId: targetNode.node_id,
      eventType: 'rejection',
      severity: 'warning',
      summary: 'Rejected bridge invocation because queue is full.',
      action,
      rejected: true,
    })
    return { ok: false as const, status: 429, message: 'Bridge invocation queue is full.' }
  }

  const request: BridgeInvocationRequest = {
    id: newInvocationId(),
    nodeId: targetNode.node_id,
    action,
    provider,
    model: input.model?.trim().slice(0, 160) || null,
    prompt,
    createdAt: nowIso(),
    status: 'pending',
  }

  state.queue.push(request)
  addTimeline({
    nodeId: targetNode.node_id,
    nodeName: targetNode.node_name,
    eventType: 'invoke_request',
    severity: 'info',
    summary: `Queued ${action} for ${targetNode.node_name}.`,
  })
  void persistBridgeAuditLog({
    nodeId: targetNode.node_id,
    eventType: 'invoke_request',
    summary: `Queued ${action} for ${targetNode.node_name}.`,
    action,
    payload: {
      requestId: request.id,
      provider: request.provider,
      model: request.model,
      promptLength: request.prompt?.length ?? 0,
    },
  })
  return { ok: true as const, request }
}

export function claimNextBridgeInvocation(nodeId?: string | null) {
  const state = memory()
  const cleanNodeId = nodeId ? cleanId(nodeId) : null
  const request = state.queue.find(item => item.status === 'pending' && (!cleanNodeId || item.nodeId === cleanNodeId))
  if (!request) return null
  request.status = 'running'
  const node = request.nodeId ? state.nodes[request.nodeId] : null
  addTimeline({
    nodeId: request.nodeId ?? DEFAULT_NODE_ID,
    nodeName: node?.node_name ?? request.nodeId ?? 'Commander Node',
    eventType: 'node_action',
    severity: 'info',
    summary: `${node?.node_name ?? 'Bridge node'} claimed ${request.action}.`,
  })
  void persistBridgeAuditLog({
    nodeId: request.nodeId,
    eventType: 'node_action',
    summary: `${node?.node_name ?? 'Bridge node'} claimed ${request.action}.`,
    action: request.action,
    payload: { requestId: request.id },
  })
  return request
}

export function completeBridgeInvocation(result: BridgeInvocationResult) {
  const state = memory()
  const request = state.queue.find(item => item.id === result.id)
  if (request) request.status = result.error ? 'failed' : 'completed'
  const nodeId = result.nodeId ?? request?.nodeId ?? DEFAULT_NODE_ID
  const node = state.nodes[nodeId]
  state.results.unshift({
    ...result,
    nodeId,
    response: result.response?.slice(0, 8000) ?? null,
    error: result.error?.slice(0, 600) ?? null,
  })
  state.results = state.results.slice(0, 25)
  state.queue = state.queue.filter(item => item.status === 'pending' || item.status === 'running').slice(-MAX_QUEUE_DEPTH)
  addTimeline({
    nodeId,
    nodeName: node?.node_name ?? nodeId,
    eventType: result.error ? 'failure' : 'node_action',
    severity: result.error ? 'warning' : 'info',
    summary: `${node?.node_name ?? 'Bridge node'} ${result.error ? 'failed' : 'completed'} ${result.action}.`,
  })
  void persistBridgeAuditLog({
    nodeId,
    eventType: result.error ? 'failure' : 'node_action',
    severity: result.error ? 'warning' : 'info',
    summary: `${node?.node_name ?? 'Bridge node'} ${result.error ? 'failed' : 'completed'} ${result.action}.`,
    action: result.action,
    payload: {
      requestId: result.id,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      error: result.error,
    },
  })
  return state.results[0]
}

export function listBridgeResults() {
  return memory().results.slice(0, 10)
}

export function listBridgeNodes() {
  return {
    nodes: liveNodes(memory()),
    routingModel: BRIDGE_ROUTING_MODEL,
    statusTimeline: memory().timeline.slice(0, 40),
    staleTimeoutSeconds: STALE_TIMEOUT_SECONDS,
    generatedAt: nowIso(),
  }
}
