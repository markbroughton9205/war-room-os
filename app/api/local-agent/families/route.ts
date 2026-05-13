import { NextResponse } from 'next/server'
import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import type { LocalFamilyAgentsResponse, LocalOllamaModel } from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

type OllamaTagsResponse = {
  models?: Array<{
    name?: string
    details?: {
      family?: string
      parameter_size?: string
      quantization_level?: string
    }
  }>
}

async function getOllamaModels(): Promise<LocalOllamaModel[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1800)

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) return []

    const data = await response.json() as OllamaTagsResponse
    return (data.models ?? [])
      .filter(model => Boolean(model.name))
      .map(model => ({
        name: model.name ?? '',
        family: model.details?.family ?? null,
        parameterSize: model.details?.parameter_size ?? null,
        quantization: model.details?.quantization_level ?? null,
      }))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  const availableModels = await getOllamaModels()
  const installedModelNames = new Set(availableModels.map(model => model.name))
  const familyAgents = LOCAL_FAMILY_AGENTS.map(agent => {
    const modelInstalled = installedModelNames.has(agent.preferredModel)

    return {
      ...agent,
      status: modelInstalled ? 'available' as const : 'inactive' as const,
      modelInstalled,
    }
  })

  const body: LocalFamilyAgentsResponse = {
    ollamaDetected: availableModels.length > 0,
    availableModels,
    familyAgents,
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}
