import { bridgeTokenConfigured } from './auth'
import type {
  BridgeAllowedAction,
  BridgeHeartbeatRequest,
  BridgeInvocationRequest,
  BridgeInvocationResult,
  BridgeMode,
  BridgeProviderId,
  BridgeProviderStatus,
  BridgeStatusResponse,
} from './types'

const HEARTBEAT_INTERVAL_SECONDS = 20
const STALE_TIMEOUT_SECONDS = 50
const MAX_QUEUE_DEPTH = 20
const MAX_PROMPT_LENGTH = 4000

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
const ALLOWED_ACTIONS: BridgeAllowedAction[] = ['model_list', 'prompt_test', 'local_inference', 'diagnostics', 'health_check']
const PROVIDERS: BridgeProviderId[] = ['lm_studio', 'ollama']

type BridgeMemory = {
  authenticated: boolean
  lastHeartbeatAt: number | null
  activeProvider: BridgeProviderId | null
  activeModel: string | null
  latencyMs: number | null
  providers: BridgeProviderStatus[]
  capabilities: BridgeAllowedAction[]
  queue: BridgeInvocationRequest[]
  results: BridgeInvocationResult[]
}

declare global {
  var warRoomBridgeMemory: BridgeMemory | undefined
}

function memory(): BridgeMemory {
  globalThis.warRoomBridgeMemory ??= {
    authenticated: false,
    lastHeartbeatAt: null,
    activeProvider: null,
    activeModel: null,
    latencyMs: null,
    providers: [],
    capabilities: ALLOWED_ACTIONS,
    queue: [],
    results: [],
  }
  return globalThis.warRoomBridgeMemory
}

function nowIso() {
  return new Date().toISOString()
}

function stale(lastHeartbeatAt: number | null) {
  if (!lastHeartbeatAt) return true
  return Date.now() - lastHeartbeatAt > STALE_TIMEOUT_SECONDS * 1000
}

function modeFor(state: BridgeMemory): BridgeMode {
  if (!bridgeTokenConfigured()) return 'DISCONNECTED'
  if (!state.lastHeartbeatAt) return 'CONNECTING'
  if (stale(state.lastHeartbeatAt)) return 'DISCONNECTED'
  if (state.activeProvider && state.activeModel) return 'LOCAL AI ACTIVE'
  return state.authenticated ? 'AUTHENTICATED' : 'CONNECTING'
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

export function getBridgeStatus(): BridgeStatusResponse {
  const state = memory()
  const isStale = stale(state.lastHeartbeatAt)
  const activeProvider = isStale ? null : state.activeProvider
  const activeModel = isStale ? null : state.activeModel

  return {
    mode: modeFor(state),
    authenticated: state.authenticated && !isStale,
    stale: isStale,
    tokenConfigured: bridgeTokenConfigured(),
    node: {
      name: 'Commander Node',
      online: Boolean(state.lastHeartbeatAt) && !isStale,
      lastHeartbeat: state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).toISOString() : null,
      activeProvider,
      activeModel,
      latencyMs: isStale ? null : state.latencyMs,
    },
    providers: isStale ? [] : state.providers,
    capabilities: state.capabilities,
    heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    staleTimeoutSeconds: STALE_TIMEOUT_SECONDS,
    pendingInvocations: state.queue.filter(item => item.status === 'pending').length,
    updatedAt: nowIso(),
    securityBoundaries: BRIDGE_SECURITY_BOUNDARIES,
    futureConnectors: FUTURE_CONNECTORS,
  }
}

export function recordBridgeHeartbeat(input: BridgeHeartbeatRequest) {
  const state = memory()
  const providers = (input.providers ?? [])
    .filter(provider => PROVIDERS.includes(provider.provider))
    .map(cleanProvider)
  const activeProvider = input.activeProvider && PROVIDERS.includes(input.activeProvider) ? input.activeProvider : null
  const activeModel = input.activeModel?.slice(0, 160) ?? null

  state.authenticated = true
  state.lastHeartbeatAt = Date.now()
  state.providers = providers
  state.capabilities = (input.capabilities ?? ALLOWED_ACTIONS).filter(action => ALLOWED_ACTIONS.includes(action))
  state.activeProvider = activeProvider
  state.activeModel = activeProvider ? activeModel : null
  state.latencyMs = typeof input.latencyMs === 'number' ? input.latencyMs : null

  return getBridgeStatus()
}

function newInvocationId() {
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function enqueueBridgeInvocation(input: {
  action?: string
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
    return { ok: false as const, status: 400, message: 'Unsupported bridge action.' }
  }

  const provider = input.provider ? input.provider as BridgeProviderId : null
  if (provider && !PROVIDERS.includes(provider)) {
    return { ok: false as const, status: 400, message: 'Unsupported local provider.' }
  }

  const prompt = input.prompt?.trim() ?? null
  if ((action === 'prompt_test' || action === 'local_inference') && !prompt) {
    return { ok: false as const, status: 400, message: 'Prompt is required for this bridge action.' }
  }
  if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false as const, status: 400, message: 'Prompt exceeds bridge limit.' }
  }

  const state = memory()
  if (state.queue.filter(item => item.status === 'pending').length >= MAX_QUEUE_DEPTH) {
    return { ok: false as const, status: 429, message: 'Bridge invocation queue is full.' }
  }

  const request: BridgeInvocationRequest = {
    id: newInvocationId(),
    action,
    provider,
    model: input.model?.trim().slice(0, 160) || null,
    prompt,
    createdAt: nowIso(),
    status: 'pending',
  }

  state.queue.push(request)
  return { ok: true as const, request }
}

export function claimNextBridgeInvocation() {
  const state = memory()
  const request = state.queue.find(item => item.status === 'pending')
  if (!request) return null
  request.status = 'running'
  return request
}

export function completeBridgeInvocation(result: BridgeInvocationResult) {
  const state = memory()
  const request = state.queue.find(item => item.id === result.id)
  if (request) request.status = result.error ? 'failed' : 'completed'
  state.results.unshift({
    ...result,
    response: result.response?.slice(0, 8000) ?? null,
    error: result.error?.slice(0, 600) ?? null,
  })
  state.results = state.results.slice(0, 25)
  state.queue = state.queue.filter(item => item.status === 'pending' || item.status === 'running').slice(-MAX_QUEUE_DEPTH)
  return state.results[0]
}

export function listBridgeResults() {
  return memory().results.slice(0, 10)
}
