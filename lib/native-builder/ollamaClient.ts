/**
 * Real Ollama HTTP client — no prior adapter existed in this repo (the only prior reference,
 * lib/council/brain-selection/BrainCandidateRegistry.ts, is a routing-decision *label*
 * ('local-ollama') with no HTTP call behind it; lib/signals/model.ts even declares
 * `noOllama: true` as an explicit guardrail elsewhere). This client probes honestly: if nothing
 * is listening on the configured port, callers get `available: false`, never a fabricated result.
 */

const DEFAULT_BASE_URL = 'http://localhost:11434'
const PROBE_TIMEOUT_MS = 2000
const GENERATE_TIMEOUT_MS = 60_000

function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export type OllamaProbeResult = {
  available: boolean
  baseUrl: string
  models: string[]
  detail: string
}

export async function probeOllama(): Promise<OllamaProbeResult> {
  const url = baseUrl()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) {
      return { available: false, baseUrl: url, models: [], detail: `Ollama responded with HTTP ${res.status}.` }
    }
    const data = (await res.json()) as { models?: { name: string }[] }
    const models = (data.models ?? []).map(m => m.name)
    return { available: true, baseUrl: url, models, detail: models.length ? `${models.length} model(s) available.` : 'Reachable, but no models are pulled.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { available: false, baseUrl: url, models: [], detail: `Unreachable: ${message}` }
  }
}

export type OllamaCompletionMetrics = {
  ttftMs: number | null
  tokensPerSecond: number | null
  totalMs: number | null
  modelLoadMs: number | null
  promptEvalMs: number | null
  evalCount: number | null
}

export type OllamaCompletionResult =
  | { ok: true; text: string; thinking: string | null; model: string; metrics: OllamaCompletionMetrics }
  | { ok: false; detail: string }

export type OllamaStreamHandlers = {
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

function nsToMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value / 1e6) : null
}

function tokensPerSecond(evalCount: unknown, evalDurationNs: unknown): number | null {
  if (typeof evalCount !== 'number' || typeof evalDurationNs !== 'number') return null
  if (!Number.isFinite(evalCount) || evalCount <= 0 || evalDurationNs <= 0) return null
  return Math.round((evalCount / (evalDurationNs / 1e9)) * 10) / 10
}

function generateBody(args: { model: string; prompt: string; system?: string; stream: boolean }) {
  return {
    model: args.model,
    prompt: args.prompt,
    system: args.system,
    stream: args.stream,
    think: false,
    keep_alive: -1,
  }
}

/** Requests a single, non-streamed completion. Never throws — callers get an honest ok:false on
 * any failure (unreachable, timeout, model not pulled, malformed response). */
export async function requestOllamaCompletion(args: {
  model: string
  prompt: string
  system?: string
}): Promise<OllamaCompletionResult> {
  const streamed = await requestOllamaStreamingCompletion(args)
  return streamed
}

function mergeSignals(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  external?.addEventListener('abort', onAbort, { once: true })
  if (external?.aborted) controller.abort()
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * True token streaming against Ollama /api/generate. Thinking is kept separate and is never
 * concatenated into `text`. `think: false` plus keep_alive=-1 are request options only — they do
 * not change host-wide Ollama daemon configuration.
 */
export async function requestOllamaStreamingCompletion(args: {
  model: string
  prompt: string
  system?: string
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}): Promise<OllamaCompletionResult> {
  const url = baseUrl()
  const started = Date.now()
  const { signal, cleanup } = mergeSignals(args.signal, GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(generateBody({ ...args, stream: true })),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 400 && /think|keep_alive/i.test(body)) {
        return requestOllamaStreamingCompletionCompat(args, signal, started)
      }
      return { ok: false, detail: `Ollama HTTP ${res.status}: ${body.slice(0, 300)}` }
    }
    return readOllamaGenerateStream(res, args.model, args.onDelta, started)
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    cleanup()
  }
}

async function requestOllamaStreamingCompletionCompat(
  args: { model: string; prompt: string; system?: string; onDelta?: (delta: string) => void },
  signal: AbortSignal,
  started: number,
): Promise<OllamaCompletionResult> {
  try {
    const res = await fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        system: args.system,
        stream: true,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, detail: `Ollama HTTP ${res.status}: ${body.slice(0, 300)}` }
    }
    return readOllamaGenerateStream(res, args.model, args.onDelta, started)
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function readOllamaGenerateStream(
  res: Response,
  model: string,
  onDelta: ((delta: string) => void) | undefined,
  started: number,
): Promise<OllamaCompletionResult> {
  if (!res.body) return { ok: false, detail: 'Ollama returned an empty stream body.' }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let visible = ''
  let thinking = ''
  let firstTokenAt: number | null = null
  let evalCount: number | null = null
  let evalDurationNs: number | null = null
  let loadDurationNs: number | null = null
  let promptEvalDurationNs: number | null = null

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return
    }
    const chunkThinking = typeof parsed.thinking === 'string' ? parsed.thinking : ''
    if (chunkThinking) thinking += chunkThinking
    const delta = typeof parsed.response === 'string' ? parsed.response : ''
    if (delta) {
      if (firstTokenAt == null) firstTokenAt = Date.now()
      visible += delta
      onDelta?.(delta)
    }
    if (typeof parsed.eval_count === 'number') evalCount = parsed.eval_count
    if (typeof parsed.eval_duration === 'number') evalDurationNs = parsed.eval_duration
    if (typeof parsed.load_duration === 'number') loadDurationNs = parsed.load_duration
    if (typeof parsed.prompt_eval_duration === 'number') promptEvalDurationNs = parsed.prompt_eval_duration
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
    if (done) {
      consumeLine(buffer)
      break
    }
  }

  const text = visible.trim()
  if (!text) return { ok: false, detail: 'Ollama returned an empty response.' }
  return {
    ok: true,
    text,
    thinking: thinking.trim() || null,
    model,
    metrics: {
      ttftMs: firstTokenAt == null ? null : firstTokenAt - started,
      tokensPerSecond: tokensPerSecond(evalCount, evalDurationNs),
      totalMs: Date.now() - started,
      modelLoadMs: nsToMs(loadDurationNs),
      promptEvalMs: nsToMs(promptEvalDurationNs),
      evalCount,
    },
  }
}
