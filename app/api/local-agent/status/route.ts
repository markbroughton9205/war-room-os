import { NextResponse } from 'next/server'
import { LOCAL_AGENT_ENGINES } from '@/lib/local-agent/engines'
import { getLMStudioModels, getOllamaModels, testLMStudioChat } from '@/lib/local-agent/providers'
import type {
  LocalAgentBridgeStatus,
  LocalAgentBridgeStatusResponse,
  LocalAgentEngine,
  LocalAgentEngineId,
  LocalAgentStatusEntry,
} from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

async function probeEndpoint(endpoint: string, requireModels = false): Promise<LocalAgentStatusEntry['status']> {
  const controller = new AbortController()
  const timeout = windowlessTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.ok) {
      if (!requireModels) return 'reachable'
      const data = await response.json() as { models?: unknown[] }
      return Array.isArray(data.models) && data.models.length > 0 ? 'detected' : 'not_detected'
    }
    if (response.status === 404) return 'not_detected'
    return 'error'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'unreachable'
    return 'unreachable'
  } finally {
    clearTimeout(timeout)
  }
}

async function detectLMStudio(engine: LocalAgentEngine): Promise<LocalAgentStatusEntry> {
  const checkedAt = new Date().toISOString()
  const { baseUrl, models, error, failureKind, configured, configuredModel } = await getLMStudioModels()

  if (models.length === 0) {
    return {
      id: engine.id,
      name: engine.name,
      status: error ? 'unreachable' : 'not_detected',
      endpoint: `${baseUrl}/models`,
      message: error ?? 'LM Studio reachable, but no models were reported. Load a model in LM Studio.',
      modelsReachable: false,
      chatCompletionsReachable: false,
      functional: false,
      lastFunctionalTestAt: checkedAt,
      error,
      configured,
      configuredModel,
      modelUsed: configuredModel,
      latencyMs: null,
      failureKind: failureKind ?? 'model_not_loaded',
      handshakeState: failureKind === 'connection_refused' || failureKind === 'timeout' ? 'handshake_failed' : 'no_model_loaded',
      testResponsePreview: null,
    }
  }

  const functionalTest = await testLMStudioChat(baseUrl, configuredModel)

  return {
    id: engine.id,
    name: engine.name,
    status: functionalTest.functional ? 'detected' : 'reachable',
    endpoint: `${baseUrl}/models`,
    message: functionalTest.functional
      ? `LM Studio models and chat completions responded using ${functionalTest.modelUsed}.`
      : `LM Studio models reachable, but chat completion failed using ${functionalTest.modelUsed}.`,
    modelsReachable: true,
    chatCompletionsReachable: functionalTest.functional,
    functional: functionalTest.functional,
    lastFunctionalTestAt: checkedAt,
    error: functionalTest.error,
    configured,
    configuredModel,
    modelUsed: functionalTest.modelUsed,
    latencyMs: functionalTest.latencyMs,
    failureKind: functionalTest.failureKind,
    handshakeState: functionalTest.functional ? 'prompt_test_passed' : 'handshake_failed',
    testResponsePreview: functionalTest.text ? functionalTest.text.slice(0, 160) : null,
  }
}

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms)
}

function configuredEndpointFor(engine: LocalAgentEngine) {
  if (engine.id === 'openhands') return process.env.LOCAL_AGENT_OPENHANDS_URL?.trim() || null
  if (engine.id === 'aider') return process.env.LOCAL_AGENT_AIDER_PATH?.trim() || null
  if (engine.id === 'continue') return process.env.LOCAL_AGENT_CONTINUE_PATH?.trim() || null
  if (engine.id === 'goose') return process.env.LOCAL_AGENT_GOOSE_PATH?.trim() || null
  return engine.defaultEndpoint
}

async function detectEngine(engine: LocalAgentEngine): Promise<LocalAgentStatusEntry> {
  if (engine.id === 'lm_studio') return detectLMStudio(engine)

  const endpoint = configuredEndpointFor(engine)

  if (!endpoint) {
    return {
      id: engine.id,
      name: engine.name,
      status: engine.configurable ? 'config_needed' : 'not_detected',
      endpoint: null,
      message: engine.configurable
        ? 'No local endpoint configured yet.'
        : 'No known local endpoint available.',
    }
  }

  if (engine.id === 'ollama') {
    try {
      const models = await getOllamaModels()
      const detected = models.length > 0
      return {
        id: engine.id,
        name: engine.name,
        status: detected ? 'detected' : 'not_detected',
        endpoint,
        message: detected ? 'Ollama responded with installed models.' : 'Ollama models endpoint returned no models.',
        modelsReachable: detected,
        chatCompletionsReachable: detected,
        functional: detected,
        lastFunctionalTestAt: new Date().toISOString(),
        error: null,
      }
    } catch (error) {
      return {
        id: engine.id,
        name: engine.name,
        status: 'unreachable',
        endpoint,
        message: 'Ollama endpoint is not reachable.',
        modelsReachable: false,
        chatCompletionsReachable: false,
        functional: false,
        lastFunctionalTestAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Ollama check failed.',
      }
    }
  }

  const status = await probeEndpoint(endpoint)

  return {
    id: engine.id,
    name: engine.name,
    status,
    endpoint,
    message: status === 'detected'
      ? `${engine.name} responded with installed models.`
      : status === 'reachable'
        ? `${engine.name} endpoint is reachable.`
        : status === 'unreachable'
          ? `${engine.name} endpoint is not reachable.`
      : status === 'error'
        ? `${engine.name} endpoint responded with an error.`
        : `${engine.name} not detected on its local endpoint.`,
  }
}

export async function GET() {
  try {
    const detectedEngines = await Promise.all(LOCAL_AGENT_ENGINES.map(detectEngine))
    const engines = detectedEngines.reduce((acc, engine) => {
      acc[engine.id] = engine
      return acc
    }, {} as Record<LocalAgentEngineId, LocalAgentStatusEntry>)
    const selectedEngine = detectedEngines.find(engine => engine.functional || engine.status === 'detected' || engine.status === 'reachable')?.id ?? null
    const bridge: LocalAgentBridgeStatus = selectedEngine ? 'online' : 'config_needed'

    const body: LocalAgentBridgeStatusResponse = {
      bridge,
      engines,
      selectedEngine,
      repoAccessStatus: 'read-only status bridge; write access not granted',
      lastTask: null,
      qaStatus: 'idle',
      rollbackCheckpointStatus: 'not created',
      checkedAt: new Date().toISOString(),
    }

    return NextResponse.json(body)
  } catch (error) {
    const engines = LOCAL_AGENT_ENGINES.reduce((acc, engine) => {
      acc[engine.id] = {
        id: engine.id,
        name: engine.name,
        status: 'error',
        endpoint: configuredEndpointFor(engine),
        message: error instanceof Error ? error.message : 'Local agent detection failed.',
      }
      return acc
    }, {} as Record<LocalAgentEngineId, LocalAgentStatusEntry>)

    return NextResponse.json(
      {
        bridge: 'error',
        engines,
        selectedEngine: null,
        repoAccessStatus: 'read-only status bridge; write access not granted',
        lastTask: null,
        qaStatus: 'error',
        rollbackCheckpointStatus: 'not created',
        checkedAt: new Date().toISOString(),
      } satisfies LocalAgentBridgeStatusResponse,
      { status: 500 },
    )
  }
}
