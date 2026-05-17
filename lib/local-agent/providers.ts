import { localFamilyAgentSystemPrompt, LOCAL_FAMILY_AGENTS } from './family-agents'
import type { LocalFamilyAgent, LocalLMStudioModel, LocalModelProvider, LocalOllamaModel, LocalProviderHandshakeState } from './types'

const OLLAMA_BASE_URL = 'http://localhost:11434'
const DEFAULT_LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
const DEFAULT_LM_STUDIO_MODEL = 'google/gemma-4-e4b'
const LM_STUDIO_FALLBACK_BASE_URLS = [DEFAULT_LM_STUDIO_BASE_URL, 'http://localhost:1234/v1']

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

export type LMStudioFailureKind =
  | 'connection_refused'
  | 'model_not_loaded'
  | 'invalid_model_id'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'unknown'

export type LMStudioProbeResult = {
  baseUrl: string
  models: LocalLMStudioModel[]
  error: string | null
  failureKind: LMStudioFailureKind | null
  configured: boolean
  configuredModel: string
  modelFromEnv: boolean
  apiKeyConfigured: boolean
  handshakeState: LocalProviderHandshakeState
}

export type LMStudioChatResult = {
  functional: boolean
  text: string
  error: string | null
  failureKind: LMStudioFailureKind | null
  latencyMs: number
  modelUsed: string
  raw: LMStudioChatResponse | null
}

type OllamaGenerateResponse = {
  model?: string
  response?: string
  done?: boolean
}

function normalizeLMStudioBaseUrl(value: string | undefined) {
  const raw = value?.trim() || DEFAULT_LM_STUDIO_BASE_URL
  const withoutTrailingSlash = raw.replace(/\/+$/, '')
  return withoutTrailingSlash.endsWith('/v1') ? withoutTrailingSlash : `${withoutTrailingSlash}/v1`
}

export function getLMStudioConfig() {
  const envBaseUrl = process.env.LM_STUDIO_BASE_URL?.trim()
  const envModel = process.env.LM_STUDIO_MODEL?.trim()
  return {
    baseUrl: normalizeLMStudioBaseUrl(envBaseUrl),
    model: envModel || DEFAULT_LM_STUDIO_MODEL,
    modelFromEnv: Boolean(envModel),
    apiKey: process.env.LM_STUDIO_API_KEY?.trim() || null,
    configured: Boolean(envBaseUrl || envModel || process.env.LM_STUDIO_API_KEY?.trim()),
  }
}

export function resolveLMStudioModel(models: LocalLMStudioModel[], requestedModel?: string | null) {
  const config = getLMStudioConfig()
  const envOrRequested = requestedModel?.trim() || (config.modelFromEnv ? config.model : '')
  return envOrRequested || models[0]?.id || config.model
}

function lmStudioHeaders(apiKey?: string | null) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

function classifyLMStudioFailure(error: unknown, responseStatus?: number, responseMessage = ''): LMStudioFailureKind {
  const text = [
    error instanceof Error ? error.message : '',
    responseMessage,
    responseStatus ? `HTTP ${responseStatus}` : '',
  ].join(' ').toLowerCase()

  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (/\b(econnrefused|connection refused|fetch failed|failed to fetch)\b/i.test(text)) return 'connection_refused'
  if (/\b(model.*not.*loaded|no.*model.*loaded|load a model|model_not_loaded)\b/i.test(text)) return 'model_not_loaded'
  if (/\b(invalid.*model|model.*not.*found|unknown model|not found)\b/i.test(text)) return 'invalid_model_id'
  if (responseStatus) return 'http_error'
  return 'unknown'
}

function messageForLMStudioFailure(kind: LMStudioFailureKind, detail: string) {
  if (kind === 'connection_refused') return 'LM Studio connection refused. Start the local server at http://127.0.0.1:1234/v1.'
  if (kind === 'model_not_loaded') return 'LM Studio is reachable, but no chat model appears loaded.'
  if (kind === 'invalid_model_id') return 'LM Studio rejected the requested model id. Check LM_STUDIO_MODEL or load that model in LM Studio.'
  if (kind === 'timeout') return 'LM Studio request timed out.'
  if (kind === 'invalid_response') return 'LM Studio returned an unexpected chat response.'
  return detail || 'LM Studio request failed.'
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

export async function getLMStudioModels(): Promise<LMStudioProbeResult> {
  const config = getLMStudioConfig()
  const errors: string[] = []
  let lastFailureKind: LMStudioFailureKind | null = null

  const baseUrls = [
    config.baseUrl,
    ...LM_STUDIO_FALLBACK_BASE_URLS.filter(baseUrl => baseUrl !== config.baseUrl),
  ]

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: lmStudioHeaders(config.apiKey),
        signal: AbortSignal.timeout(1800),
        cache: 'no-store',
      })
      if (!response.ok) {
        const message = await response.text().catch(() => '')
        lastFailureKind = classifyLMStudioFailure(null, response.status, message)
        errors.push(messageForLMStudioFailure(lastFailureKind, `${baseUrl} returned HTTP ${response.status}`))
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

      return {
        baseUrl,
        models,
        error: null,
        failureKind: null,
        configured: config.configured,
        configuredModel: resolveLMStudioModel(models),
        modelFromEnv: config.modelFromEnv,
        apiKeyConfigured: Boolean(config.apiKey),
        handshakeState: models.length > 0 ? 'model_loaded' : 'no_model_loaded',
      }
    } catch (error) {
      lastFailureKind = classifyLMStudioFailure(error)
      errors.push(messageForLMStudioFailure(lastFailureKind, error instanceof Error ? error.message : 'unreachable'))
    }
  }

  return {
    baseUrl: config.baseUrl,
    models: [] as LocalLMStudioModel[],
    error: errors.join(' | ') || 'LM Studio unreachable',
    failureKind: lastFailureKind ?? 'unknown',
    configured: config.configured,
    configuredModel: config.model,
    modelFromEnv: config.modelFromEnv,
    apiKeyConfigured: Boolean(config.apiKey),
    handshakeState: lastFailureKind === 'connection_refused' || lastFailureKind === 'timeout' ? 'awaiting_connection' : 'no_model_loaded',
  }
}

export async function testLMStudioChat(baseUrl: string, model: string): Promise<LMStudioChatResult> {
  const startedAt = Date.now()
  const config = getLMStudioConfig()
  const modelUsed = model?.trim() || config.model
  try {
    const response = await fetch(`${normalizeLMStudioBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: lmStudioHeaders(config.apiKey),
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: modelUsed,
        messages: [
          { role: 'system', content: 'You are a local War Room health check. Reply with exactly: ready' },
          { role: 'user', content: 'Health check.' },
        ],
        temperature: 0.3,
        stream: false,
      }),
    })
    const data = await response.json().catch(() => null) as LMStudioChatResponse | null
    const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
    const latencyMs = Date.now() - startedAt

    if (!response.ok || !text) {
      const failureKind = !text && response.ok
        ? 'invalid_response'
        : classifyLMStudioFailure(null, response.status, data?.error?.message ?? '')
      return {
        functional: false,
        text,
        error: messageForLMStudioFailure(failureKind, data?.error?.message || `HTTP ${response.status}`),
        failureKind,
        latencyMs,
        modelUsed,
        raw: data,
      }
    }

    return { functional: true, text, error: null, failureKind: null, latencyMs, modelUsed, raw: data }
  } catch (error) {
    const failureKind = classifyLMStudioFailure(error)
    return {
      functional: false,
      text: '',
      error: messageForLMStudioFailure(failureKind, error instanceof Error ? error.message : 'LM Studio chat completion failed'),
      failureKind,
      latencyMs: Date.now() - startedAt,
      modelUsed,
      raw: null,
    }
  }
}

export async function invokeLMStudioPrompt(input: {
  prompt: string
  system?: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<LMStudioChatResult> {
  const startedAt = Date.now()
  const config = getLMStudioConfig()
  const modelUsed = input.model?.trim() || config.model
  const baseUrl = normalizeLMStudioBaseUrl(input.baseUrl ?? config.baseUrl)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: lmStudioHeaders(config.apiKey),
      signal: AbortSignal.timeout(input.timeoutMs ?? 60000),
      body: JSON.stringify({
        model: modelUsed,
        messages: [
          { role: 'system', content: input.system ?? 'You are a local War Room model test. Answer directly and briefly.' },
          { role: 'user', content: input.prompt },
        ],
        temperature: 0.3,
        stream: false,
      }),
    })
    const data = await response.json().catch(() => null) as LMStudioChatResponse | null
    const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
    const latencyMs = Date.now() - startedAt

    if (!response.ok || !text) {
      const failureKind = !text && response.ok
        ? 'invalid_response'
        : classifyLMStudioFailure(null, response.status, data?.error?.message ?? '')
      return {
        functional: false,
        text,
        error: messageForLMStudioFailure(failureKind, data?.error?.message || `HTTP ${response.status}`),
        failureKind,
        latencyMs,
        modelUsed,
        raw: data,
      }
    }

    return { functional: true, text, error: null, failureKind: null, latencyMs, modelUsed, raw: data }
  } catch (error) {
    const failureKind = classifyLMStudioFailure(error)
    return {
      functional: false,
      text: '',
      error: messageForLMStudioFailure(failureKind, error instanceof Error ? error.message : 'LM Studio chat completion failed'),
      failureKind,
      latencyMs: Date.now() - startedAt,
      modelUsed,
      raw: null,
    }
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

export async function invokeLMStudio(agent: LocalFamilyAgent, prompt: string, model: string, baseUrl = DEFAULT_LM_STUDIO_BASE_URL) {
  const result = await invokeLMStudioPrompt({
    prompt,
    system: localFamilyAgentSystemPrompt(agent),
    model,
    baseUrl,
    timeoutMs: 60000,
  })
  if (!result.functional || !result.text) throw new Error(result.error || 'LM Studio invocation failed.')
  return { response: result.text, model: result.modelUsed, provider: 'lm_studio' as LocalModelProvider, label: 'Local LM Studio response' }
}

export function chooseFamilyProvider(input: {
  ollamaModels: LocalOllamaModel[]
  lmStudioModels: LocalLMStudioModel[]
  lmStudioFunctional: boolean
  lmStudioModel?: string | null
}) {
  if (input.lmStudioFunctional) {
    return {
      provider: 'lm_studio' as LocalModelProvider,
      model: resolveLMStudioModel(input.lmStudioModels, input.lmStudioModel),
      detected: true,
      functional: true,
    }
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
