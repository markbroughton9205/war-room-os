import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import { LOCAL_AGENT_ENGINES } from '@/lib/local-agent/engines'
import type { BridgeProviderId, BridgeStatusResponse } from '@/lib/bridge/types'
import type {
  LocalAgentBridgeStatusResponse,
  LocalAgentEngineId,
  LocalFamilyAgentsResponse,
  LocalLMStudioModel,
  LocalModelProvider,
  LocalOllamaModel,
  LocalProviderAvailability,
} from '@/lib/local-agent/types'

export type EffectiveBridgeRuntimeDebug = {
  heartbeatAgeMs: number | null
  providerSource: 'bridge-status' | 'none'
  selectorResult: 'active' | 'stale' | 'inactive'
  stale: boolean
  activeModel: string | null
  activeProvider: BridgeProviderId | null
  effectiveEngineCount: number
  reason: string
}

export type EffectiveBridgeRuntimeState = {
  localBridge: LocalAgentBridgeStatusResponse
  localFamilies: LocalFamilyAgentsResponse
  debug: EffectiveBridgeRuntimeDebug
}

function modelLabel(model: string) {
  return model.trim().slice(0, 160)
}

function emptyBridgeStatus(checkedAt: string): LocalAgentBridgeStatusResponse {
  return {
    bridge: 'config_needed',
    bridgeState: 'awaiting_connection',
    engines: LOCAL_AGENT_ENGINES.reduce((acc, engine) => {
      acc[engine.id] = {
        id: engine.id,
        name: engine.name,
        status: engine.configurable ? 'config_needed' : 'not_detected',
        endpoint: engine.defaultEndpoint,
        message: 'No fresh bridge heartbeat has validated this local engine.',
        modelsReachable: false,
        chatCompletionsReachable: false,
        functional: false,
        lastFunctionalTestAt: null,
        lastSuccessfulHandshakeAt: null,
        error: null,
        handshakeState: 'awaiting_connection',
        latencyMs: null,
        modelUsed: null,
        configuredModel: null,
      }
      return acc
    }, {} as Record<LocalAgentEngineId, LocalAgentBridgeStatusResponse['engines'][LocalAgentEngineId]>),
    selectedEngine: null,
    selectedEngineLabel: null,
    selectedModel: null,
    repoAccessStatus: 'read-only status bridge; write access not granted',
    lastTask: null,
    qaStatus: 'idle',
    rollbackCheckpointStatus: 'not created',
    checkedAt,
    lastSuccessfulHandshakeAt: null,
  }
}

function emptyFamilies(checkedAt: string): LocalFamilyAgentsResponse {
  return {
    ollamaDetected: false,
    lmStudioDetected: false,
    availableModels: [],
    lmStudioModels: [],
    providers: {
      ollama: { provider: 'ollama', detected: false, reachable: false, functional: false, models: [], error: null, handshakeState: 'awaiting_connection' },
      lmStudio: { provider: 'lm_studio', detected: false, reachable: false, functional: false, models: [], error: null, handshakeState: 'awaiting_connection' },
    },
    preferredProvider: null,
    preferredModel: null,
    familyAgents: LOCAL_FAMILY_AGENTS.map(agent => ({
      ...agent,
      status: 'inactive',
      modelInstalled: false,
      provider: 'ollama',
      model: agent.preferredModel,
      detected: false,
      functional: false,
    })),
    checkedAt,
  }
}

function providerAvailability(input: {
  provider: LocalModelProvider
  model: string
  latencyMs: number | null
  models: Array<LocalOllamaModel | LocalLMStudioModel>
}): LocalProviderAvailability {
  return {
    provider: input.provider,
    detected: true,
    reachable: true,
    functional: true,
    models: input.models,
    error: null,
    configured: true,
    configuredModel: input.model,
    failureKind: null,
    handshakeState: 'prompt_verified',
    latencyMs: input.latencyMs,
    modelUsed: input.model,
    testResponsePreview: 'Bridge heartbeat validated provider runtime.',
  }
}

export function getEffectiveBridgeRuntimeState(status: BridgeStatusResponse): EffectiveBridgeRuntimeState {
  const now = Date.now()
  const lastHeartbeatMs = status.node.lastHeartbeat ? Date.parse(status.node.lastHeartbeat) : NaN
  const heartbeatAgeMs = Number.isFinite(lastHeartbeatMs) ? now - lastHeartbeatMs : null
  const staleByAge = heartbeatAgeMs === null || heartbeatAgeMs > status.staleTimeoutSeconds * 1000
  const activeProvider = status.node.activeProvider ?? status.runtime?.activeProvider ?? null
  const activeModel = status.node.activeModel ?? status.runtime?.activeModel ?? null
  const providerStatus = activeProvider ? status.providers.find(provider => provider.provider === activeProvider) : null
  const model = activeModel ? modelLabel(activeModel) : null
  const checkedAt = status.node.lastHeartbeat ?? status.updatedAt
  const active = Boolean(!status.stale && !staleByAge && status.node.online && activeProvider && model && providerStatus?.functional)

  if (!active || !activeProvider || !model) {
    const reason = status.stale || staleByAge
      ? 'bridge heartbeat is stale or missing'
      : !status.node.online
        ? 'bridge node is offline'
        : !activeProvider
          ? 'bridge provider is missing'
          : !model
            ? 'bridge model is missing'
            : 'bridge provider is not functional'

    return {
      localBridge: emptyBridgeStatus(checkedAt),
      localFamilies: emptyFamilies(checkedAt),
      debug: {
        heartbeatAgeMs,
        providerSource: 'none',
        selectorResult: staleByAge || status.stale ? 'stale' : 'inactive',
        stale: status.stale || staleByAge,
        activeModel: model,
        activeProvider,
        effectiveEngineCount: 0,
        reason,
      },
    }
  }

  const latencyMs = providerStatus?.latencyMs ?? status.node.latencyMs ?? status.runtime?.heartbeatLatencyMs ?? null
  const localBridge = emptyBridgeStatus(checkedAt)
  const engine = localBridge.engines[activeProvider]
  localBridge.bridge = 'online'
  localBridge.bridgeState = 'prompt_verified'
  localBridge.selectedEngine = activeProvider
  localBridge.selectedEngineLabel = activeProvider === 'lm_studio' ? 'LM Studio' : 'Ollama'
  localBridge.selectedModel = model
  localBridge.checkedAt = checkedAt
  localBridge.lastSuccessfulHandshakeAt = checkedAt
  localBridge.engines[activeProvider] = {
    ...engine,
    status: 'detected',
    message: `Bridge heartbeat validated ${activeProvider === 'lm_studio' ? 'LM Studio' : 'Ollama'} with active model ${model}.`,
    modelsReachable: true,
    chatCompletionsReachable: true,
    functional: true,
    lastFunctionalTestAt: checkedAt,
    lastSuccessfulHandshakeAt: checkedAt,
    error: null,
    configured: true,
    configuredModel: model,
    modelUsed: model,
    latencyMs,
    failureKind: null,
    handshakeState: 'prompt_verified',
    testResponsePreview: 'Bridge heartbeat validated provider runtime.',
  }

  const families = emptyFamilies(checkedAt)
  const lmStudioModel: LocalLMStudioModel = { id: model, object: 'model', ownedBy: 'bridge-runtime' }
  const ollamaModel: LocalOllamaModel = { name: model, family: null, parameterSize: null, quantization: null }
  families.preferredProvider = activeProvider
  families.preferredModel = model
  families.ollamaDetected = activeProvider === 'ollama'
  families.lmStudioDetected = activeProvider === 'lm_studio'
  families.availableModels = activeProvider === 'ollama' ? [ollamaModel] : []
  families.lmStudioModels = activeProvider === 'lm_studio' ? [lmStudioModel] : []
  families.providers = {
    ollama: activeProvider === 'ollama'
      ? providerAvailability({ provider: 'ollama', model, latencyMs, models: [ollamaModel] })
      : families.providers.ollama,
    lmStudio: activeProvider === 'lm_studio'
      ? providerAvailability({ provider: 'lm_studio', model, latencyMs, models: [lmStudioModel] })
      : families.providers.lmStudio,
  }
  families.familyAgents = families.familyAgents.map(agent => ({
    ...agent,
    status: 'active',
    modelInstalled: true,
    provider: activeProvider,
    model,
    detected: true,
    functional: true,
  }))

  return {
    localBridge,
    localFamilies: families,
    debug: {
      heartbeatAgeMs,
      providerSource: 'bridge-status',
      selectorResult: 'active',
      stale: false,
      activeModel: model,
      activeProvider,
      effectiveEngineCount: 1,
      reason: 'fresh bridge heartbeat validated functional provider and model',
    },
  }
}
