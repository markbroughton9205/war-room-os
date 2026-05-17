const HEARTBEAT_MS = 20_000
const POLL_MS = 5_000
const OLLAMA_BASE_URL = trimTrailingSlash(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
const LM_STUDIO_BASE_URL = normalizeLMStudioBaseUrl(process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1')
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || ''
const CLOUD_BASE_URL = trimTrailingSlash(process.env.WAR_ROOM_CLOUD_BASE_URL || 'http://localhost:3000')
const BRIDGE_TOKEN = process.env.WAR_ROOM_BRIDGE_TOKEN || ''

const ALLOWED_ACTIONS = ['model_list', 'prompt_test', 'local_inference', 'diagnostics', 'health_check']

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function normalizeLMStudioBaseUrl(value) {
  const trimmed = trimTrailingSlash(value)
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function authHeaders() {
  return {
    Authorization: `Bearer ${BRIDGE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function lmStudioHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(process.env.LM_STUDIO_API_KEY ? { Authorization: `Bearer ${process.env.LM_STUDIO_API_KEY}` } : {}),
  }
}

async function timedFetch(url, init = {}, timeoutMs = 1800) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, latencyMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timeout)
  }
}

async function detectOllama() {
  const checkedAt = new Date().toISOString()
  try {
    const { response, latencyMs } = await timedFetch(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' })
    const data = await response.json().catch(() => ({}))
    const models = Array.isArray(data.models)
      ? data.models.map(model => model?.name).filter(Boolean)
      : []
    return {
      provider: 'ollama',
      reachable: response.ok,
      functional: response.ok && models.length > 0,
      models,
      activeModel: models[0] || null,
      latencyMs,
      error: response.ok ? null : `Ollama returned HTTP ${response.status}`,
      checkedAt,
    }
  } catch (error) {
    return {
      provider: 'ollama',
      reachable: false,
      functional: false,
      models: [],
      activeModel: null,
      latencyMs: null,
      error: error instanceof Error ? error.message : 'Ollama detection failed.',
      checkedAt,
    }
  }
}

async function detectLMStudio() {
  const checkedAt = new Date().toISOString()
  try {
    const { response, latencyMs } = await timedFetch(`${LM_STUDIO_BASE_URL}/models`, {
      method: 'GET',
      headers: lmStudioHeaders(),
    })
    const data = await response.json().catch(() => ({}))
    const models = Array.isArray(data.data)
      ? data.data.map(model => model?.id).filter(Boolean)
      : []
    return {
      provider: 'lm_studio',
      reachable: response.ok,
      functional: response.ok && models.length > 0,
      models,
      activeModel: LM_STUDIO_MODEL || models[0] || null,
      latencyMs,
      error: response.ok ? null : `LM Studio returned HTTP ${response.status}`,
      checkedAt,
    }
  } catch (error) {
    return {
      provider: 'lm_studio',
      reachable: false,
      functional: false,
      models: [],
      activeModel: null,
      latencyMs: null,
      error: error instanceof Error ? error.message : 'LM Studio detection failed.',
      checkedAt,
    }
  }
}

async function detectProviders() {
  return Promise.all([detectLMStudio(), detectOllama()])
}

function pickActiveProvider(providers) {
  return providers.find(provider => provider.provider === 'lm_studio' && provider.functional)
    || providers.find(provider => provider.provider === 'ollama' && provider.functional)
    || null
}

async function sendHeartbeat() {
  const providers = await detectProviders()
  const active = pickActiveProvider(providers)
  const latencyMs = providers
    .map(provider => provider.latencyMs)
    .filter(value => typeof value === 'number')
    .sort((a, b) => a - b)[0] ?? null

  const body = {
    nodeName: 'Commander Node',
    activeProvider: active?.provider ?? null,
    activeModel: active?.activeModel ?? null,
    latencyMs,
    providers,
    capabilities: ALLOWED_ACTIONS,
    version: 'phase-10c',
  }

  const response = await fetch(`${CLOUD_BASE_URL}/api/bridge/heartbeat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Heartbeat rejected with HTTP ${response.status}`)
}

async function lmStudioCompletion(prompt, model) {
  const detected = await detectLMStudio()
  const modelUsed = model || detected.activeModel
  if (!modelUsed) throw new Error('LM Studio has no active model.')

  const startedAt = Date.now()
  const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: lmStudioHeaders(),
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: modelUsed,
      messages: [
        { role: 'system', content: 'You are a local War Room inference connector. Answer directly. You cannot use tools, shell, files, deployment controls, or OS automation.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      stream: false,
    }),
  })
  const data = await response.json().catch(() => ({}))
  const text = data?.choices?.[0]?.message?.content?.trim() || ''
  if (!response.ok || !text) throw new Error(data?.error?.message || `LM Studio returned HTTP ${response.status}`)
  return { response: text, model: modelUsed, latencyMs: Date.now() - startedAt }
}

async function ollamaCompletion(prompt, model) {
  const detected = await detectOllama()
  const modelUsed = model || detected.activeModel
  if (!modelUsed) throw new Error('Ollama has no active model.')

  const startedAt = Date.now()
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: modelUsed,
      prompt,
      system: 'You are a local War Room inference connector. Answer directly. You cannot use tools, shell, files, deployment controls, or OS automation.',
      stream: false,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
  return { response: data.response || '', model: data.model || modelUsed, latencyMs: Date.now() - startedAt }
}

async function executeInvocation(request) {
  if (!ALLOWED_ACTIONS.includes(request.action)) throw new Error('Unsupported bridge action.')

  const providers = await detectProviders()
  const requestedProvider = request.provider
    ? providers.find(provider => provider.provider === request.provider)
    : pickActiveProvider(providers)

  if (request.action === 'health_check') {
    return { provider: requestedProvider?.provider ?? null, model: requestedProvider?.activeModel ?? null, latencyMs: requestedProvider?.latencyMs ?? null, response: 'healthy', diagnostics: { providers } }
  }

  if (request.action === 'diagnostics') {
    return { provider: requestedProvider?.provider ?? null, model: requestedProvider?.activeModel ?? null, latencyMs: null, response: null, diagnostics: { providers, boundaries: 'No shell, filesystem writes, deployment control, arbitrary commands, or OS automation.' } }
  }

  if (request.action === 'model_list') {
    return { provider: requestedProvider?.provider ?? null, model: requestedProvider?.activeModel ?? null, latencyMs: null, response: null, models: requestedProvider?.models ?? [], diagnostics: { providers } }
  }

  const prompt = request.prompt || 'Reply with one short sentence confirming local inference is available.'
  if (!requestedProvider?.functional) throw new Error('Requested local provider is not functional.')

  const completion = requestedProvider.provider === 'lm_studio'
    ? await lmStudioCompletion(prompt, request.model || requestedProvider.activeModel)
    : await ollamaCompletion(prompt, request.model || requestedProvider.activeModel)

  return {
    provider: requestedProvider.provider,
    model: completion.model,
    latencyMs: completion.latencyMs,
    response: completion.response,
  }
}

async function completeInvocation(id, action, output, error = null) {
  await fetch(`${CLOUD_BASE_URL}/api/bridge/invoke`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      action: 'complete',
      result: {
        id,
        action,
        provider: output?.provider ?? null,
        model: output?.model ?? null,
        latencyMs: output?.latencyMs ?? null,
        response: output?.response ?? null,
        models: output?.models,
        diagnostics: output?.diagnostics,
        error,
        completedAt: new Date().toISOString(),
      },
    }),
  })
}

async function pollInvocations() {
  const response = await fetch(`${CLOUD_BASE_URL}/api/bridge/invoke?poll=1`, {
    method: 'GET',
    headers: authHeaders(),
  })
  if (!response.ok) throw new Error(`Poll rejected with HTTP ${response.status}`)

  const data = await response.json()
  const request = data?.request
  if (!request?.id) return

  try {
    const output = await executeInvocation(request)
    await completeInvocation(request.id, request.action, output)
  } catch (error) {
    await completeInvocation(request.id, request.action, null, error instanceof Error ? error.message : 'Local invocation failed.')
  }
}

async function loop(label, fn, intervalMs) {
  try {
    await fn()
  } catch (error) {
    console.error(`[bridge:${label}] ${error instanceof Error ? error.message : 'failed'}`)
  } finally {
    setTimeout(() => void loop(label, fn, intervalMs), intervalMs)
  }
}

if (!BRIDGE_TOKEN) {
  console.error('WAR_ROOM_BRIDGE_TOKEN is required.')
  process.exit(1)
}

console.log(`Commander Node bridge starting. Cloud base: ${CLOUD_BASE_URL}`)
void loop('heartbeat', sendHeartbeat, HEARTBEAT_MS)
void loop('invoke', pollInvocations, POLL_MS)
