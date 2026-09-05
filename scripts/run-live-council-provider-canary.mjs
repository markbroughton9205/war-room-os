import { readFileSync, existsSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnvLocal()

function usable(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  const sentinels = new Set(['[SENSITIVE]', '[REDACTED]', '[redacted]', '<REDACTED>', 'changeme', 'placeholder', 'your-api-key', 'not-set', 'todo', 'xxx', 'paste-key-here'])
  return !sentinels.has(trimmed) && !sentinels.has(trimmed.toLowerCase())
}

function sanitizeError(message) {
  const msg = String(message || '')
  const billing = /credit|billing|balance|purchase credits/i.test(msg)
  const auth = /auth|api key|unauthorized|invalid.?key|permission|unauthenticated/i.test(msg)
  const rate = /rate limit|too many requests/i.test(msg)
  return {
    length: msg.length,
    mentionsCredit: billing,
    mentionsAuth: auth,
    mentionsRate: rate,
    mentionsQuota: /quota/i.test(msg),
    mentionsModel: /model/i.test(msg),
    typeGuess: billing ? 'BILLING' : auth ? 'AUTH' : rate ? 'RATE_LIMIT' : null,
  }
}

function classify({ httpStatus, message }) {
  const msg = String(message || '').toLowerCase()
  if (httpStatus === 401 || httpStatus === 403) return 'AUTH'
  if (httpStatus === 429) return 'RATE_LIMIT'
  if (/credit|billing|balance/.test(msg)) return 'BILLING'
  if (/incorrect api key|auth|api key|unauthorized|invalid.?key/.test(msg)) return 'AUTH'
  if (/rate limit|too many requests/.test(msg)) return 'RATE_LIMIT'
  if (typeof httpStatus === 'number' && httpStatus >= 500) return 'PROVIDER'
  if (typeof httpStatus === 'number' && httpStatus >= 400) return 'REQUEST'
  return 'UNKNOWN'
}

async function readSse(response, onFrame) {
  if (!response.body) throw new Error('stream_missing_body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = async (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = buffer.split(/\n\n/)
    buffer = parts.pop() ?? ''
    const harvested = []
    for (const part of parts) if (part.trim()) harvested.push(part)
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) harvested.push(line)
    for (const frame of harvested) {
      let event = null
      const dataLines = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      await onFrame({ event, data: dataLines.join('\n') })
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    await flush(decoder.decode(value, { stream: true }))
  }
  await flush(decoder.decode())
  if (buffer.trim()) {
    let event = null
    const dataLines = []
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    await onFrame({ event, data: dataLines.join('\n') || buffer.trim() })
  }
}

async function jsonError(res) {
  try {
    const data = await res.json()
    if (typeof data?.error === 'string') return data.error
    return data?.error?.message || data?.error?.status || data?.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

async function openaiStream(key) {
  const started = Date.now()
  let deltas = 0
  let firstDeltaAt = null
  let text = ''
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 8,
      stream: true,
      messages: [
        { role: 'system', content: 'Reply with the single word OK.' },
        { role: 'user', content: 'Council-path canary. Reply OK.' },
      ],
    }),
  })
  if (!res.ok) return { ok: false, httpStatus: res.status, error: await jsonError(res), streamed: false, elapsedMs: Date.now() - started, textLooksOk: false }
  await readSse(res, ({ data }) => {
    if (!data || data === '[DONE]') return
    try {
      const parsed = JSON.parse(data)
      const chunk = parsed?.choices?.[0]?.delta?.content
      if (typeof chunk === 'string' && chunk) {
        if (firstDeltaAt == null) firstDeltaAt = Date.now() - started
        deltas += 1
        text += chunk
      }
    } catch { /* ignore */ }
  })
  return { ok: /ok/i.test(text), httpStatus: res.status, streamed: deltas > 0, firstDeltaAt, elapsedMs: Date.now() - started, textLooksOk: /ok/i.test(text) }
}

async function anthropicMinimal(key) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 8, system: 'Reply OK.', messages: [{ role: 'user', content: 'OK' }] }),
  })
  const err = res.ok ? null : await jsonError(res)
  return { httpStatus: res.status, ok: res.ok, errorSanitized: err ? sanitizeError(err) : null, classified: classify({ httpStatus: res.status, message: err }) }
}

async function anthropicStream(key) {
  const started = Date.now()
  let deltas = 0
  let firstDeltaAt = null
  let text = ''
  let sawStop = false
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8,
      stream: true,
      system: 'You are a War Room canary. Reply with the single word OK.',
      messages: [{ role: 'user', content: 'Council-path canary. Reply OK.' }],
    }),
  })
  if (!res.ok) {
    const error = await jsonError(res)
    return { ok: false, httpStatus: res.status, streamed: false, elapsedMs: Date.now() - started, errorSanitized: sanitizeError(error), classified: classify({ httpStatus: res.status, message: error }), sawStop: false, textLooksOk: false }
  }
  await readSse(res, ({ event, data }) => {
    if (event === 'message_stop' || (data && /"type"\s*:\s*"message_stop"/.test(data))) sawStop = true
    if (!data) return
    try {
      const parsed = JSON.parse(data)
      const type = event || parsed.type
      if (type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
        if (firstDeltaAt == null) firstDeltaAt = Date.now() - started
        deltas += 1
        text += parsed.delta.text
      }
    } catch { /* ignore */ }
  })
  return { ok: /ok/i.test(text) && sawStop, httpStatus: res.status, streamed: deltas > 0, firstDeltaAt, elapsedMs: Date.now() - started, sawStop, textLooksOk: /ok/i.test(text) }
}

async function grokStream(key, model) {
  const started = Date.now()
  let deltas = 0
  let firstDeltaAt = null
  let text = ''
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      stream: true,
      messages: [
        { role: 'system', content: 'Reply with the single word OK.' },
        { role: 'user', content: 'Council-path canary. Reply OK.' },
      ],
    }),
  })
  if (!res.ok) {
    const error = await jsonError(res)
    return { ok: false, httpStatus: res.status, streamed: false, elapsedMs: Date.now() - started, errorSanitized: sanitizeError(error), classified: classify({ httpStatus: res.status, message: error }), textLooksOk: false, model }
  }
  await readSse(res, ({ data }) => {
    if (!data || data === '[DONE]') return
    try {
      const parsed = JSON.parse(data)
      const chunk = parsed?.choices?.[0]?.delta?.content
      if (typeof chunk === 'string' && chunk) {
        if (firstDeltaAt == null) firstDeltaAt = Date.now() - started
        deltas += 1
        text += chunk
      }
    } catch { /* ignore */ }
  })
  return { ok: /ok/i.test(text), httpStatus: res.status, streamed: deltas > 0, firstDeltaAt, elapsedMs: Date.now() - started, textLooksOk: /ok/i.test(text), model }
}

async function geminiStream(key) {
  const started = Date.now()
  const listRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=256', {
    headers: { 'x-goog-api-key': key },
  })
  if (!listRes.ok) {
    const error = await jsonError(listRes)
    return { ok: false, httpStatus: listRes.status, streamed: false, elapsedMs: Date.now() - started, errorSanitized: sanitizeError(error), classified: classify({ httpStatus: listRes.status, message: error }), stage: 'list_models' }
  }
  const listed = await listRes.json()
  const allowed = new Set()
  for (const m of listed.models ?? []) {
    if (!m.supportedGenerationMethods?.includes('generateContent')) continue
    let id = String(m.name || '')
    if (id.startsWith('models/')) id = id.slice('models/'.length)
    if (id) allowed.add(id)
  }
  const fallback = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash', 'gemini-3.1-pro']
  const modelId = fallback.find((id) => allowed.has(id)) || [...allowed][0]
  if (!modelId) return { ok: false, httpStatus: listRes.status, streamed: false, elapsedMs: Date.now() - started, errorSanitized: sanitizeError('no generateContent model'), classified: 'REQUEST', stage: 'model_select' }
  let deltas = 0
  let firstDeltaAt = null
  let text = ''
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'Reply with the single word OK.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Council-path canary. Reply OK.' }] }],
      generationConfig: { maxOutputTokens: 32 },
    }),
  })
  if (!res.ok) {
    const error = await jsonError(res)
    return { ok: false, httpStatus: res.status, streamed: false, elapsedMs: Date.now() - started, errorSanitized: sanitizeError(error), classified: classify({ httpStatus: res.status, message: error }), modelId, stage: 'stream' }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  let firstByteAt = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value?.byteLength && firstByteAt == null) firstByteAt = Date.now() - started
    raw += decoder.decode(value, { stream: true })
  }
  raw += decoder.decode()
  const dataPayloads = []
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('data:')) dataPayloads.push(line.slice(5).trimStart())
  }
  if (!dataPayloads.length && raw.trim().startsWith('{')) dataPayloads.push(raw.trim())
  for (const data of dataPayloads) {
    try {
      const parsed = JSON.parse(data)
      const chunk = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
      if (chunk) {
        deltas += 1
        text += chunk
      }
    } catch { /* ignore */ }
  }
  return {
    ok: /ok/i.test(text),
    httpStatus: res.status,
    streamed: deltas > 0,
    firstDeltaAt: firstByteAt,
    elapsedMs: Date.now() - started,
    textLooksOk: /ok/i.test(text),
    modelId,
    stage: 'stream',
    byteLength: raw.length,
  }
}

const results = {}

if (!usable(process.env.OPENAI_API_KEY)) results.openai = { skipped: true, reason: 'unusable_or_missing_key' }
else results.openai = { probe: 'stream+council-shaped', ...(await openaiStream(process.env.OPENAI_API_KEY)) }

if (!usable(process.env.ANTHROPIC_API_KEY)) results.anthropic = { skipped: true, reason: 'unusable_or_missing_key' }
else {
  const minimal = await anthropicMinimal(process.env.ANTHROPIC_API_KEY)
  const stream = await anthropicStream(process.env.ANTHROPIC_API_KEY)
  results.anthropic = { minimal, stream, councilPath: stream }
}

if (!usable(process.env.XAI_API_KEY)) results.grok = { skipped: true, reason: 'unusable_or_missing_key' }
else {
  const model = process.env.XAI_MODEL?.trim() || 'grok-4.3'
  let grok = await grokStream(process.env.XAI_API_KEY, model)
  grok.keyPrefixClass = String(process.env.XAI_API_KEY).startsWith('xai-') ? 'xai' : 'unprefixed'
  results.grok = grok
}

if (!usable(process.env.GEMINI_API_KEY)) results.gemini = { skipped: true, reason: 'unusable_or_missing_key' }
else results.gemini = await geminiStream(process.env.GEMINI_API_KEY)

console.log(JSON.stringify({ canary: true, secretsPrinted: false, results }, null, 2))
