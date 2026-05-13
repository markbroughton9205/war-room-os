import { NextResponse } from 'next/server'
import { LOCAL_AGENT_ENGINES } from '@/lib/local-agent/engines'
import type {
  LocalAgentBridgeStatus,
  LocalAgentBridgeStatusResponse,
  LocalAgentEngine,
  LocalAgentEngineId,
  LocalAgentStatusEntry,
} from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

async function probeEndpoint(endpoint: string, requireModels = false): Promise<'detected' | 'not_detected' | 'error'> {
  const controller = new AbortController()
  const timeout = windowlessTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (response.ok) {
      if (!requireModels) return 'detected'
      const data = await response.json() as { models?: unknown[] }
      return Array.isArray(data.models) && data.models.length > 0 ? 'detected' : 'not_detected'
    }
    if (response.status === 404) return 'not_detected'
    return 'error'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'not_detected'
    return 'not_detected'
  } finally {
    clearTimeout(timeout)
  }
}

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms)
}

function configuredEndpointFor(engine: LocalAgentEngine) {
  if (engine.id === 'openhands') return process.env.LOCAL_AGENT_OPENHANDS_URL?.trim() || null
  return engine.defaultEndpoint
}

async function detectEngine(engine: LocalAgentEngine): Promise<LocalAgentStatusEntry> {
  const endpoint = configuredEndpointFor(engine)

  if (!endpoint) {
    return {
      id: engine.id,
      name: engine.name,
      status: 'not_detected',
      endpoint: null,
      message: engine.configurable
        ? 'No local endpoint configured yet.'
        : 'No known local endpoint available.',
    }
  }

  const status = await probeEndpoint(endpoint, engine.id === 'ollama')

  return {
    id: engine.id,
    name: engine.name,
    status,
    endpoint,
    message: status === 'detected'
      ? `${engine.name} responded on its local endpoint.`
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
    const selectedEngine = detectedEngines.find(engine => engine.status === 'detected')?.id ?? null
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
