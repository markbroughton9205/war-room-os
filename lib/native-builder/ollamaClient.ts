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

export type OllamaCompletionResult =
  | { ok: true; text: string; model: string }
  | { ok: false; detail: string }

/** Requests a single, non-streamed completion. Never throws — callers get an honest ok:false on
 * any failure (unreachable, timeout, model not pulled, malformed response). */
export async function requestOllamaCompletion(args: {
  model: string
  prompt: string
  system?: string
}): Promise<OllamaCompletionResult> {
  const url = baseUrl()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        system: args.system,
        stream: false,
      }),
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, detail: `Ollama HTTP ${res.status}: ${body.slice(0, 300)}` }
    }
    const data = (await res.json()) as { response?: string }
    if (typeof data.response !== 'string' || !data.response.trim()) {
      return { ok: false, detail: 'Ollama returned an empty response.' }
    }
    return { ok: true, text: data.response, model: args.model }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
