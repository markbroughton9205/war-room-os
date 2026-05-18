import 'server-only'

export type ProviderRuntimeHealth =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'MISSING_KEY'
  | 'RATE_LIMITED'
  | 'INVALID_KEY'

export type ProviderRuntimeId = 'openai' | 'anthropic' | 'google' | 'xai' | 'tavily' | 'firecrawl'

export type ProviderRuntimeStatus = {
  id: ProviderRuntimeId
  provider: string
  family: string
  optional: boolean
  configured: boolean
  health: ProviderRuntimeHealth
  latencyMs: number | null
  checkedAt: string
  lastSuccessAt: string | null
  quotaState: 'ok' | 'rate_limited' | 'unknown'
  rateLimitResetAt: string | null
  activeModels: string[]
  signalAvailability: boolean
  note: string
}

export type ProviderRuntimeSummary = {
  generatedAt: string
  cacheTtlMs: number
  providers: ProviderRuntimeStatus[]
  families: Record<string, ProviderRuntimeHealth>
  signalAvailability: {
    tavily: boolean
    firecrawl: boolean
    liveSignalsAvailable: boolean
    note: string
  }
  guardrails: {
    serverSideOnly: true
    apiKeysSerialized: false
    timeoutProtected: true
    providerFailureIsolation: true
    autonomousExecution: false
  }
}

type ProviderDefinition = {
  id: ProviderRuntimeId
  provider: string
  family: string
  optional?: boolean
  envNames: string[]
  signalProvider?: true
  probe: (apiKey: string) => Promise<ProbeResult>
}

type ProbeResult = {
  activeModels?: string[]
  note?: string
}

type CachedSummary = {
  expiresAt: number
  summary: ProviderRuntimeSummary
}

const PROVIDER_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 5 * 60 * 1000

let cachedSummary: CachedSummary | null = null
const lastSuccessByProvider: Partial<Record<ProviderRuntimeId, string>> = {}

function envValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

function classifyError(error: unknown): { health: ProviderRuntimeHealth; note: string } {
  if (error instanceof ProviderHttpError) {
    if (/invalid|api key not valid|incorrect api key|authentication/i.test(error.message)) {
      return { health: 'INVALID_KEY', note: `Provider rejected credentials with HTTP ${error.status}.` }
    }
    if (/rate limit|quota|too many requests/i.test(error.message)) {
      return { health: 'RATE_LIMITED', note: `Provider rate or quota limit reported with HTTP ${error.status}.` }
    }
    if (error.status === 401 || error.status === 403) return { health: 'INVALID_KEY', note: `Provider rejected credentials with HTTP ${error.status}.` }
    if (error.status === 429) return { health: 'RATE_LIMITED', note: 'Provider returned HTTP 429 rate limit.' }
    return { health: 'DEGRADED', note: `Provider returned HTTP ${error.status}.` }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|aborted|abort/i.test(message)) return { health: 'DEGRADED', note: 'Provider health check timed out.' }
  return { health: 'DEGRADED', note: message || 'Provider health check failed.' }
}

function compactModels(models: string[]): string[] {
  return [...new Set(models.map(model => model.trim()).filter(Boolean))].slice(0, 8)
}

function rateLimitReset(headers: Headers): string | null {
  const reset = headers.get('x-ratelimit-reset') ?? headers.get('x-rate-limit-reset') ?? headers.get('retry-after')
  if (!reset) return null
  const seconds = Number(reset)
  if (Number.isFinite(seconds) && seconds > 0 && seconds < 60 * 60 * 24) {
    return new Date(Date.now() + seconds * 1000).toISOString()
  }
  const date = new Date(reset)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<{ data: T; headers: Headers }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const body = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    const errorMessage = typeof body.error === 'string'
      ? body.error
      : typeof (body.error as { message?: unknown } | undefined)?.message === 'string'
        ? String((body.error as { message?: unknown }).message)
        : response.statusText
    throw new ProviderHttpError(response.status, errorMessage, rateLimitReset(response.headers))
  }

  return { data: data as T, headers: response.headers }
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly resetAt: string | null,
  ) {
    super(message)
  }
}

async function probeOpenAi(apiKey: string): Promise<ProbeResult> {
  type OpenAiModels = { data?: Array<{ id?: string }> }
  const { data } = await jsonFetch<OpenAiModels>('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })
  return {
    activeModels: compactModels((data.data ?? []).map(model => model.id ?? '').filter(model => /gpt|o[0-9]/i.test(model))),
    note: 'OpenAI models endpoint responded.',
  }
}

async function probeAnthropic(apiKey: string): Promise<ProbeResult> {
  type AnthropicModels = { data?: Array<{ id?: string }> }
  const { data } = await jsonFetch<AnthropicModels>('https://api.anthropic.com/v1/models?limit=20', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    },
  })
  return {
    activeModels: compactModels((data.data ?? []).map(model => model.id ?? '').filter(model => /claude/i.test(model))),
    note: 'Anthropic models endpoint responded.',
  }
}

async function probeGoogle(apiKey: string): Promise<ProbeResult> {
  type GeminiModels = { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
  const { data } = await jsonFetch<GeminiModels>(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
    headers: { Accept: 'application/json' },
  })
  return {
    activeModels: compactModels((data.models ?? [])
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => model.name?.replace(/^models\//, '') ?? '')),
    note: 'Google Gemini models endpoint responded.',
  }
}

async function probeXai(apiKey: string): Promise<ProbeResult> {
  type XaiModels = { data?: Array<{ id?: string }> }
  const { data } = await jsonFetch<XaiModels>('https://api.x.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })
  return {
    activeModels: compactModels((data.data ?? []).map(model => model.id ?? '').filter(model => /grok/i.test(model))),
    note: 'xAI models endpoint responded.',
  }
}

async function probeTavily(apiKey: string): Promise<ProbeResult> {
  await jsonFetch<unknown>('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'War Room provider health check',
      search_depth: 'basic',
      topic: 'general',
      max_results: 1,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
    }),
  })
  return {
    activeModels: ['tavily-search'],
    note: 'Tavily minimal search endpoint responded.',
  }
}

async function probeFirecrawl(apiKey: string): Promise<ProbeResult> {
  await jsonFetch<unknown>('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: 'https://example.com',
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 6000,
    }),
  })
  return {
    activeModels: ['firecrawl-scrape'],
    note: 'Firecrawl bounded scrape endpoint responded.',
  }
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openai',
    provider: 'OpenAI',
    family: 'ChatGPT family',
    envNames: ['OPENAI_API_KEY'],
    probe: probeOpenAi,
  },
  {
    id: 'anthropic',
    provider: 'Anthropic',
    family: 'Claude family',
    envNames: ['ANTHROPIC_API_KEY'],
    probe: probeAnthropic,
  },
  {
    id: 'google',
    provider: 'Google Gemini',
    family: 'Gemini family',
    envNames: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    probe: probeGoogle,
  },
  {
    id: 'xai',
    provider: 'xAI',
    family: 'Grok family',
    envNames: ['XAI_API_KEY'],
    probe: probeXai,
  },
  {
    id: 'tavily',
    provider: 'Tavily',
    family: 'Signal Radar',
    envNames: ['TAVILY_API_KEY'],
    signalProvider: true,
    probe: probeTavily,
  },
  {
    id: 'firecrawl',
    provider: 'Firecrawl',
    family: 'Signal enrichment',
    envNames: ['FIRECRAWL_API_KEY'],
    optional: true,
    signalProvider: true,
    probe: probeFirecrawl,
  },
]

async function checkProvider(definition: ProviderDefinition): Promise<ProviderRuntimeStatus> {
  const checkedAt = new Date().toISOString()
  const apiKey = envValue(definition.envNames)
  if (!apiKey) {
    return {
      id: definition.id,
      provider: definition.provider,
      family: definition.family,
      optional: Boolean(definition.optional),
      configured: false,
      health: 'MISSING_KEY',
      latencyMs: null,
      checkedAt,
      lastSuccessAt: lastSuccessByProvider[definition.id] ?? null,
      quotaState: 'unknown',
      rateLimitResetAt: null,
      activeModels: [],
      signalAvailability: false,
      note: definition.optional ? 'Optional provider key is not configured.' : 'Required provider key is not configured.',
    }
  }

  const started = Date.now()
  try {
    const result = await definition.probe(apiKey)
    const successAt = new Date().toISOString()
    lastSuccessByProvider[definition.id] = successAt
    return {
      id: definition.id,
      provider: definition.provider,
      family: definition.family,
      optional: Boolean(definition.optional),
      configured: true,
      health: 'CONNECTED',
      latencyMs: Date.now() - started,
      checkedAt,
      lastSuccessAt: successAt,
      quotaState: 'ok',
      rateLimitResetAt: null,
      activeModels: compactModels(result.activeModels ?? []),
      signalAvailability: Boolean(definition.signalProvider),
      note: result.note ?? 'Provider responded successfully.',
    }
  } catch (error) {
    const classified = classifyError(error)
    return {
      id: definition.id,
      provider: definition.provider,
      family: definition.family,
      optional: Boolean(definition.optional),
      configured: true,
      health: classified.health,
      latencyMs: Date.now() - started,
      checkedAt,
      lastSuccessAt: lastSuccessByProvider[definition.id] ?? null,
      quotaState: classified.health === 'RATE_LIMITED' ? 'rate_limited' : 'unknown',
      rateLimitResetAt: error instanceof ProviderHttpError ? error.resetAt : null,
      activeModels: [],
      signalAvailability: false,
      note: classified.note,
    }
  }
}

function familyStatus(providers: ProviderRuntimeStatus[]): Record<string, ProviderRuntimeHealth> {
  return Object.fromEntries(providers.map(provider => [provider.family, provider.health]))
}

export async function getProviderRuntimeHealth(options: { force?: boolean } = {}): Promise<ProviderRuntimeSummary> {
  if (!options.force && cachedSummary && cachedSummary.expiresAt > Date.now()) return cachedSummary.summary

  const providers = await Promise.all(PROVIDERS.map(checkProvider))
  const tavily = providers.find(provider => provider.id === 'tavily')
  const firecrawl = providers.find(provider => provider.id === 'firecrawl')
  const liveSignalsAvailable = tavily?.health === 'CONNECTED' || firecrawl?.health === 'CONNECTED'
  const summary: ProviderRuntimeSummary = {
    generatedAt: new Date().toISOString(),
    cacheTtlMs: CACHE_TTL_MS,
    providers,
    families: familyStatus(providers),
    signalAvailability: {
      tavily: tavily?.health === 'CONNECTED',
      firecrawl: firecrawl?.health === 'CONNECTED',
      liveSignalsAvailable,
      note: liveSignalsAvailable
        ? 'At least one live signal provider responded successfully.'
        : 'No live signal provider is currently connected; fallbacks must be truth-labeled.',
    },
    guardrails: {
      serverSideOnly: true,
      apiKeysSerialized: false,
      timeoutProtected: true,
      providerFailureIsolation: true,
      autonomousExecution: false,
    },
  }

  cachedSummary = { expiresAt: Date.now() + CACHE_TTL_MS, summary }
  return summary
}
