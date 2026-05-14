import { localFamilyAgentSystemPrompt, LOCAL_FAMILY_AGENTS } from './family-agents'
import type { LocalFamilyAgent, LocalLMStudioModel, LocalModelProvider, LocalOllamaModel } from './types'

const OLLAMA_BASE_URL = 'http://localhost:11434'
const LM_STUDIO_BASE_URLS = ['http://127.0.0.1:1234', 'http://localhost:1234']

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

type LMStudioModelsResponse = {
  data?: Array<{
    id?: string
    object?: string
    owned_by?: string
  }>
}

type LMStudioChatResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: { message?: string }
}

type OllamaGenerateResponse = {
  model?: string
  response?: string
  done?: boolean
}

export async function getOllamaModels(): Promise<LocalOllamaModel[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(1800),
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
}

export async function getLMStudioModels() {
  const errors: string[] = []

  for (const baseUrl of LM_STUDIO_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(1800),
        cache: 'no-store',
      })
      if (!response.ok) {
        errors.push(`${baseUrl} returned HTTP ${response.status}`)
        continue
      }
      const data = await response.json() as LMStudioModelsResponse
      const models = (data.data ?? [])
        .filter(model => Boolean(model.id))
        .map(model => ({
          id: model.id ?? '',
          object: model.object ?? null,
          ownedBy: model.owned_by ?? null,
        }))

      return { baseUrl, models, error: null }
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : 'unreachable'}`)
    }
  }

  return { baseUrl: LM_STUDIO_BASE_URLS[0], models: [] as LocalLMStudioModel[], error: errors.join(' | ') || 'LM Studio unreachable' }
}

export async function testLMStudioChat(baseUrl: string, model: string) {
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a local War Room health check. Reply with exactly: ready' },
          { role: 'user', content: 'Health check.' },
        ],
        temperature: 0.3,
        stream: false,
      }),
    })
    const data = await response.json() as LMStudioChatResponse
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''

    if (!response.ok || !text) {
      return { functional: false, text, error: data.error?.message || `HTTP ${response.status}` }
    }

    return { functional: true, text, error: null }
  } catch (error) {
    return { functional: false, text: '', error: error instanceof Error ? error.message : 'LM Studio chat completion failed' }
  }
}

export async function invokeOllama(agent: LocalFamilyAgent, prompt: string) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: agent.preferredModel,
      prompt,
      system: localFamilyAgentSystemPrompt(agent),
      stream: false,
    }),
  })
  const data = await response.json() as OllamaGenerateResponse
  if (!response.ok) throw new Error(`Ollama invocation failed: ${JSON.stringify(data)}`)
  return { response: data.response ?? '', model: data.model ?? agent.preferredModel, provider: 'ollama' as LocalModelProvider, label: 'Local Ollama response' }
}

export async function invokeLMStudio(agent: LocalFamilyAgent, prompt: string, model: string, baseUrl = LM_STUDIO_BASE_URLS[0]) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: localFamilyAgentSystemPrompt(agent) },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      stream: false,
    }),
  })
  const data = await response.json() as LMStudioChatResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!response.ok || !text) throw new Error(data.error?.message || `LM Studio invocation failed with HTTP ${response.status}`)
  return { response: text, model, provider: 'lm_studio' as LocalModelProvider, label: 'Local LM Studio response' }
}

export function chooseFamilyProvider(input: {
  ollamaModels: LocalOllamaModel[]
  lmStudioModels: LocalLMStudioModel[]
  lmStudioFunctional: boolean
}) {
  const lmStudioModel = input.lmStudioModels[0]?.id ?? null
  if (input.lmStudioFunctional && lmStudioModel) {
    return { provider: 'lm_studio' as LocalModelProvider, model: lmStudioModel, detected: true, functional: true }
  }

  const defaultAgent = LOCAL_FAMILY_AGENTS[0]
  const ollamaModelInstalled = input.ollamaModels.some(model => model.name === defaultAgent.preferredModel)
  return {
    provider: 'ollama' as LocalModelProvider,
    model: defaultAgent.preferredModel,
    detected: ollamaModelInstalled,
    functional: ollamaModelInstalled,
  }
}
